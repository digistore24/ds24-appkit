// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The courses this environment holds — the row above the blocks.
//
// 🚨 **One reader, and every surface goes through it**, for the same reason
// `./access.ts` is one gate: a page that fetched courses its own way would
// eventually disagree with the gate about which course a slug names, and the
// disagreement is invisible until somebody is served material they did not buy.
//
// ── What a "problem" is here, and why it is not a throw ────────────────────
// A course row can be wrong in ways the database cannot refuse: a `shape` that
// is not one of the three (the column is `text`, because a Postgres enum makes
// adding a fourth shape a migration rather than a decision), an empty
// `planKeys`, a key naming a product this app no longer sells. All three are
// REPORTED rather than thrown, and the course is left out of what members see:
//
//   * A throw would take the whole course list down for one bad row, and the
//     app has a page whose job is to NAME that row for the operator.
//   * Serving it anyway is worse in the other direction. An unusable `shape`
//     would have to fall back to something, and `self-study` is the most
//     PERMISSIVE shape — a drip course whose shape went missing would open week
//     ten on day one. `docs/courses.md` calls that having failed at the thing
//     the course was bought for.
//
// So: `usableCourses()` for anything a member can reach, `allCourses()` plus
// `courseProblems()` for the operator's diagnosis surface. The split is the
// whole file.
import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { planProblem } from "@/lib/media/config";

import { coursesCourses } from "../schema";
import { COURSE_SHAPES, type CourseShape } from "../rules";

export interface Course {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly summary: string | null;
  readonly position: number;
  /** `null` when the stored value is not one of the three — see the header. */
  readonly shape: CourseShape | null;
  readonly planKeys: readonly string[];
  readonly origin: string;
}

function toCourse(row: typeof coursesCourses.$inferSelect): Course {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    position: row.position,
    shape: COURSE_SHAPES.includes(row.shape as CourseShape) ? (row.shape as CourseShape) : null,
    planKeys: row.planKeys,
    origin: row.origin,
  };
}

/**
 * Every course row, in the order the operator put them in.
 *
 * ⚠️ **Including the broken ones.** This is the operator's answer, not the
 * member's — `usableCourses()` is the member's. A list that quietly dropped a
 * course with a bad `shape` would leave the admin page unable to show the row
 * whose value it exists to name.
 *
 * Ordered by `position` then `slug`: position is the operator's decision, and
 * the slug is the tie-break so two courses at position 0 do not swap places
 * between requests. An unstable order is a list that looks different every time
 * somebody reloads it, which reads as a bug in the app rather than a missing
 * `order by`.
 */
export async function allCourses(): Promise<Course[]> {
  const rows = await db
    .select()
    .from(coursesCourses)
    .orderBy(asc(coursesCourses.position), asc(coursesCourses.slug));
  return rows.map(toCourse);
}

/**
 * What is wrong with one course — empty when nothing is.
 *
 * The same three judgements `courseConfigProblems()` used to make about the
 * config file, moved to where the values now live. Every key is checked, not
 * the first: a list whose second entry is a token package is exactly as broken,
 * and naming only the head sends the operator round the loop once per mistake.
 */
export function courseProblems(course: Course): string[] {
  const problems: string[] = [];
  if (course.shape === null) {
    problems.push(`"shape" must be one of ${COURSE_SHAPES.join(", ")}`);
  }
  if (course.planKeys.length === 0) {
    problems.push(
      '"planKeys" is empty — the course has to be sold as something. It is a LIST because ' +
        "one offering is one Digistore24 product per billing interval: a course sold monthly " +
        "and yearly names both keys, and holding either one opens it",
    );
  }
  const seen = new Set<string>();
  for (const key of course.planKeys) {
    if (seen.has(key)) {
      problems.push(`"planKeys" lists "${key}" twice`);
      continue;
    }
    seen.add(key);
    // 🚨 `hasPlan()` THROWS on a key the registry does not know, so an
    // unchecked value would take the page down rather than mean "no access" —
    // the trap AD-41 and `planProblem()` exist for.
    const problem = planProblem(key);
    if (problem) problems.push(`"planKeys": ${problem}`);
  }
  return problems;
}

/**
 * The courses a MEMBER may be shown — the ones with no problems.
 *
 * A course left out here is not hidden from the operator: `allCourses()` still
 * carries it and the admin surface names what is wrong with it. This is the
 * same fork the module already makes between `gate.ts` (which keeps the
 * diagnosis page reachable) and every member-facing route.
 */
export async function usableCourses(): Promise<Course[]> {
  return (await allCourses()).filter((course) => courseProblems(course).length === 0);
}

/**
 * One course by its slug — `null` for "there is none" AND for "it is broken".
 *
 * ⚠️ **The two collapse deliberately, and only on the member's path.** A
 * learner who reached a course whose `shape` is unreadable must get the same
 * "not found" as one who typed a slug that never existed; telling them apart
 * would say "this course exists and is broken" to somebody who cannot act on
 * it. The operator's surface calls `allCourses()` and sees both states.
 */
export async function courseBySlug(slug: string): Promise<Course | null> {
  const [row] = await db
    .select()
    .from(coursesCourses)
    .where(eq(coursesCourses.slug, slug))
    .limit(1);
  if (!row) return null;
  const course = toCourse(row);
  return courseProblems(course).length === 0 ? course : null;
}

/**
 * One course by its slug, problems and all — the OPERATOR's lookup.
 *
 * Separate from `courseBySlug()` rather than a flag on it, because a flag is
 * something a member-facing caller can pass by accident and this is the one
 * call that must never be made on a member's path.
 */
export async function courseBySlugForOperator(slug: string): Promise<Course | null> {
  const [row] = await db
    .select()
    .from(coursesCourses)
    .where(eq(coursesCourses.slug, slug))
    .limit(1);
  return row ? toCourse(row) : null;
}

/**
 * One course by its id — for the paths that DERIVE the course rather than being
 * told it.
 *
 * 🚨 **A Server Action must never take a course from the form.** Every argument
 * a form carries is written by whoever sent the request, so an action that
 * trusted one would let a member gate themselves on the cheap course while
 * acting on the expensive one. They take the lesson, walk lesson → block →
 * course, and gate on what they found. This is the last step of that walk.
 *
 * Problems collapse to `null` exactly as in `courseBySlug()`: a caller on a
 * member's path must not act inside a course whose row does not hold.
 */
export async function courseById(id: string): Promise<Course | null> {
  const [row] = await db.select().from(coursesCourses).where(eq(coursesCourses.id, id)).limit(1);
  if (!row) return null;
  const course = toCourse(row);
  return courseProblems(course).length === 0 ? course : null;
}

/** One course by its id, problems and all — the OPERATOR's lookup by id. */
export async function courseByIdForOperator(id: string): Promise<Course | null> {
  const [row] = await db.select().from(coursesCourses).where(eq(coursesCourses.id, id)).limit(1);
  return row ? toCourse(row) : null;
}
