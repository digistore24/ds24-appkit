// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `node run.mjs cron` is what an Operator runs when they want the work done now,
// and it had the defect `--list` was repaired for in Story 42.1, one function
// further along: `const results = body.results ?? [];` turned every answer it
// could not read — the other query's `{ jobs: [...] }`, another endpoint's `{}`,
// a body with no results key at all — into "Nothing to do — no job is due." and
// exit 0.
//
// So this file plants all of them. The three outcomes are asserted apart from
// each other, and the third is the one that is easy to get wrong: a run in which
// NO JOB WAS DUE is the ordinary state of a manual run and must stay a clean
// exit 0. That state is a full `results` array of `skipped` rows — never an
// empty one, because `runDueJobs()` reports on every registered job.
//
// Pure — no network, no spawn, no filesystem; this file is inside `make check`
// by construction (`vitest.config.ts` includes every `**/*.test.ts`), so
// anything else here would be a gate nobody asked for.

import { describe, expect, it } from "vitest";

import {
  resultsFrom,
  knownJobs,
  emptyRunVerdict,
  jobResultFrom,
  isUnknownJob,
  formatUnknownJob,
  formatRunRefusal,
  formatRunSummary,
} from "./run-report.mjs";

const URL = "http://127.0.0.1:3000/api/cron";
const AT = { status: 200, url: URL };

/** The registry of a shipped app, shortened — what `known` carries. */
const KNOWN = ["prune-ai-usage", "prune-ipn-log", "check-stuck-reloads"];

/** One row of a real answer: the job existed and was not due. */
const SKIPPED = { job: "prune-ai-usage", outcome: "skipped", detail: "not due, or already running", ms: 0 };
const OK = { job: "prune-ipn-log", outcome: "ok", detail: "12 row(s) deleted", ms: 34 };
const FAILED = { job: "check-stuck-reloads", outcome: "failed", detail: "connection refused", ms: 7 };

describe("resultsFrom", () => {
  it("takes the results when they are there", () => {
    const result = resultsFrom({ results: [SKIPPED, OK], known: KNOWN }, AT);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.results).toHaveLength(2);
  });

  it("an EMPTY array is an answer, not a parse fault — what it MEANS is the next question", () => {
    const result = resultsFrom({ results: [], known: [] }, AT);
    expect(result.ok).toBe(true);
  });

  it.each([
    ["the key absent", {}],
    ["results: null", { results: null }],
    ["results not an array", { results: "seven" }],
    ["the OTHER query's shape", { jobs: [] }],
    ["a bare null body", null],
    ["a JSON array", []],
  ])("refuses %s", (_name, body) => {
    const result = resultsFrom(body, AT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.kind).toBe("noResults");
  });

  it.each([
    ["an empty object row", { results: [{}] }],
    ["a null row", { results: [null] }],
    ["a row with an empty job name", { results: [{ job: "", outcome: "ok" }] }],
  ])("refuses %s — it would print `undefined` and exit 0", (_name, body) => {
    const result = resultsFrom(body, AT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.kind).toBe("badResults");
  });

  it("🚨 the needle: an answer with no results really does produce a non-zero verdict", () => {
    // The needle probe this repo asks of every check that can pass by finding
    // nothing (`scripts/lib/source-text.test.ts`, `lib/setup/guard-presence.test.ts`).
    // `{ jobs: [] }` is the sharpest near-miss — it is what the SAME endpoint
    // answers one query along, so a command pointed at `?list` would get it —
    // and `{}` is what any other JSON endpoint on that port answers. A decision
    // function broken back into `body.results ?? []` would call both of these a
    // clean run with nothing due, and this is the assertion that would go red.
    for (const body of [{ jobs: [] }, {}, { results: [{}] }]) {
      const result = resultsFrom(body, AT);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");

      // …and what gets printed is a refusal, not a report: nothing that reads as
      // a run that found nothing to do.
      const printed = formatRunRefusal(result).join("\n");
      expect(printed).toContain("ERROR:");
      expect(printed).not.toContain("Nothing was due");
      expect(printed).not.toContain("Nothing to do");
    }
  });
});

describe("knownJobs", () => {
  it("reads the registry the app named", () => {
    expect(knownJobs({ results: [], known: KNOWN })).toEqual(KNOWN);
  });

  it("an EMPTY registry is something the app SAID — never null", () => {
    expect(knownJobs({ results: [], known: [] })).toEqual([]);
  });

  it.each([
    ["the key absent", { results: [] }],
    ["known: null", { results: [], known: null }],
    ["known not an array", { results: [], known: "seven" }],
    ["known with a non-string in it", { results: [], known: ["a", 7] }],
    ["a bare null body", null],
  ])("says nothing was named for %s", (_name, body) => {
    expect(knownJobs(body)).toBeNull();
  });
});

describe("emptyRunVerdict — the three answers an empty `results` can carry", () => {
  it("🚨 an app that says it has no jobs is a STATE, not a fault", () => {
    // The case this file must NOT turn into an error. The core registers seven
    // jobs, so it does not occur in a shipped app — which is exactly why the
    // over-correction is the tempting one.
    const verdict = emptyRunVerdict([], AT);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error("unreachable");
    const printed = verdict.lines.join("\n");
    expect(printed).toContain("No jobs are registered");
    expect(printed).not.toContain("ERROR");
    expect(printed).not.toContain("could not");
    for (const glyph of ["🚨", "❌", "⚠️", "ℹ️", "✗"]) expect(printed).not.toContain(glyph);
  });

  it("an app that knows jobs and reported on none is a refusal, and the count is in it", () => {
    const verdict = emptyRunVerdict(KNOWN, AT);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.kind).toBe("ranNothing");
    expect(formatRunRefusal(verdict)).toContain("ERROR: the app knows 3 job(s) and reported on none of them.");
  });

  it("an app that did not say what it knows is a refusal — never 'nothing was due'", () => {
    const verdict = emptyRunVerdict(null, AT);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.kind).toBe("noRegistry");
  });
});

describe("jobResultFrom", () => {
  it("takes the one result the endpoint sends", () => {
    const one = jobResultFrom([OK], { job: "prune-ipn-log", ...AT });
    expect(one.ok).toBe(true);
  });

  it.each([
    ["an empty array", []],
    ["not an array at all", null],
  ])("refuses %s — silence about the job that was named", (_name, results) => {
    const one = jobResultFrom(results, { job: "prune-ipn-log", ...AT });
    expect(one.ok).toBe(false);
    if (one.ok) throw new Error("unreachable");
    expect(one.kind).toBe("noJobResult");
    expect(formatRunRefusal(one).join("\n")).toContain("prune-ipn-log");
  });
});

describe("isUnknownJob — 'I do not know that job' is not 'that job failed'", () => {
  it("reads the 404 the endpoint answers for exactly this", () => {
    // `route.ts` answers 404 when and only when `runJobById()` found no such job,
    // and it has always done so — this arm still works against a deployed app
    // older than the `known` field.
    expect(isUnknownJob({ status: 404, known: null, job: "nosuchjob" })).toBe(true);
  });

  it("reads the registry when the app sent one", () => {
    expect(isUnknownJob({ status: 200, known: KNOWN, job: "nosuchjob" })).toBe(true);
  });

  it("🚨 a job that really ran and failed is NOT an unknown job", () => {
    // The confusion this exists to end. A failing job answers 200 with a failed
    // result; treating it as a typo would hide a broken deletion behind a
    // spelling complaint.
    expect(isUnknownJob({ status: 200, known: KNOWN, job: "check-stuck-reloads" })).toBe(false);
    expect(isUnknownJob({ status: 200, known: null, job: "check-stuck-reloads" })).toBe(false);
  });
});

describe("formatUnknownJob", () => {
  it("names the job, what the app has, and where to look", () => {
    const printed = formatUnknownJob("prune-ai-usag", KNOWN, { url: URL }).join("\n");
    expect(printed).toContain('no scheduled job called "prune-ai-usag"');
    expect(printed).toContain("prune-ai-usage");
    expect(printed).toContain(URL);
    expect(printed).toContain("node run.mjs cron --list");
  });

  it("says less rather than something wrong when the app named no registry", () => {
    const lines = formatUnknownJob("nosuchjob", null, { url: URL });
    expect(lines.join("\n")).not.toContain("it knows:");
    expect(lines[lines.length - 1]).toContain("node run.mjs cron --list");
  });
});

describe("formatRunRefusal", () => {
  const kinds = [
    { kind: "noResults", status: 200, url: URL },
    { kind: "badResults", status: 200, url: URL },
    { kind: "noRegistry", status: 200, url: URL },
    { kind: "ranNothing", status: 200, url: URL, count: 7 },
    { kind: "noJobResult", status: 200, url: URL, job: "prune-ai-usage" },
  ];

  it("names the status and the URL for every kind — a bare 'could not read' is what this replaces", () => {
    for (const result of kinds) {
      const printed = formatRunRefusal(result).join("\n");
      expect(printed).toContain("status:  200");
      expect(printed).toContain(URL);
    }
  });

  it("says what to do next, in the register the neighbouring branches use", () => {
    for (const result of kinds) {
      const lines = formatRunRefusal(result);
      expect(lines[0].startsWith("ERROR:")).toBe(true);
      expect(lines[lines.length - 1]).toContain("node run.mjs");
    }
  });

  it("🚨 no refusal line can be mistaken for a job's line", () => {
    // `deploy-test.mjs` finds a job's line with `l.trim().startsWith(id)` over
    // stdout AND stderr concatenated. It reads `cron --list`, not this command —
    // but the two are one script, and a line that could be read as a job's line
    // has no business in either.
    const ids = ["community-prune", "courses-digest", "prune-ai-usage", "prune-ipn-log"];
    const lines = [
      ...kinds.flatMap((result) => formatRunRefusal(result)),
      ...formatUnknownJob("prune-ai-usage", KNOWN, { url: URL }),
    ];
    for (const line of lines) {
      for (const id of ids) expect(line.trim().startsWith(id)).toBe(false);
    }
  });
});

describe("formatRunSummary", () => {
  it("🚨 a run in which nothing was due says so, and it is not a finding", () => {
    // The legitimate case of the bare run, and the one this story must not turn
    // red: every registered job answered `skipped`. This is what a manual run
    // gets almost every time.
    const line = formatRunSummary([SKIPPED, { ...SKIPPED, job: "prune-ipn-log" }]);
    expect(line).toBe("Nothing was due — 2 job(s) checked, none of them ran.");
    expect(line).not.toContain("ERROR");
    expect(line.startsWith("✗")).toBe(false);
  });

  it("counts what ran when something did", () => {
    expect(formatRunSummary([SKIPPED, OK])).toBe("✓ 1 of 2 job(s) ran, none failed.");
  });

  it("leads with the failures when there are any", () => {
    expect(formatRunSummary([SKIPPED, OK, FAILED])).toBe("✗ 1 of 3 job(s) failed.");
  });

  it("🚨 never begins with a job id — the same line rule the listing keeps", () => {
    const ids = ["prune-ai-usage", "prune-ipn-log", "check-stuck-reloads"];
    for (const results of [[SKIPPED], [SKIPPED, OK], [FAILED]]) {
      const line = formatRunSummary(results);
      for (const id of ids) expect(line.trim().startsWith(id)).toBe(false);
    }
  });
});
