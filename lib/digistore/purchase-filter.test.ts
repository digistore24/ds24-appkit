// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  parsePurchaseFilter,
  canAttachOrder,
  purchaseFilterHref,
  isFiltered,
  ANY_PRODUCT,
  PURCHASES_PAGE_SIZE,
  PURCHASES_PATH,
} from "./purchase-filter";

// Story 3.7 §D2/§D3/§D6. The whole reason this module is pure and separate is
// the one claimable.ts states: a rule that lives inside a SQL `where` clause is
// a rule nothing asserts. These filters decide WHICH purchases an Operator
// sees, and a filter that silently matches too much is how somebody refunds the
// wrong order.
describe("parsePurchaseFilter", () => {
  it("reads nothing out of an empty query — no filter, first page", () => {
    expect(parsePurchaseFilter({})).toEqual({
      email: null,
      productKey: null,
      orderId: null,
      assignment: "all",
      page: 1,
    });
  });

  it("trims the text fragments", () => {
    const f = parsePurchaseFilter({ email: "  a@b.de ", order: " 4711 " });
    expect(f.email).toBe("a@b.de");
    expect(f.orderId).toBe("4711");
  });

  it("treats a blank field as no filter — clearing the form brings every row back", () => {
    // The GET form submits `email=` when the Operator empties it. Reading that
    // as a fragment would match rows whose address contains "" (all of them
    // with an address) and drop every row without one.
    const f = parsePurchaseFilter({ email: "", order: "   ", product: "" });
    expect(f.email).toBeNull();
    expect(f.orderId).toBeNull();
    expect(f.productKey).toBeNull();
  });

  it("takes the first value when a key arrives twice", () => {
    expect(parsePurchaseFilter({ email: ["a@b.de", "c@d.de"] }).email).toBe(
      "a@b.de",
    );
  });

  it("keeps an unknown product key instead of dropping it (§D2)", () => {
    // Dropping it would show MORE rows than the URL asked for — the failure
    // mode that gets an Operator to act on the wrong purchase. It stays in the
    // query and honestly matches nothing.
    expect(parsePurchaseFilter({ product: "does-not-exist" }).productKey).toBe(
      "does-not-exist",
    );
  });

  it("reads the form's \"any product\" sentinel as no filter", () => {
    // Radix forbids an empty item value, so the Select's "any product" entry
    // carries a sentinel. With JavaScript it never reaches the URL; without it,
    // the plain GET form submits it and the page must show everything.
    expect(parsePurchaseFilter({ product: ANY_PRODUCT }).productKey).toBeNull();
  });

  it("reads the assignment filter, and only its three known values", () => {
    expect(parsePurchaseFilter({ assignment: "unassigned" }).assignment).toBe(
      "unassigned",
    );
    expect(parsePurchaseFilter({ assignment: "assigned" }).assignment).toBe(
      "assigned",
    );
    expect(parsePurchaseFilter({ assignment: "all" }).assignment).toBe("all");
    expect(parsePurchaseFilter({ assignment: "nonsense" }).assignment).toBe(
      "all",
    );
  });

  it("falls back to page 1 for anything that is not a page number", () => {
    for (const page of ["", "0", "-3", "abc", "NaN", "1.5.2"]) {
      expect(parsePurchaseFilter({ page }).page).toBe(1);
    }
    expect(parsePurchaseFilter({ page: "7" }).page).toBe(7);
  });

  it("recognises whether anything is filtered at all — paging is not a filter", () => {
    expect(isFiltered(parsePurchaseFilter({}))).toBe(false);
    expect(isFiltered(parsePurchaseFilter({ page: "4" }))).toBe(false);
    expect(isFiltered(parsePurchaseFilter({ email: "a@b.de" }))).toBe(true);
    expect(isFiltered(parsePurchaseFilter({ assignment: "unassigned" }))).toBe(
      true,
    );
  });
});

describe("canAttachOrder", () => {
  it("allows a claimable purchase that has no account", () => {
    expect(canAttachOrder({ memberId: null, status: "paid" })).toBe(true);
    expect(canAttachOrder({ memberId: null, status: "cancelled" })).toBe(true);
    expect(canAttachOrder({ memberId: null, status: "paused" })).toBe(true);
  });

  it("refuses a refunded or charged-back purchase — the money went back (§D6)", () => {
    expect(canAttachOrder({ memberId: null, status: "refunded" })).toBe(false);
    expect(canAttachOrder({ memberId: null, status: "chargeback" })).toBe(false);
  });

  it("refuses a purchase that already has an account", () => {
    expect(canAttachOrder({ memberId: "u1", status: "paid" })).toBe(false);
  });
});

describe("purchaseFilterHref", () => {
  it("is the bare page when nothing is set", () => {
    expect(purchaseFilterHref(parsePurchaseFilter({}), 1)).toBe(PURCHASES_PATH);
  });

  it("carries every set filter into the paging link (AC 7)", () => {
    const f = parsePurchaseFilter({
      email: "a@b.de",
      product: "pro",
      order: "4711",
      assignment: "unassigned",
      page: "2",
    });
    const href = purchaseFilterHref(f, 3);
    expect(href.startsWith(`${PURCHASES_PATH}?`)).toBe(true);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("email")).toBe("a@b.de");
    expect(params.get("product")).toBe("pro");
    expect(params.get("order")).toBe("4711");
    expect(params.get("assignment")).toBe("unassigned");
    expect(params.get("page")).toBe("3");
  });

  it("omits page 1 — the first page has no page number in its URL", () => {
    const f = parsePurchaseFilter({ email: "a@b.de", page: "2" });
    expect(purchaseFilterHref(f, 1)).toBe(
      `${PURCHASES_PATH}?email=a%40b.de`,
    );
  });

  it("pages in units the list actually renders", () => {
    expect(PURCHASES_PAGE_SIZE).toBeGreaterThan(0);
  });
});
