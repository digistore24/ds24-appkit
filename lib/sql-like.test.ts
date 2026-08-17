// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The escape every search box in this app shares. It moved here with the
// function itself — the user list became its third caller, and a rule tested
// only under "purchases" is one the next search box does not know exists.
import { describe, it, expect } from "vitest";

import { escapeLikeFragment } from "./sql-like";

describe("escapeLikeFragment", () => {
  it("leaves an ordinary address alone", () => {
    expect(escapeLikeFragment("kunde@example.com")).toBe("kunde@example.com");
  });

  it("makes % a literal percent sign", () => {
    // Unescaped, "100%" would match every row: % is LIKE's wildcard.
    expect(escapeLikeFragment("100%")).toBe("100\\%");
  });

  it("makes _ a literal underscore", () => {
    expect(escapeLikeFragment("a_b")).toBe("a\\_b");
  });

  it("escapes the backslash FIRST, so an escape cannot be forged", () => {
    // Wrong order ("%" first, then "\") turns "%" into "\\%" — a literal
    // backslash followed by the wildcard, i.e. the opposite of the intent.
    expect(escapeLikeFragment("\\%")).toBe("\\\\\\%");
    expect(escapeLikeFragment("c\\d")).toBe("c\\\\d");
  });
});
