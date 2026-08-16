// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The WRITE side of `sql-cast.test.ts`: a raw `sql` template carries no mapper
// in EITHER direction.
//
// That file measures the read: `sql<Date>` comes back as the Postgres string
// and `format.dateTime()` renders nonsense over a clean 200. This one measures
// the write, and it is the louder half — nothing renders at all:
//
//   sql`${setupConfirmations.expiresAt} > ${now}`   // now: Date
//
// looks like the comparison next to it, and is not. `gt(column, value)` runs the
// value through that column's `mapToDriverValue` and hands postgres.js the ISO
// string this project stores. A raw template has no column on the value's side,
// so drizzle binds the `Date` OBJECT and the driver's bind step throws
//
//   TypeError: The "string" argument must be of type string or an instance of
//   Buffer or ArrayBuffer. Received an instance of Date
//
// Measured on Postgres 16 with Node 22.22.1, postgres 3.4.9, drizzle-orm 0.45.2.
// The line above is real: it was `spendConfirmation()`, so outside DEV — the
// only environments that reach it — every `mode: "apply"` of every mutating
// setup tool answered 500, and the two-act protocol `docs/setup-mcp.md`
// prescribes for STAGING and PROD could not complete its second act at all.
// Nothing in this tree measured it, because `deploy-test` runs the app in DEV
// and DEV needs no confirmation.
//
// ⚠️ **Why this is not a source-text rule.** What is dangerous is the TYPE of an
// interpolated value, and a text scanner cannot see a type. The rule text CAN
// express — "an interpolation in a `sql` template must be a column reference or
// a `sql.param(…)`" — was measured against this tree and has nine findings that
// are all correct as they stand: strings and numbers, which the driver
// serialises without help. A lint that opens with a wall of correct code is one
// somebody switches off, and it takes the intent with it. So this asks the
// question where it can be answered exactly: it BUILDS the real query, through
// the real function, and looks at what would go on the wire.
//
// It needs no database. The client records instead of connecting, which is
// also why this can live in `make check` rather than behind one.
//
// 🚨 **This file is a LIST, and the list is the thing that failed.** It named
// three functions in `lib/setup/manage.ts`, and the same defect then landed in
// `modules/community/lib/_blocks.ts` and took out every spam report in that
// module. It could not have been added here either: `modules/boundary.test.ts`
// forbids a file under `db/` from naming a module. So the apparatus moved to
// `./date-param-harness.ts`, and a module asks the same question in its own
// tree — `modules/community/lib/date-param.test.ts` is the first.
import { describe, expect, it, vi } from "vitest";

import * as schema from "./schema";
import { bound, dateParams, resetBound } from "./date-param-harness";

vi.mock("@/db", async () => {
  const { recordingDb } = await import("./date-param-harness");
  return { db: recordingDb() };
});

describe("no query binds a Date object", () => {
  it("spendConfirmation — the second act of every apply outside DEV", async () => {
    resetBound();
    const { spendConfirmation } = await import("@/lib/setup/manage");

    await spendConfirmation({
      token: "not-a-real-token",
      keyId: "k1",
      tool: "user_upsert",
      appEnv: "production",
      toolInput: { email: "someone@example.com" },
      now: new Date("2026-08-12T08:00:00.000Z"),
    });

    // 🚨 A count guard, not decoration. If the mock ever stops being reached —
    // a renamed export, a second db handle, a `vi.mock` that no longer matches —
    // `dateParams()` is empty and this test goes green having measured nothing.
    expect(bound.length).toBeGreaterThan(0);
    expect(dateParams()).toEqual([]);
  });

  it("issueConfirmation — the act that mints what the above spends", async () => {
    resetBound();
    const { issueConfirmation } = await import("@/lib/setup/manage");

    await issueConfirmation({
      keyId: "k1",
      tool: "user_upsert",
      appEnv: "production",
      toolInput: { email: "someone@example.com" },
      now: new Date("2026-08-12T08:00:00.000Z"),
    });

    expect(bound.length).toBeGreaterThan(0);
    expect(dateParams()).toEqual([]);
  });

  it("pruneSetupAudit — the same shape, in the job that deletes", async () => {
    resetBound();
    const { pruneSetupAudit } = await import("@/lib/setup/manage");

    await pruneSetupAudit(24, new Date("2026-08-12T08:00:00.000Z"));

    expect(bound.length).toBeGreaterThan(0);
    expect(dateParams()).toEqual([]);
  });

  // Guards the guard: the needle has to be visible, or a green line above says
  // nothing. A raw template with a `Date` in it must be SEEN as one.
  it("recognises the shape it is supposed to catch", async () => {
    resetBound();
    const { sql, and, isNull } = await import("drizzle-orm");
    const { db } = await import("@/db");
    const now = new Date("2026-08-12T08:00:00.000Z");

    await db
      .update(schema.setupConfirmations)
      .set({ spentAt: now })
      .where(
        and(
          isNull(schema.setupConfirmations.spentAt),
          sql`${schema.setupConfirmations.expiresAt} > ${now}`,
        ),
      )
      .returning({ tokenHash: schema.setupConfirmations.tokenHash });

    expect(bound.length).toBeGreaterThan(0);
    expect(dateParams()).toHaveLength(1);
    expect(dateParams()[0]).toMatch(/is a Date/);
  });
});
