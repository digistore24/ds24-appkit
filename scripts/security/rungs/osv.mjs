// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Rung 2 — a SECOND advisory database over the versions this app resolved.
//
// The npm rung asks npm. This one asks OSV.dev about the same tree, because two
// databases are not one database asked twice: npm's audit endpoint is fed by the
// GitHub Advisory Database, OSV aggregates that AND several others, and it
// regularly knows about something before npm publishes it. A hole that npm has
// not published yet is exactly the one nobody hears about.
//
// ── Why this is a rung of its own and not a question inside the first ───────
//
// A rung has exactly ONE state. Folding OSV into the advisory rung would mean an
// OSV outage turns npm's perfectly good answer into a skip, and an npm outage
// hides OSV's findings. Two questions, two rungs — and then two skips with two
// reasons on a machine with no network at all, which is what an operator needs
// in order to know what was actually asked.
//
// ── What leaves this machine ───────────────────────────────────────────────
//
// The NAMES and VERSIONS of this app's dependencies, and nothing else. No app
// name, no domain, no `APP_URL`, no identifier, nothing about a customer,
// nothing anybody typed. Two things are true and are said in CLAUDE.md rather
// than only here: a PRIVATE package's name would travel with the rest, and
// api.osv.dev learns that some IP asked about a dependency tree.
//
// ── What it needs ──────────────────────────────────────────────────────────
//
// `fetch()`. No account, no API key, no npm package, no installed tool, and not
// even a `node_modules` — it reads `package-lock.json`, which is the record of
// what WOULD be installed. That is the whole of tier 1.
//
// ── Measured against the real API, 2026-08-10 (Node v22.22.1) ──────────────
//
//   * one POST /v1/querybatch carrying all 659 distinct name@version pairs of
//     this tree: HTTP 200 in ~1.1 s, `results.length === 659`, top-level keys
//     `results` only, no paging token. So chunking is precaution rather than
//     necessity (OSV documents a 1000-query cap; 500 leaves headroom).
//   * a package with nothing known comes back as the EMPTY OBJECT `{}` — not
//     `{"vulns": []}`. Parse for `result.vulns?.length`, never for the key.
//   * a package with something known comes back as ids only — no severity, no
//     summary. The severity is in GET /v1/vulns/<id>, under
//     `database_specific.severity`, and that is the request that costs. It is
//     paid ONLY for ids that actually came back, so a clean tree pays nothing.
//   * lodash@4.17.11 answers with 7 ids in one batch — which is why findings are
//     collapsed per advisory id and never per package path.
//
// Plain Node, no dependency — Linux, macOS and Git Bash on Windows. Every
// request is `fetch()` with an `AbortSignal.timeout(…)`; the one npm call goes
// through `capture()`. Nothing here runs at import time.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { acceptedIds } from "../accepted.mjs";
import { auditIds, whereOf } from "../npm-audit.mjs";
import { partitionAccepted } from "../rules.mjs";

const SOURCE = "OSV.dev";

/** The API. One host, two endpoints, no key. */
const OSV_BASE = "https://api.osv.dev";
const BATCH_PATH = "/v1/querybatch";
const VULN_PATH = "/v1/vulns";

/** OSV documents a 1000-query cap on a batch. 500 leaves headroom. */
const BATCH_SIZE = 500;

/**
 * How far a paged chunk is followed before the answer is called incomplete.
 *
 * Measured: this tree needs zero pages. The bound exists so a server that keeps
 * handing back a token cannot spin, and reaching it is the AC5 incomplete case —
 * never a silent truncation.
 */
const MAX_PAGES = 10;

const BATCH_TIMEOUT_MS = 20_000;
const DETAIL_TIMEOUT_MS = 10_000;

/** How many detail lookups are in flight at once. */
const DETAIL_CONCURRENCY = 8;

// ── the pure half ───────────────────────────────────────────────────────────

/**
 * A refusal this file produced itself, carrying the sentence it wants reported.
 *
 * A plain `new Error("HTTP 503")` reads back as "Error: HTTP 503", which names
 * no tool and no endpoint. The transport's own failures (DNS, a refused
 * connection, a timeout, a body that does not parse) keep their `name: message`
 * because that is where the diagnosis is.
 */
const refusal = (text) => Object.assign(new Error(text), { transport: text });

/**
 * One line naming a TOOL or an endpoint — never a person, never anything typed.
 * @param {any} error
 * @returns {string}
 */
export function reasonOf(error) {
  if (error?.transport) return String(error.transport);
  const name = String(error?.name ?? "").trim();
  const message = String(error?.message ?? "").trim();
  if (name && message) return `${name}: ${message}`;
  return message || name || "the request failed without saying why";
}

/**
 * Every distinct `name@version` in a `package-lock.json`, with its half of the
 * tree.
 *
 * Four kinds of entry are dropped, and each for its own reason:
 *
 *   ""              the root project. It is this app, not a dependency.
 *   link: true      a workspace symlink. Its version lives on the real entry.
 *   no version      nothing resolved, so there is nothing to ask about.
 *   no node_modules/ segment in the key — a workspace package's own folder.
 *                   The package NAME is the last `node_modules/` segment, and an
 *                   entry that has none has no package name to take; `packages/foo`
 *                   is a path, and OSV has nothing under it.
 *
 * 🚨 `devOptional` counts as PRODUCTION tree, and so does anything that is not
 * literally `dev: true` — the safe direction, because such a package may be
 * installed in a production tree elsewhere. The same partition
 * `npm audit --omit=dev` applies, which is exactly why the two rungs cannot
 * disagree about one package. A name@version that occurs both ways is production.
 *
 * @param {any} lock
 * @returns {{name: string, version: string, dev: boolean}[]}
 */
export function lockfileQueries(lock) {
  const seen = new Map();
  for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
    if (key === "") continue;
    if (entry?.link === true) continue;
    const version = entry?.version;
    if (typeof version !== "string" || !version.trim()) continue;
    if (!key.includes("node_modules/")) continue;
    const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
    if (!name) continue;
    const dev = entry?.dev === true;
    const id = `${name}@${version}`;
    const found = seen.get(id);
    if (!found) seen.set(id, { name, version, dev });
    else if (!dev) found.dev = false;
  }
  return [...seen.values()];
}

/**
 * `list` in pieces of at most `size`. A size below one would never terminate.
 * @template T
 * @param {T[]} list
 * @param {number} size
 * @returns {T[][]}
 */
export function chunk(list, size) {
  const step = Math.max(1, Math.floor(Number(size) || 0));
  const out = [];
  for (let index = 0; index < (list?.length ?? 0); index += step) {
    out.push(list.slice(index, index + step));
  }
  return out;
}

/**
 * Has npm already reported this advisory?
 *
 * The match is on the id **or any of OSV's `aliases`**: npm keys on GHSA ids
 * while OSV may answer with a `CVE-…`, `MAL-…` or `GO-…` id for the same thing,
 * and a report that lists one finding twice under two names is a report an
 * operator learns to stop reading.
 *
 * ⚠️ An empty set means npm reported nothing — which is a real answer and
 * excludes nothing. Whether npm could answer AT ALL is a separate value the
 * caller holds; this function never has to guess it.
 *
 * @param {any} vuln
 * @param {Set<string> | string[]} [npmIds]
 * @returns {boolean}
 */
export function excluded(vuln, npmIds) {
  const known = npmIds instanceof Set ? npmIds : new Set(npmIds ?? []);
  if (known.size === 0) return false;
  if (vuln?.id && known.has(String(vuln.id))) return true;
  return (vuln?.aliases ?? []).some((alias) => known.has(String(alias)));
}

/**
 * Every fixed version OSV names for an advisory, in order.
 * @param {any} vuln
 * @returns {string[]}
 */
export function fixedVersions(vuln) {
  const out = new Set();
  for (const affected of vuln?.affected ?? []) {
    for (const range of affected?.ranges ?? []) {
      for (const event of range?.events ?? []) {
        if (event?.fixed) out.add(String(event.fixed));
      }
    }
  }
  return [...out].sort();
}

/**
 * One OSV advisory, rated and written out as a finding.
 *
 * 🚨 The rating is about the CONDITION, not about the vendor's adjective — the
 * same rule `advisories.mjs` already carries. Anything in the production tree is
 * ❌ HIGH whatever OSV calls it, because it runs on a request from a visitor;
 * 🚨 CRITICAL is reserved for what OSV's own `database_specific.severity` calls
 * critical. Anything dev-only is ⚠️ MEDIUM whatever OSV calls it, because it does
 * not ship — a dev-only linting advisory rated like a hole in the request path
 * teaches an operator to ignore the whole report.
 *
 * `detailFetched: false` is the case where GET /v1/vulns/<id> did not answer.
 * The finding is still reported — losing it because the second request failed
 * would be the one failure this whole command exists to prevent — and it is
 * rated on the lockfile half alone, with the `Evidence:` line saying so.
 *
 * 🚨 `npmAnswered: false` is the same rule applied to the OTHER unverified
 * claim. This rung reports what npm did NOT report, and that sentence is only
 * true when npm was reachable. When it was not, the finding is still reported —
 * and it says the exclusivity is UNKNOWN rather than asserting it. A claim
 * nobody checked is never made, silently or otherwise.
 *
 * @param {any} vuln
 * @param {{dev?: boolean, packages?: string[], detailFetched?: boolean, npmAnswered?: boolean}} [options]
 * @returns {import("../rules.mjs").Finding}
 */
export function rateOsv(
  vuln,
  { dev = false, packages = [], detailFetched = true, npmAnswered = true } = {},
) {
  const id = String(vuln?.id ?? "");
  const critical = String(vuln?.database_specific?.severity ?? "").toUpperCase() === "CRITICAL";
  const fixed = fixedVersions(vuln);
  const where = whereOf({ id, packages: new Set(packages) });
  const versus = npmAnswered
    ? " npm's own audit did not report it — OSV.dev knows about it."
    : " npm's own audit could not be reached on this run, so whether it reports this too is unknown.";
  const evidence =
    `${SOURCE} reported it for ${packages.length} resolved package version(s) in this tree` +
    (detailFetched
      ? `, OSV severity "${vuln?.database_specific?.severity ?? "unrated"}".`
      : ". The detail lookup for this id did not answer, so it is rated on the lockfile alone.");

  if (dev) {
    return {
      severity: "medium",
      title: vuln?.summary || `Known advisory ${id}`,
      where,
      why:
        "It sits in the development dependencies only, so nothing a customer loads " +
        "runs it. It is real for whoever builds here and it is not a launch blocker." +
        versus,
      fix: fixed.length
        ? `OSV names a fixed version (${fixed.join(", ")}). Update if the update is cheap, ` +
          "or accept it by its id in scripts/security/accepted.mjs with the reason written " +
          "out. An id with no reason reads as an arbitrary exemption to whoever finds it next."
        : "OSV names no fixed version yet. Judge it: accept it by its id in " +
          "scripts/security/accepted.mjs with the reason written out, and take the entry " +
          "out when it stops being true.",
      evidence,
      source: SOURCE,
      id,
    };
  }

  return {
    severity: critical ? "critical" : "high",
    title: vuln?.summary || `Known advisory ${id}`,
    where,
    why:
      "This package is in what your app SHIPS, so it runs on a request from a " +
      "visitor. A known hole there is reachable by anybody who can reach the app." +
      versus,
    fix: fixed.length
      ? `OSV names a fixed version (${fixed.join(", ")}). Update the package or override ` +
        "the transitive dependency in package.json, then `node run.mjs test` — an update " +
        "that breaks the build is not a fix."
      : "OSV names no fixed version yet. Pin or replace the package, or override the " +
        "transitive dependency in package.json; the order to do it in is in " +
        ".claude/skills/security-gateway/references/checks-secrets-and-deps.md.",
    evidence,
    source: SOURCE,
    id,
  };
}

// ── the half that talks ─────────────────────────────────────────────────────

/** One batch question. A non-200 and a body that does not parse both throw. */
async function postQueries(queries) {
  const response = await fetch(`${OSV_BASE}${BATCH_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ queries }),
    signal: AbortSignal.timeout(BATCH_TIMEOUT_MS),
  });
  if (!response.ok) throw refusal(`api.osv.dev answered HTTP ${response.status}`);
  return response.json();
}

/** One advisory in full. Same two refusals. */
async function getVuln(id) {
  const response = await fetch(`${OSV_BASE}${VULN_PATH}/${encodeURIComponent(id)}`, {
    signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS),
  });
  if (!response.ok) throw refusal(`api.osv.dev answered HTTP ${response.status} for ${id}`);
  return response.json();
}

/**
 * Ask OSV about every entry, chunk by chunk, following pages.
 *
 * Chunks run one after another rather than in parallel: one batch already
 * answers a whole tree in about a second, so concurrency here buys nothing and
 * costs a stranger's rate limit.
 *
 * The answer says what came back AND what did not. `incomplete` is the field
 * that stops a half-finished run from ever reading as clean.
 */
async function askOsv(entries, { post = postQueries } = {}) {
  const idsFor = entries.map(() => new Set());
  const problems = [];
  let unanswered = 0;
  let truncated = false;
  let batches = 0;

  const indexed = entries.map((entry, index) => ({ entry, index }));

  for (const group of chunk(indexed, BATCH_SIZE)) {
    let pending = group.map(({ entry, index }) => ({
      index,
      query: { package: { name: entry.name, ecosystem: "npm" }, version: entry.version },
      token: "",
    }));

    for (let page = 0; pending.length > 0; page += 1) {
      if (page >= MAX_PAGES) {
        truncated = true;
        unanswered += pending.length;
        break;
      }
      let body;
      try {
        batches += 1;
        body = await post(
          pending.map((item) => (item.token ? { ...item.query, page_token: item.token } : item.query)),
        );
      } catch (error) {
        problems.push(reasonOf(error));
        unanswered += pending.length;
        break;
      }

      const results = Array.isArray(body?.results) ? body.results : [];
      if (results.length !== pending.length) {
        problems.push(
          `api.osv.dev answered ${results.length} result(s) for ${pending.length} quer(ies)`,
        );
        unanswered += Math.max(0, pending.length - results.length);
      }
      // Measured: this API pages per RESULT, and this tree never pages at all.
      // A top-level token is honoured too, so a server that grows one is followed
      // rather than silently truncated.
      const topToken = typeof body?.next_page_token === "string" ? body.next_page_token : "";
      const next = [];
      pending.forEach((item, at) => {
        const result = results[at];
        // A package with nothing known is the EMPTY OBJECT — never `{vulns: []}`.
        for (const vuln of result?.vulns ?? []) {
          if (vuln?.id) idsFor[item.index].add(String(vuln.id));
        }
        const token = result?.next_page_token ?? topToken;
        if (token) next.push({ ...item, token: String(token) });
      });
      pending = next;
    }
  }

  return { idsFor, problems, unanswered, truncated, batches, asked: entries.length };
}

/** Every advisory in full, distinct ids only, a few at a time. */
async function detailsFor(ids, { get = getVuln } = {}) {
  const details = new Map();
  let cursor = 0;
  const worker = async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      try {
        details.set(id, await get(id));
      } catch {
        // Deliberately swallowed here and NOT lost: the finding is still built,
        // rated on the lockfile half alone, and its evidence says the detail
        // could not be fetched.
        details.set(id, null);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, ids.length) }, worker));
  return details;
}

// ── the rung ────────────────────────────────────────────────────────────────

/** @type {import("../rules.mjs").Rung} */
export const osv = {
  id: "osv",
  label: "Known advisories (OSV.dev)",
  // Tier 1: nothing to install. `fetch()` is Node's own, and the lockfile is
  // in the repository — this rung answers on a tree nobody has installed.
  tier: 1,
  covers:
    "advisories OSV.dev knows about the versions this app resolved — a second database, " +
    "which regularly knows earlier than npm's",

  async run({ root } = {}) {
    const cwd = root ?? process.cwd();
    const lockPath = join(cwd, "package-lock.json");
    if (!existsSync(lockPath)) {
      // The missing lockfile is somebody else's finding, never this rung's: this
      // one asks a database about resolved versions, and there are none.
      return {
        state: "skipped",
        reason: "there is no package-lock.json here, so no resolved versions to ask about",
        findings: [],
      };
    }
    let lock;
    try {
      lock = JSON.parse(readFileSync(lockPath, "utf8"));
    } catch (error) {
      return {
        state: "skipped",
        reason: `package-lock.json could not be read (${String(error?.name ?? "error")})`,
        findings: [],
      };
    }

    const entries = lockfileQueries(lock);
    if (entries.length === 0) {
      return {
        state: "skipped",
        reason: "package-lock.json resolved no package versions to ask about",
        findings: [],
      };
    }

    const answer = await askOsv(entries);

    // id → the packages it reaches in THIS tree, and whether ALL of them are
    // dev-only. One finding per advisory id, never one per package path.
    const byId = new Map();
    answer.idsFor.forEach((ids, index) => {
      const entry = entries[index];
      for (const id of ids) {
        const found = byId.get(id) ?? { id, packages: new Set(), dev: true };
        found.packages.add(`${entry.name}@${entry.version}`);
        if (!entry.dev) found.dev = false;
        byId.set(id, found);
      }
    });

    const details = byId.size > 0 ? await detailsFor([...byId.keys()]) : new Map();
    let missingDetails = 0;
    for (const detail of details.values()) if (!detail) missingDetails += 1;

    // What npm already reported, asked of npm rather than read off the npm
    // rung's outcome — no rung may depend on another's. Not asked at all when
    // OSV came back with nothing, because there is then nothing to exclude.
    // How npm gets asked is not decided here: `auditIds()` takes it from
    // `auditScope()`, which is the npm rung's decision too. This line used to
    // carry a COPY of that condition, put here in Story 30.2 because changing
    // the shipped rung was out of scope then — two copies, one owner each,
    // which is to say none.
    const npm = byId.size > 0 ? await auditIds({ cwd }) : { ids: new Set(), reason: "" };

    const shipping = [];
    const devOnly = [];
    for (const [id, hit] of byId) {
      const detail = details.get(id) ?? null;
      const vuln = detail ?? { id };
      if (excluded(vuln, npm.ids)) continue;
      const finding = rateOsv(vuln, {
        dev: hit.dev,
        packages: [...hit.packages],
        detailFetched: Boolean(detail),
        // Not `npm.ids.size > 0`: npm answering NOTHING is a real answer, and it
        // verifies the exclusivity exactly as a long list would. What makes the
        // claim unverified is npm not answering at all.
        npmAnswered: !npm.reason,
      });
      (hit.dev ? devOnly : shipping).push(finding);
    }

    // The ship-facing half takes NO allowance at all — exactly as for
    // `npm audit --omit=dev`. Only the dev-only half is offered to the accepted set.
    const split = partitionAccepted(devOnly, acceptedIds());
    const findings = [...shipping, ...split.findings];
    const accepted = split.accepted;

    const incomplete = answer.problems.length > 0 || answer.truncated;
    const shortfall = answer.truncated
      ? `${answer.unanswered} quer(ies) hit the ${MAX_PAGES}-page bound`
      : `${answer.unanswered} of ${answer.asked} quer(ies) went unanswered`;
    const why = answer.problems[0] ?? `the ${MAX_PAGES}-page bound was reached`;

    const evidence =
      `POST ${OSV_BASE}${BATCH_PATH} — ${answer.asked} package version(s) in ` +
      `${answer.batches} batch request(s), ${byId.size} advisory id(s) came back` +
      (missingDetails > 0
        ? `; ${missingDetails} detail lookup(s) did not answer, those are rated on the lockfile alone`
        : "") +
      (byId.size === 0
        ? "; nothing came back, so npm's own answer was not asked for and nothing needed excluding"
        : npm.reason
          ? `; npm's own answer was unavailable (${npm.reason}), so nothing could be excluded as already reported`
          : "; what npm's own audit already reports was excluded") +
      (incomplete ? `. ⚠️ INCOMPLETE — ${shortfall}: ${why}` : "");

    // 🚨 A rung that found something must never report `skipped`: `aggregate()`
    // throws a skipped outcome's findings away (rules.mjs), so honesty there
    // would delete a real finding. Say it in the evidence instead — and never
    // say `clean`.
    if (findings.length > 0) return { state: "found", findings, accepted, evidence };
    if (incomplete) {
      return {
        state: "skipped",
        reason: `api.osv.dev did not finish answering — ${shortfall}: ${why}`,
        findings: [],
      };
    }
    return { state: "clean", findings: [], accepted, evidence };
  },
};
