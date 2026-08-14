// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The two WHERE clauses the impersonation record rests on.
//
// `lib/impersonation/manage.ts` was at **0 %** — 0 of 25 statements — beside a
// `claim.ts` at 100 %. What was untested is not arithmetic: it is which rows
// two statements are allowed to touch.
//
//   · `findOpenImpersonation()` is what `session.ts` calls before it swaps a
//     session. Its filter is the ANTI-REPLAY: without `endedAt IS NULL` a
//     record that was already closed lets its id be used again, and without
//     `expiresAt > now` a thirty-minute cap is a suggestion.
//   · `closeImpersonation()` is conditional on the row still being open, so the
//     first ending wins. Drop that and the `close-impersonations` job — which
//     runs every five minutes — overwrites `endedBy: "operator"` with
//     `"expired"` on a session the operator ended themselves. The record page
//     is what somebody reads when they ask whether an admin was really in their
//     account, and it would be answering with the wrong reason.
//
// The database is `drizzle-orm/pg-proxy` — a real Drizzle instance whose driver
// is a function — as `lib/digistore/payment-event.test.ts` and
// `lib/users/create-role-guard.test.ts` use it. Nothing about the query building
// is faked: what is asserted is the SQL Postgres would have received.
//
// **Seven needles, every one of them clean under `npm run typecheck`:**
//
//   · the `expiresAt > now` filter dropped from `findOpenImpersonation` — 1 red
//   · `isNull(endedAt)` dropped from `closeImpersonation` — 1 red
//   · 🚨 the `months < 1` guard dropped from `pruneImpersonations` — **2 red**.
//     That guard is the one standing between `Number(null)` and deleting every
//     record in the table.
//   · the abandoned sweep labelling `expired` instead of `abandoned` — 1 red
//   · the sweep losing its expiry condition, so it closes RUNNING sessions — 1 red
//   · a `leftJoin` turned into an `innerJoin` on the record page — 1 red. That
//     one erases the trail exactly when it is asked for: `operatorId` is
//     `set null` on delete, so every record of a departed operator vanishes.
//   · the stored cap computed from a different number — 1 red
//
// ── One function here is deliberately NOT tested ───────────────────────────
//
// 🚨 `listImpersonationsFor()` has **no caller anywhere in this tree**. Its own
// comment says it is for a member's subject access request — but the member's
// own download (`lib/privacy/export.ts`) queries `impersonations` directly, and
// the operator's command (`scripts/privacy/export-data.mjs`) writes the same
// question a third time in raw SQL. Enumerated: five files import this module,
// and none of them names it.
//
// Testing it would be the wrong answer. A test makes dead code look maintained
// and becomes a reason not to delete it — and this particular function is a
// THIRD spelling of a query two other files already answer, which is the drift
// `scripts/modules/privacy.test.ts` exists to prevent one layer up. It is
// written down here rather than quietly covered, so somebody can decide.
//
// ⚠️ What this does NOT claim: that the rows come back correct against a real
// Postgres. `scripts/deploy-cron.mjs` runs `close-impersonations` for real, on
// planted rows, and measures the survivor as well as the closure — including
// that an ending an operator already set is left alone.
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

import { IMPERSONATION_MINUTES } from "@/lib/users/rules";
import {
  closeAbandonedImpersonations,
  closeImpersonation,
  findOpenImpersonation,
  listImpersonations,
  openImpersonation,
  pruneImpersonations,
} from "./manage";

const captured = (dbModule as unknown as { __captured: Captured[] }).__captured;
const state = (dbModule as unknown as { __state: { rows: unknown[][] } }).__state;

/**
 * The instants a statement bound, parsed.
 *
 * ⚠️ `pg-proxy` hands the driver ISO STRINGS, not `Date` objects — measured,
 * after a first version of these tests looked for `instanceof Date` and found
 * nothing. Parsing them back is what lets an assertion be about the interval
 * rather than about the type.
 */
function instants(at = 0): Date[] {
  return captured[at].params
    .filter((p): p is string => typeof p === "string" && /^\d{4}-\d{2}-\d{2}T/.test(p))
    .map((p) => new Date(p));
}

/** The one statement this call sent, lower-cased. */
function only(): string {
  expect(captured.length, "expected exactly one statement").toBe(1);
  return captured[0].sql.toLowerCase();
}

beforeEach(() => {
  captured.length = 0;
  state.rows = [];
});

describe("findOpenImpersonation — an ended or expired record is NOT open", () => {
  it("🚨 filters on `ended_at is null` — a spent id is not replayable", async () => {
    await findOpenImpersonation("imp-1");

    const sql = only();
    expect(sql, "the closed-record filter is gone").toContain('"ended_at" is null');
  });

  it("🚨 filters on a future `expires_at` — the cap is not a suggestion", async () => {
    await findOpenImpersonation("imp-1");

    const sql = only();
    expect(sql, "the expiry filter is gone").toMatch(/"expires_at"\s*>/);
  });

  it("looks the record up by its id, and only one", async () => {
    await findOpenImpersonation("imp-1");

    const sql = only();
    expect(sql).toContain('"id" =');
    expect(sql).toContain("limit");
    expect(captured[0].params, "the id did not reach the statement").toContain("imp-1");
  });

  it("compares the expiry against NOW, not against a fixed moment", async () => {
    // The filter is only worth anything if the instant it binds moves. A
    // constant here — a module-scope `new Date()` evaluated once at import —
    // would make the cap stop applying the moment the process had been up long
    // enough, and nothing else in the app would notice.
    await findOpenImpersonation("imp-1");
    const [bound] = instants();
    expect(bound, "no time value was bound at all").toBeDefined();
    expect(Math.abs(Date.now() - bound.getTime()), "the bound instant is not now").toBeLessThan(
      5_000,
    );
  });

  it("asks nothing at all for an empty id", async () => {
    // A missing id is not a lookup that happens to find nothing — it is a
    // caller with nothing to look up, and a statement here would be a table
    // scan on every malformed request.
    await expect(findOpenImpersonation("")).resolves.toBeNull();
    expect(captured).toEqual([]);
  });

  it("answers null when the filters match nothing", async () => {
    state.rows = [];
    await expect(findOpenImpersonation("imp-1")).resolves.toBeNull();
  });
});

describe("closeImpersonation — the first ending wins", () => {
  it("🚨 updates only a row that is still open", async () => {
    // The operator pressing the button a moment before the cap passes must not
    // be overwritten by "expired" — and the every-five-minutes job must be safe
    // to run twice, which `docs/cron.md` requires of every job.
    await closeImpersonation("imp-1", "expired");

    const sql = only();
    expect(sql).toContain("update");
    expect(sql, "the conditional-close guard is gone").toContain('"ended_at" is null');
  });

  it("writes the reason it was given, and the id it was given", async () => {
    await closeImpersonation("imp-1", "operator");

    expect(only()).toContain('"ended_by"');
    expect(captured[0].params).toContain("operator");
    expect(captured[0].params).toContain("imp-1");
  });

  it("stamps an end time rather than leaving it null", async () => {
    await closeImpersonation("imp-1", "abandoned");
    expect(only()).toContain('"ended_at" =');
  });

  it("asks nothing at all for an empty id", async () => {
    await closeImpersonation("", "operator");
    expect(captured).toEqual([]);
  });
});

describe("openImpersonation — the cap is STORED, never recomputed", () => {
  it("🚨 writes an expiry exactly `IMPERSONATION_MINUTES` after the start", async () => {
    // `manage.ts` says why in one line: "stored, not recomputed, so the cap
    // cannot drift". Every later reader — the banner, the gate, the abandoned
    // sweep — compares against this column. Derive it at read time instead and
    // a config change would silently extend sessions that are already running.
    state.rows = [["imp-1", "operator-1", "member-9", new Date(), new Date()]];

    await openImpersonation({ operatorId: "operator-1", memberId: "member-9" });

    const dates = instants();
    expect(dates.length, "no start and no expiry were bound").toBeGreaterThanOrEqual(2);

    const [startedAt, expiresAt] = [...dates].sort((a, b) => a.getTime() - b.getTime());
    expect(expiresAt.getTime() - startedAt.getTime()).toBe(IMPERSONATION_MINUTES * 60_000);
  });

  it("inserts and hands the row back — its id is what the callback demands", async () => {
    const row = [["imp-1", "operator-1", "member-9", new Date(), new Date()]];
    state.rows = row;

    await openImpersonation({ operatorId: "operator-1", memberId: "member-9" });

    const sql = only();
    expect(sql).toContain("insert into");
    expect(sql, "nothing is returned, so the caller has no record id").toContain("returning");
  });
});

describe("closeAbandonedImpersonations — the ending nobody is there to see", () => {
  it("🚨 closes only rows that are open AND past their cap", async () => {
    // Both halves. Without `ended_at is null` the job re-closes what an
    // operator already ended — and `docs/cron.md` requires every job to be safe
    // to run twice. Without the expiry it would close running sessions.
    await closeAbandonedImpersonations();

    const sql = only();
    expect(sql, "the already-ended rows are not excluded").toContain('"ended_at" is null');
    expect(sql, "the expiry condition is gone").toMatch(/"expires_at"\s*</);
  });

  it("🚨 labels them `abandoned`, not `expired`", async () => {
    // Two different sentences to the person reading the record page. `expired`
    // is what an operator sees when they come back after the cap; `abandoned`
    // is nobody came back at all — and `docs/data-protection.md` promises that
    // distinction to the member whose account it was.
    await closeAbandonedImpersonations();

    expect(captured[0].params, "the reason is not `abandoned`").toContain("abandoned");
    expect(captured[0].params).not.toContain("expired");
  });

  it("returns how many it closed, for the job's one line of numbers", async () => {
    state.rows = [["a"], ["b"], ["c"]];
    await expect(closeAbandonedImpersonations()).resolves.toBe(3);

    state.rows = [];
    await expect(closeAbandonedImpersonations()).resolves.toBe(0);
  });
});

describe("pruneImpersonations — the retention window is not a number to trust", () => {
  it("🚨 deletes NOTHING for a window under one month", async () => {
    // The sharpest guard in this file, and its comment says why: a retention
    // window is a number a person edits, `Number(null)` is 0, and zero months
    // of retention means delete everything. This deletes the answer to "did
    // somebody go into my account last spring".
    for (const bad of [0, -1, 0.5]) {
      captured.length = 0;
      await expect(pruneImpersonations(bad), `months=${bad}`).resolves.toBe(0);
      expect(captured, `months=${bad} still sent a statement`).toEqual([]);
    }
  });

  it("🚨 deletes nothing for a value that is not a finite number", async () => {
    for (const bad of [NaN, Infinity, -Infinity, undefined as unknown as number]) {
      captured.length = 0;
      await expect(pruneImpersonations(bad)).resolves.toBe(0);
      expect(captured, `${String(bad)} still sent a statement`).toEqual([]);
    }
  });

  it("deletes by a cutoff that really is `months` back", async () => {
    state.rows = [["a"], ["b"]];
    await expect(pruneImpersonations(12)).resolves.toBe(2);

    const sql = only();
    expect(sql).toContain("delete from");
    expect(sql, "it prunes by the wrong column").toMatch(/"started_at"\s*</);

    const [cutoff] = instants();
    expect(cutoff, "no cutoff was bound").toBeDefined();
    const monthsBack =
      (new Date().getFullYear() - cutoff.getFullYear()) * 12 +
      (new Date().getMonth() - cutoff.getMonth());
    expect(monthsBack).toBe(12);
  });
});

describe("listImpersonations — the record survives a deleted operator", () => {
  it("🚨 joins the two accounts with LEFT joins, never inner ones", async () => {
    // `impersonations.operatorId` is `set null` on delete. An inner join would
    // make every record of a departed operator vanish from the page — the trail
    // erasing itself exactly when somebody asks who it was.
    await listImpersonations();

    const sql = only();
    const inner = sql.split("left join").length - 1;
    expect(inner, "expected two left joins — operator and member").toBe(2);
    expect(sql, "an inner join drops records whose operator was deleted").not.toMatch(
      /(?<!left )\binner join\b/,
    );
  });

  it("shows the newest first, and takes a limit", async () => {
    await listImpersonations(50);

    const sql = only();
    expect(sql).toContain("order by");
    expect(sql).toContain("desc");
    expect(sql).toContain("limit");
    expect(captured[0].params).toContain(50);
  });

  it("selects real columns only — no raw SQL wearing a Date's type", async () => {
    // `db/sql-cast.test.ts` exists because a `sql<Date>` has no mapper: the
    // driver's string arrives typed as a `Date` and the page renders a Postgres
    // timestamp verbatim, with a clean 200.
    await listImpersonations();
    expect(only()).not.toMatch(/::|to_char|date_trunc/);
  });
});
