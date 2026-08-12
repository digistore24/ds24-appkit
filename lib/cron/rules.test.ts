// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The scheduling rules, and the config that feeds them.
//
// The runner is not tested here — it needs a database, and what it does is one
// conditional UPDATE. What IS tested is every decision the runner asks this
// file to make, because those are the ones that fail quietly: a job that is
// never due looks exactly like a job with nothing to do.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";
import { MODULE_JOB_IDS } from "@/lib/modules/cron-ids.mjs";

import { SEVERITIES } from "@/scripts/security/rules.mjs";

import {
  JOB_DEFAULTS,
  STALE_LOCK_MINUTES,
  configProblems,
  describeEvery,
  dueBefore,
  isDue,
  jobFindings,
  normalizeJob,
  OVERDUE_FACTOR,
  overdueJobs,
  retentionCutoff,
  staleLockBefore,
} from "./rules.mjs";
import { cronConfigProblems, jobSettings, schedulerEnabled } from "./config";
import { CRON_JOBS, JOB_IDS, AI_USAGE_RETENTION_MONTHS } from "./jobs";

const NOW = new Date("2026-07-25T09:00:00Z");
const MINUTE = 60_000;

describe("normalizeJob", () => {
  it("inherits the defaults when nothing is configured", () => {
    expect(normalizeJob(undefined)).toEqual(JOB_DEFAULTS);
    expect(normalizeJob({})).toEqual(JOB_DEFAULTS);
  });

  it("keeps the job's own settings alongside the schedule", () => {
    // A job's own knobs — retentionMonths and the like — travel through
    // untouched. The scheduler does not know what they mean and must not.
    const job = normalizeJob({ everyMinutes: 60, retentionMonths: 3 });
    expect(job.everyMinutes).toBe(60);
    expect(job.retentionMonths).toBe(3);
  });

  it("is only off when it says false", () => {
    expect(normalizeJob({ enabled: false }).enabled).toBe(false);
    expect(normalizeJob({ enabled: true }).enabled).toBe(true);
    // Anything else is a typo, and a typo must not silently stop a retention
    // job — see the failure direction documented in config.ts.
    expect(normalizeJob({ enabled: "no" }).enabled).toBe(true);
    expect(normalizeJob({}).enabled).toBe(true);
  });

  it("refuses an interval that would mean a hot loop", () => {
    // 0, a negative or a non-number would make every tick claim the job
    // straight back, which is a DELETE across a table every minute for ever.
    for (const bad of [0, -5, "daily", null, NaN, undefined]) {
      expect(normalizeJob({ everyMinutes: bad }).everyMinutes).toBe(JOB_DEFAULTS.everyMinutes);
    }
    expect(normalizeJob({ everyMinutes: 1 }).everyMinutes).toBe(1);
    expect(normalizeJob({ everyMinutes: 90.7 }).everyMinutes).toBe(90);
  });
});

describe("isDue", () => {
  const daily = normalizeJob({ everyMinutes: 1440 });

  it("is due when it has never run", () => {
    // A fresh deploy should do its first cleanup rather than wait a day, and a
    // job whose row was removed should recover on its own.
    expect(isDue(daily, null, NOW)).toBe(true);
  });

  it("is not due again inside its interval", () => {
    expect(isDue(daily, new Date(NOW.getTime() - 60 * MINUTE), NOW)).toBe(false);
  });

  it("is due once the interval has passed", () => {
    expect(isDue(daily, new Date(NOW.getTime() - 1441 * MINUTE), NOW)).toBe(true);
  });

  it("is due exactly ON the interval, not a tick later", () => {
    expect(isDue(daily, new Date(NOW.getTime() - 1440 * MINUTE), NOW)).toBe(true);
  });

  it("is never due when it is switched off", () => {
    const off = normalizeJob({ enabled: false });
    expect(isDue(off, null, NOW)).toBe(false);
  });
});

describe("dueBefore / staleLockBefore", () => {
  it("dueBefore is the interval back from now", () => {
    expect(dueBefore(normalizeJob({ everyMinutes: 30 }), NOW).toISOString()).toBe(
      "2026-07-25T08:30:00.000Z",
    );
  });

  it("a lock goes stale after the stale window", () => {
    expect(staleLockBefore(NOW).getTime()).toBe(NOW.getTime() - STALE_LOCK_MINUTES * MINUTE);
  });

  it("the stale window is longer than the shortest useful interval", () => {
    // If a lock could go stale while a job of that interval was still running,
    // two instances would run it side by side.
    expect(STALE_LOCK_MINUTES).toBeGreaterThan(1);
  });
});

describe("retentionCutoff", () => {
  it("counts calendar months, not thirty-day blocks", () => {
    // Somebody who writes 12 means "the same date last year". 12 × 30 days is
    // 5 days short of it, every year, and nothing would say so.
    expect(retentionCutoff(12, NOW)?.toISOString()).toBe("2025-07-25T09:00:00.000Z");
    expect(retentionCutoff(3, NOW)?.toISOString()).toBe("2026-04-25T09:00:00.000Z");
  });

  it("normalises a date that the shorter month does not have", () => {
    // 31 March minus one month. Postgres would say 28 February; JS says
    // 3 March. Either is defensible for a retention cutoff — what matters is
    // that it is a real date and not an Invalid Date.
    const cutoff = retentionCutoff(1, new Date("2026-03-31T00:00:00Z"));
    expect(Number.isNaN(cutoff!.getTime())).toBe(false);
  });

  it("crosses a year end", () => {
    expect(retentionCutoff(2, new Date("2026-01-15T00:00:00Z"))?.toISOString()).toBe(
      "2025-11-15T00:00:00.000Z",
    );
  });

  it("refuses an absent value rather than reading it as zero", () => {
    // ⚠️ The one that matters. `Number(null)` is 0, and so is `Number("")` and
    // `Number(false)` — every one of them a perfectly valid-looking zero-month
    // retention, which is "delete everything". A `"retentionMonths": null` left
    // behind while editing the config would empty the table on the next tick
    // and report success.
    for (const bad of [null, undefined, "", "  ", false, true, [], {}, "twelve", NaN]) {
      expect(retentionCutoff(bad, NOW)).toBeNull();
    }
    for (const bad of [-1, -0.5]) {
      expect(retentionCutoff(bad, NOW)).toBeNull();
    }
  });

  it("allows a deliberate zero, written as a number", () => {
    // Somebody who genuinely wants nothing kept has to say so with a 0.
    expect(retentionCutoff(0, NOW)?.toISOString()).toBe(NOW.toISOString());
    expect(retentionCutoff("0", NOW)?.toISOString()).toBe(NOW.toISOString());
  });
});

describe("describeEvery", () => {
  it("says it the way a person would", () => {
    expect(describeEvery(1440)).toBe("daily");
    expect(describeEvery(2880)).toBe("every 2 days");
    expect(describeEvery(60)).toBe("hourly");
    expect(describeEvery(360)).toBe("every 6 h");
    expect(describeEvery(15)).toBe("every 15 min");
  });
});

describe("jobFindings", () => {
  /** One row of what `GET /api/cron?list` really answers, dates as STRINGS. */
  const row = (over: Record<string, unknown> = {}) => ({
    job: "prune-ai-usage",
    describe: "delete AI-usage rows older than the retention window",
    enabled: true,
    everyMinutes: 1440,
    lastStartedAt: null,
    lastFinishedAt: null,
    lockedAt: null,
    lastOutcome: null,
    lastDetail: null,
    runs: 0,
    failures: 0,
    ...over,
  });

  const RAN = "2026-08-10T03:00:00.000Z";

  it("an ENABLED job that has never run is a finding", () => {
    // The state this whole command exists to surface: on a week-old
    // installation it means the scheduler is not running, and it looks exactly
    // like every other line.
    expect(jobFindings([row()])).toEqual([
      { job: "prune-ai-usage", kind: "neverRun", severity: "medium", what: "enabled and has never run" },
    ]);
  });

  it("🚨 a job that is OFF and has never run is NOT a finding", () => {
    // It has correctly never run. `community-prune` and `courses-digest` ship
    // `enabledByDefault: false`, so every app that installs those modules is
    // this case on day one — a rule without this clause cries wolf on every
    // single install, and a summary nobody believes is a summary nobody reads.
    expect(jobFindings([row({ enabled: false })])).toEqual([]);
  });

  it("a job that has run and never failed is not a finding", () => {
    expect(jobFindings([row({ lastFinishedAt: RAN, runs: 9, failures: 0, lastOutcome: "ok" })])).toEqual(
      [],
    );
  });

  it("a non-zero failure count is a finding, and it carries the count", () => {
    expect(jobFindings([row({ lastFinishedAt: RAN, runs: 4, failures: 1 })])).toEqual([
      { job: "prune-ai-usage", kind: "failures", severity: "high", what: "1 of 4 run(s) failed" },
    ]);
  });

  it("a DISABLED job that failed before it was switched off is still a finding", () => {
    // Being switched off explains "never run"; it does not un-fail the runs
    // that already failed, and the rows are still in `cron_runs`.
    const findings = jobFindings([row({ enabled: false, lastFinishedAt: RAN, runs: 2, failures: 2 })]);
    expect(findings.map((finding) => finding.kind)).toEqual(["failures"]);
  });

  it("an empty list produces no findings — and does not throw", () => {
    // The list `formatEmpty()` prints for. A registry with no jobs is a state,
    // not a fault (scripts/cron/list-report.mjs), so it must not become one here.
    expect(jobFindings([])).toEqual([]);
    expect(jobFindings(null as never)).toEqual([]);
    expect(jobFindings([null, undefined] as never)).toEqual([]);
  });

  it("judges every job in the list, not only the first", () => {
    const findings = jobFindings([
      row({ job: "a" }),
      row({ job: "b", enabled: false }),
      row({ job: "c", lastFinishedAt: RAN, runs: 3, failures: 2 }),
    ]);
    expect(findings.map((finding) => `${finding.job}:${finding.kind}`)).toEqual([
      "a:neverRun",
      "c:failures",
    ]);
  });

  it("has no clock — overdue is deliberately NOT a third rule", () => {
    // A daily job that last finished five days ago is a real signal and needs a
    // `now` to see. It belongs with the verdict that owns one; this function
    // stays answerable from the row alone, which is why it can be called on a
    // remote app's JSON with no assumptions about either clock.
    expect(jobFindings([row({ lastFinishedAt: "1999-01-01T00:00:00.000Z", runs: 1 })])).toEqual([]);
  });

  it("🚨 uses the shipped severity ladder and invents no fifth word", () => {
    // CLAUDE.md: one ladder, one shape for a finding. `SEVERITIES` is the
    // list `security-check`, `ux-check` and the gateway skills all read; a
    // severity spelled `"warning"` here would print `•` and quietly leave this
    // command outside the vocabulary everything else in the app shares.
    const findings = jobFindings([row(), row({ job: "b", lastFinishedAt: RAN, runs: 1, failures: 1 })]);
    expect(findings.length).toBe(2);
    for (const finding of findings) expect(SEVERITIES).toContain(finding.severity);
  });
});

describe("overdueJobs", () => {
  /** The same row shape `GET /api/cron?list` answers with — dates as STRINGS. */
  const row = (over: Record<string, unknown> = {}) => ({
    job: "prune-ai-usage",
    enabled: true,
    everyMinutes: 1440,
    lastFinishedAt: null,
    ...over,
  });

  const NOW = new Date("2026-08-10T12:00:00.000Z");
  const minutesAgo = (minutes: number) =>
    new Date(NOW.getTime() - minutes * 60_000).toISOString();

  it("🚨 the needle: one minute inside the threshold is not a finding, one past it is", () => {
    // The whole rule, in both directions. A test that only planted the far side
    // would pass against a function that reports every job that ever ran.
    const threshold = 1440 * OVERDUE_FACTOR;
    expect(overdueJobs([row({ lastFinishedAt: minutesAgo(threshold) })], NOW)).toEqual([]);
    expect(overdueJobs([row({ lastFinishedAt: minutesAgo(threshold - 1) })], NOW)).toEqual([]);

    const past = overdueJobs([row({ lastFinishedAt: minutesAgo(threshold + 1) })], NOW);
    expect(past).toEqual([
      {
        job: "prune-ai-usage",
        kind: "overdue",
        severity: "medium",
        what: `last finished ${threshold + 1} min ago — over ${OVERDUE_FACTOR}× its 1440 min interval`,
      },
    ]);
  });

  it("⚠️ a job that has NEVER finished is not overdue by this rule", () => {
    // `lastFinishedAt` is null and nothing says when this app was deployed, so a
    // fresh app would otherwise report every job as overdue on its first minute.
    // `jobFindings()` reports never-run separately — that is the honest split.
    expect(overdueJobs([row({ lastFinishedAt: null })], NOW)).toEqual([]);
    expect(jobFindings([row({ runs: 0, failures: 0 })] as never).map((f) => f.kind)).toEqual([
      "neverRun",
    ]);
  });

  it("says nothing about a job that is switched off", () => {
    // It is not supposed to be running, so "it has not run" is the right answer.
    expect(
      overdueJobs([row({ enabled: false, lastFinishedAt: minutesAgo(100_000) })], NOW),
    ).toEqual([]);
  });

  it("scales with the job's OWN interval, not with a fixed number of days", () => {
    // Four hours late is nothing for a daily job and a stopped scheduler for one
    // that runs every fifteen minutes.
    const late = minutesAgo(240);
    expect(overdueJobs([row({ everyMinutes: 1440, lastFinishedAt: late })], NOW)).toEqual([]);
    expect(
      overdueJobs([row({ everyMinutes: 15, lastFinishedAt: late })], NOW).map((f) => f.job),
    ).toEqual(["prune-ai-usage"]);
  });

  it("falls back to the default interval when the row carries a nonsense one", () => {
    // `configuredNumber()`'s reasoning, applied here: `Number(null)` is 0, and a
    // zero interval would make every job that ever ran overdue.
    expect(overdueJobs([row({ everyMinutes: null, lastFinishedAt: minutesAgo(60) })], NOW)).toEqual(
      [],
    );
    expect(
      overdueJobs([row({ everyMinutes: null, lastFinishedAt: minutesAgo(99_999) })], NOW).length,
    ).toBe(1);
  });

  it("takes the ISO STRING the JSON carried, and a Date, and neither throws", () => {
    // ⚠️ `JobStatus` types this `Date | null` and it crossed JSON, so it is a
    // string. Both are accepted rather than one being "fixed" into the other.
    const over = minutesAgo(1440 * OVERDUE_FACTOR + 60);
    expect(overdueJobs([row({ lastFinishedAt: over })], NOW).length).toBe(1);
    expect(overdueJobs([row({ lastFinishedAt: new Date(over) })], NOW).length).toBe(1);
  });

  it("an unreadable timestamp is not a finding — it is an answer nobody can read", () => {
    expect(overdueJobs([row({ lastFinishedAt: "yesterday, I think" })], NOW)).toEqual([]);
  });

  it("survives an empty list, a null list and a broken clock", () => {
    expect(overdueJobs([], NOW)).toEqual([]);
    expect(overdueJobs(null as never, NOW)).toEqual([]);
    expect(overdueJobs([null, undefined] as never, NOW)).toEqual([]);
    expect(overdueJobs([row({ lastFinishedAt: minutesAgo(99_999) })], new Date("nope"))).toEqual([]);
  });

  it("🚨 uses the shipped severity ladder and invents no fifth word", () => {
    const findings = overdueJobs([row({ lastFinishedAt: minutesAgo(99_999) })], NOW);
    expect(findings.length).toBe(1);
    for (const finding of findings) expect(SEVERITIES).toContain(finding.severity);
  });
});

describe("configProblems", () => {
  const known = ["prune-ai-usage"];

  it("says nothing about a coherent file", () => {
    expect(configProblems({ enabled: true, jobs: { "prune-ai-usage": {} } }, known)).toEqual([]);
  });

  it("says nothing about a job that is simply not configured", () => {
    // Inheriting the defaults is normal, exactly as a declared AI task with no
    // binding is normal.
    expect(configProblems({ enabled: true }, known)).toEqual([]);
  });

  it("names a job that does not exist", () => {
    // The mistake that actually gets made — usually a rename — and it fails
    // silently, because a job nobody looks up is a job that never runs.
    const problems = configProblems({ jobs: { "prune-ai-usag": {} } }, known);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("prune-ai-usag");
    expect(problems[0]).toContain("prune-ai-usage");
  });

  it("names an interval that is not one", () => {
    const problems = configProblems({ jobs: { "prune-ai-usage": { everyMinutes: 0 } } }, known);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("everyMinutes");
  });

  it("refuses a file that is not the right shape", () => {
    expect(configProblems(null, known)).toHaveLength(1);
    expect(configProblems({ jobs: [] }, known)).toHaveLength(1);
    expect(configProblems({ jobs: { "prune-ai-usage": 5 } }, known)).toHaveLength(1);
  });
});

describe("the shipped config/cron.json", () => {
  it("is coherent", () => {
    // The same deal `tasks.test.ts` makes for the AI bindings: a second source
    // of truth is only safe while something checks it against the first. A
    // renamed job would otherwise ship as a job that never runs.
    expect(cronConfigProblems()).toEqual([]);
  });

  it("has the scheduler on, so a fresh install cleans up after itself", () => {
    expect(schedulerEnabled()).toBe(true);
  });

  it("keeps AI usage for twelve months", () => {
    const settings = jobSettings("prune-ai-usage");
    expect(settings.enabled).toBe(true);
    expect(settings.retentionMonths).toBe(AI_USAGE_RETENTION_MONTHS);
    expect(settings.everyMinutes).toBe(1440);
  });

  it("gives every registered job a unique id", () => {
    expect(new Set(JOB_IDS).size).toBe(JOB_IDS.length);
  });

  it("🚨 the one job that MAILS is an explicit decision, in both halves", () => {
    // Neither half is enough on its own, and both failure modes are quiet.
    //
    // The REGISTRY says off, so an operator who deletes the entry from
    // `config/cron.json` does not start getting mail by inheritance — no entry
    // means `JOB_DEFAULTS`, which is enabled AND daily.
    const registered = CRON_JOBS.find((job) => job.id === "ops-watchdog");
    expect(registered, "the watchdog is not in the registry").toBeDefined();
    expect(registered!.enabledByDefault).toBe(false);

    // The CONFIG says on, which is the decision somebody wrote down. And 360
    // rather than 1440: the send key is nailed to the UTC day while due-ness
    // counts from the last FINISH, so a daily interval drifts past midnight and
    // skips a day in silence — the trap `docs/cron.md` names by name.
    const settings = jobSettings("ops-watchdog", registered!.enabledByDefault);
    expect(settings.enabled).toBe(true);
    expect(settings.everyMinutes).toBe(360);
    expect(settings.everyMinutes).toBeLessThan(1440);
  });

  it("keeps ids.mjs and the registry in step", () => {
    // The names live in `ids.mjs` so that `config.ts` — and through it
    // `instrumentation.ts` — can validate the config without importing the
    // database. That split is only safe while something checks it: a job added
    // to the registry and not to the list would be a job nobody could
    // configure, reported as "does not exist" by the very file meant to
    // configure it.
    expect([...JOB_IDS].sort()).toEqual(CRON_JOBS.map((job) => job.id).sort());
  });

  it("gives every registered job a description, because --list prints it", () => {
    for (const job of CRON_JOBS) {
      expect(job.describe.length).toBeGreaterThan(10);
    }
  });
});

// ── `docs/cron.md`'s job table, against the list it is written from ──────────
//
// 🚨 The count in that document has drifted twice, and both times every gate
// stayed green. It said "Five jobs" and listed five while `./ids.mjs` held
// seven: `prune-setup-audit` had never been in it, and `prune-abandoned-uploads`
// arrived with a story that had no reason to open the file.
//
// Nothing here can compare prose against prose, and the condensate stamp points
// the other way — it fires when the DOCUMENT moves, which is exactly the
// direction the drift did not come from. What CAN be held is the table: it is a
// list of ids, and so is `./ids.mjs`.
//
// ⚠️ **The hatch is `cron-doc-ok`, on the id's line in `./ids.mjs`.** A job you
// add for your own app belongs in `./jobs.ts` and in that list, and it has no
// business in a document this template maintains and `node run.mjs update`
// replaces — so mark it and this check leaves it alone.
const DOC = join(process.cwd(), "docs", "cron.md");
const IDS_FILE = join(process.cwd(), "lib", "cron", "ids.mjs");
const DOC_EXEMPT = "cron-doc-ok";

/** The spelled-out numbers a section heading might use. */
const NUMBER_WORDS = [
  "no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen", "twenty",
];

/** The core ids as `ids.mjs` SPELLS them, with the ones marked exempt dropped. */
function documentedCoreIds(): { all: string[]; documented: string[] } {
  const source = readFileSync(IDS_FILE, "utf8");
  const lines = source.split(/\r?\n/);
  const code = blankComments(source).split(/\r?\n/);

  const start = code.findIndex((line) => line.includes("CORE_JOB_IDS"));
  const end = code.findIndex((line, index) => index > start && line.includes("]"));
  const all: string[] = [];
  const documented: string[] = [];
  for (let index = start; index <= end && start > -1; index += 1) {
    const match = /"([a-z0-9][a-z0-9-]*)"/.exec(code[index]);
    if (!match) continue;
    all.push(match[1]);
    if (!lines[index].includes(DOC_EXEMPT)) documented.push(match[1]);
  }
  return { all, documented };
}

describe("docs/cron.md lists the jobs this app really has", () => {
  const text = readFileSync(DOC, "utf8");
  const ships = text.slice(text.indexOf("\n## What ships"));
  const section = ships.slice(0, ships.indexOf("\n## ", 1));
  const { all, documented } = documentedCoreIds();
  const tabled = [...section.matchAll(/^\|\s*`([a-z0-9][a-z0-9-]*)`\s*\|/gm)].map((m) => m[1]);

  it("is reading the real table and the real list", () => {
    // Non-vacuity, both ends. A moved heading, a reformatted table or a
    // rewritten `ids.mjs` would otherwise compare two empty lists and pass.
    expect(section.length, "`## What ships` not found in docs/cron.md").toBeGreaterThan(200);
    expect(tabled.length, "no job ids found in the What-ships table").toBeGreaterThan(3);
    expect(
      all,
      "CORE_JOB_IDS could not be read out of lib/cron/ids.mjs as text",
    ).toEqual(JOB_IDS.filter((id) => !(MODULE_JOB_IDS as string[]).includes(id)));
  });

  it("🚨 names every core job, and no job that does not exist", () => {
    expect(
      tabled.filter((id) => !documented.includes(id)),
      `docs/cron.md's table names a job lib/cron/ids.mjs does not have.`,
    ).toEqual([]);
    expect(
      documented.filter((id) => !tabled.includes(id)),
      `lib/cron/ids.mjs has a core job docs/cron.md's table does not list — the ` +
        `document then describes last month's app, which is how "Five jobs" ` +
        `survived two additions. Add the row (and a "### \`<id>\`" section under ` +
        `it), or mark the id "${DOC_EXEMPT}" in ids.mjs if it is your app's own.`,
    ).toEqual([]);
  });

  it("🚨 the sentence above the table counts the same jobs", () => {
    // The half a table diff misses: somebody adds the row and leaves the word.
    const spelled = /^([A-Za-z]+) jobs\./m.exec(section);
    expect(spelled, "the sentence under `## What ships` no longer counts them").not.toBeNull();
    expect(
      NUMBER_WORDS.indexOf(spelled![1].toLowerCase()),
      `"${spelled![1]} jobs." does not count the ${tabled.length} rows under it`,
    ).toBe(tabled.length);
  });

  it("gives every job in the table a section of its own", () => {
    // The other thing that was missing both times: the row was easy to add,
    // the paragraph explaining the job was the part that got left out.
    expect(
      tabled.filter((id) => !text.includes(`### \`${id}\``)),
      "listed in the table with nothing written about them",
    ).toEqual([]);
  });
});
