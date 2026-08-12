// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `node run.mjs cron --list` is how an operator finds out whether their jobs
// run, and it used to have two ways of saying "everything is fine" when it had
// learned nothing at all: `await response.json()` threw undici's own stack when
// a proxy answered HTML, and `body.jobs ?? []` printed the header, looped zero
// times and exited 0 when the answer carried no job list.
//
// So this file plants both. Every case below is an answer the command can
// really receive, and the three outcomes are asserted apart from each other:
// unreadable and no-job-list are refusals, an EMPTY list is a legitimate state
// that must stay exit 0. Pure — no network, no spawn, no filesystem; this file
// is inside `make check` by construction (vitest.config.ts includes every
// `**/*.test.ts`), so anything else here would be a gate nobody asked for.

import { describe, expect, it } from "vitest";

import { jobFindings } from "@/lib/cron/rules.mjs";

import {
  firstLine,
  readBody,
  jobsFrom,
  formatRefusal,
  formatEmpty,
  formatJob,
  formatFindingsSummary,
} from "./list-report.mjs";

const URL = "http://127.0.0.1:3000/api/cron?list";
const AT = { status: 200, url: URL };

/** What a hosting provider's or a proxy's error page really looks like. */
const HTML = "<!DOCTYPE html><html><body>502 Bad Gateway</body></html>";

/** The shape app/api/cron/route.ts answers `?list` with, one row of it. */
const JOB = {
  job: "community-prune",
  describe: "deletes private messages past the retention window",
  enabled: false,
  everyMinutes: 1440,
  lastFinishedAt: null,
  lastOutcome: null,
  lastDetail: null,
  lockedAt: null,
  runs: 0,
  failures: 0,
};

const describeEvery = (minutes: number) => (minutes === 1440 ? "daily" : `every ${minutes} min`);
const ago = (iso: string | null) => (iso ? "just now" : "never");

describe("firstLine", () => {
  it("quotes the first non-empty line", () => {
    expect(firstLine("\n\n  502 Bad Gateway  \nsomething else\n")).toBe("502 Bad Gateway");
  });

  it("splits on CRLF too — a proxy on a Windows host is exactly this case", () => {
    expect(firstLine("\r\n502 Bad Gateway\r\nmore\r\n")).toBe("502 Bad Gateway");
  });

  it("makes the truncation visible rather than cutting silently", () => {
    const sample = firstLine("x".repeat(400));
    expect(sample).not.toBeNull();
    expect(sample!.length).toBeLessThan(200);
    expect(sample).toContain("(truncated)");
  });

  it("has nothing to quote for an empty or whitespace-only body", () => {
    expect(firstLine("")).toBeNull();
    expect(firstLine("   \n\t\n  ")).toBeNull();
  });
});

describe("readBody", () => {
  it("refuses an HTML error page and names status, url and what it got", () => {
    const result = readBody({ ...AT, text: HTML });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.kind).toBe("unreadable");
    expect(result.status).toBe(200);
    expect(result.url).toBe(URL);
    expect(result.sample).toContain("502 Bad Gateway");
  });

  it("refuses Next's own 404 page — the concrete hole above the parse", () => {
    // `:115` lets a 404 through on purpose, because `?job=<unknown>` answers
    // 404 with JSON. A 404 from anything ELSE on that port is HTML.
    const result = readBody({ status: 404, url: URL, text: "<html>404 — This page could not be found</html>" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.status).toBe(404);
  });

  it("says the answer was empty rather than quoting nothing", () => {
    const result = readBody({ ...AT, text: "" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.sample).toBeNull();
    expect(formatRefusal(result).join("\n")).toContain("empty");
  });

  it("reads the real answer", () => {
    const result = readBody({ ...AT, text: JSON.stringify({ jobs: [JOB] }) });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.body).toEqual({ jobs: [JOB] });
  });

  it("parses JSON that is not an object at all — the refusal is jobsFrom's job", () => {
    // An array and a bare `null` are valid JSON. Nothing is unreadable about
    // them; they simply carry no job list, which is the next question.
    expect(readBody({ ...AT, text: "[]" }).ok).toBe(true);
    expect(readBody({ ...AT, text: "null" }).ok).toBe(true);
  });
});

describe("jobsFrom", () => {
  it("takes the list when it is there", () => {
    const result = jobsFrom({ jobs: [JOB] }, AT);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.jobs).toHaveLength(1);
  });

  it("an EMPTY array is a list, not a fault", () => {
    // 🚨 The case this story must not break. `CRON_JOBS` has seven core
    // entries, so this does not occur in a shipped app — which is exactly why
    // the over-correction (making it an error) is the tempting one.
    const result = jobsFrom({ jobs: [] }, AT);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.jobs).toEqual([]);
  });

  it.each([
    ["the key absent", {}],
    ["jobs: null", { jobs: null }],
    ["jobs not an array", { jobs: "seven" }],
    ["the OTHER endpoint shape", { results: [] }],
    ["a bare null body", null],
    ["a JSON array", []],
  ])("refuses %s", (_name, body) => {
    const result = jobsFrom(body, AT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.kind).toBe("noJobList");
  });

  it("🚨 the needle: a body with no job list really does produce a non-zero verdict", () => {
    // The needle probe this repo asks of every check that can pass by finding
    // nothing (scripts/lib/source-text.test.ts, lib/setup/guard-presence.test.ts).
    // `{ results: [] }` is the sharpest near-miss — it is what `/api/cron?job=…`
    // answers, so a command pointed at the wrong query would get it — and `{}`
    // is what any other JSON endpoint on that port answers. A decision function
    // that had been broken back into `body.jobs ?? []` would call both of these
    // a clean run, and this is the assertion that would go red.
    for (const body of [{ results: [] }, {}]) {
      const result = jobsFrom(body, AT);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");

      // …and what gets printed for that case is a refusal, not a report: no
      // header, and no footer that would read as a successful run.
      const printed = formatRefusal(result).join("\n");
      expect(printed).not.toContain("Scheduled jobs (config/cron.json):");
      expect(printed).not.toContain("Run one now:");
      expect(printed).toContain("without a job list");
    }
  });
});

describe("formatRefusal", () => {
  it("names the status and the URL — a bare 'could not read' is the message this replaces", () => {
    const unreadable = readBody({ status: 502, url: URL, text: HTML });
    if (unreadable.ok) throw new Error("unreachable");
    const printed = formatRefusal(unreadable).join("\n");
    expect(printed).toContain("502");
    expect(printed).toContain(URL);
    expect(printed).toContain("502 Bad Gateway");

    const noList = jobsFrom({ results: [] }, { status: 200, url: URL });
    if (noList.ok) throw new Error("unreachable");
    const printedList = formatRefusal(noList).join("\n");
    expect(printedList).toContain("200");
    expect(printedList).toContain(URL);
  });

  it("says what to do next, in the register the neighbouring branches use", () => {
    const unreadable = readBody({ ...AT, text: HTML });
    if (unreadable.ok) throw new Error("unreachable");
    for (const result of [unreadable, jobsFrom({}, AT)]) {
      const lines = formatRefusal(result as never);
      expect(lines[0].startsWith("ERROR:")).toBe(true);
      expect(lines[lines.length - 1]).toContain("node run.mjs");
    }
  });

  it("🚨 no refusal line can be mistaken for a job's line", () => {
    // deploy-test.mjs finds a job's line with `l.trim().startsWith(id)` over
    // stdout AND stderr concatenated. A finding that began with a job id would
    // be read as that job's line and turn the release red about a module job it
    // could no longer find.
    const ids = ["community-prune", "courses-digest", "prune-ai-usage", "prune-ipn-log"];
    const unreadable = readBody({ ...AT, text: HTML });
    if (unreadable.ok) throw new Error("unreachable");
    const lines = [...formatRefusal(unreadable), ...formatRefusal(jobsFrom({}, AT) as never)];
    for (const line of lines) {
      for (const id of ids) expect(line.trim().startsWith(id)).toBe(false);
    }
  });
});

describe("formatEmpty", () => {
  it("is a state, not a fault", () => {
    const printed = formatEmpty().join("\n");
    expect(printed).toContain("No jobs are registered");
    expect(printed).not.toContain("ERROR");
    expect(printed).not.toContain("could not");
    for (const glyph of ["🚨", "❌", "⚠️", "ℹ️", "✗"]) expect(printed).not.toContain(glyph);
  });
});

describe("formatJob", () => {
  const lines = formatJob(JOB, { describeEvery, ago });

  it("keeps the property deploy-test-modules finds the job by", () => {
    // `cron.out.split(/\r?\n/).find((l) => l.trim().startsWith(id))` —
    // deploy-test.mjs:502. One extra leading character and the module job is
    // "not in cron --list".
    const line = lines.find((l) => l.trim().startsWith("community-prune"));
    expect(line).toBeDefined();
    expect(line!.trim().startsWith("community-prune")).toBe(true);
  });

  it("keeps the property deploy-test-modules reads the job's STATE by", () => {
    // `!/OFF/.test(line)` — deploy-test.mjs:509. A disabled module job must
    // still say OFF on its own line, with nothing inserted between the id and
    // the state.
    const line = lines.find((l) => l.trim().startsWith("community-prune"))!;
    expect(/OFF/.test(line)).toBe(true);
  });

  it("prints the block run.mjs has always printed", () => {
    expect(lines).toEqual([
      "  community-prune  —  OFF",
      "    deletes private messages past the retention window",
      "    last run: never",
      "",
    ]);
  });

  it("carries the outcome, the failures and the lock when there are any", () => {
    const busy = {
      ...JOB,
      job: "prune-ai-usage",
      enabled: true,
      lastFinishedAt: "2026-08-10T00:00:00.000Z",
      lastOutcome: "ok",
      lastDetail: "deleted 3 rows",
      lockedAt: "2026-08-10T00:00:00.000Z",
      runs: 4,
      failures: 1,
    };
    expect(formatJob(busy, { describeEvery, ago })).toEqual([
      "  prune-ai-usage  —  daily",
      "    deletes private messages past the retention window",
      "    last run: just now (ok) — deleted 3 rows",
      "    ⚠ 1 of 4 run(s) failed",
      "    running since just now",
      "",
    ]);
  });
});

// ── The findings: two states that are not rows ───────────────────────────────
//
// A listing where every block looks the same is a listing an operator skims,
// and the two states below are the ones that mean the scheduler stopped while
// looking exactly like the rest.

describe("formatJob with findings", () => {
  const enabledNeverRun = { ...JOB, job: "prune-ai-usage", enabled: true };

  it("marks the `last run:` line of an enabled job that has never run", () => {
    const lines = formatJob(enabledNeverRun, {
      describeEvery,
      ago,
      findings: jobFindings([enabledNeverRun]),
    });
    expect(lines).toEqual([
      "  prune-ai-usage  —  daily",
      "    deletes private messages past the retention window",
      "    ⚠️ last run: never",
      "",
    ]);
  });

  it("marks the failure line with the ladder's HIGH glyph, not the old ⚠", () => {
    const failing = {
      ...JOB,
      job: "prune-ai-usage",
      enabled: true,
      lastFinishedAt: "2026-08-10T00:00:00.000Z",
      runs: 4,
      failures: 1,
    };
    const printed = formatJob(failing, {
      describeEvery,
      ago,
      findings: jobFindings([failing]),
    }).join("\n");
    expect(printed).toContain("    ❌ 1 of 4 run(s) failed");
    expect(printed).not.toContain("⚠ 1 of 4");
  });

  it("🚨 an OFF job that never ran is marked with nothing at all", () => {
    // The shipped state of `community-prune` on the day the module is added.
    // `deploy-test-modules` asserts that job arrives OFF; a marker on it would
    // also be a false alarm in every fresh install.
    expect(formatJob(JOB, { describeEvery, ago, findings: jobFindings([JOB]) })).toEqual([
      "  community-prune  —  OFF",
      "    deletes private messages past the retention window",
      "    last run: never",
      "",
    ]);
  });

  it("🚨 a marked job is still found by deploy-test-modules, and still says OFF", () => {
    // The regression this whole design is arranged around. `deploy-test.mjs`
    // finds a job with `l.trim().startsWith(id)` and reads its state with
    // `/OFF/`. Put the glyph on the header — the obvious place, because that is
    // where the eye goes — and the module profile goes red claiming the job is
    // "not in cron --list".
    //
    // BOTH markers are planted, because they reach the header by different
    // edits: a disabled job can only ever carry the failure marker, an enabled
    // one only the never-run marker, so one fixture would leave half the
    // surface unmeasured.
    const cases = [
      { id: "community-prune", job: { ...JOB, runs: 3, failures: 3 }, mark: "❌ 3 of 3 run(s) failed" },
      { id: "prune-ai-usage", job: { ...JOB, job: "prune-ai-usage", enabled: true }, mark: "⚠️ last run:" },
    ];

    for (const { id, job, mark } of cases) {
      const lines = formatJob(job, { describeEvery, ago, findings: jobFindings([job]) });

      // The header is the FIRST line and carries the id with nothing before it
      // but its indent — `.find(startsWith(id))` on a decorated header would
      // return undefined, which is what "not in cron --list" is made of.
      expect(lines[0]).toBe(`  ${id}  —  ${job.enabled ? "daily" : "OFF"}`);
      expect(lines[0].trim().startsWith(id)).toBe(true);
      if (!job.enabled) expect(/OFF/.test(lines[0])).toBe(true);

      // …and the finding really is being rendered somewhere, so the assertions
      // above are not green merely because nothing was marked at all.
      expect(lines.join("\n")).toContain(mark);
    }
  });
});

describe("formatFindingsSummary", () => {
  const ids = ["community-prune", "courses-digest", "prune-ai-usage", "prune-ipn-log"];

  it("says so plainly when there is nothing to report", () => {
    const line = formatFindingsSummary([]);
    expect(line).toContain("No findings");
    expect(line.startsWith("✓")).toBe(true);
  });

  it("counts the two kinds apart and leads with the worst severity", () => {
    const jobs = [
      { ...JOB, job: "a", enabled: true },
      { ...JOB, job: "b", enabled: true },
      { ...JOB, job: "c", lastFinishedAt: "2026-08-10T00:00:00.000Z", runs: 2, failures: 2 },
    ];
    const line = formatFindingsSummary(jobFindings(jobs));
    expect(line.startsWith("❌")).toBe(true);
    expect(line).toContain("3 finding(s)");
    expect(line).toContain("2 enabled job(s) have never run");
    expect(line).toContain("1 job(s) have failing runs");
  });

  it("stays at MEDIUM when nothing failed", () => {
    const line = formatFindingsSummary(jobFindings([{ ...JOB, job: "a", enabled: true }]));
    expect(line.startsWith("⚠️")).toBe(true);
    expect(line).not.toContain("failing runs");
  });

  it("🚨 never begins with a job id — deploy-test reads lines that way", () => {
    const lines = [
      formatFindingsSummary([]),
      formatFindingsSummary(jobFindings([{ ...JOB, job: "prune-ai-usage", enabled: true }])),
      formatFindingsSummary(
        jobFindings([{ ...JOB, job: "community-prune", runs: 1, failures: 1 }]),
      ),
    ];
    for (const line of lines) for (const id of ids) expect(line.trim().startsWith(id)).toBe(false);
  });

  it("🚨 the needle: a fresh app's listing really does end in a finding line", () => {
    // Every enabled job of a freshly deployed app reports `never`. A summary
    // that said "No findings" there would be the exact failure mode this line
    // exists to prevent — a green sentence produced by a check that looked at
    // nothing. So: plant the fresh-app answer and prove the sentence turns.
    const fresh = [
      { ...JOB, job: "prune-ai-usage", enabled: true },
      { ...JOB, job: "prune-ipn-log", enabled: true },
      { ...JOB, job: "community-prune", enabled: false }, // ships OFF — not a finding
    ];
    const line = formatFindingsSummary(jobFindings(fresh));
    expect(line).not.toContain("No findings");
    expect(line).toContain("2 finding(s)");
  });
});
