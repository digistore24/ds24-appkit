// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The one question the `sell` field turns on: WHICH list does each reader
// get — and it is asked here rather than in `products.test.ts` because it can
// only be asked against a registry that HOLDS a parked offering.
//
// The shipped registry holds none, deliberately (nothing ships parked). So a
// test that passes its own fixture in — `productByDs24Id(id, [PARKED])` — is
// asking about the argument, never about the DEFAULT argument, and the
// default is where a misplaced filter would actually sit:
//
//     export function productByDs24Id(id, products = allProducts())
//                                                    ^^^^^^^^^^^^^
// Measured while this file was written: moving `.filter(isSold)` into
// `allProducts()` left the entire 354-test `lib/digistore` suite green,
// because no test reached that default with a parked entry present. The
// mocked registry below is what makes the claim measurable at all.
//
// The registry is mocked for the same reason `test-product-keys.test.ts`
// mocks it: the state under test is one the shipped file cannot be in.
import { describe, expect, it, vi } from "vitest";

/** Mutated per test — every function here reads the registry fresh. */
const REGISTRY: { products: Record<string, unknown> } = { products: {} };
vi.mock("@/config/digistore-products.json", () => ({ default: REGISTRY }));

const {
  allProducts,
  sellableProducts,
  findProduct,
  getProduct,
  productByDs24Id,
  productsByKind,
  productId,
  hasProductId,
} = await import("./products");

// A plan somebody is still PAYING for, taken off sale: it has ids at
// Digistore24 because it was synced back when it was on offer. That is the
// whole point — a parked entry with no ids was never bought and cannot
// demonstrate anything.
const RETIRED = {
  name: "Retired plan",
  kind: "subscription",
  billingInterval: "1_month",
  priceCents: 1900,
  sell: false,
  productIds: { prod: { de: "9001", en: "9002" } },
};

const LIVE = {
  name: "Basic (monthly)",
  kind: "subscription",
  billingInterval: "1_month",
  priceCents: 1900,
  productIds: { prod: { de: "1001", en: "1002" } },
};

const PARKED_TOKENS = {
  name: "Retired tokens",
  kind: "token",
  credits: 1000,
  priceCents: 900,
  sell: false,
  productIds: { prod: { de: "9003" } },
};

REGISTRY.products = { live: LIVE, retired: RETIRED, retired_tokens: PARKED_TOKENS };

describe("the offer side is filtered", () => {
  it("sellableProducts drops both parked offerings", () => {
    expect(sellableProducts().map((p) => p.key)).toEqual(["live"]);
  });

  it("productsByKind drops a parked token package", () => {
    // Goes through allProducts(), so it follows the ANSWER side — the parked
    // package is still a token package, it is just not on offer. What decides
    // the offer is `listTokenPackages()`, one file over.
    expect(productsByKind("token").map((p) => p.key)).toEqual(["retired_tokens"]);
  });
});

// 🚨 THE needle. Every assertion below goes through a DEFAULT argument or
// reads the raw registry — the two paths a filter in `allProducts()` would
// reach without any call site changing. Each one is somebody's money.
describe("the answer side is NOT filtered", () => {
  it("allProducts keeps every declared offering", () => {
    expect(allProducts().map((p) => p.key)).toEqual([
      "live",
      "retired",
      "retired_tokens",
    ]);
  });

  it("productByDs24Id resolves a parked plan through its DEFAULT list", () => {
    // No second argument. This is the IPN's reverse lookup: a rebill, a
    // refund or a chargeback for this plan names id 9001, and an answer of
    // `null` means the payment is never attributed — `orders.productKey` is
    // not reconstructed afterwards.
    expect(productByDs24Id("9001")?.key).toBe("retired");
    expect(productByDs24Id("9002")?.key).toBe("retired");
  });

  it("productByDs24Id resolves a parked token package too", () => {
    // Different failure mode, same cause: no credit lands on the balance.
    expect(productByDs24Id("9003")?.key).toBe("retired_tokens");
  });

  it("findProduct and getProduct answer for a parked key", () => {
    // These read the raw registry rather than allProducts(), so they are
    // unaffected by construction — pinned so that stays true. `hasPlan()`
    // throws through getProduct(), and it is asked about a paying member.
    expect(findProduct("retired")?.key).toBe("retired");
    expect(getProduct("retired").name).toBe("Retired plan");
  });

  it("a parked offering still has a live product id", () => {
    // What the entitlement and top-up paths need: parked means "not on
    // offer", never "not deliverable".
    expect(hasProductId("retired")).toBe(true);
    expect(productId("retired", "de")).toBe("9001");
  });
});

// The counter-proof. Without it every assertion above would also pass if
// `sell` did nothing whatsoever — the four tests would be measuring the
// registry, not the field.
describe("counter-proof — the field is doing something", () => {
  it("the same run gives two different lists", () => {
    expect(allProducts()).toHaveLength(3);
    expect(sellableProducts()).toHaveLength(1);
  });
});
