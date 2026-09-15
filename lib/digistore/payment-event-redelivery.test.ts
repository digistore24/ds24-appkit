// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The same IPN twice, and the wrong IPN first.
//
// Digistore24 redelivers: a 500, a timeout, a support click, and the identical
// `on_payment` arrives again. `payment-event.test.ts` holds WHICH transition an
// event maps to; what it did not hold (measured 2026-09-15) is the shape that
// keeps money moving in one direction on the second delivery — the `CASE` in
// the order upsert that refuses to flip a refunded order back to paid. It was
// asserted as `toContain("coalesce")` and nothing about the status at all.
//
// The database is the same `pg-proxy` capture as the sibling file: the real
// Drizzle builder renders the statement, and what is asserted is the SQL and
// the bound values — the fake cannot tell us what Postgres would do with them,
// which is what `scripts/deploy-ipn.mjs` replays against a real database.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getTokenPackage } from "@/lib/tokens/packages";
import { keysOrSkip, planShapedKey, tokenKey } from "./test-product-keys";

interface Captured {
  sql: string;
  params: unknown[];
}

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const captured: Captured[] = [];
  const state = { identity: [] as unknown[][] };
  const db = drizzle(async (sql: string, params: unknown[]) => {
    captured.push({ sql, params });
    if (sql.toLowerCase().includes('from "users"')) return { rows: state.identity };
    return { rows: [] };
  });
  return { db, __captured: captured, __state: state };
});

const { applyGrantTransition, purchaseGrant, openPurchaseGrantByPurchase } = vi.hoisted(() => ({
  applyGrantTransition: vi.fn(async () => undefined),
  purchaseGrant: vi.fn(async () => null as unknown),
  openPurchaseGrantByPurchase: vi.fn(async () => null as unknown),
}));
vi.mock("@/lib/entitlements/manage", () => ({
  applyGrantTransition,
  purchaseGrant,
  openPurchaseGrantByPurchase,
}));

const { creditTokens, disarmAutoReload, getTokenAccount, setAutoReload } = vi.hoisted(() => ({
  creditTokens: vi.fn(async () => ({ credited: true })),
  disarmAutoReload: vi.fn(async () => false),
  getTokenAccount: vi.fn(async () => null as unknown),
  setAutoReload: vi.fn(async () => undefined),
}));
vi.mock("@/lib/tokens/account", () => ({
  creditTokens,
  disarmAutoReload,
  getTokenAccount,
  setAutoReload,
}));

import * as dbModule from "@/db";

import { onPaymentEvent } from "./payment-event";

const captured = (dbModule as unknown as { __captured: Captured[] }).__captured;
const state = (dbModule as unknown as { __state: { identity: unknown[][] } }).__state;

// Well-formed, or `parseCustom()` answers null and every case takes the
// anonymous path — see the sibling file for the shapes.
const MEMBER = "3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const TOKEN = "Ab3xY9zQ71";
const ORDER = "ORD-77";
const PLAN_PICK = planShapedKey();
const TOKEN_PICK = tokenKey();

function payload(event: string, productKey: string | null, over: Record<string, string> = {}) {
  return {
    event,
    order_id: ORDER,
    buyer_email: "kaeufer@example.com",
    custom: `m:${MEMBER};t:${TOKEN};p:${productKey ?? ""}`,
    ...over,
  };
}

/** The order upserts this run sent, in order. */
function orderUpserts(): Captured[] {
  return captured.filter((c) => c.sql.toLowerCase().startsWith('insert into "orders"'));
}

beforeEach(() => {
  captured.length = 0;
  state.identity = [[MEMBER]];
  applyGrantTransition.mockClear();
  creditTokens.mockClear().mockResolvedValue({ credited: true });
  purchaseGrant.mockClear().mockResolvedValue(null);
  openPurchaseGrantByPurchase.mockClear().mockResolvedValue(null);
});

describe("the order upsert — one row per order id, and money moves in one direction", () => {
  it("keys the conflict on the Digistore order id", async (ctx) => {
    const [plan] = keysOrSkip(ctx, PLAN_PICK);
    await onPaymentEvent(payload("on_payment", plan));

    const [upsert] = orderUpserts();
    expect(upsert, "no order upsert was sent").toBeDefined();
    expect(upsert!.sql.toLowerCase()).toMatch(/on conflict \("ds24_order_id"\) do update/);
    expect(upsert!.params).toContain(ORDER);
  });

  it("🚨 the status write is a CASE that keeps refunded and chargeback — never a plain overwrite", async (ctx) => {
    const [plan] = keysOrSkip(ctx, PLAN_PICK);
    await onPaymentEvent(payload("on_payment", plan));

    const sql = orderUpserts()[0]!.sql.toLowerCase();
    const set = sql.slice(sql.indexOf("do update set"));
    expect(set).toMatch(
      /"status" = case when "orders"\."status" in \('refunded','chargeback'\)\s+then "orders"\."status"\s+else \$\d+::order_status end/,
    );
    // Both the INSERT half and the CASE bind the new status — and it is `paid`.
    expect(orderUpserts()[0]!.params.filter((p) => p === "paid").length).toBeGreaterThanOrEqual(2);
  });

  it("🚨 the cast is there — without `::order_status` Postgres refuses the whole upsert", async (ctx) => {
    const [plan] = keysOrSkip(ctx, PLAN_PICK);
    await onPaymentEvent(payload("on_payment", plan));
    expect(orderUpserts()[0]!.sql).toContain("::order_status");
  });

  it("the attribution and the product are fill-only on conflict", async (ctx) => {
    const [plan] = keysOrSkip(ctx, PLAN_PICK);
    await onPaymentEvent(payload("on_payment", plan));

    const sql = orderUpserts()[0]!.sql.toLowerCase();
    const set = sql.slice(sql.indexOf("do update set"));
    expect(set).toMatch(/"member_id" = coalesce\("orders"\."member_id", excluded\.member_id\)/);
    expect(set).toMatch(/"product_key" = coalesce\("orders"\."product_key", excluded\.product_key\)/);
  });
});

describe("the same payment twice", () => {
  it("sends the identical upsert both times — the database decides, not a second code path", async (ctx) => {
    const [plan] = keysOrSkip(ctx, PLAN_PICK);
    await onPaymentEvent(payload("on_payment", plan));
    await onPaymentEvent(payload("on_payment", plan));

    const [first, second] = orderUpserts();
    expect(second, "the redelivery wrote no order row").toBeDefined();
    expect(second!.sql).toBe(first!.sql);
    // Everything but the fresh row id and the two `now()` timestamps is bound
    // identically — and the id is irrelevant, because the conflict target is
    // the order id and the existing row keeps its own.
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const stable = (c: Captured) =>
      c.params.filter(
        (p) => !(typeof p === "string" && (/^\d{4}-\d{2}-\d{2}T/.test(p) || (UUID.test(p) && p !== MEMBER))),
      );
    expect(stable(second!)).toEqual(stable(first!));
    expect(orderUpserts()).toHaveLength(2);
  });

  it("hands the entitlement layer the SAME activation twice — its own idempotence is the guard", async (ctx) => {
    const [plan] = keysOrSkip(ctx, PLAN_PICK);
    await onPaymentEvent(payload("on_payment", plan));
    await onPaymentEvent(payload("on_payment", plan));

    expect(applyGrantTransition).toHaveBeenCalledTimes(2);
    const [a, b] = applyGrantTransition.mock.calls as unknown as [unknown, unknown][];
    expect(b).toEqual(a);
    expect(a[0]).toMatchObject({ kind: "activate" });
    expect(a[1]).toMatchObject({ memberId: MEMBER, productKey: plan, ds24PurchaseId: ORDER });
  });

  it("🚨 credits a token package under the SAME order id twice — the ledger's unique key is what refuses", async (ctx) => {
    const [pkg] = keysOrSkip(ctx, TOKEN_PICK);
    await onPaymentEvent(payload("on_payment", pkg));
    await onPaymentEvent(payload("on_payment", pkg));

    expect(creditTokens).toHaveBeenCalledTimes(2);
    for (const [args] of creditTokens.mock.calls as unknown as [Record<string, unknown>][]) {
      expect(args).toMatchObject({
        memberId: MEMBER,
        ds24OrderId: ORDER,
        credits: getTokenPackage(pkg).credits,
      });
    }
  });

  it("a redelivery the ledger has already booked is not an error", async (ctx) => {
    const [pkg] = keysOrSkip(ctx, TOKEN_PICK);
    creditTokens.mockResolvedValueOnce({ credited: true }).mockResolvedValueOnce({ credited: false });
    await onPaymentEvent(payload("on_payment", pkg));
    await expect(onPaymentEvent(payload("on_payment", pkg))).resolves.not.toThrow();
  });
});

describe("the wrong event first — a refund whose payment never arrived", () => {
  it("still writes the order, as refunded, and grants nothing", async (ctx) => {
    const [plan] = keysOrSkip(ctx, PLAN_PICK);
    await onPaymentEvent(payload("on_refund", plan));

    const [upsert] = orderUpserts();
    expect(upsert, "a refund with no order row must still record the money").toBeDefined();
    expect(upsert!.params).toContain("refunded");
    expect(upsert!.params).not.toContain("paid");

    expect(applyGrantTransition).toHaveBeenCalledTimes(1);
    const [what] = applyGrantTransition.mock.calls[0] as unknown as [{ kind: string }];
    expect(what.kind).toBe("end");
    expect(what.kind).not.toBe("activate");
  });

  it("…and the payment arriving afterwards carries `paid` only inside the CASE, so the row stays refunded", async (ctx) => {
    const [plan] = keysOrSkip(ctx, PLAN_PICK);
    await onPaymentEvent(payload("on_refund", plan));
    await onPaymentEvent(payload("on_payment", plan));

    const late = orderUpserts()[1]!;
    const sql = late.sql.toLowerCase();
    const set = sql.slice(sql.indexOf("do update set"));
    // The only place `status` is assigned in the conflict branch is the CASE.
    expect(set.match(/"status" = /g)).toHaveLength(1);
    expect(set).toContain("case when");
    expect(late.params).toContain("paid");
  });

  it("a refund credits no tokens, whatever came before", async (ctx) => {
    const [pkg] = keysOrSkip(ctx, TOKEN_PICK);
    await onPaymentEvent(payload("on_refund", pkg));
    expect(creditTokens).not.toHaveBeenCalled();
  });
});
