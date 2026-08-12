// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// **One component, N call sites.**
//
// An app that wants a companion on a page writes exactly this and nothing else:
//
//     <CompanionPanel companionId="writing-coach" subject={day.slug} />
//
// A second companion is a second entry in `modules/companion/companions.ts` and a second
// place this component is rendered — never a second component. Two
// half-identical panels is what happens otherwise, and the difference between
// them shows up as one of the two quietly losing a guard.
//
// Everything that decides anything lives on the server: the instruction, the
// plan, the ceiling and the facts are in the registry entry, and this file sends
// two strings. An instruction sent from the browser would be the whole prompt
// handed to the customer.
//
// ── It does not stream (AD-48) ─────────────────────────────────────────────
// One `await`, a spinner, the answer at the end. Do NOT copy the ndjson reader
// out of `app/dashboard/chat/ui.tsx` — when answers get long, that protocol is
// the thing to reuse, not to duplicate.
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { AiDisclosure } from "@/components/ai-disclosure";
import { AnswerText } from "@/components/answer-text";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Textarea } from "@/components/ui/textarea";
import {
  askCompanionAction,
  loadCompanionAction,
  type CompanionState,
} from "@/modules/companion/actions";
import type { CompanionTurn } from "../rules";

/** `disabledInConfig` → `DisabledInConfig`, so one message key per reason. */
function cap(reason: string): string {
  return reason.charAt(0).toUpperCase() + reason.slice(1);
}

export interface CompanionPanelProps {
  /** An id from `modules/companion/companions.ts`. */
  companionId: string;
  /** Which of this member's things the conversation is about. */
  subject: string;
  /**
   * The companion's own input ceiling, resolved on the server and passed down.
   * A hint for the textarea only — `askCompanionAction` re-asks, because this
   * component is not what protects anything.
   */
  maxInputChars?: number;
}

export function CompanionPanel({ companionId, subject, maxInputChars }: CompanionPanelProps) {
  const t = useTranslations("companion");
  const tErrors = useTranslations("errors");

  // `null` means "not fetched yet"; anything else is an answer from the server
  // that can say "ready" or "off". `[]` alone could not tell "nothing said yet"
  // from "this feature is switched off", which is why the action returns a
  // discriminated result rather than a list.
  const [loaded, setLoaded] = useState<CompanionState | null>(null);
  const [turns, setTurns] = useState<CompanionTurn[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  /**
   * Which (companion, subject) the panel is currently showing.
   *
   * A `send()` that is still in flight when the subject changes would otherwise
   * append its answer to the conversation the customer has since moved to — the
   * database has it filed correctly, the screen does not, and a reload silently
   * "moves" it. `live` on the effect protects the load; this protects the send.
   */
  const showing = useRef(`${companionId}:${subject}`);

  useEffect(() => {
    let alive = true;
    const key = `${companionId}:${subject}`;
    showing.current = key;
    // Everything that belongs to the previous subject goes with it. A draft
    // typed for day 3 must not be sent against day 7 with one click, and a
    // stale error must not sit above a conversation it was never about.
    setLoaded(null);
    setTurns([]);
    setMessage("");
    setError(null);

    void loadCompanionAction({ companionId, subject })
      .then((result) => {
        if (!alive) return;
        setLoaded(result);
        if (result.state === "ready") setTurns(result.turns);
      })
      .catch(() => {
        // A rejected load (an expired session, a database that went away) must
        // not leave the panel in "still loading" for ever with an active Send
        // button underneath it.
        if (alive) setLoaded({ state: "off", reason: "brokenConfig" });
      });

    return () => {
      alive = false;
    };
  }, [companionId, subject]);

  useEffect(() => {
    // Only once there is something to scroll to. Firing on the first paint
    // jumps the browser to the bottom of the panel before the customer has read
    // the page it sits on.
    if (turns.length > 0) bottom.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  const ready = loaded?.state === "ready";
  const ceiling = loaded?.state === "ready" ? loaded.maxInputChars : maxInputChars;

  async function send() {
    const text = message.trim();
    // Not while the history is still loading: the optimistic row would be
    // appended to an empty list and then overwritten by the load still in
    // flight, and the question would disappear as the customer watched.
    if (text === "" || busy || !ready) return;

    const key = showing.current;
    setBusy(true);
    setError(null);
    // Shown immediately, with a local id: the answer takes seconds, and a
    // question that vanishes while it is being answered reads as a failure.
    const optimistic: CompanionTurn = { id: `local-${Date.now()}`, role: "user", content: text };
    setTurns((current) => [...current, optimistic]);
    setMessage("");

    try {
      const result = await askCompanionAction({ companionId, subject, message: text });
      // The customer may have moved on while this was in flight. The answer is
      // stored under the conversation it belongs to; showing it here would put
      // it in the wrong one.
      if (showing.current !== key) return;

      if (result.ok) {
        setTurns((current) => [
          ...current,
          { id: `answer-${Date.now()}`, role: "assistant", content: result.answer },
        ]);
      } else {
        // 🚨 Only take the row back when the server says nothing was stored.
        //
        // The first version of this rolled back on every refusal, and a
        // by-hand check caught what that costs: a failed MODEL call has already
        // written the question to the transcript, so the customer watched their
        // message disappear, got the text handed back — and found it in the
        // transcript after a reload, ready to be sent a second time. Which of
        // the two happened is the server's knowledge, not the panel's.
        if (!result.kept) {
          setTurns((current) => current.filter((turn) => turn.id !== optimistic.id));
          setMessage(text);
        }
        // A CODE crosses the boundary, never a sentence — so an error from the
        // action and an error from anywhere else read identically.
        setError(tErrors(result.code));
      }
    } catch {
      // 🚨 There was no `catch` here, and its absence was the worst of it: a
      // thrown action left `error` at null, `busy` false and the message box
      // already cleared, so the customer saw their own words, no answer and no
      // reason — and after a reload the text was gone. An expired session and a
      // database error both take this path.
      //
      // The row is kept rather than rolled back: a thrown action gives no
      // answer about whether the question was stored, and keeping a question
      // that turns out not to have been written is a smaller wrong than
      // offering one that was.
      if (showing.current !== key) return;
      setError(tErrors("companionFailed"));
    } finally {
      if (showing.current === key) setBusy(false);
    }
  }

  if (loaded === null) {
    return <p className="text-muted-foreground py-6 text-center text-sm">{t("loading")}</p>;
  }

  if (loaded.state === "off") {
    // The customer learns before they write, not after they send. The reason is
    // a code from the server; the wording is here.
    return (
      <Callout variant="info" title={t("offTitle")}>
        {loaded.reason === "noAccess" ? tErrors("noAccess") : t(`off${cap(loaded.reason)}`)}
      </Callout>
    );
  }

  return (
    <div className="space-y-4">
      {/* THE AI DISCLOSURE — Article 50(1) EU AI Act, applicable since
          2 August 2026. `CLAUDE.md` states the rule as "anything here that talks
          to a person as a machine says so" and adds "whatever AI feature you add
          next inherits it". This is that feature, and it is the sharper case:
          the model reads what the customer WROTE, which the assistant never
          does. The sentence says so.

          It sits ABOVE the transcript, not under the input box: below the fold
          is not "at the latest at the time of the first interaction". It renders
          whether or not there is anything in the transcript yet, and whether or
          not the history has finished loading — the first interaction is the one
          that has not happened.

          The markup is `components/ai-disclosure.tsx`, shared with the
          assistant, and `node run.mjs legal-check` finds it by looking for this
          tag. Do not reword the sentence into something friendlier;
          `lib/ai/disclosure.test.ts` fails the build if either language stops
          naming it as an AI. */}
      <AiDisclosure surface="companion" />

      <div className="max-h-[45vh] min-h-32 space-y-4 overflow-y-auto pr-1">
        {turns.length === 0 && (
          <div className="text-muted-foreground space-y-1 py-6 text-center text-sm">
            <p className="text-foreground font-medium">{t("emptyTitle")}</p>
            <p>{t("emptyBody")}</p>
          </div>
        )}

        {turns.map((turn) => (
          <div
            key={turn.id}
            className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={
                turn.role === "user"
                  ? "bg-primary text-primary-foreground max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap"
                  : "bg-muted max-w-[85%] rounded-lg px-3 py-2 text-sm"
              }
            >
              {/* The customer's own words are shown as they typed them; only the
                  model's answer goes through the markdown subset. Neither path
                  uses `dangerouslySetInnerHTML`. */}
              {turn.role === "user" ? turn.content : <AnswerText text={turn.content} />}
            </div>
          </div>
        ))}

        {busy && <p className="text-muted-foreground text-sm">{t("sending")}</p>}
        <div ref={bottom} />
      </div>

      {error && <Callout variant="danger">{error}</Callout>}

      <div className="space-y-2">
        <Textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={t("placeholder")}
          maxLength={ceiling}
          rows={4}
          disabled={busy}
        />
        {/* `disabled` while it runs, and not as tidiness: the action is not
            idempotent and every call costs the operator money. `!ready` for a
            different reason — `send()` already refuses then, and a button that
            looks live and silently does nothing is the "action that reports
            nothing back" `docs/ux.md` names. */}
        <Button onClick={send} disabled={busy || !ready || message.trim() === ""}>
          {busy ? t("sending") : t("send")}
        </Button>
      </div>
    </div>
  );
}
