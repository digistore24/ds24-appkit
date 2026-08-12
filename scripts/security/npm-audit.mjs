// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What npm knows, as something more than one rung can ask.
//
// This file is a MOVE, not a new idea: `readAudit()` and `advisoriesIn()` were
// written inside `rungs/advisories.mjs` and are here unchanged, comments and
// all. They are the measured knowledge about npm's answer — the
// `auditReportVersion` discriminator, the `via[].url` walk, the collapse per
// advisory id — and a second rung needed them without importing the first.
//
// 🚨 **Nothing under `rungs/` may import anything else under `rungs/`.** A rung
// that reads another rung's code is one step from a rung that reads another
// rung's RESULT, and the ladder exists to deny exactly that: no rung may depend
// on another's outcome, so the order of `RUNGS` can never change an answer. What
// two rungs share is a helper, and this is the file it lives in.
//
// Plain Node, no dependency. npm is started through `capture()` — never a
// shell, because on Windows npm is a `.cmd` shim and `spawnCommand()` is the
// only thing in this project allowed to know that.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { capture } from "../lib/proc.mjs";

/** How many affected package names a finding's `Where:` line names before counting. */
const NAMED_PACKAGES = 4;

// ── What `--package-lock-only` actually decides. Measured, not read ─────────
//
// 2026-08-12, npm 9.2.0 on Node 22.22.1, a throwaway tree whose
// `package-lock.json` resolves `minimist@1.2.0` — one critical advisory.
// `npm audit --json`, and then the same call again with `--package-lock-only`:
//
//   node_modules absent                              total 1 | critical 1
//   node_modules present but EMPTY                   total 1 | critical 1
//   node_modules empty, .package-lock.json inside it total 1 | critical 1
//   node_modules installed                           total 1 | critical 1
//   installed, then doctored to the PATCHED 1.2.6 in
//     both node_modules/minimist/package.json and
//     node_modules/.package-lock.json                total 1 | critical 1
//
// Ten answers, all the same. So the flag decides whether npm TOUCHES the tree,
// not where its answer comes from: with a `package-lock.json` present, npm
// rates the versions THAT file resolved — it does not believe an installed tree
// over the lockfile, and it does not report an empty tree as clean.
//
// 🚨 That last line is the correction. This decision was once described as
// guarding against a FALSE CLEAN — an empty `node_modules` answering
// `existsSync` with `true`, npm then auditing a tree with nothing in it. That
// chain does not reproduce, on any of the five states above; it was derived
// from reading and never measured. Do not re-derive it. What the decision is
// still for is smaller and real: keep npm off a tree it has no reason to load,
// and let the evidence line say which of the two questions was put.
//
// The empty `node_modules` is not exotic, which is why the predicate below asks
// about CONTENTS rather than existence: `npm ci --dry-run` empties the folder
// and leaves it behind (measured in `rungs/posture.mjs`, see its header).

/**
 * Is there nothing installed here — which is not the same as "no folder here".
 *
 * Dot entries do not count: `.package-lock.json`, `.bin` and `.cache` are npm's
 * own bookkeeping and can outlive every package beside them. A folder that
 * cannot be READ is not called empty — we could not look, and the honest
 * consequence of not having looked is to ask npm the ordinary way.
 */
export function hasInstalledTree(cwd) {
  const modules = join(cwd, "node_modules");
  if (!existsSync(modules)) return false;
  try {
    return readdirSync(modules).some((entry) => !entry.startsWith("."));
  } catch {
    // Could not look. Say "there is an install" — every caller's honest
    // consequence of not having looked is the ordinary path: ask npm the usual
    // way, and do NOT tell an operator to run `npm install` over a folder we
    // failed to read.
    return true;
  }
}

const nothingInstalled = (cwd) => !hasInstalledTree(cwd);

/**
 * How npm gets asked about THIS tree, decided in one place for every caller.
 *
 * 🚨 One implementation, and `npm-audit.test.ts` refuses a second: the npm rung
 * and the OSV rung both need it, and it stood in both of them as a copied line
 * (`!existsSync(join(cwd, "node_modules"))`) that asked whether the FOLDER
 * exists where the comment above it said "nothing is installed". Two copies of
 * a decision is one decision nobody owns.
 *
 * `note` is not decoration. It is the half of the evidence line that says which
 * question npm was put, and it is written for BOTH answers on purpose: a line
 * that only speaks up in the lock-only case leaves an operator to read
 * `npm audit --json` as "the installed tree was checked", when the versions
 * rated came off the lockfile either way (see the measurement above).
 *
 * @param {string} [cwd]
 * @returns {{lockOnly: boolean, flags: string[], suffix: string, note: string}}
 */
export function auditScope(cwd = process.cwd()) {
  const lockOnly = nothingInstalled(cwd);
  return {
    lockOnly,
    flags: lockOnly ? ["--package-lock-only"] : [],
    suffix: lockOnly ? " --package-lock-only" : "",
    note: lockOnly
      ? "nothing is installed here, so npm was asked with --package-lock-only and rated " +
        "the versions package-lock.json resolved"
      : "npm was asked against the installed node_modules, and rated the versions " +
        "package-lock.json resolved",
  };
}

/**
 * npm's answer, or the reason there is not one.
 *
 * `code === 127` is `capture()`'s answer for a missing binary, and it is a
 * different problem from an endpoint that did not respond — worth keeping
 * apart, because one is fixed by installing something and the other by waiting.
 */
export function readAudit(answer) {
  if (answer.code === 127) {
    return { report: null, reason: "npm is not on this machine's PATH" };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(answer.stdout);
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed === "object" && "auditReportVersion" in parsed) {
    return { report: parsed, reason: "" };
  }
  const message =
    typeof parsed?.message === "string" && parsed.message.trim()
      ? parsed.message.trim()
      : (answer.stderr.split(/\r?\n/).find((line) => line.trim()) ?? "").trim();
  return {
    report: null,
    reason: message || `npm audit exited ${answer.code} without an audit report`,
  };
}

/**
 * Every advisory in a report, collapsed to ONE entry per advisory id.
 *
 * 🚨 The collapsing is the point, not a tidiness. One advisory reaches a tree
 * through as many packages as depend on it, and npm counts the paths — which is
 * how a single linting advisory once read as "9 high severity vulnerabilities"
 * in this project's own documentation. How many paths npm counts is not a fact
 * about this app; whether the advisory is there, and whether it ships, is. So
 * the packages become the `Where:` line of one finding.
 *
 * The shape walked here is npm's own: `vulnerabilities[<name>].via` is an array
 * whose entries are either a string (another package — an indirect path) or an
 * object carrying `{ source, name, url, severity, title, range }`. The advisory
 * id is the last path segment of `via.url`.
 */
export function advisoriesIn(report) {
  const byId = new Map();
  for (const [name, entry] of Object.entries(report?.vulnerabilities ?? {})) {
    for (const via of entry?.via ?? []) {
      if (typeof via !== "object" || !via?.url) continue;
      const id = String(via.url).split("/").filter(Boolean).pop();
      if (!id) continue;
      const found = byId.get(id) ?? {
        id,
        url: String(via.url),
        title: "",
        npmSeverity: "",
        packages: new Set(),
        fixAvailable: false,
      };
      found.packages.add(name);
      if (via.title) found.title = String(via.title);
      if (via.severity) found.npmSeverity = String(via.severity);
      if (entry?.fixAvailable) found.fixAvailable = true;
      byId.set(id, found);
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** "eslint-config-next, minimatch and 3 more — GHSA-…" — what locates it here. */
export function whereOf(advisory) {
  const names = [...advisory.packages].sort();
  const shown = names.slice(0, NAMED_PACKAGES).join(", ");
  const more = names.length > NAMED_PACKAGES ? ` and ${names.length - NAMED_PACKAGES} more` : "";
  return `${shown}${more} — ${advisory.id}`;
}

/**
 * The advisory ids npm reports for the WHOLE tree — or the reason it could not
 * say.
 *
 * This is the only new thing in this file, and it exists for one caller: a
 * second advisory database has to be able to report what npm did NOT report,
 * and the honest way to know that is to ask npm the question itself rather than
 * to read the npm rung's outcome. It costs one extra `npm audit --json`, and it
 * buys a rung that is correct in every order, correct when the other rung was
 * skipped, and correct if somebody reorders `RUNGS` tomorrow.
 *
 * ⚠️ The two halves of the answer are deliberately separate. An empty set with
 * an empty reason means "npm answered, and it reported nothing"; an empty set
 * with a reason means "npm could not answer". The caller decides what to do
 * with the second — this file must never make "I could not look" and "there is
 * nothing there" the same value.
 *
 * How npm gets asked is `auditScope()`'s decision and deliberately NOT an
 * option here: an option is a second place the decision can be made, and it was
 * exactly that — the OSV rung passed its own copy of the condition in.
 *
 * @param {{cwd?: string}} [options]
 * @returns {Promise<{ids: Set<string>, reason: string}>}
 */
export async function auditIds({ cwd = process.cwd() } = {}) {
  const { flags } = auditScope(cwd);
  const { report, reason } = readAudit(await capture("npm", ["audit", "--json", ...flags], { cwd }));
  if (!report) return { ids: new Set(), reason };
  return { ids: new Set(advisoriesIn(report).map((advisory) => advisory.id)), reason: "" };
}
