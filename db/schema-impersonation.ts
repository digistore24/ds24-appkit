// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The record of an Operator having signed in as one of their customers.
//
// One row per impersonation session: who, whom, from when, until when. It is
// the app's answer to the only question that matters afterwards — *"did
// somebody go into my account?"* — and the reason the feature is defensible at
// all rather than being a backdoor with a nice UI.
//
// ── It is a capability, not only a log ─────────────────────────────────────
// This is the part that is easy to miss and dangerous to "simplify". The row is
// written BEFORE the session changes, and its id is what the auth callback
// accepts as proof that an impersonation was authorised (lib/impersonation/
// session.ts). `/api/auth/session` takes a POST from any signed-in user and
// hands the body to the `jwt` callback — @auth/core says in its own types
// "you should validate this data before using it" — so a callback that trusted
// a member id out of that body would let ANY member sign in as anyone,
// including an owner. It trusts a row instead, and only one whose `operatorId`
// is already the caller's own id.
//
// So "write the row first" is not bookkeeping discipline that a future refactor
// may reorder for tidiness. Reordering it removes the authorisation.
//
// ── What it deliberately does NOT hold ─────────────────────────────────────
// Nothing about what the Operator did while inside. No page list, no actions,
// no keystrokes. An activity log of a support session is a surveillance log of
// a customer's own data, and every change that matters already leaves its own
// record: `token_ledger`, `grants`, `email_changes`, `ai_usage`.
//
// ── Personal data ──────────────────────────────────────────────────────────
// It is personal data about the MEMBER — it appears in
// `node run.mjs data-export --email …` and in `docs/data-protection.md`, and it
// is pruned after twelve months. A record of who accessed an account that the
// account's owner cannot see is exactly the record a regulator asks about.
import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./schema-core";

export const impersonations = pgTable(
  "impersonations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // The Operator who stepped in. `set null`, like `ai_usage.memberId` and
    // unlike the chat transcripts: this is evidence, and it does not stop
    // having happened because the account that did it was later deleted. The
    // link goes; the row stays, and the member's export still shows that
    // somebody was in there.
    operatorId: text("operator_id").references(() => users.id, {
      onDelete: "set null",
    }),

    // Whose account was entered. `cascade`: the row is that member's personal
    // data, so deleting the member deletes it — the opposite trade from the
    // operator column above, and the reason the two differ.
    memberId: text("member_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    startedAt: timestamp("started_at", { mode: "date" }).notNull().defaultNow(),

    // When the session was due to end on its own. Stored rather than computed
    // from `startedAt + 30 minutes`, so that changing the constant later does
    // not silently rewrite history — and so the job that closes abandoned rows
    // has a column to compare against instead of arithmetic.
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),

    // NULL means "still running", the same idiom as `users.blockedAt`. Set when
    // the Operator steps out, when the cap passes on a live request, when they
    // sign out — and by `lib/cron/jobs.ts` for the one case none of those
    // covers: the tab was simply closed and no request ever came back.
    endedAt: timestamp("ended_at", { mode: "date" }),

    // How it ended, so the record page can say whether the Operator left or the
    // clock did. A row closed by the job means "ended at or before this time",
    // which is not the same claim as "they were there until this moment".
    endedBy: text("ended_by"),
  },
  (t) => [
    // The record page reads newest first; the export reads by member.
    index("impersonations_started_at_idx").on(t.startedAt),
    index("impersonations_member_idx").on(t.memberId, t.startedAt),
    // The job hunts rows that are still open and past their cap. Both of its
    // predicates are here.
    index("impersonations_open_idx").on(t.endedAt, t.expiresAt),
  ],
);

/** How an impersonation ended. Codes, never sentences — the page translates. */
export const IMPERSONATION_END_REASONS = [
  /** The Operator pressed the button in the banner. */
  "operator",
  /** The thirty minutes ran out and a request noticed. */
  "expired",
  /** They signed out entirely rather than stepping back. */
  "signout",
  /** Nobody came back; the scheduled job closed it. */
  "abandoned",
] as const;

export type ImpersonationEndReason = (typeof IMPERSONATION_END_REASONS)[number];
