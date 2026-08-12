// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The shell that persists what the rules decide — the ONLY file in
// `modules/activity/` that touches the database. `rules.ts` decides, this file
// reads and writes; the split is `lib/tokens/spend.ts` over
// `lib/tokens/rules.ts`, and it is what keeps every decision testable
// without a database.
//
// ── This is the PRIMITIVE, and it takes a memberId on purpose ──────────────
// Like `consumeTokens`, not like `spendTokens`: the session-bound wrapper —
// `requireActiveUser()`, `hasPlan()`, the token charge in the order
// check → work → charge — is story 14.3's server action, and it belongs
// there, not here. **Do not add a second, session-reading entry point in
// this file**; a shell that authenticates sometimes is a shell that gets
// called without it once.
//
// ── The order of operations is load-bearing ────────────────────────────────
// read → decide → grade() → write. Three consequences, each an AC:
//  - a refused attempt never reaches `grade()` — it costs nothing and cannot
//    be metered (AC 5);
//  - a `grade()` that throws has written nothing — the stored result is
//    intact and the caller learns the attempt did not count (AC 7);
//  - the write is guarded on the attempt count that was read, so the same
//    submission delivered twice concurrently counts ONE attempt (AC 6): both
//    deliveries grade, the first write wins, the second matches zero rows.
import { and, count, eq } from "drizzle-orm";

import { db } from "@/db";
import { activityResults } from "./schema";

import { findActivity } from "./activities";
import {
  applyVerdict,
  decideSubmission,
  subjectProblem,
  verdictProblems,
  type ActivityVerdict,
  type StoredResult,
} from "./rules";

/**
 * How many results this installation holds — what `content-check` asks.
 *
 * ⚠️ **Nothing here is content**, so this number can never fail a run
 * (`expected: null`). It is reported because `content-check` exists to tell
 * "there is nothing here" apart from "I could not look", and a module that owns
 * rows and stays silent makes those two render the same.
 *
 * Not scoped by member, and that is the one query here which is not: it counts
 * an installation, names nobody, and returns no subject. It lives beside the
 * reads rather than in the presence check because a module's contributor is a
 * thin caller — `lib/setup/module-boundary.test.ts` refuses one that reaches
 * `@/db` directly.
 */
export async function countResults(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(activityResults);
  return row?.n ?? 0;
}

/**
 * This member's result for one element on one subject, or `null`.
 *
 * 🚨 Always scoped by `memberId` — `activityId` and `subject` are strings the
 * browser sent, and "no row" and "somebody else's row" are deliberately the
 * same answer.
 */
export async function resultFor(
  memberId: string,
  activityId: string,
  subject: string,
): Promise<StoredResult | null> {
  // An explicit projection, so the declared type is the truth — a bare
  // select() returns the full row (id, memberId, …) structurally narrowed,
  // and whatever serialises a StoredResult would ship the hidden columns.
  const [row] = await db
    .select({
      state: activityResults.state,
      score: activityResults.score,
      maxScore: activityResults.maxScore,
      passed: activityResults.passed,
      attempts: activityResults.attempts,
      startedAt: activityResults.startedAt,
      completedAt: activityResults.completedAt,
    })
    .from(activityResults)
    .where(
      and(
        eq(activityResults.memberId, memberId),
        eq(activityResults.activityId, activityId),
        eq(activityResults.subject, subject),
      ),
    )
    .limit(1);
  return row ?? null;
}

export type SubmissionOutcome =
  | { outcome: "refused"; reason: "maxAttempts" }
  | {
      outcome: "graded";
      verdict: ActivityVerdict;
      /**
       * `false` means the write did not land: a concurrent delivery — a
       * duplicate, or a checkpoint racing a final — got there first. The
       * attempt was counted at most once. Rare, and the contract for it is
       * one sentence: **show the verdict, charge nothing** — 14.3's wrapper
       * meters only an outcome that was recorded, so a lost race costs the
       * vendor a grading, never the customer a token.
       */
      recorded: boolean;
    };

/**
 * One submission: look the activity up, refuse or grade, persist the verdict.
 *
 * The activity comes from the REGISTRY, never from an argument — an entry the
 * browser could supply would carry its own `grade()`. An unknown id throws,
 * like `getProduct()`: a tampered request must not silently do nothing.
 */
export async function recordSubmission(input: {
  memberId: string;
  activityId: string;
  subject: string;
  submission: unknown;
}): Promise<SubmissionOutcome> {
  const activity = findActivity(input.activityId);
  // Browser input, clamped before it reaches a log line or an error page.
  if (!activity) throw new Error(`Unbekannte Aktivität: ${input.activityId.slice(0, 40)}`);

  // `subject` is the other half of the row key and equally browser-sent.
  // The bounds live in `subjectProblem()` (rules.ts) — one definition, shared
  // with the action, which returns the code where this primitive throws.
  if (subjectProblem(input.subject)) throw new Error("Ungültiges Subject.");

  const previous = await resultFor(input.memberId, input.activityId, input.subject);

  const decision = decideSubmission({ previous, maxAttempts: activity.maxAttempts });
  if (decision.action === "refused") {
    return { outcome: "refused", reason: decision.reason };
  }

  // May throw — deliberately BEFORE anything is written, and outside any
  // transaction: an entry's grade() is app code and may take its time.
  const verdict = await activity.grade({
    memberId: input.memberId,
    subject: input.subject,
    submission: input.submission,
    previous,
  });

  // An authoring bug in an entry's grade(), named before it dies at the
  // integer column or stores an impossible score.
  const broken = verdictProblems(verdict);
  if (broken.length > 0) {
    throw new Error(`Aktivität "${activity.id}": ${broken.join("; ")}`);
  }

  const now = new Date();
  const write = applyVerdict({ previous, verdict, now, passMark: activity.passMark });
  const guardedAttempts = previous?.attempts ?? 0;

  const updated = await db
    .insert(activityResults)
    .values({
      memberId: input.memberId,
      activityId: input.activityId,
      subject: input.subject,
      // One clock for the whole row — mixing the app's `now` with the
      // column defaults' database now() lets completedAt precede startedAt.
      startedAt: now,
      state: write.state,
      score: write.score,
      maxScore: write.maxScore,
      passed: write.passed,
      attempts: write.attempts,
      updatedAt: now,
      completedAt: write.completedAt,
    })
    .onConflictDoUpdate({
      target: [
        activityResults.memberId,
        activityResults.activityId,
        activityResults.subject,
      ],
      set: {
        state: write.state,
        score: write.score,
        maxScore: write.maxScore,
        passed: write.passed,
        attempts: write.attempts,
        updatedAt: now,
        completedAt: write.completedAt,
      },
      // The idempotency guard (AC 6): only the delivery that still sees the
      // attempt count it read may write. A concurrent duplicate finds the
      // count already moved and updates zero rows.
      setWhere: eq(activityResults.attempts, guardedAttempts),
    })
    .returning({ id: activityResults.id });

  return { outcome: "graded", verdict, recorded: updated.length > 0 };
}
