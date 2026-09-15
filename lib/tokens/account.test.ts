// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The three writes that move a balance — `creditTokens`, `consumeTokens`,
// `adjustTokens` — executed against the real Drizzle query builder.
//
// Measured 2026-09-15: `lib/tokens/account.ts` stood at 11 % — the pure
// predicates (`hasSufficientBalance`, `shouldAutoReload`, …) have `tokens.test.ts`,
// and every caller's test mocks this module at the function boundary. So the
// row lock, the partial-index conflict clause that makes a redelivered IPN a
// no-op, the "already booked but still link the mandate" branch and the
// refusal that writes nothing were held by their docstrings.
//
// The database is `drizzle-orm/pg-proxy` with the schema, as
// `lib/impersonation/manage.test.ts` uses it; `db.transaction` — which the
// proxy driver refuses — is patched to run the body against the same capture,
// the way `modules/community/lib/follow.test.ts` does. Rows are built from the
// table's own column list, so a column added to `token_accounts` does not
// silently shift every fixture one place to the left.
//
// ⚠️ What this does NOT claim: that Postgres arbitrates the conflict on the
// partial index, or that `FOR UPDATE` serialises two requests. Those need a
// real database — `scripts/deploy-ipn.mjs` replays a payment twice against
// one, and asserts the balance moved once.
import { getTableColumns } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { tokenAccounts } from "@/db/schema";

interface Captured {
  sql: string;
  params: unknown[];
}

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const schema = await import("@/db/schema");
  const captured: Captured[] = [];
  const state = {
    /** The account row the `token_accounts` reads find — `[]` for none. */
    account: [] as unknown[][],
    /** What the ledger INSERT … RETURNING hands back — `[]` is "conflict, nothing inserted". */
    ledgerInserted: [["ledger-1"]] as unknown[][],
  };
  const db = drizzle(
    async (sql: string, params: unknown[]) => {
      captured.push({ sql, params });
      const q = sql.toLowerCase();
      if (q.startsWith('insert into "token_ledger"')) return { rows: state.ledgerInserted };
      if (q.includes('from "token_accounts"')) return { rows: state.account };
      return { rows: [] };
    },
    { schema },
  );
  // The proxy driver refuses transactions; the body runs against the same
  // capture, which is what these tests read.
  (db as unknown as { transaction: unknown }).transaction = async (
    body: (tx: typeof db) => Promise<unknown>,
  ) => body(db);
  return { db, __captured: captured, __state: state };
});

vi.mock("@/lib/billing-mode", () => ({ sellsTokens: vi.fn(() => true) }));

import * as dbModule from "@/db";
import { sellsTokens } from "@/lib/billing-mode";

import { InsufficientTokensError, adjustTokens, consumeTokens, creditTokens } from "./account";
import { TokenError } from "./rules";

interface State {
  account: unknown[][];
  ledgerInserted: unknown[][];
}

const captured = (dbModule as unknown as { __captured: Captured[] }).__captured;
const state = (dbModule as unknown as { __state: State }).__state;

const NOW = new Date("2026-09-15T12:00:00.000Z");
const OWNER = { id: "owner-1", role: "owner" } as const;

/** A timestamp the way the Postgres driver hands it over: no `T`, no zone. */
function pg(date: Date | null): string | null {
  return date ? date.toISOString().replace("T", " ").replace("Z", "") : null;
}

/**
 * One `token_accounts` row in the table's own column order — built from the
 * schema so the fixture cannot drift from it.
 */
function account(over: Partial<Record<keyof typeof tokenAccounts.$inferSelect, unknown>> = {}): unknown[] {
  const defaults: Record<string, unknown> = {
    id: "acct-1",
    memberId: "member-1",
    balance: 100,
    autoReloadEnabled: false,
    autoReloadThreshold: 0,
    autoReloadPackageKey: null,
    ds24PurchaseId: null,
    reloadLockedAt: null,
    lastReloadAt: null,
    reloadAttempts: 0,
    createdAt: pg(NOW),
    updatedAt: pg(NOW),
  };
  const values: Record<string, unknown> = { ...defaults, ...over };
  return Object.keys(getTableColumns(tokenAccounts)).map((name) => {
    if (!(name in values)) throw new Error(`fixture has no value for column ${name}`);
    return values[name];
  });
}

function statements(): string[] {
  return captured.map((c) => c.sql.toLowerCase());
}

function only(prefix: string): Captured {
  const hits = captured.filter((c) => c.sql.toLowerCase().startsWith(prefix));
  expect(hits, `expected exactly one statement starting "${prefix}"`).toHaveLength(1);
  return hits[0]!;
}

beforeEach(() => {
  captured.length = 0;
  state.account = [account()];
  state.ledgerInserted = [["ledger-1"]];
  vi.mocked(sellsTokens).mockReturnValue(true);
});

describe("creditTokens — a payment books once", () => {
  const args = { memberId: "member-1", credits: 500, ds24OrderId: "ORD-1", now: NOW };

  it("refuses a non-positive credit before touching the database", async () => {
    await expect(creditTokens({ ...args, credits: 0 })).rejects.toThrow();
    await expect(creditTokens({ ...args, credits: -5 })).rejects.toThrow();
    expect(captured).toHaveLength(0);
  });

  it("makes sure the account exists, idempotently, before the lock", async () => {
    await creditTokens(args);
    const ensure = only('insert into "token_accounts"');
    expect(ensure.sql.toLowerCase()).toContain('on conflict ("member_id") do nothing');
    expect(ensure.params).toContain("member-1");
  });

  it("🚨 reads the account FOR UPDATE — two IPNs for two orders must not both add to the same stale balance", async () => {
    await creditTokens(args);
    const locked = statements().find((s) => s.startsWith("select") && s.includes("for update"));
    expect(locked, "no locked read of the account").toBeDefined();
    expect(locked).toContain('"member_id" =');
  });

  it("🚨 the ledger row carries the ORDER id and yields to the partial unique on it", async () => {
    await creditTokens(args);
    const ledger = only('insert into "token_ledger"');
    const q = ledger.sql.toLowerCase();
    expect(q).toMatch(
      /on conflict \("ds24_order_id"\) where "token_ledger"\."ds24_order_id" is not null and "token_ledger"\."type" = 'topup' do nothing/,
    );
    expect(q).toContain("returning");
    expect(ledger.params).toContain("ORD-1");
    expect(ledger.params).toContain("topup");
    expect(ledger.params).toContain(500);
    expect(ledger.params, "balance_after is the NEW balance").toContain(600);
  });

  it("a fresh booking moves the balance by exactly the credits", async () => {
    const result = await creditTokens(args);
    expect(result).toEqual({ credited: true, balance: 600 });
    const update = only('update "token_accounts"');
    expect(update.params).toContain(600);
    expect(update.params).toContain("acct-1");
  });

  it("🚨 a redelivered order is booked NOWHERE — no ledger row, no balance change", async () => {
    state.ledgerInserted = [];
    const result = await creditTokens(args);
    expect(result).toEqual({ credited: false, balance: 100 });
    expect(statements().filter((s) => s.startsWith('update "token_accounts"'))).toHaveLength(0);
  });

  it("…but a redelivery that carries the mandate's order id still links it, once", async () => {
    state.ledgerInserted = [];
    await creditTokens({ ...args, linkPurchaseId: "ORD-1" });
    const update = only('update "token_accounts"');
    expect(update.sql.toLowerCase()).toContain('"ds24_purchase_id"');
    expect(update.sql.toLowerCase(), "the balance is not part of that write").not.toContain('"balance"');
    expect(update.params).toContain("ORD-1");
  });

  it("never overwrites a mandate that is already linked", async () => {
    state.account = [account({ ds24PurchaseId: "ORD-OLD" })];
    await creditTokens({ ...args, linkPurchaseId: "ORD-NEW" });
    const update = only('update "token_accounts"');
    expect(update.sql.toLowerCase()).not.toContain('"ds24_purchase_id"');
    expect(update.params).not.toContain("ORD-NEW");
  });

  it("🚨 releases the auto-reload lock only when it still owns it", async () => {
    const lock = new Date("2026-09-15T11:00:00.000Z");
    state.account = [account({ reloadLockedAt: pg(lock), reloadAttempts: 1 })];

    await creditTokens({ ...args, releaseReloadLock: true, releaseLockedAt: lock });
    let update = only('update "token_accounts"');
    expect(update.sql.toLowerCase()).toContain('"reload_locked_at"');
    expect(update.sql.toLowerCase()).toContain('"reload_attempts"');

    captured.length = 0;
    const successor = new Date("2026-09-15T11:30:00.000Z");
    state.account = [account({ reloadLockedAt: pg(successor), reloadAttempts: 1 })];
    await creditTokens({ ...args, releaseReloadLock: true, releaseLockedAt: lock });
    update = only('update "token_accounts"');
    expect(
      update.sql.toLowerCase(),
      "a late IPN cleared a lock a later charge had taken — the next spend would charge a third time",
    ).not.toContain('"reload_locked_at"');
  });

  it("a caller that names no lock keeps the old behaviour: the lock is cleared", async () => {
    state.account = [account({ reloadLockedAt: pg(new Date("2026-09-15T11:00:00.000Z")) })];
    await creditTokens({ ...args, releaseReloadLock: true });
    expect(only('update "token_accounts"').sql.toLowerCase()).toContain('"reload_locked_at"');
  });
});

describe("consumeTokens — check, then charge, under a lock", () => {
  it("refuses a non-positive amount before touching the database", async () => {
    await expect(consumeTokens({ memberId: "member-1", amount: 0 })).rejects.toThrow();
    expect(captured).toHaveLength(0);
  });

  it("🚨 reads FOR UPDATE, then writes the balance and a negative ledger row", async () => {
    const balance = await consumeTokens({ memberId: "member-1", amount: 30, note: "chat", now: NOW });
    expect(balance).toBe(70);

    const [read, update, ledger] = statements();
    expect(read).toMatch(/^select .* for update$/);
    expect(update).toMatch(/^update "token_accounts" set "balance"/);
    expect(captured[1]!.params).toContain(70);
    expect(ledger).toMatch(/^insert into "token_ledger"/);
    expect(captured[2]!.params).toContain(-30);
    expect(captured[2]!.params).toContain(70);
    expect(captured[2]!.params).toContain("consume");
    expect(ledger, "a consume row is not idempotent and must not pretend to be").not.toContain("on conflict");
  });

  it("🚨 an insufficient balance throws with both numbers and writes NOTHING", async () => {
    state.account = [account({ balance: 20 })];
    const error = await consumeTokens({ memberId: "member-1", amount: 30 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InsufficientTokensError);
    expect(error).toMatchObject({ balance: 20, requested: 30 });
    expect(statements().filter((s) => !s.startsWith("select"))).toEqual([]);
  });

  it("a member with no account has a balance of 0, and is refused the same way", async () => {
    state.account = [];
    await expect(consumeTokens({ memberId: "member-9", amount: 1 })).rejects.toMatchObject({
      balance: 0,
      requested: 1,
    });
    expect(statements().filter((s) => !s.startsWith("select"))).toEqual([]);
  });

  it("spending the whole balance is allowed; one more is not", async () => {
    state.account = [account({ balance: 30 })];
    await expect(consumeTokens({ memberId: "member-1", amount: 30 })).resolves.toBe(0);
    state.account = [account({ balance: 30 })];
    await expect(consumeTokens({ memberId: "member-1", amount: 31 })).rejects.toBeInstanceOf(
      InsufficientTokensError,
    );
  });
});

describe("adjustTokens — the operator's correction", () => {
  const args = { actor: OWNER, memberId: "member-1", amount: "50", reason: "Kulanz nach Ausfall", now: NOW };

  it("🚨 an app that sells no tokens has no by-hand mint — refused before any statement", async () => {
    vi.mocked(sellsTokens).mockReturnValue(false);
    await expect(adjustTokens(args)).rejects.toMatchObject({ code: "tokensNotSold" });
    expect(captured).toHaveLength(0);
  });

  it("books the delta under the lock, signed by the operator, with no order id and no conflict clause", async () => {
    const result = await adjustTokens(args);
    expect(result).toEqual({ balance: 150, delta: 50 });

    expect(statements().some((s) => s.startsWith("select") && s.includes("for update"))).toBe(true);
    expect(only('update "token_accounts"').params).toContain(150);

    const ledger = only('insert into "token_ledger"');
    const q = ledger.sql.toLowerCase();
    expect(ledger.params).toContain("adjust");
    expect(ledger.params).toContain(50);
    expect(ledger.params).toContain("owner-1");
    expect(q).toContain('"issued_by"');
    expect(q, "an adjust row is a second legitimate correction, never a duplicate").not.toContain("on conflict");
    // Drizzle lists every column and writes `default` for the ones not set —
    // so the claim is about the VALUE slot of `ds24_order_id`, not the name.
    const columns = /\(([^)]*)\) values \(([^)]*)\)/.exec(q)!;
    const names = columns[1]!.split(",").map((c) => c.trim().replace(/"/g, ""));
    const values = columns[2]!.split(",").map((v) => v.trim());
    expect(
      values[names.indexOf("ds24_order_id")],
      "linking the correction to a purchase would collide with the topup row",
    ).toBe("default");
  });

  it("a downward correction is a negative delta against the LOCKED balance", async () => {
    const result = await adjustTokens({ ...args, amount: "-40" });
    expect(result).toEqual({ balance: 60, delta: -40 });
    expect(only('insert into "token_ledger"').params).toContain(-40);
  });

  it("🚨 a refused correction throws a translatable code and writes nothing after the read", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["a member as actor", { actor: { id: "m-1", role: "member" } }],
      ["a non-numeric amount", { amount: "fifty" }],
      ["a correction below zero", { amount: "-500" }],
      ["no reason", { reason: "" }],
    ];
    for (const [label, over] of cases) {
      captured.length = 0;
      const error = await adjustTokens({ ...args, ...over } as typeof args).catch((e: unknown) => e);
      expect(error, label).toBeInstanceOf(TokenError);
      expect(
        statements().filter((s) => s.startsWith("update") || s.startsWith('insert into "token_ledger"')),
        label,
      ).toEqual([]);
    }
  });
});
