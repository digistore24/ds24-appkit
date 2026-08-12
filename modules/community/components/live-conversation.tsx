// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// **A private conversation that breathes.**
//
// ── Why this is not `LiveDiscussion` with a third scope ───────────────────
// The doctrine next door is "one implementation, both homes", and it is right
// there: the section's thread page and an embed render the same posts, with
// the same author menu, through the same write path. A conversation shares the
// TRANSPORT and shares nothing else — no edit, no delete, no lock, no author
// menu, a different composer and a different action file (which is what lets
// Story 21.3 carve impersonated sessions out of the DM surfaces by counting
// them). Threading all of that through as options would have made one
// component two components wearing one name.
//
// What is genuinely shared IS shared, and that is the part that matters:
//
//   - the ONE endpoint (`/api/community/live`) and the ONE opaque cursor —
//     AD-70's clause is about the grammar, not about the React tree;
//   - `pollDelayMs()` from the pure core, so the interval, the hidden-tab
//     backoff and SM-16's measurement cover this surface too;
//   - upsert-by-id on arriving rows, because a deletion since the cursor
//     rides the answer as row-state rather than by omission;
//   - the optimistic send with its placeholder id, and a refusal that keeps
//     what the member wrote (NFR-37).
//
// If a fourth surface ever needs the same loop, the answer is to lift THIS
// hook out — not to grow a component with three modes.
import * as React from "react";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import { Callout } from "@/components/ui/callout";
import { mergeRows, type PollSchedule } from "@/modules/community/lib/rules";

import { useLiveScope } from "./use-live-scope";
import {
  MessageComposer,
  MessageList,
  type MessageView,
} from "@/modules/community/pages/messages/ui";

/**
 * A message on the wire.
 *
 * The endpoint answers with one shape for every scope (`posts`), which is
 * AD-70's one-grammar clause reaching all the way to the browser. A message
 * carries an `editedAt` that is always `null` — a direct message cannot be
 * edited — and this component simply does not read it.
 */
type WireMessage = MessageView & { editedAt: string | null };

/** The id an optimistic message carries until the server names the real one. */
const PENDING_ID = "__pending__";

export interface LiveConversationProps {
  conversationId: string;
  memberId: string;
  /** The viewer's own name fields, so an optimistic message is named like a real one. */
  viewerProfileName: string | null;
  viewerAccountName: string | null;
  initialMessages: MessageView[];
  initialCursor: string | null;
  canParticipate: boolean;
  schedule: PollSchedule;
  /** False on any page but the last — a new message belongs at the end. */
  live: boolean;
}

export function LiveConversation({
  conversationId,
  memberId,
  viewerProfileName,
  viewerAccountName,
  initialMessages,
  initialCursor,
  canParticipate,
  schedule,
  live,
}: LiveConversationProps) {
  const t = useTranslations("community");
  const [messages, setMessages] = useState<MessageView[]>(initialMessages);

  // The polling loop is `useLiveScope` — shared with the discussion surface and
  // the feed, because this file used to carry its own copy of it and the copy
  // kept four defects a review had already fixed next door.
  const { stopped, poll } = useLiveScope<MessageView>({
    scope: { kind: "conversation", conversationId },
    initialCursor,
    schedule,
    live,
    onAnswer: (answer) => {
      if (answer.posts.length > 0) {
        setMessages((current) => mergeRows(current, answer.posts));
      }
    },
  });

  /** The member pressed send. Show it now; the server has not answered yet. */
  const onSending = useCallback(
    (content: string) => {
      if (!live) return;
      setMessages((current) =>
        mergeRows(current, [
          {
            id: PENDING_ID,
            authorId: memberId,
            content,
            createdAt: new Date().toISOString(),
            deletedAt: null,
            deletedBy: null,
            authorProfileName: viewerProfileName,
            authorAccountName: viewerAccountName,
          },
        ]),
      );
    },
    [live, memberId, viewerProfileName, viewerAccountName],
  );

  /** The server answered. Give the message its real id, or take it back. */
  const onSent = useCallback(
    (messageId: string | null) => {
      if (!live) return;
      setMessages((current) => {
        const without = current.filter((message) => message.id !== PENDING_ID);
        if (!messageId) return without;
        const pending = current.find((message) => message.id === PENDING_ID);
        if (!pending) return without;
        // The real id, so the poll that delivers this same message a moment
        // later upserts it instead of showing it twice.
        return mergeRows(without, [{ ...pending, id: messageId }]);
      });
      void poll();
    },
    [live, poll],
  );

  return (
    <>
      <MessageList messages={messages} memberId={memberId} />

      {stopped && (
        <Callout variant="info" title={t("liveStoppedTitle")} className="mt-6">
          <p>{t("liveStoppedBody")}</p>
        </Callout>
      )}

      <div className="mt-6">
        {/* ⚠️ **`stopped` deliberately changes NOTHING about the composer.**
            Unmounting it would destroy whatever the member was in the middle
            of writing — the anti-pattern FR-197 names — and the callout above
            is the one statement they get. If they press send, the server
            refuses with its own sentence, which is an answer to an action
            rather than an error repeating itself. */}
        <MessageComposer
          conversationId={conversationId}
          canParticipate={canParticipate}
          onSending={onSending}
          onSent={onSent}
        />
      </div>
    </>
  );
}
