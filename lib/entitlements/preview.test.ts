// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The DEV preview grants — the rule that lets the owner use what she sells.
//
// There is no test database in this repo (see the header of
// `lib/entitlements/manage.ts`), so what stands in for one here is the tagged
// template itself: `ensureOperatorPreviewGrants` talks to postgres.js through
// nothing but `` sql`…` ``, so a fake tag records every statement and answers
// with the rows a real database would. That is enough to measure the thing that
// can actually break — WHICH products get a row and which do not.

import { describe, it, expect } from "vitest";

import {
  DEV_PREVIEW_NOTE,
  ensureOperatorPreviewGrants,
  readRegistry,
  sellableKeysFrom,
} from "./preview.mjs";

const OWNER = "owner-1";

/** One recorded statement: the SQL with `?` where a value was bound. */
interface Call {
  text: string;
  values: unknown[];
}

/**
 * A stand-in for a postgres.js handle.
 *
 * `state` is what the SELECT answers — the two booleans the real query computes
 * in SQL. It is a function of the Product Key so a test can give one product a
 * purchase and another nothing.
 */
function fakeSql(state: (productKey: string) => { active: boolean; any: boolean }) {
  const calls: Call[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (text.includes("insert into grants")) return Promise.resolve([]);
    // The SELECT binds (memberId, productKey) in that order — and nothing else:
    // the instant it judges "still running" against is the server's.
    return Promise.resolve([state(String(values[1]))]);
  };
  return { tag, calls };
}

const nothingHeld = () => ({ active: false, any: false });
const inserts = (calls: Call[]) => calls.filter((c) => c.text.includes("insert into grants"));

/** A registry the way `config/digistore-products.json` is shaped. */
const REGISTRY = {
  products: {
    basic: { name: "Basic", sell: true },
    // No `sell` at all — every registry written before the field existed.
    starter: { name: "Starter" },
    // Parked: not on offer, so nothing to preview.
    retired: { name: "Retired", sell: false },
  },
};

describe("sellableKeysFrom", () => {
  it("keeps what is on sale, including an entry with no `sell` field", () => {
    expect(sellableKeysFrom(REGISTRY)).toEqual(["basic", "starter"]);
  });

  it("reads the shipped registry without being handed one", () => {
    expect(sellableKeysFrom(readRegistry()).length).toBeGreaterThan(0);
  });
});

describe("ensureOperatorPreviewGrants", () => {
  it("does NOTHING unless the caller says `dev: true`, and writes nothing at all", async () => {
    // The caller decides — with `appEnv()` in the app, with the run's `--env`
    // plus a LOCAL database in a script. `false`, `undefined` and a truthy
    // non-boolean all close the door: reviewed 2026-09-15, the first cut read
    // APP_ENV itself and would have written comps into a live database from
    // the documented "create the first PROD owner from a laptop" command.
    for (const dev of [false, undefined, "development", 1]) {
      const { tag, calls } = fakeSql(nothingHeld);
      const result = await ensureOperatorPreviewGrants({
        memberId: OWNER,
        dev: dev as never,
        sql: tag,
        registry: REGISTRY,
      });
      expect(result, `dev=${JSON.stringify(dev)}`).toEqual({ skipped: "not-dev" });
      // Not even a SELECT: an environment this does not apply to is not
      // something to go and ask the database about.
      expect(calls).toHaveLength(0);
    }
  });

  it("grants one comp per SELLABLE product — and none for a parked one", async () => {
    const { tag, calls } = fakeSql(nothingHeld);
    const result = await ensureOperatorPreviewGrants({
      memberId: OWNER,
      dev: true,
      sql: tag,
      registry: REGISTRY,
    });

    expect(result).toEqual({ granted: ["basic", "starter"], kept: [] });
    expect(inserts(calls)).toHaveLength(2);
    expect(inserts(calls).map((c) => c.values[2])).toEqual(["basic", "starter"]);
  });

  it("writes the row grantByHand writes: manual, dev-preview, no purchase, no end", async () => {
    const { tag, calls } = fakeSql(nothingHeld);
    await ensureOperatorPreviewGrants({
      memberId: OWNER,
      dev: true,
      sql: tag,
      registry: { products: { basic: {} } },
    });

    const [insert] = inserts(calls);
    // Provenance is spelled out in the statement rather than left to a default.
    expect(insert.text).toContain("'manual'");
    expect(insert.text.replace(/\s+/g, " ")).toContain(
      "(id, member_id, product_key, source, ds24_purchase_id, issued_by, note, access_until)",
    );
    expect(insert.text.replace(/\s+/g, " ")).toContain(
      "'manual', null, ?, ?, null)",
    );
    // id, memberId, productKey, issuedBy, note — the owner issues it to herself.
    expect(insert.values).toEqual([
      expect.any(String),
      OWNER,
      "basic",
      OWNER,
      DEV_PREVIEW_NOTE,
    ]);
  });

  it("is idempotent — a second run over an active grant writes nothing", async () => {
    const { tag, calls } = fakeSql(() => ({ active: true, any: true }));
    const result = await ensureOperatorPreviewGrants({
      memberId: OWNER,
      dev: true,
      sql: tag,
      registry: REGISTRY,
    });

    expect(result).toEqual({ granted: [], kept: ["basic", "starter"] });
    expect(inserts(calls)).toHaveLength(0);
  });

  it("🚨 does NOT hand back a grant the operator ended — hers or a test purchase's", async () => {
    // Not active, but a row exists: a dev-preview she revoked, or a test
    // purchase she refunded or paused to SEE the closed and paused pages. A
    // comp beside it would reopen the very state she is looking at (reviewed
    // 2026-09-15 — the first cut only remembered its own rows).
    const { tag, calls } = fakeSql((key) =>
      key === "basic" ? { active: false, any: true } : { active: false, any: false },
    );
    const result = await ensureOperatorPreviewGrants({
      memberId: OWNER,
      dev: true,
      sql: tag,
      registry: REGISTRY,
    });

    expect(result).toEqual({ granted: ["starter"], kept: ["basic"] });
    expect(inserts(calls).map((c) => c.values[2])).toEqual(["starter"]);
  });

  it("keeps a purchase grant instead of adding a comp beside it", async () => {
    const { tag, calls } = fakeSql((key) =>
      key === "basic" ? { active: true, any: true } : { active: false, any: false },
    );
    const result = await ensureOperatorPreviewGrants({
      memberId: OWNER,
      dev: true,
      sql: tag,
      registry: REGISTRY,
    });

    expect(result).toEqual({ granted: ["starter"], kept: ["basic"] });
    expect(inserts(calls)).toHaveLength(1);
  });

  it("judges 'still running' on the server, with activeFor()'s three conditions", async () => {
    // No date crosses the driver at all: the SELECT binds member and key only,
    // and compares against `now() at time zone 'utc'` — the same instant
    // `withinTerm()` in lib/entitlements/manage.ts uses, so the two renderings
    // of "active" cannot drift by clock source (docs/conventions.md → Dates).
    const { tag, calls } = fakeSql(nothingHeld);
    await ensureOperatorPreviewGrants({
      memberId: OWNER,
      dev: true,
      sql: tag,
      registry: { products: { basic: {} } },
    });

    const [select] = calls;
    expect(select.values).toEqual([OWNER, "basic"]);
    expect(select.text).toContain("now() at time zone 'utc'");
    expect(select.text).toContain("ended_at is null");
    expect(select.text).toContain("suspended_at is null");
    expect(select.text).toContain("access_until is null");
  });

  it("refuses to run without a database handle rather than reporting success", async () => {
    await expect(
      ensureOperatorPreviewGrants({ memberId: OWNER, dev: true, registry: REGISTRY }),
    ).rejects.toThrow(/sql|db/);
  });
});
