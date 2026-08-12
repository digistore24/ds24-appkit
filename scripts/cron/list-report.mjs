// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What `node run.mjs cron --list` MAKES of the app's answer, as pure functions.
//
// Separate from run.mjs for the reason every rules file in this project is
// separate from its shell (scripts/ux/rules.mjs says it at length): a rule that
// lives inside the script that prints it is a rule nothing asserts. These take
// a body and return a verdict — no fetch, no filesystem, no console, no exit
// code — so scripts/cron/list-report.test.ts can plant a broken answer and
// check that it is refused, which is the only way anybody ever learns that a
// check still works.
//
// The failure it exists for: `await response.json()` threw undici's own stack
// at the operator when a proxy answered HTML, and `body.jobs ?? []` rendered an
// answer with no job list as a clean, exit-0 run. "I could not look" and "there
// is nothing there" must never be the same answer (CLAUDE.md → Modules), and
// they were.
//
// 🚨 Three shapes, three different answers, and the third is the one that is
// easy to get wrong:
//
//   - the body does not parse           → a refusal, exit 1
//   - it parses and has no `jobs` array → a refusal, exit 1
//   - it parses and `jobs` is EMPTY     → a legitimate state, exit 0
//
// Plain Node, no dependency — Linux, macOS and Git Bash on Windows.
import { SEVERITY_GLYPHS } from "../security/rules.mjs";

/**
 * One finding out of `jobFindings()` (`lib/cron/rules.mjs`), structurally.
 *
 * @typedef {{ job?: string, kind?: string, severity?: string, what?: string }} CronFinding
 */

/**
 * The glyph for a finding of this kind, with its trailing space — or "".
 *
 * ONE glyph table in this template (`scripts/security/rules.mjs` → the ladder
 * `CLAUDE.md` names: 🚨 CRITICAL, ❌ HIGH, ⚠️ MEDIUM, ℹ️ LOW). Importing it is
 * the point: a second set of glyphs here would be a fifth severity vocabulary
 * that agrees today, and an operator reading two of them learns to trust
 * neither.
 *
 * The shape is spelled out rather than imported from `lib/cron/rules.mjs`
 * (`JobFinding`): this file's promise is that it reaches into no other tree, and
 * a `@param` is the one place where keeping that promise costs four words.
 *
 * @param {CronFinding[] | undefined} findings this job's findings
 * @param {"neverRun" | "failures"} kind
 */
function marker(findings, kind) {
  const hit = (findings ?? []).find((finding) => finding?.kind === kind);
  return hit ? `${SEVERITY_GLYPHS[hit.severity] ?? "•"} ` : "";
}

/**
 * How much of the app's answer gets quoted back at the operator.
 *
 * Long enough that an HTML error page names itself ("502 Bad Gateway" sits
 * inside the first eighty characters of every one of them), short enough that
 * a minified page does not become the whole terminal.
 */
const SAMPLE_MAX = 120;

/**
 * The first non-empty line of what arrived, trimmed and truncated visibly.
 *
 * `null` when there is nothing to quote — an empty body and a whitespace-only
 * one are the same case, and the refusal then says the answer was empty rather
 * than printing `it said:` with nothing after it.
 *
 * Split on `/\r?\n/`, never `"\n"` — CLAUDE.md → Three systems, and
 * `docs/machine.md` → *Line endings*. A proxy on a
 * Windows host is exactly the kind of thing that sends CRLF.
 */
export function firstLine(text) {
  const line = String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  return line.length > SAMPLE_MAX ? `${line.slice(0, SAMPLE_MAX)} … (truncated)` : line;
}

/**
 * Read the app's answer, or refuse with enough to act on.
 *
 * ⚠️ It takes the TEXT, not the `Response`. `response.json()` consumes the
 * stream and leaves nothing to quote, so the caller reads `response.text()`
 * first and parses here — text first, always.
 *
 * @param {{ status: number, url: string, text: string }} answer
 * @returns {{ ok: true, body: unknown }
 *          | { ok: false, kind: "unreadable", status: number, url: string, sample: string | null }}
 */
export function readBody({ status, url, text }) {
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, kind: "unreadable", status, url, sample: firstLine(text) };
  }
}

/**
 * The job list out of a parsed body — or a refusal that it is not in there.
 *
 * `body.jobs ?? []` was the defect this replaces: the key absent, `null`, or
 * something that is not an array all rendered as a clean run with no jobs. The
 * endpoint always sends `{ jobs: [...] }` (app/api/cron/route.ts), so a missing
 * one means the answer did not come from it.
 *
 * An EMPTY array is not a fault and is not refused here — see formatEmpty().
 *
 * @returns {{ ok: true, jobs: unknown[] }
 *          | { ok: false, kind: "noJobList", status: number, url: string }}
 */
export function jobsFrom(body, { status, url }) {
  if (Array.isArray(body?.jobs)) return { ok: true, jobs: body.jobs };
  return { ok: false, kind: "noJobList", status, url };
}

/**
 * The operator-facing refusal, as whole lines for stderr.
 *
 * The shape is the one the four branches above the parse in run.mjs already
 * use: what happened, then a command to try. Naming the status and the URL is
 * the whole point — "could not read the answer" on its own is the message this
 * replaces.
 *
 * 🚨 No line here may begin with a job id after trimming. `deploy-test.mjs`
 * finds a job's line with `l.trim().startsWith(id)` over stdout+stderr, so a
 * finding that started with one would be read as that job's line. Every line
 * below starts with `ERROR:`, a field name or a sentence.
 */
export function formatRefusal(result) {
  if (result.kind === "unreadable") {
    return [
      "ERROR: could not read the app's answer — it is not JSON.",
      `  status:  ${result.status}`,
      `  url:     ${result.url}`,
      result.sample === null
        ? "  it said: (the answer was empty)"
        : `  it said: ${result.sample}`,
      "Something else may be answering on that port. Check what is running:  node run.mjs status",
    ];
  }
  return [
    "ERROR: the app answered without a job list.",
    `  status:  ${result.status}`,
    `  url:     ${result.url}`,
    "That answer did not come from this app's /api/cron. Check what is running:  node run.mjs status",
  ];
}

/**
 * A registry with no jobs in it — a state, not a fault.
 *
 * 🚨 This is the case this whole file must NOT turn into an error. The core
 * registers seven jobs, so an empty array does not occur in a shipped app,
 * which is exactly why it is easy to get wrong: no glyph from the severity
 * ladder, no "ERROR", no "could not", and the caller keeps exit 0 and still
 * prints the footer, because the command is still usable.
 */
export function formatEmpty() {
  return ["  No jobs are registered.", ""];
}

/**
 * One job's block, byte for byte the shape run.mjs has always printed — plus
 * the finding markers, where this job has any.
 *
 * `describeEvery` and `ago` arrive as arguments so this module imports nothing
 * from the app tree and stays pure. `findings` are THIS job's findings out of
 * `jobFindings()` (`lib/cron/rules.mjs`); an empty list is the ordinary case
 * and prints exactly what it always printed.
 *
 * 🚨 Two properties of the first line are read by `deploy-test.mjs` and may not
 * move: `line.trim().startsWith(<job id>)` — so no marker, glyph or prefix
 * before the id — and `/OFF/` matching on a disabled job, so nothing may be
 * inserted between the id and the state. **That is why a finding marks the
 * `last run:` line and the failure line and never the header**, even though the
 * header is where the eye goes first: a `⚠️ ` in front of `prune-ai-usage`
 * would turn the module profile's release gate red about a job it could no
 * longer find.
 *
 * @param {Record<string, any>} job one row out of `{ jobs: [...] }`
 * @param {{ describeEvery: (minutes: number) => string,
 *           ago: (iso: any) => string,
 *           findings?: CronFinding[] }} deps
 */
export function formatJob(job, { describeEvery, ago, findings = [] }) {
  const state = job.enabled ? describeEvery(job.everyMinutes) : "OFF";
  const lines = [
    `  ${job.job}  —  ${state}`,
    `    ${job.describe}`,
    `    ${marker(findings, "neverRun")}last run: ${ago(job.lastFinishedAt)}` +
      (job.lastOutcome ? ` (${job.lastOutcome})` : "") +
      (job.lastDetail ? ` — ${job.lastDetail}` : ""),
  ];
  if (job.failures > 0) {
    // The `⚠` fallback is the shape from before anything judged these rows, and
    // it is what a caller that passes no findings still gets. The shipped
    // command always judges, so what it prints is the ladder's ❌.
    const glyph = marker(findings, "failures") || "⚠ ";
    lines.push(`    ${glyph}${job.failures} of ${job.runs} run(s) failed`);
  }
  if (job.lockedAt) lines.push(`    running since ${ago(job.lockedAt)}`);
  lines.push("");
  return lines;
}

/**
 * The one line the listing ends on: how many findings, or that there are none.
 *
 * A listing that says nothing at the end is one an operator reads as "fine",
 * because a wall of identical-looking blocks is a wall. This is the sentence
 * that has to be different when something is wrong.
 *
 * 🚨 **It never changes the exit code, and that is deliberate.** `--list` is a
 * view somebody runs casually; on a freshly deployed app EVERY enabled job
 * reports `never`, and `scripts/deploy-test.mjs` reads a non-zero exit as a
 * failed release. A finding here is a sentence, not a verdict — the verdict and
 * the mail belong to their own commands, one reporter per channel.
 *
 * 🚨 No line may begin with a job id after trimming (see `formatRefusal`): this
 * one begins with `✓` or a ladder glyph.
 *
 * @param {CronFinding[]} findings every finding, over the whole list
 * @returns {string} one line
 */
export function formatFindingsSummary(findings) {
  const list = Array.isArray(findings) ? findings : [];
  if (list.length === 0) {
    return "✓ No findings — every enabled job has run, and none is failing.";
  }

  const never = list.filter((finding) => finding?.kind === "neverRun").length;
  const failing = list.filter((finding) => finding?.kind === "failures").length;
  const parts = [];
  if (never > 0) parts.push(`${never} enabled job(s) have never run`);
  if (failing > 0) parts.push(`${failing} job(s) have failing runs`);

  const worst = list.some((finding) => finding?.severity === "high") ? "high" : "medium";
  return `${SEVERITY_GLYPHS[worst]} ${list.length} finding(s): ${parts.join(", ")}.`;
}
