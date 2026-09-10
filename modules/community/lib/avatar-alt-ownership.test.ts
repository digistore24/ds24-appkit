// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 **`refreshAvatarAlt()` writes into `media` — and the WHERE clause is the
// whole security property of that write.**
//
// The function rewrites one row's alternative text so that a member who renames
// themselves does not leave their old name sitting on their own picture. It
// addressed that row by id alone. The security review of 2026-08-18 (L-4)
// flagged it beside `deleteMedia()` for the same reason: its one caller happens
// to pass an id it read off the member's OWN profile row, so nothing foreign can
// reach it today — but that is a fact about `profile-actions.ts`, not about this
// function, and the next caller is reminded by nothing.
//
// ── Why the assertion is on the rendered SQL and not on a spy ───────────────
// "Was `and()` called" is satisfied by an `and()` over the wrong columns, and a
// mock that records the condition object tells you nothing about what Postgres
// would be asked. So the recorded condition is rendered through the drizzle
// builder — `toSQL()` is a pure call, it never connects — and the test reads the
// clause and the parameters the database would actually receive.
//
// ⚠️ It renders through `drizzle({} as never)` and not through a bare
// `PgDialect`, following `_blocks.sql.test.ts`: the same fragment renders
// differently depending on which builder is holding it, and only the builder the
// app itself uses answers the question the app has.
import { drizzle } from "drizzle-orm/postgres-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => {
  const wheres: unknown[] = [];
  const sets: unknown[] = [];
  const db = {
    update: () => ({
      set: (values: unknown) => {
        sets.push(values);
        return {
          where: (condition: unknown) => {
            wheres.push(condition);
            return Promise.resolve(undefined);
          },
        };
      },
    }),
  };
  return { wheres, sets, db };
});

vi.mock("@/db", () => ({ db: captured.db }));

const { refreshAvatarAlt } = await import("./profiles");
const { media } = await import("@/db/schema");

/**
 * The WHERE clause the recorded condition would produce, as the app builds it.
 *
 * ⚠️ Only the clause. A whole `select()` renders every column of `media` in its
 * projection — `owner_id` among them — so an assertion over the full statement
 * would find the column name whatever the condition said, which is exactly the
 * kind of always-green check this file exists to avoid.
 */
const probe = drizzle({} as never);
function rendered(condition: unknown): { where: string; params: unknown[] } {
  const { sql, params } = probe
    .select({ id: media.id })
    .from(media)
    .where(condition as never)
    .toSQL();
  const at = sql.indexOf(" where ");
  return { where: at === -1 ? "" : sql.slice(at + " where ".length), params };
}

beforeEach(() => {
  captured.wheres.length = 0;
  captured.sets.length = 0;
});

describe("🚨 refreshAvatarAlt names the owner in the statement", () => {
  it("asks for the id AND the owner when the owner is given", async () => {
    await refreshAvatarAlt("m1", "Anna Schmidt", "alice");

    expect(captured.wheres).toHaveLength(1);
    const { where, params } = rendered(captured.wheres[0]);

    // Both columns, in one clause. `owner_id` alone would be a mass update and
    // `id` alone is the finding.
    expect(where).toMatch(/"id"\s*=/);
    expect(where).toMatch(/"owner_id"\s*=/);
    // …and the values that reach them, so a clause naming the column while
    // binding the wrong parameter cannot pass.
    expect(params).toEqual(["m1", "alice"]);
  });

  it("writes only the alt, and only the name it was given", async () => {
    await refreshAvatarAlt("m1", "Anna Schmidt", "alice");
    // The row carries a member's own file. A `set()` that had grown a second
    // column here would be this function quietly becoming a media editor.
    expect(captured.sets).toEqual([{ alt: "Anna Schmidt" }]);
  });

  it("falls back to the id alone when no owner is named — the parameter is OPTIONAL", async () => {
    // Kept optional so the signature change breaks no caller. This is the
    // non-vacuity half as well: without it, a `where()` that had stopped
    // receiving anything at all would still satisfy the test above by accident.
    await refreshAvatarAlt("m1", "Anna Schmidt");

    const { where, params } = rendered(captured.wheres[0]);
    expect(where).not.toMatch(/"owner_id"/);
    expect(params).toEqual(["m1"]);
  });
});
