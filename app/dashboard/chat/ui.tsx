// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// The chat window.
//
// ── Reading the stream ─────────────────────────────────────────────────────
// `/api/chat` answers with newline-delimited JSON: one object per line, the
// answer arriving as `delta` pieces. The loop below is the reason the reply
// appears word by word instead of after a ten-second spinner — and the buffer
// around it is the part that is easy to get wrong: a chunk from the network
// does NOT respect line boundaries, so the tail of a chunk is routinely half a
// JSON object. It is kept until the rest of it arrives.
//
// ── Errors ────────────────────────────────────────────────────────────────
// The endpoint answers with a CODE, never a sentence — the rules layer has no
// language (AD-10). Translation happens here, through the `errors` namespace,
// which is also why the same code reads correctly whether it arrived as an
// HTTP status or mid-stream.
import { useActionState, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Send, Trash2 } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent } from "@/components/ui/card";
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
import { useActionToast } from "@/hooks/use-action-toast";
import { MAX_MESSAGE_CHARS } from "@/lib/ai/rules";
import { clearChatAction } from "./actions";
import { AiDisclosure } from "@/components/ai-disclosure";
import { AnswerText } from "@/components/answer-text";

const EMPTY = { error: null, ok: null };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /**
   * The complete `[link:…]` markers THIS message may render.
   *
   * Per message, not per window, and that is the design rather than an
   * oversight: the set is composed while one particular answer is written, so
   * it belongs to that answer. Keeping it here is also what makes the live
   * path and the reload path the same code — streaming appends to it, the
   * server hands it back with a stored turn, and `AnswerText` cannot tell the
   * difference. Absent denies.
   */
  links?: readonly string[];
}

/** The id the answer being streamed right now carries until it is stored. */
const STREAMING_ID = "streaming";

/**
 * Where this window is being shown.
 *
 * `page` is `/dashboard/chat` — its own card on its own page. `panel` is the
 * floating launcher (`launcher.tsx`), which brings its own frame and has far
 * less room, so the card would be a second border around the first and the
 * transcript has to be shorter. Two skins, ONE conversation: same state, same
 * endpoint, same history. A second implementation for the panel would be two
 * places to fix every streaming bug found in the first.
 */
export type ChatVariant = "page" | "panel";

export function ChatWindow({
  assistantName,
  avatar,
  initial,
  variant = "page",
  allowedMedia,
}: {
  assistantName: string;
  avatar: string;
  initial: ChatMessage[];
  variant?: ChatVariant;
  /**
   * The Media Marker whitelist for her answers — `allowedMediaMarkers()`,
   * resolved on the SERVER (the chat page, or the layout for the launcher)
   * because it reads the handbook off the filesystem. Optional, and absence
   * denies all markers (AD-54): a mount that forgot the set renders plain
   * text, never a card.
   *
   * ⚠️ **There is deliberately no `allowedLinks` beside this**, and the
   * asymmetry is worth leaving alone. This set is STATIC — one handbook, one
   * value for every member and every question — so a mount prop is the right
   * shape for it. The Content Link set never is: it is composed while one
   * particular answer is written, from what a source returned for that
   * viewer. So it travels on the MESSAGE (`ChatMessage.links`). Tidying the
   * two into a matching pair of props would mean either a stale set or one
   * window-wide whitelist that outlives the answer it belongs to.
   */
  allowedMedia?: readonly string[];
}) {
  const t = useTranslations("chat");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");

  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const [clearState, clearAction, clearing] = useActionState(
    clearChatAction,
    EMPTY,
  );
  useActionToast(clearState);

  // The server re-renders the page after the history is deleted; mirror that
  // into local state, or the transcript stays on screen until a reload.
  useEffect(() => {
    if (clearState.ok) setMessages([]);
  }, [clearState.ok]);

  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function ask() {
    const question = draft.trim();
    if (question === "" || busy) return;

    setErrorCode(null);
    setBusy(true);
    setDraft("");
    setMessages((current) => [
      ...current,
      { id: `local-${current.length}`, role: "user", content: question },
      { id: STREAMING_ID, role: "assistant", content: "" },
    ]);

    const appendDelta = (text: string) =>
      setMessages((current) =>
        current.map((message) =>
          message.id === STREAMING_ID
            ? { ...message, content: message.content + text }
            : message,
        ),
      );

    /**
     * A page this answer may link to. The endpoint sends every one of these
     * BEFORE the delta that uses it, so by the time the marker appears in the
     * text it is already allowed — no flash of bracket text.
     */
    const allowLink = (marker: string) =>
      setMessages((current) =>
        current.map((message) =>
          message.id === STREAMING_ID
            ? { ...message, links: [...(message.links ?? []), marker] }
            : message,
        ),
      );

    /** Drops the empty placeholder — an error must not leave a blank bubble. */
    const dropPlaceholder = () =>
      setMessages((current) =>
        current.filter(
          (message) => !(message.id === STREAMING_ID && message.content === ""),
        ),
      );

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: question }),
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        setErrorCode(payload?.code ?? "chatFailed");
        dropPlaceholder();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // The last piece is whatever came after the final newline — half an
        // object more often than not. Keep it for the next chunk.
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.trim() === "") continue;
          let event: { type?: string; text?: string; code?: string; marker?: string };
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event.type === "link" && event.marker) allowLink(event.marker);
          if (event.type === "delta" && event.text) appendDelta(event.text);
          if (event.type === "error") setErrorCode(event.code ?? "chatFailed");
        }
      }

      dropPlaceholder();
    } catch {
      // A dropped connection, a closed laptop lid. The answer may have been
      // stored server-side; a reload shows it.
      setErrorCode("chatFailed");
      dropPlaceholder();
    } finally {
      setBusy(false);
      setMessages((current) =>
        current.map((message) =>
          message.id === STREAMING_ID
            ? { ...message, id: `answered-${current.length}` }
            : message,
        ),
      );
    }
  }

  const panel = variant === "panel";

  const conversation = (
    <div className="space-y-4">
          {/* THE AI DISCLOSURE — Article 50(1) EU AI Act, applicable since
              2 August 2026. This is not a UX nicety and it is not a disclaimer
              about accuracy; it is the legally required notice that the person
              is talking to a machine, and it has to be given "at the latest at
              the time of the first interaction".

              That is why it sits ABOVE the transcript rather than under the
              input box where it used to be: below the fold of a short panel is
              not "at the first interaction". It renders in BOTH variants
              because it is outside the `panel ?` branch below — keep it that
              way.

              The markup moved into `components/ai-disclosure.tsx` — the same
              paragraph, mounted by the companion panel too, and the thing
              `lib/ai/disclosure.mjs` looks for when `node run.mjs legal-check`
              asks whether every live surface carries its notice.

              Do not reword it into something friendlier. `lib/ai/disclosure.test.ts`
              fails the build if either language stops naming the assistant as an
              AI, and `docs/compliance.md` says why. An assistant with a human
              name and a face is exactly the case the law has in mind: nothing
              about her is obviously a machine. */}
          <AiDisclosure surface="chat" name={assistantName} />

          <div
            className={
              panel
                ? "h-[min(20rem,45vh)] space-y-4 overflow-y-auto pr-1"
                : "max-h-[55vh] min-h-56 space-y-4 overflow-y-auto pr-1"
            }
          >
            {messages.length === 0 ? (
              <div className="text-muted-foreground space-y-2 py-8 text-center text-sm">
                <p className="text-foreground font-medium">{t("emptyTitle")}</p>
                <p className="mx-auto max-w-md">
                  {t("emptyBody", { name: assistantName })}
                </p>
              </div>
            ) : (
              messages.map((message) =>
                message.role === "assistant" ? (
                  <div key={message.id} className="flex items-start gap-3">
                    <Avatar className="mt-0.5 shrink-0">
                      {/* Falls back to the initial when no picture is present —
                          an app that never dropped its own chat.png in still
                          looks finished. */}
                      <AvatarImage src={avatar} alt="" />
                      <AvatarFallback>
                        {assistantName.slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    {/* Her answer arrives as Markdown whether or not she was
                        asked for it, so it is parsed rather than shown raw —
                        see `answer.tsx`. The user's own message below is NOT:
                        what somebody typed is shown as they typed it. */}
                    <div className="bg-muted min-w-0 rounded-lg px-3 py-2 text-sm">
                      {message.content ? (
                        <AnswerText
                          text={message.content}
                          allowedMedia={allowedMedia}
                          allowedLinks={message.links}
                        />
                      ) : (
                        <span className="text-muted-foreground">
                          {t("sending", { name: assistantName })}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div key={message.id} className="flex justify-end">
                    <div className="bg-primary/10 text-foreground max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">
                      {message.content}
                    </div>
                  </div>
                ),
              )
            )}
            <div ref={bottom} />
          </div>

          <div className="flex items-end gap-2 border-t pt-4">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter breaks the line — what people expect
                // from a chat box. Without this the primary action of the page
                // needs a mouse.
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask();
                }
              }}
              maxLength={MAX_MESSAGE_CHARS}
              rows={2}
              placeholder={t("placeholder")}
              aria-label={t("placeholder")}
              disabled={busy}
              className="resize-none"
            />
            <Button
              type="button"
              onClick={() => void ask()}
              // Not merely tidy: the endpoint is not idempotent and every call
              // costs the operator money. A double-click must not buy two
              // answers to one question.
              disabled={busy || draft.trim() === ""}
              aria-label={t("send")}
            >
              <Send aria-hidden className="size-4" />
              <span className={panel ? "sr-only" : "hidden sm:inline"}>{t("send")}</span>
            </Button>
          </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {errorCode && (
        <Callout variant="danger">{tErrors(errorCode)}</Callout>
      )}

      {/* In the panel the frame is the launcher's; a card inside it would be a
          second border around the first. */}
      {panel ? (
        conversation
      ) : (
        <Card>
          <CardContent className="space-y-4">{conversation}</CardContent>
        </Card>
      )}

      {/* The disclosure used to sit here. It is now the first line of
          `conversation` above — see the note there before moving it back. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {messages.length > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" disabled={clearing}>
                <Trash2 aria-hidden className="size-4" />
                {t("clear")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("clearTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("clearBody")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                <form action={clearAction}>
                  <AlertDialogAction type="submit" variant="destructive">
                    {t("clearConfirm")}
                  </AlertDialogAction>
                </form>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}
