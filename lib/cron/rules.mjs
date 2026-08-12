// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// When a job is due, when a lock is stale, and what a broken config looks like.
//
// Pure — no database, no clock of its own, no `Date.now()`. Every function
// takes the time it should reason about, which is what makes a scheduler
// testable at all: "is this daily job due at 03:00 on the day the clocks go
// back" is a question you can only ask a function that lets you choose the day.
//
// ── Why .mjs ───────────────────────────────────────────────────────────────
// `scripts/cron/run.mjs` prints the schedule without a running app, and
// `lib/cron/config.ts` reads the same rules inside it. One implementation, two
// readers — the pattern `lib/ai/pricing.mjs` established.

/** A job with nothing configured. Every job inherits these. */
export const JOB_DEFAULTS = Object.freeze({
  enabled: true,
  everyMinutes: 1440, // daily
});

/**
 * How long a claimed lock is honoured before it is treated as abandoned.
 *
 * A process that dies mid-job leaves `lockedAt` set and nothing clears it. Too
 * short and two instances run the same job concurrently; too long and one crash
 * stops a daily job for days. An hour is longer than any job here takes by
 * three orders of magnitude, and shorter than the shortest useful interval.
 */
export const STALE_LOCK_MINUTES = 60;

/**
 * How often the in-app scheduler looks for work.
 *
 * NOT the resolution of the schedule — a job set to `everyMinutes: 5` runs
 * every five minutes because the tick asks the database whether it is due, not
 * because the tick is five minutes. This is only the cost of asking, and asking
 * is one indexed UPDATE per job.
 */
export const TICK_MINUTES = 1;

const MINUTE_MS = 60_000;

/**
 * The settings for one job: the file's entry over the defaults.
 *
 * `enabledByDefault` is the job's OWN posture, and it exists for one case: a job
 * that must not start running the day it arrives. Every core job ships on, so
 * `JOB_DEFAULTS.enabled` was enough until a MODULE brought one — and a module's
 * job cannot ship an entry in `config/cron.json`, because that file belongs to
 * the core and would then name a job every app without the module does not have
 * (`configProblems()` calls that "a job that does not exist").
 *
 * 🚨 Leaving the entry OUT is not "off". Without one a job inherits
 * `JOB_DEFAULTS` — enabled, daily — so an omitted entry schedules it. That is
 * what this parameter is for, and `modules/community/cron.ts` is the shipped
 * example: it deletes members' correspondence and their moderation trail, so it
 * arrives switched off and the operator's `"enabled": true` is a decision.
 *
 * The operator's file still wins in BOTH directions — an explicit `true` turns on
 * a job whose default is off, and an explicit `false` turns off one whose default
 * is on. Only the absence of an entry consults the job.
 *
 * @param raw the job's entry from `config/cron.json`, if any
 * @param enabledByDefault the job's own default; omit for the usual "on"
 */
export function normalizeJob(raw, enabledByDefault = true) {
  const entry = raw && typeof raw === "object" ? raw : {};
  const every = configuredNumber(entry.everyMinutes);
  return {
    ...JOB_DEFAULTS,
    ...entry,
    // A non-boolean is not an opinion — `enabled: "no"` falls back to the job's
    // default rather than to `true`, which is the same "every doubt falls the
    // safe way" this file applies to `everyMinutes`.
    enabled: typeof entry.enabled === "boolean" ? entry.enabled : enabledByDefault !== false,
    // A non-number, a zero or a negative would mean "run on every tick, for
    // ever". Falling back is right here: a typo in a schedule must not turn
    // into a hot loop against the database.
    everyMinutes: every !== null && every >= 1 ? Math.floor(every) : JOB_DEFAULTS.everyMinutes,
  };
}

/**
 * A job is due when it last FINISHED longer ago than its interval.
 *
 * Never run at all → due. That is deliberate: a freshly deployed app should do
 * its first cleanup rather than wait a day for it, and a job whose row was
 * removed should recover on its own.
 */
export function isDue(job, lastFinishedAt, now) {
  if (!job.enabled) return false;
  if (!lastFinishedAt) return true;
  return now.getTime() - lastFinishedAt.getTime() >= job.everyMinutes * MINUTE_MS;
}

/** The instant a lock must predate to count as abandoned. */
export function staleLockBefore(now) {
  return new Date(now.getTime() - STALE_LOCK_MINUTES * MINUTE_MS);
}

/** The instant a job must have finished before to be due again. */
export function dueBefore(job, now) {
  return new Date(now.getTime() - job.everyMinutes * MINUTE_MS);
}

/**
 * A configured number, or null when the value is not one.
 *
 * ⚠️ The reason this is not `Number(value)`: **`Number(null)` is 0, and so is
 * `Number("")` and `Number(false)`.** Every one of those reads as a perfectly
 * valid zero, and zero months of retention means *delete everything*. A
 * `"retentionMonths": null` left behind while editing the config would empty
 * the table on the next tick and report success.
 *
 * So a value counts only if it is genuinely a number, or a string that is
 * entirely one. Anything else is not a small window — it is an absent answer,
 * and the caller falls back to its default.
 */
export function configuredNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * The cutoff for a retention window given in MONTHS.
 *
 * Calendar months, not "30 days times n": "twelve months" in a retention policy
 * means the same date last year, and a customer who wrote 12 into the config
 * and got 360 days has been given something other than what they asked for.
 * `setUTCMonth` normalises a short month by itself — 31 March minus one month
 * is 3 March, which is the conventional and defensible answer.
 */
export function retentionCutoff(months, now) {
  const n = configuredNumber(months);
  if (n === null || n < 0) return null;
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - Math.floor(n));
  return cutoff;
}

/** "every 24 h" / "every 15 min" — for the check command and the log line. */
export function describeEvery(everyMinutes) {
  if (everyMinutes % 1440 === 0) {
    const days = everyMinutes / 1440;
    return days === 1 ? "daily" : `every ${days} days`;
  }
  if (everyMinutes % 60 === 0) {
    const hours = everyMinutes / 60;
    return hours === 1 ? "hourly" : `every ${hours} h`;
  }
  return `every ${everyMinutes} min`;
}

/**
 * The two job states that are a FINDING rather than a row — pure.
 *
 * `node run.mjs cron --list` prints a job's state; this says which of those
 * states somebody has to act on. The distinction is the whole point of the
 * command: a listing where every line looks the same is a listing an operator
 * skims, and the two states below are exactly the ones that look like every
 * other line while meaning the scheduler stopped.
 *
 * 🚨 **A job that is OFF and has never run is NOT a finding.** It has correctly
 * never run — `community-prune` and `courses-digest` ship `enabledByDefault:
 * false`, so on a fresh app with the modules installed they are precisely this
 * case, and reporting them would make the summary cry wolf on every install.
 * Enabled-and-never-run is the one that means something.
 *
 * ⚠️ It has no clock. "A daily job whose last finish is five days old" is a
 * third, genuinely useful rule and is deliberately NOT here — it needs a `now`,
 * and the verdict that owns a `now` is a different command (docs/cron.md).
 * Two rules, both answerable from the row alone.
 *
 * The severity words are the shipped ladder's (`scripts/security/rules.mjs` →
 * `SEVERITIES`), lower-case, and the GLYPH is the printer's business —
 * `scripts/cron/list-report.mjs` owns the one glyph table. A rules file that
 * returned "⚠️" would be a second vocabulary that agrees today.
 *
 * @typedef {{ job: string, kind: "neverRun" | "failures",
 *             severity: "medium" | "high", what: string }} JobFinding
 * @param {Array<{ job: string, enabled: boolean, lastFinishedAt: string | Date | null,
 *                 runs: number, failures: number }>} jobs
 * @returns {JobFinding[]}
 */
export function jobFindings(jobs) {
  const findings = [];
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job || typeof job !== "object") continue;

    // ⚠️ `lastFinishedAt` crossed JSON on the way here, so it is a STRING
    // despite `JobStatus` typing it `Date | null` (`docs/troubleshooting.md` →
    // Dates and raw SQL). Only its presence is asked, never its value — which
    // is why this needs no conversion and must not grow one.
    if (job.enabled === true && !job.lastFinishedAt) {
      findings.push({
        job: job.job,
        kind: "neverRun",
        severity: "medium",
        what: "enabled and has never run",
      });
    }

    const failures = configuredNumber(job.failures) ?? 0;
    if (failures > 0) {
      const runs = configuredNumber(job.runs) ?? 0;
      findings.push({
        job: job.job,
        kind: "failures",
        severity: "high",
        what: `${failures} of ${runs} run(s) failed`,
      });
    }
  }
  return findings;
}

/**
 * How many intervals a job may miss before it is overdue.
 *
 * Three, not one. Due-ness counts from the last FINISH (`isDue`), so a job at
 * its exact interval is due again the moment it lands and a factor of one would
 * report every healthy job in the tally. Three is short enough that a daily job
 * that stopped is named within three days and long enough that a redeploy, a
 * long-running tick or a paused instance is not a finding.
 */
export const OVERDUE_FACTOR = 3;

/**
 * The THIRD job state that is a finding — and the one that needs a clock.
 *
 * `jobFindings()` above deliberately has none, and says so: it answers from the
 * row alone. "A daily job whose last finish is five days old" cannot be answered
 * that way, and the command that owns a `now` is the verdict —
 * `node run.mjs health`. That is why this lives beside `jobFindings()` and is
 * called by a different caller; `node run.mjs cron --list` is NOT changed by it
 * (its two findings and its exit-0 contract are pinned by
 * `scripts/deploy-test.mjs`).
 *
 * ⚠️ **A job that has NEVER finished is not overdue by this rule.**
 * `lastFinishedAt` is `null` and nothing in `cron_runs` says when this app was
 * deployed, so a fresh app would otherwise report every job as overdue on its
 * first minute. `jobFindings()` reports never-run separately, at the same
 * severity, and that split is the honest one: "it has not started" and "it
 * stopped" have different fixes.
 *
 * ⚠️ **`lastFinishedAt` crossed JSON and is a STRING despite `JobStatus` typing
 * it `Date | null`** (`docs/troubleshooting.md` → Dates and raw SQL). It is
 * parsed here rather than "fixed" into a `Date` parameter, exactly as `ago(iso)`
 * already takes the ISO string — and an unparseable one is NOT a finding: an
 * answer nobody can read is not evidence that a job stopped.
 *
 * @param {Array<{ job: string, enabled: boolean, everyMinutes: number,
 *                 lastFinishedAt: string | Date | null }>} jobs
 * @param {Date} now
 * @param {{ factor?: number }} [options]
 * @returns {Array<{ job: string, kind: "overdue", severity: "medium", what: string }>}
 */
export function overdueJobs(jobs, now, { factor = OVERDUE_FACTOR } = {}) {
  const at = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(at)) return [];

  const findings = [];
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job || typeof job !== "object") continue;
    if (job.enabled !== true) continue;
    if (!job.lastFinishedAt) continue;

    const finished = Date.parse(
      job.lastFinishedAt instanceof Date ? job.lastFinishedAt.toISOString() : job.lastFinishedAt,
    );
    if (!Number.isFinite(finished)) continue;

    const every = configuredNumber(job.everyMinutes);
    const everyMinutes = every !== null && every >= 1 ? Math.floor(every) : JOB_DEFAULTS.everyMinutes;
    const agoMinutes = Math.floor((at - finished) / MINUTE_MS);
    if (agoMinutes <= everyMinutes * factor) continue;

    findings.push({
      job: job.job,
      kind: "overdue",
      severity: "medium",
      what: `last finished ${agoMinutes} min ago — over ${factor}× its ${everyMinutes} min interval`,
    });
  }
  return findings;
}

/**
 * Everything wrong with `config/cron.json` — empty when it is coherent.
 *
 * The same deal `taskProblems()` makes for the AI bindings: a second source of
 * truth is only safe while something checks it against the first. A job named
 * in the config that does not exist in the registry is the mistake that
 * actually gets made — usually a rename — and it fails silently, because a job
 * that is never looked up is a job that never runs.
 */
export function configProblems(raw, knownJobs) {
  const problems = [];
  if (!raw || typeof raw !== "object") return ["config/cron.json is not an object."];

  const jobs = raw.jobs;
  if (jobs !== undefined && (typeof jobs !== "object" || jobs === null || Array.isArray(jobs))) {
    return ['config/cron.json: "jobs" must be an object.'];
  }

  for (const [id, entry] of Object.entries(jobs ?? {})) {
    if (!knownJobs.includes(id)) {
      problems.push(
        `config/cron.json names a job "${id}" that does not exist. ` +
          `Known jobs: ${knownJobs.join(", ")}.`,
      );
      continue;
    }
    if (entry && typeof entry === "object") {
      const every = entry.everyMinutes;
      if (every !== undefined && ((configuredNumber(every) ?? 0) < 1)) {
        problems.push(
          `config/cron.json: "${id}".everyMinutes must be a number of minutes >= 1 ` +
            `(got ${JSON.stringify(every)}); falling back to ${JOB_DEFAULTS.everyMinutes}.`,
        );
      }
    } else if (entry !== undefined) {
      problems.push(`config/cron.json: "${id}" must be an object.`);
    }
  }

  // A job in the registry with no entry is NORMAL — it inherits the defaults,
  // exactly like a declared AI task with no binding. Not reported.
  return problems;
}
