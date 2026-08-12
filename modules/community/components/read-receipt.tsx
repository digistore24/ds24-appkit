// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// "I have read up to here" — sent once, after the posts have actually rendered.
//
// ── Why this is a client component at all ─────────────────────────────────
// The two cheap implementations are both dishonest, and the requirement rules
// out each by name:
//
//   Marking read on the SERVER render. The response may never paint — the tab
//   was closed, an error boundary caught something, the request was a
//   prefetch. Nobody saw anything, and a thread has gone quiet.
//
//   Marking the DISCUSSION's newest post. Page 1 of 3 would mark page 3 read.
//
// So: the server hands down the newest post it actually put in THIS page, the
// browser confirms it after mount, and the server clamps that id to a post
// that really is in this thread before writing anything (`acknowledgeRead()`).
//
// It is still an approximation of "seen" — scrolling is not tracked, and a
// member who opens a thread and immediately leaves has marked it read. v1
// accepts that: the promise is per-discussion granularity, not per-post read
// receipts, and tracking scroll would be a surveillance feature nobody asked
// for.
//
// ⚠️ **No polling and no interval.** One acknowledgment per render. A
// live-feeling clear (the dot going out without a navigation) belongs to the
// live-updates release; here the dot clears on the next page the member opens,
// which is honest and costs nothing.

import { useEffect, useRef } from "react";

import { acknowledgeReadAction } from "@/modules/community/pages/actions";
import { acknowledgeConversationAction } from "@/modules/community/pages/messages/actions";

export function ReadReceipt({
  discussionId,
  newestPostId,
}: {
  discussionId: string;
  /** The newest post the SERVER put in this page — never the thread's newest. */
  newestPostId: string | null;
}) {
  // React runs effects twice in development's strict mode, and a second
  // acknowledgment is a second round trip for no new information. The ref is
  // the guard; the write is idempotent anyway (advance-only), so this is about
  // noise rather than correctness.
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (!newestPostId) return;
    const key = `${discussionId}:${newestPostId}`;
    if (sent.current === key) return;
    sent.current = key;

    // Deliberately not awaited and deliberately silent: an acknowledgment that
    // failed is not something to put in front of a reader, and the next render
    // sends it again.
    void acknowledgeReadAction(discussionId, newestPostId);
  }, [discussionId, newestPostId]);

  return null;
}

/**
 * The same receipt for a private conversation.
 *
 * Everything above applies unchanged — the server clamps the id to a message
 * that really is in this conversation, the write is advance-only, and one
 * acknowledgment per render is the whole policy. It is a second component
 * rather than a prop because it calls a different action, and the DM actions
 * are deliberately a countable set (see `messages/actions.ts`).
 */
export function ConversationReadReceipt({
  conversationId,
  newestMessageId,
}: {
  conversationId: string;
  /** The newest message the SERVER put in this page — never the conversation's. */
  newestMessageId: string | null;
}) {
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (!newestMessageId) return;
    const key = `${conversationId}:${newestMessageId}`;
    if (sent.current === key) return;
    sent.current = key;

    void acknowledgeConversationAction(conversationId, newestMessageId);
  }, [conversationId, newestMessageId]);

  return null;
}
