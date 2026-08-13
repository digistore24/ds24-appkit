// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use server";

// Reporting spam, and marking a report handled.
//
// ── Two doors, and they are guarded differently on purpose ────────────────
// Reporting a POST is an ordinary community write: enablement, an active
// session, and the eligibility the core decides.
//
// 🚨 Reporting a MESSAGE goes through `requireDmActor()` — the direct-message
// seam — because FR-209 names read, send AND report, and this is the report
// half arriving. An impersonated session finds no DM surface at all, and that
// includes this one: an operator inside a member's account must not be able to
// report out of a correspondence they cannot even see.
// `lib/community/impersonation-guard.test.ts` counts this file among the DM
// surfaces, so a future refactor that routed the message leg around the seam
// fails the build.
//
// LANGUAGE: here, and only here, the codes become sentences (AD-10).
import { revalidatePath } from "next/cache";
import { notFound, unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { requireActiveUser } from "@/lib/authz";
import { isCommunityEnabled } from "@/modules/community/lib/config";
import { requireDmActor } from "@/modules/community/lib/dm-actor";
import {
  consumeReport,
  liftSendBlock,
  reportContent,
} from "@/modules/community/lib/manage";
import {
  CommunityError,
  MAX_MODERATION_REASON_LENGTH,
} from "@/modules/community/lib/rules";

import type { ActionState } from "../actions";

async function toState(error: unknown): Promise<ActionState> {
  unstable_rethrow(error);
  const t = await getTranslations("errors");
  if (error instanceof CommunityError) {
    return {
      error: t(error.code, {
        max: MAX_MODERATION_REASON_LENGTH,
        ...error.detail,
      }),
      ok: null,
    };
  }
  console.error("[community] unexpected error:", error);
  return { error: t("unknown"), ok: null };
}

/**
 * Report a post, or a private message.
 *
 * ⚠️ **A second report of the same content is absorbed, not refused**, and the
 * member sees the same calm confirmation either way. Tapping twice is not
 * doing something wrong, and an error would tell them their first tap failed.
 */
export async function reportAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const postId = String(formData.get("postId") ?? "");
    const messageId = String(formData.get("messageId") ?? "");

    // The DM leg through the DM seam, the post leg through the ordinary one.
    let reporterId: string;
    if (messageId !== "") {
      reporterId = (await requireDmActor()).memberId;
    } else {
      if (!isCommunityEnabled()) notFound();
      const session = await requireActiveUser();
      reporterId = session.user.id;
    }

    // The context the reporter chose, as a repeated field. Every id is
    // re-checked against the reported message's conversation in `manage.ts`
    // and dropped if it is not there — the form is a convenience, never a
    // permission. A post report attaches nothing and the UI never offers it.
    const attached = formData
      .getAll("attached")
      .filter((value): value is string => typeof value === "string");

    await reportContent({
      reporterId,
      ...(postId !== "" ? { postId } : {}),
      ...(messageId !== "" ? { messageId } : {}),
      reason: formData.get("reason"),
      ...(messageId !== "" && attached.length > 0
        ? { attachedMessageIds: attached }
        : {}),
    });

    const t = await getTranslations("community");
    return { error: null, ok: t("reported") };
  } catch (error) {
    return toState(error);
  }
}

/**
 * Lift a standing automatic block.
 *
 * 🚨 **One tap, and it consumes every counted report** — because the block IS
 * those reports (AD-64). There is no block state to clear, which is also why
 * re-blocking afterwards needs FRESH reports: the judged set cannot re-trigger
 * what it has already been judged for.
 *
 * Refused for a moderator whose own report is among the counted ones. The
 * operator is never conflicted out — somebody must always be able to act.
 */
export async function liftBlockAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    if (!isCommunityEnabled()) notFound();
    const session = await requireActiveUser();
    await liftSendBlock({
      actorId: session.user.id,
      memberId: String(formData.get("memberId") ?? ""),
    });
    revalidatePath("/dashboard/community/reports");
    const t = await getTranslations("community");
    return { error: null, ok: t("blockLifted") };
  } catch (error) {
    return toState(error);
  }
}

/**
 * Mark a report handled.
 *
 * ⚠️ **This is also how the automatic send-block lifts** (AD-64): the block is
 * derived from UNCONSUMED reports, so a moderator deciding a report was noise
 * takes it out of the derivation by consuming it. There is no separate block
 * state to clear, and nothing to keep in step.
 */
export async function consumeReportAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    if (!isCommunityEnabled()) notFound();
    const session = await requireActiveUser();
    await consumeReport({
      actorId: session.user.id,
      reportId: String(formData.get("reportId") ?? ""),
    });
    revalidatePath("/dashboard/community/reports");
    const t = await getTranslations("community");
    return { error: null, ok: t("reportConsumed") };
  } catch (error) {
    return toState(error);
  }
}
