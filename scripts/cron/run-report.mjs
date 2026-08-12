// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What `node run.mjs cron` and `node run.mjs cron --job <id>` MAKE of the app's
// answer, as pure functions.
//
// The sibling of `list-report.mjs`, and it exists for the same defect one
// function further along: `const results = body.results ?? [];` read an answer
// that carried no results AT ALL as a run in which nothing had been due, printed
// "Nothing to do — no job is due." and exited 0. "I could not look" and "there
// was nothing to do" must never be the same answer (CLAUDE.md → Modules).
//
// ── Why it is a separate file and not more of list-report.mjs ───────────────
// The parse is shared and stays there: `readBody()` sits ABOVE the fork in
// run.mjs and all three modes read the same body, so a second copy of it would
// be the shape of the defect this fixes. What is NOT shared is everything below
// the fork — the list has jobs, findings and a severity ladder, the run has
// outcomes, a registry and an exit code that means "a scheduled job failed".
// Two vocabularies, two files, one parse.
//
// ── The `known` list is the whole point ────────────────────────────────────
// `runDueJobs()` returns ONE result per registered job — `skipped` for the ones
// that were not due (`lib/cron/run.ts`). So a real bare run of a shipped app
// NEVER answers with an empty `results`: seven core jobs mean seven rows, most
// of them `·`. An empty array therefore means one of exactly two things, and
// `known` — which `app/api/cron/route.ts` has always sent and which nothing has
// ever read — is what tells them apart:
//
//   `known: []`         → the registry really is empty. A STATE, exit 0
//   `known: [<ids>]`    → it knows those jobs and reported on none. A refusal
//   no `known` at all   → it cannot say what it knows. A refusal
//
// 🚨 The legitimate case this file must NOT turn into an error is a different
// one, and it is the ordinary one: **a run in which no job was DUE**. That
// answer is a full `results` array of `skipped` rows, it is what a manual run
// gets almost every time, and it stays exit 0 with a sentence of its own
// (`formatRunSummary`). An empty `results` is not that case — it cannot be.
//
// Plain Node, no dependency — Linux, macOS and Git Bash on Windows.

/**
 * One row of `{ results: [...] }` (`JobResult` in `lib/cron/run.ts`).
 *
 * Spelled out rather than imported: this file reaches into no other tree, which
 * is what lets `run-report.test.ts` plant a broken answer without a database.
 *
 * @typedef {{ job: string, outcome?: string, detail?: string, ms?: number }} RunResult
 */

/**
 * Where the answer came from, for every refusal below.
 *
 * @typedef {{ status: number, url: string }} At
 */

/**
 * The results out of a parsed body — or a refusal that they are not in there.
 *
 * `body.results ?? []` was the defect this replaces: the key absent, `null`, or
 * something that is not an array all rendered as a clean run with nothing due,
 * and `{ jobs: [...] }` — the answer of the OTHER query on the same endpoint —
 * did it too.
 *
 * ⚠️ The rows are checked, not only the array. `{ results: [{}] }` would
 * otherwise print `· undefined: undefined` and **exit 0**, because nothing in it
 * says `failed` — an unreadable answer wearing a healthy run's exit code, which
 * is this file's whole subject.
 *
 * @param {unknown} body
 * @param {At} at
 * @returns {{ ok: true, results: RunResult[] }
 *          | { ok: false, kind: "noResults" | "badResults", status: number, url: string }}
 */
export function resultsFrom(body, { status, url }) {
  const results = /** @type {any} */ (body)?.results;
  if (!Array.isArray(results)) return { ok: false, kind: "noResults", status, url };
  for (const row of results) {
    if (!row || typeof row !== "object" || typeof row.job !== "string" || row.job === "") {
      return { ok: false, kind: "badResults", status, url };
    }
  }
  return { ok: true, results };
}

/**
 * The registry the app named — or `null` when it did not name one.
 *
 * 🚨 `null` is never "no jobs". An app that says `known: []` has told us
 * something; an app that says nothing has not, and the two get different
 * answers (see the header). A deployed app older than this field is the one
 * honest reason for `null`, and every use below treats it as *I cannot tell*
 * rather than as a fault of the app.
 *
 * @param {unknown} body
 * @returns {string[] | null}
 */
export function knownJobs(body) {
  const known = /** @type {any} */ (body)?.known;
  if (!Array.isArray(known)) return null;
  if (!known.every((id) => typeof id === "string")) return null;
  return known;
}

/**
 * What an EMPTY `results` means on a bare run — the three-way split.
 *
 * @param {string[] | null} known out of `knownJobs()`
 * @param {At} at
 * @returns {{ ok: true, lines: string[] }
 *          | { ok: false, kind: "noRegistry" | "ranNothing", status: number, url: string,
 *              count?: number }}
 */
export function emptyRunVerdict(known, { status, url }) {
  if (!Array.isArray(known)) return { ok: false, kind: "noRegistry", status, url };
  if (known.length === 0) {
    // A state, not a fault — the run's counterpart to `formatEmpty()` in
    // list-report.mjs. No glyph, no "ERROR", and the caller keeps exit 0: an app
    // whose registry is empty ran nothing because there was nothing to run, and
    // said so. It does not occur in a shipped app (the core registers seven),
    // which is exactly why the over-correction is the tempting one.
    return { ok: true, lines: ["No jobs are registered — so nothing could have been due."] };
  }
  return { ok: false, kind: "ranNothing", status, url, count: known.length };
}

/**
 * The one result of a `--job <id>` answer — or a refusal that it is missing.
 *
 * The endpoint answers `{ results: [result] }` for exactly the job that was
 * named, always one row. An empty array is not "the job did nothing"; it is an
 * answer that does not say what happened, and it is the same silence
 * `emptyRunVerdict()` refuses on the bare path.
 *
 * @param {unknown} results
 * @param {At & { job: string }} at
 * @returns {{ ok: true, results: RunResult[] }
 *          | { ok: false, kind: "noJobResult", status: number, url: string, job: string }}
 */
export function jobResultFrom(results, { job, status, url }) {
  if (!Array.isArray(results) || results.length === 0) {
    return { ok: false, kind: "noJobResult", status, url, job };
  }
  return { ok: true, results: /** @type {RunResult[]} */ (results) };
}

/**
 * "I do not know that job" — the answer that today looks like "the job failed".
 *
 * `--job nosuchjob` comes back as `✗ nosuchjob: no such job: nosuchjob` and exit
 * 1 today, which is the same mark, the same shape and the same exit code as a
 * job that really ran and threw. Two different answers, one appearance.
 *
 * Two independent signals, and BOTH are checked on purpose:
 *
 *   - **the status.** `route.ts` answers 404 for exactly this and nothing else
 *     on the `?job=` path, and it has always done so — so this still works
 *     against a deployed app older than the `known` field.
 *   - **the registry.** `known` naming other jobs and not this one is the same
 *     statement made by the app itself, and it is what lets the message list
 *     what the app DOES have.
 *
 * @param {{ status: number, known: string[] | null, job: string }} answer
 */
export function isUnknownJob({ status, known, job }) {
  if (status === 404) return true;
  return Array.isArray(known) && !known.includes(job);
}

/**
 * The operator-facing refusal for a job this app does not have.
 *
 * It names what the app knows when the app said so, and points at `--list` when
 * it did not — never a bare "no such job", which is the message this replaces.
 *
 * @param {string} job
 * @param {string[] | null} known
 * @param {{ url: string }} at
 */
export function formatUnknownJob(job, known, { url }) {
  const lines = [`ERROR: this app has no scheduled job called "${job}".`, `  url:     ${url}`];
  if (Array.isArray(known) && known.length > 0) {
    lines.push(`  it knows: ${known.join(", ")}`);
  }
  lines.push("What exists, and when each last ran:  node run.mjs cron --list");
  return lines;
}

/**
 * The operator-facing refusal, as whole lines for stderr.
 *
 * The shape is `formatRefusal()`'s in list-report.mjs and the four branches
 * above the parse in run.mjs: what happened, the status, the URL, then a command
 * to try. Naming the status and the URL is the point — "could not read the
 * answer" on its own is the message this replaces.
 *
 * 🚨 No line here may begin with a job id after trimming. `deploy-test.mjs`
 * finds a job's line with `l.trim().startsWith(id)` over stdout+stderr; it reads
 * the `--list` output rather than this one, but the two are one command and a
 * line that could be mistaken for a job's line has no business in either.
 *
 * @param {{ kind: string, status: number, url: string, count?: number, job?: string }} result
 * @returns {string[]}
 */
export function formatRunRefusal(result) {
  const at = [`  status:  ${result.status}`, `  url:     ${result.url}`];
  const notThisApp =
    "That answer did not come from this app's /api/cron. Check what is running:  node run.mjs status";

  switch (result.kind) {
    case "noResults":
      return ["ERROR: the app answered without a list of what it ran.", ...at, notThisApp];
    case "badResults":
      return ["ERROR: the app answered with a result that names no job.", ...at, notThisApp];
    case "noRegistry":
      return [
        "ERROR: the app ran nothing and did not say which jobs it knows.",
        ...at,
        "A run reports on every registered job, due or not — so an empty answer is not",
        '"nothing was due". Check what is running:  node run.mjs status',
      ];
    case "ranNothing":
      return [
        `ERROR: the app knows ${result.count} job(s) and reported on none of them.`,
        ...at,
        "A run reports on every registered job, due or not. Ask what state they are in:",
        "  node run.mjs cron --list",
      ];
    case "noJobResult":
      return [
        `ERROR: the app said nothing about the job "${result.job}".`,
        ...at,
        "It was asked to run exactly that one. Check what is running:  node run.mjs status",
      ];
    default:
      // Unreachable while every caller passes a refusal this file made. A pure
      // function that threw here would turn a wrong branch into a stack trace
      // for the operator, which is the register this whole file argues against.
      return [`ERROR: the app's answer was refused (${result.kind}).`, ...at, notThisApp];
  }
}

/**
 * The one line a bare run ends on: what happened to the registry as a whole.
 *
 * The counterpart of `formatFindingsSummary()` for `--list`, and the place the
 * old "Nothing to do — no job is due." sentence moved to. It was attached to an
 * EMPTY `results`, where it was never true — the only answers that reach that
 * branch are answers this file now refuses. Here it is attached to the case it
 * describes: a full array of `skipped` rows, which is what a manual run gets
 * almost every time and is a normal state, not a finding.
 *
 * 🚨 It never changes the exit code. A run's exit code says one thing —
 * **a scheduled job FAILED** — because a host's scheduler reads it; "nothing was
 * due" is not a failure and must never become one.
 *
 * `--job <id>` gets no summary line: one result needs no tally, and the line
 * would read as a claim about the whole registry.
 *
 * @param {RunResult[]} results
 * @returns {string} one line
 */
export function formatRunSummary(results) {
  const rows = Array.isArray(results) ? results : [];
  const failed = rows.filter((row) => row?.outcome === "failed").length;
  const ran = rows.filter((row) => row?.outcome === "ok").length;

  if (failed > 0) return `✗ ${failed} of ${rows.length} job(s) failed.`;
  if (ran === 0) return `Nothing was due — ${rows.length} job(s) checked, none of them ran.`;
  return `✓ ${ran} of ${rows.length} job(s) ran, none failed.`;
}
