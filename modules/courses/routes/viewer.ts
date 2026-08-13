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
import { courseOffReason } from "../lib/config";

export type CourseViewer =
  | { ok: true; access: CourseAccess }
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
export async function courseViewer(memberId: string, role: string): Promise<CourseViewer> {
  if (courseOffReason()) {
    return { ok: false, response: apiError("notFound", "This app has no course.") };
  }

  const access = await courseAccessFor(memberId, role);
  if (!access.entitled) {
    return { ok: false, response: apiError("notFound", "This app has no course.") };
  }

  return { ok: true, access };
}
