// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Which list each surface reaches for — asserted on the SOURCE, because the
// mistake this guards against does not change any behaviour a test can see
// today.
//
// `sellableProducts()` is opt-in: a new reader that types `allProducts()`
// gets the full list and is right most of the time, which is exactly why the
// two surfaces where it is WRONG need pinning rather than reviewing. Both are
// invisible on the shipped registry, where nothing is parked and the two
// lists are identical (`sell-seam.test.ts` proves that is the reason).
//
// 🚨 Everything here goes through `blankComments()` — the convention in
// `template/CLAUDE.md` for any checker that reads source as text, and here it
// is load-bearing rather than ceremonial: the prose in both files EXPLAINS
// why it does not call `allProducts()`, and names it while doing so. A plain
// grep would read the explanation as the defect. Measured: without the
// blanking, the first assertion below fails on a correct file.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { blankComments } from "../../scripts/lib/source-text.mjs";

function code(relative: string): string {
  return blankComments(
    readFileSync(new URL(relative, import.meta.url), "utf8"),
  );
}

describe("the plans page offers only what is on sale", () => {
  const source = code("../../app/plans/page.tsx");

  it("builds its sections from sellableProducts()", () => {
    expect(source).toContain("sellableProducts()");
  });

  it("never reaches for the full list", () => {
    // The page is the OFFER. `allProducts()` here would put a withdrawn plan
    // back on the sales page with a working buy button.
    expect(source).not.toContain("allProducts(");
  });
});

describe("the checkout action refuses a parked offering", () => {
  const source = code("../../app/plans/actions.ts");

  it("throws on NOT sold — the polarity is the guard", () => {
    // A server action is an HTTP endpoint: the button is gone, the route is
    // not. Without this, a kept form field still buys a withdrawn product.
    //
    // `toContain("isSold(def)")` alone would also hold for an inverted
    // `if (isSold(def)) throw` — which refuses every LEGITIMATE checkout
    // while the catch swallows the throw and the page stays 200. So the
    // negation and the throw are pinned, not the call.
    const refused = source.indexOf("if (!isSold(def))");
    expect(refused).toBeGreaterThan(-1);
    const thrown = source.indexOf("throw", refused);
    expect(thrown).toBeGreaterThan(refused);
    expect(thrown - refused).toBeLessThan(120);
  });

  it("does so between getProduct and the checkout link", () => {
    // Order matters and cannot be read off the import list: refusing AFTER
    // the link was built would already have asked Digistore24 for a URL.
    const resolved = source.indexOf("getProduct(productKey)");
    const refused = source.indexOf("isSold(def)");
    const built = source.indexOf("checkoutLinkFor(");
    expect(resolved).toBeGreaterThan(-1);
    expect(built).toBeGreaterThan(-1);
    expect(refused).toBeGreaterThan(resolved);
    expect(refused).toBeLessThan(built);
  });
});

// The counter-proof for both blocks above, and the half that keeps this file
// from becoming "filter everywhere": the paths that answer for an EXISTING
// payment relationship must not have picked the refusal up.
describe("counter-proof — the money path did not inherit the refusal", () => {
  it("the automatic top-up does not ask whether the package is on sale", () => {
    // A mandate armed while the package was on offer keeps charging. Adding
    // isSold here would silently stop topping up a member who asked for it.
    expect(code("../tokens/account.ts")).not.toContain("isSold");
  });

  it("the IPN's payment handler does not ask either", () => {
    // Rebills, refunds and chargebacks arrive for withdrawn products too.
    expect(code("./payment-event.ts")).not.toContain("isSold");
  });

  it("the entitlement API does not ask", () => {
    // hasPlan() answers about access, and parking is about selling.
    expect(code("../entitlements/manage.ts")).not.toContain("isSold");
  });
});
