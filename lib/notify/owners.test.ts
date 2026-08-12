// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What the owner query SENDS, not what a mock hands back.
//
// 🚨 The claim of this file is about the SQL that leaves the process. A function
// that selected every user and narrowed the list in JavaScript would satisfy
// every behavioural test anybody could write for it — the return value would be
// identical — while pulling every member's address into the process on every
// run, which is exactly what the narrowing exists to prevent.
//
// So the database is `drizzle-orm/pg-proxy`: a REAL Drizzle instance whose
// driver is a function. Nothing about the query building is faked; what is
// asserted is the string Postgres would have received. Not the whole string —
// a hand-written copy would be a second version of the statement, agreeing with
// the first by hand and needing an edit every time a column moved. Pinned are
// the three conditions that carry the argument, and the order.
//
// Same instrument and same reasoning as `modules/courses/lib/manage.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Captured {
  sql: string;
  params: unknown[];
}

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const captured: Captured[] = [];
  const state = { rows: [] as unknown[][] };
  const db = drizzle(async (sql: string, params: unknown[]) => {
    captured.push({ sql, params });
    return { rows: state.rows };
  });
  return { db, __captured: captured, __state: state };
});

import * as dbModule from "@/db";

import { operatorRecipients } from "./owners";

const { __captured: captured, __state: state } = dbModule as unknown as {
  __captured: Captured[];
  __state: { rows: unknown[][] };
};

/** Run the query and hand back the one statement it produced. */
async function statement(): Promise<Captured> {
  await operatorRecipients();
  // Non-vacuity: a call that never reached the driver would make every claim
  // below pass by having nothing to look at.
  expect(captured, "operatorRecipients() sent no statement at all").toHaveLength(1);
  return captured[0];
}

beforeEach(() => {
  captured.length = 0;
  state.rows = [];
});

describe("the query that decides who the operator is", () => {
  it("asks the database for owners — the role is a parameter, not a scan", async () => {
    const { sql, params } = await statement();
    expect(sql).toContain('from "users"');
    expect(sql).toMatch(/"role"\s*=\s*\$\d/);
    expect(params).toContain("owner");
  });

  it("🚨 excludes a blocked account IN the where clause", async () => {
    // Withdrawn access is withdrawn access. If this narrowing moved into JS,
    // the address would still have been read out of the database.
    const { sql } = await statement();
    expect(sql).toMatch(/"blockedAt"\s+is\s+null/);
  });

  it("🚨 excludes a row with no address IN the where clause", async () => {
    const { sql } = await statement();
    expect(sql).toMatch(/"email"\s+is\s+not\s+null/);
  });

  it("orders by account age, oldest first — a stable list, not the planner's", async () => {
    const { sql } = await statement();
    expect(sql).toMatch(/order by "users"\."createdAt" asc/);
  });

  it("selects three columns and no more — no password hash, no token", async () => {
    const { sql } = await statement();
    expect(sql).toContain('"id"');
    expect(sql).toContain('"email"');
    expect(sql).toContain('"name"');
    expect(sql).not.toContain("passwordHash");
    expect(sql).not.toContain("checkoutToken");
  });

  it("hands the rows on in the shape a sender needs", async () => {
    state.rows = [["u-1", "owner@example.com", "Chris"]];
    const [row] = await operatorRecipients();
    expect(row).toEqual({ id: "u-1", email: "owner@example.com", name: "Chris" });
  });

  it("an app with no reachable owner is an empty list, never a throw", async () => {
    state.rows = [];
    await expect(operatorRecipients()).resolves.toEqual([]);
  });
});
