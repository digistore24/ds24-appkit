// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

import { consentPurposes, consentPurpose, hasConsentPurposes, consentConfigProblems } from "./config";

describe("the shipped config", () => {
  it("is coherent", () => {
    // Same shape as `lib/ai/chat-config.test.ts`: a config that cannot be read is
    // caught at build time, not by a dialog rendering the literal string
    // "consent.marketing_email.title" at a customer.
    expect(consentConfigProblems()).toEqual([]);
  });

  it("declares no purposes", () => {
    // Load-bearing, not an accident of the sample data. This app needs no
    // consent from anybody as it ships — a purchase runs on Art. 6(1)(b) and
    // the three cookies it sets are strictly necessary or set by the user's own
    // click. A purpose added here "to be thorough" would put a dialog in front
    // of customers asking permission the app neither needs nor uses.
    //
    // If you are an operator who genuinely added tracking or a marketing mail:
    // declare the purpose and change this test to assert what you declared.
    expect(consentPurposes()).toEqual([]);
    expect(hasConsentPurposes()).toBe(false);
  });

  it("answers nothing for an undeclared purpose", () => {
    expect(consentPurpose("marketing_email")).toBeNull();
  });
});

describe("consentConfigProblems", () => {
  // The function reads the real file, so the failure modes are exercised
  // through the validators it delegates to — `rules.test.ts` covers those in
  // full. What is worth pinning here is that the reporter is not vacuous.
  it("returns an array, not a boolean", () => {
    const problems = consentConfigProblems();
    expect(Array.isArray(problems)).toBe(true);
  });
});
