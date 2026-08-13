// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { purchaseNotice, type PurchaseOrder } from "./purchase-notice";
import type { ProductDef } from "./products";

const plan: ProductDef = {
  key: "basic_monthly",
  name: "Basic (monthly)",
  kind: "subscription",
  billingInterval: "1_month",
  priceCents: 1900,
};

const pack: ProductDef = {
  key: "starter",
  name: "Starter Tokens",
  kind: "token",
  // Deliberately different from what the orders below recorded: the registry is
  // a file the app-builder edits, and the toast must not follow it.
  credits: 5000,
  priceCents: 900,
};

const once: ProductDef = {
  key: "lifetime",
  name: "Lifetime",
  kind: "one_time",
  priceCents: 49000,
};

const registry: Record<string, ProductDef> = {
  basic_monthly: plan,
  starter: pack,
  lifetime: once,
};

const lookup = (key: string) => registry[key] ?? null;

const order = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  status: "paid",
  productKey: "basic_monthly",
  credits: null,
  ...over,
});

describe("purchaseNotice", () => {
  it("names the plan that was unlocked", () => {
    expect(purchaseNotice(order(), lookup)).toEqual({
      kind: "plan",
      product: "Basic (monthly)",
    });
  });

  it("treats a one-off purchase as a plan too", () => {
    expect(purchaseNotice(order({ productKey: "lifetime" }), lookup)).toEqual({
      kind: "plan",
      product: "Lifetime",
    });
  });

  it("names the credits the ORDER recorded, not the registry's current value", () => {
    // The order was written when the package still gave 1000; the registry now
    // says 5000. What landed on the balance is 1000, so that is what is said.
    const notice = purchaseNotice(
      order({ productKey: "starter", credits: 1000 }),
      lookup,
    );
    expect(notice).toEqual({ kind: "tokens", credits: 1000 });
  });

  it("falls back to a general confirmation for a token order with no credits recorded", () => {
    // Nothing honest to name — but the money was taken, so say something.
    expect(
      purchaseNotice(order({ productKey: "starter", credits: null }), lookup),
    ).toEqual({ kind: "generic" });
    expect(
      purchaseNotice(order({ productKey: "starter", credits: 0 }), lookup),
    ).toEqual({ kind: "generic" });
  });

  it("falls back to a general confirmation when the product key is missing", () => {
    expect(purchaseNotice(order({ productKey: null }), lookup)).toEqual({
      kind: "generic",
    });
  });

  it("falls back to a general confirmation when the registry no longer holds the key", () => {
    // The app-builder renamed or deleted the entry after the order was written.
    // getProduct() would throw here; the toast must not.
    expect(purchaseNotice(order({ productKey: "sold_out" }), lookup)).toEqual({
      kind: "generic",
    });
  });

  it("says nothing about an order that is not paid", () => {
    // The reference survives in a bookmark or a history entry. Congratulating
    // somebody on a purchase whose money went back is worse than silence.
    for (const status of ["refunded", "chargeback"] as const) {
      expect(purchaseNotice(order({ status }), lookup)).toBeNull();
    }
    expect(purchaseNotice(order({ status: "cancelled" }), lookup)).toBeNull();
    expect(purchaseNotice(order({ status: "paused" }), lookup)).toBeNull();
  });

  it("says nothing when there is no order at all", () => {
    expect(purchaseNotice(null, lookup)).toBeNull();
    expect(purchaseNotice(undefined, lookup)).toBeNull();
  });
});
