// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";

import {
  hash32,
  variantFor,
  funnelFrom,
  readSplit,
  MIN_EXPOSED_PER_VARIANT,
  MIN_CONVERSIONS_PER_VARIANT,
  type Experiment,
} from "./rules.mjs";

const AB: Experiment = {
  id: "welcome-copy",
  variants: [
    { id: "a", weight: 1 },
    { id: "b", weight: 1 },
  ],
};

describe("hash32", () => {
  it("gives the same answer for the same input, every time", () => {
    expect(hash32("member-1")).toBe(hash32("member-1"));
  });

  it("separates inputs that differ by one character", () => {
    expect(hash32("member-1")).not.toBe(hash32("member-2"));
  });

  it("stays a 32-bit unsigned integer for a long input", () => {
    // The shift-based FNV prime is the reason this holds — a plain multiply
    // would leave the safe integer range and start rounding.
    const h = hash32("x".repeat(5000));
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});

describe("variantFor", () => {
  it("puts the same member on the same side every time", () => {
    // The whole contract: an experiment that reassigns people measures the
    // reassignment.
    const first = variantFor("member-1", AB);
    for (let i = 0; i < 50; i++) expect(variantFor("member-1", AB)).toBe(first);
  });

  it("splits a population roughly by weight", () => {
    const ids = Array.from({ length: 10_000 }, (_, i) => `member-${i}`);
    const a = ids.filter((id) => variantFor(id, AB) === "a").length;
    // Deterministic input, so this is a fixed number rather than a flaky one.
    expect(a).toBeGreaterThan(4_700);
    expect(a).toBeLessThan(5_300);
  });

  it("honours uneven weights", () => {
    const ninety: Experiment = {
      id: "rollout",
      variants: [
        { id: "old", weight: 9 },
        { id: "new", weight: 1 },
      ],
    };
    const ids = Array.from({ length: 10_000 }, (_, i) => `member-${i}`);
    const isNew = ids.filter((id) => variantFor(id, ninety) === "new").length;
    expect(isNew).toBeGreaterThan(800);
    expect(isNew).toBeLessThan(1_200);
  });

  it("does not split the same population down the same line twice", () => {
    // If the experiment id were left out of the hash, everybody in "a" of the
    // first test would be in "a" of the second, and the second would be
    // measuring the first.
    const other: Experiment = { ...AB, id: "pricing-headline" };
    const ids = Array.from({ length: 2_000 }, (_, i) => `member-${i}`);
    const same = ids.filter((id) => variantFor(id, AB) === variantFor(id, other)).length;
    expect(same).toBeGreaterThan(800);
    expect(same).toBeLessThan(1_200);
  });

  it("returns null rather than a default side when nobody can be assigned", () => {
    expect(variantFor("m", { id: "x", variants: [] })).toBeNull();
    expect(variantFor("m", { id: "x", variants: [{ id: "a", weight: 0 }] })).toBeNull();
    expect(
      variantFor("m", { id: "x", variants: [{ id: "a", weight: Number.NaN }] }),
    ).toBeNull();
  });

  it("ignores a zero-weight variant instead of assigning to it", () => {
    const one: Experiment = {
      id: "x",
      variants: [
        { id: "live", weight: 1 },
        { id: "parked", weight: 0 },
      ],
    };
    const ids = Array.from({ length: 500 }, (_, i) => `m${i}`);
    expect(ids.every((id) => variantFor(id, one) === "live")).toBe(true);
  });
});

describe("funnelFrom", () => {
  it("is empty for no steps", () => {
    expect(funnelFrom([])).toEqual([]);
  });

  it("measures every share against the FIRST step", () => {
    const rows = funnelFrom([
      { id: "signed-up", members: 100 },
      { id: "activated", members: 40 },
      { id: "returned", members: 25 },
    ]);
    expect(rows.map((r) => r.share)).toEqual([1, 0.4, 0.25]);
    expect(rows.map((r) => r.lost)).toEqual([0, 60, 15]);
  });

  it("does not divide by zero on an app nobody has used yet", () => {
    // The state most operators meet first. A NaN here would render as a blank
    // cell and read as a fault in the app rather than as an empty funnel.
    const rows = funnelFrom([
      { id: "signed-up", members: 0 },
      { id: "activated", members: 0 },
    ]);
    expect(rows.every((r) => r.share === 0)).toBe(true);
    expect(rows.every((r) => r.lost === 0)).toBe(true);
  });

  it("floors the loss at zero when a later step is larger", () => {
    // Steps are independent predicates, not a path: somebody can top up a
    // balance without ever buying a plan. A negative loss would be nonsense on
    // screen; a share above 1 is the honest signal that the order is wrong.
    const rows = funnelFrom([
      { id: "bought-plan", members: 10 },
      { id: "topped-up", members: 25 },
    ]);
    expect(rows[1].lost).toBe(0);
    expect(rows[1].share).toBe(2.5);
  });
});

describe("readSplit", () => {
  const big = { exposed: 1_000, reached: 200 };

  it("refuses to read an experiment below the exposure floor", () => {
    const a = { id: "a", exposed: MIN_EXPOSED_PER_VARIANT - 1, reached: 50 };
    const b = { id: "b", exposed: 1_000, reached: 100 };
    const r = readSplit(a, b);
    expect(r.verdict).toBe("not-enough-data");
    expect(r.z).toBeNull();
    expect(r.leader).toBeNull();
  });

  it("refuses below the conversion floor even with plenty of traffic", () => {
    // 100_000 people and nine conversions is not a small effect, it is no data.
    const a = { id: "a", exposed: 100_000, reached: MIN_CONVERSIONS_PER_VARIANT - 1 };
    const b = { id: "b", exposed: 100_000, reached: 500 };
    expect(readSplit(a, b).verdict).toBe("not-enough-data");
  });

  it("names no winner when the two rates are the same", () => {
    const r = readSplit({ id: "a", ...big }, { id: "b", ...big });
    expect(r.verdict).toBe("no-difference");
    expect(r.z).toBe(0);
    expect(r.leader).toBeNull();
  });

  it("names no winner for a difference the sample cannot carry", () => {
    // 20% against 22% at a thousand each — a real-looking gap, and not one.
    const r = readSplit(
      { id: "a", exposed: 1_000, reached: 200 },
      { id: "b", exposed: 1_000, reached: 220 },
    );
    expect(r.verdict).toBe("no-difference");
  });

  it("names the leader when the difference clears 95%", () => {
    const r = readSplit(
      { id: "a", exposed: 1_000, reached: 200 },
      { id: "b", exposed: 1_000, reached: 300 },
    );
    expect(r.verdict).toBe("difference");
    expect(r.leader).toBe("b");
    expect(Math.abs(r.z ?? 0)).toBeGreaterThan(1.96);
  });

  it("names the leader from whichever side is higher, not from the order", () => {
    const r = readSplit(
      { id: "a", exposed: 1_000, reached: 300 },
      { id: "b", exposed: 1_000, reached: 200 },
    );
    expect(r.leader).toBe("a");
  });

  it("does not divide by zero when every exposed member converted", () => {
    // Pooled p = 1 makes the standard error zero. Reading a z of ±Infinity as
    // "significant" would declare a winner out of an arithmetic edge.
    const r = readSplit(
      { id: "a", exposed: 1_000, reached: 1_000 },
      { id: "b", exposed: 1_000, reached: 1_000 },
    );
    expect(r.verdict).toBe("not-enough-data");
    expect(r.z).toBeNull();
  });
});
