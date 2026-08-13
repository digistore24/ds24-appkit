// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Handing work in — `submitTaskAction`'s twin for a member's own program.
//
// Same order, same functions, same refusals as the Server Action: the switch,
// the purchase gate, the lesson, its block, the unlock rule, then
// `submissionProblem()`. What differs is only how a refusal is SPELLED.
//
// 🚨 **The module's error codes do not travel on the wire, and translating them
// is not an option either.** `COURSES_ERROR_CODES` are i18n keys a page turns
// into a German or English sentence for a person; `/api/v1` answers a PROGRAM
// in stable English codes from a closed vocabulary, and
// `i18n/messages.test.ts`'s registry is deliberately not this surface's
// (`docs/api.md`). So each problem is MAPPED to the HTTP-shaped refusal it
// really is, with a sentence naming the cause — and the map is exhaustive over
// the codes this endpoint can produce rather than a `default` that would turn a
// new refusal into a silent 400.
import { guardApi } from "@/modules/api/api/guard";
import { apiError, apiJson, type ApiErrorCode } from "@/modules/api/api/rules";

import { courseShape } from "../lib/config";
import { blockById, submissionFor, unitBySlug, upsertSubmission } from "../lib/manage";
import { MAX_SUBMISSION_CHARS, isUnlocked, submissionProblem } from "../rules";

import { courseViewer } from "./viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The five refusals a MEMBER can produce here, each as the code and sentence a
 * program reads.
 *
 * The other twelve in `COURSES_ERROR_CODES` belong to the operator's authoring
 * surface, which has no endpoint on this API at all — the mobile companion is a
 * viewer and a participant, never an author (`docs/mobile.md`).
 */
const REFUSALS: Record<string, { code: ApiErrorCode; detail: string }> = {
  coursesNotFound: { code: "notFound", detail: "No such lesson." },
  coursesLocked: { code: "forbidden", detail: "This lesson has not opened yet." },
  coursesShapeForbidsSubmission: {
    code: "forbidden",
    detail: "This course does not take hand-ins.",
  },
  coursesAlreadyReplied: {
    code: "forbidden",
    detail: "This hand-in has been answered and can no longer be changed.",
  },
  coursesSubmissionEmpty: { code: "badRequest", detail: "The hand-in is empty." },
  coursesSubmissionTooLong: {
    code: "badRequest",
    detail: `The hand-in is longer than ${MAX_SUBMISSION_CHARS} characters.`,
  },
};

function refuse(problem: string): Response {
  const mapped = REFUSALS[problem];
  // A course code with no mapping is a bug in THIS file, not in the caller —
  // said as a 500 rather than guessed into a 400, because a refusal nobody
  // planned answered as "your request was bad" sends the reader the wrong way.
  return mapped
    ? apiError(mapped.code, mapped.detail)
    : apiError("internal", `Unmapped course refusal: ${problem}`);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const g = await guardApi(request, { scope: "write" });
  if (!g.ok) return g.response;

  const v = await courseViewer(g.memberId, g.role);
  if (!v.ok) return v.response;

  let body: unknown;
  try {
    body = ((await request.json()) as { body?: unknown }).body;
  } catch {
    return apiError("badRequest", 'Send a JSON body: { "body": "…" }.');
  }
  if (typeof body !== "string") {
    return apiError("badRequest", '"body" must be a string.');
  }

  const { slug } = await context.params;
  const unit = await unitBySlug(slug);
  if (!unit) return refuse("coursesNotFound");

  const block = await blockById(unit.blockId);
  if (!block) return refuse("coursesNotFound");
  if (!isUnlocked(block.releaseAfterDays, v.access.startedAt, courseShape(), new Date())) {
    return refuse("coursesLocked");
  }

  const existing = await submissionFor(g.memberId, unit.slug);
  const problem = submissionProblem({
    shape: courseShape(),
    taskPrompt: unit.taskPrompt,
    alreadyReplied: existing?.repliedAt != null,
    body,
  });
  if (problem) return refuse(problem);

  // Trimmed ONCE, and this is the string the rule judged — a check on one text
  // beside a store of another is two texts wearing one decision.
  const written = await upsertSubmission(g.memberId, unit.slug, body.trim());
  // The statement carries `replied_at is null` too, so `false` means somebody
  // replied between the check above and this line. Same answer, honestly
  // reached: nothing was written.
  if (!written) return refuse("coursesAlreadyReplied");

  const saved = await submissionFor(g.memberId, unit.slug);
  return apiJson({
    slug: unit.slug,
    submission: saved
      ? {
          body: saved.body,
          submittedAt: saved.submittedAt.toISOString(),
          reply: saved.reply,
          repliedAt: saved.repliedAt ? saved.repliedAt.toISOString() : null,
        }
      : null,
  });
}
