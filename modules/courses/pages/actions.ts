"use server";
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What a learner can DO on a lesson page.
//
// 🚨 **Every action re-asks the gate.** A Server Action is an HTTP endpoint of
// its own: it is not protected by the fact that the page that renders its form
// was. The page's checks prove nothing about a request somebody replayed.
//
// 🚨 **No action takes a member id.** The account acted on is always the
// session's own — the same guarantee `spendTokens()` gives, and the reason an
// IDOR here is impossible rather than merely unlikely.
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { requireActiveUser } from "@/lib/authz";
import type { ActionState } from "@/hooks/use-action-toast";

import { courseAccessFor } from "../lib/access";
import { courseOffReason, courseShape } from "../lib/config";
import {
  blockById,
  setCompleted,
  submissionFor,
  unitBySlug,
  upsertSubmission,
} from "../lib/manage";
import { isUnlocked, submissionProblem } from "../rules";

/**
 * The guard every action opens with.
 *
 * Returns the viewer, or throws the framework's not-found. `notFound()` rather
 * than a returned error: a switched-off module answers exactly what a route
 * that never existed answers, and an action is a route.
 */
async function viewer() {
  if (!courseOffReason()) {
    const session = await requireActiveUser();
    const memberId = session.user.id as string;
    const access = await courseAccessFor(memberId, session.user.role as string);
    if (!access.entitled) notFound();
    return { memberId, access };
  }
  notFound();
}

export async function setCompletedAction(
  unitSlug: string,
  done: boolean,
): Promise<ActionState> {
  const { memberId, access } = await viewer();
  // 🚨 The rule layer returns CODES; the action is where they become a
  // sentence, in one language chosen per request. A sentence born in `lib/` is
  // a sentence in exactly one language for ever (`CLAUDE.md` → Languages).
  const t = await getTranslations("errors");

  const unit = await unitBySlug(unitSlug);
  if (!unit) return { error: t("coursesNotFound"), ok: null };

  // 🚨 The unlock rule is re-applied HERE. Without it a learner could mark
  // week ten done on day one by replaying this action — which is not damage,
  // but it is the same hole the page's redirect exists to close, and a rule
  // enforced in only one of two places is enforced nowhere.
  const block = await blockById(unit.blockId);
  if (!block) return { error: t("coursesNotFound"), ok: null };
  if (!isUnlocked(block.releaseAfterDays, access.startedAt, courseShape(), new Date())) {
    return { error: t("coursesLocked"), ok: null };
  }

  await setCompleted(memberId, unitSlug, done);
  revalidatePath("/dashboard/course");
  revalidatePath(`/dashboard/course/${unitSlug}`);
  return { error: null, ok: t(done ? "coursesMarkedDone" : "coursesMarkedOpen") };
}

/**
 * Hand in the work a lesson asked for — shape 3's whole promise, from the
 * member's side.
 *
 * 🚨 **It takes no member id, and none is reachable from here.** The account is
 * `viewer()`'s, which is the session's own — the guarantee `spendTokens()` gives
 * and the reason an IDOR on somebody else's unpublished writing is impossible
 * rather than merely unlikely. `../pages/guard.test.ts` reads this file and
 * fails on a `formData.get("memberId")` appearing anywhere in it.
 *
 * The order repeats `setCompletedAction`'s deliberately, line for line, and then
 * adds the hand-in's own question:
 *
 *   1. `viewer()` — the off state, the session, the purchase gate. Before any
 *      data function, so a switched-off module answers exactly what a route that
 *      never existed answers.
 *   2. the slug, then its block — an unknown one is `coursesNotFound`.
 *   3. the unlock rule, AGAIN. The page redirects a locked lesson; this action
 *      is a separate HTTP endpoint and the page's redirect says nothing about a
 *      request somebody replayed.
 *   4. `submissionProblem()` — shape, prompt, frozen, empty, too long, in that
 *      order and argued in `../rules.ts`.
 */
export async function submitTaskAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { memberId, access } = await viewer();
  const t = await getTranslations("errors");

  const slug = String(formData.get("unitSlug") ?? "");
  const body = String(formData.get("body") ?? "");

  const unit = await unitBySlug(slug);
  if (!unit) return { error: t("coursesNotFound"), ok: null };

  const block = await blockById(unit.blockId);
  if (!block) return { error: t("coursesNotFound"), ok: null };
  if (!isUnlocked(block.releaseAfterDays, access.startedAt, courseShape(), new Date())) {
    return { error: t("coursesLocked"), ok: null };
  }

  // Scoped by `memberId` in the QUERY, never in a condition above it — this is
  // where an IDOR would live, and "no such row" and "somebody else's row" are
  // deliberately the same answer (`../lib/manage.ts`).
  const existing = await submissionFor(memberId, unit.slug);
  const problem = submissionProblem({
    shape: courseShape(),
    taskPrompt: unit.taskPrompt,
    alreadyReplied: existing?.repliedAt != null,
    body,
  });
  if (problem) return { error: t(problem), ok: null };

  // Trimmed ONCE, and this is the same string the rule judged — a check on one
  // text beside a store of another is two texts wearing one decision.
  const written = await upsertSubmission(memberId, unit.slug, body.trim());
  // The statement carries `replied_at is null` too, so `false` means somebody
  // replied between the check above and this line. Same answer, honestly
  // reached: nothing was written.
  if (!written) return { error: t("coursesAlreadyReplied"), ok: null };

  revalidatePath(`/dashboard/course/${unit.slug}`);
  // 🚨 The success sentence comes from `courses`, NOT from `errors`. A toast
  // saying a thing worked is not a refusal, and `errors` is the shared namespace
  // the rule codes live in — `coursesMarkedDone` above is in the wrong one and
  // is not a precedent to follow.
  const tCourses = await getTranslations("courses");
  return { error: null, ok: tCourses("submissionSaved") };
}
