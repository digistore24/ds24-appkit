// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What leaves with a member, and what stays behind as structure.
//
// There is no database in this test suite by decision (`docs`/project rules:
// the guarantees live in `lib/`, pages are checked by loading them), so this
// file does not prove the SQL runs — `make deploy-test` and the local pass do
// that. What it DOES prove is the decision the SQL encodes, and it can only do
// so because `scrubCommunityContentFor()` takes its transaction as an
// argument: a fake one records exactly what would have been written.
//
// The decision under test is small and easy to get wrong in a way nothing
// would notice:
//
//   A member's posts are tombstoned when their account goes — the ROW stays so
//   the replies under it still make sense, the WORDS go. But a post that a
//   MODERATOR already removed must keep `deleted_by = "moderator"`. One UPDATE
//   over every post of the member would overwrite it with `"system"` and erase
//   the record of a moderation decision, months later, from an unrelated act.
//   The screen would then say "this post is from a deleted account" where it
//   used to say "removed by moderation".
//
// ⚠️ **The WHERE clause is rendered, not merely counted.** This file used to
// record `hasWhere: condition !== undefined` and assert positionally — which
// meant swapping the two predicates (putting `isNotNull(deletedAt)` on the
// statement that writes `"system"`) relabelled every moderator removal as a
// system deletion and left every live post visible with its content blanked,
// and all four tests went on passing. `and(...)` never returns `undefined`, so
// the boolean was true for a WHERE scoped to the wrong column entirely. The
// predicate is the only thing that matters here, so the predicate is what gets
// asserted.
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { scrubCommunityContentFor } from "./manage";

/** Renders a Drizzle condition to SQL text. No connection involved. */
const dialect = new PgDialect();
function renderWhere(condition: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return dialect.sqlToQuery(condition as any).sql;
}

/** One `update(...).set(...).where(...)` the code would have executed. */
interface RecordedUpdate {
  table: string;
  values: Record<string, unknown>;
  where: string;
}

/**
 * A transaction that writes nothing and remembers everything.
 *
 * Drizzle's builder is a thenable chain, so the stub has to be one too: the
 * production code `await`s the result of `.where(...)`.
 */
function fakeTx() {
  const updates: RecordedUpdate[] = [];
  return {
    updates,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update(table: any) {
      const recorded: RecordedUpdate = {
        // The table name as Drizzle knows it — so "which table" is asserted
        // rather than assumed from the order the statements happen to run in.
        table: String(
          table?.[Symbol.for("drizzle:Name")] ?? table?._?.name ?? "unknown",
        ),
        values: {},
        where: "",
      };
      const chain = {
        set(values: Record<string, unknown>) {
          recorded.values = values;
          return chain;
        },
        where(condition: unknown) {
          recorded.where = renderWhere(condition);
          updates.push(recorded);
          return Promise.resolve([]);
        },
      };
      return chain;
    },
  };
}

async function scrub() {
  const tx = fakeTx();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await scrubCommunityContentFor(tx as any, "member-1");
  return tx.updates;
}

/** The one statement per content table that writes the tombstone on still-live rows. */
function liveStatement(updates: RecordedUpdate[], table: string) {
  const found = updates.filter(
    (u) =>
      u.table === table &&
      u.values.deletedBy === "system" &&
      u.where.includes("is null"),
  );
  expect(
    found,
    `exactly one statement may set deletedBy = 'system' on ${table}, and it ` +
      "must be the one scoped to rows that carry no deletion event yet",
  ).toHaveLength(1);
  return found[0];
}

/**
 * The two tables a member's own words live in.
 *
 * ⚠️ **Written as a list, and every assertion below loops over it.** The
 * realistic failure of this story is not a wrong statement — it is a THIRD
 * content table added in a year whose scrub nobody writes. A test shaped as
 * "posts do this, and separately messages do this" would pass over that table
 * in silence; a loop makes adding it here the obvious next line.
 */
const CONTENT_TABLES = ["community_posts", "community_messages"];

describe("scrubCommunityContentFor", () => {
  it("writes in scoped statements, never one over everything", async () => {
    const updates = await scrub();

    expect(
      updates,
      "one statement over every post of the member would relabel a moderator's " +
        "removal as a system deletion",
    ).toHaveLength(7);

    for (const update of updates) {
      // Every statement names the departing member. An UPDATE that did not
      // would blank the whole table — and the previous `hasWhere` boolean
      // could not tell the two apart.
      expect(update.where, update.table).toMatch(
        /"author_id"|"created_by"|"target_member_id"|"reporter_id"/,
      );
      expect(update.where, update.table).toContain("$1");
    }
  });

  it("takes the words out of every table the member wrote in", async () => {
    const updates = await scrub();

    for (const table of CONTENT_TABLES) {
      const rows = updates.filter((u) => u.table === table);
      expect(rows, `${table}: two scoped statements`).toHaveLength(2);
      for (const update of rows) {
        expect(update.values.content, `${table}: the words are what has to go`).toBe(
          "",
        );
      }
    }
  });

  it("writes the tombstone ONLY on rows that were still live", async () => {
    const updates = await scrub();

    for (const table of CONTENT_TABLES) {
      const live = liveStatement(updates, table);

      // Still live: this account deletion IS the deletion event.
      expect(live.values.deletedAt, table).toBeInstanceOf(Date);
      // …and the predicate says so, in the SQL rather than in a comment. This
      // is the assertion that catches the swap: with the two clauses exchanged
      // this statement would read `is not null` and the test would fail here.
      expect(live.where, table).toContain('"deleted_at" is null');
      expect(live.where, table).not.toContain("is not null");
    }
  });

  it("leaves an existing deletion event exactly as it was", async () => {
    const updates = await scrub();

    for (const table of CONTENT_TABLES) {
      const alreadyDeleted = updates.filter(
        (u) => u.table === table && u.where.includes("is not null"),
      );
      expect(alreadyDeleted, table).toHaveLength(1);
      const [update] = alreadyDeleted;

      // A row a moderator removed keeps that fact — the record of a moderation
      // decision is not something an unrelated account deletion may rewrite.
      expect(update.values.deletedBy, table).toBeUndefined();
      expect(update.values.deletedAt, table).toBeUndefined();
      expect(update.values.content, table).toBe("");
      // And the reason they wrote about this member goes with the words.
      expect(update.values.removedReason, table).toBeNull();
    }
  });

  it("covers every table that holds this member's own words", async () => {
    // Non-vacuity with teeth: the tables touched are exactly the ones this
    // module knows a member writes into, plus the discussion titles. A new
    // content table shows up here as a failure rather than as silence.
    const updates = await scrub();
    const tables = [...new Set(updates.map((u) => u.table))].sort();
    expect(tables).toEqual([
      "community_discussions",
      "community_messages",
      "community_moderation_audit",
      "community_posts",
      "community_spam_reports",
    ]);
  });

  it("scrubs the TITLES of threads the member started", async () => {
    const updates = await scrub();

    const discussions = updates.filter(
      (u) => u.table === "community_discussions",
    );
    expect(
      discussions,
      "a discussion title is the starter's own words. The FK sets created_by " +
        "to NULL, so without this statement the sentence they wrote survives " +
        "their erasure request for ever, de-attributed rather than deleted",
    ).toHaveLength(1);

    const [update] = discussions;
    expect(update.values.title).toBe("");
    expect(update.where).toContain('"created_by"');
    // Scoped to this member's threads, not to every thread in the app.
    expect(update.where).toContain("$1");
  });

  it("never touches the row itself — the tombstone has to outlive the account", async () => {
    // A post is one turn in a conversation other people are still having, so
    // the row stays and the FK sets `author_id` to NULL on its own. If this
    // ever becomes a DELETE, every reply to that post answers nothing.
    const tx = fakeTx();
    const withDelete = {
      ...tx,
      // The fake's own `updates` array is shared by reference, so this really
      // is the same recorder — the point is that `delete` is REACHABLE here
      // and still not called.
      delete: () => expect.unreachable("must not delete"),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await scrubCommunityContentFor(withDelete as any, "member-1");
    expect(tx.updates).toHaveLength(7);
  });
});

describe("the moderation trail keeps the act and loses the sentence", () => {
  it("empties the reason written ABOUT this member, and nothing else", async () => {
    const updates = await scrub();
    const audit = updates.filter(
      (u) => u.table === "community_moderation_audit",
    );
    expect(audit).toHaveLength(1);
    const [update] = audit;

    // The sentence goes…
    expect(update.values.reason).toBeNull();
    // …and nothing else does. Who acted, what they did and when is the record
    // of a moderation decision, and it survives the person it was about — a
    // trail that emptied itself on an erasure request would be a trail with a
    // way to erase yourself from it.
    expect(Object.keys(update.values)).toEqual(["reason"]);
    // Scoped to rows where this member is the TARGET: a reason on a row they
    // wrote as an ACTOR is about somebody else and stays.
    expect(update.where).toContain('"target_member_id"');
    expect(update.where).not.toContain('"actor_id"');
  });
});
