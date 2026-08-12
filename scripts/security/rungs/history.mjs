// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Rung 9, tier 2 — a credential that was committed at some point, found with
// gitleaks where gitleaks happens to be here.
//
// `rungs/secrets.mjs` answers "is there a credential in the files git is about
// to publish". This one answers the other half and says so in its own `covers`
// line: **was one ever committed** — a value that was in the tree in March and
// deleted in April is invisible to that rung and is still out there, because a
// commit is public the moment it is pushed.
//
// ── 🚨 It never installs gitleaks ──────────────────────────────────────────
//
// No `go install`, no `npx`, no download. `hasCommand("gitleaks", ["version"])`
// asks whether it is already here; if it is not, this rung reports
// `⏭ NOT ASKED` with the one-line way to get it and the run carries on at
// exit 0. The reasoning is in `../tier2.mjs`, and `../rungs.test.ts` enforces it
// on this file's source rather than trusting this paragraph.
//
// ⚠️ `hasCommand("gitleaks", ["version"])` — that tool's version subcommand
// takes NO dashes. `hasCommand()`'s default is `["--version"]`, and gitleaks
// exits non-zero on it, so the default would report a present gitleaks as
// absent: a rung that skips on a machine that could have answered.
//
// ── "Clean" and "could not look" are not the same answer ───────────────────
//
// gitleaks exits **non-zero when it finds leaks** (`--exit-code`, 1 by default)
// **and** when it fails — exactly the ambiguity `rungs/advisories.mjs` writes out
// for `npm audit`. Measured here on 8.30.1: a repository with one leaked token
// exits 1 and writes `[…]`; a clean one exits 0 and writes `[]`. So the exit code
// cannot be the discriminator and neither can a match on the error text. The
// structural one is **the report file exists and parses as JSON**: a report ⇒ an
// answer, no report ⇒ this rung did not run and says so.
//
// ── 🚨 The finding never carries the secret ────────────────────────────────
//
// `--redact` is not optional. `Where:` is `<path>:<line> @ <short commit>` and
// `Evidence:` names the gitleaks rule id and the commit's date — the operator has
// `git show` and does not need the value pasted into a report that a scheduled
// job may one day write down (`../rules.mjs:496-520`).
//
// Rated ❌ HIGH, never CRITICAL. The skill's own verdict table
// (`.claude/skills/security-gateway/references/checks-secrets-and-deps.md:43-50`)
// gives CRITICAL to "it is in the tree right now", which is Story 30.6's claim —
// a claim this rung cannot see and must not restate.
//
// Plain Node, no dependency — Linux, macOS and Git Bash on Windows. `gitleaks`
// and `git` are real executables on all three, started through `capture()` with
// an args array, so no shell is involved and a repository path containing a space
// needs no quoting. The report goes into a throwaway directory from
// `mkdtempSync(tmpdir())` — never `mktemp`, never a path under the customer's
// tree — and is removed in a `finally`.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { capture, hasCommand } from "../../lib/proc.mjs";
import { firstLine, gitleaksMissing, unanswered } from "../tier2.mjs";

const SOURCE = "gitleaks";

/** The wall clock this rung is bounded by. A repository's history has no size limit. */
export const TIMEOUT_MS = 60_000;

/**
 * The two spellings of the same question.
 *
 * gitleaks renamed the history scan from `detect --source <path>` to
 * `git <path>` in 8.19 and hid the old one — it still runs on 8.30.1, and an
 * older gitleaks does not know the new one. A customer's machine may carry
 * either, so both are tried, newest first, and the discriminator does the
 * deciding: the first spelling that leaves a parseable report is the answer.
 *
 * @param {string} cwd
 * @param {string} report
 * @param {string|null} config
 * @returns {string[][]}
 */
export function attempts(cwd, report, config) {
  const shared = [
    "--report-format",
    "json",
    "--report-path",
    report,
    // 🚨 Not optional, and not a preference. Without it the report carries the
    // value, and this file's whole promise is that nothing downstream can.
    "--redact",
    "--no-banner",
    // gitleaks colours its own stderr, and this rung quotes the first line of it
    // back as a skip reason — which travels into `.dev/security-check.json`.
    // Measured: without this, that file carried raw ANSI escape sequences.
    "--no-color",
    ...(config ? ["--config", config] : []),
  ];
  return [
    ["git", cwd, ...shared],
    ["detect", "--source", cwd, ...shared],
  ];
}

/**
 * Why this rung could not look — this app's own sentence about a TOOL.
 *
 * Never a path out of somebody's repository and never anything a person typed:
 * the reason travels into `.dev/security-check.json`, which `docs/cron.md`
 * restricts to exactly that. `capture()` reports a missing binary as 127
 * (`scripts/lib/proc.mjs:198-221`).
 *
 * @param {{code: number, stderr: string}} result
 * @returns {string}
 */
export function repositorySkipReason(result) {
  if (Number(result?.code) === 127) return "git is not on this machine's PATH";
  const said = String(result?.stderr ?? "").replace(/\s+/g, " ").trim();
  if (/not a git repository/i.test(said)) {
    return "this folder is not a git repository, so it has no history to scan";
  }
  return said
    ? `git could not say whether this is a repository: ${said}`
    : "git could not say whether this is a repository";
}

/**
 * The report, or null.
 *
 * 🚨 This is the discriminator, and it is deliberately structural: a file that
 * is there and parses as a JSON array is an answer. A missing file, a truncated
 * one, a non-zero exit with nothing written — all null, all a skip.
 *
 * @param {string} path
 * @returns {object[]|null}
 */
export function readReport(path) {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * One gitleaks row as one `Finding`.
 *
 * The shape is measured rather than assumed — gitleaks 8.30.1, a throwaway
 * repository with one token committed and deleted again:
 *
 *   { "RuleID": "github-pat", "Description": "Uncovered a GitHub Personal…",
 *     "StartLine": 1, "File": "secret.js", "Secret": "REDACTED",
 *     "Commit": "1cbc29e4…", "Date": "2026-08-10T21:37:18Z", … }
 *
 * `Secret` and `Match` are read by nothing here, on purpose.
 *
 * @param {Record<string, unknown>} row
 * @returns {import("../rules.mjs").Finding}
 */
export function findingFrom(row) {
  const rule = String(row?.RuleID ?? "unknown-rule");
  const commit = String(row?.Commit ?? "");
  const date = String(row?.Date ?? "");
  const file = String(row?.File ?? "");
  const line = Number(row?.StartLine ?? 0) || 0;

  return {
    // ❌ HIGH and never 🚨 CRITICAL — see this file's header. CRITICAL is
    // "it is in the tree right now", and that is the working-tree rung's claim.
    severity: "high",
    title: `${rule} — a credential in this repository's history`,
    where: `${file}:${line}${commit ? ` @ ${commit.slice(0, 8)}` : ""}`,
    why:
      "It was committed at some point, so it is in every clone and every fork of " +
      "this repository — deleting it later changed the tip and nothing else. " +
      "Anybody who has ever had a copy still has the value.",
    // The ORDER is the point, and it is the one the skill ships: cleaning the
    // history first leaves a live credential out there while the rewrite runs.
    fix:
      "In this order: 1. rotate it at whatever issued it — that is what makes the " +
      "copies worthless. 2. take it out of the code and read it from the " +
      "environment. 3. make sure the file holding it is in `.gitignore`. " +
      "4. clean the history LAST (git filter-repo, BFG), and tell anyone with a " +
      "clone to re-clone.",
    evidence:
      `gitleaks rule "${rule}"` +
      (date ? `, in a commit dated ${date}` : "") +
      // gitleaks' own descriptions end in a full stop; a second one reads as a typo.
      (row?.Description ? ` — ${String(row.Description).replace(/\.\s*$/, "")}` : "") +
      ". The scan ran with --redact, so the report holds no value and none is printed here.",
    source: SOURCE,
  };
}

/**
 * One thing found once.
 *
 * gitleaks reports a row per match, and the same key in the same file of the same
 * commit can come back several times (two rules, a re-scan of a merge). How many
 * times a tool counts one thing is not a fact about the app —
 * `rungs/advisories.mjs:86-124` collapses advisory paths for the same reason, and
 * the collapse is deliberately WITHIN this rung: no rung reads another's result,
 * so there is nowhere else it could happen.
 *
 * @param {object[]} rows
 * @returns {object[]}
 */
export function collapse(rows) {
  const seen = new Set();
  const kept = [];
  for (const row of rows ?? []) {
    // The separator is a character no path, rule id or commit hash can contain,
    // and it is written as an ESCAPE rather than as the raw byte: a control byte
    // in a source file makes git treat the whole file as binary — no reviewable
    // diff, no textual merge — and `scripts/portability.test.ts` fails the build
    // on exactly that, which is how this line got caught while it was written.
    const key = `${row?.File ?? ""}\u0000${row?.RuleID ?? ""}\u0000${row?.Commit ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(row);
  }
  return kept;
}

/** @type {import("../rules.mjs").Rung} */
export const history = {
  id: "secrets-history",
  label: "Secrets in git history (gitleaks)",
  // Tier 2: gitleaks may simply not be here, and then this rung says so rather
  // than failing. `tier` was shipped unused by the ladder's first story for
  // exactly this moment (`../rules.mjs:110-124`).
  tier: 2,
  covers:
    "credentials that were committed at some point, whether or not they are in the tree today",

  async run({ root } = {}) {
    const cwd = root ?? process.cwd();

    // The repository question FIRST, so "this is not a git repository" is its own
    // sentence rather than being reported as a missing tool. They are different
    // facts and the operator acts on them differently.
    const inside = await capture("git", ["rev-parse", "--git-dir"], { cwd });
    if (Number(inside.code) !== 0) {
      return { state: "skipped", reason: repositorySkipReason(inside), findings: [] };
    }

    if (!(await hasCommand("gitleaks", ["version"]))) return gitleaksMissing();

    // 🚨 `mkdtempSync` from node:fs, never `mktemp` — the shell tool takes an
    // argument on BSD/macOS and refuses one on GNU, and `portability.test.ts`
    // fails the build on it. Never a path under the customer's tree either: a
    // report full of rule ids in their repository is one they then have to
    // notice and delete.
    const directory = mkdtempSync(join(tmpdir(), "ds24-secrets-"));
    try {
      const report = join(directory, "gitleaks.json");
      // The repository's own rules, explicitly. gitleaks would find a
      // `.gitleaks.toml` at the target path by itself, but "would by itself" is
      // a property of a version rather than of this app: passing it is what makes
      // the shipped allowlist (the Digistore24 developer key, which carries no
      // rights) hold on every gitleaks anybody has.
      const own = join(cwd, ".gitleaks.toml");
      const config = existsSync(own) ? own : null;

      const started = Date.now();
      let last = { code: 127, stdout: "", stderr: "" };
      let rows = null;
      let spelling = "";

      for (const args of attempts(cwd, report, config)) {
        // 🚨 The bound is on the RUNG, not on the attempt. Two spellings at 60 s
        // each would be a two-minute wall clock wearing a one-minute label —
        // measured, before this line: a gitleaks that never returns took 120 s.
        // So the second attempt gets whatever is left of the budget, and no
        // attempt starts once there is nothing left.
        const remaining = TIMEOUT_MS - (Date.now() - started);
        if (remaining <= 0) break;
        // ⚠️ This used to say that a killed process whose own GRANDCHILD still
        // held the stdio pipes would hang past this bound — true when it was
        // written, and measured at 12 s against a 1 s bound. `capture()` now
        // settles the bound itself instead of leaving it to 'close', so the
        // limit holds whatever the tool starts. It stays worth knowing that
        // `gitleaks` is one static binary: the bound is enforced everywhere, but
        // the CLEANUP of a grandchild that left our process group is complete
        // only on POSIX.
        last = await capture("gitleaks", args, { cwd, timeout: remaining });
        rows = readReport(report);
        if (rows) {
          spelling = args[0];
          break;
        }
      }

      if (!rows) {
        // A child killed by `capture()`'s timeout resolves non-zero with no
        // report, which lands on the discriminator by itself — but the reason has
        // to name the BOUND rather than say "no report", or the operator learns
        // nothing and goes looking for a broken gitleaks.
        if (Date.now() - started >= TIMEOUT_MS) {
          return unanswered(
            `gitleaks did not finish within ${TIMEOUT_MS / 1000}s and was stopped — a partial scan is not a pass`,
          );
        }
        const said = firstLine(last.stderr) || firstLine(last.stdout);
        return unanswered(
          said ? `gitleaks wrote no report: ${said}` : "gitleaks wrote no report and said nothing",
        );
      }

      const kept = collapse(rows);
      const findings = kept.map(findingFrom);

      return {
        state: findings.length > 0 ? "found" : "clean",
        findings,
        evidence:
          `gitleaks ${spelling} over this repository's history, --redact, ` +
          `${config ? "with the repo's own .gitleaks.toml" : "with gitleaks' default rules"} ` +
          `— ${rows.length} row(s), ${kept.length} after collapsing (file, rule, commit).`,
      };
    } finally {
      // Always, including on the throw `check.mjs` would turn into this rung's
      // skip: a temporary directory left behind is one nobody ever deletes.
      rmSync(directory, { recursive: true, force: true });
    }
  },
};
