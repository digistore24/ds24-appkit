// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";
import { planSections, SECTION_TEXT, type PlanSectionId } from "./plan-sections";
import { PRODUCT_KINDS, type ProductDef, type ProductKind } from "./products";
import de from "@/messages/de.json";
import en from "@/messages/en.json";

/** A registry entry with only the fields this grouping reads. */
function def(key: string, kind: ProductKind): ProductDef {
  return { key, name: key, kind };
}

const sub = def("basic_monthly", "subscription");
const sub2 = def("basic_yearly", "subscription");
const once = def("course_complete", "one_time");
const tok = def("starter", "token");

const idsOf = (products: ProductDef[]): PlanSectionId[] =>
  planSections(products).map((s) => s.id);

describe("planSections", () => {
  it("gives a one-off purchase a section of its own", () => {
    // The defect this whole story exists for: `/plans` fetched subscriptions
    // and tokens only, so a vendor whose single product is a 149 € course had
    // an empty sales page.
    const sections = planSections([once]);
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe("oneTime");
    expect(sections[0].defs).toEqual([once]);
  });

  it("returns nothing for an empty registry", () => {
    // What the empty state on the page is decided by. It must stay reachable:
    // it is how a vendor mid-setup learns that nothing is sellable yet.
    expect(planSections([])).toEqual([]);
  });

  it("orders the sections subscriptions → one-off → tokens", () => {
    // Both plan kinds first (they are entitlements, see lib/billing-mode.ts),
    // the balance last. Input order must not decide output order.
    expect(idsOf([tok, once, sub])).toEqual(["subscriptions", "oneTime", "tokens"]);
  });

  it("omits a section that has no products, rather than emptying it", () => {
    // The caller renders a heading per returned section, so an empty group
    // would be a heading over nothing.
    expect(idsOf([sub, tok])).toEqual(["subscriptions", "tokens"]);
    expect(idsOf([once])).toEqual(["oneTime"]);
  });

  it("keeps every product of a kind, in registry order", () => {
    const [subscriptions] = planSections([sub, sub2]);
    expect(subscriptions.defs).toEqual([sub, sub2]);
  });

  it("carries the column count each kind is laid out with", () => {
    // Plans are few and wide, token packages are many and narrow — the two
    // values the page used before this function existed.
    const columns = Object.fromEntries(
      planSections([sub, once, tok]).map((s) => [s.id, s.columns]),
    );
    expect(columns).toEqual({ subscriptions: 2, oneTime: 2, tokens: 3 });
  });

  it("is pure — it reads no registry of its own", () => {
    // The reason it takes the list as an argument: the shipped
    // config/digistore-products.json holds no `one_time` product, so a
    // function reading it directly could not be tested against one at all.
    // Same guard as `productByDs24Id` in products.ts.
    // ⚠️ Source as text again, one door over: `Function.prototype.toString()`
    // returns the body WITH its comments, so a line explaining why this function
    // does not read `digistore-products` would make the rule fire on the file
    // that keeps it. Same rule as every `readFileSync` scanner in this tree —
    // the mechanism is different, the failure is not.
    const source = blankComments(planSections.toString());
    expect(source).not.toMatch(/allProducts|productsByKind|digistore-products/);
    // Non-vacuity: `toString()` on a transpiled or minified binding could
    // answer something with no body at all, and three `not.toMatch` over an
    // empty string are three tests about nothing.
    expect(source).toContain("sections");
  });

  it("gives every declared product kind a section — none can vanish", () => {
    // The runtime half of the exhaustiveness guard (the compile-time half is
    // `_layoutCoversEveryKind` in plan-sections.ts). Walks the REAL union, so
    // a fourth kind added to PRODUCT_KINDS fails here the moment it exists —
    // silently disappearing from the page was this file's founding defect.
    for (const kind of PRODUCT_KINDS) {
      const sections = planSections([def("probe", kind)]);
      expect(sections, kind).toHaveLength(1);
      expect(sections[0].defs[0].key).toBe("probe");
    }
  });
});

describe("SECTION_TEXT", () => {
  it("names only keys that exist in BOTH language files", () => {
    // next-intl renders a missing key as the raw key — no throw, nothing in
    // the log — so a symmetric rename in the message files would leave every
    // other gate green while the heading reads "plans.oneTimeTitle". This is
    // the only guard that catches it.
    const plansDe = de.plans as Record<string, unknown>;
    const plansEn = en.plans as Record<string, unknown>;
    for (const { title, body } of Object.values(SECTION_TEXT)) {
      for (const key of [title, body]) {
        expect(plansDe, `de: plans.${key}`).toHaveProperty(key);
        expect(plansEn, `en: plans.${key}`).toHaveProperty(key);
      }
    }
  });
});

describe("the page is bound to this module", () => {
  it("app/plans/page.tsx builds from planSections, not from hand-picked kinds", () => {
    // The original defect lived in the PAGE: hand-enumerating two of three
    // kinds at the call site. The shipped registry holds no one_time product,
    // so smoke and deploy-test render /plans without one and cannot see the
    // page reverting. Reading the source is this repo's convention for
    // exactly this shape of risk (lib/ai/providers/leak-guard.test.ts).
    //
    // Through `blankComments()` (`CLAUDE.md` → *Rules*): both directions are
    // wrong without it. The page's own comment explaining WHY it no longer
    // calls `productsByKind(` would report the page for the very reversion it
    // warns against, and a comment merely mentioning `planSections(` would
    // clear a page that had stopped calling it.
    const source = blankComments(
      readFileSync(new URL("../../app/plans/page.tsx", import.meta.url), "utf8"),
    );
    expect(source).toContain("planSections(");
    expect(source).toContain("SECTION_TEXT");
    expect(source).not.toContain("productsByKind(");
  });
});
