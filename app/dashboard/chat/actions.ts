// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use server";

import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { requireActiveUser } from "@/lib/authz";
import { clearConversation, listConversation } from "@/lib/ai/conversation";
import type { ChatMessage } from "./ui";

const PAGE = "/dashboard/chat";

import type { ActionState } from "@/lib/action-state";

/** Re-exported so the components beside this file keep importing it from here. */
export type { ActionState };

async function toState(error: unknown): Promise<ActionState> {
  unstable_rethrow(error);
  const t = await getTranslations("errors");
  console.error("[chat] unexpected error:", error);
  return { error: t("unknown"), ok: null };
}

/**
 * This member's transcript, for the launcher on the other pages.
 *
 * It exists because the launcher sits in the dashboard LAYOUT — every protected
 * page renders it — and loading a conversation there would put a database query
 * in front of every page in the app for a panel most visits never open. So the
 * history is fetched when somebody opens it, once, and not before.
 *
 * The member id comes from the session, exactly as in `clearChatAction` below:
 * a server action is an HTTP endpoint of its own, and an id taken from its
 * argument would hand anybody else's conversation to whoever asked for it.
 */
export async function loadChatAction(): Promise<ChatMessage[]> {
  const session = await requireActiveUser();
  const history = await listConversation(session.user.id);
  return history.map((turn) => ({
    id: turn.id,
    role: turn.role,
    content: turn.content,
    // The launcher's transcript hydrates identically to the page's — a link
    // must not depend on which of the two the customer opened.
    links: turn.links ?? undefined,
  }));
}

/**
 * Deletes this member's transcript.
 *
 * `requireActiveUser()` is the FIRST line, and the member id comes from the
 * session it returns — never from the form. A server action is an HTTP endpoint
 * of its own: an id read out of `FormData` here would be a one-request way to
 * wipe somebody else's conversation.
 */
export async function clearChatAction(
  _prev: ActionState,
): Promise<ActionState> {
  try {
    const session = await requireActiveUser();
    await clearConversation(session.user.id);
    revalidatePath(PAGE);

    const t = await getTranslations("chat");
    return { error: null, ok: t("cleared") };
  } catch (error) {
    return toState(error);
  }
}
