// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { resolveRole, CANONICAL_ROLES } from "./_db.mjs";
import { ROLES } from "@/lib/roles";

describe("resolveRole", () => {
  it("accepts canonical roles", () => {
    expect(resolveRole("owner")).toBe("owner");
    expect(resolveRole("moderator")).toBe("moderator");
    expect(resolveRole("member")).toBe("member");
  });

  it("maps the aliases admin→owner, user→member", () => {
    expect(resolveRole("admin")).toBe("owner");
    expect(resolveRole("user")).toBe("member");
  });

  it("is tolerant about capitalisation and whitespace", () => {
    expect(resolveRole(" Owner ")).toBe("owner");
    expect(resolveRole("ADMIN")).toBe("owner");
  });

  it("returns null for an invalid or missing role", () => {
    expect(resolveRole("chef")).toBeNull();
    expect(resolveRole("")).toBeNull();
    expect(resolveRole(null)).toBeNull();
    expect(resolveRole(true)).toBeNull(); // --role without a value
  });

  it("CANONICAL_ROLES matches ROLES in lib/roles.ts — the copy by necessity", () => {
    // A bare-Node script cannot import lib/roles.ts, so _db.mjs keeps its own
    // list. This test CAN import both, and is what keeps them from drifting.
    expect(CANONICAL_ROLES).toEqual([...ROLES]);
  });
});
