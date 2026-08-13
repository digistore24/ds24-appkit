// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 A row the operator authored may never turn `content-check` red.
//
// That claim is structural rather than behavioural, which is why it is worth a
// test of its own: `presenceProblems()` has exactly three ways to fail — an
// owner that could not answer, a non-empty `missing`, and `found < expected` —
// and an item with `expected: null` and no `missing` reaches none of them. So
// the report is run through the real aggregator here rather than inspected
// field by field, because "the shape cannot be a problem" is a statement about
// that function and not about this one.
//
// The counting itself is a database question and is not asked here; the mock
// stands in for it exactly as `docs/modules.md` expects a module's own tables to
// be reachable only from inside the app.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { presenceProblems } from "@/lib/content/presence";

const countContent = vi.fn();
const emptyUnitSlugs = vi.fn(async () => [] as string[]);

vi.mock("../lib/manage", () => ({
  countContent: () => countContent(),
  emptyUnitSlugs: () => emptyUnitSlugs(),
}));

// How many courses the REPO declares — the expectation the one failing item is
// measured against.
const declared = vi.fn(() => 0);
vi.mock("../lib/content-files", () => ({
  contentFileIndex: () => ({
    courses: new Map(Array.from({ length: declared() }, (_, i) => [`kurs-${i}`, "f"])),
    blocks: new Map(),
    units: new Map(),
    unreadable: [],
  }),
}));

const { default: contributor } = await import("./check");

beforeEach(() => {
  countContent.mockReset();
  emptyUnitSlugs.mockReset();
  emptyUnitSlugs.mockResolvedValue([]);
  declared.mockReturnValue(1);
});

const counts = (
  blocks: [number, number],
  units: [number, number],
  courses: [number, number] = [1, 0],
) => ({
  courses: { content: courses[0], operator: courses[1] },
  blocks: { content: blocks[0], operator: blocks[1] },
  units: { content: units[0], operator: units[1] },
});

describe("what the course reports about an environment", () => {
  it("reports both origins, for courses, blocks and units", async () => {
    countContent.mockResolvedValueOnce(counts([2, 1], [7, 3]));
    emptyUnitSlugs.mockResolvedValueOnce(["leere-lektion"]);

    const report = await contributor.check({ appEnv: "production" });

    expect(report.owner).toBe("courses");
    expect(report.items.map((item) => [item.what, item.found])).toEqual([
      ["courses (from content files)", 1],
      ["courses (operator-authored)", 0],
      ["course blocks (from content files)", 2],
      ["course blocks (operator-authored)", 1],
      ["course units (from content files)", 7],
      ["course units (operator-authored)", 3],
      ["units with neither text nor video", 1],
    ]);
  });

  it("🚨 an operator-authored course cannot make the gate red", async () => {
    // The state this exists for: somebody built their whole course on the admin
    // surface, so nothing came from a content file. It is unusual and it is not
    // broken — and a release gate that called it broken would be one people
    // learn to run with `|| true`.
    countContent.mockResolvedValueOnce(counts([0, 4], [0, 12]));
    emptyUnitSlugs.mockResolvedValueOnce(["eine", "zwei"]);

    const report = await contributor.check({ appEnv: "production" });

    expect(presenceProblems([report])).toEqual([]);
  });

  it("an empty environment is reported, not complained about", async () => {
    // Zero everywhere is exactly what a PROD database looks like before
    // `content-apply` has run against it. It renders as `·` and is the thing
    // somebody is meant to SEE — the red line for it is elsewhere
    // (`present()`, through the core's applier presence).
    countContent.mockResolvedValueOnce(counts([0, 0], [0, 0]));

    const report = await contributor.check({ appEnv: "production" });

    expect(emptyUnitSlugs, "asked about empty lessons on an environment with none").not.toHaveBeenCalled();
    expect(presenceProblems([report])).toEqual([]);
  });

  it("🚨 no AUTHORING item can ever become a problem, whatever the numbers are", async () => {
    // The structural claim, and it NARROWED in Story 44.2 rather than being
    // dropped: every item about blocks and lessons still carries
    // `expected: null` and no `missing`, so ordinary authoring can never fail a
    // release. The course line is the one deliberate exception and is asserted
    // separately below — writing "every item" here now would be a sentence this
    // file no longer means.
    countContent.mockResolvedValueOnce(counts([3, 3], [9, 9]));
    emptyUnitSlugs.mockResolvedValueOnce(["a", "b", "c"]);

    const report = await contributor.check({ appEnv: "production" });

    for (const item of report.items.filter((row) => !row.what.startsWith("courses "))) {
      expect(item.expected, item.what).toBeNull();
      expect(item.missing, item.what).toBeUndefined();
    }
  });
});

describe("🚨 the one line that CAN fail, and why it is allowed to", () => {
  // Blocks and lessons grow while somebody writes, so a number for them is
  // noise. Courses come from repo FILES, so how many should be there is known
  // before the query — and "none of them arrived" is exactly the silence
  // `content-check` exists against: an empty course page is a clean 200.

  it("passes when every declared course is here", async () => {
    declared.mockReturnValue(2);
    countContent.mockResolvedValueOnce(counts([2, 0], [7, 0], [2, 0]));

    const report = await contributor.check({ appEnv: "production" });
    expect(presenceProblems([report])).toEqual([]);
  });

  it("🚨 FAILS when a declared course never reached this environment", async () => {
    // The needle. Two courses in the repo, one in PROD — and without this line
    // the report reads as smaller numbers in four items nobody can judge.
    declared.mockReturnValue(2);
    countContent.mockResolvedValueOnce(counts([2, 0], [7, 0], [1, 0]));

    const report = await contributor.check({ appEnv: "production" });
    const problems = presenceProblems([report]);
    expect(problems).toHaveLength(1);
    expect(problems.join(" ")).toContain("1 course(s)");
  });

  it("does not complain when the repo declares none", async () => {
    // A fresh app, or one whose courses are all operator-authored. Zero
    // expected, zero found, nothing to say.
    declared.mockReturnValue(0);
    countContent.mockResolvedValueOnce(counts([0, 0], [0, 0], [0, 0]));

    expect(presenceProblems([await contributor.check({ appEnv: "production" })])).toEqual([]);
  });

  it("🚨 an operator-authored course never counts toward the expectation", async () => {
    // The rows an operator made exist in ONE environment by design. Counting
    // them here would let somebody satisfy a repo declaration by hand — and
    // then a redeploy into a fresh database would be a surprise.
    declared.mockReturnValue(1);
    countContent.mockResolvedValueOnce(counts([1, 0], [3, 0], [0, 3]));

    expect(presenceProblems([await contributor.check({ appEnv: "production" })])).toHaveLength(1);
  });
});
