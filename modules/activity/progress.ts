// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Progress over interactive elements — derived, never stored.
//
// PURE, on the pattern of `lib/onboarding/rules.ts`, and for its reason,
// which is worth restating because somebody will want a `progress` column:
//
//   AN ELEMENT IS DONE BECAUSE ITS RESULT SAYS SO — NEVER BECAUSE A COUNTER
//   WAS INCREMENTED.
//
// There is no second record. `activity_results.completedAt` (story 14.2:
// the first time the learner got THROUGH it, kept once set) is the single
// source, and this file only counts it against what the page currently
// expects. That is what makes every hard case free: a reset result drops the
// count by itself, a unit removed from the course stops counting the moment
// the expected list stops naming it, and an operator deleting a row needs no
// second write anywhere. A stored number gets every one of those wrong.
//
// The caller reads the rows (`resultFor`, or one scoped query for a page's
// worth) and hands them in — this file touches no database, which is what
// `results.test.ts`'s folder tripwire enforces.
//
// Rendering: the shipped shape is `role="progressbar"` with the fraction —
// `components/onboarding-checklist.tsx` is the model to copy (copy the
// SHAPE, not the component: the checklist is wired to onboarding copy and
// hides itself when done, which is wrong for a course overview —
// `docs/courses.md` says the same).
import type { StoredResult } from "./rules";

/** One element a page expects — the panel coordinates, nothing more. */
export interface ExpectedElement {
  activityId: string;
  subject: string;
}

/** A result row with its coordinates — what the caller's query returns. */
export type LocatedResult = StoredResult & ExpectedElement;

export interface ActivityProgress {
  /** Elements with a completion, of those expected. */
  done: number;
  total: number;
  /** 0..1 — the `role="progressbar"` value. 0 for an empty expectation. */
  fraction: number;
  /** The first expected element without a completion, or `null` when done. */
  next: ExpectedElement | null;
}

/**
 * Count completions against what the page expects, in the page's order.
 *
 * Only expected elements count — a result for a unit the course no longer
 * contains inflates nothing, which is the property a stored counter cannot
 * have.
 */
export function activityProgress(
  results: ReadonlyArray<LocatedResult>,
  expected: ReadonlyArray<ExpectedElement>,
): ActivityProgress {
  const completed = new Set(
    results
      .filter((r) => r.completedAt !== null)
      .map((r) => `${r.activityId}\u0000${r.subject}`),
  );
  let done = 0;
  let next: ExpectedElement | null = null;
  // A pair listed twice must not count twice — the page's list is input, and
  // input gets deduplicated rather than trusted.
  const seen = new Set<string>();
  for (const e of expected) {
    const key = `${e.activityId}\u0000${e.subject}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (completed.has(key)) {
      done += 1;
    } else if (next === null) {
      next = e;
    }
  }
  return {
    done,
    total: seen.size,
    fraction: seen.size === 0 ? 0 : done / seen.size,
    next,
  };
}
