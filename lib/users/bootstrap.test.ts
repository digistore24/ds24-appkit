// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { isFirstUserOwnerAllowed, decideRoleForNewUser } from "./bootstrap";

describe("isFirstUserOwnerAllowed", () => {
  it("allows the bootstrap in the DEV environment", () => {
    expect(isFirstUserOwnerAllowed({ APP_ENV: "development" })).toBe(true);
    expect(isFirstUserOwnerAllowed({ APP_ENV: "dev" })).toBe(true);
    expect(isFirstUserOwnerAllowed({ APP_ENV: "local" })).toBe(true);
    expect(isFirstUserOwnerAllowed({})).toBe(true); // unset = local development
  });

  it("refuses it in STAGING and PROD", () => {
    expect(isFirstUserOwnerAllowed({ APP_ENV: "staging" })).toBe(false);
    expect(isFirstUserOwnerAllowed({ APP_ENV: "production" })).toBe(false);
  });

  it("treats an unknown value as production", () => {
    // The same allowlist as the development login: a typo closes the door
    // rather than opening it.
    expect(isFirstUserOwnerAllowed({ APP_ENV: "developement" })).toBe(false);
    expect(isFirstUserOwnerAllowed({ APP_ENV: "PRODUKTION" })).toBe(false);
  });
});

describe("decideRoleForNewUser", () => {
  it("makes the first PERSON on a DEV installation the owner", () => {
    // Also when `smoke`'s test owner already exists: nobody has signed in to
    // it, so `ownerClaimed` is false and the customer's own first sign-in
    // becomes the admin (measured 2026-09-15, three runs).
    expect(
      decideRoleForNewUser({ APP_ENV: "development", ownerClaimed: false }),
    ).toBe("owner");
  });

  it("makes every account after a claimed owner a member", () => {
    expect(
      decideRoleForNewUser({ APP_ENV: "development", ownerClaimed: true }),
    ).toBe("member");
  });

  it("never hands out owner outside of DEV — not even on an empty database", () => {
    // This is the case that matters: a freshly deployed PROD instance has no
    // users either, and the first person to sign in there may be a customer.
    expect(
      decideRoleForNewUser({ APP_ENV: "production", ownerClaimed: false }),
    ).toBe("member");
    expect(
      decideRoleForNewUser({ APP_ENV: "staging", ownerClaimed: false }),
    ).toBe("member");
  });
});
