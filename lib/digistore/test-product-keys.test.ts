// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The lookup the other tests lean on — and the reason it is a file rather than
// four copies of a `find()`.
//
// What is asserted here is the honesty of the SKIP: a registry with no token
// package must produce a refusal that names the file, names what it wanted and
// names what is actually in there, and it must reach a plain `npx vitest run` —
// which is the one thing the shipped mechanisms could not do (see the header of
// `test-product-keys.ts`).
//
// The registry is mocked because the shipped one holds every shape, which is
// exactly the state in which none of the branches below are reachable.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** One object, mutated per test — `allProducts()` reads it fresh on every call. */
const REGISTRY: { products: Record<string, unknown> } = { products: {} };
vi.mock("@/config/digistore-products.json", () => ({ default: REGISTRY }));

const { keysOrSkip, planShapedKey, tokenKey } = await import("./test-product-keys");

const SUBSCRIPTION = { name: "Basic", kind: "subscription", priceCents: 1900 };
const ONE_OFF = { name: "Kompakt", kind: "one_time", priceCents: 4900 };
const TOKENS = { name: "Starter", kind: "token", credits: 1000, priceCents: 900 };

function set(products: Record<string, unknown>) {
  REGISTRY.products = products;
}

/** A stand-in for vitest's own context — `skip()` throws, as the real one does. */
function fakeCtx(file = "lib/digistore/some.test.ts", name = "a test") {
  const skipped: string[] = [];
  return {
    skipped,
    ctx: {
      task: { name, file: { name: file } },
      skip(note?: string) {
        skipped.push(note ?? "");
        throw new Error("SKIPPED");
      },
    },
  };
}

beforeEach(() => {
  set({ basis: SUBSCRIPTION, starter: TOKENS });
});

describe("what the tests ask the registry for", () => {
  it("takes the first key of each shape, in the file's own order", () => {
    set({ basis: SUBSCRIPTION, jaehrlich: SUBSCRIPTION, starter: TOKENS, pro: TOKENS });
    expect(planShapedKey().key).toBe("basis");
    expect(tokenKey().key).toBe("starter");
  });

  it("counts a one-off purchase as a plan-shaped key", () => {
    // The field-test app: one product, bought once, no subscription anywhere.
    // `hasPlan()` answers for it, which is the whole condition — and
    // `planProblem()` applies exactly the same one.
    set({ maengelruege_kompakt: ONE_OFF });
    expect(planShapedKey().key).toBe("maengelruege_kompakt");
  });

  it("never offers a token package as a plan-shaped key", () => {
    // The needle: without this the "refuses a token package" tests elsewhere
    // could be handed a token key as their plan key and pass by agreeing with
    // themselves.
    set({ starter: TOKENS, pro: TOKENS });
    expect(planShapedKey().key).toBeNull();
    expect(tokenKey().key).toBe("starter");
  });
});

describe("🚨 a shape this app does not sell is a REASON, never a blank", () => {
  it("names the file, what it wanted and what is really in there", () => {
    set({ maengelruege_kompakt: ONE_OFF });
    const { key, reason } = tokenKey();

    expect(key).toBeNull();
    expect(reason).toContain("config/digistore-products.json");
    expect(reason).toContain("token package");
    // What IS there — so the reader can tell "the operator removed it" from
    // "the lookup is broken" without opening anything.
    expect(reason).toContain('"maengelruege_kompakt" (one_time)');
  });

  it("says so differently when the registry is empty", () => {
    set({});
    expect(planShapedKey().reason).toContain("no products at all");
    expect(tokenKey().reason).toContain("no products at all");
  });

  it("fills exactly one of the two fields, whichever way it went", () => {
    set({ basis: SUBSCRIPTION });
    expect(planShapedKey()).toEqual({ key: "basis", reason: "" });
    expect(tokenKey().key).toBeNull();
    expect(tokenKey().reason).not.toBe("");
  });
});

describe("keysOrSkip", () => {
  // The one line this file prints for real is the one the LAST test asserts on.
  // Without the spy the others would print their fake reasons on every run of
  // the shipped suite — where nothing is skipped at all — and a reader would
  // have to work out that the file named in them does not exist.
  let wrote: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    wrote = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });
  afterEach(() => {
    wrote.mockRestore();
  });

  it("hands the keys over when they are all there", () => {
    const { ctx, skipped } = fakeCtx();
    expect(keysOrSkip(ctx, planShapedKey(), tokenKey())).toEqual(["basis", "starter"]);
    expect(skipped).toEqual([]);
  });

  it("skips with the reason as the note, and never returns", () => {
    set({ maengelruege_kompakt: ONE_OFF });
    const { ctx, skipped } = fakeCtx();

    expect(() => keysOrSkip(ctx, tokenKey())).toThrow("SKIPPED");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain("token package");
  });

  it("joins the reasons when several shapes are missing", () => {
    set({});
    const { ctx, skipped } = fakeCtx();

    expect(() => keysOrSkip(ctx, planShapedKey(), tokenKey())).toThrow("SKIPPED");
    expect(skipped[0]).toContain("plan-shaped product");
    expect(skipped[0]).toContain("token package");
  });

  it("says on stderr WHICH shape was missing — the mechanism is lib/test-not-checked.ts", () => {
    // That file owns the two channels and asserts them for itself; what
    // matters here is that the sentence reaching them names the shape and the
    // registry, so the operator can tell "I deleted that product" from "the
    // suite is broken" without opening anything.
    set({ maengelruege_kompakt: ONE_OFF });
    const first = fakeCtx("lib/digistore/one.test.ts", "first");
    const second = fakeCtx("lib/digistore/one.test.ts", "second");
    expect(() => keysOrSkip(first.ctx, tokenKey())).toThrow("SKIPPED");
    expect(() => keysOrSkip(second.ctx, tokenKey())).toThrow("SKIPPED");

    const lines = wrote.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("lib/digistore/one.test.ts");
    expect(lines[0]).toContain("NOT CHECKED");
    expect(lines[0]).toContain("token package");

    // …but the SECOND test is still skipped rather than passed. The line is
    // deduplicated; the verdict is not.
    expect(second.skipped).toHaveLength(1);
  });
});
