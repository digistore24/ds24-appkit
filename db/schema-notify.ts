// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// One row per thing this app has already told its operator about.
//
// ── Why the table exists ──────────────────────────────────────────────────
// Cron rule 1 says a job must be safe to run twice, and adds the one sentence
// that has no mechanism behind it: "sending a mail is not, unless the job
// records that it sent one" (`lib/cron/jobs.ts`, `docs/cron.md`). This is where
// that record lives, once, so the second job to need it does not invent a
// second answer.
//
// It could not be `cron_runs`: that table is one row per JOB, updated in place,
// and what has to be remembered here is one row per MESSAGE.
//
// ── What is NOT in it, and why that is the whole design ───────────────────
// No recipient. No address. No member id. No free text. No count. Two columns,
// and the second one is a clock.
//
// That is the same promise `cron_runs` makes (`db/schema-cron.ts`), made for the
// same reason and paid for the same way: a table with nothing personal in it
// raises no data-protection question, appears in neither subject-access export,
// needs no retention window and no pruning job. The key is a job's own label for
// a piece of work — `courses-digest:2026-08-09` — and `claimSend()` refuses one
// that could be anything else (`lib/notify/sent-once.ts`).
//
// `docs/data-protection.md` §11a records this as a claim rather than an
// accident, which is what makes it something a later change has to argue with.
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const notificationSends = pgTable("notification_sends", {
  // The caller's own name for the message. Primary key, because the whole
  // mechanism is "the second insert loses" — see `claimSend()`.
  //
  // 🚨 Deliberately NO partial unique index beside it. The primary key is
  // enough, and a partial one would have to be hand-written into the migration:
  // Drizzle emits a qualified `WHERE`, Postgres refuses it, and `db-migrate`
  // reports success anyway (`db/schema-tokens.ts` carries that post-mortem).
  key: text("key").primaryKey(),

  // When it was claimed. Here so that a human reading the table can tell a
  // yesterday's digest from a three-year-old one — not read by any code, and not
  // a retention window: the row count is bounded by (jobs × windows), which is
  // 365 rows a year for a daily digest.
  //
  // ⚠️ That bound is a RULE, not a mechanism. The grammar refuses an address and
  // a sentence — a UUID passes it, and a member id shaped like one passes with
  // it (`lib/notify/sent-once.ts` says so at length, and
  // `docs/data-protection.md` §11a repeats it). So the day a key names a person
  // is the day both this bound and the promise above it stop holding, and
  // nothing in the machine will announce it.
  claimedAt: timestamp("claimed_at").notNull().defaultNow(),
});
