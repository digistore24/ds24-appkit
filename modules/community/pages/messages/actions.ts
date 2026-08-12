// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use server";

// The private half of the community: opening a conversation, writing into it,
// and saying "I have read up to here".
//
// ⚠️ **Its own file, and the DM write paths live nowhere else.** The section's
// `actions.ts` next door owns the rooms; this owns the inbox. Keeping them
// apart is not tidiness — the impersonation carve-out (FR-209) is only
// enforceable if the DM surfaces are countable, and
// `lib/community/impersonation-guard.test.ts` counts them. Anything that adds
// one adds it to that enumeration.
//
// SECURITY — the shape every action repeats, through ONE seam:
//
//   1. `requireDmActor()` — enablement (a Server Action is an HTTP endpoint of
//      its own, so the page's guard protects nothing), the session, a blocked
//      account, and the impersonation carve-out. All four in one call.
//   2. Participant-ship, re-derived inside `lib/community/manage.ts` against
//      the row on every call. Never carried over from the render.
//
// **No action here takes a member id for the SENDER.** The author is always
// the session's own, the guarantee `spendTokens()` gives by having no
// parameter for it. `startConversationAction` takes the id of the person being
// written TO, which is a different thing and is checked for deliverability
// before anything is written.
//
// LANGUAGE: here, and only here, the codes become sentences (AD-10).
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { requireDmActor } from "@/modules/community/lib/dm-actor";
import {
  acknowledgeRead,
  blockMember,
  openConversation,
  sendMessage,
  unblockMember,
} from "@/modules/community/lib/manage";
import { CommunityError, MAX_MESSAGE_LENGTH } from "@/modules/community/lib/rules";

import type { ActionState } from "../actions";

/**
 * The one seam every direct-message write passes through.
 *
 * It is `requireDmActor()` and nothing else — enablement, the session, and the
 * impersonation carve-out (FR-209) in one call that signals by throwing. The
 * three checks are not repeated per action deliberately: a fourth action added
 * next year gets all three by writing one line, and
 * `lib/community/impersonation-guard.test.ts` fails the build if it writes a
 * different one.
 */
async function dmViewer(): Promise<{ memberId: string; role: string }> {
  return requireDmActor();
}

async function toState(error: unknown): Promise<ActionState> {
  // redirect() and notFound() signal by THROWING — swallowing them would turn
  // a legitimate refusal into "unknown error" and log a fault that never
  // happened.
  unstable_rethrow(error);
  const t = await getTranslations("errors");

  if (error instanceof CommunityError) {
    return {
      error: t(error.code, { max: MAX_MESSAGE_LENGTH, ...error.detail }),
      ok: null,
    };
  }

  console.error("[community] unexpected error:", error);
  return { error: t("unknown"), ok: null };
}

/**
 * Open the conversation with one other member, and go to it.
 *
 * Idempotent by construction: `openConversation()` is an insert-on-conflict
 * against the canonical pair, so pressing the button twice — or both members
 * pressing it at the same moment — lands in the same conversation.
 *
 * ⚠️ **A refusal here is `communityNotDeliverable` and says nothing about the person.**
 * No such account, a blocked account, oneself — and from Story 21.2 a member
 * who blocked this sender — are one code and one sentence. That is FR-201's
 * requirement, and it is only true if it is true from the first day the
 * surface exists.
 */
export async function startConversationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let target: string;
  try {
    const me = await dmViewer();
    const { conversationId } = await openConversation(
      me.memberId,
      String(formData.get("memberId") ?? ""),
    );
    target = `/dashboard/community/messages/${encodeURIComponent(conversationId)}`;
  } catch (error) {
    return toState(error);
  }

  // Outside the try: `redirect()` signals by throwing. No success message is
  // sent and none is needed — the conversation they land on IS the feedback.
  redirect(target);
}

export async function sendMessageAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const me = await dmViewer();
    const conversationId = String(formData.get("conversationId") ?? "");
    const { messageId } = await sendMessage(me.memberId, conversationId, {
      content: formData.get("content"),
    });
    revalidatePath(`/dashboard/community/messages/${conversationId}`);
    const t = await getTranslations("community");
    // `postId` is the field name the composer contract already uses for "the
    // row the server just wrote" — the optimistic send reads it to give its
    // placeholder the real id, so the next poll upserts instead of drawing the
    // message twice. One name, because it is one contract.
    return { error: null, ok: t("messageSent"), postId: messageId };
  } catch (error) {
    return toState(error);
  }
}

/**
 * Block a member, or lift a block.
 *
 * ⚠️ **The actor is the session; only the TARGET comes from the form.** That
 * is the `spendTokens()` guarantee applied to a relation: `blockerId` is the
 * signed-in member's own id and there is nowhere to put somebody else's, so a
 * crafted request can only ever block somebody on the sender's own behalf.
 *
 * ⚠️ **They are self-service and ask for nothing.** No justification field, no
 * cooldown, no operator approval, no cap — FR-201 taken literally, because an
 * inbox is the member's. What the surface asks for is a confirmation naming
 * the person, which is the house rule for anything destructive-adjacent, not a
 * form the app fills a table from.
 *
 * One action for both directions rather than two: the pair is one decision
 * with a state, and a page that could call "block" without being able to call
 * "unblock" is a page somebody would ship.
 */
export async function setBlockAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const me = await dmViewer();
    const memberId = String(formData.get("memberId") ?? "");
    const blocking = formData.get("blocking") === "true";

    if (blocking) {
      await blockMember(me.memberId, memberId);
    } else {
      await unblockMember(me.memberId, memberId);
    }

    // The conversation page renders the block state, so it has to be
    // re-rendered — the button says the wrong thing otherwise.
    revalidatePath("/dashboard/community/messages", "layout");
    const t = await getTranslations("community");
    return { error: null, ok: t(blocking ? "blocked" : "unblocked") };
  } catch (error) {
    return toState(error);
  }
}

/**
 * "I have read up to here", for a conversation.
 *
 * The room-side twin's rules, unchanged: deliberately silent, returns nothing,
 * swallows what goes wrong. A read marker that failed to save is a dot that
 * stays on for one more navigation, and putting that in front of somebody
 * would be noise about their own reading.
 *
 * Everything that decides anything is in `acknowledgeRead()` — the
 * participant-ship re-check, the clamp of the id to a message that really is
 * in this conversation, and the advance-only conflict clause.
 */
export async function acknowledgeConversationAction(
  conversationId: string,
  messageId: string,
): Promise<void> {
  try {
    const me = await dmViewer();
    await acknowledgeRead({ conversationId, messageId, viewer: me });
  } catch (error) {
    unstable_rethrow(error);
    console.error("[community] could not record a read marker:", error);
  }
}
