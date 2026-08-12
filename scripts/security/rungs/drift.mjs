// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Rung 6 — how far this app's own dependencies have drifted from the template's.
//
// The four rungs above ask what is known to be wrong with what this app runs.
// This one asks something no advisory database can: is this app simply OLD? A
// dependency the template raised six months ago and this copy never did is not a
// finding in anybody's database — until the day it becomes one, and then it is
// already in production.
//
// ── The same channel `.template-version` already carries ───────────────────
//
// The stamp in the project root holds the `raw` base URL of the public repo this
// app was cloned out of, and `node run.mjs update` reads guidance files from
// exactly that address. This rung fetches ONE more file from it —
// `package.json` — with Node's own `fetch()`. No curl, no added dependency, no
// account, no key.
//
// ⚠️ **`node run.mjs update` will not fix what this rung reports**, and the
// finding says so in its `Fix:`. That command carries TEXT and never code
// (`docs/updates.md`): it will bring this file's own description of a dependency
// forward and leave the dependency where it is. Raising a version is a decision
// somebody makes and then tests.
//
// ── Why this is its own rung, and not half of `posture` ────────────────────
//
// The epic asked for one rung with a local half and a drift half, where an
// unreachable repo leaves the local half reporting. The shipped interface has
// exactly ONE state per rung, so the only honest way to say that is two rungs:
// this one skips with its reason, `posture` reports its four answers in full,
// `⏭ not asked 1` counts it and the record writes `complete: false`. Folding it
// into `posture` would either lose the local answers or turn a network outage
// into a finding — and a finding is something an operator is asked to act on.
//
// A consequence worth knowing rather than being surprised by: a machine that is
// offline reports `complete: false` for ever, and that is correct. Nobody looked.
//
// ⚠️ **It deliberately shares nothing with `scripts/dev/update-plan.mjs` beyond
// the `.env` switch and the `raw` base.** Those files answer *"is a guidance file
// newer"*; this asks *"is a dependency older"*. Two questions that happen to use
// one address.
//
// Plain Node, no dependency — Linux, macOS and Git Bash on Windows. Nothing here
// runs at import time, no process is spawned at all, and the one request is
// bounded.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { readEnvValue } from "../../lib/env-write.mjs";

const SOURCE = "template";

/**
 * How long the one request may take.
 *
 * Bounded because this runs inside a command nobody is watching the network for:
 * a hung request there is indistinguishable from a hung command, and somebody
 * reaches for Ctrl-C and never runs the check again. Ten seconds is the same
 * bound `rungs/registry.mjs` uses against its two hosts.
 */
const TIMEOUT_MS = 10_000;

/** The one switch this rung honours, and the greeting's update check honours it too. */
const SWITCH = "TEMPLATE_UPDATE_CHECK";

/** How many names a `Where:` line spells out before it starts counting. */
const NAMED = 4;

// ── the pure half ───────────────────────────────────────────────────────────

/**
 * The lowest version a range admits, or null when nobody can say.
 *
 * Deliberately strict, exactly as `floorOf()` in `scripts/deps.test.ts` is
 * strict: `^1.2.3`, `~1.2.3`, `>=1.2.3`, `>= 1.2.3`, `=1.2.3` and a bare
 * `1.2.3`, with an optional prerelease tail. Anything else — a union
 * (`^7 || ^8`), a hyphen range, an `npm:` alias, a git URL, `*`, `latest` — is
 * NOT guessed at: a range whose lower bound cannot be stated is one this rung
 * reports as unread rather than quietly calling equal. Silently treating it as
 * equal is how a check reports "nothing behind" about a package it never
 * compared.
 *
 * @param {unknown} range
 * @returns {string|null}
 */
export function rangeFloor(range) {
  const text = String(range ?? "").trim();
  if (!text) return null;
  const match = /^(?:\^|~|>=|>|=)?\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(text);
  return match ? match[1] : null;
}

/** `1.2.3-beta.4` → `{ triple: [1,2,3], pre: ["beta", 4] }`; null when unreadable. */
function parts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(version ?? "").trim());
  if (!match) return null;
  const pre = match[4]
    ? match[4].split(".").map((id) => (/^\d+$/.test(id) ? Number(id) : id))
    : [];
  return { triple: [Number(match[1]), Number(match[2]), Number(match[3])], pre };
}

/**
 * Is `mine` an older version than `theirs`?
 *
 * Semver's own ordering, including the rule people get wrong: a release outranks
 * any prerelease of the same triple, so `5.0.0-beta.32` is BEHIND `5.0.0` — and
 * this app really does carry such a dependency, which is why the rule is
 * implemented rather than assumed away. Either side unreadable answers `false`:
 * a comparison that could not be made is not a finding.
 *
 * @param {string|null} mine
 * @param {string|null} theirs
 * @returns {boolean}
 */
export function isBehind(mine, theirs) {
  const a = parts(mine);
  const b = parts(theirs);
  if (!a || !b) return false;

  for (let index = 0; index < 3; index += 1) {
    if (a.triple[index] !== b.triple[index]) return a.triple[index] < b.triple[index];
  }
  if (a.pre.length === 0 && b.pre.length === 0) return false;
  // A release beats every prerelease of the same triple, in both directions.
  if (a.pre.length === 0) return false;
  if (b.pre.length === 0) return true;

  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    const left = a.pre[index];
    const right = b.pre[index];
    if (left === undefined) return true;
    if (right === undefined) return false;
    if (left === right) continue;
    const bothNumbers = typeof left === "number" && typeof right === "number";
    if (bothNumbers) return left < right;
    if (typeof left === "number") return true;
    if (typeof right === "number") return false;
    return String(left) < String(right);
  }
  return false;
}

/**
 * Every direct dependency of this app that the template has since moved past.
 *
 * `dependencies` and `devDependencies` together, because a build tool this app
 * never updated is every bit as much its problem as a runtime library. A package
 * the template no longer has at all is NOT drift — it is a choice one of the two
 * made, and this rung has no way to tell which.
 *
 * @param {any} mine
 * @param {any} theirs
 * @returns {{behind: {name: string, mine: string, theirs: string}[], unread: string[]}}
 */
export function driftBetween(mine, theirs) {
  const behind = [];
  const unread = [];

  for (const field of ["dependencies", "devDependencies"]) {
    for (const [name, range] of Object.entries(mine?.[field] ?? {})) {
      const theirRange = theirs?.dependencies?.[name] ?? theirs?.devDependencies?.[name];
      if (theirRange === undefined) continue;

      const ours = rangeFloor(range);
      const upstream = rangeFloor(theirRange);
      if (ours === null || upstream === null) {
        unread.push(`${name} (this app ${range}, the template ${theirRange})`);
        continue;
      }
      if (isBehind(ours, upstream)) behind.push({ name, mine: ours, theirs: upstream });
    }
  }
  behind.sort((a, b) => a.name.localeCompare(b.name));
  return { behind, unread };
}

/**
 * The whole drift as ONE ℹ️ LOW finding — never one per package.
 *
 * 🚨 The rating and the shape are the same decision. Fifteen LOW findings for
 * fifteen behind packages push the tally line to `ℹ️ LOW 15` and drown a real
 * HIGH sitting above them, and the tally line is what an operator reads. It is
 * LOW because being behind is not a hole: it is where a hole would sit
 * unpatched, which is a fact about maintenance rather than an accusation.
 *
 * `Where:` names a few and counts the rest; `Evidence:` carries the full list
 * with both versions, because a `Where:` line that wraps is one nobody finishes.
 *
 * @param {{name: string, mine: string, theirs: string}[]} behind
 * @param {{templateVersion?: string}} [context]
 * @returns {import("../rules.mjs").Finding|null}
 */
export function driftFinding(behind, { templateVersion = "" } = {}) {
  const list = behind ?? [];
  if (list.length === 0) return null;

  const names = list.map((entry) => entry.name);
  const shown = names.slice(0, NAMED).join(", ");
  const more = names.length > NAMED ? ` and ${names.length - NAMED} more` : "";
  const version = String(templateVersion || "").trim();

  return {
    severity: "low",
    title: `This app asks for older versions than the template${version ? ` ${version}` : ""} does`,
    where: `${shown}${more}`,
    why:
      "Being behind is not a hole. It is where a hole sits unpatched: an advisory " +
      "published against one of these lands on a version this app is already three " +
      "releases past caring about, and nobody notices until it is in production. " +
      "It is also the cheapest thing on this whole ladder to act on.",
    fix:
      "Raise them in package.json, run `npm install`, then `node run.mjs test` and " +
      "`node run.mjs smoke` — one at a time where a major changes. 🚨 `node run.mjs " +
      "update` will NOT fix this: that command carries guidance TEXT and never code " +
      "(docs/updates.md), so it will bring this sentence forward and leave the " +
      "dependency exactly where it is.",
    evidence: list
      .map((entry) => `${entry.name}: this app ${entry.mine}, the template ${entry.theirs}`)
      .join("; "),
    source: SOURCE,
  };
}

// ── the half that talks ─────────────────────────────────────────────────────

/** Parsed JSON off disk, or null — never a thrown error over a read. */
function jsonOf(file) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  } catch {
    return null;
  }
}

/**
 * Has somebody switched the template's update channel off?
 *
 * `scripts/dev/update-check.mjs` honours this for the greeting's own daily check,
 * and this rung calls the same host — a switch one caller obeys and another
 * ignores is worse than no switch at all. The environment wins over the file, the
 * way `scripts/lib/env.mjs` resolves it everywhere else; the file is read through
 * `readEnvValue()` (which splits on `\r?\n`, and the `.env` is the one file
 * `.gitattributes` cannot reach) rather than by loading the whole `.env` into this
 * process, because a rung has no business changing `process.env` for the rungs
 * after it.
 *
 * @param {string} cwd
 * @returns {boolean}
 */
export function updateCheckOff(cwd) {
  const fromEnv = String(process.env[SWITCH] ?? "").trim();
  const value = fromEnv || readEnvValue(join(cwd, ".env"), SWITCH);
  return String(value).toLowerCase() === "off";
}

/** `https://…/main/` + `package.json`, with exactly one slash between them. */
export const templatePackageUrl = (raw) =>
  `${String(raw).endsWith("/") ? raw : `${raw}/`}package.json`;

// ── the rung ────────────────────────────────────────────────────────────────

/** @type {import("../rules.mjs").Rung} */
export const drift = {
  id: "drift",
  label: "Distance from the template this app came out of (public repo)",
  // Tier 1: one unauthenticated GET of one public file, with Node's own fetch().
  tier: 1,
  covers:
    "how far this app's direct dependencies have drifted from the template's current ones",

  async run({ root } = {}) {
    const cwd = root ?? process.cwd();

    // First, because it is the operator saying "do not call that host". Nothing
    // is read and nothing is fetched once it is set.
    if (updateCheckOff(cwd)) {
      return {
        state: "skipped",
        reason: `${SWITCH}=off — the template's update channel is switched off here, and this rung calls the same host`,
        findings: [],
      };
    }

    const stamp = jsonOf(join(cwd, ".template-version"));
    if (!stamp) {
      return {
        state: "skipped",
        reason:
          "there is no readable .template-version in this project, so there is no address to compare against",
        findings: [],
      };
    }
    const raw = typeof stamp.raw === "string" ? stamp.raw.trim() : "";
    if (!raw) {
      return {
        state: "skipped",
        reason: '.template-version carries no "raw" base URL, so there is nowhere to fetch the template from',
        findings: [],
      };
    }

    const pkg = jsonOf(join(cwd, "package.json"));
    if (!pkg) {
      return {
        state: "skipped",
        reason: "package.json could not be read, so this app's own dependencies could not be listed",
        findings: [],
      };
    }

    const url = templatePackageUrl(raw);
    let response;
    try {
      response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // The transport's own sentence is "TypeError: fetch failed" — it names no
      // host, and an operator's first move is to find out WHICH one. So the host
      // goes in front and the transport's words stay behind it. A timeout arrives
      // here too, as a `TimeoutError`.
      const said = String(error?.name ?? "") || "the request failed";
      return {
        state: "skipped",
        reason: `${url} could not be reached (${said}: ${String(error?.message ?? "").trim() || "no further detail"})`,
        findings: [],
      };
    }

    if (response.status === 404) {
      return {
        state: "skipped",
        reason:
          `${url} answered 404 — that is what a PRIVATE source repository answers, ` +
          `and it is the shipped state of the template's own test repo. Nothing is wrong here; nobody looked`,
        findings: [],
      };
    }
    if (!response.ok) {
      return {
        state: "skipped",
        reason: `${url} answered HTTP ${response.status}, so the template's dependencies could not be read`,
        findings: [],
      };
    }

    let theirs;
    try {
      theirs = await response.json();
    } catch {
      return {
        state: "skipped",
        reason: `${url} answered something that is not JSON, so there was nothing to compare against`,
        findings: [],
      };
    }

    const { behind, unread } = driftBetween(pkg, theirs);
    const finding = driftFinding(behind, { templateVersion: theirs?.version ?? "" });

    const evidence =
      `GET ${url} — this app is ${pkg?.version ?? "?"}, the template is ` +
      `${theirs?.version ?? "?"} (stamped ${stamp?.version ?? "?"} when this app was created).` +
      (unread.length > 0
        ? ` ⚠️ ${unread.length} range(s) were NOT compared — nobody can state their lower bound: ${unread.join("; ")}.`
        : "");

    if (finding) return { state: "found", findings: [finding], evidence };
    return { state: "clean", findings: [], evidence };
  },
};
