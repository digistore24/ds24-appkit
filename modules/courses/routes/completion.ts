// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Ticking a lesson off — `setCompletedAction`'s twin for a member's own program.
//
// The order below repeats that action's line for line, and the repetition is
// the point rather than an accident: the switch, the purchase gate, the lesson,
// its block, the unlock rule, and only then the write.
//
// 🚨 **`{ scope: "write" }`** — this changes data, so a read-only key is refused
// in the call path by `guardApi()`, not by being left off a list.
//
// 🚨 **No member id is read from the request.** The account is the key's owner.
// A `memberId` in the body changes nothing — `./routes.test.ts` asserts it at
// runtime for every door AND reads these files for a code path that could.
import { guardApi } from "@/modules/api/api/guard";
import { apiError, apiJson } from "@/modules/api/api/rules";

import { courseShape } from "../lib/config";
import { blockById, setCompleted, unitBySlug } from "../lib/manage";
import { isUnlocked } from "../rules";

import { courseViewer } from "./viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const g = await guardApi(request, { scope: "write" });
  if (!g.ok) return g.response;

  const v = await courseViewer(g.memberId, g.role);
  if (!v.ok) return v.response;

  // `{ "done": true }`, and `done` is required rather than defaulted: a client
  // that meant to un-tick and sent a malformed body must not tick instead.
  let done: unknown;
  try {
    done = ((await request.json()) as { done?: unknown }).done;
  } catch {
    return apiError("badRequest", 'Send a JSON body: { "done": true } or { "done": false }.');
  }
  if (typeof done !== "boolean") {
    return apiError("badRequest", '"done" must be true or false.');
  }

  const { slug } = await context.params;
  const unit = await unitBySlug(slug);
  if (!unit) return apiError("notFound", "No such lesson.");

  const block = await blockById(unit.blockId);
  if (!block) return apiError("notFound", "No such lesson.");

  // 🚨 The same re-application the action makes, for the same reason: without
  // it a learner marks week ten done on day one by replaying this request.
  if (!isUnlocked(block.releaseAfterDays, v.access.startedAt, courseShape(), new Date())) {
    return apiError("forbidden", "This lesson has not opened yet.");
  }

  // Idempotent in both directions (`../lib/manage.ts`), so a retry is safe —
  // which is what lets a mobile client repeat a request it never saw answered.
  await setCompleted(g.memberId, unit.slug, done);

  return apiJson({ slug: unit.slug, completed: done });
}
