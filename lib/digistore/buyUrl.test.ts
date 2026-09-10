// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  buildBuyUrlBody,
  offerHash,
  isUnknownAffiliateError,
  isStalePaymentPlanError,
  sellsThroughStoredPlan,
  isUserSpecific,
  type Offer,
} from "./buyUrl";
import { buildIdentity } from "./custom";
import { tokenCustomMarker } from "@/lib/tokens/packages";

const monthly: Offer = {
  key: "gold",
  productId: "123456",
  priceCents: 900,
  billingInterval: "1_month",
  title: "Paid Challenge - Gold",
  description: "Gold plan (monthly)",
};

describe("buildBuyUrlBody", () => {
  it("setzt Custom Payment Plan mit Euro-Preis und Abo (installments=0)", () => {
    const b = buildBuyUrlBody(monthly);
    expect(b.get("product_id")).toBe("123456");
    expect(b.get("valid_until")).toBe("24h");
    expect(b.get("payment_plan[first_amount]")).toBe("9.00");
    expect(b.get("payment_plan[other_amounts]")).toBe("9.00");
    expect(b.get("payment_plan[currency]")).toBe("EUR");
    expect(b.get("payment_plan[number_of_installments]")).toBe("0");
    expect(b.get("payment_plan[first_billing_interval]")).toBe("1_month");
  });

  it("behandelt Einmalzahlung als installments=1 ohne Intervall", () => {
    const b = buildBuyUrlBody({ key: "einmal", productId: "9", priceCents: 4700 });
    expect(b.get("payment_plan[number_of_installments]")).toBe("1");
    expect(b.get("payment_plan[first_billing_interval]")).toBeNull();
    expect(b.get("payment_plan[first_amount]")).toBe("47.00");
  });

  it("carries over placeholders and the thank-you URL", () => {
    const b = buildBuyUrlBody(monthly, {}, "https://app.example/optin/[ORDER_ID]");
    expect(b.get("placeholders[TITLE]")).toBe("Paid Challenge - Gold");
    expect(b.get("placeholders[DESCRIPTION]")).toBe("Gold plan (monthly)");
    expect(b.get("urls[thankyou_url]")).toBe(
      "https://app.example/optin/[ORDER_ID]",
    );
  });

  it("setzt Upgrade-Parameter und blendet Double-Buy-Hinweis aus", () => {
    const b = buildBuyUrlBody(monthly, {
      upgradeOrderId: "ORD-9",
      upgradeType: "downgrade",
    });
    expect(b.get("payment_plan[upgrade_order_id]")).toBe("ORD-9");
    expect(b.get("payment_plan[upgrade_type]")).toBe("downgrade");
    expect(b.get("settings[hide_double_buy_info]")).toBe("Y");
  });

  it("prefills buyer fields and protects the email address", () => {
    const b = buildBuyUrlBody(monthly, {
      buyer: { email: "k@test.de", firstName: "Erika" },
    });
    expect(b.get("buyer[email]")).toBe("k@test.de");
    expect(b.get("buyer[readonly_keys]")).toBe("email");
    expect(b.get("buyer[first_name]")).toBe("Erika");
  });

  it("nutzt trackingkey ohne Affiliate, campaignkey mit Affiliate", () => {
    const ohneAff = buildBuyUrlBody(monthly, { campaignKey: "sommer" });
    expect(ohneAff.get("tracking[trackingkey]")).toBe("sommer");
    const mitAff = buildBuyUrlBody(monthly, {
      affiliate: "partner1",
      campaignKey: "sommer",
    });
    expect(mitAff.get("tracking[affiliate]")).toBe("partner1");
    expect(mitAff.get("tracking[campaignkey]")).toBe("sommer");
  });
});

describe("offerHash", () => {
  it("is stable for the same offering", () => {
    expect(offerHash(monthly)).toBe(offerHash({ ...monthly }));
  });
  it("changes when the price changes (→ new URL)", () => {
    expect(offerHash(monthly)).not.toBe(
      offerHash({ ...monthly, priceCents: 1900 }),
    );
  });
  it("changes with the thank-you URL", () => {
    expect(offerHash(monthly, "https://a/[ORDER_ID]")).not.toBe(
      offerHash(monthly, "https://b/[ORDER_ID]"),
    );
  });

  it("changes with the custom marker", () => {
    // customTracking is cacheable (it does not make a URL user-specific) and
    // ends up inside the generated URL. Were it missing from the hash, two
    // token packages sharing an offerKey would serve each other's cached URL
    // and credit the wrong balance.
    expect(offerHash(monthly, undefined, "tokens:pro")).not.toBe(
      offerHash(monthly, undefined, "tokens:business"),
    );
    expect(offerHash(monthly, undefined, "tokens:pro")).toBe(
      offerHash(monthly, undefined, "tokens:pro"),
    );
  });
});

describe("isUnknownAffiliateError", () => {
  it("recognizes the affiliate we sent in the message", () => {
    const err = new Error("The user 'partner1' is not known at digistore24.com");
    expect(isUnknownAffiliateError(err, "partner1")).toBe(true);
  });

  it("leaves unrelated failures alone", () => {
    // The point of the narrow check: a network or key problem must NOT be
    // retried away without the affiliate and reported as the second error.
    expect(isUnknownAffiliateError(new Error("fetch failed"), "partner1")).toBe(
      false,
    );
    expect(
      isUnknownAffiliateError(
        new Error("Digistore24 API HTTP 401 (createBuyUrl)"),
        "partner1",
      ),
    ).toBe(false);
  });

  it("is false without an affiliate", () => {
    expect(isUnknownAffiliateError(new Error("anything"), "")).toBe(false);
  });
});

describe("isUserSpecific", () => {
  it("is true for a checkout carrying a buyer identity", () => {
    const ref = buildIdentity({
      memberId: "9f3c1b7e-5d21-4a88-b0c4-2e6f7a1d9c30",
      checkoutToken: "a7Kd2Pq9Zx",
      productKey: "pro",
    });
    expect(isUserSpecific({ customTracking: ref })).toBe(true);
  });

  it("is false for a token marker — those URLs stay shared", () => {
    // The whole point of testing customTracking by content: token packages
    // set it on every offering. A presence check here would uncache every
    // token card and turn each page render into a live Digistore24 call.
    expect(isUserSpecific({ customTracking: tokenCustomMarker("pro") })).toBe(
      false,
    );
  });

  it("is false for an empty context", () => {
    expect(isUserSpecific({})).toBe(false);
  });

  it("still recognises the other user-specific fields", () => {
    expect(isUserSpecific({ buyer: { email: "a@b.de" } })).toBe(true);
    expect(isUserSpecific({ affiliate: "partner" })).toBe(true);
    expect(isUserSpecific({ campaignKey: "spring" })).toBe(true);
    expect(isUserSpecific({ trackingKey: "abc" })).toBe(true);
    expect(isUserSpecific({ upgradeOrderId: "4711" })).toBe(true);
  });
});

// ===========================================================================
// The stored payment plan — which of the two ways this checkout is priced
// ===========================================================================

const stored: Offer = { ...monthly, payplanId: "991", optionKey: "yearly" };

describe("selling through the product's stored plan", () => {
  it("selects the plan and hides the others instead of sending amounts", () => {
    const b = buildBuyUrlBody(stored);
    expect(b.get("settings[plan]")).toBe("991");
    expect(b.get("settings[hide_plans]")).toBe("Y");
    // No amounts: the stored plan prices the sale. Sending a copy of it would
    // put the price in a second place, which is the whole thing this avoids.
    expect(b.get("payment_plan[first_amount]")).toBeNull();
    expect(b.get("payment_plan[other_amounts]")).toBeNull();
    expect(b.get("payment_plan[number_of_installments]")).toBeNull();
  });

  it("sends the plan as a template TOO — that is what makes a stale id loud", () => {
    // createBuyUrl.php:427-430 refuses a template that is not this product's.
    // Without it, a stale settings[plan] would be ignored in silence and the
    // buyer would meet the product's default plan at whatever price that is.
    expect(buildBuyUrlBody(stored).get("payment_plan[template]")).toBe("991");
  });

  it("prices an UPGRADE inline — a stored plan cannot express one", () => {
    const b = buildBuyUrlBody(stored, { upgradeOrderId: "ABC12345" });
    expect(b.get("payment_plan[first_amount]")).toBe("9.00");
    expect(b.get("payment_plan[upgrade_order_id]")).toBe("ABC12345");
    expect(b.get("settings[plan]")).toBeNull();
    expect(b.get("payment_plan[template]")).toBeNull();
  });

  it("prices inline when there is no stored plan at all", () => {
    expect(buildBuyUrlBody(monthly).get("payment_plan[first_amount]")).toBe("9.00");
    expect(buildBuyUrlBody(monthly).get("settings[plan]")).toBeNull();
  });

  it("still forces rebilling for a token package — that lives in settings", () => {
    const b = buildBuyUrlBody({ ...stored, forceRebilling: true });
    expect(b.get("settings[force_rebilling]")).toBe("Y");
  });

  it("sellsThroughStoredPlan says which branch was taken", () => {
    expect(sellsThroughStoredPlan(stored)).toBe(true);
    expect(sellsThroughStoredPlan(monthly)).toBe(false);
    expect(sellsThroughStoredPlan(stored, { upgradeOrderId: "X" })).toBe(false);
  });
});

describe("isStalePaymentPlanError", () => {
  it("🚨 matches the message Digistore24 REALLY sends — in any language", () => {
    // Captured from a live account: the API source raises this as
    // `payment_plan_not_found`, but that is an internal key and the wire
    // carries the account's language. Matching the marker matched nothing,
    // and the retry that keeps a page alive never fired.
    const real =
      'Digistore24 API HTTP 404 (createBuyUrl): {"result":"error","message":' +
      '"Ung\u00fctlige Bezahlplan-ID: 999999999 - Bezahlplan nicht vorhanden ' +
      'oder nicht f\u00fcr das gew\u00e4hlte Produkt.","code":4}';
    expect(isStalePaymentPlanError(new Error(real), "999999999")).toBe(true);
  });

  it("still accepts the literal marker, wherever it surfaces", () => {
    expect(isStalePaymentPlanError(new Error("payment_plan_not_found"), "991")).toBe(true);
  });

  it("does not swallow an unrelated failure", () => {
    // Retrying on any error would report the second attempt's failure and
    // hide a bad API key or an unknown product.
    expect(isStalePaymentPlanError(new Error("invalid api key"), "991")).toBe(false);
    expect(isStalePaymentPlanError(new Error("product_not_found"), "991")).toBe(false);
  });

  it("answers false when no plan was sent — there is nothing to blame", () => {
    expect(isStalePaymentPlanError(new Error("991 is broken"), undefined)).toBe(false);
  });
});

describe("offerHash", () => {
  it("gives two ways to pay two different cache rows", () => {
    // A shared hash would let the monthly and the yearly link serve each
    // other out of buy_url_cache — the same failure the language axis is
    // already guarded against.
    const a = offerHash({ ...monthly, payplanId: "991", optionKey: "monthly" });
    const b = offerHash({ ...monthly, payplanId: "992", optionKey: "yearly" });
    expect(a).not.toBe(b);
  });

  it("is unchanged for an offering that has no stored plan", () => {
    // Every registry written before payment plans existed keeps its cached
    // URLs rather than regenerating all of them on the first deploy.
    expect(offerHash(monthly)).toBe(offerHash({ ...monthly, payplanId: undefined }));
  });
});
