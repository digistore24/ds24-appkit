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

const { default: contributor } = await import("./check");

beforeEach(() => {
  countContent.mockReset();
  emptyUnitSlugs.mockReset();
  emptyUnitSlugs.mockResolvedValue([]);
});

const counts = (blocks: [number, number], units: [number, number]) => ({
  blocks: { content: blocks[0], operator: blocks[1] },
  units: { content: units[0], operator: units[1] },
});

describe("what the course reports about an environment", () => {
  it("reports both origins, for blocks and for units", async () => {
    countContent.mockResolvedValueOnce(counts([2, 1], [7, 3]));
    emptyUnitSlugs.mockResolvedValueOnce(["leere-lektion"]);

    const report = await contributor.check({ appEnv: "production" });

    expect(report.owner).toBe("courses");
    expect(report.items.map((item) => [item.what, item.found])).toEqual([
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

  it("🚨 no item can ever become a problem, whatever the numbers are", async () => {
    // The structural claim, stated once over the whole report: `expected` is
    // null throughout and nothing names a `missing`. Any future item that broke
    // this would make ordinary authoring fail a release.
    countContent.mockResolvedValueOnce(counts([3, 3], [9, 9]));
    emptyUnitSlugs.mockResolvedValueOnce(["a", "b", "c"]);

    const report = await contributor.check({ appEnv: "production" });

    for (const item of report.items) {
      expect(item.expected, item.what).toBeNull();
      expect(item.missing, item.what).toBeUndefined();
    }
  });
});
