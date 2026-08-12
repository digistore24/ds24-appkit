// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Rung 3 — do the packages installed here still carry the signature the
// registry published them with?
//
// The two advisory rungs ask what is KNOWN to be wrong. This one asks something
// no advisory database can answer yet: whether the bytes on this machine are the
// bytes the registry signed. A package that was swapped an hour ago has no
// advisory, no CVE and no GHSA id — it has a broken signature, and that is the
// only thing about it that is measurable today.
//
// ── What it runs, and what the answer looks like ───────────────────────────
//
//   npm audit signatures --json
//
// Measured on this tree, 2026-08-10, Node v22.22.1, npm 9.2.0, and read out of
// npm's own source (`lib/commands/audit.js`):
//
//   the success shape (:65-71)   {"invalid":[…],"missing":[…]} and nothing else
//   an entry (:323-333)          { name, version, location, resolved, integrity,
//                                  signature, keyid }
//   the exit code (:60-63)       1 when either list is non-empty, 0 when both are
//   `missing` (:283-295)         the registry publishes signing keys for this
//                                package and the tarball carries no signature
//   `invalid` (:298-311)         EINTEGRITYSIGNATURE — npm's own human output says
//                                "Someone might have tampered with this package
//                                 since it was published on the registry!"
//
// 🚨 **There is no verified COUNT in the `--json` answer.** `verifiedCount` is
// rendered in the HUMAN output only (:81-88). So this rung never prints one — a
// number that was not measured is how a report starts lying quietly, and "N
// packages verified" is exactly the number a reader would trust most.
//
// ── "Clean" and "could not look" are not the same answer ───────────────────
//
// Exit 1 means three different things here — something was found, nothing could
// be verified at all, or npm failed — so the exit code cannot be the
// discriminator, exactly as it could not be for `npm audit`. The structural one,
// mirroring `auditReportVersion` in `../npm-audit.mjs`, is the presence of BOTH
// arrays. Everything else is a skip with its own sentence:
//
//   code 127                     npm is not on this machine's PATH
//   a network error CODE         the registry did not answer — the network here
//   EEXPIREDSIGNATUREKEY         the registry answered; THIS npm is too old
//   {"error":{"summary":…}}      npm's own sentence, verbatim
//   an unknown subcommand        an npm too old to know `audit signatures`
//   anything else                the first line of stderr, else the exit code
//
// Three of those were really produced on this tree, and they are why the
// discriminator is structural rather than a match on npm's wording:
//
//   node_modules empty   {"error":{"code":null,"summary":"found no dependencies to
//                        audit that where installed from a supported registry"}}
//   node_modules full    {"error":{"code":"EEXPIREDSIGNATUREKEY","summary":
//                        "…has a registry signature with keyid: SHA256:… but the
//                        corresponding public key has expired 2025-01-29…"}}
//   --registry 127.0.0.1 {"error":{"code":"ECONNREFUSED","summary":"FetchError:
//                        request to …/-/npm/v1/keys failed, reason: connect …"}}
//
// 🚨 **The middle one is a fact about the npm running this, and for a year it was
// read as a fact about the registry.** Measured on this tree on 2026-08-12, one
// install, one afternoon, four npms:
//
//   npm 9.2.0   EEXPIREDSIGNATUREKEY        npm 10.9.9  {"invalid":[],"missing":[]}
//   npm 9.9.4   EEXPIREDSIGNATUREKEY        npm 11.x    {"invalid":[],"missing":[]}
//
// and `GET https://registry.npmjs.org/-/npm/v1/keys` returns TWO keys — the one
// npm names (`SHA256:jl3bws…`, `"expires":"2025-01-29T00:00:00.000Z"`) and a
// current one (`SHA256:DhQ8wR…`, `"expires":null`). So the registry is healthy:
// it ROTATED. Tarballs published before the rotation still carry a signature made
// with the retired key, and npm 9 rejects any signature whose key is past its
// `expires` — where npm 10 accepts one that was made while the key was valid.
// `pMap(…, { stopOnError: true })` (:47) then gives up on the whole tree over the
// first such package, which is why the summary names an innocent one.
//
// The rung's job is therefore NOT to decide whether the world is broken. It is to
// say WHICH of three things happened, because an operator does something
// different about each — and this one has an act: `npm install -g npm@latest`.
// Every other skip in this ladder already names its act (`brew install gitleaks`,
// `docker pull aquasec/trivy`, "no --url was given"); this rung was the one that
// pasted npm's sentence about a package nobody needs to look at and named none.
//
// ⚠️ It stays a **skip** and the record stays `complete: false`. Nothing was
// verified, so nothing may be reported as verified — and a permanent
// `complete: false` is an argued property of this ladder, not a defect:
// `./drift.mjs` says the same about a machine that is offline for ever.
//
// Plain Node, no dependency — Linux, macOS and Git Bash on Windows. npm is
// started through `capture()`, never a shell, because on Windows npm is a `.cmd`
// shim and `spawnCommand()` is the only thing in this project allowed to know
// that. Nothing here runs at import time.


import { capture } from "../../lib/proc.mjs";
import { hasInstalledTree } from "../npm-audit.mjs";

const SOURCE = "npm audit signatures";

/** The command, spelled out once so the evidence and the findings agree. */
const COMMAND = "npm audit signatures --json";

// ── the pure half ───────────────────────────────────────────────────────────

/** The first line of a stream that has anything on it. */
const firstLine = (text) =>
  (String(text ?? "")
    .split(/\r?\n/)
    .find((line) => line.trim()) ?? "").trim();

/**
 * Does this npm know the subcommand at all?
 *
 * `npm audit signatures` arrived in npm 8.13. An older npm answers with a usage
 * block or an "unknown command", which is a different problem from a registry
 * that did not answer: one is fixed by installing something, the other by
 * waiting. Matched loosely on purpose — the wording has changed across npm
 * majors and the alternative is reporting a version problem as a mystery.
 */
function looksUnsupported(answer) {
  const text = `${answer?.stdout ?? ""}\n${answer?.stderr ?? ""}`;
  if (/unknown\s+(sub)?command/i.test(text)) return true;
  return /usage:\s*npm audit/i.test(text) && !/signatures/i.test(answer?.stdout ?? "");
}

/** A leading `name@version` or `@scope/name@version`, and the space after it. */
const LEADING_SPECIFIER = /^(?:@[^/\s]+\/)?[^\s@][^\s]*@[^\s]+\s+/;

/**
 * npm's own sentence, with the package it happens to name taken out of it.
 *
 * 🚨 Two reasons, and the second is the sharper one.
 *
 * The record (`rules.mjs` → `recordFrom`) is numbers and rung states and
 * deliberately nothing else — no finding's title, path, package name or
 * evidence — because that shape has to be able to travel into a scheduled job's
 * one line. A skip's reason travels with it, and npm's summary would have
 * carried a package name straight into it.
 *
 * And the name would have been misleading anyway. npm verifies twenty packages
 * at a time and gives up on the whole tree at the first error
 * (`pMap(…, { stopOnError: true })`), so the package in the summary is whichever
 * of the parallel checks failed first — measured on this tree, the same npm and
 * the same install named `clsx@2.1.1` in one session and
 * `class-variance-authority@0.7.1` in another, both of them innocent and both of
 * them merely early. A reader sent to look at that package would find nothing
 * wrong with it, which is worse than not being sent at all. The npm error CODE
 * is the part that is a fact, so it goes in front where it can be searched for.
 *
 * @param {unknown} summary
 * @param {unknown} code
 * @returns {string}
 */
export function generalise(summary, code) {
  const said = String(summary ?? "").replace(/\s+/g, " ").trim();
  if (!said) return "";
  const label = typeof code === "string" && code.trim() ? `${code.trim()}: ` : "";
  return `${label}${said.replace(LEADING_SPECIFIER, "a package ")}`;
}

/**
 * The npm error CODE that means "the registry answered, and this npm cannot use
 * what it answered with".
 *
 * One constant rather than an inline string so the test and the sentence cannot
 * drift apart, and so a reader grepping the code finds the reasoning above it.
 */
export const ROTATED_KEY_CODE = "EEXPIREDSIGNATUREKEY";

/**
 * The oldest npm that accepts a signature made while a now-retired key was valid.
 *
 * MEASURED, not read off a changelog: 9.9.4 (the last 9.x) fails on this tree and
 * 10.9.9 answers `{"invalid":[],"missing":[]}` on the same install, same
 * afternoon. Named as a major because that is the resolution the measurement
 * supports — the exact 10.x that changed it was not measured and a number nobody
 * measured is how a sentence starts lying quietly.
 */
export const NPM_WITH_ROTATED_KEYS = 10;

/**
 * The npm error CODES that mean the registry was never reached.
 *
 * 🚨 A set of CODES, which is not the mistake this rung's header warns about. The
 * wording of npm's summary moves between majors — that is why the discriminator
 * for an ANSWER is structural — but `error.code` is a machine-readable
 * identifier npm passes through from Node's own network stack, and it is the one
 * part of an error body that is a fact. `ECONNREFUSED` was produced for real
 * against `--registry http://127.0.0.1:1/`.
 *
 * A code that is not in here falls through to the generic sentence, which is
 * what shipped before and says nothing false. The failure direction of this list
 * is therefore "less diagnosis", never "a wrong diagnosis".
 */
const OFFLINE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ERR_SOCKET_TIMEOUT",
  "FETCH_ERROR",
]);

/**
 * npm's answer, or the reason there is not one.
 *
 * 🚨 The discriminator is STRUCTURAL — both arrays present — and never the exit
 * code and never a match on npm's error text. Anything else is a skip, and the
 * reasons are kept apart because **an operator does something different about
 * each of them**. That is the whole contract of this function, and the three that
 * matter are the three that look identical from the outside:
 *
 *   the registry never answered      the network here. Waiting clears it
 *   the registry answered, npm is old  `npm install -g npm@latest`. Waiting does NOT
 *   there is nothing installed       `npm install`. Neither of the above
 *
 * `kind` is the same judgement as a machine-readable token, so `run()` can decide
 * whether a sentence needs the npm version measured without re-reading prose.
 * The sentence itself is built here and only here.
 *
 * @param {{code?: number, stdout?: string, stderr?: string}} answer
 * @param {{npmVersion?: string}} [context] the running npm, where it has been measured
 * @returns {{report: {invalid: any[], missing: any[]} | null, reason: string, kind: string}}
 */
export function readSignatures(answer, { npmVersion = "" } = {}) {
  const skip = (kind, reason) => ({ report: null, reason, kind });

  if (answer?.code === 127) {
    return skip("no-npm", "npm is not on this machine's PATH");
  }
  let parsed = null;
  try {
    parsed = JSON.parse(answer?.stdout ?? "");
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed === "object" && Array.isArray(parsed.invalid) && Array.isArray(parsed.missing)) {
    return { report: parsed, reason: "", kind: "answered" };
  }

  const code = typeof parsed?.error?.code === "string" ? parsed.error.code.trim() : "";

  // 🚨 Neither of the next two branches repeats npm's summary. Its sentence names
  // whichever of twenty parallel checks failed first — an innocent package — and
  // for the rotated key it also describes the wrong thing entirely.
  if (code === ROTATED_KEY_CODE) {
    const which = npmVersion ? ` (${npmVersion})` : "";
    return skip(
      "npm-too-old-for-the-key",
      `${code}: this npm${which} is older than the registry's key rotation. Update npm ` +
        "(`npm install -g npm@latest`) — waiting will not clear it. This npm rejects every " +
        "signature made with the retired signing key, where npm " +
        `${NPM_WITH_ROTATED_KEYS}+ accepts the ones made while that key was valid and answers ` +
        "on this same tree. It is the npm on this machine, not this app and not its packages.",
    );
  }
  if (OFFLINE_CODES.has(code)) {
    return skip(
      "offline",
      `${code}: the registry did not answer, so npm never got the signing keys. That is the ` +
        "network between here and the registry, not this app — try again when you are back on it.",
    );
  }

  const summary = generalise(parsed?.error?.summary, code || parsed?.error?.code);
  if (summary) return skip("npm-said", summary);
  if (looksUnsupported(answer)) {
    return skip(
      "npm-too-old-for-the-subcommand",
      "this npm does not know `npm audit signatures` — it arrived in npm 8.13",
    );
  }
  return skip(
    "unknown",
    firstLine(answer?.stderr) || `npm audit signatures exited ${answer?.code} without a report`,
  );
}

/**
 * What the rung says it ran — and, deliberately, what it does not say.
 *
 * 🚨 A constant rather than a sentence built at the call site, so that
 * `signatures.test.ts` can hold it against the one rule this rung's evidence has
 * to keep: it names the command and carries **no number**, because the only
 * number a reader would want here — how many packages verified — is not in the
 * `--json` answer at all.
 */
export const EVIDENCE =
  `${COMMAND} — it answers with the packages whose signature is invalid or missing ` +
  "and with no count of the ones that verified, so none is claimed here.";

/** `<name>@<version>` — what locates one of these on this machine. */
const whereOfEntry = (entry) => `${entry?.name ?? "?"}@${entry?.version ?? "?"}`;

/** The registry and the key npm named, where it named them. */
function detailOf(entry) {
  const parts = [];
  if (entry?.registry) parts.push(`registry ${entry.registry}`);
  if (entry?.keyid) parts.push(`keyid ${entry.keyid}`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/**
 * A package whose signature does not verify — ❌ HIGH.
 *
 * The `Why:` is npm's own claim and no more than it: the bytes here are not the
 * bytes the registry signed. That is a statement about this machine's copy, and
 * it is the strongest thing this whole command ever says about a package.
 *
 * No `id` — there is no advisory database behind this, so nothing here can be
 * accepted through `accepted.mjs`, and that is the right way round: an exemption
 * for "the signature does not verify" is not something anybody should be able to
 * write down.
 *
 * @param {any} entry
 * @returns {import("../rules.mjs").Finding}
 */
export function invalidFinding(entry) {
  return {
    severity: "high",
    title: "A package's registry signature does not verify",
    where: whereOfEntry(entry),
    why:
      "Somebody may have changed this package since it was published: the bytes " +
      "installed on this machine are not the bytes the registry signed. That is " +
      "what a tampered dependency looks like, and it carries no advisory because " +
      "nobody has had to publish one yet.",
    fix:
      "Do not deploy this tree. Delete node_modules and the package's cache entry " +
      "(`npm cache clean --force`), install again with `npm ci`, and run this check " +
      "again. If it still does not verify, the copy being served is not the published " +
      "one — take it up with the registry and the package's maintainer before anything " +
      "of this ships.",
    evidence: `${COMMAND} listed it under "invalid"${detailOf(entry)}.`,
    source: SOURCE,
  };
}

/**
 * A package with no signature where the registry publishes keys — ⚠️ MEDIUM.
 *
 * 🚨 Stated as the fact it is and never as "tampered". npm's own comment calls
 * this the non-strict case: plenty of perfectly good releases predate the
 * registry signing anything at all, and rating this like the one above is how an
 * operator learns to ignore both.
 *
 * @param {any} entry
 * @returns {import("../rules.mjs").Finding}
 */
export function missingFinding(entry) {
  return {
    severity: "medium",
    title: "The registry publishes signing keys for this package, and this tarball carries none",
    where: whereOfEntry(entry),
    why:
      "It means this release cannot be checked against the registry's signature — " +
      "not that anything is wrong with it. Releases published before the registry " +
      "started signing look exactly like this, and so does a tarball that came from " +
      "somewhere else.",
    fix:
      "Look at whether a newer release of this package is signed and move to it if " +
      "there is one. Where there is not, note it and carry on — an unsigned tarball " +
      "is not evidence of tampering, and there is nothing here to fix by hand.",
    evidence: `${COMMAND} listed it under "missing"${detailOf(entry)}.`,
    source: SOURCE,
  };
}

/**
 * Every finding in one npm answer, worst first.
 *
 * @param {{invalid?: any[], missing?: any[]}} report
 * @returns {import("../rules.mjs").Finding[]}
 */
export function findingsFrom(report) {
  return [
    ...(report?.invalid ?? []).map(invalidFinding),
    ...(report?.missing ?? []).map(missingFinding),
  ];
}

// ── the rung ────────────────────────────────────────────────────────────────

/**
 * Which npm just answered — measured, or `""`.
 *
 * Spawned only on the ONE branch whose sentence names it. A second process on
 * every clean run would be a cost paid for a string nobody reads, and this rung
 * runs inside a command somebody is waiting on.
 *
 * It can never fail the rung: anything at all — no npm, a version that is not a
 * version, a throw out of `capture()` — answers `""`, and the sentence is then
 * simply written without the number. A diagnosis that falls over while reporting
 * a diagnosis is worse than one that is a little vaguer.
 */
async function runningNpmVersion(cwd) {
  try {
    const answer = await capture("npm", ["--version"], { cwd });
    const said = firstLine(answer?.stdout);
    return /^\d+\.\d+\.\d+/.test(said) ? said : "";
  } catch {
    return "";
  }
}

/** @type {import("../rules.mjs").Rung} */
export const signatures = {
  id: "signatures",
  label: "Registry signatures (npm audit signatures)",
  // Tier 1: nothing to install. npm is here because this is a Node app — and
  // `tier` separates "needs nothing installed" from "needs a TOOL that may be
  // absent" (rules.mjs), not "needs the dependencies installed". A tree with no
  // node_modules is a SKIP with a reason, which is the mechanism that already
  // covers it.
  tier: 1,
  covers:
    "whether the packages installed here still carry the registry signature they were " +
    "published with — tampering that carries no advisory at all",

  async run({ root } = {}) {
    const cwd = root ?? process.cwd();
    const raw = await capture("npm", ["audit", "signatures", "--json"], { cwd });

    // Read twice, and only ever on one branch. `readSignatures()` is pure and
    // cheap, so the second call costs nothing; what it buys is that the sentence
    // lives in exactly ONE place rather than being half-built here. The npm
    // version is measured between the two calls because that is the only branch
    // whose sentence has a hole in it.
    const first = readSignatures(raw);
    const answer =
      first.kind === "npm-too-old-for-the-key"
        ? readSignatures(raw, { npmVersion: await runningNpmVersion(cwd) })
        : first;

    if (!answer.report) {
      // The way out is appended structurally rather than by matching npm's
      // sentence: npm has answered this same question with two different error
      // bodies on this very tree, and only one of them mentions dependencies.
      const wayOut = hasInstalledTree(cwd)
        ? ""
        : " — nothing is installed here, so there was nothing to verify; `npm install` first";
      return { state: "skipped", reason: `${answer.reason}${wayOut}`, findings: [] };
    }

    const findings = findingsFrom(answer.report);

    return {
      state: findings.length > 0 ? "found" : "clean",
      findings,
      // 🚨 Names the command and claims NO count of what verified. The number
      // exists only in npm's human output, and a count nobody measured is worse
      // than no count at all.
      evidence: EVIDENCE,
    };
  },
};
