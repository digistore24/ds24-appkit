// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `sql<T>` is a promise TypeScript believes and nobody keeps.
//
// Drizzle converts a COLUMN reference: `grants.createdAt` runs through
// PgTimestamp.mapFromDriverValue and arrives as a Date. A raw sql`` expression
// gets no such treatment — its decoder is `noopDecoder`, so whatever the driver
// returned is handed straight on, and `sql<Date>` only tells the compiler to
// stop asking. Measured against this project's own database:
//
//   select({ raw: grants.createdAt,              // → Date          (converted)
//            agg: sql`min(${grants.createdAt})`  // → "2026-07-25 11:29:17.552095"
//   })                                          //   a string       (not converted)
//
// What that string then does is the reason this test exists. Passed to
// `format.dateTime()` it makes Intl throw "Invalid time value" — and next-intl
// catches that, logs it and renders the raw string into the cell. The page
// answers 200 with visible nonsense in it, and no test, no build and no smoke
// run says a word. It cost a working afternoon once; it does not get to happen
// twice.
//
// And "just wrap it in new Date()" is the wrong fix: the string carries no zone,
// so V8 reads it in the host's zone and the date silently shifts by the host's
// offset — the exact bug db/index.ts was written to prevent.
//
// The way out is any of:
//   • select the column itself and aggregate in JS, or
//   • sql`…`.mapWith(grants.createdAt)   — borrow the column's own conversion, or
//   • aggregate to text in SQL and convert deliberately:
//     sql<string>`to_char(min(${grants.createdAt}), 'YYYY-MM-DD"T"HH24:MI:SSZ')`
//
// This is the same shape of guard as scripts/portability.test.ts, including the
// escape hatch: a line that genuinely has to say it is exempted with the marker
// `sql-cast-ok`.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { blankComments as stripComments } from "@/scripts/lib/source-text.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const EXEMPT = "sql-cast-ok";

/** Where queries are written. Not `app/api` alone — server components query too. */
const SEARCH_DIRS = ["db", "lib", "app", "components", "hooks"];

/** Only Date is banned: sql<string> for sum() and sql<number> for count(*)::int
 *  describe what the driver really returns and are correct as they stand. */
const BANNED = /\bsql\s*<[^>]*\bDate\b[^>]*>/;

function sourceFiles(dir: string, found: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      sourceFiles(full, found);
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx")) {
      found.push(full);
    }
  }
  return found;
}

/** Replace comments with spaces, so line numbers survive and prose does not count. */
describe("raw SQL does not get to claim it returns a Date", () => {
  it("has no sql<…Date…> anywhere in the app", () => {
    const findings: string[] = [];

    for (const dir of SEARCH_DIRS) {
      for (const file of sourceFiles(path.join(ROOT, dir))) {
        const original = readFileSync(file, "utf8").split("\n");
        const code = stripComments(readFileSync(file, "utf8")).split("\n");

        code.forEach((line, index) => {
          if (original[index].includes(EXEMPT)) return;
          if (!BANNED.test(line)) return;
          findings.push(
            `${path.relative(ROOT, file)}:${index + 1} — sql<Date> is not checked at runtime. ` +
              "Drizzle converts columns, not raw SQL: this arrives as the Postgres " +
              "string and breaks format.dateTime(). Select the column, use " +
              ".mapWith(<the column>), or aggregate to text and convert on purpose. " +
              "See docs/troubleshooting.md → Dates and raw SQL.",
          );
        });
      }
    }

    expect(findings).toEqual([]);
  });

  // Guards the guard: a regex that quietly stops matching is worse than no test,
  // because it reads as a green light.
  it("recognises the shapes it is supposed to catch", () => {
    expect(BANNED.test("since: sql<Date>`min(${grants.createdAt})`")).toBe(true);
    expect(BANNED.test("at: sql<Date | null>`max(x)`")).toBe(true);
    expect(BANNED.test("at: sql< Date >`max(x)`")).toBe(true);
    // and leaves the honest ones alone
    expect(BANNED.test("costMicros: sql<string>`sum(${aiUsage.costMicros})`")).toBe(false);
    expect(BANNED.test("calls: sql<number>`count(*)::int`")).toBe(false);
    expect(BANNED.test("bucket: sql<string>`to_char(min(${x}), 'YYYY-MM-DD')`")).toBe(false);
  });
});
