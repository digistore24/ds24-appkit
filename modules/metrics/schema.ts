// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What happened, and how often — the two tables behind the onboarding funnel
// and the retention cohorts.
//
// ── Why this module exists at all, against the core's own advice ────────────
// `lib/onboarding/rules.ts` says there is no `onboarding_steps` table, no
// `dismissedAt` and no cookie, "and none of them is missing", and
// `docs/onboarding.md` §12 argues against an events table. Both are right about
// the CORE: a checklist tick derived from state cannot go stale, and an app
// that ships analytics it does not need has bought a liability.
//
// This is the other question. §12 itself asks the operator to "measure before
// and after an onboarding change, on the same window" — and a state query
// cannot do that, because the "before" is gone the moment the change lands.
// Optimising needs history; reading today's state does not produce any. So the
// history lives here, in a module somebody installs on purpose, rather than in
// the core everybody gets.
//
// ── Two tables, and only one of them is about people ───────────────────────
// `metrics_events` is personal data — it says what a named member did and when.
// `metrics_daily` is the same thing counted: no member column, no way back to a
// person. The rollup job fills the second from the first, which is what lets
// the events be pruned on a retention window while the before/after curve
// survives for good.
//
// ── Why `set null` and not `cascade` ───────────────────────────────────────
// The opposite of `activity_results`, on purpose. That table holds a learner's
// own work — their answers, their resume point — which is theirs and goes when
// they do. A row here is the APP's record of its own performance: that eleven
// people reached step two in March is a fact about the product, not about any
// of the eleven. So the person is removed and the count stays, the way `orders`
// keeps a financial record with a null member.
//
// ── Why the text columns are NOT NULL with an empty default ────────────────
// `experiment` and `variant` are half of the unique index on `metrics_daily`,
// and Postgres treats NULLs as distinct — a nullable column there would void
// the idempotency key and let every rollup insert a second row instead of
// updating the first. That is the migration-0011 trap recorded on
// `grants_purchase_product` and again on `activity_results.subject`. They are
// NOT NULL here too so that one shape reads the same in both tables.
//
// ── Why `event` is text and not an enum ────────────────────────────────────
// Same reason `ai_usage.task` is text: a new milestone must be one line in the
// app's own config, never a migration. The closed list lives in
// `modules/metrics/config.json`, where the app's agent writes it.
import { pgTable, text, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";

import { users } from "@/db/schema-core";

export const metricsEvents = pgTable(
  "metrics_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Nullable and `set null` — see the header. `module.ts` also nulls it
    // explicitly during an erasure rather than relying on the delete order.
    memberId: text("member_id").references(() => users.id, { onDelete: "set null" }),
    // A milestone key from `modules/metrics/config.json`. Never free text somebody
    // typed, and never anything a customer wrote — this column is read back
    // into a heading.
    event: text("event").notNull(),
    // Which split test was running when this happened, and which side this
    // member was on. Empty string means "no experiment", never NULL — see the
    // header.
    experiment: text("experiment").notNull().default(""),
    variant: text("variant").notNull().default(""),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  },
  (t) => [
    // The range scan every report starts with, and the one the prune job needs
    // — `pruneInBatches` wants an index that BEGINS with the cutoff column.
    index("metrics_events_occurred").on(t.occurredAt),
    // "Which members reached this, and when did each first do it" — the funnel
    // and the cohorts both walk this one.
    index("metrics_events_event_occurred").on(t.event, t.occurredAt),
    // The export and the erasure path: every row of one member.
    index("metrics_events_member").on(t.memberId),
  ],
);

export const metricsDaily = pgTable(
  "metrics_daily",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // "YYYY-MM-DD" as TEXT, deliberately, and the boundary is **UTC** — see
    // `lib/rollup.ts` for why it may never become a setting. A string is what
    // `to_char(date_trunc(…))` already returns, so storing a date would mean
    // casting back and forth and inviting the `sql<Date>` claim
    // `db/sql-cast.test.ts` refuses.
    day: text("day").notNull(),
    event: text("event").notNull(),
    experiment: text("experiment").notNull().default(""),
    variant: text("variant").notNull().default(""),
    // Distinct members, and raw occurrences. The funnel reads `members`; the
    // second is kept because a wide gap between them says an event fires more
    // often than anybody intended.
    members: integer("members").notNull().default(0),
    events: integer("events").notNull().default(0),
    computedAt: timestamp("computed_at").notNull().defaultNow(),
  },
  (t) => [
    // What makes the rollup safe to run twice: the job upserts on this, so a
    // re-run recomputes a day instead of doubling it. All four columns are NOT
    // NULL for the reason in the header.
    uniqueIndex("metrics_daily_day_event_variant").on(t.day, t.event, t.experiment, t.variant),
    index("metrics_daily_event_day").on(t.event, t.day),
  ],
);
