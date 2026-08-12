// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";
import { blankComments } from "@/scripts/lib/source-text.mjs";

import {
  BILLING_MODES,
  DEFAULT_BILLING_MODE,
  billingMode,
  contradictingProducts,
  isBillingMode,
  modeSellsPlans,
  modeSellsTokens,
  type BillingMode,
} from "./billing-mode";

describe("isBillingMode", () => {
  it("accepts exactly the three modes", () => {
    for (const mode of BILLING_MODES) expect(isBillingMode(mode)).toBe(true);
  });

  it("rejects everything else", () => {
    // "subscription" (singular) and "token" are the two a human types by
    // mistake, because that is what the `kind` in the registry is called.
    for (const value of ["subscription", "token", "", "BOTH", null, undefined, 1, {}]) {
      expect(isBillingMode(value), String(value)).toBe(false);
    }
  });
});

describe("what a mode sells", () => {
  const table: Array<[BillingMode, boolean, boolean]> = [
    // mode              plans   tokens
    ["subscriptions", true, false],
    ["tokens", false, true],
    ["both", true, true],
  ];

  for (const [mode, plans, tokens] of table) {
    it(`${mode}: plans=${plans}, tokens=${tokens}`, () => {
      expect(modeSellsPlans(mode)).toBe(plans);
      expect(modeSellsTokens(mode)).toBe(tokens);
    });
  }

  it("no mode switches everything off", () => {
    // A mode that sells nothing would leave the app with no way to take money
    // at all — which is not a billing model, it is a broken config.
    for (const mode of BILLING_MODES) {
      expect(modeSellsPlans(mode) || modeSellsTokens(mode)).toBe(true);
    }
  });
});

describe("the configured mode", () => {
  it("is one of the three", () => {
    expect(BILLING_MODES).toContain(billingMode());
  });

  it("falls back to the mode that hides nothing", () => {
    // The fallback direction is the whole point: an unreadable config shows
    // one card too many, it never hides a plan somebody is paying for.
    expect(modeSellsPlans(DEFAULT_BILLING_MODE)).toBe(true);
    expect(modeSellsTokens(DEFAULT_BILLING_MODE)).toBe(true);
  });
});

describe("mode and registry agree", () => {
  // THE guard that makes a second source of truth safe. A product whose kind
  // the mode switched off is still created at Digistore24 by `ds24-sync` and
  // still buyable there — while the app renders none of the machinery that
  // would credit it. The buyer pays and gets nothing.
  //
  // Failing here? Two ways out, and the right one depends on what you meant:
  //   • the product is wanted  -> set "billingMode": "both" in the registry
  //   • the product is not     -> delete it from config/digistore-products.json
  //     (and, if `ds24-sync` already created it, deactivate it at Digistore24 —
  //     removing it from the JSON does not unpublish it)
  it("declares no product the mode cannot serve", () => {
    expect(contradictingProducts()).toEqual([]);
  });
});

describe("the mode never blocks spending", () => {
  // Read the source, the way scripts/portability.test.ts does. There is no test
  // database here, so the only way to assert that a gate is ABSENT is to look.
  //
  // Why this test exists at all: `adjustTokens` DOES refuse when the app sells
  // no tokens, so `spendTokens` looks inconsistent beside it, and the next
  // reader will close the gap. They must close it the other way. `adjustTokens`
  // is the exception because it MINTS tokens out of nothing; a spend consumes
  // what somebody already paid for. Gating a spend strands every customer
  // holding a paid balance the moment a vendor flips a display switch — that is
  // a refund request, not a layout change.
  it("spendTokens does not consult the billing mode", () => {
    const source = readFileSync(
      new URL("./tokens/spend.ts", import.meta.url),
      "utf8",
    );
    // Comments discuss `sellsTokens()` at length on purpose; strip them before
    // looking, or this test fails on its own explanation.
    const code = blankComments(source);
    expect(code).not.toMatch(/sellsTokens|billingMode/);
  });
});
