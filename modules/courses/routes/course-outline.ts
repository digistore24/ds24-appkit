// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The course's shape, for a member's own program — the overview page's answer.
//
// It carries STRUCTURE and no content: block and lesson titles, the order, what
// has opened and what this member has ticked off. Deliberately no body and no
// media ids — the overview page resolves no media either (`../lib/media.ts`
// says why: it would put a query on the page every learner opens first), and a
// lesson's text belongs to the lesson endpoint, which is the one that re-asks
// the unlock rule before handing it over. An outline that carried bodies would
// hand week ten to somebody in week one in a single request.
import { guardApi } from "@/modules/api/api/guard";
import { apiJson } from "@/modules/api/api/rules";

import { completedSlugsFor, courseOutline } from "../lib/manage";
import { isUnlocked, unlockedAt } from "../rules";

import { courseFor, courseViewer } from "./viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ course: string }> },
): Promise<Response> {
  const g = await guardApi(request);
  if (!g.ok) return g.response;

  const { course: courseSlug } = await context.params;
  // 🚨 The course FIRST, because the gate is about a course: `courseViewer()`
  // reads that course's own `planKeys`. Three states collapse into one 404 in
  // `courseFor()` — off, no such slug, row does not hold — so a caller cannot
  // learn that a course exists which they have not bought.
  const c = await courseFor(courseSlug);
  if (!c.ok) return c.response;

  const v = await courseViewer(g.memberId, g.role, c.course);
  if (!v.ok) return v.response;

  const shape = c.course.shape!;
  const now = new Date();
  const [blocks, completed] = await Promise.all([
    courseOutline(c.course.id),
    completedSlugsFor(g.memberId),
  ]);

  return apiJson({
    slug: c.course.slug,
    title: c.course.title,
    summary: c.course.summary,
    shape,
    // What the operator sees is not what a buyer sees, and a client showing a
    // preview banner needs to know which it is holding (`../lib/access.ts`).
    asOperator: v.access.asOperator,
    blocks: blocks.map((block) => {
      const open = isUnlocked(block.releaseAfterDays, v.access.startedAt, shape, now);
      const opensAt = unlockedAt(block.releaseAfterDays, v.access.startedAt, shape);
      return {
        slug: block.slug,
        title: block.title,
        summary: block.summary,
        position: block.position,
        unlocked: open,
        // `null` in a self-study course — there is no clock at all, which is a
        // different statement from "opens at some date". A client rendering
        // this must not turn `null` into today (`docs/conventions.md` →
        // *Dates that stop being dates*).
        opensAt: opensAt ? opensAt.toISOString() : null,
        units: block.units.map((unit) => ({
          slug: unit.slug,
          title: unit.title,
          position: unit.position,
          completed: completed.has(unit.slug),
          // Whether the lesson ASKS for something, not what it asks — the
          // prompt is content and travels with the lesson.
          hasTask: unit.taskPrompt !== null,
        })),
      };
    }),
  });
}
