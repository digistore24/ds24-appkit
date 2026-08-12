// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// "It must be safe to run twice", for the one kind of work that is not
// idempotent on its own.
//
// Cron rule 1 ends on a sentence with no mechanism behind it — "sending a mail
// is not [idempotent], unless the job records that it sent one" — and until this
// file nothing in the tree showed how. That is why the primitive lives here and
// not in whichever feature needed it first: the second caller would have built a
// second one, and the second one would have been different.

import { db } from "@/db";
import { notificationSends } from "@/db/schema";

import { NotifyError } from "./errors";

/**
 * What a send key may look like.
 *
 * Lower-case words, digits and dashes, in colon-separated segments:
 * `courses-digest:2026-08-09`. At most 120 characters.
 *
 * ⚠️ **This is the cheap half of the rule, and it is honest about it.** The rule
 * is prose — *a key names a piece of WORK, never a person* — and a grammar
 * cannot check that. What it does check is enough to catch the mistakes people
 * actually make: an address (`a@b.de`) has an `@`, a sentence has spaces and
 * capitals, an empty or dangling key is malformed. A UUID would pass, and a
 * member id shaped like one would pass with it. `docs/cron.md` carries the rule;
 * this carries the part a machine can hold.
 */
export const SEND_KEY_PATTERN = /^[a-z0-9][a-z0-9-]*(:[a-z0-9-]+)*$/;

/** Long enough for a job id and a window, short enough not to be a payload. */
export const SEND_KEY_MAX = 120;

/**
 * The grammar, as a refusal — and callable BEFORE anything else happens.
 *
 * A malformed key is a programming error in the caller, not an operating state
 * of this app, so it is the one thing here that throws rather than answering
 * quietly. `notifyOperators()` calls this as its first line: a refusal that
 * arrives after the owner query has already run is a refusal that cost
 * something, and the check costs nothing.
 *
 * 🚨 The message names the RULE, never the key. A key that got this far is one
 * nobody has validated, and this string can reach `cron_runs.lastDetail`.
 */
export function assertSendKey(key: string): void {
  if (key.length > SEND_KEY_MAX || !SEND_KEY_PATTERN.test(key)) {
    throw new NotifyError(
      "badSendKey",
      `send key must match ${SEND_KEY_PATTERN.source} and be at most ${SEND_KEY_MAX} characters`,
    );
  }
}

/**
 * Claim the right to send this message — once, ever.
 *
 * Returns `true` the first time and `false` on every later call with the same
 * key. The whole mechanism is the primary key: `on conflict do nothing` plus
 * `returning`, so two processes racing on the same tick both write the same
 * statement and exactly one of them gets a row back. Checking first and
 * inserting after is not a claim; it is two round trips with a gap in them.
 *
 * 🚨 **Called BEFORE the first delivery, never after.** That loses a message
 * when the transport then fails, and the trade is deliberate: a lost digest is
 * visible (the job throws, cron rule 3 puts it in `cron_runs`) and self-healing
 * (the next window counts the same queue again), while a duplicate is invisible
 * and teaches the operator to skim the channel — and a skimmed channel is the
 * same state as no channel, only with costs.
 *
 * ⚠️ **Both halves of that sentence have a boundary, and neither is theoretical.**
 * *Visible* holds for a job that fails; it does NOT hold for a process that dies
 * between the claim and the deliveries — a redeploy, an OOM kill, a SIGKILL.
 * `finish()` in `lib/cron/run.ts` never runs then, `cron_runs` keeps the previous
 * detail, and the row here is committed: the message is gone and nothing says so.
 * *Self-healing* holds for a job that repeats a STANDING queue, which is what the
 * shipped digest is. A one-off, event-shaped message — "this expiry unblocked a
 * spammer" — heals nothing, because the next window has nothing left to count.
 * Whoever sends one of those is choosing a different trade and should say so
 * where they send it.
 *
 * @param key what the message IS. Never who it is about — see the grammar above.
 * @param now the tick's clock, never `new Date()` inside a job.
 */
export async function claimSend(key: string, now: Date): Promise<boolean> {
  // Before the query, so a malformed key is a refusal rather than a row. Callers
  // that reach the channel through `notifyOperators()` have been refused one
  // step earlier already; this stays because a direct caller must not be able
  // to get past it, and a duplicated cheap check is not a cost.
  assertSendKey(key);

  const claimed = await db
    .insert(notificationSends)
    .values({ key, claimedAt: now })
    .onConflictDoNothing()
    .returning({ key: notificationSends.key });

  return claimed.length > 0;
}
