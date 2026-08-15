// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The matching rules of `ds24-sync`, tested for the first time.
//
// They used to be a closure inside `sync-products.mjs` — top-level code with
// no exports — so the four fallbacks below had no test at all, although they
// decide whether a prod sync UPDATES a product that carries real sales and
// approvals or creates a duplicate beside it, and whether a dev sync can
// rename a live product into "[DEV]".
import { describe, expect, it } from "vitest";

import { classifyTargets, findExisting } from "./_match.mjs";

/** What `listProducts` hands back, reduced to the fields matching reads. */
function ds24(name_intern: string, product_id: string, name = "Some plan") {
  return { name_intern, product_id, name };
}

function target(key: string, language: string, def: Record<string, unknown> = {}) {
  return { key, def: { name: "Basic (monthly)", ...def }, language, productId: null };
}

describe("findExisting — the env-scoped internal name", () => {
  it("matches key__language__env in every environment", () => {
    const list = [ds24("basic__de__dev", "111")];
    expect(findExisting(target("basic", "de"), new Set(), list, "dev")?.product_id).toBe("111");
  });

  it("does not match another language of the same offering", () => {
    const list = [ds24("basic__de__dev", "111")];
    expect(findExisting(target("basic", "en"), new Set(), list, "dev")).toBeNull();
  });

  it("does not match another environment's product", () => {
    // The guarantee that a dev sync cannot claim — and rename — a live one.
    const list = [ds24("basic__de__prod", "111")];
    expect(findExisting(target("basic", "de"), new Set(), list, "dev")).toBeNull();
  });
});

describe("findExisting — the legacy fallbacks are PROD only", () => {
  const preEnv = [ds24("basic__de", "222")];
  const preSixOh = [ds24("basic", "333")];
  const byHand = [ds24("something-else", "444", "Basic (monthly)")];

  it("adopts a pre-0.14.0 product (key__language) in prod", () => {
    expect(findExisting(target("basic", "de"), new Set(), preEnv, "prod")?.product_id).toBe("222");
  });

  it("adopts a pre-0.6.0 product (bare key) in prod", () => {
    expect(findExisting(target("basic", "de"), new Set(), preSixOh, "prod")?.product_id).toBe("333");
  });

  it("adopts a hand-created product by its display name in prod", () => {
    expect(findExisting(target("basic", "de"), new Set(), byHand, "prod")?.product_id).toBe("444");
  });

  it.each([
    ["pre-0.14.0", preEnv],
    ["pre-0.6.0", preSixOh],
    ["hand-created", byHand],
  ])("refuses to adopt a %s product in dev", (_label, list) => {
    // A dev row that finds nothing under its own internal name gets CREATED.
    // Adopting here would rename a product carrying real sales into "[DEV]".
    expect(findExisting(target("basic", "de"), new Set(), list, "dev")).toBeNull();
  });

  it("lets only the legacy language claim a pre-0.6.0 product", () => {
    // Such a product exists in exactly one language — the one the old
    // registry named. Anchored on `def.language`, not on JSON key order.
    const def = { language: "en" };
    expect(findExisting(target("basic", "en", def), new Set(), preSixOh, "prod")?.product_id).toBe("333");
    expect(findExisting(target("basic", "de", def), new Set(), preSixOh, "prod")).toBeNull();
  });

  it("falls back to German when the legacy entry names no language", () => {
    expect(findExisting(target("basic", "de"), new Set(), preSixOh, "prod")?.product_id).toBe("333");
    expect(findExisting(target("basic", "en"), new Set(), preSixOh, "prod")).toBeNull();
  });
});

describe("findExisting — claimed stops one product answering twice", () => {
  it("skips a product an earlier row already took", () => {
    const list = [ds24("something-else", "444", "Basic (monthly)")];
    expect(findExisting(target("basic", "de"), new Set(["444"]), list, "prod")).toBeNull();
  });

  // ⚠️ Measured while writing this file, and it corrects the explanation the
  // function used to carry: `claimed` is NOT what keeps the two languages of
  // one offering apart. The `language !== legacyLanguage` guard returns null
  // before the display-name fallback is ever reached, so the English row of
  // an offering answers `null` with an EMPTY claimed set too — checked
  // directly. What `claimed` actually decides is the case below.
  it("is the guard for two OFFERINGS that share a display name", () => {
    // Both are German rows, both reach the display-name fallback, and both
    // would take id 444. Without `claimed` two registry keys would point at
    // one Digistore24 product, and every purchase of either would be
    // attributed to whichever the reverse lookup found — or to neither, since
    // `productByDs24Id` answers null on an ambiguous id.
    const list = [ds24("something-else", "444", "Basic (monthly)")];
    const rows = classifyTargets(
      [target("basic", "de"), target("basic_alt", "de")],
      list,
      "prod",
    );
    expect(rows.map((r) => [r.key, r.action, r.existingId])).toEqual([
      ["basic", "update", "444"],
      ["basic_alt", "create", null],
    ]);
  });

  it("never gives one Digistore24 id to two rows", () => {
    // The same property said as an invariant rather than as an expected
    // list — three offerings, one product over there, and the assertion is
    // about the SHAPE of the answer rather than about which key wins. A
    // partial break that reordered the winners would still be caught.
    const list = [ds24("something-else", "444", "Basic (monthly)")];
    const rows = classifyTargets(
      [target("a", "de"), target("b", "de"), target("c", "de")],
      list,
      "prod",
    );
    const taken = rows.map((r) => r.existingId).filter(Boolean);
    expect(taken).toHaveLength(1);
    expect(new Set(taken).size).toBe(taken.length);
  });

  it("the English row needs no claimed set at all — the counter-proof", () => {
    // The line that makes the test above a statement about `claimed` rather
    // than about the language guard.
    const list = [ds24("something-else", "444", "Basic (monthly)")];
    expect(findExisting(target("basic", "en"), new Set(), list, "prod")).toBeNull();
  });
});

describe("classifyTargets", () => {
  it("calls a row with a recorded id an update, without asking Digistore24", () => {
    const rows = classifyTargets(
      [{ ...target("basic", "de"), productId: "999" }],
      [],
      "dev",
    );
    expect(rows.map((r) => [r.action, r.existingId])).toEqual([["update", "999"]]);
  });

  it("calls a row that exists over there an update", () => {
    const rows = classifyTargets([target("basic", "de")], [ds24("basic__de__dev", "111")], "dev");
    expect(rows.map((r) => [r.action, r.existingId])).toEqual([["update", "111"]]);
  });

  it("calls a row nothing answers for a create", () => {
    // The one the gate counts. Losing this branch means the gate never fires.
    const rows = classifyTargets([target("basic", "de")], [], "dev");
    expect(rows.map((r) => [r.action, r.existingId])).toEqual([["create", null]]);
  });

  // 🚨 The claim that lets the gate run BEFORE the loop instead of inside it.
  it("is unaffected by ids the run itself would create", () => {
    // `list` is fetched once, before anything is created, so an id minted
    // during the run cannot be in it and no later match could return it. If
    // that were untrue, classifying up front would give a different answer
    // from classifying as you go — and the gate would be promising something
    // the loop does not do.
    const list = [ds24("basic__de__dev", "111")];
    const first = classifyTargets([target("basic", "de"), target("pro", "de")], list, "dev");
    const second = [
      ...classifyTargets([target("basic", "de")], list, "dev"),
      ...classifyTargets([target("pro", "de")], list, "dev"),
    ];
    expect(first.map((r) => [r.key, r.action, r.existingId])).toEqual(
      second.map((r) => [r.key, r.action, r.existingId]),
    );
  });

  it("keeps every row and every field of the target", () => {
    const rows = classifyTargets([target("basic", "de")], [], "dev");
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("basic");
    expect(rows[0].language).toBe("de");
    expect(rows[0].def.name).toBe("Basic (monthly)");
  });
});
