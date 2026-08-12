// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The `WHERE` clause, and the one distinction that would be invisible in review.
//
// ── Why this asserts on SQL and not on rows ────────────────────────────────
// There is no test database in this project, deliberately, and commit `4261477`
// is what happens when a test reaches for one: on a machine with `node run.mjs
// start` running it writes junk into the developer's own tables, and on a
// machine without it prints a wall of `ECONNREFUSED`. `conversationWhere()` is
// exported precisely so the decision can be read as a value, and `PgDialect`
// renders it exactly as the driver would receive it — no connection, no socket.
//
// ── The bug this file exists for ───────────────────────────────────────────
// `eq(column, null)` compiles, typechecks and reads correctly in a diff. Drizzle
// renders it as a bound parameter whose value is `null`, and `col = NULL` in SQL
// matches **no row** — so the support chat would return an empty transcript and
// "Delete history" would delete nothing, with no error anywhere. That is why the
// sharpest assertion below is about the PARAMETERS and not about the text: a
// `= null` bug hides in the text as an ordinary `$2` and shows itself only in
// the value bound to it.
import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { chatMessages } from "@/db/schema";
import { conversationWhere } from "./conversation";

const dialect = new PgDialect();

function queryFor(memberId: string, conversationId: string | null) {
  return dialect.sqlToQuery(conversationWhere(memberId, conversationId));
}

describe("the support conversation is IS NULL, never = null", () => {
  const support = queryFor("member-1", null);

  it("is not vacuous — it names both columns it filters on", () => {
    // Without this, every assertion below would pass against an empty string,
    // which is the failure mode a structural test has to rule out first.
    expect(support.sql.length).toBeGreaterThan(0);
    expect(support.sql).toContain("member_id");
    expect(support.sql).toContain("conversation_id");
  });

  it("renders as an IS NULL test", () => {
    expect(support.sql.toLowerCase()).toContain("is null");
  });

  it("binds no null parameter — the shape that would match nothing", () => {
    // This is the assertion that would have caught `eq(column, null)`.
    expect(support.params).not.toContain(null);
    expect(support.params).toEqual(["member-1"]);
  });
});

describe("a companion conversation binds its key", () => {
  const companion = queryFor("member-1", "coach:day-7");

  it("compares the column against a bound value", () => {
    expect(companion.sql).toContain("conversation_id");
    expect(companion.params).toEqual(["member-1", "coach:day-7"]);
  });

  it("is not an IS NULL test", () => {
    expect(companion.sql.toLowerCase()).not.toContain("is null");
  });
});

describe("the two scopes are different clauses", () => {
  const shape = (memberId: string, conversationId: string | null) =>
    JSON.stringify(queryFor(memberId, conversationId));

  it("so one cannot silently answer for the other", () => {
    // The whole of AC 1 at the storage layer: if these were equal, day three's
    // turns would come back for day seven, and the chat page's "Delete history"
    // would take the companion's rows with it.
    expect(shape("member-1", null)).not.toBe(shape("member-1", "coach:day-7"));
    expect(shape("member-1", "coach:day-7")).not.toBe(shape("member-1", "coach:day-3"));
    expect(shape("member-1", "coach:day-7")).not.toBe(shape("member-2", "coach:day-7"));
  });
});

describe("the links column", () => {
  // A whitelist that dies with the request is the single most likely way to
  // ship Epic 25 broken: the stored answer keeps its markers, the reload has
  // no set for them, and yesterday's links are today's bracket text. These
  // assertions are about the SHAPE that makes the stored set fail safe.
  it("is nullable — every row written before it reads back as 'no links'", () => {
    // `.notNull()` here would need a backfill and would make the absence of a
    // whitelist unrepresentable; NULL is the one honest value for both "this
    // is a question" and "this answer predates the feature".
    expect(chatMessages.links.notNull).toBe(false);
    expect(chatMessages.links.hasDefault).toBe(false);
  });

  it("is an array of text, not a joined string", () => {
    // Whole-string membership is the control (AD-54's rule, per request). A
    // delimiter-joined column would make a marker containing that delimiter
    // unstorable and split one badly — and marker labels are free text.
    expect(chatMessages.links.columnType).toContain("Array");
  });
});
