// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The course's switch — and the one config reader in this template whose doubts
// do not all fall the same way.
//
// ── It ships OFF, and that is not caution ──────────────────────────────────
// The commonest use of `enabled: false` here is not an incident: it is the
// window between `module add courses` on day one and the content being written
// on day twenty. A course whose pages answer before it has lessons is an empty
// product with a clean 200. So the skill switches it on AFTER `content-apply`,
// and until then every route answers the document a route that never existed
// answers.
//
// ── Two directions, on purpose ─────────────────────────────────────────────
//   * `enabled` unreadable → **OFF**. The closed direction, like every other
//     switch here.
//   * `shape` unreadable → **BROKEN, and never a default**. `self-study` is the
//     most PERMISSIVE shape: a drip course whose config went unreadable would
//     open week ten on day one, which is `docs/courses.md`'s definition of
//     having failed at the thing it was bought for. A doubt that falls to
//     "self-study" does not close a door — it opens ten.
//
// 🚨 **`gate.ts` reads only `enabled`.** The broken state is not rewritten away,
// because the operator's diagnosis page is the only thing in a deployed app that
// will name the bad value. The community answered `enabled && no problems` in
// its gate and rewrote that door away with the kill switch; `modules/community/gate.ts`
// carries the post-mortem.
//
// NOT a client component: it carries a Product Key, and product ids have no
// business in a browser bundle — the same rule `lib/ai/chat-config.ts` follows.
import raw from "@/config/course.json";
// The one judgement about a Product Key this app makes, borrowed rather than
// copied: does it exist, and is it something `hasPlan()` can ever answer true
// for. It lives beside the media config because that is where the trap was
// first paid for; a second copy here would be a second set of rules about the
// same registry.


export interface CourseConfig {
  readonly enabled: boolean;

  readonly operatorPreviewsUnlocked: boolean;
}

/** Every key this file understands. An unknown one is a PROBLEM, never ignored. */
const KNOWN = new Set([
  "enabled",
  "operatorPreviewsUnlocked",
]);

function file(): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

export function courseConfig(): CourseConfig {
  const f = file();
  return {
    // `=== true`, so a string "true", a 1 or a missing key are all OFF.
    enabled: f.enabled === true,
    // Defaults ON: without it an operator cannot preview the last week of their
    // own drip course, because they hold no grant and therefore have no clock.
    operatorPreviewsUnlocked: f.operatorPreviewsUnlocked !== false,
  };
}

/**
 * What is wrong with the file — empty when nothing is.
 *
 * ⚠️ An unknown key lands here rather than being skipped: a misspelt switch is
 * a setting somebody believes they made. `_`-prefixed keys are documentation,
 * the same convention `config/media.json` established.
 */
export function courseConfigProblems(): string[] {
  const problems: string[] = [];
  const f = file();

  for (const key of Object.keys(f)) {
    if (key.startsWith("_")) continue;
    if (!KNOWN.has(key)) problems.push(`unknown field "${key}"`);
  }

  if (f.enabled !== undefined && typeof f.enabled !== "boolean") {
    problems.push(`"enabled" must be true or false, not ${JSON.stringify(f.enabled)}`);
  }
  // 🚨 **`shape` and `planKeys` are NOT here any more, and their absence is the
  // point.** They moved onto `courses_courses` in Story 44.2, because an app
  // may hold several courses and each is a different product: one with a
  // self-study primer and an accompanied workshop needs both shapes at once,
  // and two courses sharing one key list would be one course in two halves.
  // `lib/courses.ts` → `courseProblems()` makes the same three judgements
  // where the values now live, per course. A leftover `shape` in this file is
  // reported by the unknown-key loop above rather than quietly obeyed — which
  // is what tells an operator their old value stopped deciding anything.
  if (f.operatorPreviewsUnlocked !== undefined && typeof f.operatorPreviewsUnlocked !== "boolean") {
    problems.push('"operatorPreviewsUnlocked" must be true or false');
  }

  return problems;
}

export type CourseOffReason = "disabledInConfig" | "brokenConfig";

/**
 * Why the course is not running — `null` when it is.
 *
 * `disabledInConfig` wins: an operator who switched it off gets "off", not a
 * lint about a file they deliberately parked.
 */
export function courseOffReason(): CourseOffReason | null {
  if (!courseConfig().enabled) return "disabledInConfig";
  if (courseConfigProblems().length > 0) return "brokenConfig";
  return null;
}

/** Is the course live on this installation? Every page and action asks this. */
export function isCourseEnabled(): boolean {
  return courseOffReason() === null;
}

/**
 * Did the operator switch the course ON — whatever else the file says?
 *
 * The narrower question, and there are exactly **two** lawful callers. The
 * criterion that admits both, and the one to hold a third against: **neither
 * serves anybody a course.** They tell the OPERATOR something about their own
 * installation, and the state they have to survive is precisely the one
 * `isCourseEnabled()` answers `false` in.
 *
 *  1. **The shell** (`../module.ts` → `shellState()`). `isCourseEnabled()` is
 *     false in the broken state, so a menu built on it loses every course entry
 *     exactly when somebody needs to reach the page that names the bad value.
 *     `CLAUDE.md` → UI, rule 3 states the fork: a diagnosis page keeps its entry
 *     for the operator, a page that refuses in that state loses it. The admin
 *     surface diagnoses, so its entry has to survive `brokenConfig`.
 *  2. **The hand-in digest** (`../cron.ts` → `courses-digest`). Same argument
 *     from the other end: in the `brokenConfig` state the hand-ins go on piling
 *     up, and the surface the mail points at is the one that DIAGNOSES that
 *     state instead of refusing in it. A job asking the wide question would fall
 *     silent in exactly the state the operator most needs to hear about —
 *     `planKeys` mistyped, the course dead, and the queue still growing. The
 *     same thought as `check-stuck-reloads` (`docs/cron.md`): the state that
 *     most needs reporting is the one nobody is touching.
 *
 * ⚠️ **Never a substitute for `isCourseEnabled()` in a guard.** This answers
 * "was it turned on", not "is it running": a page or action that let somebody
 * through on this would be serving a course whose shape nothing can read. The
 * two callers above hand out no lesson, no medium and no action — they count and
 * they report.
 */
export function isCourseSwitchedOn(): boolean {
  return courseConfig().enabled;
}

