// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Deleting old rows, in bounded batches, within a time budget.
//
// ── Why this is its own file ───────────────────────────────────────────────
// It lived in `lib/cron/jobs.ts` while `prune-ai-usage` was its only caller.
// A MODULE's job cannot import that file: `jobs.ts` imports the generated cron
// registry, which imports the module's `cron.ts` — so a module reaching back
// into `jobs.ts` closes the circle. Same reason `lib/cron/types.ts` exists.
//
// ── The four things a sweep has to get right ───────────────────────────────
// `delete … where created_at < cutoff` is the obvious version, and on the
// installation that needs it most — the app that has been running for years and
// is pruning for the first time — it has two problems, both of which land on the
// APP process, because the scheduler runs inside it and there is no worker:
//
//  1. **Memory.** `returning({ id })` on a million-row delete brings a million
//     ids back to count them. The count is the only thing anybody wants, and
//     the ids are hundreds of megabytes in the process that serves requests.
//  2. **The lock.** A delete that outlives the stale-lock window
//     (`STALE_LOCK_MINUTES`, one hour) lets the next tick start the same job
//     BESIDE the first, and it holds row locks on a table the app is still
//     writing to for its whole duration. Rule 4 for a job — "it finishes in
//     well under an hour" — is not advice, it is that window.
//
// And two more that only appear once you batch:
//
//  3. **The caller's schema owes an INDEX that leads with the cutoff column —
//     and it is for the DAILY run, not for the big one.** Measured on a real
//     table (40,000 rows, none old enough): with the index the "nothing to do"
//     run is `Index Scan using community_messages_created`, cost 4.31. Without
//     one Postgres has no choice but to read the whole table to find nothing —
//     every day, for ever, on the biggest table the module has.
//     ⚠️ It does NOT speed up the first catch-up run, and it is not supposed to:
//     when most of the table is older than the cutoff, the planner picks a
//     sequential scan and is right to (measured, same table). So batching and the
//     index answer different halves — batching bounds the one enormous run, the
//     index bounds the thousand small ones. `modules/community/schema.test.ts`
//     holds the community's three swept tables to having one.
//  4. **A partial run must SAY so.** One enormous run that never finishes is
//     one transaction that rolls back: nothing deleted, and the same attempt
//     tomorrow, for ever. Batching turns that into "a bounded amount of work
//     every day until it has caught up" — but then a run that stopped at its
//     budget looks exactly like one that finished, so `stoppedEarly` travels
//     back to the caller and into the line an operator reads.
//
// The steady state — a daily run on a table that was swept yesterday — is one
// batch that finds nothing and stops.
import { and, inArray, lt, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import { db } from "@/db";

/** Rows per DELETE. Big enough to be efficient, small enough to hold in memory. */
export const PRUNE_BATCH = 10_000;

/** How long one JOB may spend pruning before it leaves the rest to the next run. */
export const PRUNE_BUDGET_MS = 60_000;

/**
 * The instant a job's pruning must stop by.
 *
 * ⚠️ **One deadline per JOB, not per sweep.** `community-prune` makes three
 * sweeps; three independent budgets would be three minutes of held locks under a
 * one-minute name. So the deadline is computed once and passed to each sweep,
 * and the budget is the job's.
 */
export const pruneDeadline = (budgetMs: number = PRUNE_BUDGET_MS): number =>
  Date.now() + budgetMs;

export interface PruneTarget {
  /** The table to delete from. */
  table: PgTable;
  /** Its primary key — what the batch subquery selects. */
  id: PgColumn;
  /** The timestamp the cutoff applies to. Needs an index that leads with it. */
  olderThan: PgColumn;
  /**
   * Anything else that narrows WHICH rows may go, e.g. "only handled reports".
   *
   * 🚨 It is ANDed into both the subquery and therefore the delete — a predicate
   * a caller applies afterwards would be a predicate applied to rows that are
   * already gone.
   */
  also?: SQL;
}

/**
 * Delete rows older than `cutoff` in bounded batches, stopping at `deadline`.
 *
 * @returns how many rows went, and whether it ran out of budget first.
 */
export async function pruneInBatches(
  target: PruneTarget,
  cutoff: Date,
  deadline: number = pruneDeadline(),
): Promise<{ deleted: number; stoppedEarly: boolean }> {
  const { table, id, olderThan, also } = target;
  const where = also ? and(lt(olderThan, cutoff), also) : lt(olderThan, cutoff);
  let deleted = 0;

  for (;;) {
    // `id in (select … limit n)` rather than a bare `limit` on the DELETE:
    // Postgres has no LIMIT on DELETE, and the subquery is what the index on
    // `olderThan` serves.
    const batch = await db
      .delete(table)
      .where(inArray(id, db.select({ id }).from(table).where(where).limit(PRUNE_BATCH)))
      .returning({ id });

    deleted += batch.length;
    // A short batch means the last one — there is nothing left to find.
    if (batch.length < PRUNE_BATCH) return { deleted, stoppedEarly: false };
    // Out of budget. Note that this does NOT prove rows remain: the final batch
    // can be exactly full. So the flag is "I stopped early", not "there is
    // more", and the message a caller composes says only what is true.
    if (Date.now() >= deadline) return { deleted, stoppedEarly: true };
  }
}

/**
 * The clause every job appends when a sweep did not get to the end.
 *
 * Here rather than retyped per job: an operator who learns to recognise one
 * sentence recognises it in every job's line, and "10,000 deleted" every day for
 * a week must not be indistinguishable from "finished".
 */
export const STOPPED_EARLY_NOTE = " — stopped at the time budget, the next run continues";
