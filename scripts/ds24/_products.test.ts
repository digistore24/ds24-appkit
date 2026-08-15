// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  contradictingProducts,
  productIdsOf,
  languagesOf,
  productTargets,
  setProductId,
  adoptLegacyAsProd,
  syncedProductIds,
  isSold,
  sellFieldProblems,
  parkedTargets,
} from "./_products.mjs";
import {
  contradictingProducts as appContradictingProducts,
  BILLING_MODES,
  type BillingMode,
} from "@/lib/billing-mode";
import {
  productIdsOf as appProductIdsOf,
  sellFieldProblems as appSellFieldProblems,
  allProducts,
  type ProductDef,
} from "@/lib/digistore/products";
import registry from "@/config/digistore-products.json";

// The twin of lib/billing-mode.ts, for the scripts — they are plain `.mjs` and
// do not import the app's TypeScript, so the rule exists twice. This file is
// what keeps the two from drifting apart, the same job
// `_public-url.test.ts` does for the redirect pair.

function config(mode: string | undefined, kinds: Record<string, string>) {
  return {
    billingMode: mode,
    products: Object.fromEntries(
      Object.entries(kinds).map(([key, kind]) => [key, { kind }]),
    ),
  };
}

const MIXED = { abo: "subscription", paket: "token", einmal: "one_time" };

describe("contradictingProducts (script side)", () => {
  it("names the token packages in a subscriptions-only app", () => {
    expect(contradictingProducts(config("subscriptions", MIXED))).toEqual([
      "paket",
    ]);
  });

  it("names the plans in a tokens-only app — one_time counts as a plan", () => {
    // Same dividing line grantableProducts() draws: a one-off purchase is an
    // entitlement, not a balance.
    expect(contradictingProducts(config("tokens", MIXED))).toEqual([
      "abo",
      "einmal",
    ]);
  });

  it("contradicts nothing in a 'both' app", () => {
    expect(contradictingProducts(config("both", MIXED))).toEqual([]);
  });

  it("lets an unknown or missing mode through", () => {
    // The app falls back to "both" on a value it cannot read; a typo must not
    // block a sync — it is caught by lib/billing-mode.test.ts, not here.
    expect(contradictingProducts(config(undefined, MIXED))).toEqual([]);
    expect(contradictingProducts(config("Subscriptions", MIXED))).toEqual([]);
    expect(contradictingProducts(config("abo", MIXED))).toEqual([]);
  });

  it("has nothing to say about an empty registry", () => {
    expect(contradictingProducts(config("tokens", {}))).toEqual([]);
  });
});

describe("script and app agree", () => {
  // The assertion that matters: whatever the shipped registry holds, the
  // refusal in `ds24-sync` and the one in the build have to answer the same.
  it("gives the same answer for the shipped registry", () => {
    expect(contradictingProducts(registry)).toEqual(appContradictingProducts());
  });

  it("gives the same answer for every mode against the shipped products", () => {
    for (const mode of BILLING_MODES) {
      const shifted = { ...registry, billingMode: mode as BillingMode };
      // The app reads its mode from the imported JSON and cannot be told a
      // different one, so the app side is reproduced from the same rule it
      // documents: a token is contradicted by "subscriptions", anything else
      // by "tokens".
      const expected = Object.entries(registry.products)
        .filter(([, p]) =>
          (p as { kind: string }).kind === "token"
            ? mode === "subscriptions"
            : mode === "tokens",
        )
        .map(([key]) => key);
      expect(contradictingProducts(shifted), mode).toEqual(expected);
    }
  });
});

// One Digistore24 product per offering AND language — a DS24 product carries
// exactly one language, and that language is the buyer's order form. And one
// product SET per environment: the scripts have to see the same split the app
// does (lib/digistore/products.ts), or `ds24-sync` creates products the
// checkout never reaches.
describe("productIdsOf (script side)", () => {
  const bilingual = {
    productIds: { dev: { de: "111", en: "222" }, prod: { de: "311", en: "322" } },
  };

  it("reads exactly the asked environment's map", () => {
    expect(productIdsOf(bilingual, "dev")).toEqual({ de: "111", en: "222" });
    expect(productIdsOf(bilingual, "prod")).toEqual({ de: "311", en: "322" });
    expect(productIdsOf(bilingual, "staging")).toEqual({});
    expect(languagesOf(bilingual)).toEqual(["de", "en"]);
  });

  it("keeps languages that are declared but not created yet", () => {
    // The sync's whole job is to fill exactly those in, so unlike the app side
    // they must survive the read. `null`, not absent.
    expect(
      productIdsOf({ productIds: { dev: { de: null, en: null } } }, "dev"),
    ).toEqual({ de: null, en: null });
    expect(languagesOf({ productIds: { dev: { de: null } } })).toEqual(["de"]);
  });

  it("declaring a language in ANY environment declares it for all of them", () => {
    // The union is what lets a first `--env staging` know what to create.
    const def = { productIds: { dev: { de: "1" }, prod: { en: null } } };
    expect(languagesOf(def).sort()).toEqual(["de", "en"]);
  });

  it("reads the pre-split shared map as PROD, and only as prod", () => {
    const legacy = { productIdByLanguage: { de: "111", en: "222" } };
    expect(productIdsOf(legacy, "prod")).toEqual({ de: "111", en: "222" });
    expect(productIdsOf(legacy, "dev")).toEqual({});
    expect(languagesOf(legacy)).toEqual(["de", "en"]);
  });

  it("reads the pre-0.6.0 single-product shape as PROD", () => {
    expect(productIdsOf({ productId: "999", language: "en" }, "prod")).toEqual({
      en: "999",
    });
    expect(productIdsOf({ productId: "999" }, "prod")).toEqual({ de: "999" });
    expect(productIdsOf({ productId: "999" }, "dev")).toEqual({});
  });

  it("lets the env map win over the legacy fields mid-migration", () => {
    const mixed = {
      productId: "alt",
      language: "de",
      productIdByLanguage: { de: "shared", en: "222" },
      productIds: { prod: { de: "neu" } },
    };
    expect(productIdsOf(mixed, "prod")).toEqual({ de: "neu", en: "222" });
  });

  it("answers the same as the app for the same registry entry, per environment", () => {
    // The twin rule: two implementations of one decision, pinned against each
    // other rather than trusted. Only the live ids are comparable — the app
    // drops the nulls on purpose, the scripts keep them.
    for (const entry of [
      bilingual,
      { productIdByLanguage: { de: "111", en: "222" } },
      { productId: "999", language: "en" },
      { productId: "alt", language: "de", productIdByLanguage: { de: "neu", en: "222" } },
      {
        productIdByLanguage: { de: "shared" },
        productIds: { dev: { de: "d1" }, prod: { de: "p1", en: null } },
      },
    ]) {
      for (const env of ["dev", "staging", "prod"] as const) {
        const live = Object.fromEntries(
          Object.entries(productIdsOf(entry, env)).filter(([, id]) => id),
        );
        expect(live, env).toEqual(appProductIdsOf(entry as ProductDef, env));
      }
    }
  });
});

describe("productTargets — one row per Digistore24 product", () => {
  it("splits a bilingual offering into two rows, with the asked env's ids", () => {
    const targets = productTargets(
      { pro: { productIds: { dev: { de: "111", en: "222" }, prod: { de: "311" } } } },
      "dev",
    );
    expect(targets.map((t) => [t.label, t.language, t.productId])).toEqual([
      ["pro (de)", "de", "111"],
      ["pro (en)", "en", "222"],
    ]);
  });

  it("leaves a single-language offering labelled by its bare key", () => {
    // So a German-only app's terminal output is exactly what it always was.
    const targets = productTargets(
      { pro: { productIds: { dev: { de: "111" } } } },
      "dev",
    );
    expect(targets.map((t) => t.label)).toEqual(["pro"]);
  });

  it("still yields a row for an offering nothing has been created for", () => {
    // Otherwise the very first sync would have nothing to do.
    const targets = productTargets({ pro: {} }, "dev");
    expect(targets).toHaveLength(1);
    expect(targets[0].productId).toBeNull();
    expect(targets[0].language).toBe("de");
  });

  it("yields rows with no id for an env that has no set yet", () => {
    // A first `--env staging` on a dev-synced registry: the languages are
    // known (union), the ids are not — every row is a create.
    const targets = productTargets(
      { pro: { productIds: { dev: { de: "111", en: "222" } } } },
      "staging",
    );
    expect(targets.map((t) => [t.language, t.productId])).toEqual([
      ["de", null],
      ["en", null],
    ]);
  });
});

describe("setProductId", () => {
  it("writes into the asked environment's map and touches no other", () => {
    const config = {
      products: {
        pro: { productIds: { dev: { de: null, en: null }, prod: { de: "311" } } },
      },
    };
    setProductId(config, "pro", "en", 222, "dev");
    expect(config.products.pro.productIds).toEqual({
      dev: { de: null, en: "222" },
      prod: { de: "311" },
    });
  });

  it("creates the env map when it does not exist yet", () => {
    const config = { products: { pro: {} as Record<string, unknown> } };
    setProductId(config, "pro", "de", 111, "staging");
    expect(config.products.pro.productIds).toEqual({ staging: { de: "111" } });
  });

  it("leaves legacy fields alone — retiring them is adoptLegacyAsProd's job", () => {
    const config = {
      products: { pro: { productId: "999", language: "de" } as Record<string, unknown> },
    };
    setProductId(config, "pro", "en", 222, "dev");
    expect(config.products.pro.productId).toBe("999");
    expect(config.products.pro.productIds).toEqual({ dev: { en: "222" } });
  });
});

describe("adoptLegacyAsProd — the one-time migration a prod sync runs", () => {
  it("folds the shared map and the pre-0.6.0 pair into productIds.prod", () => {
    const config = {
      products: {
        abo: { productIdByLanguage: { de: "111", en: null } },
        alt: { productId: "999", language: "en" },
      },
    };
    expect(adoptLegacyAsProd(config)).toBe(true);
    expect(config.products.abo).toEqual({ productIds: { prod: { de: "111", en: null } } });
    expect(config.products.alt).toEqual({ productIds: { prod: { en: "999" } } });
  });

  it("is fill-only: an id already in the prod map wins over the legacy one", () => {
    const config = {
      products: {
        pro: {
          productIdByLanguage: { de: "shared" },
          productIds: { prod: { de: "412" } },
        },
      },
    };
    adoptLegacyAsProd(config);
    expect(config.products.pro.productIds.prod).toEqual({ de: "412" });
    expect(config.products.pro.productIdByLanguage).toBeUndefined();
  });

  it("keeps the other environments' sets untouched", () => {
    const config = {
      products: {
        pro: {
          productIdByLanguage: { de: "111" },
          productIds: { dev: { de: "d1" } },
        },
      },
    };
    adoptLegacyAsProd(config);
    expect(config.products.pro.productIds).toEqual({
      dev: { de: "d1" },
      prod: { de: "111" },
    });
  });

  it("reports false when there is nothing to adopt — the idempotent second run", () => {
    const config = { products: { pro: { productIds: { prod: { de: "111" } } } } };
    expect(adoptLegacyAsProd(config)).toBe(false);
    expect(config.products.pro.productIds).toEqual({ prod: { de: "111" } });
  });
});

describe("syncedProductIds — what the env's IPN connection is scoped to", () => {
  const config = {
    products: {
      abo: { productIds: { dev: { de: "111", en: null }, prod: { de: "311" } } },
      alt: { productIdByLanguage: { de: "222" } },
    },
  };

  it("names the live ids of exactly the asked environment", () => {
    expect(syncedProductIds(config, "dev")).toEqual(["111"]);
    // Legacy = prod: the pre-split products belong to the live connection.
    expect(syncedProductIds(config, "prod").sort()).toEqual(["222", "311"]);
    expect(syncedProductIds(config, "staging")).toEqual([]);
  });

  it("never names a declared-but-unsynced product", () => {
    // A `null` cannot travel in `product_ids` — the fallback to "all" is the
    // caller's decision (ipn-setup.mjs), not this function's.
    expect(syncedProductIds({ products: { pro: { productIds: { dev: { de: null } } } } }, "dev")).toEqual([]);
  });

  // 🚨 The counterpart of the seam in lib/digistore/sell-seam.test.ts, on the
  // script side. A parked plan's id has to stay in the IPN scope: its buyers
  // are still paying, and their rebills, refunds and chargebacks arrive as
  // IPNs naming that id. An id missing here is an event the app never hears —
  // access that should have ended does not end.
  it("keeps a PARKED product's id — taking it off sale is not ending it", () => {
    const parked = {
      products: {
        retired: { sell: false, productIds: { prod: { de: "911", en: "912" } } },
        live: { productIds: { prod: { de: "100" } } },
      },
    };
    expect(syncedProductIds(parked, "prod").sort()).toEqual(["100", "911", "912"]);
  });
});

describe("isSold — the twin of lib/digistore/products.ts", () => {
  it("treats an absent sell field as sold", () => {
    // Load-bearing: every registry written before this field existed.
    expect(isSold({})).toBe(true);
    expect(isSold({ sell: undefined })).toBe(true);
  });

  it("parks only on a literal false", () => {
    expect(isSold({ sell: true })).toBe(true);
    expect(isSold({ sell: false })).toBe(false);
  });

  it("survives an entry that is not an object", () => {
    expect(isSold(undefined)).toBe(true);
  });
});

describe("sellFieldProblems (script side)", () => {
  it("names the string 'false' — the typo that would create the product", () => {
    const problems = sellFieldProblems({ products: { pro: { sell: "false" } } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"pro"');
    expect(problems[0]).toContain('"false"');
  });

  it.each([0, 1, "true", null])("refuses %o", (sell) => {
    expect(sellFieldProblems({ products: { x: { sell } } })).toHaveLength(1);
  });

  it("stays silent for true, false and absent", () => {
    expect(
      sellFieldProblems({
        products: { a: { sell: true }, b: { sell: false }, c: {} },
      }),
    ).toEqual([]);
  });

  it("agrees with the app side on the shipped registry", () => {
    expect(sellFieldProblems(registry)).toEqual(appSellFieldProblems(allProducts()));
    expect(sellFieldProblems(registry)).toEqual([]);
  });
});

describe("productTargets skips a parked offering", () => {
  const products = {
    live: { productIds: { dev: { de: "1", en: "2" } } },
    retired: { sell: false, productIds: { dev: { de: "9", en: "8" } } },
  };

  it("builds no row for it — so nothing is created and nothing is approved", () => {
    // One filter, two commands: sync-products and request-approval both build
    // their work list here.
    expect(productTargets(products, "dev").map((t) => t.key)).toEqual([
      "live",
      "live",
    ]);
  });

  it("still keeps every row of a sold offering — the counter-proof", () => {
    const { retired: _dropped, ...soldOnly } = products;
    expect(productTargets(soldOnly, "dev")).toHaveLength(2);
  });
});

describe("parkedTargets — what the sync warns about", () => {
  it("names a parked offering that already exists at Digistore24", () => {
    const rows = parkedTargets(
      { retired: { sell: false, productIds: { prod: { de: "911", en: "912" } } } },
      "prod",
    );
    expect(rows.map((r) => [r.key, r.language, r.productId])).toEqual([
      ["retired", "de", "911"],
      ["retired", "en", "912"],
    ]);
  });

  it("says nothing about a parked offering that was never created", () => {
    // There is nothing over there to deactivate, so there is nothing to warn
    // about — a warning here would be noise on every fresh app.
    expect(
      parkedTargets({ retired: { sell: false, productIds: { prod: { de: null } } } }, "prod"),
    ).toEqual([]);
  });

  it("says nothing about a sold offering", () => {
    expect(parkedTargets({ live: { productIds: { prod: { de: "1" } } } }, "prod")).toEqual([]);
  });

  it("is scoped to the asked environment", () => {
    const products = { retired: { sell: false, productIds: { dev: { de: "7" }, prod: { de: "911" } } } };
    expect(parkedTargets(products, "dev").map((r) => r.productId)).toEqual(["7"]);
    expect(parkedTargets(products, "prod").map((r) => r.productId)).toEqual(["911"]);
  });
});

describe("contradictingProducts ignores a parked product", () => {
  it("lets a parked token package past a subscriptions-only app", () => {
    // The freedom this field buys: switching to "subscriptions" used to mean
    // DELETING the token packages to get past the refusal.
    expect(
      contradictingProducts({
        billingMode: "subscriptions",
        products: { paket: { kind: "token", sell: false } },
      }),
    ).toEqual([]);
  });

  it("still refuses the same package when it is SOLD — the counter-proof", () => {
    // Without this line the test above would also pass if `billingMode` had
    // stopped checking anything at all.
    expect(
      contradictingProducts({
        billingMode: "subscriptions",
        products: { paket: { kind: "token" } },
      }),
    ).toEqual(["paket"]);
  });

  it("keeps app and script in step on a parked entry", () => {
    // The twin rule, asked about the one shape the shipped registry cannot
    // show: both sides must skip it, or `make check` and `ds24-sync` disagree.
    const shifted = {
      ...registry,
      billingMode: "subscriptions",
      products: {
        ...Object.fromEntries(
          Object.entries(registry.products).map(([k, p]) => [k, { ...p, sell: false }]),
        ),
      },
    };
    expect(contradictingProducts(shifted)).toEqual([]);
  });
});
