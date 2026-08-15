// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Test payments in DEV — the checkout link decorates itself.
//
// ============================================================================
// WARNING: the Digistore24 testpay parameter unlocks TEST payments on the
// checkout form (and opens it for not-yet-approved products). Anyone holding a
// checkout URL that carries it can "buy" without paying. If it were ever
// appended in production, customers would get access for free.
//
// It applies exclusively in the DEV environment. That is an allowlist, not a
// blocklist: anything not clearly recognized as development counts as
// production and is refused (see appEnv() in lib/env-guard.ts — a typo in
// APP_ENV lands on "production" there, not on "development").
//
// THREE independent conditions, all of which must hold — the same shape as
// lib/auth/dev-login.ts, and for the same reason:
//   1. APP_ENV resolves to "development" (STAGING and PROD are ruled out)
//   2. NODE_ENV is not "production"  — gone under `next build`/`next start`
//   3. APP_URL points at localhost   — a real deployment is never open
//
// You can always turn it off hard: DS24_TESTPAY=off in .env.
//
// A FOURTH condition is about the target rather than the environment: the key
// is only ever appended to a host on DIGISTORE_CHECKOUT_HOSTS
// (lib/digistore/config.mjs), because it must not travel to a host we did not
// fetch it for. ⚠️ Note that the checkout does NOT run on the API domain —
// createBuyUrl answers with www.checkout-ds24.com, a different registrable
// domain from digistore24.com. An allowlist that knew only the latter dropped
// the parameter from every link in DEV, silently, and the developer met "Das
// Produkt wurde noch nicht genehmigt." instead of a test purchase. That is why
// the refusal now warns (warnUndecorated below) rather than saying nothing.
//
// Two more properties are load-bearing:
//   - The key is fetched via the undocumented DS24 API function
//     `getTestpayKey` and cached in `.dev/testpay.json` — gitignored and
//     machine-local, NEVER in `.env` (setup-hosting copies .env values to the
//     production host) and never in the database.
//   - The key is ACCOUNT-level. Appended by hand to a live checkout URL it
//     would enable test purchases there too, and their IPNs grant real
//     entitlements. Treat it like a secret; `node run.mjs ds24-testpay
//     --recreate` rotates it (go-live does that before launch).
//
// Note on lib/digistore/public-url.ts: its refusal to rewrite URLs containing
// `&` never sees a decorated URL — publicUrlFor() only runs over thank-you
// URLs (optinThankyouUrl), while the decorated checkout URL goes straight to
// redirect()/href.
// ============================================================================
import fs from "node:fs/promises";
import path from "node:path";
import { isLocalUrl } from "@/lib/auth/dev-login";
import { appEnv } from "@/lib/env-guard";
import { ds24Post } from "./client";
import { DIGISTORE_CHECKOUT_HOSTS } from "./config.mjs";
import { ds24ApiKey, hasDigistoreApiKey } from "./settings";

export interface TestpayEnv {
  NODE_ENV?: string;
  APP_ENV?: string;
  APP_URL?: string;
  DS24_TESTPAY?: string;
}

/**
 * The one place that decides whether the testpay parameter exists at all.
 * Deliberately a pure function — it is money-critical and is tested on its
 * own in lib/digistore/testpay.test.ts.
 */
export function isTestpayAllowed(env: TestpayEnv): boolean {
  if (env.DS24_TESTPAY === "off") return false;
  // Allowlist: ONLY the DEV environment. appEnv() classifies anything unknown
  // as "production" — so a typo never sends the parameter to customers.
  if (appEnv(env.APP_ENV) !== "development") return false;
  if (env.NODE_ENV === "production") return false;
  if (!isLocalUrl(env.APP_URL)) return false;
  return true;
}

/** Reads the conditions from the actual environment. */
export function isTestpayActive(): boolean {
  return isTestpayAllowed({
    NODE_ENV: process.env.NODE_ENV,
    APP_ENV: process.env.APP_ENV,
    APP_URL: process.env.APP_URL,
    DS24_TESTPAY: process.env.DS24_TESTPAY,
  });
}

/** What `.dev/testpay.json` holds — the CLI (scripts/ds24/testpay.mjs) writes
 * the identical shape. */
export interface TestpayState {
  userId: string;
  testpayKey: string;
  /** From the API's `get_param_name` — never hardcode the parameter name. */
  paramName: string;
  /** Raw DS24 string ("YYYY-MM-DD HH:MM:SS", zone-less server time). */
  expiresAt: string;
  fetchedAt: string;
}

/**
 * Refresh this long before `expires_at`. Generous on purpose: the DS24
 * timestamp carries no timezone (the "Dates and raw SQL" trap in
 * `docs/troubleshooting.md`), so we parse it as UTC and let the margin swallow
 * the unknown offset plus any clock skew.
 */
const REFRESH_MARGIN_MS = 6 * 60 * 60 * 1000;

/** A failed fetch is not retried for this long. Load-bearing, not an
 * optimization: the plans page resolves every card in parallel, and without
 * the memo a broken API key would cost one 10s timeout per card per render
 * (and in `node run.mjs smoke`). */
const FAILURE_MEMO_MS = 5 * 60 * 1000;

function parseDs24Timestamp(raw: string | undefined): number | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  // No zone marker → read as UTC (never the host's zone — `docs/conventions.md`
  // → *A type on a query is a claim* for why V8's local-time default is the bug
  // and not the fix).
  const iso = /[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(" ", "T")}Z`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** true while the cached key is complete and comfortably inside `expires_at`.
 * An unparseable date counts as stale — then one re-fetch decides. */
export function isTestpayFresh(
  state: TestpayState | null | undefined,
  now: Date,
): boolean {
  if (!state?.testpayKey || !state.paramName) return false;
  const expires = parseDs24Timestamp(state.expiresAt);
  if (expires === null) return false;
  return now.getTime() < expires - REFRESH_MARGIN_MS;
}

/**
 * Is this the host of a Digistore24 checkout?
 *
 * The list is `DIGISTORE_CHECKOUT_HOSTS` in `lib/digistore/config.mjs` and
 * lives there rather than here on purpose: WHEN the parameter may exist is
 * policy and belongs in this file; WHICH hosts are Digistore24's is a fixed
 * fact about the vendor, and that file is where the other ones already are.
 *
 * ⚠️ The dot is the security property. `host.endsWith("digistore24.com")` also
 * accepts `notdigistore24.com`, and a plain `includes` would accept
 * `digistore24.com.evil.example`. Both are pinned by tests.
 */
export function isCheckoutHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return DIGISTORE_CHECKOUT_HOSTS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

/**
 * Appends the testpay parameter — but only onto a Digistore24 checkout URL. Any
 * other host (or an unparseable URL) gets the input back untouched: the key
 * must never travel to a host we did not fetch it for.
 *
 * The caller cannot tell those two refusals from a successful decoration by the
 * return value alone, which is why `withTestpayParam()` compares and warns —
 * this function stays pure.
 */
export function decorateCheckoutUrl(
  url: string,
  paramName: string,
  key: string,
): string {
  try {
    const u = new URL(url);
    if (!isCheckoutHost(u.hostname)) return url;
    u.searchParams.set(paramName, key);
    return u.toString();
  } catch {
    return url;
  }
}

export interface TestpayOptions {
  /** Test seam — the default asks the DS24 API (getTestpayKey). */
  fetcher?: () => Promise<TestpayState>;
  now?: Date;
  /** Test seam — defaults to `.dev/testpay.json` in the project root. */
  stateFile?: string;
}

let memory: TestpayState | null = null;
let inflight: Promise<TestpayState | null> | null = null;
let failedUntil = 0;
const warnedHosts = new Set<string>();

/** The module memoizes across requests; tests reset it between cases. */
export function resetTestpayForTests(): void {
  memory = null;
  inflight = null;
  failedUntil = 0;
  warnedHosts.clear();
}

/**
 * The gate was open and a key was really there — and the URL came back
 * undecorated anyway. That is a host we do not recognise (or a URL that does not
 * parse), and until this existed it was the ONE failure of this whole path that
 * said nothing at all: `docs/digistore-createbuyurl.md` promised "every failure
 * returns the undecorated URL with one console.warn", and this one returned it
 * with none. Digistore24 moving the checkout to a domain this list does not know
 * looks exactly like a working app in which nobody can test-buy anything.
 *
 * Once per host per process: the plans page resolves every card in parallel, and
 * eight identical lines are how a developer learns to skim past them.
 */
function warnUndecorated(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    host = "(unparseable URL)";
  }
  if (warnedHosts.has(host)) return;
  warnedHosts.add(host);
  console.warn(
    `[testpay] ${host} is not a known Digistore24 checkout host — the ` +
      "test-payment parameter was NOT appended, so this link buys for real " +
      "and an unapproved product will refuse it. The list is " +
      "DIGISTORE_CHECKOUT_HOSTS in lib/digistore/config.mjs.",
  );
}

function defaultStateFile(): string {
  return path.join(process.cwd(), ".dev", "testpay.json");
}

async function readStateFile(file: string): Promise<TestpayState | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    if (typeof parsed?.testpayKey !== "string" || typeof parsed?.paramName !== "string") {
      return null;
    }
    return parsed as TestpayState;
  } catch {
    return null; // missing or unreadable — the fetch decides
  }
}

async function writeStateFile(file: string, state: TestpayState): Promise<void> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch {
    // Unwritable .dev/ degrades to in-memory state for this process — the
    // checkout must not care.
  }
}

/** Fetches the key from Digistore24. `doRecreate` rotates it. */
export async function fetchTestpayState(doRecreate = false): Promise<TestpayState> {
  if (!hasDigistoreApiKey()) {
    throw new Error("no DIGISTORE_API_KEY — run: node run.mjs ds24-connect");
  }
  const res = await ds24Post(
    "getTestpayKey",
    ds24ApiKey(),
    doRecreate ? { do_recreate: "1" } : {},
  );
  const d = res.data ?? {};
  const state: TestpayState = {
    userId: String(d.user_id ?? ""),
    testpayKey: String(d.testpay_key ?? ""),
    paramName: String(d.get_param_name ?? ""),
    expiresAt: String(d.expires_at ?? ""),
    fetchedAt: new Date().toISOString(),
  };
  if (!state.testpayKey || !state.paramName) {
    throw new Error("getTestpayKey returned no key/param name");
  }
  return state;
}

async function loadOrFetch(
  now: Date,
  opts: TestpayOptions,
): Promise<TestpayState | null> {
  const file = opts.stateFile ?? defaultStateFile();

  const cached = await readStateFile(file);
  if (isTestpayFresh(cached, now)) {
    memory = cached;
    return cached;
  }

  if (Date.now() < failedUntil) return null;

  // Single-flight: the plans page resolves all cards in parallel; a cold
  // state must cost ONE API call, not one per card.
  inflight ??= (async () => {
    try {
      const state = await (opts.fetcher ?? fetchTestpayState)();
      memory = state;
      await writeStateFile(file, state);
      return state;
    } catch (err) {
      failedUntil = Date.now() + FAILURE_MEMO_MS;
      console.warn(
        "[testpay] could not fetch the test-payment key — checkout links stay undecorated:",
        err instanceof Error ? err.message : err,
      );
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * The one entry point the checkout uses (lib/digistore/checkout.ts →
 * resolveOne). In DEV it returns the URL carrying the testpay parameter;
 * everywhere else, and on ANY failure, it returns the input unchanged — the
 * checkout degrades, it never breaks.
 */
export async function withTestpayParam(
  url: string,
  opts: TestpayOptions = {},
): Promise<string> {
  try {
    // Belt and braces like the dev login: the gate is checked here at runtime,
    // not only where the caller was wired up.
    if (!isTestpayActive()) return url;

    const now = opts.now ?? new Date();
    const state =
      memory && isTestpayFresh(memory, now)
        ? memory
        : await loadOrFetch(now, opts);
    if (!state) return url;
    const decorated = decorateCheckoutUrl(url, state.paramName, state.testpayKey);
    if (decorated === url) warnUndecorated(url);
    return decorated;
  } catch (err) {
    console.warn("[testpay] disabled for this request:", err);
    return url;
  }
}
