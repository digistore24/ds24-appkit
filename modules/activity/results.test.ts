// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What can be asserted about the shell WITHOUT a database. The decisions
// themselves — refusal, verdict application, the ignored client score — are
// pure and live in rules.test.ts; what this file pins is the shape of the
// shell around them.
import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

import { recordSubmission } from "./results";

describe("recordSubmission", () => {
  it("throws on an unknown activity id — a tampered request must not silently do nothing", async () => {
    // Reaches the registry lookup and throws BEFORE any database call, which
    // is why this is testable here: the registry ships empty, so every id is
    // unknown.
    await expect(
      recordSubmission({
        memberId: "m",
        activityId: "gibtsnicht",
        subject: "lektion-1",
        submission: {},
      }),
    ).rejects.toThrow(/gibtsnicht/);
  });
});

describe("recordSubmission input bounds", () => {
  it("refuses an unbounded or padded subject before any work runs", async () => {
    // The bounds themselves are pure now (subjectProblem, tested in
    // rules.test.ts); what this pins is that the shell actually calls them.
    const source = readFileSync(new URL("./results.ts", import.meta.url), "utf8");
    expect(source).toContain("subjectProblem(input.subject)");
  });
});

describe("the shape of modules/activity/", () => {
  it("results.ts is the only file here that touches the database", () => {
    // The split this folder is built on: rules.ts and activities.ts stay
    // pure so every decision is testable over plain objects. One future
    // `import { db }` in either quietly ends that — this is the tripwire
    // (the leak-guard convention).
    for (const pure of ["rules.ts", "activities.ts"]) {
      const source = readFileSync(new URL(`./${pure}`, import.meta.url), "utf8");
      expect(source, pure).not.toMatch(/@\/db|drizzle-orm|\.\.\/db/);
    }
  });

  it("grade() runs before anything is written", () => {
    // AC 7's ordering, pinned as a tripwire: the source must await the
    // activity's grade() before the insert that persists a verdict.
    const source = readFileSync(new URL("./results.ts", import.meta.url), "utf8");
    const gradeAt = source.indexOf("await activity.grade(");
    const writeAt = source.indexOf(".insert(activityResults)");
    expect(gradeAt).toBeGreaterThan(0);
    expect(writeAt).toBeGreaterThan(gradeAt);
  });
});

describe("the action around the primitive", () => {
  // modules/activity/actions.ts is an HTTP endpoint of its own; these pin the
  // three properties a refactor is most likely to lose.
  const source = readFileSync(
    new URL("../../modules/activity/actions.ts", import.meta.url),
    "utf8",
  );

  it("authenticates before it looks anything up — in BOTH actions", () => {
    // indexOf alone only pins the first action; the submit path could lose
    // its auth line with the test green. Count them.
    const auths = [...source.matchAll(/requireActiveUser\(\)/g)].map((m) => m.index);
    const lookups = [...source.matchAll(/findActivity\(/g)].map((m) => m.index);
    expect(auths).toHaveLength(2);
    expect(lookups.filter((i) => i > 20)).toHaveLength(2); // minus the import line
    expect(auths[0]).toBeLessThan(lookups[0] === 0 ? lookups[1] : lookups[0]);
    expect(auths[1]).toBeLessThan(lookups[lookups.length - 1]);
  });

  it("charges only a recorded, final outcome — the 14.2 contract", () => {
    expect(source).toContain("outcome.recorded && outcome.verdict.final");
    // and the charge comes AFTER the work
    expect(source.indexOf("recordSubmission(")).toBeLessThan(source.indexOf("spendTokens("));
  });

  it("is a server action, not a route", () => {
    expect(source.startsWith('"use server"')).toBe(true);
  });
});
