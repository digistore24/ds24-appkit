// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Asking a model about something your customer produced.
//
//   const answer = await askCompanion({
//     instruction: "You are a writing coach on day 7 of a 12-week course.",
//     about: [{ label: "Day", value: "7" }, { label: "Task", value: "A scene without dialogue" }],
//     work:  [{ label: "Their scene", text: submission }],
//     ask:   "Name one thing that works and one thing to try next.",
//     memberId: session.user.id,
//   });
//
// ── What this file is, and what it is not ──────────────────────────────────
// It is the module's binding to ONE task id. The prompt is assembled by
// `lib/ai/customer-text.ts` — the fence around customer-written text is the
// CORE's rule and holds for every caller that sends a model something somebody
// else wrote, this module being merely its first one. It is also NOT a second
// entry point: `lib/ai/run.ts` stays the one place that resolves binding →
// adapter → call → record, and that order is what makes a keyless call still
// leave a row.
//
// ── The data rule, in the direction that applies HERE ───────────────────────
// The support assistant sends **nothing** about the person — not their name,
// balance, orders or role (`docs/ai-chat.md` → *What she can and cannot do*).
// That rule is about her and it stays. A companion is the opposite case by
// construction: it is worthless unless it can see the challenge day and the
// answer somebody wrote. So the rule for this side is stated the other way
// round: **a call is given exactly the rows its call site names, one field at a
// time.**
//
// Why that makes `about` a list of labelled values rather than a member id is
// argued once, over the field itself (`CustomerTextRequest.about` in
// `lib/ai/customer-text.ts`) — including the half a caller here has to keep:
// those values are worded by the APP, and what the CUSTOMER wrote goes in
// `work`. What is this module's own is the consequence: it imports no database,
// no entitlement function and no token function, and `companion.test.ts` reads
// the file to prove it — a call that could fetch for itself is a call whose
// call site no longer names what it sends. `memberId` travels for the usage row
// and for nothing else.
import { buildFencedRequest, type CustomerTextRequest } from "@/lib/ai/customer-text";
import { runTask, type TaskResult } from "@/lib/ai/run";

/**
 * What `askCompanion` takes: the core's fenced request, plus the two fields
 * that belong to `runTask` rather than to the prompt.
 *
 * Not an alias. `instruction` / `about` / `work` / `ask` / `history` are the
 * core's vocabulary and are typed there; these two are this module's, because
 * `buildFencedRequest` has no use for either — a `memberId` on the core type
 * would be a field the builder silently ignores.
 *
 * ⚠️ That keeps the two fields out of the core type; it does not make the
 * mistake impossible. TypeScript's excess-property check bites at a fresh
 * object literal only, so `const req = { instruction, work, ask, memberId };
 * buildFencedRequest(req)` compiles and drops `memberId` in silence. The common
 * path is closed, the variable path is not, and closing it too would mean
 * `memberId?: never` on the core type and `Omit<…> &` here — a heavier contract
 * than the mistake is worth.
 */
export interface CompanionInput extends CustomerTextRequest {
  /** Whom this is for. Recorded, never sent — the same contract as `TaskInput`. */
  memberId?: string | null;
  maxTokens?: number;
}

/**
 * Ask the companion, and wait for the whole answer.
 *
 * Errors are **not** caught here. `ProviderError` travels exactly as `runTask`
 * raises it, so the usage row is written by the layer with the provider and
 * model the call would have used — including the call that never reached a
 * provider because no key was configured. Catching it here would turn the one
 * record that answers *"why is nothing working"* into a silence.
 *
 * There is no streaming variant, deliberately (AD-48). A companion answers in
 * one go, and the shape to reuse when answers get long is the chat route's
 * JSON-line stream rather than a second protocol.
 */
export async function askCompanion(input: CompanionInput): Promise<TaskResult> {
  const { system, messages } = buildFencedRequest(input);
  return runTask("companion", {
    system,
    messages,
    memberId: input.memberId ?? null,
    maxTokens: input.maxTokens,
  });
}
