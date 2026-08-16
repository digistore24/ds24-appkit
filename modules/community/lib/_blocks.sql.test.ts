// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 **The correlated subqueries, read as SQL — the one defect in this module
// that no other kind of test could see.**
//
// Three subqueries in `_blocks.ts` ask a question about the member the OUTER
// query is on: how much purchased access do they hold, how many reports have
// they filed, how many have been filed against them. Each correlates by writing
// the outer member id into its own WHERE clause.
//
// Interpolating `${users.id}` there renders `"id"` — **unqualified** — and
// inside `select … from "grants"` a bare `"id"` is the GRANT's own id. So
// `where "member_id" = "id"` correlates a table to itself, is false for every
// row, and the count is always 0. Postgres raises nothing, because both tables
// have an `id`.
//
// ⚠️ **It shipped that way and had no symptom for months.** The only consumer
// was `reporterWeight()`, which returns before it looks at any of the three
// while `weighting` ships OFF; every unit test over the rule passes its numbers
// in directly. It surfaced the day the new-member grace became a second,
// always-on consumer — a member with a live purchase was throttled anyway — and
// it was found by posting in a running app, not by any test in this repo.
//
// This file is the answer to "and what would have caught it": the SQL as a
// string, with no database in the room. `toSQL()` is a pure call.
import { describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";

import { grants, users } from "@/db/schema";

/**
 * A drizzle instance over NO client. `toSQL()` renders; it never connects.
 *
 * 🚨 **It has to be this builder, and finding that out took two wrong tests.**
 * The same fragment renders THREE different ways:
 *
 *   `dialect.sqlToQuery(fragment)` standalone  → fully qualified, always
 *   `new QueryBuilder().select(…)`             → fully qualified, always
 *   `drizzle(client).select(…).from(users)`    → **unqualified**, which is the
 *                                                 defect
 *
 * So a test written against either of the first two is green for the broken
 * code and proves nothing — both were written here before this one, and both
 * passed while a member with a live purchase was being throttled in a running
 * app. The rule this leaves behind: a claim about generated SQL is measured
 * through the builder the app actually uses.
 */
const probe = drizzle({} as never);

/** The SQL a fragment renders to inside the real shape `writerFactsFor()` uses. */
function inSelect(fragment: ReturnType<typeof sql>): string {
  return probe
    .select({ n: fragment })
    .from(users)
    .where(eq(users.id, "x"))
    .limit(1)
    .toSQL().sql;
}

describe("a correlated subquery names the OUTER table", () => {
  // The shape the code must use, kept here as the positive control: what is
  // asserted is a property of the FORM, and the tie-back to the real file is
  // the last describe in this file.
  const outerMemberId = sql`${sql.identifier("users")}.${sql.identifier("id")}`;

  // ⚠️ The outer reference is interpolated DIRECTLY, never wrapped in a second
  // `sql``` first — wrapping it is itself enough to make drizzle qualify it,
  // which is how the previous version of this test managed to be green over the
  // broken code. The call sites in `_blocks.ts` interpolate directly too, so
  // this is the shape that matters.
  const correlation = (outer: unknown) =>
    sql`(select count(*) from ${grants} where ${grants.memberId} = ${outer})`;

  it("renders UNqualified from a bare column — the trap, shown rather than described", () => {
    // 🚨 The whole defect in one assertion: `"member_id" = "id"` inside
    // `from "grants"` compares the grant's member to the grant's own id.
    const text = inSelect(correlation(users.id));
    expect(text).toContain('from "grants"');
    expect(text).toMatch(/"member_id"\s*=\s*"id"/);
    // ⚠️ Not `not.toContain('"users"."id"')` — the OUTER where clause carries
    // that legitimately. What is wrong is the correlation, and only it.
    expect(text).not.toContain('"member_id" = "users"."id"');
  });

  it("renders qualified from sql.identifier — the fix", () => {
    const text = inSelect(correlation(outerMemberId));
    expect(text).toContain('"member_id" = "users"."id"');
    expect(text).not.toMatch(/"member_id"\s*=\s*"id"[^.]/);
  });

  it("still selects from users, so the qualification is one the FROM offers", () => {
    expect(inSelect(correlation(outerMemberId))).toContain('from "users"');
  });
});

describe("the REAL fragment, imported rather than rebuilt", () => {
  // 🚨 Everything above is about a form; this is about the code that ships. The
  // two are not the same guard, and the difference was measured: taking the
  // qualification back out of `_blocks.ts` leaves every shape assertion above
  // GREEN, because they build their own fragment. This one goes red.
  it("correlates paidGrantsFragment() to users", async () => {
    // `_blocks.ts` imports `@/db`, which opens a client at module scope. The
    // fake is the same one `grace-guard.test.ts` uses, and nothing here calls it.
    vi.doMock("@/db", () => ({ db: {} }));
    const { paidGrantsFragment } = await import("./_blocks");

    const text = inSelect(paidGrantsFragment());
    expect(text).toContain('"member_id" = "users"."id"');
    expect(text).not.toMatch(/"member_id"\s*=\s*"id"[^.]/);
    // Non-vacuity: this really is the purchased-access question and not an
    // empty fragment that would satisfy both assertions by saying nothing.
    expect(text).toContain("'purchase'");
    expect(text).toContain('"ended_at" is null');

    vi.doUnmock("@/db");
  });
});

describe("the source file uses the qualified form and nothing else", () => {
  // The tie-back: everything above is about a shape, and this is about the
  // FILE. A future subquery written the bare way is the finding.
  it("has no bare outer-id correlation left in _blocks.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { blankComments } = await import("@/scripts/lib/source-text.mjs");

    const code = blankComments(
      readFileSync(fileURLToPath(new URL("./_blocks.ts", import.meta.url)), "utf8"),
    );

    // Non-vacuity: the file really does build correlated subqueries.
    expect(code).toContain("select count(*) from");
    expect(code).toContain("OUTER_MEMBER_ID");

    // ⚠️ `${users.id}` inside a `sql` template is the bare form. It is legitimate
    // OUTSIDE one (`eq(users.id, …)` is everywhere in this file), so the match is
    // deliberately narrow: an interpolation of it in a template that also selects
    // from another table.
    const subqueries = code.match(/select count\(\*\) from[\s\S]{0,400}?\)`/g) ?? [];
    expect(subqueries.length).toBeGreaterThanOrEqual(3);
    for (const body of subqueries) {
      expect(body, `a correlated subquery still uses the bare form:\n${body}`).not.toContain(
        "${users.id}",
      );
    }
  });

  it("fixes all THREE, not only the one the grace reads", async () => {
    // 🚨 The three subqueries were written for the weighting; the grace is
    // merely the first consumer that runs. Fixing `paidGrants` alone would put
    // the module straight back here the day an operator switches `weighting`
    // on — `reportsMade` and `reportsAgainst` would still count 0, and the
    // weight would be wrong in the direction that silences the wrong people.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { blankComments } = await import("@/scripts/lib/source-text.mjs");

    const code = blankComments(
      readFileSync(fileURLToPath(new URL("./_blocks.ts", import.meta.url)), "utf8"),
    );
    // One declaration plus one use per subquery.
    const uses = code.match(/OUTER_MEMBER_ID/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(4);
  });
});
