// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The course's own gate, for the HTTP surface — the second of two, never the
// first.
//
// 🚨 **`guardApi()` stays in every handler and is never delegated here.** It
// answers *who is asking*, and `modules/api/routes/guard-presence.test.ts`
// reads each handler's own source for it: a handler that called only this
// helper would be a handler with no key check, and the test that says so is the
// only one looking at this surface (`app/route-protection.test.ts` skips
// `app/api/v1` on purpose). So the order in every handler is
// `guardApi()` → `courseViewer()`, both spelled out.
//
// This half answers the two questions `pages/actions.ts` → `viewer()` asks of a
// browser request, with the same functions and in the same order — the module
// switch, then the purchase gate — because "the web page and the API cannot
// share the function" is the smell `docs/api.md` names, and the gate is exactly
// the thing that must not have two opinions.
import { apiError } from "@/modules/api/api/rules";

import { courseAccessFor, type CourseAccess } from "../lib/access";
import { courseById, courseBySlug, type Course } from "../lib/courses";
import { blockById, unitBySlug } from "../lib/manage";
import { courseOffReason } from "../lib/config";

export type CourseViewer =
  | { ok: true; access: CourseAccess; course: Course }
  | { ok: false; response: Response };

/**
 * Is this key's owner in the course?
 *
 * 🚨 **Both refusals are 404, and that is the same decision the pages make.**
 * A switched-off module answers what a route that never existed answers; a
 * member without the plan must not learn that a course exists at all, because
 * "there is a course here you have not bought" is purchase information about
 * somebody else's product line and the existence-oracle failure
 * `docs/content-source.md` argues at length. The pages call `notFound()` for
 * both; this is the same answer in the shape a program can read.
 *
 * ⚠️ It takes the id and role the GUARD produced, never anything off the
 * request. No endpoint on this surface accepts a member id — the account is the
 * key's owner, bound before the handler runs.
 */
export async function courseViewer(
  memberId: string,
  role: string,
  course: Course,
): Promise<CourseViewer> {
  if (courseOffReason()) {
    return { ok: false, response: apiError("notFound", "This app has no course.") };
  }

  const access = await courseAccessFor(memberId, role, course);
  if (!access.entitled) {
    return { ok: false, response: apiError("notFound", "This app has no course.") };
  }

  return { ok: true, access, course };
}

/**
 * The course this request is about — resolved, or the refusal.
 *
 * 🚨 **Three states collapse into ONE 404, deliberately**: the module is off,
 * the slug names no course, and the course's row does not hold. A caller who
 * could tell them apart would learn that a course exists which they have not
 * bought, which is the existence-oracle failure one paragraph up. `null` from
 * `courseBySlug()` already merges the last two; this adds the switch.
 */
export async function courseFor(slug: string): Promise<
  { ok: true; course: Course } | { ok: false; response: Response }
> {
  if (courseOffReason()) {
    return { ok: false, response: apiError("notFound", "This app has no course.") };
  }
  const course = await courseBySlug(slug);
  if (!course) {
    return { ok: false, response: apiError("notFound", "This app has no course.") };
  }
  return { ok: true, course };
}

/**
 * The lesson an `/api/v1/courses/units/<slug>` request is about, the course it
 * sits in, and this key's standing in THAT course.
 *
 * 🚨 **The course is DERIVED from the lesson, and the URL carries no course
 * segment on purpose.** Unit slugs are unique across the app, so the lesson
 * already names its course — adding a segment would create a second statement
 * of the same fact and a way for the two to disagree. It also keeps every
 * `/api/v1` path a mobile companion already calls exactly as it was, which is
 * the one part of this module with a released client on the other end.
 *
 * The pages do the mirror image: their URL DOES carry the course, so
 * `unit/page.tsx` checks that the block belongs to it. Same property, reached
 * from the two ends.
 */
export async function unitViewer(
  memberId: string,
  role: string,
  slug: string,
): Promise<
  | {
      ok: true;
      access: CourseAccess;
      course: Course;
      unit: NonNullable<Awaited<ReturnType<typeof unitBySlug>>>;
      block: NonNullable<Awaited<ReturnType<typeof blockById>>>;
    }
  | { ok: false; response: Response }
> {
  if (courseOffReason()) {
    return { ok: false, response: apiError("notFound", "This app has no course.") };
  }

  const unit = await unitBySlug(slug);
  if (!unit) return { ok: false, response: apiError("notFound", "No such lesson.") };
  const block = await blockById(unit.blockId);
  if (!block) return { ok: false, response: apiError("notFound", "No such lesson.") };
  const course = await courseById(block.courseId);
  // A lesson whose course row does not hold is a lesson nobody can be entitled
  // to — the same 404 as one that is not there. The operator's surface is where
  // the difference is a sentence.
  if (!course) return { ok: false, response: apiError("notFound", "No such lesson.") };

  const access = await courseAccessFor(memberId, role, course);
  if (!access.entitled) {
    return { ok: false, response: apiError("notFound", "This app has no course.") };
  }
  return { ok: true, access, course, unit, block };
}
