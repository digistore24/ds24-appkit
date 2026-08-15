// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use server";

// The operator's half of shape 3: answering what somebody handed in.
//
// It sits beside `./actions.ts` rather than under `../pages/submissions/` on
// purpose. `admin/` is the directory `./guard.test.ts` reads as "every
// `"use server"` file here is an HTTP endpoint and had better be guarded", so a
// second reply action added later is found by that test on the day it lands
// rather than on the day somebody remembers to list it. The PAGES live under
// `../pages/`, which `docs/modules.md` hands to the vendor to redesign.
//
// SECURITY — `await guard()` opens the one action here, and it is the switch
// then `requireOwner()`, in that order (`./authz.ts`). Off beats operator.
//
// 🚨 **It takes no member id, and there is none to take.** The row is addressed
// by its OWN id and the account it belongs to is never named by the request —
// the same guarantee `spendTokens()` and `/api/v1` give, reached differently:
// there the account is the session's, here it is whatever the addressed row
// already says. What the request DOES name is who is answering, and that comes
// from the session too (`guard()`'s return), never from the form.
//
// LANGUAGE: here — and only here — the codes from `../rules.ts` become
// sentences (`CLAUDE.md` → Languages).
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";

import type { ActionState } from "@/hooks/use-action-toast";

import { replyToSubmission, submissionById } from "../lib/manage";
import { MAX_REPLY_CHARS, replyProblem } from "../rules";
import { guard } from "./authz";

const QUEUE = "/dashboard/admin/course/submissions";
/** The member's own lesson page — this write changes what they read there. */
const COURSE = "/dashboard/course";

/**
 * Answer one hand-in, or correct an answer already given.
 *
 * The order is the decision, and every step is asked again here although the
 * page asked it first — a Server Action is a separate HTTP endpoint and the
 * page's checks say nothing about a request somebody replayed:
 *
 *   1. `guard()` — the switch, then `requireOwner()`, before any database work.
 *   2. the row, by its id. Unknown is `coursesNotFound`, the same answer a row
 *      that never existed gets.
 *   3. `replyProblem()` — empty, then too long. An empty reply is a refusal and
 *      never a quiet undo; there is no action anywhere in this module that sets
 *      `replied_at` back to null.
 *   4. the write, which is ONE statement whose `coalesce`s make `replied_at`
 *      and `replied_by` immovable (`../lib/manage.ts`).
 */
export async function replyToSubmissionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await guard();
  const t = await getTranslations("errors");

  try {
    const id = String(formData.get("submissionId") ?? "").trim();
    const reply = String(formData.get("reply") ?? "");

    const submission = await submissionById(id);
    if (!submission) return { error: t("coursesNotFound"), ok: null };

    const problem = replyProblem(reply);
    // The ceiling travels with the sentence — "too long" with no number is a
    // refusal somebody argues with. `t()` ignores values a message does not
    // name, so the empty case is unaffected.
    if (problem) return { error: t(problem, { max: MAX_REPLY_CHARS }), ok: null };

    // Trimmed ONCE, and this is the same string the rule judged.
    const written = await replyToSubmission({
      id: submission.id,
      reply: reply.trim(),
      ownerId: session.user.id,
    });
    // An UPDATE matching nothing succeeds, so `false` means the row went away
    // between the read and the write — a member deleting their account takes
    // their hand-ins with them. Same answer as an unknown id, honestly reached.
    if (!written) return { error: t("coursesNotFound"), ok: null };

    revalidatePath(QUEUE);
    revalidatePath(`${QUEUE}/${submission.id}`);
    // The member's lesson page renders the reply and the freeze notice, and it
    // is the reason this write exists at all.
    // The segment — see the note in `./actions.ts`. This is the sharpest of the
    // three: the operator answers a submission, and the member's lesson page is
    // exactly where that answer and the freeze notice appear.
    revalidatePath(COURSE, "layout");

    // 🚨 The success sentence comes from `coursesAdmin`, NOT from `errors`. A
    // toast saying a thing worked is not a refusal.
    const tAdmin = await getTranslations("coursesAdmin");
    return { error: null, ok: tAdmin("submissionSaved") };
  } catch (error) {
    // `notFound()` and the redirect inside `requireOwner()` signal by THROWING.
    // Swallowing them would turn a legitimate refusal into "unknown error" and
    // log a fake fault for `node run.mjs errors`.
    unstable_rethrow(error);
    console.error("[courses] unexpected error while replying:", error);
    return { error: t("unknown"), ok: null };
  }
}
