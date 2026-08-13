// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 When a Member's access to one key STARTED — the question a week-by-week
// course asks, and the one with a wrong answer that looks right.
//
// The wrong answer was written down as an instruction: take
// `grants.createdAt` into `ENTITLEMENT_COLUMNS` and read "the earliest
// `grantedAt` among the rows `entitlementsFor()` returns". That reader is a
// `DISTINCT ON (product_key)`, so it returns ONE row per key and chooses it by
// purchase-beats-comp then furthest `accessUntil` — never by age. "The earliest
// among them" is vacuous over one row, and the date it carries belongs to
// whichever grant won a contest about something else. A Member who bought,
// refunded and bought again gets their programme clock started on the wrong
// grant, and the only symptom is a week that opens on the wrong day.
//
// Nothing here can run a query — there is no test database (see the header of
// `./manage.ts`). What CAN be read is the statement, so that is what is pinned:
// the aggregate, the filter it aggregates over, and the mapper without which
// the `Date` is a string in costume.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { grants } from "@/db/schema";

import { PLAN_START, activeFor } from "./manage";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE = readFileSync(join(ROOT, "lib", "entitlements", "manage.ts"), "utf8");

/** The statement `planStartedAt` runs, built from the same exported parts. */
function statement() {
  return db
    .select({ startedAt: PLAN_START })
    .from(grants)
    .where(and(activeFor("member-1"), eq(grants.productKey, "course_complete")))
    .toSQL();
}

describe("the statement behind planStartedAt", () => {
  it("aggregates min(created_at), not any other row's date", () => {
    const { sql } = statement();
    expect(sql).toMatch(/min\(/i);
    expect(sql).toContain('"created_at"');
  });

  it("🚨 aggregates over the ACTIVE grants, so a revoked one cannot start the clock", () => {
    // `activeFor` verbatim — the same three conditions `hasPlan` gates on, so
    // "may they use it" and "since when" cannot answer about different rows.
    const { sql, params } = statement();
    expect(sql).toContain('"ended_at"');
    expect(sql).toContain('"suspended_at"');
    expect(sql).toContain('"access_until"');
    expect(params).toContain("member-1");
  });

  it("is scoped to ONE product key", () => {
    // Without this the aggregate spans every key the Member holds, and a
    // course's clock would start at their first purchase of anything.
    const { sql, params } = statement();
    expect(sql).toContain('"product_key"');
    expect(params).toContain("course_complete");
  });

  it("is NOT a DISTINCT ON — the shape that produced the wrong answer", () => {
    const { sql } = statement();
    expect(sql).not.toMatch(/distinct on/i);
    expect(sql).not.toMatch(/order by/i);
  });

  it("proves the reader really looks at this statement", () => {
    // The needle probe. Every assertion above would also pass against an empty
    // string if `.toSQL()` ever stopped returning one, and three of them are
    // `not.toMatch`.
    const { sql } = statement();
    expect(sql.length).toBeGreaterThan(40);
    expect(sql).toMatch(/^select /i);
  });
});

describe("what planStartedAt must not become", () => {
  const body = SOURCE.slice(
    SOURCE.indexOf("export async function planStartedAt"),
    SOURCE.indexOf("* One grant row, whole"),
  );

  it("found the function it is guarding", () => {
    expect(body).toContain("PLAN_START");
    expect(body.length).toBeGreaterThan(100);
  });

  it("🚨 does not go through entitlementsFor()", () => {
    // The instruction this replaced. One row per key, chosen by something that
    // is not age — see the file header.
    expect(body).not.toContain("entitlementsFor");
  });

  it("throws on an unknown key rather than reporting no access", () => {
    // Same ruling as `hasPlan`: a typo'd key answering `null` is a paying
    // customer whose programme never opens, with no log line saying why.
    expect(body).toContain("getProduct(productKey)");
  });

  it("borrows the column's mapper, so the Date is a Date", () => {
    const aggregate = SOURCE.slice(
      SOURCE.indexOf("export const PLAN_START"),
      SOURCE.indexOf("export async function planStartedAt"),
    );
    expect(aggregate).toContain("mapWith(");
    // `db/sql-cast.test.ts` refuses this tree-wide; asserted here too, because
    // this is the exact expression that invites it.
    expect(aggregate).not.toMatch(/sql<\s*Date\s*>/);
  });
});
