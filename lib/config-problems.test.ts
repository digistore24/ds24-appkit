// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The `enabled` check five config readers now share.
//
// Small, and the point is not the arithmetic — it is that the SENTENCE has one
// author. It reaches an operator who mistyped something, out of
// `node run.mjs setup-check`, the module diagnosis pages and `module list`, and
// it stood verbatim in five files.
import { describe, expect, it } from "vitest";

import { enabledProblem, pushEnabledProblem } from "./config-problems";

describe("enabledProblem", () => {
  it("accepts both booleans", () => {
    expect(enabledProblem({ enabled: true })).toBeNull();
    expect(enabledProblem({ enabled: false })).toBeNull();
  });

  it("accepts an absent key — every switch has a documented default", () => {
    // Absent is not a problem, and treating it as one would make every config
    // file that relies on its default report a fault.
    expect(enabledProblem({})).toBeNull();
    expect(enabledProblem({ enabled: undefined })).toBeNull();
  });

  it("🚨 refuses the string `\"true\"`, which is the mistake it exists for", () => {
    // JSON has booleans; a person typing one as a string is the whole reason
    // this check is here. Accepting it would switch a feature on because the
    // string is truthy.
    expect(enabledProblem({ enabled: "true" })).toBe('"enabled" must be true or false');
  });

  it("refuses null, a number and an object too", () => {
    for (const value of [null, 0, 1, {}, []]) {
      expect(enabledProblem({ enabled: value }), JSON.stringify(value)).not.toBeNull();
    }
  });

  it("says the same sentence every time", () => {
    // The single-author claim, as an assertion: two vocabularies for one
    // mistake is exactly what five copies risked.
    expect(enabledProblem({ enabled: "yes" })).toBe(enabledProblem({ enabled: 1 }));
  });
});

describe("pushEnabledProblem", () => {
  it("appends nothing when the key is fine", () => {
    const problems: string[] = [];
    pushEnabledProblem(problems, { enabled: true });
    expect(problems).toEqual([]);
  });

  it("appends the sentence once when it is not", () => {
    const problems: string[] = [];
    pushEnabledProblem(problems, { enabled: "true" });
    expect(problems).toEqual(['"enabled" must be true or false']);
  });

  it("keeps the problems a reader had already collected", () => {
    // The call sites push onto a list that is already part-filled — dropping
    // the earlier entries would hide the fault the operator asked about.
    const problems = ["something else"];
    pushEnabledProblem(problems, { enabled: 3 });
    expect(problems).toEqual(["something else", '"enabled" must be true or false']);
  });
});
