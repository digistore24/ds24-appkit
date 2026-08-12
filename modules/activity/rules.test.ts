// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";

import {
  activityProblems,
  subjectProblem,
  decideSubmission,
  applyVerdict,
  passedFrom,
  verdictProblems,
  type StoredResult,
} from "./rules";

const NOW = new Date("2026-08-01T12:00:00Z");

/** A stored row with only what the rules read. */
function stored(over: Partial<StoredResult> = {}): StoredResult {
  return {
    state: null,
    score: null,
    maxScore: null,
    passed: null,
    attempts: 0,
    startedAt: NOW,
    completedAt: null,
    ...over,
  };
}

const okActivity = { id: "silben-spiel", costsTokens: 0, maxAttempts: null };

describe("activityProblems — the registry lint", () => {
  it("accepts a well-formed list, and an empty one", () => {
    expect(activityProblems([])).toEqual([]);
    expect(
      activityProblems([okActivity, { id: "quiz-1", costsTokens: 2, maxAttempts: 3, passMark: 0.7 }]),
    ).toEqual([]);
  });

  it("refuses an id outside [a-z0-9-] or over 40 characters", () => {
    // The same restriction companions carry — here because the id travels as
    // a prop from a client component and gets written into docs/app.md.
    for (const id of ["Silben", "spiel_1", "a:b", "", "x".repeat(41)]) {
      expect(activityProblems([{ ...okActivity, id }]), id).not.toEqual([]);
    }
  });

  it("refuses a duplicate id", () => {
    const problems = activityProblems([okActivity, { ...okActivity }]);
    expect(problems.join(" ")).toContain("silben-spiel");
  });

  it("refuses a maxAttempts that is not null or a positive integer", () => {
    for (const maxAttempts of [0, -1, 1.5, NaN] as number[]) {
      expect(activityProblems([{ ...okActivity, maxAttempts }]), String(maxAttempts)).not.toEqual([]);
    }
    expect(activityProblems([{ ...okActivity, maxAttempts: 1 }])).toEqual([]);
  });

  it("refuses a passMark outside (0, 1]", () => {
    for (const passMark of [0, -0.1, 1.01, NaN]) {
      expect(activityProblems([{ ...okActivity, passMark }]), String(passMark)).not.toEqual([]);
    }
    expect(activityProblems([{ ...okActivity, passMark: 1 }])).toEqual([]);
  });

  it("refuses a negative or fractional token cost", () => {
    for (const costsTokens of [-1, 0.5, NaN]) {
      expect(activityProblems([{ ...okActivity, costsTokens }]), String(costsTokens)).not.toEqual([]);
    }
  });
});

describe("decideSubmission — the refusal BEFORE grade()", () => {
  it("grades a first attempt", () => {
    expect(decideSubmission({ previous: null, maxAttempts: 3 })).toEqual({ action: "grade" });
  });

  it("grades below the ceiling and refuses at it", () => {
    expect(decideSubmission({ previous: stored({ attempts: 2 }), maxAttempts: 3 })).toEqual({
      action: "grade",
    });
    // The refusal happens HERE, before grade() runs — a refused attempt costs
    // nothing and cannot be metered.
    expect(decideSubmission({ previous: stored({ attempts: 3 }), maxAttempts: 3 })).toEqual({
      action: "refused",
      reason: "maxAttempts",
    });
  });

  it("never refuses with unlimited attempts", () => {
    expect(decideSubmission({ previous: stored({ attempts: 999 }), maxAttempts: null })).toEqual({
      action: "grade",
    });
  });
});

describe("passedFrom — one definition of passing", () => {
  it("compares score/maxScore against the pass mark", () => {
    expect(passedFrom(7, 10, 0.7)).toBe(true);
    expect(passedFrom(6, 10, 0.7)).toBe(false);
    expect(passedFrom(10, 10, 1)).toBe(true);
  });

  it("returns null — not judged — when anything needed is missing", () => {
    // "not judged" and "failed" are different answers; a missing pass mark or
    // a missing score must never read as a failure.
    expect(passedFrom(null, 10, 0.7)).toBeNull();
    expect(passedFrom(7, null, 0.7)).toBeNull();
    expect(passedFrom(7, 10, undefined)).toBeNull();
    expect(passedFrom(7, 0, 0.7)).toBeNull();
  });
});

describe("applyVerdict — what gets written", () => {
  it("a checkpoint writes the state and touches nothing else", () => {
    // AC 8: whether a submission is final is decided by grade(), and an
    // in-progress save must not count an attempt or fabricate a verdict.
    const row = applyVerdict({
      previous: stored({ attempts: 1, score: 5, maxScore: 10, passed: false }),
      verdict: { final: false, state: { position: 3 } },
      now: NOW,
    });
    expect(row.state).toEqual({ position: 3 });
    expect(row.attempts).toBe(1);
    expect(row.score).toBe(5);
    expect(row.passed).toBe(false);
    expect(row.completedAt).toBeNull();
  });

  it("a final verdict counts the attempt and records what grade() said", () => {
    const row = applyVerdict({
      previous: null,
      verdict: { final: true, score: 8, maxScore: 10 },
      now: NOW,
      passMark: 0.7,
    });
    expect(row.attempts).toBe(1);
    expect(row.score).toBe(8);
    expect(row.maxScore).toBe(10);
    expect(row.passed).toBe(true);
    expect(row.completedAt).toEqual(NOW);
  });

  it("the verdict's own passed wins over the pass mark", () => {
    const row = applyVerdict({
      previous: null,
      verdict: { final: true, score: 9, maxScore: 10, passed: false },
      now: NOW,
      passMark: 0.5,
    });
    expect(row.passed).toBe(false);
  });

  it("a client-supplied score is structurally impossible", () => {
    // AC 3's sharpest form: applyVerdict never sees the submission at all —
    // only what grade() returned. The perfect-score claim from a browser has
    // no path into this function.
    const row = applyVerdict({
      previous: null,
      verdict: { final: true, score: 2, maxScore: 10 },
      now: NOW,
      passMark: 0.7,
    });
    expect(row.score).toBe(2);
    expect(row.passed).toBe(false);
  });

  it("a failed attempt leaves completedAt null; a later pass sets it once", () => {
    const failed = applyVerdict({
      previous: null,
      verdict: { final: true, score: 2, maxScore: 10 },
      now: NOW,
      passMark: 0.7,
    });
    expect(failed.completedAt).toBeNull();

    const later = new Date("2026-08-02T12:00:00Z");
    const passedRow = applyVerdict({
      previous: stored({ attempts: 1, completedAt: null }),
      verdict: { final: true, score: 9, maxScore: 10 },
      now: later,
      passMark: 0.7,
    });
    expect(passedRow.completedAt).toEqual(later);

    // Once set, the FIRST completion time is kept.
    const again = applyVerdict({
      previous: stored({ attempts: 2, completedAt: later }),
      verdict: { final: true, score: 10, maxScore: 10 },
      now: new Date("2026-08-03T12:00:00Z"),
      passMark: 0.7,
    });
    expect(again.completedAt).toEqual(later);
  });

  it("an unjudged final verdict completes — a game without scoring is finishable", () => {
    const row = applyVerdict({
      previous: null,
      verdict: { final: true },
      now: NOW,
    });
    expect(row.attempts).toBe(1);
    expect(row.passed).toBeNull();
    expect(row.completedAt).toEqual(NOW);
  });

  it("a final verdict without state keeps the previous state", () => {
    const row = applyVerdict({
      previous: stored({ state: { best: 7 } }),
      verdict: { final: true, score: 9, maxScore: 10 },
      now: NOW,
      passMark: 0.7,
    });
    expect(row.state).toEqual({ best: 7 });
  });
});

describe("verdictProblems — the sanity check on grade()'s answer", () => {
  it("accepts sound verdicts, scored and unscored", () => {
    expect(verdictProblems({ final: true })).toEqual([]);
    expect(verdictProblems({ final: true, score: 7, maxScore: 10 })).toEqual([]);
  });

  it("refuses fractional, negative and non-finite scores before they die at the column", () => {
    for (const score of [7.5, -1, NaN, Infinity]) {
      expect(verdictProblems({ final: true, score, maxScore: 10 }), String(score)).not.toEqual([]);
    }
  });

  it("refuses a score above its maximum — 150 % must not read as passed", () => {
    expect(verdictProblems({ final: true, score: 15, maxScore: 10 })).not.toEqual([]);
  });

  it("refuses a scored checkpoint — the free probe three documents forbid", () => {
    for (const v of [{ final: false, score: 3 }, { final: false, maxScore: 10 }, { final: false, passed: true }]) {
      expect(verdictProblems(v as never), JSON.stringify(v)).not.toEqual([]);
    }
    expect(verdictProblems({ final: false, state: { pos: 2 } })).toEqual([]);
  });

  it("refuses an oversized or unserialisable state before the write", () => {
    expect(verdictProblems({ final: true, state: "x".repeat(65_000) })).not.toEqual([]);
    const cyc: Record<string, unknown> = {}; cyc.self = cyc;
    expect(verdictProblems({ final: true, state: cyc })).not.toEqual([]);
  });
});

describe("passed is sticky", () => {
  it("a failed retake does not un-pass the learner", () => {
    // completedAt is best-ever, so passed follows the same reading: having
    // passed does not un-happen. score/attempts still tell the latest story.
    const row = applyVerdict({
      previous: stored({ attempts: 1, passed: true, completedAt: NOW }),
      verdict: { final: true, score: 1, maxScore: 10 },
      now: new Date("2026-08-02T12:00:00Z"),
      passMark: 0.7,
    });
    expect(row.passed).toBe(true);
    expect(row.score).toBe(1);
    expect(row.completedAt).toEqual(NOW);
  });
});

describe("AC 3, literally", () => {
  it("a submission claiming a perfect score is stored with the score grade() returned", async () => {
    // The whole pipeline a submission can influence, with a fake activity:
    // the browser claims 10/10 and passed — the stored row carries what the
    // server-side grade() actually said.
    const submission = { score: 10, maxScore: 10, passed: true, final: true };
    const grade = async ({ submission: _s }: { submission: unknown }) => ({
      final: true,
      score: 2,
      maxScore: 10,
    });
    const verdict = await grade({ submission });
    const row = applyVerdict({ previous: null, verdict, now: NOW, passMark: 0.7 });
    expect(row.score).toBe(2);
    expect(row.passed).toBe(false);
    expect(row.completedAt).toBeNull();
  });
});

describe("subjectProblem — the shared bounds on a subject", () => {
  it("accepts a plain slug", () => {
    expect(subjectProblem("lektion-3")).toBeNull();
  });

  it("refuses empty, padded and oversized subjects", () => {
    for (const bad of ["", " lektion-3", "lektion-3 ", "x".repeat(101)]) {
      expect(subjectProblem(bad), JSON.stringify(bad)).toBe("activityBadSubject");
    }
  });
});
