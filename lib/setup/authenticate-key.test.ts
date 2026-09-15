// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 `authenticateKey()` — the credential check behind the setup surface —
// and `revokeKey()`, executed against the real Drizzle query builder.
//
// Measured 2026-09-15: `lib/setup/manage.ts` stood at 1 of 42 statements.
// `guard.test.ts` stubs this function, `scripts/deploy-two-act.mjs` sends only
// the valid key — so "revoked", "expired", "blocked owner" and "not an owner"
// were four sentences in a docstring that nothing had ever turned red. Each of
// them is a row shape below, and each is refused.
//
// The database is `drizzle-orm/pg-proxy` — a real Drizzle instance whose driver
// is a function — as `lib/impersonation/manage.test.ts` uses it. Nothing about
// the query building is faked: what is asserted is the SQL Postgres would have
// received and the row the function makes of what came back.
//
// ⚠️ What this does NOT claim: that the JOIN and the unique index behave against
// a real Postgres. `deploy-two-act` authenticates for real, once, with a good key.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Captured {
  sql: string;
  params: unknown[];
}

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const captured: Captured[] = [];
  const state = { rows: [] as unknown[][] };
  const db = drizzle(async (sql: string, params: unknown[]) => {
    captured.push({ sql, params });
    return { rows: state.rows };
  });
  return { db, __captured: captured, __state: state };
});

import * as dbModule from "@/db";

import { authenticateKey, revokeKey } from "./manage";
import { SETUP_KEY_PREFIX, hashSecret } from "./rules";

const captured = (dbModule as unknown as { __captured: Captured[] }).__captured;
const state = (dbModule as unknown as { __state: { rows: unknown[][] } }).__state;

const SECRET = SETUP_KEY_PREFIX + "b".repeat(43);
const NOW = new Date("2026-09-15T12:00:00.000Z");

/** A timestamp the way the Postgres driver hands it over: no `T`, no zone. */
function pg(date: Date | null): string | null {
  return date ? date.toISOString().replace("T", " ").replace("Z", "") : null;
}

/**
 * One row of the SELECT in `authenticateKey`, in column order:
 * id, owner_id, expires_at, revoked_at, users.role, users.blockedAt.
 */
function row(over: {
  expiresAt?: Date | null;
  revokedAt?: Date | null;
  role?: string;
  blockedAt?: Date | null;
} = {}): unknown[] {
  return [
    "key-1",
    "owner-1",
    pg(over.expiresAt ?? null),
    pg(over.revokedAt ?? null),
    over.role ?? "owner",
    pg(over.blockedAt ?? null),
  ];
}

beforeEach(() => {
  captured.length = 0;
  state.rows = [];
});

describe("authenticateKey — what never becomes a query", () => {
  it.each([
    ["a foreign marker", "ds24api_" + "b".repeat(43)],
    ["the right marker, too short", SETUP_KEY_PREFIX + "b".repeat(42)],
    ["the right marker, too long", SETUP_KEY_PREFIX + "b".repeat(44)],
    ["the right marker, a forbidden character", SETUP_KEY_PREFIX + "b".repeat(42) + "+"],
    ["an empty string", ""],
  ])("%s → null, and the database is not asked", async (_label, secret) => {
    state.rows = [row()];
    expect(await authenticateKey(secret, NOW)).toBeNull();
    expect(captured, "a malformed key reached the database").toHaveLength(0);
  });
});

describe("authenticateKey — the one query", () => {
  it("looks the key up by the HASH of the secret, never the secret", async () => {
    state.rows = [row()];
    await authenticateKey(SECRET, NOW);

    expect(captured).toHaveLength(1);
    const { sql, params } = captured[0]!;
    expect(sql.toLowerCase()).toContain('"token_hash" =');
    expect(params).toContain(hashSecret(SECRET));
    expect(params, "the clear secret was bound into a statement").not.toContain(SECRET);
  });

  it("🚨 joins users — the role and the block are read NOW, not carried from mint time", async () => {
    state.rows = [row()];
    await authenticateKey(SECRET, NOW);

    const sql = captured[0]!.sql.toLowerCase();
    expect(sql).toMatch(/inner join "users"/);
    expect(sql).toContain('"role"');
    expect(sql).toContain('"blockedat"');
    expect(sql).toContain("limit");
  });
});

describe("authenticateKey — which rows may act", () => {
  it("an unknown key → null", async () => {
    state.rows = [];
    expect(await authenticateKey(SECRET, NOW)).toBeNull();
  });

  it("a live key of an owner → its id and the owner's", async () => {
    state.rows = [row({ expiresAt: new Date(NOW.getTime() + 60_000) })];
    expect(await authenticateKey(SECRET, NOW)).toEqual({ keyId: "key-1", ownerId: "owner-1" });
  });

  it("a key with no expiry is live", async () => {
    state.rows = [row({ expiresAt: null })];
    expect(await authenticateKey(SECRET, NOW)).not.toBeNull();
  });

  it("🚨 a revoked key → null, however recently it was revoked", async () => {
    state.rows = [row({ revokedAt: new Date(NOW.getTime() - 1) })];
    expect(await authenticateKey(SECRET, NOW)).toBeNull();
  });

  it("🚨 an expired key → null — and expiring AT this instant already counts", async () => {
    state.rows = [row({ expiresAt: new Date(NOW.getTime() - 1) })];
    expect(await authenticateKey(SECRET, NOW)).toBeNull();

    state.rows = [row({ expiresAt: NOW })];
    expect(await authenticateKey(SECRET, NOW), "expires_at == now is not live").toBeNull();
  });

  it("🚨 a blocked owner → null — the third door the block closes", async () => {
    state.rows = [row({ blockedAt: new Date(NOW.getTime() - 3_600_000) })];
    expect(await authenticateKey(SECRET, NOW)).toBeNull();
  });

  it.each(["member", "moderator", "admin", ""])(
    "🚨 an owner demoted to %j → null — the key does not remember the old role",
    async (role) => {
      state.rows = [row({ role })];
      expect(await authenticateKey(SECRET, NOW)).toBeNull();
    },
  );

  it("refuses without a second query — nothing is written on the refusal path", async () => {
    state.rows = [row({ revokedAt: NOW })];
    await authenticateKey(SECRET, NOW);
    expect(captured).toHaveLength(1);
  });
});

describe("revokeKey — keeps the row, ends the credential", () => {
  it("sets revoked_at on exactly that id, and only if it is not already revoked", async () => {
    await revokeKey("key-1");

    expect(captured).toHaveLength(1);
    const { sql, params } = captured[0]!;
    const q = sql.toLowerCase();
    expect(q).toMatch(/^update "setup_keys" set "revoked_at"/);
    expect(q).toContain('"id" =');
    expect(q, "the first revocation must win — the row is filtered on being open").toContain(
      '"revoked_at" is null',
    );
    expect(q, "revoking must never delete").not.toContain("delete");
    expect(params).toContain("key-1");
  });
});
