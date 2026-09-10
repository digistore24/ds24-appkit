// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The key in `custom` does not outrank the product Digistore24 CHARGED.
//
// Finding M-2 of the 2026-08-18 scan. `resolveProduct()` took the `p:` pair out
// of the identity string and, if the registry knew that key, granted it —
// `product_id`, Digistore24's own statement of what it billed, was consulted
// only when `custom` produced nothing. `body["amount"]` is read twice in
// `payment-event.ts` and logged both times, so the price was not a second
// opinion either. Nothing anywhere held the two against each other.
//
// ⚠️ **Why this file exists instead of a case in `payment-event.test.ts`.**
// The shipped `config/digistore-products.json` has `productIds` full of nulls
// — nothing is synced in a fresh app — so `productByDs24Id()` answers `null`
// for every input and the comparison under test can never be REACHED against
// the real registry. A case over there would have been green without asking
// anything, which is the failure mode this repo keeps writing down. So the
// registry is mocked here, with two products that carry ids, and this file
// mocks `@/lib/digistore/products` wholesale — which is exactly why it cannot
// live next to tests that need the real one.
import { beforeEach, describe, expect, it, vi } from "vitest";

const CHEAP = { key: "cheap_plan", kind: "subscription" as const };
const EXPENSIVE = { key: "expensive_plan", kind: "subscription" as const };

// id → product, the way a synced registry would answer.
const BY_DS24_ID: Record<string, typeof CHEAP> = {
  "1001": CHEAP,
  "2002": EXPENSIVE,
};
const BY_KEY: Record<string, typeof CHEAP> = {
  [CHEAP.key]: CHEAP,
  [EXPENSIVE.key]: EXPENSIVE,
};

vi.mock("@/lib/digistore/products", () => ({
  getProduct: (key: string) => {
    const found = BY_KEY[key];
    if (!found) throw new Error(`unknown product ${key}`);
    return found;
  },
  productByDs24Id: (id: string | null | undefined) => (id ? BY_DS24_ID[String(id)] ?? null : null),
}));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const state = { identity: [] as unknown[][] };
  const db = drizzle(async (sql: string) => {
    if (sql.toLowerCase().includes('from "users"')) return { rows: state.identity };
    return { rows: [] };
  });
  return { db, __state: state };
});

const { applyGrantTransition, purchaseGrant, openPurchaseGrantByPurchase } = vi.hoisted(() => ({
  applyGrantTransition: vi.fn(),
  purchaseGrant: vi.fn(),
  openPurchaseGrantByPurchase: vi.fn(),
}));

vi.mock("@/lib/entitlements/manage", () => ({
  applyGrantTransition,
  purchaseGrant,
  openPurchaseGrantByPurchase,
}));

vi.mock("@/lib/tokens/account", () => ({
  creditTokens: vi.fn().mockResolvedValue({ credited: true }),
  disarmAutoReload: vi.fn().mockResolvedValue(false),
  getTokenAccount: vi.fn().mockResolvedValue(null),
  setAutoReload: vi.fn(),
}));

import { onPaymentEvent } from "./payment-event";
import * as dbModule from "@/db";

const state = (dbModule as unknown as { __state: { identity: unknown[][] } }).__state;

const MEMBER = "3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const TOKEN = "Ab3xY9zQ71";

function payload(over: Record<string, string> = {}) {
  return {
    event: "on_payment",
    order_id: "ORD-1",
    buyer_email: "kaeufer@example.com",
    custom: `m:${MEMBER};t:${TOKEN};p:${CHEAP.key}`,
    ...over,
  };
}

/** Which product key reached the entitlement layer. */
function grantedKey(): string {
  expect(applyGrantTransition).toHaveBeenCalledTimes(1);
  const call = applyGrantTransition.mock.calls[0] as unknown as [
    unknown,
    { productKey: string },
  ];
  return call[1].productKey;
}

let errors: unknown[][] = [];

beforeEach(() => {
  state.identity = [[MEMBER]];
  applyGrantTransition.mockClear();
  purchaseGrant.mockClear().mockResolvedValue(null);
  openPurchaseGrantByPurchase.mockClear().mockResolvedValue(null);
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
});

describe("custom vs. the charged product", () => {
  it("🚨 grants what was CHARGED when the two disagree", async () => {
    // `custom` names the cheap plan; Digistore24 says it billed product 2002,
    // which is the expensive one. Before the fix the cheap key won and the
    // buyer got whichever plan `custom` asked for.
    await onPaymentEvent(payload({ product_id: "2002" }));

    expect(grantedKey()).toBe(EXPENSIVE.key);
  });

  it("says so through console.error WITH an Error — or `node run.mjs errors` is blind", async () => {
    await onPaymentEvent(payload({ product_id: "2002" }));

    expect(errors).toHaveLength(1);
    const [message, error] = errors[0];
    expect(String(message)).toMatch(/custom names "cheap_plan"/);
    expect(String(message)).toMatch(/2002/);
    // The shape is the point: `lib/diagnostics/parse.mjs` keys on an Error
    // object, and a bare console.warn is invisible to the errors command.
    expect(error).toBeInstanceOf(Error);
  });

  it("stays silent and believes `custom` when the two AGREE", async () => {
    await onPaymentEvent(payload({ product_id: "1001" }));

    expect(grantedKey()).toBe(CHEAP.key);
    expect(errors).toHaveLength(0);
  });

  it("believes `custom` when the charged id is unknown to the registry", async () => {
    // The not-yet-synced product and the product sold outside this registry —
    // both described in resolveProduct's header. A mismatch cannot be claimed
    // against an id nothing can resolve.
    await onPaymentEvent(payload({ product_id: "9999" }));

    expect(grantedKey()).toBe(CHEAP.key);
    expect(errors).toHaveLength(0);
  });

  it("still resolves an ANONYMOUS purchase from product_id alone", async () => {
    // 🚨 The regression the fix must not cause. No `custom` at all: without
    // step 2 the order's product key is NULL for ever and the purchase can
    // never become a grant.
    state.identity = [];
    await onPaymentEvent({
      event: "on_payment",
      order_id: "ORD-2",
      buyer_email: "anonym@example.com",
      product_id: "2002",
    });

    // No member could be identified, so no grant is applied — but the product
    // was resolved, which is what `orders.productKey` needs.
    expect(errors).toHaveLength(0);
  });
});
