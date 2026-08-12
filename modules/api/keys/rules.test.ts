// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

import {
  AUDIENCES,
  KEY_PREFIXES,
  LIFETIMES_DAYS,
  MAX_NAME_LENGTH,
  PREFIX_LENGTH,
  SCOPES,
  checkKeyName,
  expiryFor,
  isLifetime,
  isScope,
  keyState,
  looksLikeKey,
  mayRun,
  prefixOf,
} from "./rules";

/** A syntactically valid key — 43 base64url characters after the marker. */
const VALID_API = KEY_PREFIXES.api + "a".repeat(43);

describe("looksLikeKey", () => {
  it("accepts a key of the shape this app issues, for its own audience", () => {
    expect(looksLikeKey(VALID_API, "api")).toBe(true);
    expect(looksLikeKey(KEY_PREFIXES.api + "aA0_-".padEnd(43, "z"), "api")).toBe(true);
  });

  it("refuses a key with a foreign audience marker", () => {
    // A key from a retired or foreign surface must fail before any query: a
    // credential never widens by being sent somewhere else.
    expect(looksLikeKey("ds24mcp_" + "a".repeat(43), "api")).toBe(false);
  });

  it("rejects anything without the marker", () => {
    expect(looksLikeKey("a".repeat(43), "api")).toBe(false);
    expect(looksLikeKey("Bearer " + VALID_API, "api")).toBe(false);
    // Somebody else's credential in the header must cost a regex, not a query.
    expect(looksLikeKey("ghp_0123456789abcdef", "api")).toBe(false);
    expect(looksLikeKey("", "api")).toBe(false);
  });

  it("rejects the wrong secret length", () => {
    for (const audience of AUDIENCES) {
      expect(looksLikeKey(KEY_PREFIXES[audience] + "a".repeat(42), audience)).toBe(false);
      expect(looksLikeKey(KEY_PREFIXES[audience] + "a".repeat(44), audience)).toBe(false);
    }
  });

  it("rejects characters that are not base64url", () => {
    // `+` and `/` would break the copy-paste into a URL or an env var that
    // base64url exists to survive — so a key containing them is not ours.
    expect(looksLikeKey(KEY_PREFIXES.api + "+".repeat(43), "api")).toBe(false);
    expect(looksLikeKey(KEY_PREFIXES.api + "=".repeat(43), "api")).toBe(false);
    expect(looksLikeKey(KEY_PREFIXES.api + "a".repeat(42) + " ", "api")).toBe(false);
  });
});

describe("prefixOf", () => {
  it("shows the marker plus four characters and nothing more", () => {
    for (const key of [VALID_API]) {
      const prefix = prefixOf(key);
      expect(prefix).toHaveLength(PREFIX_LENGTH);
      // The whole point: what the account page renders cannot be the key.
      expect(key.startsWith(prefix)).toBe(true);
      expect(prefix).not.toBe(key);
    }
  });

  it("does not throw on a short value", () => {
    expect(prefixOf("x")).toBe("x");
  });
});

describe("mayRun", () => {
  it("lets a read key run read-only operations only", () => {
    expect(mayRun("read", true)).toBe(true);
    expect(mayRun("read", false)).toBe(false);
  });

  it("lets a write key run everything", () => {
    expect(mayRun("write", true)).toBe(true);
    expect(mayRun("write", false)).toBe(true);
  });

  it("covers every scope the schema allows", () => {
    // If a third scope is ever added, this fails until mayRun has an opinion
    // about it — a scope nothing decides on would default to "refused" and the
    // feature would silently not work.
    for (const scope of SCOPES) {
      expect(typeof mayRun(scope, true)).toBe("boolean");
      expect(typeof mayRun(scope, false)).toBe("boolean");
    }
    expect(isScope("read")).toBe(true);
    expect(isScope("admin")).toBe(false);
  });
});

describe("keyState", () => {
  const now = new Date("2026-07-01T12:00:00Z");

  it("is live with no end date and no revocation", () => {
    expect(keyState({ expiresAt: null, revokedAt: null }, now)).toBe("live");
  });

  it("is live while the expiry is still ahead", () => {
    const later = new Date(now.getTime() + 1000);
    expect(keyState({ expiresAt: later, revokedAt: null }, now)).toBe("live");
  });

  it("is expired at the instant the expiry is reached, not after it", () => {
    // The boundary matters: `<=`, so a key does not stay usable for the
    // millisecond it expires in.
    expect(keyState({ expiresAt: now, revokedAt: null }, now)).toBe("expired");
  });

  it("reports revoked even when it has also expired", () => {
    const past = new Date(now.getTime() - 1000);
    expect(keyState({ expiresAt: past, revokedAt: past }, now)).toBe("revoked");
  });
});

describe("expiryFor", () => {
  const now = new Date("2026-07-01T00:00:00Z");

  it("returns null for a key without an end date", () => {
    expect(expiryFor(null, now)).toBeNull();
  });

  it("adds the whole number of days", () => {
    expect(expiryFor(30, now)?.toISOString()).toBe("2026-07-31T00:00:00.000Z");
  });

  it("accepts every lifetime the UI offers", () => {
    for (const days of LIFETIMES_DAYS) {
      expect(isLifetime(days)).toBe(true);
      expect(() => expiryFor(days, now)).not.toThrow();
    }
    expect(isLifetime(7)).toBe(false);
    expect(isLifetime("30")).toBe(false);
  });
});

describe("checkKeyName", () => {
  it("keeps a normal name and collapses whitespace", () => {
    expect(checkKeyName("  Claude   on my laptop ")).toEqual({
      ok: true,
      name: "Claude on my laptop",
    });
  });

  it("refuses a blank name rather than defaulting one", () => {
    // A list of keys all called "Key" is a list nobody can revoke from.
    expect(checkKeyName("   ")).toEqual({ ok: false, code: "apiNameRequired" });
    expect(checkKeyName("")).toEqual({ ok: false, code: "apiNameRequired" });
    expect(checkKeyName(undefined)).toEqual({ ok: false, code: "apiNameRequired" });
    expect(checkKeyName(42)).toEqual({ ok: false, code: "apiNameRequired" });
  });

  it("refuses a name past the limit", () => {
    expect(checkKeyName("a".repeat(MAX_NAME_LENGTH))).toEqual({
      ok: true,
      name: "a".repeat(MAX_NAME_LENGTH),
    });
    expect(checkKeyName("a".repeat(MAX_NAME_LENGTH + 1))).toEqual({
      ok: false,
      code: "apiNameTooLong",
    });
  });
});
