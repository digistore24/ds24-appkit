#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Delete what the community has aged out: private messages past the operator's
// retention window, moderation-trail rows past theirs, and spam reports that
// have been dealt with.
//
// 🚨 **An UNHANDLED spam report is never deleted, at any age.** It is part of
// the derivation of the automatic send-block (AD-64) — there is no send-block
// table — so pruning one would silently lift a block nobody decided to lift.
//
// ── The shipped default does nothing, and that is the decision ────────────
// `config/community.json` → `dmRetentionMonths` ships as `0`, which means
// "keep until the account that wrote them is deleted". Private correspondence
// is not a diagnostic log: nobody writes to another member expecting the app to
// bin it in ninety days, so time-based deletion is an operator POLICY rather
// than a template default. With `0` this command reports that retention is off
// and touches nothing.
//
// ── Bulk by age, never selective — and that is a privacy property ─────────
// There is deliberately no `--conversation`, no `--member` and no way to
// preview WHAT is being deleted. Choosing which conversation to delete means
// knowing what is in it, and an operator tool that reads private messages to
// decide is read access by another name — exactly what the module promises
// does not exist (FR-200, and `lib/community/dm-guard.test.ts` is what keeps
// it true in the app). Age is the one selector that needs no look inside.
//
// So this script's numbers are counts and dates. It never prints a message, an
// author, a member id or a conversation id.
//
// ── Why it exists although the default never runs it ──────────────────────
// The `ai_usage` lesson, recorded in NFR-41: the documented half rots and the
// command half works. An operator who decides on a retention window a year
// from now finds a command that has been in the tree — and in the tests —
// since the tables were created, rather than a sentence in a document
// promising one.
//
// ── The moderation trail has its OWN window, and it is a year ─────────────
// The trail answers "who exercised power over whose content, and why". A year
// is the same window `ai_usage` and the impersonation records get, and for the
// same reason: it is long enough for somebody to ask about something that
// happened last season, and short enough that a moderator's free text about a
// member does not sit in the database for ever. It is a `--days` away from
// being shorter.
//
// ⚠️ **Unlike the message window, this one is NOT off by default.** A trail
// nobody prunes grows without bound and holds text written about people; a
// private conversation is the member's own and is kept while their account is.
// The two defaults point in opposite directions on purpose.
//
// Usage:
//   node scripts/community/prune.mjs               # dry run: count, delete nothing
//   node scripts/community/prune.mjs --apply       # delete
//   node scripts/community/prune.mjs --months 12   # override the message window
//   node scripts/community/prune.mjs --days 180    # override the trail window
//   Via the runner:  node run.mjs community-prune
//
// Dry run by DEFAULT and `--apply` writes — the house model
// (`scripts/users/create-user.mjs`), and the right way round for a command
// whose mistake is unrecoverable.
// ⚠️ Three levels up, not two: this file used to be `scripts/community/prune.mjs`
// and its relative paths were correct there. The move into the module left both
// pointing at folders that do not exist — `node run.mjs community-prune` died
// with ERR_MODULE_NOT_FOUND before its first line, and nothing said so, because
// nothing imports a command. `scripts/imports.test.ts` walks this tree now.
import "../../../scripts/lib/env.mjs";
import postgres from "postgres";

import config from "../../../config/community.json" with { type: "json" };

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const monthsArg = argv.indexOf("--months");
const daysArg = argv.indexOf("--days");

/**
 * How long a moderation-trail row is kept. See the header for the year.
 *
 * Read defensively rather than with a bare `Number()`: `Number(undefined)` is
 * `NaN` and `Number(null)` is `0`, and zero days of retention here would mean
 * deleting the whole trail — the `configuredNumber()` trap, one file over.
 */
const AUDIT_RETENTION_DAYS = 365;
const auditDays =
  daysArg >= 0 ? Number(argv[daysArg + 1]) : AUDIT_RETENTION_DAYS;

if (!Number.isFinite(auditDays) || auditDays < 0) {
  console.error("ERROR: --days must be a non-negative whole number of days.");
  process.exit(2);
}

/**
 * The window, from the flag or from the config.
 *
 * The flag is for an operator running a one-off sweep at a different depth; it
 * does not change the file, deliberately — a retention policy that lives in a
 * shell history is not a policy.
 */
const configured =
  monthsArg >= 0 ? Number(argv[monthsArg + 1]) : config.dmRetentionMonths;

const months = Number.isInteger(configured) && configured >= 0 ? configured : 0;

if (monthsArg >= 0 && !Number.isInteger(Number(argv[monthsArg + 1]))) {
  console.error("ERROR: --months must be a whole number of months (0 = off).");
  process.exit(2);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("ERROR: DATABASE_URL is not set (see .env).");
  process.exit(2);
}

// Calendar months, not `n * 30 * 86_400_000`. Month lengths differ and the
// difference is a day and a half a year — small, and this is a deletion, so it
// is computed in the database's own calendar arithmetic instead of guessed in
// JavaScript. The house rule about `startToday - n × 86_400_000` is the same
// rule one unit up.
const sql = postgres(url, { max: 1 });

try {
  // ── The private messages ──────────────────────────────────────────────────
  if (months === 0) {
    console.log(
      "Private messages: retention is off (dmRetentionMonths: 0) — they are kept\n" +
        "  until the account that wrote them is deleted. Nothing to prune.\n" +
        "  Set a window in config/community.json, or pass --months <n> for a one-off.",
    );
  } else {
    const cutoffRows = await sql`
      select (now() - (${months} || ' months')::interval) as cutoff`;
    const cutoff = cutoffRows[0].cutoff;
    const day = new Date(cutoff).toISOString().slice(0, 10);

    if (!apply) {
      const [row] = await sql`
        select count(*)::int as rows
        from community_messages
        where created_at < ${cutoff}`;
      console.log(
        `Private messages: ${row.rows} older than ${months} month(s) would go ` +
          `(before ${day}).`,
      );
    } else {
      // ⚠️ The MESSAGES go, the conversation rows stay. A conversation with no
      // messages left is a tombstone that costs one row and keeps the
      // structure both participants can still see — and `listConversations()`
      // already leaves an empty conversation out of every inbox, so nobody is
      // shown an empty shell.
      const deleted = await sql`
        delete from community_messages
        where created_at < ${cutoff}
        returning id`;
      console.log(
        `✓ ${deleted.length} private message(s) older than ${months} month(s) deleted.`,
      );
    }
  }

  // ── The moderation trail ──────────────────────────────────────────────────
  const auditCutoffRows = await sql`
    select (now() - (${auditDays} || ' days')::interval) as cutoff`;
  const auditCutoff = auditCutoffRows[0].cutoff;
  const auditDay = new Date(auditCutoff).toISOString().slice(0, 10);

  // ── Consumed spam reports ─────────────────────────────────────────────────
  //
  // 🚨 **An UNCONSUMED report is never pruned, at any age.** Those rows are
  // the derivation set of the automatic send-block (AD-64) — there is no
  // send-block table, the block IS "how many unconsumed reports against this
  // member are recent" — so deleting one here would silently lift a block
  // nobody decided to lift. The `consumed_at is not null` clause is that rule,
  // and it is in the WHERE rather than in a comment.
  //
  // A CONSUMED report has been looked at: it is a record that somebody
  // reported something and it was dealt with, and it ages out on the same
  // window as the trail for the same reason (it holds a member's free text
  // about another member).
  if (!apply) {
    const [row] = await sql`
      select count(*)::int as rows
      from community_spam_reports
      where consumed_at is not null and created_at < ${auditCutoff}`;
    const [open] = await sql`
      select count(*)::int as rows
      from community_spam_reports where consumed_at is null`;
    console.log(
      `Handled reports: ${row.rows} older than ${auditDays} days would go. ` +
        `${open.rows} unhandled report(s) are never pruned — they are what the ` +
        `automatic send-block is derived from.`,
    );
  } else {
    const deleted = await sql`
      delete from community_spam_reports
      where consumed_at is not null and created_at < ${auditCutoff}
      returning id`;
    console.log(
      `✓ ${deleted.length} handled report(s) older than ${auditDays} days deleted.`,
    );
  }


  if (!apply) {
    const [row] = await sql`
      select count(*)::int as rows,
             min(created_at) as oldest, max(created_at) as newest
      from community_moderation_audit
      where created_at < ${auditCutoff}`;
    console.log(
      `Moderation trail: ${row.rows} row(s) older than ${auditDays} days would ` +
        `go (before ${auditDay})` +
        (row.rows > 0
          ? `, written between ${new Date(row.oldest).toISOString().slice(0, 10)} ` +
            `and ${new Date(row.newest).toISOString().slice(0, 10)}.`
          : "."),
    );
    console.log("\nNothing was deleted. Add --apply to do it.");
  } else {
    const deleted = await sql`
      delete from community_moderation_audit
      where created_at < ${auditCutoff}
      returning id`;
    console.log(
      `✓ ${deleted.length} moderation-trail row(s) older than ${auditDays} days deleted.`,
    );
  }
} finally {
  await sql.end();
}
