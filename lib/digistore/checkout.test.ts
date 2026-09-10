// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";
import { describe, it, expect, afterEach } from "vitest";
import {
  offerFor,
  customTrackingFor,
  optinThankyouUrl,
  checkoutBlockersFor,
  blockerFor,
  offerRef,
  type CheckoutBlocker,
} from "./checkout";
import { DIGISTORE_REDIR_URL as DEFAULT_REDIR_URL } from "./config.mjs";
import { DEFAULT_OPTION_KEY, type ProductDef } from "./products";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { blankComments } from "@/scripts/lib/source-text.mjs";

const sub: ProductDef = {
  key: "basic_monthly",
  name: "Basic (monthly)",
  description: "Full access.",
  kind: "subscription",
  billingInterval: "1_month",
  priceCents: 1900,
  currency: "EUR",
  productId: "111111",
};

const tokens: ProductDef = {
  key: "pro",
  name: "Pro Tokens",
  kind: "token",
  credits: 5000,
  priceCents: 3900,
  currency: "EUR",
  productId: "222222",
};

describe("offerFor", () => {
  it("carries price, currency and interval from the registry", () => {
    const offer = offerFor(sub);
    expect(offer.productId).toBe("111111");
    expect(offer.priceCents).toBe(1900);
    expect(offer.currency).toBe("EUR");
    expect(offer.billingInterval).toBe("1_month");
    expect(offer.title).toBe("Basic (monthly)");
  });

  it("forces stored payment details on token packages", () => {
    // settings[force_rebilling]=Y. Without it there is no chargeable order,
    // and auto top-up (createBillingOnDemand) cannot work.
    expect(offerFor(tokens).forceRebilling).toBe(true);
    expect(offerFor(sub).forceRebilling).toBe(false);
  });

  it("never gives a token package a billing interval", () => {
    // An interval would make buyUrl.ts derive number_of_installments=0 and turn
    // the one-off purchase into a subscription.
    const stray = { ...tokens, billingInterval: "1_month" };
    expect(offerFor(stray).billingInterval).toBeUndefined();
  });

  it("throws while the product is not synced yet", () => {
    expect(() => offerFor({ ...sub, productId: null })).toThrow(/ds24-sync/);
  });

  // A Digistore24 product carries exactly ONE language, and that language is
  // the language of the order form. So the buyer's locale picks the product —
  // see lib/digistore/products.ts.
  const bilingual: ProductDef = {
    ...sub,
    productId: undefined,
    productIdByLanguage: { de: "111111", en: "111222" },
  };

  it("picks the product whose ORDER FORM is in the buyer's language", () => {
    expect(offerFor(bilingual, "de").productId).toBe("111111");
    expect(offerFor(bilingual, "en").productId).toBe("111222");
  });

  it("gives each language its own cache key", () => {
    // THE regression this guards. `offer.key` is the buy_url_cache primary
    // key, one row per key — so a shared key would let the two languages evict
    // each other on every page view and, in between, serve the German
    // checkout URL to an English buyer straight from the cache. `offerHash`
    // does not save it: it detects the change, it does not give them a row each.
    expect(offerFor(bilingual, "de").key).not.toBe(offerFor(bilingual, "en").key);
    expect(offerFor(bilingual, "en").key).toBe("basic_monthly:en");
  });

  it("keeps a language it has no product for buyable", () => {
    // Fallback, not refusal: a missing translation must not cost the sale.
    // The gap is reported by `node run.mjs ds24-sync`, where it can be fixed.
    // The product it lands on is the DEFAULT_LOCALE's (English, or the first
    // in LOCALES) — read off the fixture, never a code written out here.
    const fallback = bilingual.productIdByLanguage![DEFAULT_LOCALE]!;
    expect(fallback).toBeTruthy();
    expect(offerFor(bilingual, "fr").productId).toBe(fallback);
  });
});

describe("customTrackingFor", () => {
  it("marks token packages so the IPN can book the credit", () => {
    expect(customTrackingFor(tokens)).toBe("tokens:pro");
  });

  it("leaves subscriptions unmarked", () => {
    expect(customTrackingFor(sub)).toBeUndefined();
  });
});

describe("optinThankyouUrl", () => {
  it("keeps the DS24 placeholder literal", () => {
    // [ORDER_ID] is substituted by Digistore24 — we must not encode or fill it.
    expect(optinThankyouUrl("https://app.example")).toBe(
      "https://app.example/optin/[ORDER_ID]",
    );
  });

  it("tolerates a trailing slash", () => {
    expect(optinThankyouUrl("https://app.example/")).toBe(
      "https://app.example/optin/[ORDER_ID]",
    );
  });

  it("returns undefined without APP_URL (DS24 default page applies)", () => {
    expect(optinThankyouUrl(undefined)).toBeUndefined();
    expect(optinThankyouUrl("  ")).toBeUndefined();
  });

  it("sends a local app through the public redirect", () => {
    // DS24 refuses http://localhost outright ("Please only use secure URLs"),
    // and a checkout without a thank-you URL would drop the buyer on the DS24
    // default page instead of /optin — so the local address travels as a
    // redirect address. See lib/digistore/public-url.ts.
    expect(optinThankyouUrl("http://localhost:3000")).toBe(
      `${DEFAULT_REDIR_URL}?port=3000&path=/optin/[ORDER_ID]`,
    );
  });
});

describe("checkoutBlockersFor", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("reports notSynced before anything else", async () => {
    delete process.env.DIGISTORE_API_KEY;
    const blockers = await checkoutBlockersFor([{ ...sub, productId: null }]);
    // Not synced wins over not connected: fixing the connection would not
    // help a product that does not exist at Digistore24 yet.
    expect(blockers.get(sub.key)).toBe("notSynced");
  });

  it("reports notConnected when no API key is configured", async () => {
    delete process.env.DIGISTORE_API_KEY;
    const blockers = await checkoutBlockersFor([
      { ...sub, productId: "123456" },
    ]);
    expect(blockers.get(sub.key)).toBe("notConnected");
  });

  it("returns an empty map for an empty list", async () => {
    expect((await checkoutBlockersFor([])).size).toBe(0);
  });

  it("says null — not undefined — when nothing is blocking", async () => {
    // The value blockerFor() below has to survive. If this ever becomes
    // `undefined`, the two cases stop being distinguishable at all.
    process.env.DIGISTORE_API_KEY = "test-key";
    const blockers = await checkoutBlockersFor([{ ...sub, productId: "123456" }]);
    expect(blockers.has(sub.key)).toBe(true);
    expect(blockers.get(sub.key)).toBeNull();
  });
});

describe("blockerFor", () => {
  it("REGRESSION: a plan with nothing wrong is not an error", () => {
    // `blockers.get(key) ?? "error"` was the whole bug: checkoutBlockersFor
    // stores null for a healthy plan, and `null ?? "error"` is "error". Every
    // signed-in visitor got "the checkout is unavailable" on every single card
    // — while signed-out visitors, who take the other branch, saw a perfect
    // page. That is why it survived: nothing anonymous could reproduce it.
    const blockers = new Map<string, CheckoutBlocker | null>([["pro", null]]);

    expect(blockerFor(blockers, "pro")).toBeNull();
  });

  it("passes a real blocker through", () => {
    const blockers = new Map<string, CheckoutBlocker | null>([
      ["a", "notSynced"],
      ["b", "notConnected"],
    ]);
    expect(blockerFor(blockers, "a")).toBe("notSynced");
    expect(blockerFor(blockers, "b")).toBe("notConnected");
  });

  it("calls a genuinely missing plan an error", () => {
    // Absent is not the same as null: nobody resolved this plan, so the page
    // must not offer a button for it.
    expect(blockerFor(new Map(), "ghost")).toBe("error");
  });
});

describe("testpay wiring", () => {
  // resolveOne() ends in a live createBuyUrl call, so the wiring is pinned on
  // the source (the runtime behaviour — gate, fail-open, decoration — is
  // covered in testpay.test.ts). What these assertions protect: the decorated
  // URL must never enter the shared buy_url_cache, whose rows are served to
  // every visitor — and the layer underneath must SAY so, because an agent
  // building its own checkout on createBuyUrl reads that file and not this one.
  const checkoutSrc = readFileSync(new URL("./checkout.ts", import.meta.url), "utf8");
  const buyUrlSrc = readFileSync(new URL("./buyUrl.ts", import.meta.url), "utf8");

  it("decorates the URL AFTER getOrCreateBuyUrl, on the returned value", () => {
    expect(checkoutSrc).toMatch(/url:\s*await withTestpayParam\(url\)/);
  });

  it("keeps the decoration out of buyUrl.ts — the cache stores clean URLs", () => {
    // Moving withTestpayParam "closer to the URL creation" would write the
    // testpay parameter into buy_url_cache and hand it to every visitor.
    //
    // Tested as the IMPORT and the CALL, not as the word: the file has to be
    // free of the decoration while EXPLAINING it in prose (the assertion
    // below). A blanket /testpay/i match forbids the signpost along with the
    // mistake — which is how the signpost came to be missing in the first
    // place. So the call is looked for in code only, with the comments (and
    // the worked example inside them) stripped out.
    const code = blankComments(buyUrlSrc);
    expect(code).not.toMatch(/withTestpayParam\s*\(/);
    expect(buyUrlSrc).not.toMatch(/from\s+["']\.\/testpay["']/);
  });

  it("signposts the omission where a hand-written checkout would read it", () => {
    // The gap this protects against is real: an app built on this template had
    // an agent create a checkout with createBuyUrl and never fetch a testpay
    // key, leaving the developer with no local test purchase. The funnel in
    // checkout.ts is correct; the layer underneath simply never said that what
    // it returns is undecorated. Both entry points must carry it.
    const createBuyUrlDoc = buyUrlSrc.slice(0, buyUrlSrc.indexOf("export async function createBuyUrl"));
    const getOrCreateDoc = buyUrlSrc.slice(
      buyUrlSrc.indexOf("export function isUserSpecific"),
      buyUrlSrc.indexOf("export async function getOrCreateBuyUrl"),
    );
    for (const section of [createBuyUrlDoc, getOrCreateDoc]) {
      expect(section).toMatch(/withTestpayParam/);
    }
    // ...and it must name the environment rule, not just the function: the
    // parameter takes free "payments", so appending it outside DEV is fraud.
    expect(buyUrlSrc).toMatch(/isTestpayActive/);
  });
});

// ===========================================================================
// Two ways to pay for ONE offering
// ===========================================================================

const silber: ProductDef = {
  key: "silber",
  name: "Silber",
  kind: "subscription",
  currency: "EUR",
  paymentOptions: {
    monthly: { priceCents: 1900, billingInterval: "1_month" },
    yearly: { priceCents: 19000, billingInterval: "12_month" },
  },
  productIds: { prod: { de: "111111" } },
  payplanIds: {
    prod: {
      de: {
        monthly: { id: "991", priceCents: 1900, currency: "EUR", billingInterval: "1_month" },
        yearly: { id: "992", priceCents: 19000, currency: "EUR", billingInterval: "12_month" },
      },
    },
  },
};

describe("offerRef — how a way to pay is named to the outside", () => {
  it("leaves a single-option offering its bare Product Key", () => {
    // Every existing caller, every cached buy-URL row and every `?needs=`
    // link keeps working: `starter`, never `starter:default`.
    expect(offerRef("starter", DEFAULT_OPTION_KEY)).toBe("starter");
  });

  it("suffixes only where there is genuinely something to tell apart", () => {
    expect(offerRef("silber", "yearly")).toBe("silber:yearly");
  });
});

describe("offerFor with payment options", () => {
  it("prices the option, not the offering", () => {
    expect(offerFor(silber, "de", "prod", "yearly").priceCents).toBe(19000);
    expect(offerFor(silber, "de", "prod", "monthly").priceCents).toBe(1900);
  });

  it("carries the stored plan so the checkout can sell through it", () => {
    expect(offerFor(silber, "de", "prod", "yearly").payplanId).toBe("992");
  });

  it("gives the two ways to pay two different cache keys", () => {
    // One row per key in buy_url_cache — a shared key would let the monthly
    // and the yearly URL evict each other on every page view.
    expect(offerFor(silber, "de", "prod", "monthly").key).toBe("silber:monthly:de");
    expect(offerFor(silber, "de", "prod", "yearly").key).toBe("silber:yearly:de");
  });

  it("takes the FIRST declared way to pay when the caller names none", () => {
    expect(offerFor(silber, "de", "prod").optionKey).toBe("monthly");
  });

  it("leaves a legacy entry's cache key exactly as it was", () => {
    // The old registry shape must not regenerate every cached URL on deploy.
    expect(offerFor(sub).key).toBe("basic_monthly:de");
  });

  it("says which of the two is missing rather than blaming the sync", () => {
    expect(() => offerFor(silber, "de", "prod", "weekly")).toThrow(
      /payment option "weekly"/,
    );
    expect(() => offerFor({ ...silber, productIds: {} }, "de", "prod")).toThrow(
      /ds24-sync/,
    );
  });
});

describe("checkoutBlockersFor with payment options", () => {
  it("answers per way to pay, with the offering's answer", async () => {
    // Whether a product exists and whether there is an API key are questions
    // about the OFFERING — never about one of its prices. Both ways to pay
    // must still HAVE an entry, because blockerFor() treats a missing key as
    // "error" and would put "checkout unavailable" on a working card.
    const b = await checkoutBlockersFor([silber]);
    expect(b.has("silber:monthly")).toBe(true);
    expect(b.has("silber:yearly")).toBe(true);
    expect(blockerFor(b, "silber:yearly")).toBe(blockerFor(b, "silber:monthly"));
  });
});
