// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The bare-Node side of "a `timestamp` in this app means UTC".
//
// Inside the app drizzle converts at the column (`db/timestamp-utc.test.ts`).
// Every script under `scripts/` and `modules/*/` talks to Postgres through a
// BARE postgres.js client, which has no column to convert at — and whose
// defaults are wrong here in both directions. `scripts/lib/pg-utc.mjs` carries
// the reasoning and the measurement; this file measures that it holds.
//
// Three questions, and the third is the one that keeps the other two from
// being defeated by a new file:
//
//   1. does the 1114 mapping read and write UTC — under a zone that is NOT UTC
//   2. is a bare `Date` (OID 1184) REFUSED, with the fix named in the message
//   3. does every client in this tree go through `connectUtc()` at all
//
// ⚠️ Question 1 is vacuous under `TZ=UTC` and pins a zone itself, with a needle
// probe first. Question 3 is a structural rule and not a type rule — it asks
// where a client is OPENED, which source text can answer exactly. The rule that
// source text CANNOT answer here is "is this interpolated value a Date", and
// that one is answered at bind time by the refusal in question 2 instead; the
// argument against trying it statically is in `db/sql-date-param.test.ts`.
//
// A narrower text rule WAS measured before settling on that: "in a file that
// opens a client, no `${…}` may be a bare identifier whose NAME looks like a
// date". On the tree of 2026-08-12 it found 10 occurrences raw and 0 with
// `blankComments()` — so it would pass today. It is not here anyway, because it
// asks about a name where the refusal asks about the type: it says nothing
// about `${boundary()}` or `${row.someDate}`, and it fires on a string somebody
// happened to call `updatedAt`. A rule that is wrong in both directions and
// right by coincidence is the kind somebody deletes the first time it is wrong.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { blankComments } from "./source-text.mjs";
import {
  TIMESTAMPTZ_REFUSAL,
  UTC_TYPES,
  connectUtc,
  utcTimestampFromWire,
  utcTimestampWire,
} from "./pg-utc.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const AWAY_FROM_UTC = "Pacific/Auckland"; // UTC+12 in July — a mistake lands on another day
const WIRE = "2026-07-22 12:00:00";
const MEANS = "2026-07-22T12:00:00.000Z";

const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = AWAY_FROM_UTC;
});
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("the 1114 mapping", () => {
  it("the process zone really is not UTC here, or the rest proves nothing", () => {
    expect(new Date(WIRE).toISOString()).not.toBe(MEANS);
  });

  it("reads the wire form as UTC and never as local time", () => {
    expect(utcTimestampFromWire(WIRE).toISOString()).toBe(MEANS);
    expect(utcTimestampFromWire("2026-07-22 12:00:00.140123").toISOString()).toBe(
      "2026-07-22T12:00:00.140Z",
    );
  });

  it("writes a UTC wire form with no zone marker on it", () => {
    // No `Z` and no offset: the parameter is typed 1114, and a `timestamp`
    // literal that carried an offset would be read in the SESSION's zone.
    expect(utcTimestampWire(new Date(MEANS))).toBe("2026-07-22 12:00:00.000");
    expect(utcTimestampWire(new Date(MEANS))).not.toMatch(/[Z+]/);
  });

  it("is what a client from connectUtc() actually carries", () => {
    // No connection is made — postgres.js resolves its handlers eagerly and
    // dials lazily, so this asks the real client without a database.
    const sql = connectUtc("postgresql://nobody:nobody@127.0.0.1:1/none");
    const { parsers, serializers } = (
      sql as unknown as {
        options: {
          parsers: Record<string, (v: string) => unknown>;
          serializers: Record<string, (v: unknown) => unknown>;
        };
      }
    ).options;

    expect((parsers["1114"](WIRE) as Date).toISOString()).toBe(MEANS);
    expect(serializers["1114"](new Date(MEANS))).toBe("2026-07-22 12:00:00.000");
    // The named parameter form the boundaries use, and the OID it carries.
    const typed = sql.typed as unknown as Record<string, (v: Date) => unknown>;
    const param = typed.utcTimestamp(new Date(MEANS)) as { value: Date; type: number };
    expect(param.type).toBe(1114);
    expect(param.value).toBeInstanceOf(Date);
  });
});

describe("a bare Date is refused rather than silently mistyped", () => {
  it("throws, and the message names the fix", () => {
    const sql = connectUtc("postgresql://nobody:nobody@127.0.0.1:1/none");
    const serializers = (
      sql as unknown as { options: { serializers: Record<string, (v: unknown) => unknown> } }
    ).options.serializers;

    // 1184 is what `inferType()` gives a `Date`, and there is no `timestamptz`
    // column anywhere in this tree — so this parameter is always a mistake.
    expect(() => serializers["1184"](new Date(MEANS))).toThrow(TypeError);
    expect(() => serializers["1184"](new Date(MEANS))).toThrow(/sql\.typed\.utcTimestamp/);
    expect(TIMESTAMPTZ_REFUSAL).toMatch(/sql\.typed\.utcTimestamp/);
  });

  it("leaves the READ side of 1184 alone", () => {
    // Only the write side is wrong: a timestamptz on the wire carries its own
    // offset, and `now() - interval` comes back that way in the community
    // pruner. Refusing to parse it would break a correct read.
    expect(
      (UTC_TYPES.timestamptzRefused as { from?: readonly number[] }).from,
    ).toBeUndefined();
    const sql = connectUtc("postgresql://nobody:nobody@127.0.0.1:1/none");
    const parsers = (
      sql as unknown as { options: { parsers: Record<string, (v: string) => Date> } }
    ).options.parsers;
    expect(parsers["1184"]("2026-07-22 12:00:00+00").toISOString()).toBe(MEANS);
  });
});

// ── Question 3: nobody opens a client past the mapping ──────────────────────

/** Every source file in the template tree, minus the places that are not ours. */
function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".next", ".git", ".dev", ".data", "drizzle"].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (/\.(mjs|ts|tsx)$/.test(entry)) yield full;
  }
}

/**
 * Where a postgres.js client is opened, by file.
 *
 * `blankComments()` and not a regex of this file's own: a file has to be able to
 * EXPLAIN this rule — `pg-utc.mjs` itself does, at length — without tripping it.
 * The lookbehind keeps `connectUtc(` and any `x.postgres(` out; what is wanted
 * is the bare call to the driver's own factory.
 */
function directClients(): { file: string; count: number }[] {
  const found: { file: string; count: number }[] = [];
  for (const file of sourceFiles(ROOT)) {
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
    const hits = (blankComments(readFileSync(file, "utf8")).match(
      /(?<![A-Za-z0-9_$.])postgres\(/g,
    ) ?? []).length;
    if (hits > 0) found.push({ file: relative(ROOT, file), count: hits });
  }
  return found;
}

describe("every client in this tree goes through connectUtc()", () => {
  it("only db/index.ts and pg-utc.mjs call postgres() themselves", () => {
    const found = directClients();

    // 🚨 Count guards. Zero files scanned or zero call sites found is a broken
    // walk reporting a pass — the two allowed sites below are the proof that
    // the scanner can still see the shape it is looking for.
    expect([...sourceFiles(ROOT)].length).toBeGreaterThan(200);
    expect(found.length).toBeGreaterThan(1);

    expect(found.map((f) => f.file).sort()).toEqual([
      // drizzle's own client. It gets no `types:` — `construct()` would
      // overwrite them; `db/timestamp-utc.test.ts` is that story.
      "db/index.ts",
      // the factory itself
      "scripts/lib/pg-utc.mjs",
    ]);
  });

  it("recognises the shape it is supposed to catch", () => {
    // Guards the guard: without this, a scanner that had stopped matching
    // anything at all would report the same two files (they are hard-coded
    // above) and say nothing about the rest of the tree.
    const needle = 'const sql = postgres(url, { max: 1 });\n// postgres(ignored)\n';
    expect((blankComments(needle).match(/(?<![A-Za-z0-9_$.])postgres\(/g) ?? []).length).toBe(1);
    expect(
      (blankComments("connectUtc(url);\nsql.postgres(url);\n").match(
        /(?<![A-Za-z0-9_$.])postgres\(/g,
      ) ?? []).length,
    ).toBe(0);
  });
});
