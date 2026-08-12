// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The pure rules of an interactive element — no database, no session, no
// model. `modules/activity/results.ts` is the shell that persists what these
// decide; the split is the same one `lib/tokens/rules.ts` / `spend.ts` and
// `lib/entitlements/rules.ts` / `manage.ts` already make, and for the same
// reason: everything that can be wrong here is asserted by a test over plain
// objects instead of trusted.
//
// The one sentence that shapes every function in this file: **a submission
// from a browser is data about an attempt, never the result of one.** So
// nothing here ever reads a submission — `decideSubmission` sees only the
// stored attempt count, and `applyVerdict` sees only what the activity's own
// `grade()` returned on the server. A perfect score claimed by a client has
// no path into a row.

/** What the rules read of a stored `activity_results` row. Plain — no db import. */
export interface StoredResult {
  state: unknown;
  score: number | null;
  maxScore: number | null;
  passed: boolean | null;
  attempts: number;
  startedAt: Date;
  completedAt: Date | null;
}

/**
 * What one graded submission decided — returned by an activity's `grade()`,
 * on the server, and the ONLY source `applyVerdict` accepts.
 */
export interface ActivityVerdict {
  /** Whether this submission ends the attempt. `false` = a checkpoint. */
  final: boolean;
  score?: number;
  maxScore?: number;
  /** Omit to let the activity's `passMark` decide. */
  passed?: boolean;
  /** What the learner should see back. Text, never markup. */
  feedback?: string;
  /** What to store so this can be resumed. Written by the server only. */
  state?: unknown;
}

/** The registry fields the lint below reads — structural, so it cannot import the registry. */
export interface ActivityShape {
  id: string;
  costsTokens: number;
  maxAttempts: number | null;
  passMark?: number;
}

/**
 * Stable, `[a-z0-9-]`, at most 40 characters — the same restriction
 * `companionProblems()` puts on a companion id, for two reasons of this
 * file's own (the composed-key argument does NOT carry over; results are
 * keyed by two columns and cannot collide): the id travels as a prop from a
 * client component, and it is what a vendor writes into `docs/app.md`.
 */
const ID_RE = /^[a-z0-9-]{1,40}$/;

/**
 * Everything wrong with a list of activities, as messages — one per problem,
 * empty when the list is sound. The registry's own test calls this on
 * `ACTIVITIES`, so a malformed entry fails the build rather than a customer.
 */
export function activityProblems(activities: ReadonlyArray<ActivityShape>): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const a of activities) {
    if (!ID_RE.test(a.id)) {
      problems.push(`"${a.id}": id must be [a-z0-9-], at most 40 characters`);
    }
    if (seen.has(a.id)) problems.push(`"${a.id}": duplicate id`);
    seen.add(a.id);
    if (!Number.isInteger(a.costsTokens) || a.costsTokens < 0) {
      problems.push(`"${a.id}": costsTokens must be a non-negative integer`);
    }
    if (a.maxAttempts !== null && (!Number.isInteger(a.maxAttempts) || a.maxAttempts < 1)) {
      problems.push(`"${a.id}": maxAttempts must be null or a positive integer`);
    }
    if (a.passMark !== undefined && !(a.passMark > 0 && a.passMark <= 1)) {
      problems.push(`"${a.id}": passMark must be within (0, 1]`);
    }
  }
  return problems;
}

/**
 * The sanity check on what a `grade()` returned — one message per problem,
 * empty when sound. Called by the shell BEFORE the write, because the two
 * failure shapes it prevents both surface after the work already ran: a
 * fractional or non-finite score dies at the integer column, and
 * `score > maxScore` stores an impossible 150 % as passed.
 */
export function verdictProblems(verdict: ActivityVerdict): string[] {
  const problems: string[] = [];
  for (const [name, value] of [["score", verdict.score], ["maxScore", verdict.maxScore]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      problems.push(`${name} must be a non-negative integer, got ${String(value)}`);
    }
  }
  if (
    verdict.score !== undefined &&
    verdict.maxScore !== undefined &&
    Number.isInteger(verdict.score) &&
    Number.isInteger(verdict.maxScore) &&
    verdict.score > verdict.maxScore
  ) {
    problems.push(`score ${verdict.score} exceeds maxScore ${verdict.maxScore}`);
  }
  // The rule three documents state, enforced at the designed refusal point:
  // a checkpoint carries no judgement. A scored checkpoint is a free probe
  // outside the attempt ceiling — refuse it as the authoring bug it is.
  if (!verdict.final && (verdict.score !== undefined || verdict.maxScore !== undefined || verdict.passed !== undefined)) {
    problems.push("a checkpoint (final: false) must not carry score, maxScore or passed");
  }
  // The resume point is stored and exported whole — bound it like the
  // submission (64 k), or a single entry makes rows and exports unbounded.
  if (verdict.state !== undefined) {
    try {
      if (JSON.stringify(verdict.state ?? null).length > 64_000) {
        problems.push("state exceeds 64 kB serialised");
      }
    } catch {
      problems.push("state is not JSON-serialisable");
    }
  }
  return problems;
}

/**
 * The codes a submission can come back with — translated by the panel through
 * the `errors` namespace, like every layer that returns codes (AD-10).
 * Registered in `i18n/messages.test.ts`, so a missing translation fails the
 * build in both languages.
 */
export const ACTIVITY_ERROR_CODES = [
  "activityUnavailable",
  "activityNoAccess",
  "activityRateLimited",
  "activityBadSubject",
  "activityMaxAttempts",
  "activityInsufficientBalance",
  "activityNotRecorded",
  "activityFailed",
] as const;
export type ActivityErrorCode = (typeof ACTIVITY_ERROR_CODES)[number];

/**
 * The submission brake. Its own bucket — unlike a companion, a submission is
 * not a model call, so it does not share the chat allowance. It counts EVERY
 * submission, checkpoints included (finality is only known after grading), so
 * the number carries headroom for a game that checkpoints per answer: sixty
 * in ten minutes is a person playing and saving, six hundred is a script.
 */
export const ACTIVITY_RATE_BUCKET = "activity-submission";
export const ACTIVITY_RATE_LIMIT = { max: 60, windowMs: 10 * 60 * 1000 };

/**
 * The bounds on a subject string — ONE definition, shared by the shell (which
 * throws) and the action (which returns the code). Unbounded, a subject mints
 * one row per invented string and a >2.7 KB value dies at the btree index
 * AFTER the grading ran.
 */
export function subjectProblem(subject: unknown): "activityBadSubject" | null {
  // `unknown`, deliberately: the action receives whatever a crafted request
  // sent, and a non-string must be the code, not a TypeError-500.
  if (typeof subject !== "string") return "activityBadSubject";
  if (!subject || subject !== subject.trim() || subject.length > 100) {
    return "activityBadSubject";
  }
  // No control characters — the string reaches log lines and DB keys. The
  // companion's checkSubject refuses these too; the 100-char ceiling here is
  // the stricter of the two (companions allow 200), which only means a very
  // long slug fails on the activity side first.
  if (/[\u0000-\u001f\u007f]/.test(subject)) return "activityBadSubject";
  return null;
}

export type SubmissionDecision =
  | { action: "grade" }
  | { action: "refused"; reason: "maxAttempts" };

/**
 * Whether a submission may be graded at all — decided BEFORE `grade()` runs,
 * so a refused attempt costs nothing, cannot be metered, and cannot change a
 * stored result. Only FINALISED attempts count against the ceiling; a
 * checkpoint never incremented the counter (see `applyVerdict`).
 */
export function decideSubmission(input: {
  previous: StoredResult | null;
  maxAttempts: number | null;
}): SubmissionDecision {
  const attempts = input.previous?.attempts ?? 0;
  if (input.maxAttempts !== null && attempts >= input.maxAttempts) {
    return { action: "refused", reason: "maxAttempts" };
  }
  return { action: "grade" };
}

/**
 * Did this score pass? `null` means NOT JUDGED — a missing pass mark, a
 * missing score or a zero maximum is an activity that does not judge, never
 * one that failed. One place, so two activities cannot disagree about what
 * passing means.
 */
export function passedFrom(
  score: number | null | undefined,
  maxScore: number | null | undefined,
  passMark: number | undefined,
): boolean | null {
  if (passMark === undefined) return null;
  if (score == null || maxScore == null || maxScore <= 0) return null;
  return score / maxScore >= passMark;
}

/** The columns a verdict writes. `updatedAt` is the shell's, from its own clock. */
export interface ResultWrite {
  state: unknown;
  score: number | null;
  maxScore: number | null;
  passed: boolean | null;
  attempts: number;
  completedAt: Date | null;
}

/**
 * Turn a verdict into the row to store. Owns two decisions:
 *
 * - **A checkpoint (`final: false`) writes the resume point and nothing
 *   else.** Attempts, scores, `passed` and `completedAt` pass through
 *   untouched — an in-progress save must not count an attempt or fabricate a
 *   verdict (AC 8).
 * - **`completedAt` is when the learner first got THROUGH it.** A final
 *   verdict that did not fail (passed `true`, or an unjudged `null`) sets it;
 *   a failed attempt leaves it; once set, the first time is kept. Progress
 *   derives from this — there is no second record to disagree with it.
 *
 * A verdict without a `state` keeps the previous one: finishing an attempt
 * does not throw away the resume point unless `grade()` replaces it.
 */
export function applyVerdict(input: {
  previous: StoredResult | null;
  verdict: ActivityVerdict;
  now: Date;
  passMark?: number;
}): ResultWrite {
  const { previous, verdict, now } = input;
  const state = verdict.state !== undefined ? verdict.state : (previous?.state ?? null);

  if (!verdict.final) {
    return {
      state,
      score: previous?.score ?? null,
      maxScore: previous?.maxScore ?? null,
      passed: previous?.passed ?? null,
      attempts: previous?.attempts ?? 0,
      completedAt: previous?.completedAt ?? null,
    };
  }

  const score = verdict.score ?? null;
  const maxScore = verdict.maxScore ?? null;
  // Sticky, like `completedAt`: having passed does not un-happen on a failed
  // retake. `score`/`attempts` still tell the latest attempt's story.
  const passed =
    previous?.passed === true
      ? true
      : (verdict.passed ?? passedFrom(score, maxScore, input.passMark));
  const completedAt =
    previous?.completedAt ?? (passed !== false ? now : null);

  return {
    state,
    score,
    maxScore,
    passed,
    attempts: (previous?.attempts ?? 0) + 1,
    completedAt,
  };
}
