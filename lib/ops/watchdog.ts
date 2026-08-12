// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The one place this app mails an OPERATIONAL report — `ops-watchdog`.
//
// Silence and health look identical from an inbox. This job's whole purpose is
// to make them different: it reads four operational facts every six hours, and
// when any of them is open it sends **one** mail naming all of them, worst
// first. When nothing is open it sends nothing at all — and says so in a line of
// numbers that also says how many of the four could not be looked at, because
// *"nothing open"* while three checks failed is the exact defect this file
// exists to prevent.
//
// ── One reporter, and it is mechanical rather than polite ──────────────────
// `claimSend()` spends a key FOR EVER (`lib/notify/sent-once.ts`). Two jobs
// mailing operational findings would therefore either share a window — one
// swallowing the other's finding — or hold two windows and put two mails on one
// morning. So the core has exactly one caller of `notifyOperators()` and it is
// this file; `lib/notify/reporter-guard.test.ts` fails the build on a second.
// `check-advisories` MEASURES and records, and mails nobody
// (`lib/cron/security-record.ts` argues its half).
//
// ── Three limits, written down rather than implied ─────────────────────────
//
//  1. **The standing-queue trade holds here** (`sent-once.ts:68-83`). The claim
//     stands BEFORE the first delivery, so a transport that then fails loses
//     that window's message — deliberately, because a lost message is visible
//     (the job throws) and self-healing. Self-healing is only true of a job that
//     repeats a STANDING queue, and this is one: every run re-reads the same
//     four conditions, so the next window counts the same standing set again.
//     A one-off, event-shaped message would heal nothing, and nothing here
//     sends one.
//  2. **A process killed BETWEEN the claim and the delivery** — a redeploy, an
//     OOM kill — never reaches `finish()` in `lib/cron/run.ts`. The claim row is
//     committed, `cron_runs` keeps the previous detail, and that message is gone
//     with nothing saying so. Unfixable from here.
//  3. 🚨 **A mail the provider ACCEPTED and then never delivered is invisible
//     from here.** `sendOperatorMail()` throwing is the only delivery signal
//     this app has. Knowing that a message arrived is a monitoring provider's
//     job, and this file does not pretend otherwise.
//
// ── What is NOT in this file, on purpose ───────────────────────────────────
//
//   * **No `STALL_FACTOR`.** The rule *"an enabled job whose last finish is
//     further back than 3 × its interval"* already exists, with its reasoning,
//     as `overdueJobs()` / `OVERDUE_FACTOR` in `lib/cron/rules.mjs` — written
//     for `node run.mjs health`. A second constant of the same number with the
//     same meaning is the drift this epic refuses everywhere else, so the rule
//     is imported.
//   * **No IPN constants.** `IPN_SILENCE_DAYS` and `IPN_ACTIVE_DAYS` live in
//     `./health.ts` and are applied there; this file reads the CODE that probe
//     produced and never re-derives the judgement.
//   * **No `config/ops.json`.** Two switches already exist and are enough:
//     `config/cron.json` (this job) and `config/notifications.json` (the
//     channel).
//   * **No sentence.** Findings are ids, severities and numbers. The words are
//     the mail's and they come from `messages/{de,en}.json`, which is why
//     nothing below builds a string a person reads.
//   * **No "consecutive failures" anywhere.** `cron_runs` is one row per job and
//     carries no history, so the phrase cannot be measured here and is
//     therefore not claimed. What IS measurable is in `collectFindings()`.
//
// ⚠️ Nothing on this path may reach for `next-intl/server`, `next/headers`,
// `getTranslations()`, `getLocale()`, `cookies()` or `headers()`. Through
// `POST /api/cron` there IS a request — just one with no language cookie — so a
// relapse does not throw, it renders every operator mail in `DEFAULT_LOCALE`
// and nobody finds out. `lib/notify/guard.test.ts` carries the measurement.
import { createHash } from "node:crypto";

import { overdueJobs } from "@/lib/cron/rules.mjs";
import { SEVERITIES } from "@/scripts/security/rules.mjs";

import type { OperationalState } from "./health";

/** The job's id — one truth, read by the registry, by `sendKey()` and by tests. */
export const WATCHDOG_JOB_ID = "ops-watchdog";

/** Where the mail points, when this app has a usable absolute base. */
const ADMIN_PATH = "/dashboard/admin";

/**
 * The severity ladder as a TYPE.
 *
 * Written out rather than derived from `SEVERITIES`, on the precedent
 * `scripts/security/rules.mjs` sets for its own counts object: the four words
 * have to be a type here, and `SEVERITIES` is a runtime array. The two are held
 * together by an assertion in `./watchdog.test.ts` rather than by hope, and the
 * ORDER used for sorting is `SEVERITIES`' own — never a second table.
 */
export type OpsSeverity = "critical" | "high" | "medium" | "low";

/**
 * The four CHECKS. Each one either ran or could not be made, and the detail
 * line's arithmetic is over exactly this list.
 *
 * Note that `media` and `ipn` come out of ONE call (`operationalState()`) and
 * are still two checks: the store answering and the payment webhook arriving
 * are two facts, and a database that is down must not be reported as a media
 * store that is down.
 */
export const OPS_CHECKS = ["security", "jobs", "media", "ipn"] as const;
export type OpsCheckId = (typeof OPS_CHECKS)[number];

/**
 * The five CONDITIONS, and there is no sixth.
 *
 * 🚨 The send key's digest is taken over a sorted subset of exactly these ids,
 * so the set is bounded by construction: at most one key per distinct subset per
 * UTC day. Renaming one changes every key it appears in, which re-opens that
 * day's window once — harmless, and worth knowing before renaming one.
 */
export const OPS_CONDITIONS = [
  "ipn-silent",
  "jobs-failing",
  "jobs-stalled",
  "media-unreachable",
  "security-open",
] as const;
export type OpsConditionId = (typeof OPS_CONDITIONS)[number];

/**
 * One open condition. **Ids and numbers, never a sentence.**
 *
 * `count` is what the mail says out loud. `at` is the ONE timestamp a finding is
 * allowed to carry (counts, states and at most one timestamp per finding) — the
 * shipped mail renders none of them, and it is carried so that a later reader
 * has the fact without a second query. Neither ever reaches `cron_runs`.
 */
export interface OpsFinding {
  id: OpsConditionId;
  severity: OpsSeverity;
  count?: number;
  at?: string;
}

/**
 * One check that could not be made.
 *
 * 🚨 **This is not a finding and must never be counted as one.** A watchdog that
 * mails because it could not look is a watchdog people filter (AC7): the state
 * belongs in the detail line, in `node run.mjs health`'s verdict and in the
 * session greeting — places where a human is already looking and can judge.
 *
 * `reason` is a short closed code, never an error message: it is logged and
 * counted, and it reaches neither the mail nor `cron_runs.lastDetail`.
 */
export interface OpsUnchecked {
  id: OpsCheckId;
  reason: string;
}

/** What one run of the judgement produced. */
export interface OpsAssessment {
  /** Open conditions, worst first. */
  findings: OpsFinding[];
  /** Checks that could not be made at all. */
  unchecked: OpsUnchecked[];
  /** `OPS_CHECKS.length - unchecked.length`. The `N` in the detail line. */
  checksRan: number;
}

/** As much of a `cron_runs` row as the two job rules need. `JobStatus` fits. */
export interface WatchdogJobRow {
  job: string;
  enabled: boolean;
  everyMinutes: number;
  lastFinishedAt: Date | string | null;
  lastOutcome: string | null;
}

export type SecurityFacts =
  | { state: "ok"; counts: { critical: number; high: number }; checkedAt?: string }
  | { state: "unchecked"; reason: string };

export type JobFacts =
  | { state: "ok"; jobs: readonly WatchdogJobRow[] }
  | { state: "unchecked"; reason: string };

export type StoreFacts =
  | { state: "ok"; ops: OperationalState }
  | { state: "unchecked"; reason: string };

/**
 * Everything the judgement below reasons about — injected, never fetched.
 *
 * That is what makes every rule in this file testable without a database, a
 * bucket or a `.dev/` folder, which matters because `vitest.config.ts` puts
 * every `.test.ts` under `template/` inside `make check` by construction.
 */
export interface OpsFacts {
  /** The tick's clock. Never `new Date()` in here. */
  now: Date;
  security: SecurityFacts;
  jobs: JobFacts;
  ops: StoreFacts;
}

/** A number that really is one — these values crossed JSON to get here. */
function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Worst first, then by id so two runs with one set produce one order. */
function bySeverity(a: OpsFinding, b: OpsFinding): number {
  const rank = SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);
  return rank !== 0 ? rank : a.id.localeCompare(b.id);
}

/**
 * The judgement — **pure**, and the whole of AC2 lives here.
 *
 * | condition | fires when | severity |
 * |---|---|---|
 * | `security-open`     | the record's `critical > 0` or `high > 0`            | 🚨 / ❌ from its own counts |
 * | `jobs-failing`      | an ENABLED job's `lastOutcome === "failed"`          | ❌ high |
 * | `jobs-stalled`      | `overdueJobs()` — 3 × the job's own interval         | ⚠️ medium |
 * | `media-unreachable` | `operationalState().media.state === "finding"`       | ❌ high |
 * | `ipn-silent`        | `operationalState().ipn.state === "finding"`         | ⚠️ medium |
 *
 * Three exclusions, each of them deliberate:
 *
 *   * **A job that has NEVER finished is not stalled.** `lastFinishedAt` is
 *     `null` and nothing in `cron_runs` says when this app was deployed, so a
 *     freshly deployed app would otherwise mail its owner about every job on its
 *     first night. `overdueJobs()` already refuses it, `jobFindings()` reports
 *     never-run separately, and `node run.mjs cron --list` plus the health
 *     verdict are where a HUMAN reads it.
 *   * **A job that is OFF is never a finding** — it is not supposed to be
 *     running, so "it has not run" is the right answer. The same rule Story 32.2
 *     fixed, and `overdueJobs()` keeps it too.
 *   * **A check that could not be made is not a finding.** It lands in
 *     `unchecked` and it never triggers a mail on its own.
 *
 * 🚨 **"Consecutive failures" is not claimed and cannot be.** `cron_runs` holds
 * one row per job, updated in place; there is no history to read a streak out
 * of. What is measurable is *"its last run failed"*, and that is what fires.
 */
export function collectFindings(facts: OpsFacts): OpsAssessment {
  const findings: OpsFinding[] = [];
  const unchecked: OpsUnchecked[] = [];

  // ── security — Story 31.4's record, READ and never re-measured ──────────
  if (facts.security.state === "unchecked") {
    unchecked.push({ id: "security", reason: facts.security.reason });
  } else {
    const critical = count(facts.security.counts?.critical);
    const high = count(facts.security.counts?.high);
    if (critical > 0 || high > 0) {
      findings.push({
        id: "security-open",
        // From the record's OWN counts, on the shipped ladder's words.
        severity: critical > 0 ? "critical" : "high",
        count: critical + high,
        ...(facts.security.checkedAt ? { at: facts.security.checkedAt } : {}),
      });
    }
  }

  // ── jobs — two conditions out of one table read ─────────────────────────
  if (facts.jobs.state === "unchecked") {
    unchecked.push({ id: "jobs", reason: facts.jobs.reason });
  } else {
    const rows = facts.jobs.jobs ?? [];
    const failing = rows.filter(
      (row) => row?.enabled === true && row?.lastOutcome === "failed",
    ).length;
    if (failing > 0) findings.push({ id: "jobs-failing", severity: "high", count: failing });

    // The shipped rule, imported rather than restated — see the header.
    const stalled = overdueJobs(rows as WatchdogJobRow[], facts.now).length;
    if (stalled > 0) findings.push({ id: "jobs-stalled", severity: "medium", count: stalled });
  }

  // ── media + ipn — two checks, one probe call ────────────────────────────
  if (facts.ops.state === "unchecked") {
    // One failure, two checks that could not be made. Counting it once would
    // make `N check(s) ran` add up to three out of four and say nothing about
    // which one is missing.
    unchecked.push({ id: "media", reason: facts.ops.reason });
    unchecked.push({ id: "ipn", reason: facts.ops.reason });
  } else {
    const { media, ipn } = facts.ops.ops;
    if (media.state === "finding") {
      findings.push({ id: "media-unreachable", severity: "high" });
    } else if (media.state === "unchecked") {
      unchecked.push({ id: "media", reason: media.code });
    }

    if (ipn.state === "finding") {
      findings.push({
        id: "ipn-silent",
        severity: "medium",
        ...(ipn.lastEventAt ? { at: ipn.lastEventAt } : {}),
      });
    } else if (ipn.state === "unchecked") {
      unchecked.push({ id: "ipn", reason: ipn.code });
    }
  }

  findings.sort(bySeverity);
  return { findings, unchecked, checksRan: OPS_CHECKS.length - unchecked.length };
}

/**
 * What this message IS — the window AND which conditions are open.
 *
 * ```
 * ops-watchdog:2026-08-10:9f2a41c7
 *              └ window ┘ └ digest ┘  sha256("ipn-silent,jobs-failing").slice(0, 8)
 * ```
 *
 * 🚨 **The window alone is not enough.** A key of `ops-watchdog:<day>` is
 * claimed by the first mail of the day, so a SECOND condition appearing six
 * hours later would be swallowed by the first mail's spent window and the
 * operator would never hear about it.
 *
 * 🚨 **And the digest is over the sorted condition IDS ONLY — never a count and
 * never a timestamp.** With a count in it, a job whose failure tally ticks from
 * 2 to 3 mints a new key and mails again; every tick would then mint one, every
 * tick would mail, and the operator learns to filter. That is precisely the
 * failure this whole job exists to prevent.
 *
 * The day is UTC for the reason `modules/courses/rules.ts` gives about its own
 * key: this is not a day anybody reads, it is the NAME of a window, and its only
 * job is to be the same string for two runs inside it and a different one across
 * the boundary. A zone read from the environment would let changing that
 * variable silently re-open a claimed window.
 *
 * The result matches `SEND_KEY_PATTERN` by construction — a lower-case id, ten
 * digits and dashes, eight hex characters — and `./watchdog.test.ts` asserts it
 * against the real grammar rather than a copy of it.
 */
export function sendKey(now: Date, findings: readonly OpsFinding[]): string {
  const ids = [...new Set(findings.map((finding) => finding.id))].sort();
  const digest = createHash("sha256").update(ids.join(",")).digest("hex").slice(0, 8);
  return `${WATCHDOG_JOB_ID}:${now.toISOString().slice(0, 10)}:${digest}`;
}

/** As much of `NotifyResult` as the line below needs — kept structural. */
export interface NotifyOutcome {
  sent: number;
  recipients: number;
  reason: string | null;
}

/**
 * The one line of NUMBERS for `cron_runs.lastDetail` — **pure**.
 *
 * 🚨 **This is where a mail that never went and a mail there was nothing to send
 * become different sentences.** Read the shapes down the page: *"there was
 * nothing to send"*, *"it was already said this window"*, *"it could not be
 * sent"* and *"it went"* are four different lines, and none of them can be
 * mistaken for another.
 *
 * | what happened | line |
 * |---|---|
 * | nothing open | `nothing open — 4 check(s) ran, 0 could not be checked` |
 * | reported | `3 finding(s), 2/2 mailed` |
 * | already said this window | `3 finding(s), already notified this window` |
 * | not reported | `3 finding(s), no mail sent (noTransport)` |
 *
 * A `deliveryFailed` / `composeFailed` / `badSendKey` never reaches this
 * function at all: `notifyOperators()` throws a `NotifyError` carrying a COUNT,
 * the job lets it through (cron rule 3), and the run is recorded as **failed** —
 * so the failure of the alarm becomes a finding for `cron --list` and for the
 * health verdict on its own.
 *
 * ⚠️ **`M could not be checked` is appended to every shape, never dropped**
 * (NFR-60). A line reading `3 finding(s), 2/2 mailed` while two of four checks
 * never ran would be the silence this epic is about, rebuilt inside its own fix.
 * The `nothing open` shape states it even at zero, because that is the line
 * where the number is the whole point.
 *
 * `reason` is a code out of the channel's closed union — never an address, never
 * a sentence somebody wrote, never `error.message`.
 */
export function detailLine(
  assessment: OpsAssessment,
  result: NotifyOutcome | null = null,
): string {
  const could = assessment.unchecked.length;
  const open = assessment.findings.length;

  if (open === 0) {
    return `nothing open — ${assessment.checksRan} check(s) ran, ${could} could not be checked`;
  }

  const tail = could > 0 ? `, ${could} could not be checked` : "";
  // Defensive rather than reachable: `runWatchdog()` only omits the result when
  // there is nothing open, and that branch returned above.
  if (!result) return `${open} finding(s), no mail attempted${tail}`;
  if (result.reason === "alreadySent") {
    return `${open} finding(s), already notified this window${tail}`;
  }
  if (result.reason) return `${open} finding(s), no mail sent (${result.reason})${tail}`;
  return `${open} finding(s), ${result.sent}/${result.recipients} mailed${tail}`;
}

/** Look a key up in the operator's language. The channel hands one of these in. */
type Translate = (key: string, values?: Record<string, string | number | Date>) => string;

/** What `compose()` owes `notifyOperators()`, as much of it as this file writes. */
interface ComposedMail {
  subject: string;
  heading: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
}

/**
 * The absolute address of the operator's admin area, or `null`.
 *
 * Same rule and same reason as `queueUrl()` in `modules/courses/cron.ts`: a mail
 * needs an absolute base and a relative path in a mail body is a dead string, so
 * without a usable `APP_URL` the button is left off entirely. The counts are the
 * message and they survive the missing link.
 */
export function adminUrl(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const base = env.APP_URL?.trim();
  if (!base || !/^https?:\/\//i.test(base)) return null;
  return new URL(ADMIN_PATH, base).toString();
}

/**
 * The message — **counts, states and at most one timestamp, and not one word
 * this file wrote.**
 *
 * Every sentence comes out of `messages/{de,en}.json` through the translator the
 * channel hands in, in the operator language from `config/notifications.json`.
 * Nothing here names a job, a package, a path, a bucket, an address or a member:
 * a mail is delivered to an inbox this app does not control and read on whatever
 * device holds it, and *"2 job(s) are failing"* sends the operator to
 * `cron --list` for the name, which is one command and no leak.
 *
 * ⚠️ **The unchecked line goes into a mail that is going out ANYWAY** — never a
 * mail of its own (AC7). Without it the operator reads a list that quietly omits
 * what nobody could look at.
 */
export function composeReport(
  assessment: OpsAssessment,
  url: string | null,
): (t: Translate) => ComposedMail {
  return (t) => {
    const open = assessment.findings.length;
    // Sorted worst-first by `collectFindings()`, so `[0]` is the worst.
    const worst = assessment.findings[0]?.severity ?? "low";

    const paragraphs = assessment.findings.map((finding) =>
      // A COMPUTED key, which is why `i18n/messages.test.ts` cannot see it and
      // why `./watchdog.test.ts` walks `OPS_CONDITIONS` against both files.
      t(`opsWatchdog.condition.${finding.id}`, { count: finding.count ?? 1 }),
    );
    if (assessment.unchecked.length > 0) {
      paragraphs.push(t("opsWatchdog.unchecked", { count: assessment.unchecked.length }));
    }

    return {
      subject: t("opsWatchdog.subject", {
        count: open,
        severity: t(`opsWatchdog.severity.${worst}`),
      }),
      heading: t("opsWatchdog.heading", { count: open }),
      paragraphs,
      ...(url ? { cta: { label: t("opsWatchdog.cta"), url } } : {}),
    };
  };
}

/** The security record, read through the ONE reader — see `readFacts()`. */
async function readSecurity(now: Date): Promise<SecurityFacts> {
  try {
    const { readSecurityRecord } = await import("@/lib/cron/security-record");
    const read = await readSecurityRecord(now);
    if (read.state === "unchecked") return { state: "unchecked", reason: read.reason };
    return {
      state: "ok",
      counts: {
        critical: count(read.record.counts?.critical),
        high: count(read.record.counts?.high),
      },
      ...(typeof read.record.checkedAt === "string"
        ? { checkedAt: read.record.checkedAt }
        : {}),
    };
  } catch (error) {
    // 🚨 `unchecked`, never "clean". "I could not look" and "there is nothing
    // there" are the two answers this whole epic exists to keep apart.
    console.error("[ops] the security record could not be read:", error);
    return { state: "unchecked", reason: "recordUnreadable" };
  }
}

/** The job table. One `select` over `cron_runs`, filled in from the registry. */
async function readJobs(): Promise<JobFacts> {
  try {
    const { jobStatuses } = await import("@/lib/cron/run");
    return { state: "ok", jobs: await jobStatuses() };
  } catch (error) {
    console.error("[ops] the job table could not be read:", error);
    return { state: "unchecked", reason: "dbUnreachable" };
  }
}

/** The two facts nothing outside the app can answer — Story 32.3's evaluator. */
async function readOps(now: Date): Promise<StoreFacts> {
  try {
    const { operationalState } = await import("./health");
    return { state: "ok", ops: await operationalState({ now }) };
  } catch (error) {
    // `operationalState()` is written so it cannot throw — every probe sits in
    // its own `try`. This catch is about the IMPORT and about a later change to
    // that promise, and it falls to `unchecked` for both.
    console.error("[ops] the operational probes could not run:", error);
    return { state: "unchecked", reason: "probesUnavailable" };
  }
}

/**
 * The impure half: read the four facts, each in its OWN `try`.
 *
 * 🚨 That separation is the point rather than tidiness. One unreadable source
 * must not take the other three with it — a database that is down would
 * otherwise turn a media outage into "nothing open", which is the failure mode
 * this job exists to make impossible.
 *
 * Every source is reached with a DYNAMIC import, and that is deliberate twice
 * over: `@/lib/cron/run` reaches `lib/cron/jobs.ts`, which is where this job's
 * own registry entry lives (a static import would close that circle), and the
 * pure half of this file is unit-tested — a static import of the mail
 * transport, the database and the message catalogue would drag all three into a
 * test that only asks about arithmetic.
 */
export async function readFacts({ now }: { now: Date }): Promise<OpsFacts> {
  const [security, jobs, ops] = await Promise.all([
    readSecurity(now),
    readJobs(),
    readOps(now),
  ]);
  return { now, security, jobs, ops };
}

/**
 * One run of the watchdog: read, judge, mail once, say which of the four things
 * happened.
 *
 * 🚨 **Step 2 returns BEFORE the channel is touched.** With nothing open there
 * is no key claimed, no owner query and nothing sent — so an app in good health
 * writes no row into `notification_sends` at all, and the day's window stays
 * available for the first condition that really appears.
 *
 * It swallows nothing (cron rule 3): a `NotifyError` travels straight out, the
 * run is recorded `failed`, the job's `failures` count rises, and the alarm's
 * own failure becomes an alarm for `cron --list` and for the health verdict.
 */
export async function runWatchdog({ now }: { now: Date }): Promise<string> {
  // 1. The facts, and the judgement.
  const assessment = collectFindings(await readFacts({ now }));

  // 2. Nothing open — say so, and touch nothing.
  if (assessment.findings.length === 0) return detailLine(assessment);

  // 3. One message, through the core's channel. `compose()` runs BEFORE the
  //    claim — the channel's own guarantee, inherited rather than rebuilt.
  const { notifyOperators } = await import("@/lib/notify/operators");
  const result = await notifyOperators({
    key: sendKey(now, assessment.findings),
    now,
    compose: composeReport(assessment, adminUrl()),
  });

  // 4. One line of numbers, with the states told apart.
  return detailLine(assessment, result);
}
