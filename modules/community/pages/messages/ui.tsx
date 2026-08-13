// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// The inbox's client pieces: the button that opens a conversation, the
// composer that writes into one, and the list that draws it.
//
// ⚠️ **Nothing here decides anything.** Every gate this file appears to apply
// is cosmetics on top of a refusal the server makes again on every submit — a
// hidden button is not a permission, and the "write to them" button on a
// profile page is refused server-side for a member who may not be written to.
//
// ⚠️ **A message body is rendered by `post-body.tsx` and nothing else.** It is
// the one renderer of text one member wrote for another to read, and
// `lib/community/render-safety.test.ts` keeps it that way for this tree too.

import * as React from "react";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { Send, Shield, ShieldOff } from "lucide-react";

import { MAX_MESSAGE_LENGTH, contentState, displayNameFor } from "@/modules/community/lib/rules";
import { useActionToast } from "@/hooks/use-action-toast";
import { PostBody } from "@/modules/community/components/post-body";
import { ReportButton } from "@/modules/community/components/report-button";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import type { ActionState } from "../actions";
import {
  sendMessageAction,
  setBlockAction,
  startConversationAction,
} from "./actions";
import { EMPTY_ACTION_STATE } from "@/lib/action-state";

// The community's state is WIDER than the core's — `startDiscussion` hands
// back the new `postId` so the page can scroll to it. The value is still the
// shared one; only the type it is read at is the module's own.
const EMPTY: ActionState = EMPTY_ACTION_STATE;


/**
 * Submit without handing the form to React.
 *
 * The section's `useFormSubmit()`, and it matters here for the same reason:
 * React resets a `<form action={…}>` once the action returns, refusal
 * included — so a long message refused for being one character too long would
 * disappear from the box in front of the person who wrote it.
 */
function useFormSubmit(action: (formData: FormData) => void) {
  const [pending, start] = useTransition();
  return {
    pending,
    onSubmit(event: React.FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      start(() => action(formData));
    },
  };
}

/**
 * "Write to them" — on a member's profile page.
 *
 * The only door into a new conversation, deliberately: a member is reached
 * from their profile, which is a page somebody arrived at by meeting them in a
 * room. There is no address book, no member directory and no search by name —
 * the no-roster rule (`db/schema-community.ts`) applied to the inbox, because
 * a way to enumerate members is a way to message all of them.
 */
export function StartConversationButton({ memberId }: { memberId: string }) {
  const t = useTranslations("community");
  const [state, action] = useActionState(startConversationAction, EMPTY);
  const { onSubmit, pending } = useFormSubmit(action);

  // Only errors reach a toast: success navigates to the conversation, which is
  // feedback enough and arrives on the page they land on.
  useActionToast(state);

  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="memberId" value={memberId} />
      <Button type="submit" disabled={pending}>
        <Send aria-hidden />
        {t("messageWrite")}
      </Button>
    </form>
  );
}

/**
 * The composer, in the one place there is one.
 *
 * `PostComposer`'s contract, message-shaped: `onSending` shows what was
 * written the moment the button is pressed, `onSent` gives that placeholder
 * the real id — or takes it back when the server refuses, leaving the text in
 * the box.
 */
export function MessageComposer({
  conversationId,
  canParticipate,
  onSending,
  onSent,
}: {
  conversationId: string;
  canParticipate: boolean;
  onSending?: (content: string) => void;
  onSent?: (messageId: string | null) => void;
}) {
  const t = useTranslations("community");
  const [content, setContent] = useState("");
  const [state, action] = useActionState(sendMessageAction, EMPTY);
  const { onSubmit: dispatch, pending } = useFormSubmit(action);

  // Whether the state below belongs to a submit of ours. `useActionState`
  // hands back its initial value at mount, and reporting THAT as a result
  // would take back an optimistic message nobody had sent.
  const awaiting = useRef(false);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    awaiting.current = true;
    onSending?.(new FormData(event.currentTarget).get("content") as string);
    dispatch(event);
  };

  useActionToast(state);

  // Cleared only when the message actually landed — a refusal leaves it.
  useEffect(() => {
    if (state.ok) setContent("");
  }, [state]);

  useEffect(() => {
    if (!awaiting.current) return;
    if (!state.ok && !state.error) return;
    awaiting.current = false;
    onSent?.(state.ok ? (state.postId ?? null) : null);
  }, [state, onSent]);

  // The server refuses too, with its own sentence — this is the one that says
  // what to do about it before anybody writes a paragraph into a dead box.
  if (!canParticipate) {
    return (
      <p className="text-muted-foreground text-sm">{t("nameFirstBody")}</p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <Label htmlFor="message">{t("messageLabel")}</Label>
      <Textarea
        id="message"
        name="content"
        required
        rows={4}
        maxLength={MAX_MESSAGE_LENGTH}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder={t("messagePlaceholder")}
      />
      <div className="flex justify-end">
        {/* `disabled` while pending is the only thing between a double click
            and two identical messages — there is no idempotency key here. */}
        <Button type="submit" disabled={pending}>
          {t("messageSubmit")}
        </Button>
      </div>
    </form>
  );
}

/** One message, as it crosses from the server or arrives from the live channel. */
export interface MessageView {
  id: string;
  authorId: string | null;
  content: string;
  createdAt: string;
  deletedAt: string | null;
  deletedBy: "author" | "moderator" | "system" | null;
  authorProfileName: string | null;
  authorAccountName: string | null;
}

/**
 * One conversation's messages.
 *
 * ⚠️ **What a deleted message renders is decided by `contentState()` and
 * nothing else** — no renderer reads `deletedAt` or `deletedBy` itself, so the
 * three deletions cannot start reading differently per surface. The words of a
 * hidden message never reach this component: the readers blank them
 * server-side, so there is nothing here to leak into a title attribute or the
 * page's own payload.
 *
 * There is no author menu: a direct message cannot be edited or deleted by its
 * sender in v1. What was sent to somebody was sent — the argument, and the
 * account-deletion path that IS the way words leave, are Story 21.4's.
 */
export function MessageList({
  messages,
  memberId,
  attachmentMax = 5,
}: {
  messages: MessageView[];
  memberId: string;
  /** How many messages a report may carry as context — from the config. */
  attachmentMax?: number;
}) {
  const t = useTranslations("community");
  const format = useFormatter();
  const placeholderLabel = t("memberPlaceholder");

  if (messages.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {t("messageNoneYet")}
      </p>
    );
  }

  return (
    <ol className="grid gap-3">
      {messages.map((message) => {
        const state = contentState({
          deletedAt: message.deletedAt ? new Date(message.deletedAt) : null,
          deletedBy: message.deletedBy,
        });
        const mine = message.authorId === memberId;

        return (
          <li
            key={message.id}
            // Own messages sit right, the other person's left — the one piece
            // of layout that says who is talking without repeating a name on
            // every line.
            className={mine ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={
                "max-w-[85%] rounded-xl border p-3 " +
                (mine ? "bg-muted" : "bg-card")
              }
            >
              <div className="text-muted-foreground mb-1 flex flex-wrap items-center gap-x-2 text-xs">
                {/* Only the OTHER person's messages: reporting one's own is
                    refused in the core, and the dialog on a DM carries the
                    sentence saying anonymity cannot be delivered here. */}
                {state === "visible" && !mine && (
                  <ReportButton
                    messageId={message.id}
                    attachmentMax={attachmentMax}
                    // Everything else on screen, offered as context. The
                    // server drops any id that is not in this conversation.
                    siblings={messages
                      .filter((other) => other.id !== message.id)
                      .filter((other) => other.deletedAt === null)
                      .map((other) => ({
                        id: other.id,
                        preview: other.content.slice(0, 120),
                      }))}
                  />
                )}
                <span className="text-foreground font-medium">
                  {state === "accountDeleted" || !message.authorId
                    ? t("formerMember")
                    : displayNameFor({
                        profileName: message.authorProfileName,
                        accountName: message.authorAccountName,
                        memberId: message.authorId,
                        placeholderLabel,
                      })}
                </span>
                <time dateTime={message.createdAt}>
                  {format.dateTime(new Date(message.createdAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
              </div>

              {state === "visible" ? (
                <PostBody content={message.content} />
              ) : (
                <p className="text-muted-foreground text-sm italic">
                  {/* Three states, three sentences — the same distinction the
                      room side draws, for the same reason. */}
                  {t(
                    state === "moderatorRemoved"
                      ? "messageRemoved"
                      : state === "accountDeleted"
                        ? "messageAccountDeleted"
                        : "messageDeleted",
                  )}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Block or unblock the other person, from the conversation.
 *
 * ⚠️ **Blocking asks first and names whom** — the house rule for anything
 * destructive-adjacent (`<AlertDialog>`, the confirm button in the destructive
 * variant). Unblocking is a plain action with a toast: it takes something
 * away from nobody.
 *
 * ⚠️ **The label says "you have blocked them" and can never say the reverse.**
 * `hasBlocked()` answers one direction — the caller's own — and there is no
 * reader in the module for the other. A button that could say "they blocked
 * you" would be FR-201's disclosure arriving through the interface instead of
 * through an error message.
 */
export function BlockControl({
  memberId,
  name,
  blocked,
}: {
  memberId: string;
  /** The other person's display name — the confirmation has to name them. */
  name: string;
  /** Has the VIEWER blocked them? Never the other direction. */
  blocked: boolean;
}) {
  const t = useTranslations("community");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(setBlockAction, EMPTY);
  const [, startAction] = useTransition();

  useActionToast(state);

  const submit = (blocking: boolean) => {
    const formData = new FormData();
    formData.set("memberId", memberId);
    formData.set("blocking", String(blocking));
    startAction(() => action(formData));
  };

  if (blocked) {
    return (
      <Button variant="outline" size="sm" onClick={() => submit(false)}>
        <ShieldOff aria-hidden />
        {t("unblock")}
      </Button>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Shield aria-hidden />
          {t("block")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("blockTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {/* Names the person, and says what the block does and does not
                do — a member who expects it to hide posts in a room needs to
                learn that here rather than by being surprised. */}
            {t("blockConfirm", { name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => submit(true)}>
            {t("block")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
