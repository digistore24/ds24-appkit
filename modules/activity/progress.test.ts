// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";

import { activityProgress, type ExpectedElement, type LocatedResult } from "./progress";

const NOW = new Date("2026-08-01T12:00:00Z");

function result(activityId: string, subject: string, completed: boolean): LocatedResult {
  return {
    activityId,
    subject,
    state: null,
    score: null,
    maxScore: null,
    passed: null,
    attempts: 1,
    startedAt: NOW,
    completedAt: completed ? NOW : null,
  };
}

const COURSE: ExpectedElement[] = [
  { activityId: "quiz", subject: "lektion-1" },
  { activityId: "quiz", subject: "lektion-2" },
  { activityId: "quiz", subject: "lektion-3" },
  { activityId: "spiel", subject: "lektion-1" },
];

describe("activityProgress", () => {
  it("three of eight says three of eight — read from the results themselves", () => {
    const eight: ExpectedElement[] = Array.from({ length: 8 }, (_, i) => ({
      activityId: "quiz",
      subject: `lektion-${i + 1}`,
    }));
    const results = [1, 2, 3].map((i) => result("quiz", `lektion-${i}`, true));
    const p = activityProgress(results, eight);
    expect(p.done).toBe(3);
    expect(p.total).toBe(8);
    expect(p.fraction).toBeCloseTo(3 / 8);
  });

  it("an attempt without completedAt does not count", () => {
    // "not judged" and "failed" both leave completedAt null — neither is done.
    const p = activityProgress([result("quiz", "lektion-1", false)], COURSE);
    expect(p.done).toBe(0);
  });

  it("a deleted or reset result drops the count with nothing else to update", () => {
    const before = activityProgress(
      [result("quiz", "lektion-1", true), result("quiz", "lektion-2", true)],
      COURSE,
    );
    const after = activityProgress([result("quiz", "lektion-2", true)], COURSE);
    expect(before.done).toBe(2);
    expect(after.done).toBe(1);
  });

  it("names the next open element in the expected order", () => {
    const p = activityProgress([result("quiz", "lektion-1", true)], COURSE);
    expect(p.next).toEqual({ activityId: "quiz", subject: "lektion-2" });
  });

  it("is complete when everything expected is done — next is null", () => {
    const all = COURSE.map((e) => result(e.activityId, e.subject, true));
    const p = activityProgress(all, COURSE);
    expect(p.fraction).toBe(1);
    expect(p.next).toBeNull();
  });

  it("an empty expected list is empty progress, not a division by zero", () => {
    const p = activityProgress([], []);
    expect(p).toEqual({ done: 0, total: 0, fraction: 0, next: null });
  });

  it("results outside the expected list do not inflate the count", () => {
    // A row from a unit the course no longer contains: derived means the
    // CURRENT expectation decides, exactly the property a stored number lacks.
    const p = activityProgress([result("quiz", "geloeschte-lektion", true)], COURSE);
    expect(p.done).toBe(0);
  });

  it("a pair listed twice in expected counts once", () => {
    const doubled = [...COURSE, COURSE[0]];
    const p = activityProgress([result("quiz", "lektion-1", true)], doubled);
    expect(p.total).toBe(4);
    expect(p.done).toBe(1);
  });
});
