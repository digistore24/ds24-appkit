// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Rung 8 — a credential in the working tree, found without installing anything.
//
// The question is narrow on purpose: **is there a credential-shaped value in the
// files git is about to publish?** Not "is this project safe", not "was one ever
// committed" — the second of those is git HISTORY, it is a rung of its own, and
// this file says so in its `covers` sentence rather than letting its silence be
// read as an answer to it.
//
//   the file list   `git ls-files -z --cached`  — tracked files PLUS anything
//                                                 newly staged
//   the content     what is on disk right now
//   and also        the STAGED BLOB of every path in `git diff --cached`, so a
//                   secret that was staged and then edited out of the working
//                   copy is still found. Such a finding says `(staged)`
//   and apart       `.env`, `.env.local`, `.env.*.local` — see below
//
// The rules live in `../patterns.mjs` and are pure, which is what makes them
// measurable: `../patterns.test.ts` plants a secret and proves it is found with
// its line number, and reads this template's own `.env.example` off disk and
// proves it stays silent. A scanner without both halves reports success.
//
// ── 🚨 No fallback to walking the tree ─────────────────────────────────────
//
// Without git there is no way to tell a tracked file from `node_modules`, a
// build output or somebody's local scratch folder. A scan of the wrong set of
// files, reported as an answer, is worse than an honest skip: it takes a minute,
// it describes files nobody is about to commit, and it reads as a clean bill.
// So: `skipped`, with the reason, and the `covers` sentence saying what nobody
// therefore looked at.
//
// ── `.env` present is not `.env` leaked ────────────────────────────────────
//
// A local `.env` full of live keys that was never committed is the setup working
// as designed. Reporting it as CRITICAL teaches the operator to ignore the whole
// check — the skill says so in as many words
// (`security-gateway/SKILL.md:161-166`). So it is ℹ️ LOW, its `Evidence:` is a
// COUNT and never a value, and the CRITICAL is reserved for the case that
// actually publishes it: an `.env*` sitting in git's index.
//
// ── 🚨 A finding never carries the matched value ───────────────────────────
//
// Not in the finding, not in `--json`, not in `.dev/security-check.json`.
// `Where:` is `path:line`; the operator has the file open. `../patterns.mjs`
// makes that structural — its rows carry a rule id and a line number and no
// value at all — and the record's own rule (`../rules.mjs:496-520`) is the same
// one, for the same reason: this shape has to survive the journey into a
// scheduled job's one line of numbers.
//
// Plain Node, no dependency — Linux, macOS and Git Bash on Windows. git is
// started through `capture()`, never a shell; the file list is split on `\0`
// rather than on a newline (a path may contain one); every file read is split on
// `/\r?\n/`. There is no `try/catch` of its own: `check.mjs` already turns
// anything a rung throws into that rung's skip carrying the message.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { capture } from "../../lib/proc.mjs";
import {
  SOURCE,
  BROWSER_RULE,
  countSecrets,
  isSourceFile,
  ruleFor,
  scanText,
} from "../patterns.mjs";

/** Bigger than this and it is not source anybody pasted a key into by hand. */
const MAX_BYTES = 512 * 1024;

/** How much of a file is probed for a NUL byte before it is called binary. */
const BINARY_PROBE = 8 * 1024;

/** The `.env` files that legitimately hold live values and are never committed. */
// ⚠️ `.env.staging` and `.env.production` are here on purpose. They are not
// `.local` files, but they are the same THING — an untracked file on this
// machine holding live values — and without them such a file appeared in
// neither `tracked` nor `envFilesIn()`, so it was not even counted apart. The
// line whose stated purpose is "so that nobody mistakes its absence for nobody
// having looked at it" was the line that went missing.
const LOCAL_ENV = /^\.env(?:\.local|\.[^.]+(?:\.local)?)?$/;

/** The only `.env*` files that belong in git. */
const COMMITTABLE_ENV = /^\.env\.example$|^\.env\.[^.]+\.example$/;

/** Anything named `.env…` at the repository root. */
const ANY_ENV = /^\.env(?:\.|$)/;

// ── git ─────────────────────────────────────────────────────────────────────

/**
 * Why this rung could not look, in this app's own words about a TOOL.
 *
 * Three answers and they are three different sentences — `capture()` reports a
 * missing binary as 127 (`scripts/lib/proc.mjs:198-221`), git says its own
 * sentence for a folder that is not a repository, and anything else is quoted
 * back so nobody has to guess. Never a path out of somebody's repository and
 * never anything a person typed: the reason travels into the record, which
 * `../rules.mjs` caps at 120 characters and `docs/cron.md` restricts to this
 * app's own sentences about tools.
 *
 * @param {{code: number, stdout: string, stderr: string}} result
 * @returns {string}
 */
export function skipReason(result) {
  if (Number(result?.code) === 127) return "git is not on this machine's PATH";
  const said = String(result?.stderr ?? "").replace(/\s+/g, " ").trim();
  if (/not a git repository/i.test(said)) return "this folder is not a git repository";
  return said ? `git could not list the index: ${said}` : "git could not list the index";
}

/** A NUL-separated list, as paths. Never `split("\n")` — a path may contain one. */
export function splitNul(stdout) {
  return String(stdout ?? "")
    .split("\0")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// ── reading a file the way this rung reads it ──────────────────────────────

/**
 * A tracked file's text, or why it was not read.
 *
 * Two refusals and both are counted rather than reported: a NUL byte in the
 * first 8 KB (it is binary — a PNG full of random bytes would match nothing and
 * cost seconds) and anything over 512 KB. A file that cannot be read at all is
 * its own count, because "it is a picture" and "it vanished between the listing
 * and the read" are not the same fact.
 *
 * @param {string} file
 * @returns {{text: string|null, why: "binary"|"oversized"|"unreadable"|null}}
 */
function textOf(file) {
  try {
    if (statSync(file).size > MAX_BYTES) return { text: null, why: "oversized" };
    const bytes = readFileSync(file);
    if (bytes.subarray(0, BINARY_PROBE).includes(0)) return { text: null, why: "binary" };
    return { text: bytes.toString("utf8"), why: null };
  } catch {
    return { text: null, why: "unreadable" };
  }
}

// ── findings ────────────────────────────────────────────────────────────────

/**
 * One scanned row, as a finding.
 *
 * 🚨 `Where:` is `path:line` and `Evidence:` names the RULE that fired and what
 * it looked for. Neither of them ever carries the matched value — `scanText()`
 * does not even return one.
 *
 * @param {{ruleId: string, line: number, severity: string, inComment: boolean, browser: boolean}} row
 * @param {string} path
 * @param {boolean} staged
 * @returns {import("../rules.mjs").Finding}
 */
export function findingFrom(row, path, staged = false) {
  const rule = ruleFor(row.ruleId);
  const where = `${path}:${row.line}${staged ? " (staged)" : ""}`;

  const why = row.inComment
    ? "It is inside a COMMENT, which means one of two things and neither of them " +
      "is nothing: a credential somebody meant to delete and left behind, or an " +
      "example somebody wrote. A comment is where a key gets parked."
    : row.browser
      ? BROWSER_RULE.why
      : (rule?.why ?? "It has the shape of a live credential.");

  const fix = row.inComment
    ? "Read the line. If it is a real value, rotate it at whatever issued it and " +
      "then delete the line — in that order. If it is an example, replace the body " +
      "with a placeholder (`sk-…`, `xxxx`) so it stops looking like one."
    : row.browser
      ? BROWSER_RULE.fix
      : (rule?.fix ?? "Rotate it at the provider, then read it from the environment.");

  return {
    severity: row.severity,
    title: row.inComment ? `${rule?.label ?? row.ruleId} — inside a comment` : (rule?.label ?? row.ruleId),
    where,
    why,
    fix,
    evidence:
      `The rule "${row.ruleId}" matched at ${where}` +
      (staged ? " — in the blob git has STAGED, which may differ from the file on disk" : "") +
      `. It looks for ${describeRule(row.ruleId)}. The value itself is deliberately not printed.`,
    source: SOURCE,
  };
}

/** What a rule looks for, in one clause — the evidence line's second half. */
function describeRule(ruleId) {
  switch (ruleId) {
    case "app-key":
      return "a ds24api_ or ds24setup_ marker followed by 43 characters of key alphabet";
    case "vendor-key":
      return "a vendor's secret-key marker (sk-, sk_live_, xoxb-, ghp_, github_pat_) followed by at least 32 characters of key alphabet";
    case "private-key":
      return "a PEM private-key header";
    case "dsn-password":
      return "a connection string whose password is at least 12 characters and whose host is neither local nor a documentation domain";
    default:
      return "a credential shape";
  }
}

/**
 * A `.env` that exists on this machine — ℹ️ LOW, and the count is the evidence.
 *
 * @param {string} name
 * @param {number} count
 * @returns {import("../rules.mjs").Finding}
 */
export function localEnvFinding(name, count) {
  return {
    severity: "low",
    title: `${name} is on this machine and holds live values`,
    where: name,
    why:
      "This is the setup working as designed, not a leak: the credentials belong " +
      "in the environment and this file is the environment on this machine. It is " +
      "reported so that nobody mistakes its absence from the rest of this rung for " +
      "nobody having looked at it.",
    fix:
      `Nothing, as long as it stays out of git. Check with \`git check-ignore ${name}\` ` +
      "— a fresh app ignores it. In STAGING and PROD the same values live in the " +
      "host's secret storage and this file does not exist at all.",
    evidence:
      `${count} credential-shaped value(s) in ${name}. Neither the values nor the ` +
      "lines they are on are printed, here or anywhere else this run writes.",
    source: SOURCE,
  };
}

/**
 * An `.env*` sitting in git's index — 🚨 CRITICAL, and the fix is an ORDER.
 *
 * The next commit publishes it. Cleaning the file first and rotating afterwards
 * leaves a live key out there in the meantime, which is why the order is spelled
 * out rather than left to the reader — it is the same order
 * `security-gateway/references/checks-secrets-and-deps.md` gives.
 *
 * @param {string} name
 * @param {number} count
 * @returns {import("../rules.mjs").Finding}
 */
export function committedEnvFinding(name, count) {
  return {
    severity: "critical",
    title: `${name} is in git's index — the next commit publishes it`,
    where: name,
    why:
      "Everything in the index goes out with the next commit, and a push after " +
      "that puts it wherever the repository is hosted. An `.env` is the one file " +
      "in this app that is nothing but credentials.",
    fix:
      "In this order, and the order is the point: 1. rotate every value in it at " +
      "whatever issued them. 2. `git rm --cached " + name + "` so git stops tracking " +
      "it — the file stays on your disk. 3. put it in `.gitignore`. 4. clean the " +
      "history LAST (git filter-repo, BFG) — doing that first leaves live keys out there.",
    evidence:
      `${name} appears in \`git ls-files --cached\`, and ${count} credential-shaped ` +
      "value(s) were counted in it. No value and no line number is printed.",
    source: SOURCE,
  };
}

// ── the rung ────────────────────────────────────────────────────────────────

/** @type {import("../rules.mjs").Rung} */
export const secrets = {
  id: "secrets",
  label: "Secrets in the working tree",
  // Tier 1: git is here because the app was cloned with it, and the rules are
  // this repository's own. Nothing to install, no account, no key, no network.
  tier: 1,
  covers:
    "credential-shaped values in the files git tracks and stages — NOT in git history, " +
    "which is a rung of its own and needs gitleaks",

  async run({ root } = {}) {
    const cwd = root ?? process.cwd();

    const listed = await capture("git", ["ls-files", "-z", "--cached"], { cwd });
    if (Number(listed.code) !== 0) {
      // 🚨 Deliberately no fallback to walking the tree — see the header.
      return { state: "skipped", reason: skipReason(listed), findings: [] };
    }
    const tracked = splitNul(listed.stdout);

    const findings = [];
    /** Matches an allowlist entry excused — printed, never counted (`rules.mjs`). */
    const accepted = [];
    /** `path:line:ruleId` of everything the disk pass reported — the staged pass dedupes on it. */
    const onDisk = new Set();
    let skippedFiles = 0;
    let unreadable = 0;

    // ── the tracked files, as they are on disk right now ────────────────────
    for (const path of tracked) {
      const { text, why } = textOf(join(cwd, path));
      if (text === null) {
        if (why === "unreadable") unreadable += 1;
        else skippedFiles += 1;
        continue;
      }
      for (const row of scanText(text, { path, blank: isSourceFile(path) })) {
        if (row.accepted) {
          // 🚨 Kept, not swallowed. `rules.mjs` writes it as the contract —
          // "never counted, always printed" — and this rung dropped it on the
          // floor: an accepted match appeared in no ✅ block, no counter, no
          // `--json` and no record. Combined with the allowlist reading a whole
          // connection string, a real production password could be excused by
          // its HOSTNAME and then leave no trace anywhere at all.
          accepted.push(findingFrom(row, path));
          continue;
        }
        onDisk.add(`${path}:${row.line}:${row.ruleId}`);
        findings.push(findingFrom(row, path));
      }
    }

    // ── the STAGED blobs ────────────────────────────────────────────────────
    //
    // `git ls-files` gave the paths; the content above came from disk. A value
    // that was staged and then edited out of the working copy is in neither, and
    // it is the one a commit would publish.
    // 🚨 `--relative`, and `:./<path>` below, are not decoration — measured.
    // `git ls-files` prints paths relative to the CURRENT directory; `git diff`
    // prints them relative to the REPOSITORY ROOT. In an app that is its own
    // repository the two agree and nothing shows; in one that sits in a
    // subdirectory (this template inside its factory, or any monorepo) they do
    // not, and the same planted key came back twice — once as `lib/x.ts` and
    // once as `<subdir>/lib/x.ts` — because the dedup key could never line up.
    // `--relative` also scopes the diff to this app, which is the right scope.
    const staged = await capture("git", ["diff", "--cached", "--name-only", "--relative", "-z"], { cwd });
    const stagedOk = Number(staged.code) === 0;
    const stagedPaths = stagedOk ? splitNul(staged.stdout) : [];
    // 🚨 A FAILED `git diff --cached` used to read exactly like a clean index:
    // the evidence said `git diff --cached (0 staged)` either way. A running
    // rebase, an `index.lock`, a damaged index — and the half this rung was
    // built for ("a secret that was staged and then edited out of the working
    // copy") silently did not happen. `skipReason()` already existed for this
    // and was never used on this call.
    const stagedNote = stagedOk
      ? `git diff --cached (${stagedPaths.length} staged)`
      : `⚠️ git diff --cached was NOT read: ${skipReason(staged)}`;

    for (const path of stagedPaths) {
      // `:./<path>` — the leading `./` is what makes git read the path relative
      // to the current directory instead of the repository root, matching what
      // `--relative` just handed over.
      const blob = await capture("git", ["show", `:./${path}`], { cwd });
      // A path staged for DELETION has no blob to show. Not a finding and not a
      // skipped file: there is nothing there to read.
      if (Number(blob.code) !== 0) continue;
      if (blob.stdout.length > MAX_BYTES || blob.stdout.slice(0, BINARY_PROBE).includes("\0")) {
        skippedFiles += 1;
        continue;
      }
      for (const row of scanText(blob.stdout, { path, blank: isSourceFile(path) })) {
        if (row.accepted) {
          // Same rule as on disk. The dedup below is for FINDINGS; an accepted
          // match that exists in both copies is one acceptance, so it is only
          // kept when the disk pass did not already see it.
          if (!onDisk.has(`${path}:${row.line}:${row.ruleId}`)) {
            accepted.push(findingFrom(row, path, true));
          }
          continue;
        }
        // The same rule at the same line, already reported off the disk copy, is
        // ONE finding rather than two — the operator fixes it once. What survives
        // is what the disk does not have: the value staged and then edited out.
        if (onDisk.has(`${path}:${row.line}:${row.ruleId}`)) continue;
        findings.push(findingFrom(row, path, true));
      }
    }

    // ── the `.env` half ─────────────────────────────────────────────────────
    //
    // 🚨 In the INDEX is CRITICAL; merely present on this machine is ℹ️ LOW.
    // Two different facts, and rating them the same is how an operator learns to
    // scroll past the whole report.
    const committedEnv = tracked.filter(
      (path) => !path.includes("/") && ANY_ENV.test(path) && !COMMITTABLE_ENV.test(path),
    );
    for (const name of committedEnv) {
      const { text } = textOf(join(cwd, name));
      findings.push(committedEnvFinding(name, countSecrets(text ?? "", { path: name })));
    }

    let localEnvs = 0;
    for (const name of envFilesIn(cwd)) {
      if (committedEnv.includes(name)) continue;
      const { text } = textOf(join(cwd, name));
      if (text === null) continue;
      localEnvs += 1;
      findings.push(localEnvFinding(name, countSecrets(text, { path: name })));
    }

    const skippedNote =
      `${skippedFiles} skipped as binary or oversized` +
      (unreadable > 0 ? `, ${unreadable} unreadable` : "");

    // A rung that found something must still report `found` — `aggregate()`
    // discards a skipped outcome's findings — so the unread half travels in the
    // evidence there, and only an otherwise-clean run becomes a skip.
    if (findings.length === 0 && !stagedOk) {
      return {
        state: "skipped",
        reason: `the staged half could not be read: ${skipReason(staged)}`,
        findings: [],
      };
    }

    return {
      state: findings.length > 0 ? "found" : "clean",
      findings,
      accepted,
      evidence:
        `git ls-files --cached (${tracked.length} file(s), ${skippedNote}), ` +
        `${stagedNote}` +
        (localEnvs > 0 ? `, plus ${localEnvs} local .env file(s) counted apart` : "") +
        ". 🚨 Git HISTORY was NOT scanned — a value that was committed and then " +
        "deleted is invisible here; that is a rung of its own and it needs gitleaks.",
    };
  },
};

/**
 * The `.env` files on this machine that legitimately hold live values.
 *
 * The directory is listed rather than a fixed list probed, because `.env.*.local`
 * is a pattern and an app may have several. Root only: a `.env` two folders down
 * belongs to something that is not this app.
 *
 * @param {string} cwd
 * @returns {string[]}
 */
function envFilesIn(cwd) {
  try {
    return readdirSync(cwd)
      .filter((name) => LOCAL_ENV.test(name) && existsSync(join(cwd, name)))
      .sort();
  } catch {
    return [];
  }
}
