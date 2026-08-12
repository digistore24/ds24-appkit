// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Storing what was said.
//
// One conversation per member — deliberately, and it is the decision most worth
// knowing about this file. Threads would need a list, a switcher, a "new
// conversation" button and a rule for which one a question lands in, and a
// support assistant does not earn that: people ask a question, get an answer,
// and come back next week with an unrelated one. The window sent to the model
// (lib/ai/rules.ts → trimHistory) means an old topic falls out of context by
// itself rather than confusing the next question.
//
// If threads are ever wanted, this is where they start: a `conversationId` on
// the table and a parameter here. Nothing above this file reads the rows
// directly.
//
// ── That is what happened, and the paragraph above still stands ────────────
// A COMPANION does earn threads, for the reason the assistant does not: day
// three answering day seven's question is not an old topic falling out of
// context, it is the product being wrong. So the column and the parameter now
// exist — and `null` is the assistant's one conversation, unchanged in every
// respect. Every existing caller passes nothing and gets exactly what it got
// before.
//
// ⚠️ `eq(column, null)` is NOT `IS NULL`. Drizzle emits `= null`, which matches
// no row — the support transcript would come back empty and the delete would
// delete nothing, with a green typecheck and no error anywhere. Every
// conversation-scoped clause in this file goes through `sameConversation()`
// below, which is the one place that distinction is made.
import { and, desc, eq, isNull, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { chatMessages } from "@/db/schema";
import type { ChatRole, ChatTurn } from "./rules";

/**
 * How many messages the page loads.
 *
 * Bigger than the window sent to the model on purpose: the person can scroll
 * back through more than the model is told about, which is the honest shape —
 * the transcript is theirs, the context window is a cost decision.
 */
export const CONVERSATION_PAGE_SIZE = 100;

export interface StoredTurn extends ChatTurn {
  id: string;
  createdAt: Date;
  /**
   * The `[link:…]` markers this turn's text may render — see the column's own
   * note in `db/schema-chat.ts`. `null` for every row written before the
   * column existed, and for every user message; the renderer treats that as
   * "no links", which is the fail-safe direction.
   */
  links: string[] | null;
}

/**
 * One member, one conversation — the whole `WHERE` clause, in one place.
 *
 * Exported so `conversation.test.ts` can assert the SQL it produces without a
 * database. The `null` branch is the reason this is a function at all.
 */
export function conversationWhere(memberId: string, conversationId: string | null): SQL {
  return and(
    eq(chatMessages.memberId, memberId),
    conversationId === null
      ? isNull(chatMessages.conversationId)
      : eq(chatMessages.conversationId, conversationId),
  ) as SQL;
}

/** This member's conversation, oldest first — the order it is read in. */
export async function listConversation(
  memberId: string,
  conversationId: string | null = null,
  take: number = CONVERSATION_PAGE_SIZE,
): Promise<StoredTurn[]> {
  const rows = await db
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      content: chatMessages.content,
      links: chatMessages.links,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(conversationWhere(memberId, conversationId))
    // Newest first in the query so the LIMIT keeps the RECENT ones, then
    // reversed for display. Ordering ascending and limiting would hand back the
    // oldest hundred messages and drop everything the person just said.
    .orderBy(desc(chatMessages.createdAt))
    .limit(take);

  return rows.reverse();
}

/** Appends one message. Returns its id, so the client can key on it. */
export async function appendTurn(args: {
  memberId: string;
  role: ChatRole;
  content: string;
  /** Omitted or `null` = the assistant's one conversation. */
  conversationId?: string | null;
  /**
   * The link markers this text may render. Only what the answer actually USED
   * — not everything the model was offered. Omitted for a question, and for
   * any answer that pointed at nothing.
   */
  links?: readonly string[];
}): Promise<string> {
  const [row] = await db
    .insert(chatMessages)
    .values({
      memberId: args.memberId,
      conversationId: args.conversationId ?? null,
      role: args.role,
      content: args.content,
      // `null` rather than `[]` for "none": it is the same value every row
      // that predates the column carries, so there is one representation of
      // "this turn renders no links" instead of two.
      links: args.links && args.links.length > 0 ? [...args.links] : null,
    })
    .returning({ id: chatMessages.id });

  return row.id;
}

/**
 * Deletes ONE of this member's conversations.
 *
 * Scoped to the member id the caller resolved from the session — never one out
 * of a form. The same rule `spendTokens` follows, for the same reason: a route
 * handler is an HTTP endpoint of its own, and an id taken from a request body
 * would let anybody wipe anybody's transcript.
 *
 * ⚠️ **And scoped to ONE conversation, which is newer and just as load-bearing.**
 * The default `null` means the assistant's conversation and nothing else. Left
 * unscoped, the "Delete history" button on the chat page would also delete every
 * companion turn the customer has — silent data loss in a feature they were not
 * using, with nothing anywhere going red. `conversation.test.ts` asserts the
 * `IS NULL` is in the generated SQL.
 */
export async function clearConversation(
  memberId: string,
  conversationId: string | null = null,
): Promise<number> {
  const deleted = await db
    .delete(chatMessages)
    .where(conversationWhere(memberId, conversationId))
    .returning({ id: chatMessages.id });

  return deleted.length;
}
