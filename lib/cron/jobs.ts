// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The registry of scheduled jobs. Adding one is adding an entry here.
//
// ── Why jobs are TypeScript and run INSIDE the app ────────────────────────
// The scheduling rules are `.mjs` (`rules.mjs`) so the check command can print
// a schedule without a database. The job BODIES are not, and deliberately: the
// second job anybody writes needs `lib/email.ts`, or `hasPlan()`, or the token
// ledger. A registry that could only run raw SQL would be a registry nobody
// could use for the thing they actually wanted.
//
// So a job runs where the app runs, and `node run.mjs cron` asks the running
// app to run one rather than reimplementing it. There is exactly one copy of
// every job, and triggering it by hand exercises the same path the scheduler
// takes — which is the only way a manual test proves anything.
//
// ── The four rules for a job ──────────────────────────────────────────────
//
//  1. **It must be safe to run twice.** The scheduler tries hard not to, and a
//     redeploy at the wrong moment, a stale lock or an Operator pressing the
//     button will still get you a second run. Deleting rows older than a
//     cutoff is idempotent; sending a mail is not, unless the job records that
//     it sent one.
//  2. **It returns one line of NUMBERS.** That line is stored in `cron_runs`
//     and read by whoever asks whether the job is working. No address, no
//     member id, no text anybody typed — `cron_runs` must stay a table with no
//     privacy question attached (`docs/data-protection.md` §11).
//  3. **It throws on failure.** The runner records the outcome and the next
//     tick tries again. Swallowing an error makes a broken job look like a
//     healthy one, which is the failure mode this whole mechanism exists to
//     make visible.
//  4. **It finishes in well under an hour.** That is the stale-lock window
//     (`rules.mjs`), and a job still running when its lock goes stale can be
//     started a second time beside itself.
import { aiUsage } from "@/db/schema";
import { pruneIpnEvents, IPN_LOG_RETENTION_DAYS } from "@/lib/digistore/ipn-log";

import { pruneDeadline, pruneInBatches, STOPPED_EARLY_NOTE } from "./prune";
import { configuredNumber, retentionCutoff } from "./rules.mjs";
import { JOB_IDS } from "./ids.mjs";
import { MODULE_CRON_JOBS } from "@/lib/modules/cron-registry";
import type { CronJob } from "./types";

// The shape lives in `./types` so a module's `cron.ts` can import it without
// closing a cycle through this file — see that file's header. Re-exported here,
// because this is where every existing caller looks for it.
export type { CronContext, CronJob } from "./types";

/** How long AI-usage rows are kept when the config says nothing. */
export const AI_USAGE_RETENTION_MONTHS = 12;

/**
 * How long the record of who signed in as whom is kept when the config says
 * nothing. The same twelve months, and for the same reason it is written down
 * rather than inlined: it is the number `docs/data-protection.md` quotes.
 */
export const IMPERSONATION_RETENTION_MONTHS = 12;

/**
 * How long the record of what the setup surface did is kept.
 *
 * ⚠️ **Twenty-four, where everything else here keeps twelve, and the difference
 * is the argument.** This is the only record of writes made to a production
 * database by an AGENT — no session, no browser, nobody watching. The questions
 * it answers arrive late: a billing dispute about an entitlement somebody was
 * given by hand, an audit, a customer asking who created their account. A year
 * is inside the window in which those still turn up; the trail should outlast
 * it rather than end just before.
 *
 * It is the number `docs/data-protection.md` quotes, which is why it is a
 * constant rather than an inline literal.
 */
export const SETUP_AUDIT_RETENTION_MONTHS = 24;

// Both go through `configuredNumber`, NOT `Number()`. `Number(null)` is 0, and
// zero retention means delete everything — see the warning in rules.mjs.
function months(settings: Record<string, unknown>, fallback: number): number {
  const raw = configuredNumber(settings.retentionMonths);
  return raw !== null && raw >= 0 ? Math.floor(raw) : fallback;
}

function days(settings: Record<string, unknown>, fallback: number): number {
  const raw = configuredNumber(settings.retentionDays);
  return raw !== null && raw >= 0 ? Math.floor(raw) : fallback;
}

// The batching helper used to live here, while `prune-ai-usage` was its only
// caller. It is `lib/cron/prune.ts` now — a MODULE's job needs it too, and a
// module importing THIS file would close a circle (jobs.ts → the generated cron
// registry → the module's cron.ts → jobs.ts). Its header carries the four things
// a sweep has to get right, including the one that is the caller's: an index that
// serves "older than X" on its own.

/**
 * The core's own jobs. Every app has these.
 *
 * The registry the app actually runs on is `CRON_JOBS` below — this plus every
 * installed module's. Kept as a named constant rather than spread inline so the
 * boundary is readable: what is below this line ships to everybody, what is
 * appended after it depends on `config/modules.json`.
 */
const CORE_JOBS: readonly CronJob[] = Object.freeze([
  {
    id: "prune-ai-usage",
    describe: "Delete AI-usage rows older than the retention window (default 12 months).",
    async run({ now, settings }) {
      const retentionMonths = months(settings, AI_USAGE_RETENTION_MONTHS);
      const cutoff = retentionCutoff(retentionMonths, now);
      // `retentionCutoff` returns null only for a value that got past
      // `months()`, which cannot happen — but a null here would delete the
      // whole table, so it refuses rather than trusting the chain.
      if (!cutoff) throw new Error(`invalid retentionMonths: ${settings.retentionMonths}`);

      // ⚠️ This deletes COST HISTORY. The AI-costs page can only report what is
      // in this table, so a pruned period reads as zero rather than as unknown.
      // That is the trade the retention window is: a year of "what did AI cost
      // me last November", and no more. `docs/ai-providers.md` says so where
      // the Operator sets the number.
      const { deleted, stoppedEarly } = await pruneInBatches(
        { table: aiUsage, id: aiUsage.id, olderThan: aiUsage.createdAt },
        cutoff,
      );

      return (
        `${deleted} row(s) older than ${retentionMonths} month(s) deleted` +
        // Never silently partial. A run that stopped at its budget looks
        // identical to one that finished, and an Operator reading "10,000
        // deleted" every day for a week would have no way to tell that it is
        // not keeping up.
        (stoppedEarly ? STOPPED_EARLY_NOTE : "")
      );
    },
  },
  {
    id: "prune-ipn-log",
    describe: "Delete IPN-log rows older than the retention window (default 60 days).",
    async run({ now, settings }) {
      const retentionDays = days(settings, IPN_LOG_RETENTION_DAYS);
      const deleted = await pruneIpnEvents(now, retentionDays);
      return `${deleted} row(s) older than ${retentionDays} day(s) deleted`;
    },
  },
  {
    id: "close-impersonations",
    describe: "Close impersonation records whose 30 minutes ran out and that nobody ended.",
    // The one ending no request can observe. Stepping out, signing out and
    // noticing the expiry on a live request all have a moment to write the end
    // — closing the tab does not. Nothing ever comes back to that session, so
    // without this job those rows stay open for ever and the record becomes
    // unreadable within a week: a finished session and a running one look
    // identical.
    //
    // Idempotent by construction — the UPDATE excludes rows that already have
    // an end, so a second run finds nothing. That is rule 1 for a job here, and
    // this one satisfies it without needing to remember anything.
    async run() {
      const { closeAbandonedImpersonations } = await import(
        "@/lib/impersonation/manage"
      );
      const closed = await closeAbandonedImpersonations();
      // Numbers only (rule 2). Naming the member or the Operator here would put
      // "who was in whose account" into `cron_runs`, which is a table with no
      // privacy question attached and must stay one. The record itself is where
      // that belongs, and it is covered by data-protection.
      return `${closed} abandoned session(s) closed`;
    },
  },
  {
    id: "check-stuck-reloads",
    describe:
      "Count accounts whose auto top-up stopped charging because no credit came back.",
    // ── The only job here that fixes nothing ────────────────────────────────
    // It writes nothing and repairs nothing. It exists because the state it
    // reports is invisible from every other angle: the charges SUCCEEDED, no
    // exception was thrown, and the Member's own switch still reads "on".
    // There is no error anywhere to find.
    //
    // And it cannot be left to the spend path to notice. A Member whose
    // balance is stuck at zero stops using the app, so `spendTokens()` — the
    // only thing that ever calls `autoReloadIfNeeded()` — is never called
    // again. The account that most needs reporting is the one nobody touches.
    //
    // Every hour, because this is money already taken from somebody's card and
    // a day of silence is a day too many. It is one indexed count.
    async run() {
      const { countPausedReloads } = await import("@/lib/tokens/account");
      const paused = await countPausedReloads();
      // Numbers only (rule 2) — naming the Member here would put a customer's
      // billing trouble into `cron_runs`, which is a table with no privacy
      // question attached and must stay one. Who it is belongs on the
      // Operator's member page, which is already behind requireOwner().
      return paused === 0
        ? "no account is waiting on an unconfirmed top-up"
        : `${paused} account(s) stopped charging — top-up billed, no credit booked`;
    },
  },
  {
    id: "check-advisories",
    describe:
      "Ask the advisory databases about the versions this app resolved, and record the answer.",
    // ── The second job here that fixes nothing, and the first that MEASURES ──
    // It writes nothing to the database, repairs nothing, and mails NOBODY. It
    // asks the advisory rungs of the shipped security ladder and writes the
    // answer into `.dev/security-check.json` — the record
    // `node run.mjs security-check` already writes and the session greeting
    // already reads.
    //
    // It exists because an advisory published on a Saturday is otherwise found
    // on Monday by whoever happened to run a command. Nothing about that state
    // looks like a fault from inside the app: nothing throws, no page breaks,
    // and the only thing that changed is a database on somebody else's server.
    // `check-stuck-reloads` above is its sibling in shape — measure, report a
    // count, change nothing.
    //
    // 🚨 **It does not mail, and that is NFR-67 rather than an omission.**
    // Reporting on the operator-mail channel belongs to the watchdog job alone.
    // Two jobs racing for one `claimSend()` window would have one swallow the
    // other's finding — a claimed key is spent for ever — and two keys would put
    // two mails on one operator's morning. One producer per channel.
    //
    // 🚨 **The record it writes is always `complete: false`**, because it asks
    // two of the ladder's rungs and marks every other one as not asked. That is
    // the honest shape and the readers are built for it; the line below always
    // says how many rungs were not asked, so "nothing found" and "nobody asked"
    // can never look the same.
    async run({ now, settings }) {
      const { DEFAULT_BUDGET_MS, detailLine, measureAdvisories } = await import(
        "@/lib/cron/security-record"
      );
      // A number a person may edit, so `configuredNumber()` and never `Number()`
      // — `Number(null)` is 0, and a zero budget here would abandon every rung
      // before it started and report a run in which nothing was measured.
      const seconds = configuredNumber(settings.budgetSeconds);
      const budgetMs =
        seconds !== null && seconds >= 1 ? Math.floor(seconds) * 1000 : DEFAULT_BUDGET_MS;

      // `now` comes from the context, never `new Date()` — it is the clock the
      // whole tick reasons about, and it is what makes this testable.
      const record = await measureAdvisories({ now, budgetMs });
      // Numbers only (rule 2), and no rung's skip reason: those carry upstream
      // text, and `cron_runs` is a table with no privacy question attached.
      return detailLine(record);
    },
  },
  {
    id: "ops-watchdog",
    describe:
      "Mail the operator once when something has quietly stopped working — the security " +
      "record, failing or stalled jobs, the media store, a payment webhook gone silent. " +
      "One mail naming all of them, counts only, nobody named.",

    // ── 🚨 `enabledByDefault: false`, beside `"enabled": true` in the config ──
    // The pairing is deliberate and both halves are load-bearing. The registry
    // says OFF so that an operator who DELETES the entry does not start getting
    // mail by inheritance — a job with no entry inherits `JOB_DEFAULTS`, which
    // is enabled and daily, and 1440 against a UTC-day window is the skip-a-day
    // drift `docs/cron.md` warns about by name. `config/cron.json` then says
    // `{"enabled": true, "everyMinutes": 360}`, which is the decision somebody
    // wrote down.
    //
    // ⚠️ And that pairing is what keeps `config/notifications.json`'s own
    // argument true: the channel ships ON *because* every sender through it
    // ships OFF, and two off states in series make a channel nobody finds. Read
    // that file's `_comment` before changing either half.
    enabledByDefault: false,

    // ── Three sentences that are not decoration ─────────────────────────────
    //  1. **The standing-queue trade holds here** (`lib/notify/sent-once.ts`).
    //     The claim stands before the first delivery, so a transport that then
    //     fails loses that window's message — deliberately, because a lost
    //     message is visible (this job throws) and self-healing. Self-healing is
    //     only true of a job repeating a STANDING queue, and this is one: every
    //     run re-reads the same four conditions.
    //  2. **A process killed BETWEEN the claim and the delivery** — a redeploy,
    //     an OOM kill — never reaches `finish()` in `lib/cron/run.ts`. The claim
    //     row is committed, `cron_runs` keeps the previous detail, and that
    //     message is gone with nothing saying so. Unfixable from here.
    //  3. 🚨 **A mail the provider ACCEPTED and never delivered is invisible
    //     from here.** `sendOperatorMail()` throwing is the only delivery signal
    //     this app has; knowing that a message ARRIVED is a monitoring
    //     provider's job and this job does not pretend otherwise.
    //
    // 🚨 It READS Story 31.4's record and never runs `security-check` — no
    // spawn, no `capture()`, no dynamic import of the ladder. A scheduled job
    // inside a customer's app shelling out to npm would put the network and half
    // a minute of registry traffic on the request-serving process, and would
    // make a command deliberately in no gate into the thing an app's health
    // depends on.
    //
    // The body is `lib/ops/watchdog.ts` (dynamically, because that file reaches
    // `lib/cron/run.ts` and a static import would close a circle through this
    // file). Its four numbered steps are: read the facts and judge them; return
    // the "nothing open" line BEFORE touching the channel when nothing is open;
    // one `notifyOperators()` call naming every finding worst-first; then one
    // line of numbers with the three states told apart.
    async run({ now }) {
      const { runWatchdog } = await import("@/lib/ops/watchdog");
      // `now` is the tick's clock throughout — never `new Date()` in a job.
      return runWatchdog({ now });
    },
  },
  {
    id: "prune-abandoned-uploads",
    describe: "Remove direct-to-bucket uploads that were promised, never arrived, and expired.",
    // ── The fourth requirement of the direct upload path ────────────────────
    // `docs/visuals.md` names it: "a sweep for uploads that were started and
    // abandoned". A ticket is minted, the browser gets an address, and then the
    // tab is closed — or the write half-lands. Nothing else ever looks at that
    // object again: it has no `media` row, so no page renders it, no export
    // lists it, and account deletion does not reach it. Without this job it is
    // storage nobody is billed for understanding.
    //
    // Idempotent because the work is "remove what is past its expiry": a second
    // run finds what the first could not remove and nothing else. It writes no
    // marker and needs none (rule 1).
    async run({ now }) {
      const { pruneAbandonedUploads } = await import("@/lib/media/manage");
      const { removed, failed, stoppedEarly } = await pruneAbandonedUploads(
        now,
        pruneDeadline(),
      );
      // Numbers only (rule 2). A storage key carries the media id and the
      // uploader's file extension, and `cron_runs` is a table with no privacy
      // question attached — it stays one.
      return (
        `${removed} abandoned upload(s) removed` +
        (failed > 0 ? `, ${failed} could not be removed and stay for the next run` : "") +
        (stoppedEarly ? STOPPED_EARLY_NOTE : "")
      );
    },
  },
  {
    id: "prune-impersonations",
    describe: "Delete impersonation records older than the retention window (default 12 months).",
    async run({ settings }) {
      const retentionMonths = months(settings, IMPERSONATION_RETENTION_MONTHS);
      // ⚠️ This deletes the answer to "did somebody go into my account last
      // spring". Twelve months matches what this template already keeps AI
      // usage for; a shorter window weakens a member's own subject access
      // request, and that is the trade being made here rather than a default
      // nobody thought about.
      const { pruneImpersonations } = await import("@/lib/impersonation/manage");
      const deleted = await pruneImpersonations(retentionMonths);
      return `${deleted} row(s) older than ${retentionMonths} month(s) deleted`;
    },
  },
  {
    id: "prune-setup-audit",
    describe:
      "Delete setup-surface records older than the retention window (default 24 months), and every spent confirmation.",
    async run({ now, settings }) {
      const retentionMonths = months(settings, SETUP_AUDIT_RETENTION_MONTHS);
      // ⚠️ This deletes the answer to "what did an agent do to production last
      // year". The floor lives in `pruneSetupAudit()` and it THROWS below one
      // month rather than obeying: `retentionMonths: 0` is not a retention
      // setting, it is switching the control off while leaving something that
      // looks like a policy in the config. Whoever wants to keep everything
      // disables this job.
      const { pruneSetupAudit } = await import("@/lib/setup/manage");
      const { acts, confirmations } = await pruneSetupAudit(retentionMonths, now);
      // Numbers only — the line lands in `cron_runs.lastDetail`, which somebody
      // reads to find out whether the job works. No tool name, no target, no
      // member.
      return (
        `${acts} act(s) older than ${retentionMonths} month(s) deleted, ` +
        `${confirmations} spent/expired confirmation(s) cleared`
      );
    },
  },
]);

/**
 * Every job this app runs — the core's, then every installed module's.
 *
 * ⚠️ **A module's jobs are appended, never merged in by name.** `loadModules()`
 * refuses two modules claiming one job id and `manifest.mjs` requires a module's
 * ids to start with its own, so a module cannot shadow `prune-ai-usage` or
 * anything else the core runs. `lib/cron/rules.test.ts` asserts this list and
 * `JOB_IDS` agree, in both directions, for whatever is installed.
 *
 * The module half is generated: `lib/modules/cron-registry.ts`, from the `cron`
 * field of each installed manifest. In a fresh app it is empty and this is
 * exactly `CORE_JOBS`.
 */
export const CRON_JOBS: readonly CronJob[] = Object.freeze([
  ...CORE_JOBS,
  ...MODULE_CRON_JOBS,
]);

export function jobById(id: string): CronJob | undefined {
  return CRON_JOBS.find((job) => job.id === id);
}

// Re-exported so a caller that already has the registry does not need two
// imports. `rules.test.ts` asserts the two lists agree.
export { JOB_IDS };
