// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// WHICH mechanism makes a `timestamp` column mean UTC — and a guard that goes
// red when it stops being that one.
//
// `db/index.ts` used to carry a long, carefully argued `types: { 1114: … }`
// mapper. The argument was right and the mapper was dead: `drizzle(client)`
// overwrites the driver's handlers for every date OID before the first query,
// so the comment described a mechanism that had not been the effective one
// since drizzle started doing that. Nothing anywhere went red — that is the
// fault class (story A67), and a replacement comment that merely ASSERTS the
// new mechanism is the same fault a year later.
//
// So the three sentences that comment now makes are measured here instead:
//
//   1. drizzle's COLUMN mapper does the UTC work, in both directions
//   2. `drizzle()` MUTATES the client it is handed — which is why a `types:`
//      option on that client cannot survive
//   3. `applierSql` is that same mutated object, so the raw handle has no date
//      mapping at all
//
// ⚠️ **Test 1 is worthless under `TZ=UTC`**, because there the wrong answer and
// the right one are the same number — the "shipped default makes the predicate
// vacuous" trap. It therefore pins a non-UTC zone itself, and asserts that the
// NAIVE reading really would have been wrong under it before asserting that the
// real one is right.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "./schema";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

// UTC+12 in July, so a mistake here is twelve hours and lands on another DAY —
// the failure that used to reach a page as a wrong date.
const AWAY_FROM_UTC = "Pacific/Auckland";
const WIRE = "2026-07-22 12:00:00"; // what Postgres puts on the wire for a `timestamp`
const MEANS = "2026-07-22T12:00:00.000Z"; // what this project stores in one

/**
 * A zone-less `timestamp`, with or without a declared precision.
 *
 * 🚨 **The zone hangs on `withTimezone`, never on the precision** — and this
 * pattern used to be the string `"timestamp"` compared with `===`, which is not
 * the same claim. `timestamp (3)` is exactly as zone-less as `timestamp`; what
 * would make a column mean something else is `timestamp with time zone`, and
 * that still fails here because the parenthesis group is all this admits.
 *
 * It cost a customer a permanently red suite to find out. `modules/community`
 * declares seven columns at `precision: 3`, deliberately and with a measured
 * bug behind the decision (`modules/community/schema.ts` → *`precision: 3` —
 * MILLISECONDS, and it is load-bearing*: Postgres stamps microseconds, a JS
 * `Date` carries milliseconds, and the read marker that NAMED a message then
 * compared older than it, so every private conversation stayed unread for
 * ever). Installing that module turned this test red on a schema that is
 * right — the fault class `CLAUDE.md` calls "a bug in the test rather than a
 * finding" (reported 2026-08-12).
 */
const ZONELESS = /^timestamp(?: \(\d+\))?$/;

interface DateColumn {
  name: string;
  getSQLType(): string;
  mapFromDriverValue(v: string): unknown;
}

/**
 * Every column of a schema module whose SQL type STARTS with `timestamp`.
 *
 * ⚠️ `startsWith` rather than an equality: a column flipped to
 * `{ withTimezone: true }` must land IN the set and fail there, never fall
 * quietly out of it and be counted as nothing to see.
 */
function dateColumnsIn(mod: object): DateColumn[] {
  return (Object.values(mod) as unknown[])
    .filter((table) => typeof table === "object" && table !== null)
    .flatMap((table) => Object.values(table as Record<string, unknown>))
    .filter(
      (column): column is DateColumn =>
        typeof (column as { getSQLType?: unknown })?.getSQLType === "function" &&
        (column as { getSQLType(): string }).getSQLType().startsWith("timestamp"),
    );
}

const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = AWAY_FROM_UTC;
});
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("a `timestamp` column means UTC — by drizzle's column mapper", () => {
  it("the process zone really is not UTC here, or the rest proves nothing", () => {
    // The needle probe. `new Date(wire)` is the mistake this whole file is
    // about; under UTC it accidentally gives the right answer and every
    // assertion below would pass over a broken mapper.
    expect(new Date(WIRE).toISOString()).not.toBe(MEANS);
  });

  it("read: mapFromDriverValue adds the zone marker the wire form lacks", () => {
    const value = schema.ipnEvents.receivedAt.mapFromDriverValue(WIRE);
    expect(value).toBeInstanceOf(Date);
    expect((value as Date).toISOString()).toBe(MEANS);
  });

  it("write: mapToDriverValue hands the driver an ISO string, not a Date", () => {
    const bound = schema.ipnEvents.receivedAt.mapToDriverValue(new Date(MEANS));
    expect(typeof bound).toBe("string");
    expect(bound).toBe(MEANS);
  });

  it("EVERY date column in the tree is a zone-less `timestamp` that reads as UTC", () => {
    // Not one column: the claim `scripts/lib/pg-utc.mjs` rests on is about the
    // whole tree — "there is no `timestamptz` column anywhere", which is what
    // makes refusing OID 1184 on a bare client total rather than opinionated.
    // So the sweep is over anything whose SQL type STARTS with `timestamp`; a
    // column flipped to `{ withTimezone: true }` must land IN the set and fail,
    // not quietly fall out of it.
    const columns = dateColumnsIn(schema);

    // 🚨 A count guard, not decoration: an empty list would make the two
    // assertions below green having measured nothing at all.
    expect(columns.length).toBeGreaterThan(20);

    expect(
      columns.filter((c) => !ZONELESS.test(c.getSQLType())).map((c) => `${c.name}: ${c.getSQLType()}`),
    ).toEqual([]);
    expect(
      columns
        .filter((c) => (c.mapFromDriverValue(WIRE) as Date)?.toISOString?.() !== MEANS)
        .map((c) => c.name),
    ).toEqual([]);
  });
});

describe("…and every module's date columns too, installed or not", () => {
  // 🚨 The sweep above reads `db/schema.ts`, which re-exports the GENERATED
  // `db/schema-modules.ts` — and `config/modules.json` ships `{ "installed":
  // [] }`. So in this tree the barrel is the core's tables and nothing else,
  // and "EVERY date column in the tree" was a claim about the core wearing the
  // word every. A module's schema was measured only in a customer's app, which
  // is the one place where finding out is expensive.
  //
  // Read off the DIRECTORY rather than off the installed list, deliberately: a
  // module's schema is written here, long before any app installs it, and this
  // is where a `timestamptz` in one would be cheap to fix. Reading it by path
  // also keeps `modules/boundary.test.ts` satisfied — no core file names a
  // module, because nothing here is named.
  const MODULE_SCHEMAS = readdirSync(join(ROOT, "modules"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => existsSync(join(ROOT, "modules", id, "schema.ts")))
    .sort();

  it("found module schemas to sweep at all", () => {
    // The count guard the core sweep has, for the half that has no barrel.
    expect(MODULE_SCHEMAS.length, "no modules/<id>/schema.ts was found").toBeGreaterThan(2);
  });

  it.each(MODULE_SCHEMAS)("%s", async (id) => {
    const mod = await import(pathToFileURL(join(ROOT, "modules", id, "schema.ts")).href);
    const columns = dateColumnsIn(mod);

    // Per module, because a module with no date column at all would otherwise
    // pass by having nothing — and every one of them has some.
    expect(columns.length, `modules/${id}/schema.ts declares no date column`).toBeGreaterThan(0);

    expect(
      columns.filter((c) => !ZONELESS.test(c.getSQLType())).map((c) => `${c.name}: ${c.getSQLType()}`),
      `a zoned column in modules/${id}/schema.ts breaks the claim scripts/lib/pg-utc.mjs ` +
        `rests on — that refusing OID 1184 on a bare client is total rather than opinionated`,
    ).toEqual([]);
    expect(
      columns
        .filter((c) => (c.mapFromDriverValue(WIRE) as Date)?.toISOString?.() !== MEANS)
        .map((c) => c.name),
    ).toEqual([]);
  });
});

describe("drizzle() mutates the client it is given", () => {
  /** A postgres.js stand-in that answers nothing — `drizzle()` only writes into `options`. */
  function fakeClient(mine: (v: unknown) => unknown) {
    return Object.assign(() => {}, {
      unsafe: () =>
        Object.assign(Promise.resolve([]), { values: () => Promise.resolve([]) }),
      options: {
        parsers: { "1114": mine } as Record<string, unknown>,
        serializers: { "1114": mine } as Record<string, unknown>,
      },
    });
  }

  it("replaces the 1114 parser AND serializer — so a `types:` mapper is inert", () => {
    const mine = (v: unknown) => `mine:${String(v)}`;
    const client = fakeClient(mine);
    drizzle(client as never, { schema });

    // If either of these ever comes back as `mine`, drizzle has stopped
    // overwriting — a `types:` option on the app's client would become live
    // again, and the reasoning in `db/index.ts` needs rewriting rather than
    // this line deleting.
    expect(client.options.parsers["1114"]).not.toBe(mine);
    expect(client.options.serializers["1114"]).not.toBe(mine);
    expect((client.options.parsers["1114"] as (v: string) => unknown)(WIRE)).toBe(WIRE);
  });

  it("covers every date OID, not only 1114", () => {
    const mine = (v: unknown) => `mine:${String(v)}`;
    const client = fakeClient(mine);
    for (const oid of ["1184", "1082", "1083", "1182", "1185", "1115", "1231"]) {
      client.options.parsers[oid] = mine;
      client.options.serializers[oid] = mine;
    }
    drizzle(client as never, { schema });

    const survivors = Object.keys(client.options.parsers).filter(
      (oid) => client.options.parsers[oid] === mine,
    );
    expect(survivors).toEqual([]);
  });
});

describe("applierSql is the mutated client, not a copy of it", () => {
  it("the raw handle hands out strings for a date column", async () => {
    const { applierSql, db } = await import("./index");
    const options = (applierSql as unknown as {
      options: { parsers: Record<string, (v: string) => unknown> };
    }).options;

    // Same object: `construct()` writes into the client rather than wrapping it.
    expect((db as unknown as { $client: unknown }).$client).toBe(applierSql);
    // …so the applier route reads the wire form verbatim. `new Date()` on that
    // is the twelve-hour mistake the first test above pins down.
    expect(options.parsers["1114"](WIRE)).toBe(WIRE);
  });
});
