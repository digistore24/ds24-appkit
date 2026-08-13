// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The three shapes, in the one place every reader can reach.
//
// 🚨 **A `.mjs` on purpose, and it is the SOURCE rather than a copy.** Three
// readers need this list and they do not share a language: `rules.ts` is
// TypeScript and shipped to a mobile companion through `coreExport`;
// `content/appliers/course.mjs` is bare Node, because an applier runs outside
// the app with no bundler (its own header says so); `check.mjs` is a command a
// customer types. TypeScript can import a `.mjs`, and nothing can import a
// `.ts` from bare Node — so the list lives here and the other two read it.
//
// ⚠️ **It was written out twice before this file existed** — `rules.ts` and
// `check.mjs` each held their own array — and the two agreed only because
// nobody had added a fourth shape yet. `docs/conventions.md` → *A `.mjs` beside
// a `.ts`* is the sanctioned pattern for exactly this.
//
// ── Why the list is closed, and why there is no default ────────────────────
// `docs/courses.md` names three products and argues that they are not three
// data models: they differ on two columns (`releaseAfterDays`, `taskPrompt`).
// A fourth entry here is therefore a claim that some vendor's course differs on
// a THIRD axis, which is a schema change and a decision, not a string.
//
// And a course whose shape cannot be read is BROKEN rather than defaulted:
// `self-study` is the most permissive of the three, so a drip course that fell
// back to it would open week ten on day one — `docs/courses.md`'s own
// definition of having failed at the thing the course was bought for.

/** @typedef {"self-study" | "drip" | "workshop"} CourseShape */

/** @type {readonly CourseShape[]} */
export const COURSE_SHAPES = ["self-study", "drip", "workshop"];

/** Is this one of the three? Narrow, so a caller can use it as a guard. */
export function isCourseShape(value) {
  return COURSE_SHAPES.includes(value);
}
