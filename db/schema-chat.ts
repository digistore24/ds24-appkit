// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The in-app assistant's transcripts.
//
// One row per message, the member's own questions and her answers alike. The
// conversation on screen is the last N rows for that member; the history sent
// to the model is a window over them (lib/ai/rules.ts → trimHistory).
//
// ── Why `cascade`, where money uses `set null` ─────────────────────────────
// `orders`, `subscriptions` and `token_accounts` deliberately keep their rows
// when a customer is deleted: they are financial records, and the fact that
// money moved outlives the account it moved for. A chat transcript is the
// opposite kind of thing. It is the member's own words, it is personal data
// with no retention obligation behind it, and keeping it after they asked to be
// deleted would be the violation rather than the record. So it goes with them.
//
// It is in `docs/data-protection.md` for the same reason, and it is part of
// `node run.mjs data-export` — a subject access request covers what somebody
// typed into a chat window as much as anything else.
import { pgTable, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { users } from "./schema-core";

/** Who said it. Mirrors the two roles the Messages API accepts. */
export const chatRoleEnum = pgEnum("chat_role", ["user", "assistant"]);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // The member this conversation belongs to. NOT NULL: unlike a purchase,
    // a message with nobody attached is not a record of anything — it is a row
    // no page can ever show and no export can ever find.
    memberId: text("member_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Which conversation this row belongs to — and **NULL is the assistant's
    // one conversation**, the `NULL` means "not" idiom this schema already uses
    // for `users.blockedAt`. So every row that existed before this column did is
    // a support row by construction, with no backfill and no default.
    //
    // The value is an OPAQUE KEY composed by this app's own code
    // (`conversationIdFor(companionId, subject)` in lib/ai/companion-rules.ts),
    // never a foreign key: a subject is the app's own slug for a lesson or a
    // challenge day, not a row the template could reference — a real foreign
    // key would demand a taxonomy for subjects it cannot know about. One
    // column rather than a `(kind, id)` pair for the same reason.
    // `activity_results` (schema-learning.ts) keys a learner's RESULTS by the
    // same slug, deliberately: a lesson's coach and a lesson's game share
    // coordinates without either knowing the other exists.
    //
    // A companion's turns being rows HERE, rather than in a table of their own,
    // is what makes the whole of FR-119 free: the cascade above already removes
    // them with the account, and both exports already find them. A second table
    // would have needed its own cascade, its own export section and its own
    // deletion path — four places for one requirement to go half-done.
    conversationId: text("conversation_id"),
    role: chatRoleEnum("role").notNull(),
    // What was said. Bounded before it gets here: MAX_MESSAGE_CHARS in
    // lib/ai/rules.ts for a question, `max_tokens` on the API call for an
    // answer. `text` rather than `varchar(n)` because the model's answer length
    // is bounded in tokens, and tokens are not characters.
    content: text("content").notNull(),
    // The `[link:…]` markers this answer actually used — the whitelist that
    // makes them render, kept with the words they belong to.
    //
    // ── Why this column exists at all ─────────────────────────────────────
    // The set is composed per REQUEST, from the content hits a source returned
    // while the answer was being written (lib/ai/content-links.ts). Without
    // this column that set dies with the request: the stored answer still
    // contains the markers, the page that reloads it has no whitelist for
    // them, and every link the customer had yesterday is raw bracket text
    // today. That reads as a rendering bug, and the tempting "fix" — render
    // any marker that parses — throws the whole control away.
    //
    // NULL is "no links", and every row written before this column reads back
    // that way: no backfill, no default, and the fail-safe direction is the
    // one that costs a link rather than the one that invents one. Only markers
    // the finished answer really carries are stored (`ledger.used()`), never
    // everything she was offered.
    //
    // Contents are paths and titles of this app's own pages — nothing personal
    // beyond what the row already holds, and it cascades with the account like
    // the rest of it (docs/data-protection.md).
    links: text("links").array(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // Every read is "this member's messages, newest last" — one index for the
    // filter and the order together. Kept as it is: it is the path of the
    // subject access request and of the cascade delete, both of which want every
    // row of a member regardless of conversation.
    index("chat_messages_member").on(t.memberId, t.createdAt),
    // The path of every companion turn: `member_id = $1 AND conversation_id = $2
    // ORDER BY created_at`. The index above can only answer that by reading all
    // of a member's rows and filtering, which is fine at ten rows and not at ten
    // thousand. It serves the support read (`conversation_id IS NULL`) exactly
    // as well, so one index answers both scopes.
    index("chat_messages_conversation").on(t.memberId, t.conversationId, t.createdAt),
  ],
);
