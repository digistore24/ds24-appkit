// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What a RECURRING security pass would look at — and what it would not.
//
//   node run.mjs security-scope           the text a person reads
//   node run.mjs security-scope --json    the same facts for an agent
//
// It is the computed half of `security-gateway` check 10 (`since`): the app has
// already been reviewed once, a dated report says when, and the question is what
// changed after it. This command answers that in files and in numbers. It judges
// nothing, writes nothing and always exits 0 — it reports a scope.
//
// ── 🚨 The failure this file exists to prevent ─────────────────────────────
//
// A full pass that finds nothing and a scoped pass that finds nothing print the
// same report. The first means *somebody looked at the app*; the second means
// *somebody looked at fourteen files*. Six weeks later `coach` reads the newest
// report, sees a date and a clean tally, and says the security pass is done.
//
// The numbers are available, so no adjective has to carry that weight: the app
// has *m* files and this scope covers *n* of them, and every answer here says
// `NOT looked at: <m-n> of <m> files. This is not a full pass.`
//
// ── Three ways a scope shrinks and looks like a better result ──────────────
//
// Each of them makes the changed set SMALLER, which reads as a cleaner app.
// That is why this is a command with a test and not a paragraph telling an agent
// to run `git diff`:
//
//   the base is a DATE          the report is named by day, the diff wants a
//                               commit. `git log --since=` and
//                               `git rev-list -1 --before=` disagree by a day at
//                               the boundary, and always in the same direction —
//                               a later base, a smaller scope.
//   untracked files             invisible to `git diff`, and exactly where a new
//                               page lands. A scope that drops them is a review
//                               of everything except the new work.
//   core.quotepath              at its default, `git diff --name-only` returns
//                               `"lib/kurs-\303\274bung.ts"` — quoted and escaped
//                               — for any path outside ASCII. Parsed line by
//                               line, every such file silently leaves the scope.
//
// 🚨 So **every git listing here uses `-z` and is split on `\0`**, and the base
// is `rev-list -1 --before=<date>T23:59:59`. One flag and one command; both are
// load-bearing and neither is decoration.
//
// ── What is never scoped ───────────────────────────────────────────────────
//
// `secrets` and `deps` run in FULL on every recurring pass, and this command
// says so rather than leaving it to prose. A credential in a file nobody touched
// this month is still out, and an advisory is published by a stranger without
// anybody changing a line. Neither is a function of the diff.
//
// ── When there is no scope, there is no scope ──────────────────────────────
//
// No dated report, no git, no commit at or before the report's day, not a
// repository at all: every one of those answers `mode: "full"` with itself as the
// reason. Never a smaller scope, never a guess — a diff against nothing is not a
// review.
//
// Plain Node, no dependency — Linux, macOS and Git Bash on Windows. git is
// started through `capture()`, never a shell; paths are compared with `/`; text
// read off disk is split on `/\r?\n/`. Nothing here runs at import time, so the
// pure half above `main()` is importable by a test that spawns nothing.
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { capture, hasCommand } from "../lib/proc.mjs";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Where the gateways write their dated reports. Created on demand, not shipped. */
export const REPORTS_DIR = "docs/reports";

// ── the pure half ───────────────────────────────────────────────────────────

/**
 * `security-YYYY-MM-DD.md`, optionally `-2`, `-3` for a second run on one day.
 *
 * 🚨 **The NAME is the date.** A heading inside the file is prose somebody
 * edited, and a report whose heading and file name disagree is one this command
 * must not have an opinion about.
 */
const REPORT_NAME = /^security-(\d{4})-(\d{2})-(\d{2})(?:-(\d+))?\.md$/;

/**
 * The ISO date out of a report's file name — `null` for anything else.
 *
 * `security-accepted.md` is the file this has to refuse by name: it is a real
 * file in `docs/reports/`, it belongs to this skill, and it carries no date at
 * all. `module-removals.md` is the second (`scripts/modules/cli.mjs` writes it).
 * Neither is a report of a run, and treating one as "the newest" would take the
 * base commit somewhere arbitrary.
 *
 * @param {string} fileName
 * @returns {string|null}
 */
export function reportDate(fileName) {
  const match = REPORT_NAME.exec(String(fileName ?? "").trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const m = Number(month);
  const d = Number(day);
  // A calendar check rather than a real date: `2026-13-40` is a typo in a file
  // name, and answering with it would put the base commit at the end of time.
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${year}-${month}-${day}`;
}

/**
 * The `-2` / `-3` suffix as a number; a plain name is the day's first report.
 *
 * @param {string} fileName
 * @returns {number}
 */
export function reportSeq(fileName) {
  const match = REPORT_NAME.exec(String(fileName ?? "").trim());
  if (!match) return 0;
  return match[4] ? Number(match[4]) : 1;
}

/**
 * The newest dated report in a list of file names — by date, then by suffix.
 *
 * Deterministic on a tie (the name decides), because a scope that moved with the
 * order a directory happened to be read in would be a scope nobody can reproduce.
 *
 * @param {string[]} names
 * @returns {string|null}
 */
export function newestReport(names) {
  const dated = (names ?? [])
    .map((name) => String(name))
    .filter((name) => reportDate(name) !== null)
    .sort((a, b) => {
      const byDate = String(reportDate(a)).localeCompare(String(reportDate(b)));
      if (byDate !== 0) return byDate;
      const bySeq = reportSeq(a) - reportSeq(b);
      if (bySeq !== 0) return bySeq;
      return a.localeCompare(b);
    });
  return dated.length > 0 ? dated[dated.length - 1] : null;
}

/**
 * The areas a diff can never be trusted to bound — reviewed WHOLE when the
 * changed set so much as touches them.
 *
 * 🚨 **A named list in code, never a judgement made per run.** "Is this file
 * sharp enough to widen the scope" asked freshly every time is a question whose
 * answer drifts towards no, quietly, on the runs where somebody is in a hurry.
 *
 * Every path here is drawn from `security-gateway`'s own §2 and §3 file lists and
 * from nowhere else, and `scope.test.ts` holds the two against each other: a path
 * that is in this list and not in the skill is a rule only one of them knows.
 *
 * A path ending in `/` is a prefix; anything else is one file.
 *
 * @type {{area: string, paths: string[], why: string}[]}
 */
export const ALWAYS_IN_FULL = [
  {
    area: "money",
    paths: ["lib/digistore/", "app/api/ipn/route.ts", "lib/entitlements/", "lib/tokens/"],
    why:
      "The signature check, idempotency and what a purchase unlocks. One changed " +
      "line here can hand every product away for free, and the surrounding code is " +
      "what says whether it does.",
  },
  {
    area: "authentication",
    paths: [
      "auth.ts",
      "auth.config.ts",
      "proxy.ts",
      "lib/authz.ts",
      "lib/roles.ts",
      "lib/impersonation/",
      "lib/credentials/hash.ts",
      "lib/rate-limit.ts",
      "lib/email-change/",
    ],
    why:
      "Who may see and change what. Protection here is opt-in, so a change to one " +
      "guard moves every route behind it — the diff shows the guard, never the " +
      "doors it just opened.",
  },
  {
    area: "customer data",
    paths: ["db/schema.ts", "lib/privacy/", "lib/ai/tools.ts", "lib/setup/", "modules/api/keys/"],
    why:
      "What the app holds about people, what leaves it, and the surfaces that take " +
      "a member id by design. A column added in one line is a column two exports " +
      "and a deletion path have to know about.",
  },
];

/**
 * Changed files no check reads.
 *
 * Reported, never dropped: a `messages/de.json` in the diff is not a security
 * surface, and saying that out loud is different from letting it vanish out of a
 * count nobody can reconstruct.
 */
export const UNCOVERED_PREFIXES = ["messages/", "docs/", "public/"];

/** `\` → `/`, blanks out, duplicates out, sorted. The comparison form for every path here. */
export function normalizePaths(files) {
  const seen = new Set();
  for (const raw of files ?? []) {
    const path = String(raw).replace(/\\/g, "/").replace(/^\.\//, "").trim();
    if (path) seen.add(path);
  }
  return [...seen].sort();
}

/** Does this path fall under that entry? A trailing `/` is a prefix, anything else is one file. */
function matchesPath(file, path) {
  return path.endsWith("/") ? file.startsWith(path) : file === path;
}

/**
 * Which always-in-full areas the changed set pulls in, each with the files that
 * pulled it in.
 *
 * Empty input gives an empty answer — never "all of them" and never "none of
 * them, so this is fine".
 *
 * @param {string[]} files
 * @returns {{area: string, why: string, files: string[]}[]}
 */
export function areasFor(files) {
  const changed = normalizePaths(files);
  const out = [];
  for (const entry of ALWAYS_IN_FULL) {
    const pulled = changed.filter((file) => entry.paths.some((path) => matchesPath(file, path)));
    if (pulled.length > 0) out.push({ area: entry.area, why: entry.why, files: pulled });
  }
  return out;
}

/**
 * Changed files that no check on this ladder reads.
 *
 * A file that pulled an area in whole is never "uncovered", whatever its name —
 * the area answer outranks this one.
 *
 * @param {string[]} files
 * @returns {string[]}
 */
export function uncoveredFiles(files) {
  const pulled = new Set(areasFor(files).flatMap((entry) => entry.files));
  return normalizePaths(files).filter(
    (file) =>
      !pulled.has(file) &&
      (UNCOVERED_PREFIXES.some((prefix) => file.startsWith(prefix)) || file.endsWith(".md")),
  );
}

/** `1 area` / `2 areas` / `no area`, so the header line reads as a sentence. */
function areaPhrase(count) {
  if (count === 0) return "no area";
  return count === 1 ? "1 area" : `${count} areas`;
}

/**
 * The header block a scoped report carries ABOVE its tally.
 *
 * 🚨 **An empty file list is a SENTENCE, never a zero tally.** `0 files changed,
 * 0 areas reviewed in full` has the shape of a clean full pass and would be a lie
 * by formatting; what actually happened is that nothing changed and the previous
 * report's verdict still stands. AC7 of story 31.1, and the whole reason this
 * function exists rather than a template string at the call site.
 *
 * @param {{report?: string|null, base?: string|null, files?: string[], areas?: unknown[], total?: number}} input
 * @returns {string}
 */
export function scopeSummary({ report = null, base = null, files = [], areas = [], total = 0 } = {}) {
  const changed = normalizePaths(files);
  const where = report ? `${REPORTS_DIR}/${report}` : "the newest report";
  const commit = base ? ` (base ${String(base).slice(0, 7)})` : "";

  if (changed.length === 0) {
    return (
      "Scope:  " +
      wrapSentence(
        `nothing has changed since ${where}${commit}. The verdict of that report still ` +
          `stands, so this run carries no severity tally of its own. secrets and deps ran ` +
          `in full anyway — they can find something new on an unchanged tree, and their ` +
          `result is the only fresh number here.`,
        { width: 70, indent: "        " },
      )
    );
  }

  const app = Math.max(Number(total) || 0, changed.length);
  const notLooked = app - changed.length;

  return (
    `Scope:  since ${where}${commit} — ${changed.length} file(s) changed,\n` +
    `        ${areaPhrase((areas ?? []).length)} reviewed in full. ` +
    `NOT looked at: ${notLooked} of ${app} files.\n` +
    `        This is not a full pass.`
  );
}

// ── the half that reads git and disk ────────────────────────────────────────

/**
 * A `-z` listing from git, split on NUL — or `null` when git refused.
 *
 * 🚨 `null` and `[]` are two different answers and are never merged: an empty
 * listing is "nothing changed there", a refusal is "nobody looked". Only the
 * caller may decide what a refusal means, and here it always means: no scope.
 */
async function gitZ(args, cwd) {
  const { code, stdout } = await capture("git", args, { cwd });
  if (code !== 0) return null;
  return stdout.split("\0").filter((entry) => entry.length > 0);
}

/**
 * The last commit at or before the END of the report's day.
 *
 * The report is named by day and a diff wants a commit, so the boundary has to be
 * picked deliberately: `23:59:59` of that day, so everything committed ON the day
 * the report was written is BEHIND the base and everything after it is in scope.
 * The other rounding — the start of the day — would put the report's own day's
 * work into every subsequent scope for ever.
 *
 * The timestamp carries no zone, so git reads it in local time. That is the right
 * frame: the report was named by the clock on the machine that wrote it.
 */
async function baseCommitFor(date, cwd) {
  const { code, stdout } = await capture(
    "git",
    ["rev-list", "-1", `--before=${date}T23:59:59`, "HEAD"],
    { cwd },
  );
  if (code !== 0) return null;
  const commit = stdout.split(/\r?\n/)[0]?.trim() ?? "";
  return commit.length > 0 ? commit : null;
}

/** The report file names in `docs/reports/`, or an empty list when there is no folder. */
function reportNames(cwd) {
  const dir = join(cwd, REPORTS_DIR);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

/**
 * Wrap a sentence at `width`, continuation lines carrying `indent`.
 *
 * The refusal below is one sentence with a reason of unknown length spliced into
 * it, so where the line breaks cannot be written by hand. Word-wrapped here, not
 * left to the terminal: a wrapped-by-accident line has no hanging indent and the
 * `Scope:` label stops standing out, which is the only reason the block is
 * readable at a glance.
 */
export function wrapSentence(text, { width = 74, indent = "       " } = {}) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.map((entry, index) => (index === 0 ? entry : indent + entry)).join("\n");
}

/** The answer shape for "there is no scope here" — a MODE, not an error. */
function fullMode(reason) {
  return {
    mode: "full",
    reason,
    report: null,
    base: null,
    files: { all: [], committed: [], staged: [], unstaged: [], untracked: [] },
    inFull: [],
    uncovered: [],
    notLooked: { count: 0, total: 0 },
    summary: wrapSentence(
      `Scope: FULL — ${reason} A diff against nothing is not a review, so this pass ` +
        `reads the app rather than a change set.`,
    ),
  };
}

/**
 * Work out the scope. Returns the whole answer as data; prints nothing.
 *
 * @param {{root?: string}} [options]
 */
export async function scope({ root = PROJECT_ROOT } = {}) {
  const cwd = root;

  if (!(await hasCommand("git"))) {
    return fullMode("git is not on this machine, so nothing here can say what changed.");
  }

  const report = newestReport(reportNames(cwd));
  if (!report) {
    return fullMode(`no dated report in ${REPORTS_DIR}/.`);
  }
  const date = String(reportDate(report));

  const base = await baseCommitFor(date, cwd);
  if (!base) {
    return fullMode(
      `git has no commit at or before ${date} (a shallow clone, a repository ` +
        `younger than the report, or no repository at all).`,
    );
  }

  // The four listings, each with `-z`. A refusal in any of them is no scope at
  // all: three quarters of a change set reported as a change set is exactly the
  // failure at the top of this file.
  //
  // ⚠️ `--relative` is not decoration either. `git diff` prints paths from the
  // REPOSITORY root, `git ls-files` prints them from the current directory — so
  // an app that is a subfolder of a larger repository would get a change set in
  // one spelling counted against a total in another, and `db/schema.ts` would
  // never match `apps/shop/db/schema.ts`. With it, all four listings speak the
  // app's own paths. Where the app IS the repository root it changes nothing.
  // 🚨 `--no-renames`, in all three. Git's rename detection reports a moved file
  // ONCE, under its new path — so `git mv lib/digistore/ipn.ts lib/payments/`
  // dropped `lib/digistore/` out of the change set entirely and the money area
  // was never pulled in. Measured 2026-08-15 against real git: with detection
  // the diff names one path, without it names both. A move is a change to BOTH
  // places, and this file's whole job is deciding which areas a change reaches.
  const RENAMES = "--no-renames";
  const committed = await gitZ(
    ["diff", RENAMES, "--relative", "--name-only", "-z", base, "HEAD"],
    cwd,
  );
  const working = await gitZ(["diff", RENAMES, "--relative", "--name-only", "-z", "HEAD"], cwd);
  const staged = await gitZ(["diff", RENAMES, "--relative", "--name-only", "-z", "--cached"], cwd);
  const untracked = await gitZ(["ls-files", "--others", "--exclude-standard", "-z"], cwd);
  if (!committed || !working || !staged || !untracked) {
    return fullMode("git could not list what changed, so no change set could be built.");
  }

  const stagedSet = new Set(normalizePaths(staged));
  // `git diff HEAD` is the working tree against HEAD, so it already contains what
  // is staged; subtracting keeps those two buckets from reporting one file twice.
  // `committed` can still overlap the others — a file changed in a commit AND
  // edited since is honestly in both — which is why the total is the size of the
  // UNION and the printed line says the four numbers need not add up to it.
  const unstaged = normalizePaths(working).filter((file) => !stagedSet.has(file));

  const all = normalizePaths([...committed, ...staged, ...unstaged, ...untracked]);

  // What is in the APP, not what is on the disk — `node_modules/` is not the app.
  // The changed set is folded in because a file DELETED since the base was part of
  // what the previous report covered, and leaving it out would quietly lower the
  // number this whole command exists to print.
  const tracked = await gitZ(["ls-files", "-z"], cwd);
  if (!tracked) {
    return fullMode("git could not list this app's files, so nothing could be counted.");
  }
  const total = normalizePaths([...tracked, ...untracked, ...all]).length;

  const inFull = areasFor(all);
  return {
    mode: "since",
    reason: null,
    report: { file: `${REPORTS_DIR}/${report}`, date },
    base: {
      commit: base,
      short: base.slice(0, 7),
      chosen: `the last commit at or before ${date}T23:59:59 (local time)`,
    },
    files: {
      all,
      committed: normalizePaths(committed),
      staged: [...stagedSet].sort(),
      unstaged,
      untracked: normalizePaths(untracked),
    },
    inFull,
    uncovered: uncoveredFiles(all),
    notLooked: { count: Math.max(0, total - all.length), total },
    summary: scopeSummary({ report, base, files: all, areas: inFull, total }),
  };
}

// ── what a person reads ─────────────────────────────────────────────────────

/**
 * The whole answer as text.
 *
 * @param {Awaited<ReturnType<typeof scope>>} answer
 * @returns {string}
 */
export function renderScope(answer) {
  if (answer.mode === "full") {
    return [
      "Scope for a recurring security pass",
      "",
      `  ${answer.summary.split("\n").join("\n  ")}`,
      "",
      "  secrets and deps run in full either way — they are never scoped to a diff.",
    ].join("\n");
  }

  const lines = [
    "Scope for a recurring security pass",
    "",
    `  Report:  ${answer.report.file}   (${answer.report.date})`,
    `  Base:    ${answer.base.short}  — ${answer.base.chosen}`,
  ];

  // 🚨 An empty diff gets the SENTENCE and nothing else. The breakdown line below
  // would read `0 file(s)  committed 0 · staged 0 · unstaged 0 · untracked 0`,
  // which is the shape of a clean full pass — four zeroes and no adjective. It is
  // the exact failure this command was written to prevent, one line further down
  // than where anybody looks for it.
  if (answer.files.all.length === 0) {
    lines.push("", `  ${answer.summary.split("\n").join("\n  ")}`);
    return lines.join("\n");
  }

  lines.push(
    `  Changed: ${answer.files.all.length} file(s)   ` +
      `committed ${answer.files.committed.length} · staged ${answer.files.staged.length} · ` +
      `unstaged ${answer.files.unstaged.length} · untracked ${answer.files.untracked.length}` +
      `   (a file can be in more than one)`,
    "",
  );
  if (answer.inFull.length > 0) {
    lines.push("  In full (the diff touched them):");
    for (const entry of answer.inFull) {
      lines.push(`    ${entry.area.padEnd(15)} ${entry.files.join(", ")}`);
    }
  } else {
    lines.push("  In full: no area was pulled in — the diff touched none of them.");
  }

  if (answer.uncovered.length > 0) {
    lines.push("", "  Changed, and no check reads them:", `    ${answer.uncovered.join(", ")}`);
  }

  lines.push(
    "",
    `  NOT looked at: ${answer.notLooked.count} of ${answer.notLooked.total} files. ` +
      "This is not a full pass.",
    "  secrets and deps run in full anyway — they are never scoped to a diff.",
  );
  return lines.join("\n");
}

/** Print it. Always exit 0 — this reports a scope, it does not judge one. */
export async function securityScope(argv = [], { root = PROJECT_ROOT } = {}) {
  const answer = await scope({ root });
  if (argv.includes("--json")) console.log(JSON.stringify(answer, null, 2));
  else console.log(renderScope(answer));
  return 0;
}

// Run only when this file IS the command — compared as a resolved path rather
// than by name, because several scripts in this project share a stem. Importing
// it (the test, a later reader) runs nothing.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await securityScope(process.argv.slice(2)));
}
