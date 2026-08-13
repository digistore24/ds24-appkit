// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// **The companions this app has. Nothing else.**
//
// One list the app edits, exactly the role `lib/ai/tools.ts` and
// `lib/cron/jobs.ts` play. There is no second registry, no per-companion file
// and no configuration that names one — a companion is an entry here, and a
// page renders `<CompanionPanel companionId="…" subject="…" />`.
//
// It ships **empty**. Nothing in this template puts a companion in front of the
// vendor's own customers; what one is for, and which shape fits which kind of
// app, is a decision the vendor makes.
//
// ── Why the instruction and the plan live here and not in the browser ──────
// One surface serves every companion (AC 8), so the surface takes two strings
// from the client — a companion id and a subject — and everything else comes
// from this list. An instruction sent by the browser is the entire prompt handed
// to the customer; a `requiresPlan` sent by the browser is no gate at all.
import type { CustomerFact, CustomerText } from "@/lib/ai/customer-text";

/** What one call is allowed to see about this member's subject. */
export interface CompanionSubject {
  /** Named facts about the customer's work. One entry per field. */
  about?: readonly CustomerFact[];
  /** What the customer produced. Content, never instruction. */
  work?: readonly CustomerText[];
}

export interface Companion {
  /**
   * Stable, `[a-z0-9-]`, at most 40 characters. Half of the conversation key,
   * and `companionProblems()` refuses anything else — the restriction is what
   * makes `conversationIdFor()` collision-free (see `companion-rules.ts`).
   */
  id: string;
  /** Who it is and how it answers. Stable → this is the cacheable block. */
  instruction: string;
  /** A product key that gates it, or `null` for every signed-in member. */
  requiresPlan: string | null;
  /** Tokens one answer costs this member. `0` = not metered. */
  costsTokens: number;
  /** This companion's own input ceiling. Clamped by the layer. */
  maxInputChars?: number;
  /** Exchanges of history sent to the model. Falls back to the chat's number. */
  maxHistoryTurns?: number;
  /**
   * Reads THIS member's subject, on the server.
   *
   * 🚨 **This is where an IDOR would live.** `subject` is a string the
   * customer's browser sent — it comes off a URL segment or a hidden field, and
   * it is theirs to change. **Every read inside this function must be scoped by
   * `memberId`.** An entry that looks a submission up by id alone hands one
   * customer another's work, and the model then summarises it back to them.
   *
   * Return `null` when there is no such subject **for this member** — and that
   * is deliberately the same answer as "it belongs to somebody else", so
   * nothing here can be used to find out which ids exist.
   *
   * This is the `spendTokens` lesson (which takes no member id at all) applied
   * to a string instead of an id, and it is the most important sentence in this
   * file.
   */
  load(ctx: { memberId: string; subject: string }): Promise<CompanionSubject | null>;
}

/**
 * Every companion this app has.
 *
 * A worked example, to copy rather than to uncomment — it references tables that
 * do not exist here:
 *
 * ```ts
 * export const COMPANIONS: readonly Companion[] = [
 *   {
 *     id: "writing-coach",
 *     instruction:
 *       "You are a writing coach on a twelve-week course. Two short " +
 *       "paragraphs, warm but specific. Never rewrite their text for them.",
 *     requiresPlan: "course_complete",   // a key from config/digistore-products.json
 *     costsTokens: 2,                  // 0 = included in the plan
 *     maxInputChars: 12_000,
 *     async load({ memberId, subject }) {
 *       // ⚠️ scoped by memberId — both conditions, always.
 *       const [row] = await db
 *         .select()
 *         .from(submissions)
 *         .where(and(eq(submissions.memberId, memberId), eq(submissions.day, subject)))
 *         .limit(1);
 *       if (!row) return null;         // also the answer for somebody else's row
 *
 *       return {
 *         about: [
 *           { label: "Day", value: subject },
 *           { label: "Task", value: row.task },
 *         ],
 *         work: [{ label: "Their scene", text: row.body }],
 *       };
 *     },
 *   },
 * ];
 * ```
 *
 * Note what the entry does NOT do: it does not build a prompt, does not name a
 * model, does not decide access and does not charge. `requiresPlan` and
 * `costsTokens` are read by `modules/companion/actions.ts`, which asks `hasPlan()`
 * and `spendTokens()` in the order check → work → charge.
 */
export const COMPANIONS: readonly Companion[] = [];

/** The entry with this id, or `undefined`. The lookup the server action makes. */
export function companionById(id: string): Companion | undefined {
  return COMPANIONS.find((companion) => companion.id === id);
}
