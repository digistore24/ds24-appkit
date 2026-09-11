// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The READ side of the product approval — "are my products approved yet?"
//
// `request-approval.mjs` writes `approval_status = pending`; nothing used to
// read the answer back, so a forgotten approval surfaced as real purchases
// failing while the test ones worked. This module asks once a day and feeds
// the one unobtrusive surface this project has: a bracketed line in the
// session greeting (scripts/dev/session-start.mjs), plus an `info` check in
// doctor that reads the same cache.
//
// The shape of the answer is PROBED, not documented (2026-07-28, against a
// real account): the OpenAPI spec lists no approval field on `listProducts`
// items, but every item carries `approval_status_list` — one entry per
// reseller:
//
//   { "reseller_id": "1", "approval_status": "new", "approval_status_msg": …,
//     "is_siteowner_active": "Y", "approval_reject_reason_description": "", … }
//
// Values: "new" (never requested), "pending" (what request-approval sets),
// "approved" / "rejected" (decided by the reseller). Because none of that is
// documented, everything here tolerates a missing list, a missing entry and
// an unknown value — each answers `null`, and `null` means "say nothing".
//
// **A product has ONE status here, aggregated across every marketplace**, by
// the vendor's rule: approved anywhere wins, else pending, else rejected, else
// new. That is the question this file exists to answer — "can I sell this?" —
// and it is deliberately siteowner-independent: a product approved in DE sells
// in DE, whatever the US reseller has decided. The per-siteowner view is a
// different question and has its own function (`approvalStatusOf`), used by
// the write side, where the marketplace being written to is the whole point.
//
// Four properties, all deliberate:
//
//   **Never fatal.** This sits in front of every session; every failure path
//   resolves to "say nothing". That is also why `_client.mjs` is imported
//   lazily below — see `approvalReport`.
//   **One listProducts call per day, at most.** Cached in .dev/; once every
//   product is approved the interval stretches to a week.
//   **Only when there is something to ask about** — a key in the .env and at
//   least one synced productId; anything less is silence, not an error.
//   **Switchable off** — `DIGISTORE_APPROVAL_CHECK=off` in the `.env`.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractProducts, idOf, productTargets, readProducts } from "./_products.mjs";
import { isReseller } from "./_resellers.mjs";


// Resolved from this file, not from the cwd — `_products.mjs` resolves the
// registry the same way, and the two must agree. A cwd-relative path let
// `node scripts/ds24/request-approval.mjs` run from another folder find the
// products, send the request, and then delete a cache that was never there.
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CACHE_PATH = join(PROJECT_ROOT, ".dev", "approval-check.json");

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

/** Time to ask again? An unreadable or malformed cache counts as yes. */
export function isDue(cache, now, ttl = DAY) {
  const checkedAt = Number(cache?.checkedAt);
  if (!Number.isFinite(checkedAt)) return true;
  // A clock that moved backwards (a restored machine, a different timezone
  // written into the file) would otherwise park the check in the future for ever.
  if (checkedAt > now) return true;
  return now - checkedAt >= ttl;
}

/** Beyond this a cached answer is too old to report as if it were current. */
export const MAX_CACHE_AGE = 30 * DAY;

/** The API's timeout. Short on purpose: this runs in front of every session. */
const REQUEST_TIMEOUT_MS = 3000;

export const KNOWN_STATUSES = ["new", "pending", "approved", "rejected"];
const KNOWN = new Set(KNOWN_STATUSES);

/** Worst-to-best is not the order here — sellability is. See the header. */
const PRECEDENCE = ["approved", "pending", "rejected", "new"];

function readStatus(entry) {
  const status = String(entry?.approval_status ?? "")
    .trim()
    .toLowerCase();
  return KNOWN.has(status) ? status : null;
}

/**
 * A marketplace the account is not active for cannot act on a request, so its
 * entry says nothing about whether the product can be sold. Only an explicit
 * "N" counts as inactive — the field is undocumented, and treating a missing
 * one as inactive would silence the whole feature if it ever disappears.
 */
function isActive(entry) {
  return String(entry?.is_siteowner_active ?? "").trim().toUpperCase() !== "N";
}

/**
 * The status of one listProducts/getProduct item **for one siteowner**:
 * "new" | "pending" | "approved" | "rejected" — or `null` when the answer
 * cannot be read (missing list, a siteowner the list does not carry, a value
 * this code does not know). `null` is silence, never a guess.
 *
 * This is the WRITE side's question: `request-approval.mjs` writes to one
 * marketplace and must not overwrite an approval on that one. The greeting
 * asks the aggregated question instead — `aggregateApprovalStatus`.
 */
export function approvalStatusOf(product, siteownerId) {
  return readStatus(resellerEntry(product, siteownerId));
}

/**
 * The raw `approval_status_list` entry for one siteowner, or null.
 *
 * The write side needs to tell three states apart that `approvalStatusOf`
 * flattens into one `null`: the list could not be read at all (refuse — an
 * approval cannot be ruled out), the list is fine but carries no entry for this
 * marketplace (a private siteowner Digistore24 does not report on — proceed),
 * and the entry exists but its marketplace is inactive (pointless — refuse).
 */
export function resellerEntry(product, siteownerId) {
  const list = product?.approval_status_list;
  if (!Array.isArray(list)) return null;
  return list.find((e) => String(e?.reseller_id) === String(siteownerId)) ?? null;
}

/** Is the response's approval list readable at all for this product? */
export function hasApprovalList(product) {
  return Array.isArray(product?.approval_status_list);
}

/**
 * Does product approval apply to this vendor at all?
 *
 * `true` when at least one of the four RESELLERS is active for the account,
 * `false` when the list is readable and none is — that vendor is a **Direct
 * Seller**, sells on their own account, and has nobody to submit a product to.
 * `null` when the list cannot be read, which is a different thing entirely and
 * must not be silenced as "does not apply".
 *
 * Without this the greeting nags a Direct Seller "not submitted for approval
 * yet" for the life of their project, about a step that does not exist for
 * them, and no amount of running the command ever clears it.
 */
export function approvalApplies(product) {
  const list = product?.approval_status_list;
  if (!Array.isArray(list)) return null;
  return list.some((e) => isActive(e) && isReseller(e?.reseller_id));
}

/** Can this marketplace act? Only an explicit "N" says no — see isActive. */
export function isMarketplaceActive(entry) {
  return isActive(entry);
}

/**
 * The status of one item across EVERY marketplace it is active for, by the
 * vendor's rule: **approved anywhere wins**, else pending, else rejected, else
 * new. `null` when nothing readable is left.
 *
 * The precedence is about sellability, not severity. A product approved in
 * Germany and rejected in the US can be sold, so nothing should nag about it;
 * a rejection only matters while nobody has approved it anywhere, and then it
 * is the most useful thing to say because it names an action the vendor has to
 * take in their account.
 */
export function aggregateApprovalStatus(product) {
  const list = product?.approval_status_list;
  if (!Array.isArray(list)) return null;
  const found = new Set(list.filter(countsForApproval).map(readStatus).filter(Boolean));
  return PRECEDENCE.find((status) => found.has(status)) ?? null;
}

/**
 * Which entries have anything to say about approval: an active marketplace
 * that is one of the four RESELLERS. A Direct Seller entry carries no approval
 * concept, so counting it would invent a verdict out of a field that means
 * nothing there.
 */
function countsForApproval(entry) {
  return isActive(entry) && isReseller(entry?.reseller_id);
}

/**
 * Did any active marketplace reject this product?
 *
 * Recorded ALONGSIDE the aggregate, not inside it. The precedence above is
 * about sellability and puts `pending` ahead of `rejected` — which is right for
 * "can I sell this?", and quietly wrong for "is there something I have to do?":
 * a product rejected in Germany and still queued in the USA aggregates to
 * `pending`, and the German rejection — the one thing the vendor has to act on,
 * and the reason this whole feature exists — is never mentioned again, because
 * nothing will ever move the US entry.
 *
 * So the aggregate keeps deciding whether to speak, and this decides what to
 * say when it does. An approved product still says nothing: it sells.
 */
export function rejectedSomewhere(product) {
  const list = product?.approval_status_list;
  if (!Array.isArray(list)) return false;
  return list.filter(countsForApproval).some((e) => readStatus(e) === "rejected");
}

/** Product keys grouped by state. Unreadable statuses (null) appear nowhere. */
export function classifyStatuses(statuses) {
  const grouped = {
    approved: [],
    pending: [],
    rejected: [],
    unrequested: [],
    unknown: [],
    // Direct Seller: approval does not exist for this vendor. Its own bucket
    // rather than "approved", because it is not a verdict — and no surface
    // reports it, because there is nothing to do about it.
    notApplicable: [],
  };
  // A cache written by another version — or by hand — may hold anything.
  if (!statuses || typeof statuses !== "object" || Array.isArray(statuses)) return grouped;
  for (const [key, entry] of Object.entries(statuses)) {
    if (entry?.applies === false) grouped.notApplicable.push(key);
    else if (entry?.status === "approved") grouped.approved.push(key);
    else if (entry?.status === "pending") grouped.pending.push(key);
    else if (entry?.status === "rejected") grouped.rejected.push(key);
    else if (entry?.status === "new") grouped.unrequested.push(key);
    else grouped.unknown.push(key);
  }
  return grouped;
}

/** Every synced product approved — the state that earns the longer interval. */
export function allApproved(result) {
  const statuses = result?.statuses;
  if (!statuses || typeof statuses !== "object" || Array.isArray(statuses)) return false;
  const entries = Object.values(statuses);
  return entries.length > 0 && entries.every((e) => e?.status === "approved");
}

/** The product ids a cache describes, sorted — the cache's identity. */
function cachedIds(cache) {
  const statuses = cache?.statuses;
  if (!statuses || typeof statuses !== "object" || Array.isArray(statuses)) return null;
  return Object.values(statuses)
    .map((e) => String(e?.productId))
    .sort();
}

/**
 * How long yesterday's answer holds: 0 when it describes a different set of
 * products (then it is not an old answer, it is an answer to another
 * question), a week when everything is approved, otherwise a day.
 *
 * Three orderings in here are each a bug that was actually shipped:
 *
 * **A quiet cache holds for a day.** `{ statuses: null }` is not an unusable
 * cache, it is a recorded "we asked and could not find out" — and it has to
 * expire like any other answer. Returning 0 for it made `isDue` true at the
 * same millisecond it was written, so an offline machine paid for a fresh
 * authenticated call at every single session start, for ever. That is the
 * whole budget this file exists to keep, undone by the fix for a different bug.
 *
 * **The product comparison comes before the all-approved shortcut.** Behind
 * it, a freshly synced product went unmentioned for a day.
 *
 * **A cache with no usable timestamp is always due**, because nothing else can
 * bound it.
 */
export function ttlFor(cache, productIds) {
  const checkedAt = Number(cache?.checkedAt);
  if (!Number.isFinite(checkedAt) || checkedAt <= 0) return 0;
  if (cache.statuses === null) return DAY;
  const cached = cachedIds(cache);
  if (!cached) return 0;
  const wanted = productIds.map(String).sort();
  if (cached.length !== wanted.length) return 0;
  if (cached.some((id, i) => id !== wanted[i])) return 0;
  return allApproved(cache) ? WEEK : DAY;
}

/** At most this many product keys are named in one greeting line. */
const NAME_LIMIT = 3;

function nameSome(keys) {
  const shown = keys.slice(0, NAME_LIMIT).map((k) => `"${k}"`).join(", ");
  const rest = keys.length - NAME_LIMIT;
  return rest > 0 ? `${shown} +${rest} more` : shown;
}

/**
 * The greeting's line, or null when there is nothing worth saying. One line
 * total, never one per product; the worst state wins, because it is the one
 * that costs sales: rejected > never requested > pending. All approved — or
 * nothing readable — is silence.
 *
 * Takes `null` as readily as an object: that is what approvalReport() answers
 * whenever it cannot answer.
 */
export function describeApproval(result) {
  const grouped = classifyStatuses(result?.statuses);
  // A rejection at ANY marketplace, on a product that is not sellable yet.
  // The aggregate may call such a product "pending" (see rejectedSomewhere),
  // and then this is the only place the rejection is ever mentioned.
  const rejected = Object.entries(result?.statuses ?? {})
    .filter(([, e]) => e?.rejected && e?.status !== "approved")
    .map(([key]) => key);
  if (rejected.length > 0 || grouped.rejected.length > 0) {
    const keys = rejected.length > 0 ? rejected : grouped.rejected;
    return (
      `[DS24: approval REJECTED for ${nameSome(keys)} — read the reason in ` +
      `your Digistore24 account, fix it there, then node run.mjs ds24-approval --apply]`
    );
  }
  if (grouped.unrequested.length > 0) {
    return (
      `[DS24: ${grouped.unrequested.length} product(s) not submitted for approval yet — ` +
      `only test purchases work until approved. Go-live step: node run.mjs ds24-approval --apply]`
    );
  }
  if (grouped.pending.length > 0) {
    return (
      `[DS24: approval pending for ${grouped.pending.length} product(s) — ` +
      `real sales start once Digistore24 approves.]`
    );
  }
  // Said out loud rather than swallowed: doctor reports this state as a failed
  // check, and the two surfaces read the same cache, so silence here was the
  // "greeting and doctor disagree" bug in a new place. It also means something
  // real — a product deleted at Digistore24, a key pointing at another account,
  // or the undocumented response shape having changed under us.
  if (grouped.unknown.length > 0) {
    return (
      `[DS24: approval status unreadable for ${grouped.unknown.length} product(s) — ` +
      `the product may be gone at Digistore24, or the API key belongs to another account. ` +
      `Check: node run.mjs ds24-approval]`
    );
  }
  // `notApplicable` is deliberately not reported anywhere: a Direct Seller has
  // no approval step, so there is nothing to do and nothing to say.
  return null;
}

/**
 * Should the check ask the API at all? Pure, so the three preconditions AC 3
 * turns on can be tested without a network or an `.env` — the version of this
 * that lived inline shipped with a kill switch that silenced the greeting and
 * left doctor talking, and no test could have caught it.
 */
export function shouldCheck({ killSwitch, apiKey, productIds, siteowner = "" }) {
  if (String(killSwitch ?? "").toLowerCase() === "off") return false;
  if (!apiKey) return false;
  // A configured siteowner that is not one of the four RESELLERS is a Direct
  // Seller, and product approval does not exist there — so there is nothing to
  // check, and the reminder would be a permanent false alarm. An UNSET variable
  // says nothing either way and is not treated as a Direct Seller; the response
  // itself answers that case (approvalApplies).
  if (String(siteowner ?? "").trim() !== "" && !isReseller(siteowner)) return false;
  return Array.isArray(productIds) && productIds.length > 0;
}

/** Park the answer in .dev/ for the day. A failure here is not worth a word. */
export function writeApprovalCache(result) {
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true });
    writeFileSync(CACHE_PATH, `${JSON.stringify(result)}\n`);
  } catch {
    /* then it asks again next session */
  }
}

/**
 * The cached answer, or null when there is none this code can use.
 *
 * An answer nobody has refreshed in a month is not a finding, it is a
 * leftover — the check was switched off, the key was removed, or the products
 * were unsynced. Reporting it as current is how doctor came to announce "not
 * requested yet" long after a product had been approved.
 *
 * A cache with no usable timestamp is rejected outright rather than waved
 * through. The guard used to read `Number(checkedAt) > 0 && tooOld`, so a
 * missing, zero, negative or non-numeric `checkedAt` skipped the age check
 * entirely — and doctor reads this file with no `isDue` behind it, so exactly
 * the hand-written and foreign-version caches the bound exists for were the
 * ones reported as today's answer for ever.
 */
export function readApprovalCache(now = Date.now()) {
  try {
    const cache = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
    const checkedAt = Number(cache?.checkedAt);
    if (!Number.isFinite(checkedAt) || checkedAt <= 0) return null;
    if (now - checkedAt > MAX_CACHE_AGE) return null;
    return cache;
  } catch {
    return null;
  }
}

/**
 * A request was just applied, or the check was switched off — either way
 * yesterday's cached answer is now wrong or unwanted, and doctor reads that
 * file without knowing any of it.
 */
export function dropApprovalCache() {
  try {
    rmSync(CACHE_PATH, { force: true });
  } catch {
    /* a cache that cannot be deleted expires on its own */
  }
}

/**
 * listProducts response → the aggregated status per registry key.
 *
 * @param {[string, { productId: string }][]} entries
 * @param {unknown[]} list
 * @returns {Record<string, { productId: string, status: string | null }>}
 */
export function statusesFrom(entries, list) {
  const byId = new Map(
    list.filter((p) => p && typeof p === "object").map((p) => [String(idOf(p)), p]),
  );
  /** @type {Record<string, { productId: string, status: string | null, rejected?: boolean, applies?: boolean }>} */
  const statuses = {};
  for (const [key, def] of entries) {
    const product = byId.get(String(def.productId)) ?? null;
    const applies = approvalApplies(product);
    statuses[key] = {
      productId: String(def.productId),
      status: aggregateApprovalStatus(product),
      rejected: rejectedSomewhere(product),
      // Only ever written as `false` — `null` (could not tell) must stay
      // distinguishable from "does not apply", or an unreadable response would
      // be silenced as if the vendor were a Direct Seller.
      ...(applies === false ? { applies: false } : {}),
    };
  }
  return statuses;
}

/**
 * The cached answer — `{ checkedAt, statuses: { key: { productId, status } } }`
 * — refreshed with one listProducts call when it is due, and `null` whenever
 * the question cannot be answered: no key, nothing synced, switched off,
 * offline, malformed anything.
 */
export async function approvalReport(now = Date.now()) {
  try {
    // Imported HERE and not at the top of the file. `_client.mjs` reads the
    // `.env` while it is being imported (`scripts/lib/env.mjs` calls
    // `loadEnv()` at module scope), and this function runs inside the session
    // greeting. A module that throws while being imported takes the whole
    // greeting with it — before any `try` in any function body can run — and
    // `template/CLAUDE.md` tells the agent to read a missing greeting as "this
    // machine has no Node". A `.env` that exists but cannot be read (mode 600
    // from a container, root-owned) did exactly that.
    const { ds24Call } = await import("./_client.mjs");

    let entries;
    try {
      // One entry per Digistore24 product — per offering AND language. Each is
      // approved separately, at the marketplace its language belongs to, so
      // each needs its own row here; see request-approval.mjs.
      //
      // PROD only, like the write side: approval exists for the live set. An
      // app that has only synced dev products has nothing to approve yet, and
      // the greeting stays quiet until the first prod sync (a go-live step).
      entries = productTargets(readProducts().products, "prod")
        .filter(({ productId }) => productId)
        .map(({ label, productId }) => [label, { productId }]);
    } catch {
      return null;
    }
    const productIds = entries.map(([, def]) => String(def.productId));

    const killSwitch = process.env.DIGISTORE_APPROVAL_CHECK;
    const siteowner = process.env.DIGISTORE_SITEOWNER_ID;
    const directSeller = String(siteowner ?? "").trim() !== "" && !isReseller(siteowner);
    if (!shouldCheck({
      killSwitch,
      apiKey: process.env.DIGISTORE_API_KEY,
      productIds,
      siteowner,
    })) {
      // doctor reads the file directly and knows nothing about the switch, so
      // leaving the cache behind would keep a silenced check talking.
      //
      // A missing KEY does not, though. It looks identical to a `.env` that was
      // simply not found — `scripts/lib/env.mjs` loads that file relative to the
      // current directory, while the registry and this cache are both resolved
      // from the script's own location. So a greeting fired with a different cwd
      // would erase a perfectly good answer. That state ages out through
      // MAX_CACHE_AGE instead.
      //
      // The switch and an empty registry are safe to act on: both are read from
      // a fixed path, so they mean what they say wherever the command ran.
      if (String(killSwitch ?? "").toLowerCase() === "off" || productIds.length === 0 || directSeller) {
        dropApprovalCache();
      }
      return null;
    }

    const cache = readApprovalCache(now);
    if (!isDue(cache, now, ttlFor(cache, productIds))) return cache;

    // A "cannot answer" is remembered for the same day as an answer — an
    // offline machine pays one failed request, not one per session.
    const quiet = () => {
      writeApprovalCache({ checkedAt: now, statuses: null });
      return null;
    };

    let list;
    try {
      list = extractProducts(
        await ds24Call("listProducts", process.env.DIGISTORE_API_KEY, {}, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }),
      );
    } catch {
      return quiet();
    }

    const result = { checkedAt: now, statuses: statusesFrom(entries, list) };
    writeApprovalCache(result);
    return result;
  } catch {
    // Reached when something outside the inner guards threw — most realistically
    // the lazy import above, i.e. the unreadable `.env` this whole restructure
    // exists for.
    //
    // **A known answer outranks this.** Overwriting it with a quiet marker was
    // how a `chmod 000 .env` — a file mode, nothing more — silently erased a
    // live `rejected` verdict and left both surfaces with nothing to say. Only
    // when there is no usable answer at all is the quiet marker written, and
    // then it holds for the day like any other (see ttlFor).
    try {
      const known = readApprovalCache(now);
      if (known?.statuses) return known;
      writeApprovalCache({ checkedAt: now, statuses: null });
    } catch {
      /* nothing left to do */
    }
    return null;
  }
}
