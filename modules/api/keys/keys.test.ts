// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The v1 surface's credential check, EXECUTED.
//
// Measured 2026-09-15: `authenticate()`, `revokeKey()` and `createKey()` had
// never run under a test. `modules/api/api/guard.test.ts` mocks this module
// wholesale — "expired" and "revoked" existed only as values a mock returned —
// and `scripts/deploy-test.mjs` probes the bearer surface only in the state it
// ships in: OFF, where the answer is 404 before any key is read. So the one
// query a program's request rests on, the constant-time comparison, the member
// binding in the revoke, and the 10-key ceiling were held by prose.
//
// The database is `drizzle-orm/pg-proxy` — a real Drizzle instance whose driver
// is a function — as `lib/impersonation/manage.test.ts` uses it. What is
// asserted is the SQL Postgres would have received, the values bound into it,
// and what the function makes of the row that came back.
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Captured {
  sql: string;
  params: unknown[];
}

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const captured: Captured[] = [];
  const state = {
    /** The row `authenticate()`'s SELECT (or the id lookup in `revokeKey`) finds. */
    selected: [] as unknown[][],
    /** What `count(*)` answers. */
    counted: [[0]] as unknown[][],
    /** What an INSERT … RETURNING hands back. */
    inserted: [["key-new"]] as unknown[][],
    /** What an UPDATE … RETURNING hands back. */
    updated: [] as unknown[][],
  };
  const db = drizzle(async (sql: string, params: unknown[]) => {
    captured.push({ sql, params });
    const q = sql.toLowerCase();
    if (q.includes("count(")) return { rows: state.counted };
    if (q.startsWith("insert")) return { rows: state.inserted };
    if (q.startsWith("update")) return { rows: state.updated };
    return { rows: state.selected };
  });
  return { db, __captured: captured, __state: state };
});

import * as dbModule from "@/db";

import { authenticate, createKey, revokeKey } from "./keys";
import { ApiKeyError, KEY_PREFIXES, MAX_LIVE_KEYS, prefixOf } from "./rules";

interface State {
  selected: unknown[][];
  counted: unknown[][];
  inserted: unknown[][];
  updated: unknown[][];
}

const captured = (dbModule as unknown as { __captured: Captured[] }).__captured;
const state = (dbModule as unknown as { __state: State }).__state;

const BEARER = KEY_PREFIXES.api + "c".repeat(43);
const HASH = createHash("sha256").update(BEARER, "utf8").digest("hex");

/** A timestamp the way the Postgres driver hands it over: no `T`, no zone. */
function pg(date: Date | null): string | null {
  return date ? date.toISOString().replace("T", " ").replace("Z", "") : null;
}

/**
 * One row of `authenticate()`'s SELECT, in column order:
 * id, member_id, token_hash, scope, expires_at, revoked_at, last_used_at,
 * users.blockedAt, users.role.
 */
function row(over: {
  tokenHash?: string;
  scope?: string;
  expiresAt?: Date | null;
  revokedAt?: Date | null;
  lastUsedAt?: Date | null;
  blockedAt?: Date | null;
  role?: string;
} = {}): unknown[] {
  return [
    "key-1",
    "member-1",
    over.tokenHash ?? HASH,
    over.scope ?? "read",
    pg(over.expiresAt ?? null),
    pg(over.revokedAt ?? null),
    pg(over.lastUsedAt ?? null),
    pg(over.blockedAt ?? null),
    over.role ?? "member",
  ];
}

function statements(): string[] {
  return captured.map((c) => c.sql.toLowerCase());
}

beforeEach(() => {
  captured.length = 0;
  state.selected = [];
  state.counted = [[0]];
  state.inserted = [["key-new"]];
  state.updated = [];
  vi.restoreAllMocks();
});

describe("authenticate — what never becomes a query", () => {
  it.each([
    ["a setup key", "ds24setup_" + "c".repeat(43)],
    ["no marker", "c".repeat(51)],
    ["the marker, too short", KEY_PREFIXES.api + "c".repeat(42)],
    ["the marker, too long", KEY_PREFIXES.api + "c".repeat(44)],
    ["an empty string", ""],
  ])("%s → malformed, and the database is not asked", async (_label, bearer) => {
    state.selected = [row()];
    expect(await authenticate(bearer, "api")).toEqual({ ok: false, reason: "malformed" });
    expect(captured).toHaveLength(0);
  });
});

describe("authenticate — the one query", () => {
  it("looks up by the HASH and the audience; the bearer itself is never bound", async () => {
    state.selected = [row()];
    await authenticate(BEARER, "api");

    const { sql, params } = captured[0]!;
    const q = sql.toLowerCase();
    expect(q).toContain('"token_hash" =');
    expect(q).toContain('"audience" =');
    expect(params).toContain(HASH);
    expect(params).toContain("api");
    expect(params, "the clear key reached a statement").not.toContain(BEARER);
  });

  it("🚨 joins users — the block and the role are read at the moment of the call", async () => {
    state.selected = [row()];
    await authenticate(BEARER, "api");

    const q = captured[0]!.sql.toLowerCase();
    expect(q).toMatch(/inner join "users"/);
    expect(q).toContain('"blockedat"');
    expect(q).toContain('"role"');
    expect(q).toContain("limit");
  });
});

describe("authenticate — which rows may act", () => {
  const NOW = Date.now();

  it("an unknown key → unknown", async () => {
    expect(await authenticate(BEARER, "api")).toEqual({ ok: false, reason: "unknown" });
  });

  it("a live key → the member, the key, its scope and the member's role", async () => {
    state.selected = [row({ scope: "write", role: "owner", expiresAt: new Date(NOW + 86_400_000) })];
    expect(await authenticate(BEARER, "api")).toEqual({
      ok: true,
      memberId: "member-1",
      keyId: "key-1",
      scope: "write",
      role: "owner",
    });
  });

  it("🚨 a revoked key → revoked, even one that is also past its expiry", async () => {
    state.selected = [row({ revokedAt: new Date(NOW - 1000), expiresAt: new Date(NOW - 1000) })];
    expect(await authenticate(BEARER, "api")).toEqual({ ok: false, reason: "revoked" });
  });

  it("🚨 an expired key → expired", async () => {
    state.selected = [row({ expiresAt: new Date(NOW - 1000) })];
    expect(await authenticate(BEARER, "api")).toEqual({ ok: false, reason: "expired" });
  });

  it("🚨 a blocked member's live key → blocked — blocked in the browser is blocked here too", async () => {
    state.selected = [row({ blockedAt: new Date(NOW - 1000) })];
    expect(await authenticate(BEARER, "api")).toEqual({ ok: false, reason: "blocked" });
  });

  it("🚨 a row whose stored hash does not match the bearer → unknown, never ok", async () => {
    // The lookup is by hash, so today this row cannot come back — the branch
    // exists for the day the lookup is changed to fetch by prefix. It has to
    // refuse, and it has to do so through the constant-time comparison.
    state.selected = [row({ tokenHash: "f".repeat(64) })];
    expect(await authenticate(BEARER, "api")).toEqual({ ok: false, reason: "unknown" });
  });

  it("every refusal leaves the row untouched — no lastUsedAt on a failed call", async () => {
    state.selected = [row({ revokedAt: new Date(NOW - 1000) })];
    await authenticate(BEARER, "api");
    expect(statements().filter((s) => s.startsWith("update"))).toHaveLength(0);
  });
});

describe("authenticate — recording use, at most once a minute", () => {
  it("a key never used before is touched", async () => {
    state.selected = [row({ lastUsedAt: null })];
    await authenticate(BEARER, "api");

    const updates = statements().filter((s) => s.startsWith("update"));
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(/^update "api_keys" set "last_used_at"/);
    expect(captured[1]!.params).toContain("key-1");
  });

  it("a key used two minutes ago is touched again", async () => {
    state.selected = [row({ lastUsedAt: new Date(Date.now() - 120_000) })];
    await authenticate(BEARER, "api");
    expect(statements().filter((s) => s.startsWith("update"))).toHaveLength(1);
  });

  it("a key used ten seconds ago is NOT — a burst of tool calls is one write", async () => {
    state.selected = [row({ lastUsedAt: new Date(Date.now() - 10_000) })];
    await authenticate(BEARER, "api");
    expect(statements().filter((s) => s.startsWith("update"))).toHaveLength(0);
  });
});

describe("revokeKey — scoped to its owner in the WHERE, not checked beforehand", () => {
  it("binds the member AND the key, and only revokes an open row", async () => {
    state.updated = [["key-1"]];
    await revokeKey({ memberId: "member-1", keyId: "key-1" });

    expect(captured).toHaveLength(1);
    const { sql, params } = captured[0]!;
    const q = sql.toLowerCase();
    expect(q).toMatch(/^update "api_keys" set "revoked_at"/);
    expect(q).toContain('"member_id" =');
    expect(q).toContain('"id" =');
    expect(q).toContain('"revoked_at" is null');
    expect(params).toContain("member-1");
    expect(params).toContain("key-1");
  });

  it("🚨 somebody else's key id → apiUnknownKey, one answer for 'not yours' and 'no such key'", async () => {
    state.updated = [];
    state.selected = [];
    await expect(revokeKey({ memberId: "member-2", keyId: "key-1" })).rejects.toMatchObject({
      code: "apiUnknownKey",
    });
    // The second look is still bound to the caller — it must not find another
    // member's row and call the click a success.
    expect(captured).toHaveLength(2);
    expect(captured[1]!.params).toContain("member-2");
  });

  it("revoking an already-revoked key of one's own is success, not an error", async () => {
    state.updated = [];
    state.selected = [["key-1"]];
    await expect(revokeKey({ memberId: "member-1", keyId: "key-1" })).resolves.toBeUndefined();
  });

  it("the error is an ApiKeyError", async () => {
    await expect(revokeKey({ memberId: "member-1", keyId: "nope" })).rejects.toBeInstanceOf(ApiKeyError);
  });
});

describe("createKey — the secret is returned once and stored only as a hash", () => {
  const args = { memberId: "member-1", name: "laptop", scope: "read", lifetimeDays: null, audience: "api" } as const;

  it("mints a key with the audience's marker, and stores its hash and prefix — never the key", async () => {
    const created = await createKey(args);

    expect(created.secret.startsWith(KEY_PREFIXES.api)).toBe(true);
    expect(created.secret).toHaveLength(KEY_PREFIXES.api.length + 43);
    expect(created).toMatchObject({ id: "key-new", name: "laptop", scope: "read", expiresAt: null });

    const insert = captured.find((c) => c.sql.toLowerCase().startsWith("insert"));
    expect(insert).toBeDefined();
    const expectedHash = createHash("sha256").update(created.secret, "utf8").digest("hex");
    expect(insert!.params).toContain(expectedHash);
    expect(insert!.params).toContain(prefixOf(created.secret));
    expect(insert!.params, "the clear secret was written").not.toContain(created.secret);
    expect(insert!.params).toContain("member-1");
  });

  it("counts only LIVE keys of this member and audience before minting", async () => {
    await createKey(args);
    const count = captured[0]!;
    const q = count.sql.toLowerCase();
    expect(q).toContain("count(");
    expect(q).toContain('"member_id" =');
    expect(q).toContain('"audience" =');
    expect(q).toContain('"revoked_at" is null');
    expect(q).toMatch(/"expires_at" is null or .*"expires_at" >/);
    expect(count.params).toContain("member-1");
  });

  it(`🚨 refuses the ${MAX_LIVE_KEYS + 1}th live key, and writes nothing`, async () => {
    state.counted = [[MAX_LIVE_KEYS]];
    await expect(createKey(args)).rejects.toMatchObject({ code: "apiTooManyKeys" });
    expect(statements().filter((s) => s.startsWith("insert"))).toHaveLength(0);
  });

  it("a lifetime becomes an expiry in the row", async () => {
    const created = await createKey({ ...args, lifetimeDays: 30 });
    expect(created.expiresAt).toBeInstanceOf(Date);
    const days = (created.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });
});
