// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";
import {
  buildIdentity,
  parseCustom,
  identifiesMember,
  isCheckoutToken,
  newCheckoutToken,
  purchaseOriginFor,
} from "./custom";
import { tokenCustomMarker, listTokenPackages } from "@/lib/tokens/packages";

const MEMBER = "9f3c1b7e-5d21-4a88-b0c4-2e6f7a1d9c30";
const TOKEN = "a7Kd2Pq9Zx";

describe("buildIdentity", () => {
  it("builds and parses the identity string (round-trip)", () => {
    const value = buildIdentity({
      memberId: MEMBER,
      checkoutToken: TOKEN,
      productKey: "pro",
      armAutoReload: false,
    });
    // The literal wire format is pinned: it is stored on the purchase at
    // Digistore24 and comes back on every later event for years.
    expect(value).toBe(`m:${MEMBER};t:${TOKEN};p:pro`);
    expect(parseCustom(value)).toEqual({
      kind: "identity",
      memberId: MEMBER,
      checkoutToken: TOKEN,
      productKey: "pro",
      armAutoReload: false,
    });
  });

  it("is extensible — an unknown pair is ignored, not fatal", () => {
    // A future id can be added without a format migration; older code that
    // does not know the key must still read the ones it does.
    const parsed = parseCustom(`m:${MEMBER};t:${TOKEN};p:pro;x:whatever`);
    expect(parsed).toEqual({
      kind: "identity",
      memberId: MEMBER,
      checkoutToken: TOKEN,
      productKey: "pro",
      armAutoReload: false,
    });
  });

  it("tolerates pairs in any order", () => {
    expect(parseCustom(`p:pro;t:${TOKEN};m:${MEMBER}`)).toEqual({
      kind: "identity",
      memberId: MEMBER,
      checkoutToken: TOKEN,
      productKey: "pro",
      armAutoReload: false,
    });
  });
});

describe("parseCustom", () => {
  it("refuses a member id without a token", () => {
    // Load-bearing: an id on its own must never resolve. Both halves have to
    // agree or the purchase falls through to the unauthenticated email path.
    expect(parseCustom(`m:${MEMBER}`)).toBeNull();
    expect(parseCustom(`m:${MEMBER};p:pro`)).toBeNull();
  });

  it("refuses a token without a member id", () => {
    expect(parseCustom(`t:${TOKEN};p:pro`)).toBeNull();
  });

  it("refuses a malformed member id", () => {
    expect(parseCustom(`m:not-a-uuid;t:${TOKEN}`)).toBeNull();
    expect(parseCustom(`m:${MEMBER}extra;t:${TOKEN}`)).toBeNull();
  });

  it("refuses a malformed token", () => {
    expect(parseCustom(`m:${MEMBER};t:short`)).toBeNull();
    expect(parseCustom(`m:${MEMBER};t:${TOKEN}xx`)).toBeNull();
    expect(parseCustom(`m:${MEMBER};t:has-a-dash`)).toBeNull();
  });

  it("still parses the legacy token marker", () => {
    // Never emitted again, but purchases made before this shipped keep
    // arriving with it for as long as their checkout URL lives.
    for (const pkg of listTokenPackages()) {
      const marker = tokenCustomMarker(pkg.key);
      expect(marker).toBe(`tokens:${pkg.key}`);
      expect(parseCustom(marker)).toEqual({
        kind: "legacyToken",
        productKey: pkg.key,
      });
    }
  });

  it("trims surrounding whitespace", () => {
    expect(parseCustom(`  m:${MEMBER};t:${TOKEN}  `)).toEqual({
      kind: "identity",
      memberId: MEMBER,
      checkoutToken: TOKEN,
      productKey: undefined,
      armAutoReload: false,
    });
  });

  it("returns null for anything that is not ours", () => {
    expect(parseCustom(undefined)).toBeNull();
    expect(parseCustom("")).toBeNull();
    expect(parseCustom("   ")).toBeNull();
    expect(parseCustom("host:123")).toBeNull();
    expect(parseCustom("tokens:")).toBeNull();
    expect(parseCustom("m:;t:")).toBeNull();
    expect(parseCustom("nonsense")).toBeNull();
  });
});

describe("identifiesMember", () => {
  it("is true for an identity string", () => {
    expect(identifiesMember(`m:${MEMBER};t:${TOKEN};p:pro`)).toBe(true);
  });

  it("is false for a token marker — those URLs stay shared", () => {
    // If this were true, every token card would trigger a live Digistore24
    // call on every page render.
    for (const pkg of listTokenPackages()) {
      expect(identifiesMember(tokenCustomMarker(pkg.key))).toBe(false);
    }
  });

  it("is false for absent, foreign or half-formed values", () => {
    expect(identifiesMember(undefined)).toBe(false);
    expect(identifiesMember("")).toBe(false);
    expect(identifiesMember("host:123")).toBe(false);
    expect(identifiesMember(`m:${MEMBER}`)).toBe(false);
  });
});

describe("newCheckoutToken", () => {
  it("produces 10 alphanumerics that pass their own validator", () => {
    for (let i = 0; i < 50; i++) {
      const t = newCheckoutToken();
      expect(t).toHaveLength(10);
      expect(isCheckoutToken(t)).toBe(true);
    }
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 200 }, () => newCheckoutToken()));
    expect(seen.size).toBe(200);
  });

  it("round-trips through the grammar", () => {
    const t = newCheckoutToken();
    expect(parseCustom(buildIdentity({ memberId: MEMBER, checkoutToken: t }))).toEqual(
      {
        kind: "identity",
        memberId: MEMBER,
        checkoutToken: t,
        productKey: undefined,
        origin: undefined,
        armAutoReload: false,
      },
    );
  });
});

describe("purchaseOriginFor", () => {
  it("records a one-off purchase as a plan, not as a top-up", () => {
    // The defect: a 149 € course was attributed as `topup`, which is a false
    // statement in the string Digistore24 hands back on every later event.
    expect(purchaseOriginFor("one_time")).toBe("sub");
  });

  it("records a subscription as a plan", () => {
    expect(purchaseOriginFor("subscription")).toBe("sub");
  });

  it("records a token package as a top-up", () => {
    // The token package is the special case — everything else is a plan.
    expect(purchaseOriginFor("token")).toBe("topup");
  });

  it("never produces a fourth origin", () => {
    // A one-off plan deliberately shares `sub` rather than getting a value of
    // its own: `parseCustom` reads strings stored on live purchases, and the
    // only behavioural reader of this field is the auto top-up lock.
    const kinds = ["subscription", "token", "one_time"] as const;
    const produced = new Set(kinds.map(purchaseOriginFor));
    expect([...produced].sort()).toEqual(["sub", "topup"]);
  });

  it("round-trips through the identity string", () => {
    const v = buildIdentity({
      memberId: MEMBER,
      checkoutToken: TOKEN,
      productKey: "course_complete",
      kind: purchaseOriginFor("one_time"),
    });
    expect(v).toContain("k:sub");
    expect(parseCustom(v)).toMatchObject({ kind: "identity", origin: "sub" });
  });
});

describe("kind", () => {
  it("carries the kind as a k: pair and reads it back", () => {
    const v = buildIdentity({ memberId: MEMBER, checkoutToken: TOKEN, productKey: "pro", kind: "auto" });
    expect(v).toBe(`m:${MEMBER};t:${TOKEN};p:pro;k:auto`);
    const parsed = parseCustom(v);
    expect(parsed).toMatchObject({ kind: "identity", origin: "auto" });
  });

  it("accepts sub, topup and auto", () => {
    for (const k of ["sub", "topup", "auto"] as const) {
      const v = buildIdentity({ memberId: MEMBER, checkoutToken: TOKEN, kind: k });
      expect(parseCustom(v)).toMatchObject({ origin: k });
    }
  });

  it("tolerates an absent kind — origin is undefined, not fatal", () => {
    const parsed = parseCustom(`m:${MEMBER};t:${TOKEN}`);
    expect(parsed?.kind).toBe("identity");
    expect(parsed?.kind === "identity" && parsed.origin).toBeUndefined();
  });

  it("ignores an unknown kind rather than rejecting the whole value", () => {
    // AD-5: a newer writer must not break an older reader. An origin we do not
    // recognise is dropped; the member is still identified.
    const parsed = parseCustom(`m:${MEMBER};t:${TOKEN};k:whatever`);
    expect(parsed?.kind).toBe("identity");
    expect(parsed?.kind === "identity" && parsed.origin).toBeUndefined();
  });
});

describe("the auto top-up flag (r:)", () => {
  const M = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const T = "Ab3xY9zQ1w";

  it("round-trips when the buyer asked for it", () => {
    const s = buildIdentity({
      memberId: M,
      checkoutToken: T,
      productKey: "pro",
      kind: "topup",
      armAutoReload: true,
    });
    expect(s).toContain("r:1");
    const parsed = parseCustom(s);
    expect(parsed).toMatchObject({ kind: "identity", armAutoReload: true });
  });

  it("is not emitted when they did not", () => {
    const s = buildIdentity({ memberId: M, checkoutToken: T, kind: "topup" });
    expect(s).not.toContain("r:");
    expect(parseCustom(s)).toMatchObject({ armAutoReload: false });
  });

  it("reads absent as NOT armed", () => {
    // Every purchase made before this shipped. Arming those retroactively
    // would start charging cards nobody offered a choice about.
    expect(parseCustom(`m:${M};t:${T};p:pro`)).toMatchObject({
      armAutoReload: false,
    });
  });

  it("accepts strictly '1' and nothing else", () => {
    // This flag authorises an unattended card charge, so anything ambiguous
    // resolves to off.
    // " 1" is the one the first version of this test missed: the parser trims
    // every value, so a padded flag arrived as "1" and armed a card charge.
    for (const raw of ["0", "true", "yes", "Y", "01", " 1x", " 1", "1 ", "\t1"]) {
      // A pair AFTER it, deliberately: the whole custom value is trimmed
      // before parsing, so a trailing space on the last pair is
      // indistinguishable from none. Padding only matters mid-string, and
      // that is exactly where the parser's own per-value trim used to let
      // `r: 1` through as armed.
      expect(
        parseCustom(`m:${M};t:${T};r:${raw};p:pro`),
        JSON.stringify(raw),
      ).toMatchObject({ armAutoReload: false });
    }
  });

  it("does not disturb the rest of the grammar", () => {
    const parsed = parseCustom(`m:${M};t:${T};p:pro;k:auto;r:1`);
    expect(parsed).toMatchObject({
      kind: "identity",
      memberId: M,
      checkoutToken: T,
      productKey: "pro",
      origin: "auto",
      armAutoReload: true,
    });
  });
});

describe("custom.ts stays a leaf module", () => {
  it("touches ./products with a type-only import, and nothing else at runtime", () => {
    // The identity grammar must not depend on registry JSON I/O — products.ts
    // reads config/digistore-products.json at load and now THROWS on an
    // unknown kind, and none of that may ride into every module that parses
    // a tracking[custom] string. `import type` is erased at compile time; one
    // future edit dropping the `type` breaks the property silently, which is
    // why this reads the source (the leak-guard convention).
    const source = readFileSync(new URL("./custom.ts", import.meta.url), "utf8");
    const productImports = (source.match(/^import .*"\.\/products";?$/gm) ?? []);
    expect(productImports).toHaveLength(1);
    expect(productImports[0]).toMatch(/^import type /);
  });
});
