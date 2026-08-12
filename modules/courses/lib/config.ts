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
import { planProblem } from "@/lib/media/config";

import { COURSE_SHAPES, type CourseShape } from "../rules";

export interface CourseConfig {
  readonly enabled: boolean;
  readonly shape: CourseShape | null;
  readonly productKey: string | null;
  readonly operatorPreviewsUnlocked: boolean;
}

/** Every key this file understands. An unknown one is a PROBLEM, never ignored. */
const KNOWN = new Set([
  "enabled",
  "shape",
  "productKey",
  "operatorPreviewsUnlocked",
]);

function file(): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

export function courseConfig(): CourseConfig {
  const f = file();
  const shape = f.shape;
  return {
    // `=== true`, so a string "true", a 1 or a missing key are all OFF.
    enabled: f.enabled === true,
    shape: COURSE_SHAPES.includes(shape as CourseShape) ? (shape as CourseShape) : null,
    productKey: typeof f.productKey === "string" && f.productKey ? f.productKey : null,
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
  if (f.shape !== undefined && !COURSE_SHAPES.includes(f.shape as CourseShape)) {
    problems.push(
      `"shape" is ${JSON.stringify(f.shape)} — it must be one of ${COURSE_SHAPES.join(", ")}`,
    );
  }
  // Only demanded once the course is meant to run: an app that has not switched
  // it on yet is not carrying a fault.
  if (f.enabled === true) {
    if (f.shape === undefined) problems.push('"shape" is missing, and there is no default');
    if (typeof f.productKey !== "string" || !f.productKey) {
      problems.push('"productKey" is missing — the course has to be sold as something');
    } else {
      // 🚨 **Present is not the same as usable, and the gap was measurable.**
      // A key naming a product that has been retired from
      // `config/digistore-products.json` — or a TOKEN package, for which
      // `hasPlan()` answers false for ever — left the course `enabled`: every
      // lesson's media then failed with `MediaError("noAccess")`, and
      // `courseAccessFor()` (`./access.ts` → `hasPlan()`) THREW, because
      // `hasPlan()` throws on a key it does not know. So a typo took the page
      // down instead of meaning "no access", which is the exact trap AD-41 and
      // `planProblem()` exist for. Answering `brokenConfig` sends the operator
      // to the diagnosis page that names the value.
      const problem = planProblem(f.productKey);
      if (problem) problems.push(`"productKey": ${problem}`);
    }
  }
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
 *     `productKey` mistyped, the course dead, and the queue still growing. The
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

/**
 * The shape, for code that has already established the course is running.
 *
 * Throws rather than defaulting, and the throw is unreachable behind
 * `isCourseEnabled()` — it exists so that a caller who skipped that check gets a
 * fault instead of the most permissive shape.
 */
export function courseShape(): CourseShape {
  const { shape } = courseConfig();
  if (!shape) throw new Error("courseShape() called while config/course.json has no valid shape");
  return shape;
}
