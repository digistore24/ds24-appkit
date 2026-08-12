// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { isOwner, hasRole, isRole, ROLES } from "./authz";

describe("isOwner", () => {
  it("only 'owner' carries operator rights", () => {
    expect(isOwner("owner")).toBe(true);
    expect(isOwner("member")).toBe(false);
    expect(isOwner(undefined)).toBe(false);
    expect(isOwner(null)).toBe(false);
    expect(isOwner("Owner")).toBe(false); // case-sensitive (canonical value)
  });

  it("a moderator is NOT an owner — requireOwner() keeps refusing them", () => {
    // The load-bearing pin of FR-204: every admin guard in this app answers
    // from isOwner(), so this single false is what keeps users, roles and
    // billing out of a moderator's reach.
    expect(isOwner("moderator")).toBe(false);
  });
});

describe("ROLES", () => {
  it("carries exactly the three canonical roles, in rank order", () => {
    expect(ROLES).toEqual(["owner", "moderator", "member"]);
  });

  it("isRole knows the moderator", () => {
    expect(isRole("moderator")).toBe(true);
    expect(isRole("mod")).toBe(false); // aliases are the CLI's, not the app's
  });
});

describe("hasRole", () => {
  it("checks membership in the allowed list", () => {
    expect(hasRole("owner", ["owner", "member"])).toBe(true);
    expect(hasRole("member", ["owner"])).toBe(false);
    expect(hasRole(undefined, ["owner", "member"])).toBe(false);
    expect(hasRole(null, ["member"])).toBe(false);
  });
});
