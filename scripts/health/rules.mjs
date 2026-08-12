// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What `node run.mjs health` MAKES of six answers — pure.
//
// Separate from check.mjs for the reason every rules file in this project is
// separate from its shell: a rule that lives inside the script that prints it
// is a rule nothing asserts. Everything here takes objects and returns objects
// or strings — no fetch, no filesystem, no console, no exit code — so
// `scripts/health/rules.test.ts` can plant a broken answer and check that it is
// refused.
//
// ── The one thing this command must never do ───────────────────────────────
//
// Report `clean` for a question nobody asked. The vocabulary is the shipped
// ladder's (`scripts/security/rules.mjs`), imported and never re-typed, and it
// has exactly three words:
//
//   clean    it ran, and there is nothing to report — WITH an evidence line
//   found    it ran, and found something
//   skipped  it did NOT run, and then it owes a reason
//
// 🚨 **"There is nothing to check" is `clean` with an evidence line, never
// `skipped` and never a bare ✓.** An app with no products has no missing
// purchases; a DEV app on the local media driver has no bucket to be
// unreachable. Those questions were ASKED and ANSWERED, so a skip would be a
// lie in the other direction — and a bare `✓` beside `ipn` reads as *"payments
// are arriving"*, which is the single defect this whole epic is about.
//
// Plain Node, no dependency — Linux, macOS and Git Bash on Windows.
import { SEVERITIES } from "../security/rules.mjs";

/**
 * How this ladder closes, and what it calls its steps.
 *
 * The shipped renderer takes these as an optional argument (added in 0.24.0)
 * rather than being forked: two renderers is how two ladders come to disagree
 * about a glyph. The judgement half named here is `docs/DEPLOY.md` because
 * `security-gateway` — the other caller's — is the wrong skill for "your app is
 * down", and the operations doc that will eventually own this sentence
 * (Epic 37) does not exist yet. Naming a file that is not there would be worse
 * than naming one that is.
 */
export const VERDICT_TEXTS = Object.freeze({
  judgement: "What to do about a finding: docs/DEPLOY.md → Proving it works",
  noun: "probe",
  plural: "probes",
});

/**
 * The reason the other five probes give when nothing answered at all.
 *
 * 🚨 One string, shared, because it is one FACT. Five probes each writing their
 * own sentence about the same silence is five alarms about one thing, which is
 * the failure this split exists to prevent: `liveness` reports the finding,
 * everything else reports that it was not asked and why.
 */
export const UNREACHABLE_REASON = "the app did not answer at all; see the liveness probe";

/** How many distinct error causes are named before the block starts counting. */
export const MAX_ERROR_FINDINGS = 5;

/** A probe that did not run. `covers` comes off the probe, so only the reason is here. */
export function notAsked(reason) {
  return { state: "skipped", reason: String(reason), findings: [] };
}

/** A probe that ran and has nothing to report — never without saying what it saw. */
export function ranClean(evidence) {
  const line = String(evidence ?? "").trim();
  if (!line) {
    // 🚨 Refused rather than tolerated. A `clean` with no evidence renders as a
    // bare `✓`, and beside `ipn` that reads as "payments are arriving". The
    // caller runs this inside its per-probe try/catch, so the mistake becomes a
    // skip naming itself — which is the honest answer: nothing was shown.
    throw new Error("a clean probe must say what it looked at — see rules.mjs → ranClean()");
  }
  return { state: "clean", findings: [], evidence: line };
}

/**
 * A probe that ran and found something — and still says what it looked at.
 *
 * The evidence is required here for the same reason it is required above, one
 * step further on: `formatRan()` renders a `found` probe as
 * `· <label> — N finding(s)`, and a line saying only how many findings there are
 * has told the reader nothing about what was actually asked. Measured against a
 * real deployed app before this guard existed: the media probe's line was
 * exactly that, sitting between five probes that each named their request.
 */
export function ranFound(findings, evidence) {
  const line = String(evidence ?? "").trim();
  if (!line) {
    throw new Error("a probe with findings must still say what it looked at — see rules.mjs → ranFound()");
  }
  return { state: "found", findings, evidence: line };
}

/**
 * One finding on the shipped shape, with the four labels filled in.
 *
 * Written as a function rather than six object literals so that a probe cannot
 * forget one: `formatFinding()` renders `undefined` as an empty line, and an
 * empty `Fix:` is a finding nobody can act on.
 */
export function finding({ severity, title, where, why, fix, evidence, source = "health" }) {
  if (!SEVERITIES.includes(severity)) {
    throw new Error(`"${severity}" is not one of the shipped severities: ${SEVERITIES.join(", ")}`);
  }
  for (const [name, value] of Object.entries({ title, where, why, fix, evidence })) {
    if (!String(value ?? "").trim()) {
      throw new Error(`a health finding needs a ${name} — an empty one renders as a blank line`);
    }
  }
  return { severity, title, where, why, fix, evidence, source };
}

/**
 * The scheduler's own findings, translated onto the ladder.
 *
 * `jobFindings()` and `overdueJobs()` (`lib/cron/rules.mjs`) already carry the
 * severity word — the shipped ladder's, lower case — so this adds the four
 * labels and nothing else. It invents no severity and re-rates nothing: two
 * commands disagreeing about how bad a failing job is would be worse than
 * either answer.
 *
 * @param {Array<{ job: string, kind: string, severity: string, what: string }>} jobFindings
 * @param {string} url the address that was asked, for the `Where:` line
 */
export function jobLadderFindings(jobFindings, url) {
  const FIXES = {
    neverRun: [
      "This job has never finished once. Open your host's dashboard and check the app is",
      "actually running (a scheduler only runs while the app is up), then look at",
      "config/cron.json to confirm the job is meant to be enabled.",
    ].join(" "),
    failures: [
      "The job ran and threw. Ask the app what it said:",
      "node run.mjs errors --url <this address> — the failure is in that window if it",
      "happened recently, and in your host's own log otherwise.",
    ].join(" "),
    overdue: [
      "The job is enabled and has not finished for several of its own intervals. Usually",
      "the app was down or restarted repeatedly; check your host's dashboard for restarts,",
      "then run node run.mjs cron --list --url <this address> and watch the next one land.",
    ].join(" "),
  };
  const WHY = {
    neverRun:
      "Whatever this job does — deleting data that has aged out, sending a digest — has never happened in this app.",
    failures: "The work this job does is not being done, and nothing on any page says so.",
    overdue:
      "The job is switched on and the scheduler is not getting to it, so its work is quietly not happening.",
  };

  return (jobFindings ?? []).map((item) =>
    finding({
      severity: item.severity,
      title: `Scheduled job "${item.job}" — ${item.what}`,
      where: `${url}/api/cron?list → ${item.job}`,
      why: WHY[item.kind] ?? "This job is not in the state it should be in.",
      fix: FIXES[item.kind] ?? "Run node run.mjs cron --list --url <this address> and read the job's line.",
      evidence: item.what,
      source: "cron",
    }),
  );
}

/**
 * The deployed app's error window, translated onto the ladder — capped.
 *
 * One ❌ HIGH per distinct CAUSE, which is what `parseErrors()` already hands
 * over: it dedupes by message, location and frame and counts the repeats. The
 * cap exists so one bad deploy cannot bury the other five probes under two
 * hundred blocks; what is left over is counted in a line rather than dropped.
 *
 * @param {Array<{ message: string, location: string|null, frame: string|null, count: number }>} found
 * @param {string} window the sentence `describeWindow()` produced
 * @param {string} url
 */
export function errorLadderFindings(found, window, url) {
  const list = Array.isArray(found) ? found : [];
  const shown = list.slice(0, MAX_ERROR_FINDINGS);
  const findings = shown.map((item) =>
    finding({
      severity: "high",
      title: item.message,
      where: item.location ? `${url} → ${item.location}` : url,
      why: [
        "The page still answered 200, so nothing here failed loudly — a bad date, a missing",
        "translation or a rejected promise all render a broken page over a green status code.",
      ].join(" "),
      fix: [
        "Open the page this names in a browser and look at it. The full stack trace is in your",
        "HOST's own log; this app keeps only a bounded, redacted window of its own.",
      ].join(" "),
      evidence:
        `seen ${item.count}× ${window}` + (item.frame ? ` — ${item.frame.trim()}` : ""),
      source: "errors",
    }),
  );

  const more = list.length - shown.length;
  return { findings, more };
}
