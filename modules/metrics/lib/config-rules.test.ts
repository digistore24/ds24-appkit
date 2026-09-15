// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The metrics module's config reader and its three readings, executed.
//
// Measured 2026-09-15: `modules/metrics` stood at 3.6 % — `rules.test.ts`
// covers the hash, the variant pick and the pairwise verdict, and nothing else
// in the module had ever run under a test. The module ships OFF and
// `deploy-test-modules` installs it without switching it on, so a broken
// config reader would be found by the first operator who edits the file. The
// reader's whole job is to REPORT a mistyped key rather than ignore it; that is
// what these cases pin.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_RETENTION_DAYS,
  experimentsIn,
  funnelStepsIn,
  isEnabledIn,
  offReasonIn,
  problemsIn,
  retentionDaysIn,
} from "./config-rules.mjs";
import { cohortsFrom, funnelReadingFrom, splitReadingFrom } from "../rules.mjs";

const AB = {
  id: "welcome-copy",
  exposure: "welcome_seen",
  goal: "first_note",
  variants: [
    { id: "a", weight: 1 },
    { id: "b", weight: 1 },
  ],
};

const GOOD = { enabled: true, retentionDays: 90, funnel: ["signup", "first_note", "paid"], experiments: [AB] };

describe("problemsIn — a mistyped key is reported, never ignored", () => {
  it("a coherent file has no problems, and underscore keys are for prose", () => {
    expect(problemsIn(GOOD)).toEqual([]);
    expect(problemsIn({ ...GOOD, _comment: "why" })).toEqual([]);
  });

  it("names every unknown field — a misspelt key is a setting somebody believes they made", () => {
    expect(problemsIn({ ...GOOD, enabeld: true, funnels: [] })).toEqual([
      'unknown field "enabeld"',
      'unknown field "funnels"',
    ]);
  });

  it.each([
    [{ enabled: "yes" }, '"enabled" must be true or false, not "yes"'],
    [{ enabled: 1 }, '"enabled" must be true or false, not 1'],
    [{ retentionDays: 0 }, '"retentionDays" must be a number above zero'],
    [{ retentionDays: -3 }, '"retentionDays" must be a number above zero'],
    [{ retentionDays: "400" }, '"retentionDays" must be a number above zero'],
    [{ funnel: "signup" }, '"funnel" must be a list of event ids'],
    [{ experiments: {} }, '"experiments" must be a list'],
  ])("%j → %s", (over, problem) => {
    expect(problemsIn({ ...GOOD, ...over })).toContain(problem);
  });

  it("an experiment that is ignored says WHAT it lacks", () => {
    const problems = problemsIn({
      ...GOOD,
      experiments: [
        { id: "no-goal", exposure: "x", variants: AB.variants },
        { exposure: "x", goal: "y", variants: AB.variants },
        { id: "no-variants", exposure: "x", goal: "y", variants: [] },
        { id: "bad-weights", exposure: "x", goal: "y", variants: [{ id: "a", weight: "1" }] },
      ],
    });
    expect(problems).toContain("experiment no-goal is ignored — it needs goal");
    expect(problems).toContain("experiment (an entry with no id) is ignored — it needs id");
    expect(problems).toContain(
      "experiment no-variants is ignored — it needs at least one variant with a numeric weight",
    );
    expect(problems).toContain(
      "experiment bad-weights is ignored — it needs at least one variant with a numeric weight",
    );
  });

  it("a funnel step named twice, two experiments with one id, a variant named twice", () => {
    const problems = problemsIn({
      ...GOOD,
      funnel: ["signup", "paid", "signup"],
      experiments: [
        AB,
        { ...AB, variants: [{ id: "a", weight: 1 }, { id: "a", weight: 1 }] },
      ],
    });
    expect(problems).toContain('funnel names "signup" twice');
    expect(problems).toContain('two experiments share the id "welcome-copy"');
    expect(problems).toContain('experiment "welcome-copy" names the variant "a" twice');
  });

  it("🚨 an experiment with one variant compares nothing", () => {
    expect(problemsIn({ ...GOOD, experiments: [{ ...AB, variants: [{ id: "a", weight: 1 }] }] })).toContain(
      'experiment "welcome-copy" needs at least two variants to compare',
    );
  });

  it("a file that is not an object is read as empty rather than thrown on", () => {
    expect(problemsIn(null)).toEqual([]);
    expect(problemsIn([1, 2])).toEqual([]);
    expect(problemsIn("x")).toEqual([]);
  });
});

describe("the readers — lenient where the reporter is strict", () => {
  it("funnelStepsIn keeps only non-empty strings, in order", () => {
    expect(funnelStepsIn({ funnel: ["a", "", 3, null, "b"] })).toEqual(["a", "b"]);
    expect(funnelStepsIn({ funnel: "a" })).toEqual([]);
    expect(funnelStepsIn(undefined)).toEqual([]);
  });

  it("experimentsIn drops what it cannot use and normalises the variant shape", () => {
    const [only] = experimentsIn({
      experiments: [
        null,
        { id: "x", exposure: "e", goal: "g", variants: [{ id: "a", weight: 2, extra: true }, { id: "b" }] },
      ],
    });
    expect(only).toEqual({ id: "x", exposure: "e", goal: "g", variants: [{ id: "a", weight: 2 }] });
  });

  it("retentionDaysIn floors, and falls back to the default on anything unusable", () => {
    expect(retentionDaysIn({ retentionDays: 30.9 })).toBe(30);
    expect(retentionDaysIn({ retentionDays: 0 })).toBe(DEFAULT_RETENTION_DAYS);
    expect(retentionDaysIn({ retentionDays: "30" })).toBe(DEFAULT_RETENTION_DAYS);
    expect(retentionDaysIn({ retentionDays: Number.POSITIVE_INFINITY })).toBe(DEFAULT_RETENTION_DAYS);
    expect(retentionDaysIn({})).toBe(DEFAULT_RETENTION_DAYS);
  });

  it("isEnabledIn is the literal true and nothing that looks like it", () => {
    expect(isEnabledIn({ enabled: true })).toBe(true);
    expect(isEnabledIn({ enabled: "true" })).toBe(false);
    expect(isEnabledIn({ enabled: 1 })).toBe(false);
    expect(isEnabledIn({})).toBe(false);
  });

  it("offReasonIn — off by config first, then broken, then null", () => {
    expect(offReasonIn({ enabled: false })).toBe("disabledInConfig");
    expect(offReasonIn({ enabled: true, retentionDays: -1 })).toBe("brokenConfig");
    expect(offReasonIn(GOOD)).toBeNull();
  });
});

describe("funnelReadingFrom — declared steps in order, and what nobody declared", () => {
  const rows = [
    { event: "paid", members: 20, events: 25 },
    { event: "signup", members: 100, events: 100 },
    { event: "first_note", members: 60, events: 300 },
    { event: "frist_note", members: 7, events: 7 },
    { event: "shared", members: 12, events: 40 },
  ];

  it("reads the declared steps in the declared order, as shares of the first", () => {
    const { rows: read } = funnelReadingFrom(rows, ["signup", "first_note", "paid"]);
    expect(read.map((r) => r.id)).toEqual(["signup", "first_note", "paid"]);
    expect(read.map((r) => r.share)).toEqual([1, 0.6, 0.2]);
    expect(read.map((r) => r.lost)).toEqual([0, 40, 40]);
    expect(read.map((r) => r.events)).toEqual([100, 300, 25]);
  });

  it("🚨 surfaces the recorded events no step names — a mistyped track() id is found here or never", () => {
    const { unlisted } = funnelReadingFrom(rows, ["signup", "first_note", "paid"]);
    expect(unlisted).toEqual([
      { event: "shared", members: 12 },
      { event: "frist_note", members: 7 },
    ]);
  });

  it("a declared step nobody reached is a zero row, not a missing one", () => {
    const { rows: read } = funnelReadingFrom(rows, ["signup", "upgraded"]);
    expect(read[1]).toMatchObject({ id: "upgraded", members: 0, share: 0, lost: 100, events: 0 });
  });

  it("an empty funnel reads as nothing, with everything unlisted", () => {
    const reading = funnelReadingFrom(rows, []);
    expect(reading.rows).toEqual([]);
    expect(reading.unlisted).toHaveLength(5);
  });
});

describe("cohortsFrom — one row per cohort, shares per week, newest first", () => {
  const rows = [
    { cohort: "2026-W36", week: 0, members: 40 },
    { cohort: "2026-W36", week: 1, members: 20 },
    { cohort: "2026-W36", week: 2, members: 10 },
    { cohort: "2026-W37", week: 0, members: 10 },
    { cohort: "2026-W37", week: 1, members: 5 },
    { cohort: "2026-W37", week: 9, members: 5 },
  ];

  it("folds the rows and divides by the cohort's week-0 size", () => {
    const grid = cohortsFrom(rows, 4);
    expect(grid.map((c) => c.cohort)).toEqual(["2026-W37", "2026-W36"]);
    expect(grid[1]).toEqual({ cohort: "2026-W36", size: 40, weeks: [1, 0.5, 0.25, 0] });
  });

  it("a week outside the grid is dropped, not wrapped", () => {
    const [w37] = cohortsFrom(rows, 4);
    expect(w37.weeks).toEqual([1, 0.5, 0, 0]);
  });

  it("a cohort with no week-0 row is zeroes rather than NaN", () => {
    const [only] = cohortsFrom([{ cohort: "2026-W38", week: 2, members: 3 }], 3);
    expect(only).toEqual({ cohort: "2026-W38", size: 0, weeks: [0, 0, 0] });
  });

  it("no rows, no cohorts", () => {
    expect(cohortsFrom([], 8)).toEqual([]);
  });
});

describe("splitReadingFrom — per declared variant, and a verdict only for exactly two", () => {
  it("fills every declared variant, zero where nothing was recorded", () => {
    const { variants } = splitReadingFrom(AB, [{ variant: "a", exposed: 120, reached: 30 }]);
    expect(variants).toEqual([
      { id: "a", exposed: 120, reached: 30 },
      { id: "b", exposed: 0, reached: 0 },
    ]);
  });

  it("a row for a variant the experiment no longer declares is ignored", () => {
    const { variants } = splitReadingFrom(AB, [{ variant: "c", exposed: 500, reached: 400 }]);
    expect(variants.every((v) => v.exposed === 0)).toBe(true);
  });

  it("🚨 three variants get NO reading — a pairwise verdict at 95 % three times over is not 95 %", () => {
    const three = { ...AB, variants: [...AB.variants, { id: "c", weight: 1 }] };
    const { reading } = splitReadingFrom(three, []);
    expect(reading).toBeNull();
  });

  it("two variants get the pairwise reading", () => {
    const { reading } = splitReadingFrom(AB, [
      { variant: "a", exposed: 1000, reached: 100 },
      { variant: "b", exposed: 1000, reached: 200 },
    ]);
    expect(reading).not.toBeNull();
  });
});
