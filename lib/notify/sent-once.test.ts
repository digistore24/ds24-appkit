// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The marker, in two halves: the grammar it refuses, and the statement it sends.
//
// The statement matters because `on conflict do nothing` IS the mechanism. A
// version that read the table first and inserted after would return the right
// value in every case a mock could set up, and would send twice on the one tick
// where two processes woke up together — which is the tick the whole thing
// exists for. So the driver is `drizzle-orm/pg-proxy` and what is asserted is
// the SQL (`modules/courses/lib/manage.test.ts` is the pattern and the
// reasoning).
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

import { NotifyError } from "./errors";
import { SEND_KEY_MAX, claimSend } from "./sent-once";

const { __captured: captured, __state: state } = dbModule as unknown as {
  __captured: Captured[];
  __state: { rows: unknown[][] };
};

const NOW = new Date("2026-08-09T04:00:00.000Z");

beforeEach(() => {
  captured.length = 0;
  state.rows = [];
});

describe("claiming the right to send", () => {
  it("🚨 is one insert that loses on conflict", async () => {
    state.rows = [["courses-digest:2026-08-09"]];
    const first = await claimSend("courses-digest:2026-08-09", NOW);

    expect(captured, "claimSend() sent no statement at all").toHaveLength(1);
    expect(first).toBe(true);
    expect(captured[0].sql).toContain('insert into "notification_sends"');
    expect(captured[0].sql).toMatch(/on conflict do nothing/);
    expect(captured[0].sql).toMatch(/returning/);
    expect(captured[0].params).toContain("courses-digest:2026-08-09");
  });

  it("the second claim on the same key gets nothing back, and says so", async () => {
    // The driver returning no rows IS what a lost race looks like: the row was
    // already there, `do nothing` did nothing, `returning` returned nothing.
    state.rows = [];
    await expect(claimSend("courses-digest:2026-08-09", NOW)).resolves.toBe(false);
  });

  it("writes the tick's clock, not its own", async () => {
    state.rows = [["k"]];
    await claimSend("a-job:2026-08-09", NOW);
    // Drizzle's timestamp mapper hands the driver an ISO string, which is what
    // Postgres would receive — asserting the Date object would be asserting a
    // step that never happens.
    expect(captured[0].params).toContain(NOW.toISOString());
  });
});

describe("the key grammar", () => {
  const REFUSED: [string, string][] = [
    ["", "empty"],
    [" ", "a space"],
    ["courses-digest:", "a dangling segment"],
    ["a@b.de", "🚨 an address"],
    ["Digest 2026", "a sentence"],
    ["x".repeat(SEND_KEY_MAX + 1), "one character too long"],
  ];

  for (const [key, why] of REFUSED) {
    it(`refuses ${why}`, async () => {
      await expect(claimSend(key, NOW)).rejects.toBeInstanceOf(NotifyError);
      // 🚨 Before the query, not after. A refused key must never reach the
      // database — that is the difference between a rule and a log line.
      expect(captured, `${JSON.stringify(key)} reached the database`).toHaveLength(0);
    });
  }

  it("refuses with a code, so a caller can tell it from a transport failure", async () => {
    await expect(claimSend("a@b.de", NOW)).rejects.toMatchObject({ code: "badSendKey" });
  });

  it("accepts the shape a job actually uses", async () => {
    state.rows = [["courses-digest:2026-08-09"]];
    await expect(claimSend("courses-digest:2026-08-09", NOW)).resolves.toBe(true);
  });

  it("accepts a key of exactly the maximum length", async () => {
    // The other side of the boundary. Only the refusal at MAX + 1 was measured,
    // so a later `>=` would have passed every test in this file while quietly
    // moving the limit by one — the classic direction for an off-by-one to
    // hide in.
    const key = "a".repeat(SEND_KEY_MAX);
    expect(key).toHaveLength(SEND_KEY_MAX);
    state.rows = [[key]];
    await expect(claimSend(key, NOW)).resolves.toBe(true);
  });

  it("the refusal names no key back — it is a message that may reach cron_runs", async () => {
    // Cron rule 2. The key is the caller's own label today, but the caller is
    // the half that can be got wrong, and echoing a rejected value is how a
    // rejected address ends up in the table that must not hold one.
    await expect(claimSend("a@b.de", NOW)).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("@b.de") }),
    );
  });
});
