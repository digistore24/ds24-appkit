// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `GET /api/v1/courses` — what this app offers, and which of it this key's
// owner holds.
//
// ── Why this route changed meaning ─────────────────────────────────────────
// It WAS the outline of the one course an app could have. With several, the
// same reasoning the pages follow applies: the path has to answer "which one"
// before it can answer anything, so the outline moved to
// `/api/v1/courses/<course>` and this became the index.
//
// 🚨 **That is a breaking change on the wire, and it is the only one in this
// story.** A mobile companion built on the old shape reads `body.blocks` here
// and finds none. The lesson routes (`/api/v1/courses/units/<slug>` and its two
// children) are deliberately untouched — the slug is unique app-wide, so the
// lesson names its own course and no segment was needed. `docs/api.md` carries
// the note; `requires:` in the mobile skill's frontmatter is the mechanism that
// keeps an older app from being told about a shape its code does not serve.
//
// ── What it says about a course the caller has NOT bought ──────────────────
// Its title, its summary, and `entitled: false`. Nothing about what is inside
// it — no block count, no lesson count, no next lesson. The same line
// `pages/list-page.tsx` draws and for the same reason: a surface more
// permissive than its page turns into an existence oracle, and here the
// difference between the two would be measurable by anyone with a key.
//
// ⚠️ Unlike every other route on this surface it does NOT refuse a caller who
// holds nothing. An empty catalogue and a catalogue of things you have not
// bought are different answers, and a client that cannot tell them apart shows
// "no courses" to somebody who could buy three.
import { apiJson } from "@/modules/api/api/rules";
import { guardApi } from "@/modules/api/api/guard";

import { courseAccessFor } from "../lib/access";
import { courseOffReason } from "../lib/config";
import { usableCourses } from "../lib/courses";

// ⚠️ The segment config every sibling route on this surface carries, and the
// only one added in Story 44.2 that did not. The guard in
// `modules/boundary.test.ts` compares the handler's declarations against its
// wrapper's and bails when NEITHER side declares anything — so a route with no
// config at all is the one shape it cannot see. That is the same class as the
// commit that found 19 handlers declaring these and no route carrying them,
// only from the other end.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const g = await guardApi(request);
  if (!g.ok) return g.response;

  // The module's switch, and the only refusal this route makes. `apiJson` with
  // an empty list would say "this app sells no courses", which is a different
  // statement from "this app has no course surface".
  if (courseOffReason()) {
    return apiJson({ courses: [] });
  }

  // `usableCourses()`, not `allCourses()`: a course whose row does not hold is
  // one nobody can open, and offering it over the API is the same mistake as
  // offering it on the page.
  const courses = await usableCourses();
  const rows = await Promise.all(
    courses.map(async (course) => {
      const access = await courseAccessFor(g.memberId, g.role, course);
      return {
        slug: course.slug,
        title: course.title,
        summary: course.summary,
        shape: course.shape,
        position: course.position,
        entitled: access.entitled,
        // What the operator sees is not what a buyer sees, and a client showing
        // a preview banner needs to know which it is holding
        // (`../lib/access.ts`).
        asOperator: access.asOperator,
      };
    }),
  );

  return apiJson({ courses: rows });
}
