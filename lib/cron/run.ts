// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Running the due jobs — the part that must be right when two app instances
// wake up in the same second.
//
// ── The claim is ONE statement, on purpose ────────────────────────────────
// The obvious shape is: read the row, decide whether it is due, write the lock.
// That is three round trips with two gaps in them, and both instances pass the
// same check before either writes. So "is it due" and "claim it" are the SAME
// conditional UPDATE, and the database decides. Whoever gets a row back runs
// it; the other gets nothing back and moves on, having done no work and said
// nothing about it.
//
// This is the same discipline `claimReloadSlot()` uses against double-charging
// a card, and for the same reason: a lock you check and then take is not a lock.
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { cronRuns } from "@/db/schema";

import { jobSettings } from "./config";
import { CRON_JOBS, jobById, type CronJob } from "./jobs";
import { dueBefore, staleLockBefore } from "./rules.mjs";

export interface JobResult {
  job: string;
  /** "ok" | "failed" | "skipped" — skipped means somebody else had it, or it was not due. */
  outcome: "ok" | "failed" | "skipped";
  detail: string;
  ms: number;
}

/**
 * Take the job, or find out somebody else has it.
 *
 * Returns false when the row was not claimable: another instance holds a fresh
 * lock, or the job simply is not due yet. The caller cannot tell those apart
 * and does not need to — both mean "not mine, not now".
 */
async function claim(job: CronJob, now: Date, force: boolean): Promise<boolean> {
  const settings = jobSettings(job.id, job.enabledByDefault);

  // The row has to exist before it can be claimed conditionally. `onConflictDoNothing`
  // rather than an upsert: an existing row's schedule must not be reset by the
  // instance that happened to boot last.
  await db.insert(cronRuns).values({ job: job.id }).onConflictDoNothing();

  const claimed = await db
    .update(cronRuns)
    .set({ lockedAt: now, lastStartedAt: now })
    .where(
      and(
        eq(cronRuns.job, job.id),
        // Free, or held by a process that is not coming back.
        or(isNull(cronRuns.lockedAt), lt(cronRuns.lockedAt, staleLockBefore(now))),
        // Due — unless the Operator asked for it explicitly, which is what
        // `--force` and the button are for.
        force
          ? sql`true`
          : or(
              isNull(cronRuns.lastFinishedAt),
              lt(cronRuns.lastFinishedAt, dueBefore(settings, now)),
            ),
      ),
    )
    .returning({ job: cronRuns.job });

  return claimed.length > 0;
}

/** Release the lock and record what happened. Never throws. */
async function finish(
  jobId: string,
  outcome: "ok" | "failed",
  detail: string,
  now: Date,
): Promise<void> {
  try {
    await db
      .update(cronRuns)
      .set({
        lockedAt: null,
        lastFinishedAt: now,
        lastOutcome: outcome,
        // Bounded: a stack trace or a driver message can be long, and this
        // column is read in a terminal and on a status line.
        lastDetail: detail.slice(0, 500),
        runs: sql`${cronRuns.runs} + 1`,
        failures: outcome === "failed" ? sql`${cronRuns.failures} + 1` : cronRuns.failures,
      })
      .where(eq(cronRuns.job, jobId));
  } catch (error) {
    // The bookkeeping failing must not turn a successful job into a crash. It
    // does mean the lock stays until it goes stale, which is the conservative
    // direction: a job that runs an hour late beats one that runs twice.
    console.error(`[cron] could not record the outcome of ${jobId}:`, error);
  }
}

/** Run one job if it is claimable. The unit both the scheduler and the endpoint use. */
export async function runOne(job: CronJob, now: Date, force = false): Promise<JobResult> {
  const settings = jobSettings(job.id, job.enabledByDefault);
  if (!settings.enabled && !force) {
    return { job: job.id, outcome: "skipped", detail: "disabled in config/cron.json", ms: 0 };
  }
  if (!(await claim(job, now, force))) {
    return { job: job.id, outcome: "skipped", detail: "not due, or already running", ms: 0 };
  }

  const started = Date.now();
  try {
    const detail = await job.run({ now, settings });
    const ms = Date.now() - started;
    await finish(job.id, "ok", detail, new Date());
    console.log(`[cron] ${job.id} ok in ${ms}ms — ${detail}`);
    return { job: job.id, outcome: "ok", detail, ms };
  } catch (error) {
    const ms = Date.now() - started;
    // The message only. A driver error can carry a query with parameters in it,
    // and parameters are customer data — the same rule the AI layer follows for
    // a provider's error text.
    const detail = error instanceof Error ? error.message : String(error);
    await finish(job.id, "failed", detail, new Date());
    console.error(`[cron] ${job.id} FAILED after ${ms}ms:`, error);
    return { job: job.id, outcome: "failed", detail, ms };
  }
}

/**
 * One tick: every job that is due, in sequence.
 *
 * Sequential rather than parallel, deliberately. These jobs run against the
 * same database, none of them is fast enough to matter, and a tick that fires
 * four large DELETEs at once is a tick that competes with the requests the app
 * is meant to be serving.
 */
export async function runDueJobs(now: Date = new Date()): Promise<JobResult[]> {
  const results: JobResult[] = [];
  for (const job of CRON_JOBS) {
    results.push(await runOne(job, now));
  }
  return results;
}

/** Run one job by id, whether or not it is due. For `--force` and the endpoint. */
export async function runJobById(
  id: string,
  now: Date = new Date(),
  force = true,
): Promise<JobResult> {
  const job = jobById(id);
  if (!job) {
    return { job: id, outcome: "failed", detail: `no such job: ${id}`, ms: 0 };
  }
  return runOne(job, now, force);
}

export interface JobStatus {
  job: string;
  describe: string;
  enabled: boolean;
  everyMinutes: number;
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  lockedAt: Date | null;
  lastOutcome: string | null;
  lastDetail: string | null;
  runs: number;
  failures: number;
}

/**
 * What every job's state is — for `node run.mjs cron --list`.
 *
 * Built from the REGISTRY and filled in from the table, not the other way
 * round: a job that has never run has no row, and it is exactly the job an
 * Operator most needs to see. Listing the table would show them nothing and
 * they would read that as "fine".
 */
export async function jobStatuses(): Promise<JobStatus[]> {
  const rows = await db.select().from(cronRuns);
  const byId = new Map(rows.map((row) => [row.job, row]));

  return CRON_JOBS.map((job) => {
    const row = byId.get(job.id);
    const settings = jobSettings(job.id, job.enabledByDefault);
    return {
      job: job.id,
      describe: job.describe,
      enabled: settings.enabled,
      everyMinutes: settings.everyMinutes,
      lastStartedAt: row?.lastStartedAt ?? null,
      lastFinishedAt: row?.lastFinishedAt ?? null,
      lockedAt: row?.lockedAt ?? null,
      lastOutcome: row?.lastOutcome ?? null,
      lastDetail: row?.lastDetail ?? null,
      runs: row?.runs ?? 0,
      failures: row?.failures ?? 0,
    };
  });
}
