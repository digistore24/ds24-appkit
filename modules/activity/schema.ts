// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What a learner DID — one row per member, activity and subject.
//
// This is the table `schema-chat.ts` says the template never shipped ("no
// table a challenge day or a lesson could point at"). An interactive element —
// a game, a test, an exercise — is not content: it is state per learner plus a
// verdict, and this is where both live. The verdict itself is only ever
// written by the server (`modules/activity/results.ts` → the activity's `grade()`);
// a score that arrived from a browser is data about an attempt, never the
// result of one.
//
// ── Why `cascade`, where money uses `set null` ─────────────────────────────
// The same decision as `chat_messages`, for the same reason: this is the
// learner's own performance — personal data about a person's ability, with no
// retention obligation behind it. Keeping it after they asked to be deleted
// would be the violation rather than the record. It is NOT a financial record
// like `orders`, which outlives the account it moved for.
//
// ── Why `passed` (and the scores) are nullable ─────────────────────────────
// "Not judged yet" and "failed" are different answers, and a page will render
// them differently. An activity in progress has no verdict, and `null` IS that
// state — a `.default(false)` here would tell every learner who has not
// finished that they did not pass.
//
// ── The `subject` column ───────────────────────────────────────────────────
// The app's own stable slug for the thing the element sits on ("lektion-3",
// "woche-7") — an OPAQUE KEY, never a foreign key, for the reason
// `schema-chat.ts` already gives: the template cannot know what a subject is,
// and a real reference would force it to invent a taxonomy. It is the SAME
// string a `<CompanionPanel subject=…>` on that unit uses, which is what lets
// a lesson's coach and a lesson's game share coordinates without either
// knowing the other exists.
import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

import { users } from "@/db/schema-core";

export const activityResults = pgTable(
  "activity_results",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // The learner. NOT NULL and cascading — see the header.
    memberId: text("member_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Which registry entry (`modules/activity/activities.ts`) this row belongs to.
    activityId: text("activity_id").notNull(),
    // See the header. An activity with no meaningful subject passes a
    // constant — NOT NULL is load-bearing: it is half of the unique index
    // below, and Postgres treats NULLs as distinct, so a nullable column here
    // would silently void the idempotency key (the migration-0011 trap,
    // recorded on `grants_purchase_product`).
    subject: text("subject").notNull(),
    // The resume point. Written by the server ONLY, from what `grade()`
    // returned — never from the browser's payload, or the column becomes
    // client-controlled storage inside the app's own row, and the next thing
    // somebody puts in it is a score.
    state: jsonb("state"),
    score: integer("score"),
    maxScore: integer("max_score"),
    passed: boolean("passed"),
    // Finalised attempts. A checkpoint (a verdict with `final: false`) does
    // not count one — see `modules/activity/rules.ts` → `applyVerdict`.
    attempts: integer("attempts").notNull().default(0),
    // Honest name-check: this is when the first submission was RECORDED, not
    // when the learner opened the element — a row only comes into being at
    // the first write, so do not build time-on-task on it.
    startedAt: timestamp("started_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    // When the learner first got THROUGH it (a final verdict that did not
    // fail). A failed attempt leaves it null; a later pass sets it; once set
    // it keeps the first time. Story 14.4 will derive progress from this
    // rather than keeping a second record.
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    // The read path AND the idempotency key in one: `recordSubmission` upserts
    // on it, which is what makes the same submission delivered twice count one
    // attempt. Both non-member columns are NOT NULL — see `subject` above.
    uniqueIndex("activity_results_member_activity_subject").on(
      t.memberId,
      t.activityId,
      t.subject,
    ),
    // The export and deletion path: every row of one member, regardless of
    // activity — the subject access request and the cascade both walk this.
    index("activity_results_member").on(t.memberId),
  ],
);
