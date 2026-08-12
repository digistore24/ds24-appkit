// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What the community has aged out, deleted on a schedule.
//
// The same three sweeps `scripts/prune.mjs` performs by hand — private messages
// past the operator's retention window, moderation-trail rows past theirs, and
// spam reports that have been dealt with — as a registered job.
//
// ── 🚨 It ships DISABLED, and that is the whole of the behaviour change ────
// A job with no entry in `config/cron.json` inherits `JOB_DEFAULTS` —
// `enabled: true`, daily — so leaving it out is not "off", it is "on tomorrow".
// The off switch therefore has to be written down, and it CANNOT be written in
// `config/cron.json`: that file belongs to the core, and an entry naming
// `community-prune` there would name a job every app without this module does not
// have — `cronConfigProblems()` reports exactly that, and `lib/cron/rules.test.ts`
// fails the shipped template on it. So the posture is declared where the job is,
// as `enabledByDefault: false` below. An operator turns it on by ADDING
// `"community-prune": { "enabled": true }` to `config/cron.json`; the file wins in
// both directions and only its silence consults the job.
//
// This matters more than it looks. `config/community.json` used to say the prune
// "is never scheduled by anything: an operator who wants it nightly points their
// host's cron at it", and that sentence was retracted deliberately, not
// forgotten: the module now brings a job, and the operator's decision is one
// flag instead of a crontab. What did NOT change is when anything is deleted —
// disabled means the app deletes exactly what it deleted before, which is
// nothing, until somebody turns it on.
//
// ── Why two implementations of one sweep is the house answer ──────────────
// This is the shape `prune-ai-usage` (a job, through Drizzle) and
// `node run.mjs db-prune-ai` (a script, raw SQL) already have. The command and
// the job cannot share the deletion itself: the command is bare Node so an
// operator can run it against any `DATABASE_URL` without a build, and this runs
// inside the app where the schema symbols are. What they DO share is the part
// that decides — the windows, and `configuredNumber` for reading them.
//
// ⚠️ **The two differ in one way an operator has to know: the command is a dry
// run by default and this is not.** A job cannot ask. That asymmetry is the
// reason the entry ships disabled rather than merely undocumented.
//
// ── Why this file may name the DM tables ──────────────────────────────────
// `lib/dm-guard.test.ts` refuses any file outside a short allowlist that so much
// as NAMES `community_messages` or `community_conversations`, and this file is on
// it. The reason is the same one `scripts/prune.mjs` carries, and a cron job
// happens to be the strongest possible form of it: a job's only output is one
// line that lands in `cron_runs.lastDetail`, and that line MUST be numbers —
// `docs/data-protection.md` §11 keeps that table free of any privacy question at
// all. So this file is structurally unable to reveal what it deleted, which is
// exactly the property "bulk by age, never selective" is protecting.
//
// Age is the one selector that needs no look inside. There is no `--conversation`
// here for the same reason there is none there.
import { and, isNotNull, lt } from "drizzle-orm";

import type { CronJob } from "@/lib/cron/types";
import {
  pruneDeadline,
  pruneInBatches,
  STOPPED_EARLY_NOTE,
} from "@/lib/cron/prune";
import { configuredNumber, retentionCutoff } from "@/lib/cron/rules.mjs";

import { communityConfig } from "./lib/config";
import {
  communityMessages,
  communityModerationAudit,
  communitySpamReports,
} from "./schema";

/**
 * How long a moderation-trail row and a handled spam report are kept.
 *
 * The same year `ai_usage` and the impersonation records get, and the same number
 * `scripts/prune.mjs` uses — it is quoted in `docs/data-protection.md`, so it is
 * written down rather than inlined.
 *
 * ⚠️ Unlike the message window this one is NOT off by default: a trail nobody
 * prunes grows without bound and holds text written ABOUT people, while a private
 * conversation is the member's own and is kept as long as their account is. The
 * two defaults point in opposite directions on purpose.
 */
const AUDIT_RETENTION_DAYS = 365;

/**
 * A cutoff N days before the tick's clock.
 *
 * ⚠️ Days are safe as arithmetic where MONTHS are not — a month has no fixed
 * length, which is why the message window goes through `retentionCutoff()` from
 * `lib/cron/rules.mjs` (the core's own helper, calendar months via `setUTCMonth`)
 * rather than being multiplied out here. `scripts/prune.mjs` reaches the same
 * answer with Postgres interval arithmetic; the decision is shared, the statement
 * is not, and that is the same division `prune-ai-usage` has with
 * `db-prune-ai`.
 *
 * A `sql<Date>` expression would have been the other way to write this and is
 * forbidden: `db/sql-cast.test.ts` fails on it, because a raw expression is handed
 * back exactly as the driver returned it and a Date-typed one is a string wearing
 * a Date's clothes.
 */
const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

const jobs: readonly CronJob[] = [
  {
    id: "community-prune",
    describe:
      "Delete what the community has aged out: private messages past the retention " +
      "window (off by default), moderation-trail rows and handled spam reports past a year. " +
      "Ships DISABLED — set \"enabled\": true for it in config/cron.json.",

    // 🚨 The one thing in this file that is not about deletion, and the reason
    // the whole change is behaviour-neutral. Omitting a `config/cron.json` entry
    // does NOT mean off — a job with no entry inherits enabled-and-daily — and a
    // module cannot ship an entry in that file, because the core's config would
    // then name a job every app without this module does not have. So the posture
    // is declared here. An operator turns it on with one flag; until they do, the
    // app deletes exactly what it deleted before this job existed, which is
    // nothing.
    enabledByDefault: false,
    async run({ now, settings }) {
      // The trail window may be overridden per job in `config/cron.json`, read
      // with `configuredNumber` and never `Number()`: `Number(null)` is 0, and
      // zero days of retention here means deleting the whole trail.
      const configuredDays = configuredNumber(settings.retentionDays);
      const auditDays =
        configuredDays !== null && configuredDays >= 0
          ? Math.floor(configuredDays)
          : AUDIT_RETENTION_DAYS;

      // 🚨 The message window comes from the MODULE's own config, not from this
      // job's settings. It is a privacy policy about members' correspondence, and
      // it belongs in the file the operator already sets the community up in —
      // one window, one place, whichever way the sweep is triggered.
      // `communityConfig()` resolves an unreadable file to 0, which is OFF here.
      const months = communityConfig().dmRetentionMonths;

      // 🚨 ONE deadline for the whole job, not one per sweep. Three independent
      // one-minute budgets would be three minutes of held locks under a
      // one-minute name — and the number that matters is the job's, because the
      // stale-lock window belongs to the job.
      const deadline = pruneDeadline();
      let stoppedEarly = false;

      let messages = 0;
      if (months > 0) {
        const cutoff = retentionCutoff(months, now);
        // `retentionCutoff` returns null only for a value that got past
        // `communityConfig()`, which cannot happen — but a null here would delete
        // every message in the app, so it refuses rather than trusting the chain.
        // The same guard `prune-ai-usage` puts in front of its own cutoff.
        if (!cutoff) throw new Error(`invalid dmRetentionMonths: ${months}`);
        // 🚨 Batched, and this is the sweep the batching exists for. It is the
        // only one whose size is set by MEMBERS rather than by moderators, its
        // window ships OFF so it accumulates from day one, and an operator only
        // ever turns it on once there is something to delete — so the first run
        // is the big one, by construction. Measured: 65,050 rows, one pass
        // returned 10,000 with `stoppedEarly`, where the single DELETE this
        // replaced would have taken all of them in one transaction.
        // `community_messages_created` is the index behind the DAILY run
        // afterwards — see the comment on it in `schema.ts`.
        const swept = await pruneInBatches(
          {
            table: communityMessages,
            id: communityMessages.id,
            olderThan: communityMessages.createdAt,
          },
          cutoff,
          deadline,
        );
        messages = swept.deleted;
        stoppedEarly ||= swept.stoppedEarly;
      }
      // ⚠️ The MESSAGES go, the conversation rows stay — a conversation with no
      // messages left is a tombstone that costs one row and keeps the structure
      // both participants can still see. `listConversations()` already leaves an
      // empty one out of every inbox, so nobody is shown a shell.

      // 🚨 An UNHANDLED report is never deleted, at any age. Those rows ARE the
      // derivation of the automatic send-block — there is no send-block table —
      // so pruning one would silently lift a block nobody decided to lift. The
      // `isNotNull` is that rule, and it is in the WHERE rather than in a comment.
      const reports = await pruneInBatches(
        {
          table: communitySpamReports,
          id: communitySpamReports.id,
          olderThan: communitySpamReports.createdAt,
          // The `isNotNull` goes INTO the sweep rather than around it — a
          // predicate applied after the delete is a predicate applied to rows
          // that are already gone.
          also: isNotNull(communitySpamReports.consumedAt),
        },
        daysAgo(now, auditDays),
        deadline,
      );
      stoppedEarly ||= reports.stoppedEarly;

      // ⚠️ Deleting only — never an UPDATE. `community_moderation_audit` is
      // append-only with exactly ONE permitted UPDATE in the whole app (the
      // account-deletion scrub), and `moderation-guard.test.ts` fails the build
      // on a second. The batching helper deletes and counts what it deleted; a
      // helper that marked rows first would break that rule from inside a
      // shared file.
      const trail = await pruneInBatches(
        {
          table: communityModerationAudit,
          id: communityModerationAudit.id,
          olderThan: communityModerationAudit.createdAt,
        },
        daysAgo(now, auditDays),
        deadline,
      );
      stoppedEarly ||= trail.stoppedEarly;

      // Numbers only, and it says which window each count belongs to — an
      // operator reading `cron_runs.lastDetail` has to be able to tell "nothing
      // to do" from "retention is off". No id, no address, no text anybody wrote.
      return (
        `${messages} message(s) ` +
        (months > 0 ? `older than ${months} month(s)` : "(retention off)") +
        `, ${reports.deleted} handled report(s) and ${trail.deleted} trail row(s) ` +
        `older than ${auditDays} day(s) deleted` +
        // Never silently partial — the same sentence `prune-ai-usage` uses, from
        // the same constant, because an operator who learns to recognise it in
        // one job's line has to recognise it in every job's.
        (stoppedEarly ? STOPPED_EARLY_NOTE : "")
      );
    },
  },
];

export default jobs;
