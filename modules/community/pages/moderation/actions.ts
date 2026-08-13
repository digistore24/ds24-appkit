// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use server";

// The moderator's three acts: remove a post, lock a thread, open it again.
//
// SECURITY — the shape every one of them repeats, and none may skip:
//
//   1. `notFound()` when the community is not running here. A Server Action is
//      an HTTP endpoint of its own, so the page's guard protects nothing.
//   2. `requireActiveUser()` — the session.
//   3. 🚨 **The authority re-read** (`moderationAuthority()` inside
//      `manage.ts`), against the database, on every act. NEVER the session's
//      role: a JWT carries what somebody was when they signed in, and an
//      operator who takes the moderator role away at eleven expects it gone at
//      eleven. AD-63, and `lib/community/moderation-guard.test.ts` drives the
//      stale-token case to prove it.
//
// ⚠️ **The actor is always the session's own id.** Only the target comes from
// the form. There is nowhere to put somebody else's id, which is the same
// guarantee every other write path in this module gives.
//
// LANGUAGE: here, and only here, the codes become sentences (AD-10).
import { revalidatePath } from "next/cache";
import { notFound, unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { requireActiveUser } from "@/lib/authz";
import { isCommunityEnabled } from "@/modules/community/lib/config";
import {
  removePostAsModerator,
  setDiscussionLocked,
} from "@/modules/community/lib/manage";
import {
  CommunityError,
  MAX_MODERATION_REASON_LENGTH,
} from "@/modules/community/lib/rules";

import type { ActionState } from "../actions";

async function actor(): Promise<string> {
  if (!isCommunityEnabled()) notFound();
  const session = await requireActiveUser();
  return session.user.id;
}

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
 * Remove a post, with a reason.
 *
 * ⚠️ **The reason is required and it is not for the moderator's own notes.**
 * It goes into the trail AND into the affected member's subject access request
 * — it is free text written about a person, which is the `grants.note`
 * category. The confirmation dialog says so before the button is pressed.
 */
export async function removePostAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actorId = await actor();
    await removePostAsModerator({
      actorId,
      postId: String(formData.get("postId") ?? ""),
      reason: formData.get("reason"),
    });
    revalidatePath("/dashboard/community", "layout");
    const t = await getTranslations("community");
    return { error: null, ok: t("postRemoved") };
  } catch (error) {
    return toState(error);
  }
}

/**
 * Lock a thread, or open it again.
 *
 * One action for both directions, and each writes its OWN audit row — an
 * unlock is never an edit of the lock's record. "This was closed on Tuesday
 * and opened on Thursday" is two facts.
 */
export async function setLockedAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actorId = await actor();
    const locked = formData.get("locked") === "true";
    await setDiscussionLocked({
      actorId,
      discussionId: String(formData.get("discussionId") ?? ""),
      locked,
    });
    revalidatePath("/dashboard/community", "layout");
    const t = await getTranslations("community");
    return {
      error: null,
      ok: t(locked ? "communityDiscussionLocked" : "discussionUnlocked"),
    };
  } catch (error) {
    return toState(error);
  }
}
