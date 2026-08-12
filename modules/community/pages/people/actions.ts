// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use server";

// Following and unfollowing — the two writes behind the button on a member's
// profile and the list on "my people".
//
// SECURITY — the shape both actions repeat:
//
//   1. `notFound()` when the community is not running here. A Server Action is
//      an HTTP endpoint of its own, so the page's guard protects nothing.
//   2. `requireActiveUser()` — the session, and a blocked account is refused
//      by it.
//   3. The core refusals, in `lib/community/rules.ts` and re-derived on every
//      call: no display name, a standing block between the pair, the target
//      account gone or closed, oneself.
//
// ⚠️ **The FOLLOWER is always the session's own id.** Only the target comes
// from the form — it names whom to follow, not who is acting — so a crafted
// request can only ever make somebody follow on their own behalf. That is the
// same shape `setBlockAction()` has, for the same reason.
//
// ⚠️ **These do NOT go through `requireDmActor()`.** Following is not a private
// message: an operator in a support session sees the rooms as the member and
// this belongs with them (FR-209 carves out the private channel, and only
// that). If a later story decides otherwise, it decides it here rather than by
// widening the DM seam.
//
// LANGUAGE: here, and only here, the codes become sentences (AD-10).
import { revalidatePath } from "next/cache";
import { notFound, unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { requireActiveUser } from "@/lib/authz";
import { isCommunityEnabled } from "@/modules/community/lib/config";
import { followMember, unfollowMember } from "@/modules/community/lib/manage";
import { CommunityError } from "@/modules/community/lib/rules";

import type { ActionState } from "../actions";

async function viewer(): Promise<{ memberId: string }> {
  if (!isCommunityEnabled()) notFound();
  const session = await requireActiveUser();
  return { memberId: session.user.id as string };
}

async function toState(error: unknown): Promise<ActionState> {
  unstable_rethrow(error);
  const t = await getTranslations("errors");
  if (error instanceof CommunityError) {
    return { error: t(error.code, { ...error.detail }), ok: null };
  }
  console.error("[community] unexpected error:", error);
  return { error: t("unknown"), ok: null };
}

/**
 * Follow, or stop following.
 *
 * One action for both directions: the pair is one decision with a state, and a
 * surface that could follow without being able to unfollow is a surface
 * somebody would ship.
 *
 * ⚠️ **A refusal says `communityNotDeliverable` and nothing about the person.** A
 * standing block, a closed account, an account that is gone and oneself are
 * one code and one sentence — 21.2's, reused rather than re-worded, because
 * the indistinguishability is a property of the SENTENCE and not only of the
 * code. A follow that refused differently would be a second door onto the same
 * question.
 */
export async function setFollowAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const me = await viewer();
    const memberId = String(formData.get("memberId") ?? "");
    const following = formData.get("following") === "true";

    if (following) {
      await followMember(me.memberId, memberId);
    } else {
      await unfollowMember(me.memberId, memberId);
    }

    // Both surfaces render the state, so both have to be re-rendered — the
    // button says the wrong thing otherwise.
    revalidatePath("/dashboard/community", "layout");
    const t = await getTranslations("community");
    return { error: null, ok: t(following ? "followed" : "unfollowed") };
  } catch (error) {
    return toState(error);
  }
}
