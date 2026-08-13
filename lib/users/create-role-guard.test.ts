// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The create door asks the ROLE rule when the address is already taken.
//
// `createUser()` is an upsert: an address that exists makes it an UPDATE of a
// role. For a while it went around both safeguards `canChangeRole()` exists
// for, because the only check in front of it was `canCreateUser()` — which asks
// whether the actor is an owner and nothing else. So an owner could demote
// themselves, or demote the LAST remaining owner, by typing an address that was
// already in the table. `setUserRole()` refuses both; the door beside it did
// not.
//
// It happened silently in both directions. The admin form reports "created" for
// a row it only updated (`app/dashboard/admin/users/actions.ts`), and
// `user_upsert` on the setup surface defaults `role` to "member" — so an upsert
// naming the sole owner and omitting the field was enough, in production, from
// an agent reading text somebody else wrote.
//
// **What is asserted here is that the INSERT never leaves the process**, not
// merely that a throw happened. A guard that refused after writing would
// satisfy a return-value test and lose the app its last administrator.
//
// The database is `drizzle-orm/pg-proxy` — a real Drizzle instance whose driver
// is a function — the same arrangement `modules/courses/lib/manage.test.ts`
// uses, and for the same reason: nothing about the query building is faked, and
// no live database is needed to see which statements ran.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Captured {
  sql: string;
  params: unknown[];
}

// ⚠️ The answers are keyed by the KIND of statement, never by their order.
// A positional queue would make every removal of the lookup shift the queue,
// and a test that then fails is reporting misalignment rather than the defect —
// which is the same "green for the wrong reason" this file exists to prevent,
// pointed at itself. Keyed this way, each failing test names a real claim.
vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const captured: Captured[] = [];
  const state = {
    /** The row `users` holds for that address already — `[]` for none. */
    existing: [] as unknown[][],
    /** What `countOwners()` answers. */
    owners: [[0]] as unknown[][],
    /** What the upsert hands back through `.returning()`. */
    written: [] as unknown[][],
  };
  const db = drizzle(async (sql: string, params: unknown[]) => {
    captured.push({ sql, params });
    const q = sql.toLowerCase();
    if (q.includes("insert into")) return { rows: state.written };
    if (q.includes("count(")) return { rows: state.owners };
    return { rows: state.existing };
  });
  return { db, __captured: captured, __state: state };
});

import * as dbModule from "@/db";

import { createUser } from "./manage";
import { UserError } from "./rules";

interface State {
  existing: unknown[][];
  owners: unknown[][];
  written: unknown[][];
}

const captured = (dbModule as unknown as { __captured: Captured[] }).__captured;
const state = (dbModule as unknown as { __state: State }).__state;

const OWNER = { id: "owner-1", role: "owner" };
const OTHER_OWNER = { id: "owner-2", role: "owner" };

// A fixed instant rather than `new Date()`: `createdAt` is never asserted here,
// and a value that moves with the clock is one more reason a run could differ
// from the run before it.
const NOW = new Date("2026-01-01T00:00:00.000Z");

/** The statements this call actually sent, lower-cased for matching. */
function statements(): string[] {
  return captured.map((c) => c.sql.toLowerCase());
}

function inserts(): string[] {
  return statements().filter((sql) => sql.includes("insert into"));
}

beforeEach(() => {
  captured.length = 0;
  state.existing = [];
  state.owners = [[0]];
  state.written = [];
});

describe("createUser — the role rule on an address that already exists", () => {
  it("refuses to demote the last owner, and writes nothing", async () => {
    state.existing = [[OTHER_OWNER.id, "owner"]];
    state.owners = [[1]];

    await expect(
      createUser(OWNER, { email: "sole@example.com", role: "member" }),
    ).rejects.toThrow(UserError);

    // The half a return-value test cannot see.
    expect(inserts()).toEqual([]);
  });

  it("names the reason `lastOwnerRole`, so the UI can translate it", async () => {
    state.existing = [[OTHER_OWNER.id, "owner"]];
    state.owners = [[1]];

    // The code is what `messages/*.json` carries a sentence for — a thrown
    // Error with an English message would reach the operator untranslated.
    await expect(
      createUser(OWNER, { email: "sole@example.com", role: "member" }),
    ).rejects.toMatchObject({ code: "lastOwnerRole" });
  });

  it("refuses an owner demoting THEMSELVES, whatever the owner count", async () => {
    // Two owners, so `lastOwnerRole` cannot be what fires — this is the other
    // safeguard, and it is the one that locks somebody out of their own app.
    state.existing = [[OWNER.id, "owner"]];
    state.owners = [[2]];

    await expect(
      createUser(OWNER, { email: "me@example.com", role: "member" }),
    ).rejects.toMatchObject({ code: "selfDemote" });
    expect(inserts()).toEqual([]);
  });

  it("allows demoting an owner while another one remains", async () => {
    state.existing = [[OTHER_OWNER.id, "owner"]];
    state.owners = [[2]];
    state.written = [["id-9", "them@example.com", null, "member", NOW, null]];

    await expect(
      createUser(OWNER, { email: "them@example.com", role: "member" }),
    ).resolves.toMatchObject({ role: "member" });
    expect(inserts()).toHaveLength(1);
  });

  it("still creates a genuinely new user, and does not count owners for it", async () => {
    // The counter-proof. A guard that refused everything would pass every test
    // above and take the tool's actual job with it. `countOwners()` is only
    // paid for when the address is really taken.
    state.existing = [];
    state.written = [["id-1", "neu@example.com", null, "member", NOW, null]];

    await expect(
      createUser(OWNER, { email: "neu@example.com", role: "member" }),
    ).resolves.toMatchObject({ email: "neu@example.com" });

    expect(inserts()).toHaveLength(1);
    expect(statements().filter((sql) => sql.includes("count("))).toEqual([]);
  });

  it("refuses a non-owner before it looks anything up", async () => {
    // `canCreateUser()` still comes first — the new lookup must not turn a
    // plain authorisation refusal into a database round-trip.
    await expect(
      createUser(
        { id: "member-1", role: "member" },
        { email: "neu@example.com", role: "member" },
      ),
    ).rejects.toMatchObject({ code: "notOwner" });
    expect(captured).toEqual([]);
  });

  it("refuses an unusable address before it looks anything up", async () => {
    await expect(
      createUser(OWNER, { email: "   ", role: "member" }),
    ).rejects.toMatchObject({ code: "invalidEmail" });
    expect(captured).toEqual([]);
  });
});
