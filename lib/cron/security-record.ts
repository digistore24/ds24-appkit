// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The body of the `check-advisories` job: ask the ADVISORY half of the shipped
// security ladder while nobody is at the keyboard, and write the answer into the
// record `node run.mjs security-check` already writes.
//
// ── What this file is, and what it deliberately is not ─────────────────────
//
// It is the second producer of `.dev/security-check.json` and it reuses the
// first one whole: `RUNGS` and `runRungs()` from `scripts/security/check.mjs`,
// `outcomeFrom()` / `recordFrom()` from `scripts/security/rules.mjs`, and
// `writeVerdict()` from `scripts/security/verdict.mjs`. There is no second
// serialiser here, no second aggregator, and no second copy of the record path —
// a record written by this job has to read like one written by the command, or
// the greeting that reads them both (`scripts/dev/operations.mjs`) is reading
// two different things.
//
// Since Story 32.4 it also holds the READER — `readSecurityRecord()` at the
// bottom — for the same reason it holds the writer: the hard part is reaching
// `scripts/security/verdict.mjs` from inside a bundled app without ending up
// with a copy of `VERDICT_PATH` that points at the bundle, and that is solved
// once, here, with the two failures it was measured against. `lib/ops/watchdog.ts`
// is the caller; it READS the record and never runs the ladder.
//
// It mails NOBODY. Not `notifyOperators()`, not `claimSend()`, not anything
// under `lib/notify/` at all, direct or transitive — and
// `./security-record.test.ts` walks the import graph rather than trusting this
// sentence. The reason is NFR-67 and it is mechanical: `claimSend()` spends a
// key for ever, so two mailing jobs sharing one window would have one swallow
// the other's finding, and two keys would mean two mails on one morning.
// Reporting on the operator-mail channel has exactly one producer, and it is not
// this file.
//
// ── The trap this file is written around ──────────────────────────────────
//
// 🚨 **A record that asked two questions must never look like a record that
// asked all of them.** The job asks two rungs; every OTHER registered rung is
// put into the record as `skipped` with a reason saying so, built with the
// shipped `outcomeFrom()` so that `aggregate()` counts it and sets
// `complete: false` by itself. The not-asked list is derived from `RUNGS` **at
// run time** — never from a list kept here — so a rung added by a later story is
// covered the day it lands, without an edit in this file.
//
// The consequence is permanent and correct: a record written by this job is
// ALWAYS `complete: false` and always names several not-asked rungs. That is why
// `scripts/dev/operations.mjs` does not read `complete: false` as an alarm.
//
// ── The one record, and the cost of there being only one ──────────────────
//
// There is one record and it is replaced WHOLE, never merged. So a `live`
// finding from Monday's command run stops being named after Monday night's job
// run. Three alternatives were considered and rejected, and the reasoning is
// here so a later reader does not re-litigate it:
//
//   · **merge with the previous record** — two measurements of different ages
//     under one `checkedAt`. A record that says "checked at 03:00" while
//     carrying Monday's `live` finding lies about the only field that makes it
//     trustworthy.
//   · **a second record file, merged by the reader** — the greeting and the
//     watchdog read ONE record rather than each inventing one. Two files means a
//     merging reader, which is the same lie moved one layer out.
//   · **have the job run the whole ladder** — `posture` runs `npm ci --dry-run`
//     in a temp dir, `signatures` and `advisories` spawn npm, and `live` would
//     make a deployed app probe its own public domain daily. FR-261 scopes this
//     job to the ADVISORY state, and shipping the rest unattended-by-default is a
//     decision nobody asked for.
//
// What makes the trade bearable is that the record AND the job's line always say
// how many rungs were not asked. If it ever stops being bearable the named path
// forward is a second, rung-scoped record with per-rung timestamps — not a merge.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// ⚠️ `scripts/security/rules.mjs` may be imported STATICALLY and
// `scripts/security/verdict.mjs` may not, and the difference is not style.
// `rules.mjs` is pure — zero imports, no `node:fs`, no `process.cwd()` — and its
// own header anticipates exactly this caller. `verdict.mjs` derives
// `VERDICT_PATH` from `import.meta.url`, so a bundled copy of that arithmetic
// points at the bundle and the record lands where nobody reads it.
// (`lib/ai/disclosure.mjs` is the shipped precedent for the static half.)
import { outcomeFrom, recordFrom } from "@/scripts/security/rules.mjs";
import { finiteNumber } from "@/lib/finite";

/** One rung's state as it appears in the record — numbers and states only. */
export interface RecordRung {
  id: string;
  state: string;
  reason?: string;
}

/** The record `scripts/security/verdict.mjs` writes. No finding ever enters it. */
export interface SecurityRecord {
  version: number;
  checkedAt: string;
  template: string;
  complete: boolean;
  counts: { critical: number; high: number; medium: number; low: number; accepted: number };
  rungs: RecordRung[];
}

/** As much of a rung as this file needs: its id. */
export interface RungLike {
  id: string;
}

/** As much of an outcome as this file needs. `runRungs()` produces these. */
export interface OutcomeLike {
  id: string;
  state: string;
  reason?: string;
  findings?: unknown[];
}

/**
 * The rungs this job asks, in the order it asks them.
 *
 * **`osv` first, always, and the order is the point rather than a preference.**
 * `runRungs()` runs rungs sequentially, so the rung that CAN hang must not be
 * able to stop the one that cannot:
 *
 *   · `osv` is bounded by construction — every request carries an
 *     `AbortSignal.timeout()`. It needs no `node_modules`, needs no npm binary
 *     in the common case, and answered this tree's ~659 name/version pairs in
 *     about a second when Story 30.2 measured it.
 *   · `advisories` spawns npm through `capture()`, which sets **no timeout at
 *     all** (`scripts/lib/proc.mjs`). That is the reason this job carries its own
 *     budget below. In a deployed image npm is routinely absent; the rung already
 *     turns the `127` into a skip carrying that reason, which is the honest
 *     outcome and not a failure.
 *
 * ⚠️ `osv` may itself spawn npm once, and only when OSV returned hits — it asks
 * `auditIds()` so it can report only what npm did NOT already report. Inheriting
 * that is correct; re-implementing it would be a second opinion about one
 * question.
 *
 * Every id here must be a rung `RUNGS` really has — `./security-record.test.ts`
 * asserts it, so an id nothing answers to is a build failure rather than a job
 * that quietly asks nothing.
 */
export const ASKED_RUNGS: readonly string[] = Object.freeze(["osv", "advisories"]);

/**
 * How long the whole measurement may take before the rest is left unanswered.
 *
 * Two minutes, and the number is bounded from above by rule 4 in
 * `docs/cron.md`: a job finishes in well under the 60-minute stale-lock window
 * (`STALE_LOCK_MINUTES`), because a job still running when its lock goes stale
 * can be started a second time beside itself. Two minutes is thirty times inside
 * that window while being several times what a normal run needs.
 *
 * It exists at all because nothing else bounds this work: `capture()` sets no
 * timeout, so an `npm audit` that hangs hangs for ever.
 *
 * ⚠️ **What the budget can and cannot do, stated rather than papered over:**
 * `Promise.race` ABANDONS a rung, it does not kill a child process. An abandoned
 * rung's answer is dropped and cannot reach the record, and whatever npm it
 * spawned keeps running until it exits on its own. The record says that rung was
 * not answered, which is true; it does not say the machine went quiet.
 */
export const DEFAULT_BUDGET_MS = 120_000;

/** Every rung this job did not ask gets this one sentence. */
export function notAskedReason(): string {
  return "not asked by the daily job, which asks the advisory rungs only — node run.mjs security-check asks all of them";
}

/** A rung this job DID ask, whose answer the time budget cut off. */
export function budgetReason(): string {
  return "the daily job ran out of its time budget before this rung answered — node run.mjs security-check asks it";
}

/**
 * Every registered rung's outcome: what really answered, and a skip for the rest.
 *
 * Pure, and separate from the measuring half precisely so that a test can hand
 * it a rung list of its own — including one nothing here has ever heard of.
 *
 * 🚨 The list of rungs comes from the CALLER (which passes `RUNGS`), never from a
 * constant in this file. A hard-coded list of the rungs that were not asked
 * would rot silently the day a rung is added, and the record would then describe
 * a ladder shorter than the one that exists.
 *
 * A rung in `ASKED_RUNGS` that has no answer was asked and cut off by the budget;
 * anything else was never asked at all. Those are different facts and they get
 * different sentences.
 */
export function composeOutcomes(
  rungs: readonly RungLike[],
  answered: readonly OutcomeLike[],
): OutcomeLike[] {
  const byId = new Map(answered.map((outcome) => [outcome.id, outcome]));
  return rungs.map(
    (rung) =>
      byId.get(rung.id) ??
      (outcomeFrom(rung, {
        state: "skipped",
        reason: ASKED_RUNGS.includes(rung.id) ? budgetReason() : notAskedReason(),
        findings: [],
      }) as OutcomeLike),
  );
}

/** A number that really is one, else 0 — the record crossed JSON to get here. */
/**
 * The one line of NUMBERS that lands in `cron_runs.lastDetail` — pure.
 *
 * 🚨 Rule 2 in `docs/cron.md` is not a style preference: `cron_runs` is a table
 * with no privacy question attached (`docs/data-protection.md` §11). So no
 * package name, no path, no host, no member id — and **no rung's skip reason
 * either**. A reason is this app's own sentence about a tool today, but it
 * routinely carries UPSTREAM text (`EEXPIREDSIGNATUREKEY: a package has a
 * registry signature with keyid: SHA256:…` is a real one from this tree), and
 * upstream text in `cron_runs` is a promise this template does not need to make.
 * The reasons live in the record, one file away, which is what the greeting and
 * the watchdog read.
 *
 * It COUNTS rather than enumerates, so the line stays a fixed size as rungs are
 * added — `lib/cron/run.ts` truncates at 500 characters and this is nowhere near
 * it.
 *
 * "Answered" and "not asked" are the shipped ladder's own vocabulary: a rung
 * that skipped reports `⏭ not asked`, whether it was never asked or asked and
 * unable to look. Which of the two it was is in the record's reason.
 */
export function detailLine(record: Pick<SecurityRecord, "counts" | "rungs">): string {
  const rungs = Array.isArray(record?.rungs) ? record.rungs : [];
  const notAsked = rungs.filter((rung) => rung?.state === "skipped").length;
  const answered = rungs.length - notAsked;
  const counts = record?.counts;

  const tally =
    answered === 0
      ? "nothing was measured"
      : `${finiteNumber(counts?.critical)} critical, ${finiteNumber(counts?.high)} high, ` +
        `${finiteNumber(counts?.medium)} medium, ${finiteNumber(counts?.low)} low, ` +
        `${finiteNumber(counts?.accepted)} accepted`;

  return `${answered} of ${rungs.length} rung(s) answered — ${tally}; ${notAsked} not asked`;
}

/** What `scripts/security/check.mjs` exports, as much of it as this job uses. */
interface SecurityCheckModule {
  RUNGS: readonly RungLike[];
  runRungs(
    rungs: readonly RungLike[],
    context: { root: string; argv: string[] },
  ): Promise<OutcomeLike[]>;
}

/** What `scripts/security/verdict.mjs` exports, as much of it as this file uses. */
interface VerdictModule {
  writeVerdict(record: SecurityRecord): SecurityRecord;
  readVerdict(now?: number): SecurityRecord | null;
}

/**
 * Import one file out of the app's own `scripts/security/` tree, at run time.
 *
 * Copied from `lib/content/applier-presence.ts`, comment and all, because the
 * two failures it records are the two failures here:
 *
 *   · **the `webpackIgnore` / `turbopackIgnore` magic comments** — this code runs
 *     inside the Next bundle, and webpack/Turbopack answered a dynamic specifier
 *     with *"Cannot find module as expression is too dynamic"*. That failure
 *     lands in production only; nothing in the local harness has a key for that
 *     surface.
 *   · **`pathToFileURL(file).href`, never a bare absolute path** — a native
 *     dynamic import of an absolute path is deprecated on POSIX and simply fails
 *     on Windows, and this template ships to three systems.
 *
 * 🚨 It matters most for `verdict.mjs`, which MUST be the real file on disk:
 * `VERDICT_PATH` is derived from that file's own `import.meta.url`, so a bundled
 * copy would write the record into the bundle's folder. There stays exactly one
 * writer of `.dev/security-check.json`.
 */
async function importSecurity<T>(root: string, file: string): Promise<T> {
  const path = join(root, "scripts", "security", file);
  try {
    return (await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */
      pathToFileURL(path).href
    )) as T;
  } catch (error) {
    // 🚨 This THROWS rather than skipping (rule 3 in `docs/cron.md`). A security
    // tree the running app cannot reach is a deployment defect — the files were
    // not carried into the image — and a job that swallowed it would report a
    // healthy `ok` for ever while measuring nothing at all. The rung-level
    // "I could not look" answers are a different thing entirely and stay skips.
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `could not reach scripts/security/${file} from ${root} — ` +
        `the security tree is not where this app is running: ${message}`,
    );
  }
}

/** This app's own version for the record. Never a reason to fail anything. */
function templateVersion(root: string): string {
  try {
    // Not `process.env.npm_package_version`: it is not set in production.
    const raw: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))?.version;
    return typeof raw === "string" ? raw : "";
  } catch {
    return "";
  }
}

const CUT_OFF = Symbol("budget");

/**
 * `work`, or `CUT_OFF` once `ms` have passed.
 *
 * The timer is cleared in a `finally`, so it can never outlive the race and keep
 * a short-lived process (`node run.mjs cron --job …`) from exiting.
 */
async function withinBudget<T>(work: Promise<T>, ms: number): Promise<T | typeof CUT_OFF> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<typeof CUT_OFF>((resolve) => {
    handle = setTimeout(() => resolve(CUT_OFF), ms);
  });
  try {
    return await Promise.race([work, timer]);
  } finally {
    clearTimeout(handle);
  }
}

/**
 * Measure the advisory state and write the record. The impure half.
 *
 * Returns the record so the caller can render its own line from it — this file
 * never prints and never mails.
 *
 * @param now the clock the tick reasons about. Never `new Date()` in here.
 * @param budgetMs the whole measurement's budget; see `DEFAULT_BUDGET_MS`.
 */
export async function measureAdvisories({
  now,
  budgetMs = DEFAULT_BUDGET_MS,
}: {
  now: Date;
  budgetMs?: number;
}): Promise<SecurityRecord> {
  // The app's own root, the same way `lib/content/applier-presence.ts` resolves
  // it — `scripts/` sits beside `lib/` in a deployed tree exactly as it does here.
  const root = process.cwd();

  const check = await importSecurity<SecurityCheckModule>(root, "check.mjs");
  const { writeVerdict } = await importSecurity<VerdictModule>(root, "verdict.mjs");

  // In ASKED_RUNGS order, NOT in RUNGS order: `advisories` comes first in the
  // ladder and must come second here. An id that matches no rung simply does not
  // get asked — the test is what refuses one, so this cannot fail a live app.
  const asked = ASKED_RUNGS.map((id) => check.RUNGS.find((rung) => rung.id === id)).filter(
    (rung): rung is RungLike => Boolean(rung),
  );

  const deadline = Date.now() + Math.max(1, budgetMs);
  const answered: OutcomeLike[] = [];
  for (const rung of asked) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    // One rung per race, never the whole ladder in one: racing `runRungs(asked)`
    // would throw away the answers of the rungs that DID finish, and a measured
    // answer that exists must not be lost to a rung after it.
    const outcome = await withinBudget(check.runRungs([rung], { root, argv: [] }), left);
    if (outcome === CUT_OFF) break;
    answered.push(...outcome);
  }

  // Every registered rung, in RUNGS order, so a record written by the job reads
  // like one written by the command. `aggregate()` inside `recordFrom()` then
  // sets `complete: false` by itself, because there is always a skip in here.
  const record = recordFrom(composeOutcomes(check.RUNGS, answered), {
    now: now.getTime(),
    template: templateVersion(root),
  }) as SecurityRecord;

  return writeVerdict(record);
}

/**
 * The record, read back from inside the running app — the OTHER direction.
 *
 * `measureAdvisories()` above writes it; `lib/ops/watchdog.ts` reads it, because
 * a scheduled job inside a customer's app must never RUN the security ladder
 * (that would put the network, npm and half a minute of registry traffic on the
 * request-serving process, and make a command deliberately in no gate into the
 * thing an app's health depends on). It reads the record instead.
 *
 * 🚨 **It lives here rather than in `lib/ops/` because the IMPORT is the hard
 * part, and it is already solved here.** `VERDICT_PATH` is derived from
 * `verdict.mjs`'s own `import.meta.url`, so a bundled copy of that arithmetic
 * points at the bundle and reads a file nobody writes — which is why
 * `importSecurity()` above exists, with the two failures it was measured
 * against. A second reader would be a second copy of that trap, and a second
 * copy of the version and staleness rules with it.
 *
 * `readVerdict()` is the ONE reader of the file's contents and is used exactly
 * as it is: it already answers `null` for a missing file, unparseable JSON, a
 * `version` this code does not know, and a record past its staleness bound.
 *
 * 🚨 **`null` is `unchecked`, never "clean".** A caller that turned an absent
 * record into a clean bill would report an app nobody has ever measured as
 * healthy, which is the silence this whole area exists to end. The two reasons
 * are kept apart because they have different fixes: nobody has measured yet, or
 * this app cannot reach its own `scripts/security/` tree at all.
 */
export type SecurityRecordRead =
  | { state: "ok"; record: SecurityRecord }
  | { state: "unchecked"; reason: "noUsableRecord" | "securityTreeUnreachable" };

export async function readSecurityRecord(
  now: Date,
  root: string = process.cwd(),
): Promise<SecurityRecordRead> {
  let verdict: VerdictModule;
  try {
    verdict = await importSecurity<VerdictModule>(root, "verdict.mjs");
  } catch (error) {
    // Not a throw. `measureAdvisories()` throws on the same failure because a
    // measuring job that cannot reach the ladder measured nothing and must say
    // so loudly; a READER that cannot reach it has simply not looked, and
    // "could not look" is a state its caller already has a shape for.
    console.error("[ops] the security record's reader could not be reached:", error);
    return { state: "unchecked", reason: "securityTreeUnreachable" };
  }

  try {
    const record = verdict.readVerdict(now.getTime());
    return record ? { state: "ok", record } : { state: "unchecked", reason: "noUsableRecord" };
  } catch (error) {
    // `readVerdict()` is written never to throw; this covers it changing.
    console.error("[ops] the security record could not be read:", error);
    return { state: "unchecked", reason: "noUsableRecord" };
  }
}
