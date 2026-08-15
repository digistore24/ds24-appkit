// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Rung 4 — three FACTS about this app's dependencies, as the public registry
// describes them today.
//
// The advisory rungs ask what is known to be wrong. The signature rung asks
// whether the bytes were swapped. This one asks the question that comes BEFORE
// either of those has an answer: a version published days ago, a package the
// publisher has abandoned, a release pushed by an account that is not on the
// package's list of maintainers. None of the three is wrong on its own — that is
// the whole point, and it is why every one of them is ⚠️ MEDIUM and worded as a
// fact:
//
//   "published 2 days ago (2026-08-08)"   never   "malicious"
//
// A check that shouts is a check somebody mutes in a week, and a muted check is
// worth less than none.
//
// ── What it asks, about what, and what leaves this machine ─────────────────
//
// By DEFAULT the app's **direct** dependencies — the union of `dependencies` and
// `devDependencies` in `package.json`, resolved to the versions in the lockfile.
// `--supply-chain-all` widens it to every distinct `name@version` in the
// lockfile. Measured on this tree, 2026-08-10: 33 direct against 659 distinct
// lockfile entries, two requests each — 66 against 1318, which is both slow and
// rude to public infrastructure answering for nothing.
//
// 🚨 Narrowing is only legitimate because it is SAID OUT LOUD: the evidence line
// names both numbers and the flag that widens it. Green means counted, and the
// reader has to be able to see WHAT was counted — the same doctrine as smoke's
// "9 protected page(s) NOT checked" being explicitly not a pass. A scope that is
// silently narrow is the failure this whole command is about.
//
// What leaves the machine is the NAMES and VERSIONS of this app's dependencies —
// a private package's name included — and nothing else. No app name, no domain,
// no identifier, nothing about a customer, nothing anybody typed.
//
// ── Where a publish date comes from — measured, including two dead ends ────
//
// The cheap per-version registry document does not carry a publish time. Measured
// 2026-08-10 (Node v22.22.1):
//
//   GET registry.npmjs.org/<name>/<version>      2.4–4.3 KB, 266–361 ms. Carries
//                                                `deprecated`, `_npmUser`,
//                                                `maintainers`. NO time field
//   GET registry.npmjs.org/<name>                zod 3.40 MB, next 29.63 MB. 659
//                                                distinct packages here — not a
//                                                mechanism, a denial of service
//                                                against ourselves
//   …with the abbreviated Accept header          next 24.26 MB, and its keys are
//                                                `name, dist-tags, versions,
//                                                modified` — no `time` at all
//   HEAD <dist.tarball> → Last-Modified          🚨 NOT a publish date.
//                                                zod@3.23.8 answers 2024-05-08,
//                                                which is right; next@15.0.0
//                                                answers **2026-07-22**, and that
//                                                version was published
//                                                2024-10-21. A CDN re-store makes
//                                                a two-year-old release look days
//                                                old — the exact false alarm this
//                                                rung must not produce
//   GET api.deps.dev/v3/systems/npm/packages/…   1.5–2.5 KB, 44–110 ms.
//                                                `publishedAt` is the ISO publish
//                                                time, and it agrees with the big
//                                                packument's own `time` map to the
//                                                second (next@15.0.0:
//                                                2024-10-21T18:22:34Z)
//
// So: the date comes from **deps.dev** (Google's Open Source Insights —
// unauthenticated, no account, no key), and `deprecated` / `_npmUser` /
// `maintainers` come from the npm registry itself. Two hosts, one small request
// each, per entry.
//
// ⚠️ deps.dev is therefore ONE OF TWO SOURCES, and its silence is a PARTIAL
// answer rather than a clean one: the deprecation and publisher facts still
// report, and the rung says the age question went unasked. Never a tick.
//
// ⚠️ The two hosts disagree about scoped names, measured: `%40scope%2Fname`
// answers 200 on both, the unencoded `@scope/name` answers 200 on the npm
// registry and **404 on deps.dev**. So the name is encoded once, for both.
//
// ── The partial rule ───────────────────────────────────────────────────────
//
//   asked N, answered M < N, found nothing    → skipped, naming how many and why
//   asked N, answered M < N, found something  → found, KEEPING the findings, with
//                                               the incompleteness in the evidence
//
// `clean` requires M === N. "Clean" and "nobody asked" must not look the same,
// and a PARTLY asked question is nearer the second. 🚨 The `found` half is not
// politeness: `aggregate()` DISCARDS a skipped outcome's findings, so a rung that
// found something and reported `skipped` would delete a real finding.
//
// Plain Node, no dependency — Linux, macOS and Git Bash on Windows. Every request
// is `fetch()` with an `AbortSignal.timeout(…)`, at a bounded concurrency; no
// process is spawned at all. Nothing here runs at import time.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = "npm registry";
const DATE_SOURCE = "deps.dev";

/** The two public interfaces. No account, no key, no added dependency. */
const REGISTRY_BASE = "https://registry.npmjs.org";
const DEPS_DEV_BASE = "https://api.deps.dev";

/** How many entries are in flight at once. Small on purpose: this is somebody else's infrastructure. */
const CONCURRENCY = 8;

/** Per request. Two hosts, both of which normally answer in well under a second. */
const TIMEOUT_MS = 10_000;

/** How young is "young", unless somebody says otherwise. */
export const DEFAULT_YOUNG_DAYS = 7;

/** The flag that widens the scope from the direct dependencies to the whole lockfile. */
export const ALL_FLAG = "--supply-chain-all";

/** The flag that moves the recency window. */
export const YOUNG_FLAG = "--young-days";

/** How much of a publisher's deprecation sentence is quoted before it is cut. */
const MAX_DEPRECATION_LENGTH = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

// ── the pure half ───────────────────────────────────────────────────────────

/**
 * Every distinct `name@version` in a `package-lock.json`.
 *
 * The four kinds of entry that are dropped, and why each: the root project (it
 * is this app, not a dependency); a workspace symlink (`link: true` — its
 * version lives on the real entry); an entry with no version (nothing resolved,
 * so nothing to ask about); and a key with no `node_modules/` segment (a
 * workspace package's own folder — `packages/foo` is a path, and neither host
 * has anything under it).
 *
 * The same walk `osv.mjs` does, deliberately written out again rather than
 * imported: 🚨 nothing under `rungs/` may import anything else under `rungs/`,
 * because a rung reading another rung's CODE is one step from a rung reading
 * another rung's RESULT — and the ladder exists to deny exactly that.
 *
 * @param {any} lock
 * @returns {{name: string, version: string}[]}
 */
export function allEntries(lock) {
  const seen = new Map();
  for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
    if (key === "") continue;
    if (entry?.link === true) continue;
    const version = entry?.version;
    if (typeof version !== "string" || !version.trim()) continue;
    if (!key.includes("node_modules/")) continue;
    const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
    if (!name) continue;
    const id = `${name}@${version}`;
    if (!seen.has(id)) seen.set(id, { name, version });
  }
  return [...seen.values()];
}

/**
 * This app's OWN dependencies, resolved to the versions the lockfile pinned.
 *
 * The union of `dependencies` and `devDependencies`, because the question here
 * is "what did somebody deliberately add to this app" — and a compromised build
 * tool is every bit as much this app's problem as a compromised runtime library.
 *
 * A declared dependency the lockfile does not resolve is dropped rather than
 * guessed: there is no version to ask about, and asking about the RANGE
 * (`^4.17.21`) would be asking about a package this app may not be running.
 *
 * @param {any} pkg
 * @param {any} lock
 * @returns {{name: string, version: string}[]}
 */
export function directEntries(pkg, lock) {
  const wanted = new Set([
    ...Object.keys(pkg?.dependencies ?? {}),
    ...Object.keys(pkg?.devDependencies ?? {}),
  ]);
  const out = [];
  for (const name of wanted) {
    // The exact top-level key, never a nested copy. `node_modules/foo/node_modules/bar`
    // is a transitive resolution of somebody else's requirement — asking about it
    // under this app's own name would be asking the wrong question, and a scan of
    // `allEntries` would pick whichever of the two the lockfile happens to list
    // first.
    const entry = lock?.packages?.[`node_modules/${name}`];
    if (entry?.link === true) continue;
    const version = entry?.version;
    if (typeof version !== "string" || !version.trim()) continue;
    out.push({ name, version });
  }
  return out;
}

/**
 * The recency window, or the refusal.
 *
 * 🚨 A value that is not a non-negative whole number is a REFUSAL, never a quiet
 * fall back to the default — the `configuredNumber()` doctrine
 * (`lib/cron/rules.mjs`): `Number(null)` is `0`, `Number("")` is `0`, and a
 * number nobody checked is the bug. Somebody who types `--young-days 3O` (with a
 * letter O) has to be told, not silently given seven.
 *
 * Both spellings are read, `--young-days 14` and `--young-days=14`, for the same
 * reason: recognising only one of them would make the other a silent default.
 *
 * @param {string[]} argv
 * @returns {{days: number, error: string}}
 */
export function parseYoungDays(argv) {
  const list = Array.isArray(argv) ? argv.map(String) : [];
  let raw = null;
  for (let index = 0; index < list.length; index += 1) {
    const arg = list[index];
    if (arg === YOUNG_FLAG) {
      raw = index + 1 < list.length ? list[index + 1] : "";
    } else if (arg.startsWith(`${YOUNG_FLAG}=`)) {
      raw = arg.slice(YOUNG_FLAG.length + 1);
    }
  }
  if (raw === null) return { days: DEFAULT_YOUNG_DAYS, error: "" };

  const value = raw.trim();
  const parsed = Number(value);
  if (value === "" || !Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return {
      days: DEFAULT_YOUNG_DAYS,
      error:
        `${YOUNG_FLAG} needs a whole number of days, 0 or more — it was given ` +
        `${JSON.stringify(raw)}. Nothing was asked rather than falling back to ` +
        `${DEFAULT_YOUNG_DAYS}: a window nobody chose is a window nobody can read a result against.`,
    };
  }
  return { days: parsed, error: "" };
}

/** Was the whole lockfile asked for? */
export const wantsAll = (argv) => (Array.isArray(argv) ? argv.map(String) : []).includes(ALL_FLAG);

/** `<name>@<version>` — what locates one of these. */
const whereOfEntry = (entry) => `${entry?.name ?? "?"}@${entry?.version ?? "?"}`;

/** "2 days", "less than a day", "1 day" — how old, in words a person reads. */
function agePhrase(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "no time at all — it is dated in the future";
  const days = Math.floor(ms / DAY_MS);
  if (days === 0) return "less than a day";
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** The date part of an ISO timestamp — what a person compares against a changelog. */
const isoDay = (iso) => String(iso ?? "").slice(0, 10);

/**
 * The resolved version was published inside the recency window — ⚠️ MEDIUM.
 *
 * A FACT about a release, never an accusation about a package. Everything this
 * rung reports is legitimate on its own: packages get published. What the `Why:`
 * says is what the fact would mean IF something else were also true, and the
 * `Fix:` is an act a person can perform — never `npm audit fix`, which fixes
 * none of these.
 *
 * The window edge is decided one way and stated: a release exactly `windowDays`
 * old counts as young (`<=`). A boundary that flips with the second it is read
 * at is a boundary nobody can act on, and the safe direction here is the one
 * that reports rather than the one that stays quiet.
 *
 * @param {{name: string, version: string}} entry
 * @param {string} publishedAt   ISO timestamp from deps.dev
 * @param {number|Date} now
 * @param {number} windowDays
 * @returns {import("../rules.mjs").Finding | null}
 */
export function youngFinding(entry, publishedAt, now, windowDays) {
  const at = Date.parse(String(publishedAt ?? ""));
  if (!Number.isFinite(at)) return null;
  const age = (now instanceof Date ? now.getTime() : Number(now)) - at;
  if (age > windowDays * DAY_MS) return null;

  return {
    severity: "medium",
    title: `Published ${agePhrase(age)} ago (${isoDay(publishedAt)})`,
    where: whereOfEntry(entry),
    why:
      "This is a fact about a release, not a claim about the package: new versions " +
      "are published all the time. It is here because a compromised release is the " +
      "newest one for a while, and nobody has had time to file an advisory about it " +
      "yet — read the changelog before this goes to a customer.",
    fix:
      "Read the release notes and the diff for this version. If you cannot, pin the " +
      "previous version until you can, or ask the maintainer. Widen or narrow what " +
      `counts as new with ${YOUNG_FLAG} <n>.`,
    evidence:
      `${DATE_SOURCE} reports publishedAt ${publishedAt} — ${agePhrase(age)} before this run, ` +
      `inside the ${windowDays}-day window.`,
    source: DATE_SOURCE,
  };
}

/**
 * The package is marked deprecated — ⚠️ MEDIUM.
 *
 * The publisher's own sentence, quoted and bounded, because it is usually the
 * whole answer ("use X instead"). Deprecated is advice, not a defect — it is
 * reported because unmaintained is where an unfixed hole would sit, not because
 * it is one.
 *
 * @param {{name: string, version: string}} entry
 * @param {unknown} text
 * @returns {import("../rules.mjs").Finding | null}
 */
export function deprecatedFinding(entry, text) {
  const said = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (!said) return null;
  const quoted =
    said.length <= MAX_DEPRECATION_LENGTH ? said : `${said.slice(0, MAX_DEPRECATION_LENGTH - 1)}…`;

  return {
    severity: "medium",
    title: "The publisher has marked this version deprecated",
    where: whereOfEntry(entry),
    why:
      "Deprecated means the publisher advises against using it. It does not mean it " +
      "is unsafe — but it usually means nobody is maintaining it, and an unmaintained " +
      "package is where a hole stays unfixed.",
    fix:
      "Read what the publisher says below and move to whatever they name. Staying is " +
      "a legitimate decision; make it deliberately rather than by not noticing.",
    evidence: `${SOURCE} reports deprecated: "${quoted}"`,
    source: SOURCE,
  };
}

/** A name out of `{ name, email }`, a bare string, or nothing. */
const accountName = (value) => {
  if (typeof value === "string") return value.trim();
  const name = value?.name;
  return typeof name === "string" ? name.trim() : "";
};

/**
 * The account that published this version is not among the package's maintainers
 * today — ⚠️ MEDIUM.
 *
 * > **Deviation from the epic, named.** The epic asks for an account that changed
 * > *since the lockfile entry was written*. `package-lock.json` records `version`,
 * > `resolved` and `integrity` and **no publishing account at all**, so that
 * > comparison has no earlier value to compare against, in any app, ever.
 * > Inventing one (a baseline under `.dev/`) would make the first run blind and
 * > the answer machine-local. The nearest fact that CAN be measured, from the
 * > same single response, is this one — the shape a takeover or a handover
 * > actually leaves behind.
 *
 * Two silences on purpose. No `_npmUser` at all means there is nothing to
 * compare; an empty maintainer list means there is nothing to compare AGAINST,
 * and "not among an empty list" is true of everybody. Either way this returns
 * `null` — a fact that could not be established is not reported as one.
 *
 * 🚨 **And a third, which the plain comparison gets exactly backwards.** npm's
 * TRUSTED PUBLISHING (OIDC) puts the CI identity in `_npmUser` — measured
 * 2026-08-10, `{"name":"GitHub Actions","email":"npm-oidc-no-reply@github.com",
 * "trustedPublisher":{"id":"github",…}}` — and that account is by construction
 * never in `maintainers`. So the naive comparison fires on **every** package
 * published the most secure way there is: on this tree, 4 of 33 direct
 * dependencies, all of them `GitHub Actions`, none of them a handover. That is
 * the same failure as `Last-Modified` in the publish-date table above — a value
 * that means something else than it looks like it means — and a rung that shouts
 * about `next`, `vitest`, `tailwindcss` and `postcss` on every run is one
 * somebody mutes in a week.
 *
 * The marker is structural and it is in the SAME response, so it costs no second
 * request: when `trustedPublisher` is there, the human to compare is `approver`
 * — the maintainer who authorised the release, which npm supplies where there is
 * one. An approver outside the list is the takeover shape and is reported; a CI
 * release the maintainers configured with nobody approving it is not a fact
 * about a changed account at all, and is silent.
 *
 * @param {{name: string, version: string}} entry
 * @param {unknown} npmUser
 * @param {unknown[]} maintainers
 * @returns {import("../rules.mjs").Finding | null}
 */
export function publisherFinding(entry, npmUser, maintainers) {
  const today = (Array.isArray(maintainers) ? maintainers : []).map(accountName).filter(Boolean);
  if (today.length === 0) return null;

  const trusted = npmUser && typeof npmUser === "object" ? npmUser.trustedPublisher : null;
  const publisher = trusted ? accountName(npmUser?.approver) : accountName(npmUser);
  if (!publisher) return null;
  if (today.includes(publisher)) return null;

  const how = trusted
    ? `${SOURCE} reports this version was published through trusted publishing ` +
      `(${accountName(npmUser) || "a CI identity"}) and approved by "${publisher}"`
    : `${SOURCE} reports _npmUser "${publisher}"`;

  return {
    severity: "medium",
    title: `Published by \`${publisher}\`, which is not among this package's maintainers today`,
    where: whereOfEntry(entry),
    why:
      "That is what a handover looks like. It is also what a takeover looks like, and " +
      "from one response nothing can tell the two apart — this is a fact about two " +
      "lists, not a claim about that account. A maintainer who has since left is the " +
      "ordinary explanation.",
    fix:
      "Check the package's repository for who publishes it now, and read the release " +
      "this version came from. Where the answer is not obvious, pin the previous " +
      "version until it is.",
    evidence: `${how}; maintainers today: ${today.join(", ")}.`,
    source: SOURCE,
  };
}

// ── the half that talks ─────────────────────────────────────────────────────

/**
 * A refusal this file produced itself, carrying the sentence it wants reported.
 *
 * A plain `new Error("HTTP 429")` reads back as "Error: HTTP 429", which names
 * no host — and 🚨 a `429` has to be named as a `429`: "the registry rate-limited
 * this run" and "the registry did not answer" are different sentences, and an
 * operator does different things about them.
 */
const refusal = (text, { rateLimited = false } = {}) =>
  Object.assign(new Error(text), { transport: text, rateLimited });

/**
 * One line naming a HOST — never a person, never anything typed.
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
 * One GET, as JSON, or a refusal that names the host and the status.
 *
 * A 404 is an ANSWER, not a refusal: a private package the public registry has
 * never heard of is a perfectly ordinary state of affairs, and turning it into a
 * failure would make every app with one report incomplete for ever. It comes back
 * as `null`, which every fact-builder above treats as "nothing to say".
 */
async function getJson(url, host) {
  let response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // ⚠️ The transport's own sentence is "TypeError: fetch failed" — measured,
    // against a refused connection. It names no host, and this rung asks TWO of
    // them: an operator reading that cannot tell whether the registry or the
    // publish-date service is the one that is down, which is the first thing
    // they would do something about. So the host is put in front and the
    // transport's own words are kept behind it, where the diagnosis is.
    throw refusal(`${host} did not answer (${reasonOf(error)})`);
  }
  if (response.status === 404) return null;
  if (response.status === 429) {
    throw refusal(`${host} rate-limited this run (HTTP 429)`, { rateLimited: true });
  }
  if (!response.ok) throw refusal(`${host} answered HTTP ${response.status}`);
  return response.json();
}

/** The abbreviated per-version document: `deprecated`, `_npmUser`, `maintainers`. */
const registryUrl = (entry) =>
  `${REGISTRY_BASE}/${encodeURIComponent(entry.name)}/${encodeURIComponent(entry.version)}`;

/** The publish time, and nothing else this rung needs. */
const depsDevUrl = (entry) =>
  `${DEPS_DEV_BASE}/v3/systems/npm/packages/${encodeURIComponent(entry.name)}/versions/${encodeURIComponent(entry.version)}`;

/**
 * Ask both hosts about every entry, a few at a time.
 *
 * The two questions are kept apart in the answer — `registryOk` and `dateOk` —
 * because they come from two hosts and either can be down while the other is
 * fine. That is what makes "the age question went unasked" a sentence this rung
 * can actually say, instead of one blanket "something went wrong".
 */
async function askAbout(
  entries,
  { registry = (entry) => getJson(registryUrl(entry), "registry.npmjs.org"),
    dates = (entry) => getJson(depsDevUrl(entry), "api.deps.dev") } = {},
) {
  const answers = new Array(entries.length).fill(null);
  const problems = [];
  let registryOk = 0;
  let dateOk = 0;
  /** HTTP 404 — the service answered, and its answer is "I do not know this". */
  let notFound = 0;
  let rateLimited = false;

  const note = (error) => {
    const reason = reasonOf(error);
    if (error?.rateLimited) rateLimited = true;
    if (!problems.includes(reason)) problems.push(reason);
  };

  let cursor = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      const index = cursor++;
      const entry = entries[index];
      const answer = { entry, doc: null, publishedAt: "" };

      // 🚨 `getJson()` answers `null` on HTTP 404 rather than throwing, so a
      // package the service does not know about used to count as ANSWERED —
      // `complete` then meant "nothing threw", not "everything replied", and the
      // evidence read `0 of N lookup(s) went unanswered` over exactly the
      // packages nobody outside can check (private, internal, a version the
      // index has not seen). `youngFinding()` fell out quietly on the empty
      // date. A 404 is a partial answer, and 30.3 AC5 says a partial answer is
      // never a clean pass.
      try {
        answer.doc = await registry(entry);
        if (answer.doc === null) notFound += 1;
        else registryOk += 1;
      } catch (error) {
        note(error);
      }
      try {
        const dated = await dates(entry);
        if (dated === null) {
          notFound += 1;
        } else {
          answer.publishedAt = typeof dated?.publishedAt === "string" ? dated.publishedAt : "";
          dateOk += 1;
        }
      } catch (error) {
        note(error);
      }

      answers[index] = answer;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));

  return { answers, problems, registryOk, dateOk, notFound, rateLimited, asked: entries.length };
}

// ── the rung ────────────────────────────────────────────────────────────────

/** @type {import("../rules.mjs").Rung} */
export const registry = {
  id: "registry",
  label: "The supply chain no advisory covers yet (public registry)",
  // Tier 1: nothing to install. `fetch()` is Node's own, both hosts answer
  // unauthenticated, and the lockfile is in the repository — this rung answers on
  // a tree nobody has installed.
  tier: 1,
  covers:
    "how young, how deprecated and how differently-published this app's dependencies are, " +
    "as the public registry describes them today",

  async run({ root, argv } = {}) {
    const cwd = root ?? process.cwd();
    const flags = argv ?? [];

    // The refusal comes FIRST, before a single request: a run whose window
    // nobody chose is a run whose result nobody can read, so there is nothing
    // worth asking two public hosts about.
    const window = parseYoungDays(flags);
    if (window.error) return { state: "skipped", reason: window.error, findings: [] };

    const lockPath = join(cwd, "package-lock.json");
    if (!existsSync(lockPath)) {
      // A missing lockfile is somebody else's finding, never this rung's: this
      // one asks about resolved versions, and there are none.
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

    const all = allEntries(lock);
    const everything = wantsAll(flags);
    let entries = all;
    let scope = `${all.length} lockfile entr${all.length === 1 ? "y" : "ies"} asked; ` +
      `0 deliberately not asked (${ALL_FLAG})`;

    if (!everything) {
      let pkg = null;
      try {
        pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
      } catch (error) {
        return {
          state: "skipped",
          reason:
            `package.json could not be read (${String(error?.name ?? "error")}), so this app's ` +
            `own dependencies could not be told apart from the whole tree — ${ALL_FLAG} asks about all of them`,
          findings: [],
        };
      }
      entries = directEntries(pkg, lock);
      const rest = all.length - entries.length;
      scope =
        `${entries.length} direct dependenc${entries.length === 1 ? "y" : "ies"} asked; ` +
        `${rest} transitive entr${rest === 1 ? "y" : "ies"} not asked (${ALL_FLAG} asks them all)`;
    }

    if (entries.length === 0) {
      return {
        state: "skipped",
        // Same distinction as `osv.mjs` — see the note there. A v1 lockfile has
        // no `packages` map, and "nothing to ask" is not what happened.
        reason:
          Number(lock?.lockfileVersion) < 2
            ? `package-lock.json is lockfileVersion ${lock.lockfileVersion}, which carries no ` +
              "`packages` map — run `npm install` once with npm 7 or newer to rewrite it"
            : `package-lock.json resolved no package versions to ask about (${scope})`,
        findings: [],
      };
    }

    const answer = await askAbout(entries);
    const now = Date.now();

    const findings = [];
    for (const { entry, doc, publishedAt } of answer.answers) {
      const young = youngFinding(entry, publishedAt, now, window.days);
      if (young) findings.push(young);
      const deprecated = deprecatedFinding(entry, doc?.deprecated);
      if (deprecated) findings.push(deprecated);
      const publisher = publisherFinding(entry, doc?._npmUser, doc?.maintainers);
      if (publisher) findings.push(publisher);
    }

    // Two questions, two hosts, two counts — and either shortfall makes the
    // answer partial. 🚨 `clean` requires both to be whole.
    const complete = answer.registryOk === answer.asked && answer.dateOk === answer.asked;
    const shortfall =
      `${answer.asked - answer.registryOk} of ${answer.asked} deprecation/publisher lookup(s) ` +
      `and ${answer.asked - answer.dateOk} of ${answer.asked} publish-date lookup(s) went unanswered`;
    // A 429 is named as a 429 and named FIRST: an operator waits it out, where an
    // unreachable host is something they go and look at.
    const why = answer.rateLimited
      ? (answer.problems.find((problem) => problem.includes("429")) ?? answer.problems[0])
      : (answer.problems[0] ??
        (answer.notFound > 0
          ? `${answer.notFound} lookup(s) came back 404 — the service does not know that ` +
            "package or version (a private or internal one looks exactly like this)"
          : "the requests did not all come back"));

    const evidence =
      `GET ${REGISTRY_BASE}/<name>/<version> and ${DEPS_DEV_BASE}/v3/… per entry, ` +
      `${CONCURRENCY} at a time — ${scope}` +
      (complete
        ? "."
        : `. ⚠️ INCOMPLETE — ${shortfall}: ${why}. What is below is what came back, not the whole answer.`);

    // 🚨 A rung that found something must never report `skipped`: `aggregate()`
    // throws a skipped outcome's findings away (rules.mjs), so honesty there
    // would delete a real finding. Say it in the evidence instead — and never
    // say `clean`.
    if (findings.length > 0) return { state: "found", findings, evidence };
    if (!complete) {
      return {
        state: "skipped",
        reason: `the public registry did not finish answering — ${shortfall}: ${why}`,
        findings: [],
      };
    }
    return { state: "clean", findings: [], evidence };
  },
};
