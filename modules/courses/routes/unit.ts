// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// One lesson, with its text — the lesson page's answer.
//
// 🚨 **The unlock rule is re-applied here and is not inherited from the
// outline.** The outline says a block is shut; this is a separate HTTP request
// and a client that skipped the outline, or replayed this one, has been told
// nothing. Same argument `pages/actions.ts` makes for the actions: a rule
// enforced in one of two places is enforced nowhere.
//
// ⚠️ **Media travel as IDS, never as addresses.** `mediaUrlFor()` mints a signed
// URL that expires and bypasses `mayAccess()` — handing one out from a list is
// exactly how a paid file becomes a public one (`../lib/media.ts`). The client
// fetches `/api/v1/media/{id}`, which asks `mayAccess()` for that viewer and
// answers 404 for missing and forbidden alike.
import { guardApi } from "@/modules/api/api/guard";
import { apiError, apiJson } from "@/modules/api/api/rules";

import { blockById, completedSlugsFor, submissionFor, unitBySlug } from "../lib/manage";
import { isUnlocked } from "../rules";

import { unitViewer } from "./viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const g = await guardApi(request);
  if (!g.ok) return g.response;

  const { slug } = await context.params;
  // Lesson → block → course → the gate, in one place. The URL carries no
  // course segment: the slug is unique app-wide, so the lesson names its own
  // course and a segment would be a second statement of the same fact.
  const v = await unitViewer(g.memberId, g.role, slug);
  if (!v.ok) return v.response;
  const { unit, block } = v;

  // 🚨 403 here where `courseViewer()` answers 404, and the difference is
  // deliberate. A member without the plan must not learn the course exists at
  // all. A member WITH it has already been handed this lesson's title and its
  // `unlocked: false` by the outline — refusing with 404 would tell them
  // something they can already see is untrue, and a client could not tell "not
  // yet" from "gone".
  if (!isUnlocked(block.releaseAfterDays, v.access.startedAt, v.course.shape!, new Date())) {
    return apiError("forbidden", "This lesson has not opened yet.");
  }

  const [completed, submission] = await Promise.all([
    completedSlugsFor(g.memberId),
    // Scoped by the key's member in the QUERY — "no such row" and "somebody
    // else's row" are one answer (`../lib/manage.ts`).
    submissionFor(g.memberId, unit.slug),
  ]);

  return apiJson({
    slug: unit.slug,
    title: unit.title,
    position: unit.position,
    body: unit.body,
    taskPrompt: unit.taskPrompt,
    completed: completed.has(unit.slug),
    block: { slug: block.slug, title: block.title },
    media: {
      coverId: unit.coverMediaId,
      videoId: unit.videoMediaId,
      subtitleId: unit.subtitleMediaId,
      worksheetId: unit.worksheetMediaId,
    },
    submission: submission
      ? {
          body: submission.body,
          submittedAt: submission.submittedAt.toISOString(),
          reply: submission.reply,
          repliedAt: submission.repliedAt ? submission.repliedAt.toISOString() : null,
          // `repliedBy` is deliberately absent: who on the operator's side read
          // a hand-in is the operator's record, not something the member's own
          // program is owed, and a coach's user id is of no use to a client.
        }
      : null,
  });
}
