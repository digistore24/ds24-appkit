// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The companion's pure rules — the half that can be tested without a database,
// a key or a request, the same split `lib/ai/rules.ts` makes for the assistant.
//
// Nothing here reads configuration, touches the network or knows what a session
// is. Everything arrives as an argument and a decision comes back as a value.
import { hasControlChar, type ChatRole } from "@/lib/ai/rules";

/**
 * The key one conversation is stored under.
 *
 * **The client never sends one.** It sends a companion id and a subject; this
 * function composes the key on the server, after the registry has vouched for
 * the companion. If the browser could name the whole key it could name another
 * companion's conversation and read its turns back — composing it here makes
 * that impossible rather than merely unlikely.
 *
 * It also gives both halves of "two subjects never share a history" for free:
 * `coach:day-7` ≠ `coach:day-3`, and `coach:day-7` ≠ `tutor:day-7`.
 *
 * **Why a colon is enough.** `companionId` is `[a-z0-9-]`, at most 40
 * characters — `companionProblems()` in `modules/companion/switch.ts` refuses
 * anything else — so the FIRST colon is always the split point and no pair of
 * (companion, subject) can produce the key of another. Allow a dotted, colonned
 * or uppercase id and that stops being true; the validation is what this
 * function rests on.
 */
export function conversationIdFor(companionId: string, subject: string): string {
  return `${companionId}:${subject}`;
}

/** What one companion may take in, when its registry entry does not say. */
export const DEFAULT_COMPANION_INPUT_CHARS = 8_000;

/**
 * What no entry may exceed, whatever it asks for.
 *
 * The ceiling is per companion because "read my 1200-word essay" and "walk me
 * through today" cannot share one number — but it is clamped here, because the
 * cost argument `lib/ai/rules.ts` makes about `MAX_MESSAGE_CHARS` does not go
 * away: history is re-sent in full on every turn, so an unbounded field is an
 * unbounded bill somebody else pays. Roughly 3000 words.
 */
export const MAX_COMPANION_INPUT_CHARS = 20_000;

/** What no entry may exceed in exchanges of history, whatever it asks for. */
export const MAX_COMPANION_HISTORY_TURNS = 40;

/**
 * The entry's own history window, clamped.
 *
 * The same argument as the input ceiling and it was missed the first time: the
 * trimmed history is re-sent **in full on every turn**, so this number decides
 * how fast a long conversation gets expensive. Unclamped, one typo in a registry
 * entry (`maxHistoryTurns: 1000`) sends everything `CONVERSATION_PAGE_SIZE`
 * allows on every message, for ever.
 */
export function companionHistoryTurns(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return 1;
  if (value < 1) return 1;
  return Math.min(value, MAX_COMPANION_HISTORY_TURNS);
}

/** The entry's own ceiling, clamped — the `count(value, fallback, max)` shape. */
export function companionInputChars(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return DEFAULT_COMPANION_INPUT_CHARS;
  }
  if (value < 1 || value > MAX_COMPANION_INPUT_CHARS) return DEFAULT_COMPANION_INPUT_CHARS;
  return value;
}

/**
 * The codes this layer returns. Sentences live in `messages/{de,en}.json`.
 *
 * **Mixed on purpose.** A code is reused when its shipped sentence is already
 * right for a companion in both languages, and added when it is not. Showing
 * *"The assistant is not available right now."* to somebody who was not talking
 * to the assistant, or *"Too many uploads in a short time"* to somebody who
 * asked their coach a question, is worse than a key in a JSON file.
 *
 * Registered in `i18n/messages.test.ts` → `ERROR_CODE_UNIONS`, so a code with no
 * text in **both** locales fails the build.
 */
export const COMPANION_ERROR_CODES = [
  // The feature is off on this installation, its config is broken, or the
  // companion the caller named is not in the registry. One code for all three:
  // "no such companion" would tell a caller which ids exist.
  "companionUnavailable",
  // Signed in, but the plan this companion is gated on is not held.
  // `noAccess` is reused — its shipped sentence is already generic.
  "noAccess",
  "companionRateLimited",
  "companionEmptyMessage",
  "companionMessageTooLong",
  // The subject the browser sent is not one this layer will store or look up.
  "companionBadSubject",
  // Not enough tokens.
  //
  // ⚠️ `insufficientBalance` is deliberately NOT reused here, and the first
  // draft of this file got that wrong. Its shipped sentence is
  // *"The balance is not that high. It has been left unchanged."* — written for
  // `decideAdjustment`, where an **operator** is correcting a balance. To a
  // customer whose answer was refused, the second half says nothing about the
  // refusal. That is the same failure this list rejected `chatUnavailable` and
  // `rateLimited` for; the rule simply was not applied to the second reused code.
  "companionInsufficientBalance",
  // The model call failed. Vague towards the customer, precise in the log —
  // the same split `app/api/chat/route.ts` makes.
  "companionFailed",
] as const;

export type CompanionErrorCode = (typeof COMPANION_ERROR_CODES)[number];

export type SubjectCheck = { ok: true; subject: string } | { ok: false; code: CompanionErrorCode };

/**
 * Is this a subject this layer will accept?
 *
 * It routinely arrives from a URL segment or a hidden form field, so it is
 * customer-controlled: bounded, and refused outright if it carries a control
 * character. NUL is the one that matters — Postgres rejects it, and the
 * rejection would land *after* the model call had been paid for.
 */
export function checkSubject(input: unknown): SubjectCheck {
  if (typeof input !== "string") return { ok: false, code: "companionBadSubject" };
  const subject = input.trim();
  if (subject === "" || subject.length > 200) return { ok: false, code: "companionBadSubject" };
  if (hasControlChar(subject)) return { ok: false, code: "companionBadSubject" };
  // No line breaks, and this is stricter than `hasControlChar` on purpose — that
  // function allows tab, newline and carriage return because they are legitimate
  // in something somebody WROTE. A subject is not written, it is an identifier
  // off a URL segment; and a realistic `load()` mirrors it straight back into
  // the prompt as an `about` value, which sits outside the fence. A multi-line
  // subject would put unlabelled lines there. The companion id is pinned to
  // `[a-z0-9-]` for the same class of reason.
  if (/[\r\n\t]/.test(subject)) return { ok: false, code: "companionBadSubject" };
  return { ok: true, subject };
}

export type CompanionMessageCheck =
  | { ok: true; text: string }
  | { ok: false; code: CompanionErrorCode };

/**
 * Is this something we can send to the model?
 *
 * The same five refusals `checkMessage` makes, against a ceiling that is the
 * companion's own rather than the chat's. `MAX_MESSAGE_CHARS` is deliberately
 * not imported: 2000 characters is a brake on a typed question, and a
 * submission is not a question.
 *
 * The refusal lives here and not in the textarea's `maxLength`: a server action
 * is an HTTP endpoint of its own and can be called without the page ever having
 * been rendered.
 */
export function checkCompanionMessage(input: unknown, maxChars: number): CompanionMessageCheck {
  if (typeof input !== "string") return { ok: false, code: "companionEmptyMessage" };
  const text = input.trim();

  // `trim()` does not strip a zero-width space or a braille blank, so a
  // "submission" made of those would arrive, cost a full call and produce a
  // confused answer. One letter or digit somewhere is the same test the chat and
  // an operator's adjustment reason both apply.
  if (text === "" || !/[\p{L}\p{N}]/u.test(text)) {
    return { ok: false, code: "companionEmptyMessage" };
  }
  if (text.length > maxChars) return { ok: false, code: "companionMessageTooLong" };
  if (hasControlChar(text)) return { ok: false, code: "companionEmptyMessage" };

  return { ok: true, text };
}

/** What the panel is handed for one stored turn. */
export interface CompanionTurn {
  id: string;
  role: ChatRole;
  content: string;
}
