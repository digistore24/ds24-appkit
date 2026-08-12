// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// AD-70 says unread arithmetic is "one comparison in one pure-core function".
// It is one DEFINITION; it cannot be one call site, and this file is the
// difference between those two being a design and being a hope.
//
// ⚠️ **`hasUnread()` has no production caller, and that is not a bug to fix by
// wiring it in.** A pure function cannot be invoked from inside a Postgres
// `WHERE`, and the three unread reads (`unreadFor`, `unreadByDiscussion`,
// `unreadByGroup`) must do their comparison in the database — filtering in JS
// would mean fetching every discussion in every reachable room on the busiest
// path in the app. So the SQL restates the arithmetic, and a restatement is
// exactly the thing that drifts: somebody tightens the equality case in
// `hasUnread()` because a dot would not clear, every test stays green, and the
// nav indicator goes on doing the old thing because its predicate is a string.
//
// What CAN be checked is that the two agree. `sqlSemantics()` below is the SQL
// predicate transcribed into JS, and every case is run through both. If the
// pure function changes and the shipped SQL does not, this file fails and names
// the case.
//
// The tie-break is deliberately absent from the list reads and present in
// `acknowledgeRead()`: a discussion row carries `lastActivityAt` with no post
// id beside it, so the list paths have nothing to break a tie WITH, while the
// marker write compares the full `(created_at, id)` tuple and is advance-only.
// That asymmetry is the thing this file pins hardest, because it looks like an
// oversight and is a decision.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";

import { compareCursor, hasUnread } from "./rules";

/**
 * The shipped SQL predicate, transcribed.
 *
 * All three reads use the identical clause:
 *
 *   read_markers.member_id is null
 *   or discussions.last_activity_at > read_markers.last_read_created_at
 *
 * `member_id is null` is the LEFT JOIN finding no marker. There is no id on
 * either side of the `>` — that is the whole point of the transcription.
 */
function sqlSemantics(
  lastActivityAt: Date,
  marker: { lastReadCreatedAt: Date } | null,
): boolean {
  if (marker === null) return true;
  return lastActivityAt.getTime() > marker.lastReadCreatedAt.getTime();
}

const T0 = new Date("2026-08-01T10:00:00.000Z");
const T1 = new Date("2026-08-01T10:00:00.001Z");
const T2 = new Date("2026-08-02T09:00:00.000Z");

describe("the pure comparison and the shipped SQL agree", () => {
  const moments = [T0, T1, T2];

  it("answers the same for every activity/marker pair the SQL can express", () => {
    const disagreements: string[] = [];

    for (const activity of moments) {
      // No marker at all.
      const pureNoMarker = hasUnread({ at: activity }, null);
      const sqlNoMarker = sqlSemantics(activity, null);
      if (pureNoMarker !== sqlNoMarker) {
        disagreements.push(`no marker @${activity.toISOString()}`);
      }

      for (const read of moments) {
        // The nav shape: activity with NO id, which is what a discussion row
        // gives you. This is the only shape the SQL can be asked about.
        const pure = hasUnread({ at: activity }, { at: read, id: "any" });
        const sql = sqlSemantics(activity, { lastReadCreatedAt: read });
        if (pure !== sql) {
          disagreements.push(
            `${activity.toISOString()} vs ${read.toISOString()}: ` +
              `pure=${pure} sql=${sql}`,
          );
        }
      }
    }

    expect(
      disagreements,
      "hasUnread() and the SQL in unreadFor/unreadByDiscussion/unreadByGroup " +
        "have drifted. Change both or neither — a member told something is new " +
        "on one page and read on another is a bug nobody can reproduce",
    ).toEqual([]);
  });

  it("counts an exactly-equal timestamp as READ, on both sides", () => {
    // The case the asymmetry exists for, asserted explicitly rather than left
    // to the matrix above: `lastActivityAt` is written from the same `now` as
    // the post it records, so equality overwhelmingly means "you have read
    // exactly this". Answering "unread" would leave a dot that never clears.
    expect(hasUnread({ at: T1 }, { at: T1, id: "post-1" })).toBe(false);
    expect(sqlSemantics(T1, { lastReadCreatedAt: T1 })).toBe(false);
  });

  it("still breaks a tie by id when an id IS available", () => {
    // Where the tuple is usable it is used — `acknowledgeRead()`'s advance-only
    // clause is the production consumer, comparing (created_at, id) as a row.
    // This is the half the list reads cannot have, not a half nobody wants.
    expect(hasUnread({ at: T1, id: "b" }, { at: T1, id: "a" })).toBe(true);
    expect(hasUnread({ at: T1, id: "a" }, { at: T1, id: "b" })).toBe(false);
    expect(compareCursor({ at: T1, id: "b" }, { at: T1, id: "a" })).toBeGreaterThan(0);
  });

  it("orders by timestamp before id, the way a Postgres row comparison does", () => {
    // `(a.at, a.id) < (b.at, b.id)` in SQL and this function have to be the
    // same comparison — `acknowledgeRead()`'s setWhere depends on it exactly.
    // A string tie-break is what Postgres does for `text`.
    expect(compareCursor({ at: T0, id: "z" }, { at: T1, id: "a" })).toBeLessThan(0);
    expect(compareCursor({ at: T1, id: "a" }, { at: T1, id: "a" })).toBe(0);
  });
});

// ── the FOURTH read: direct messages, which DO have an id ──────────────────
//
// 🚨 This block exists because the file above did not cover it, and the reason
// it did not is worth more than the coverage. The asymmetry pinned above — "the
// list paths have nothing to break a tie WITH" — is true of a discussion row and
// FALSE of a message row: `unreadMessagesFor()` joins `community_messages`, and
// the id sits in the row it is already reading. The file nevertheless read as
// though it covered all four unread reads, so the fourth one carried a plain `>`
// under a justification that was never about it.

/**
 * `unreadMessagesFor()`'s shipped predicate, transcribed.
 *
 *   read_markers.member_id is null
 *   or messages.created_at  >  read_markers.last_read_created_at
 *   or (messages.created_at =  read_markers.last_read_created_at
 *       and messages.id     >  read_markers.last_read_id)
 */
function dmSqlSemantics(
  message: { createdAt: Date; id: string },
  marker: { lastReadCreatedAt: Date; lastReadId: string } | null,
): boolean {
  if (marker === null) return true;
  const byTime = message.createdAt.getTime() - marker.lastReadCreatedAt.getTime();
  if (byTime !== 0) return byTime > 0;
  return message.id > marker.lastReadId;
}

describe("the DM unread read and the pure comparison agree", () => {
  const moments = [T0, T1, T2];
  const ids = ["msg-a", "msg-b"];

  it("answers the same for every message/marker pair, id included", () => {
    const disagreements: string[] = [];

    for (const at of moments) {
      for (const id of ids) {
        const pureNoMarker = hasUnread({ at, id }, null);
        const sqlNoMarker = dmSqlSemantics({ createdAt: at, id }, null);
        if (pureNoMarker !== sqlNoMarker) disagreements.push(`no marker @${id}`);

        for (const readAt of moments) {
          for (const readId of ids) {
            const pure = hasUnread({ at, id }, { at: readAt, id: readId });
            const sql = dmSqlSemantics(
              { createdAt: at, id },
              { lastReadCreatedAt: readAt, lastReadId: readId },
            );
            if (pure !== sql) {
              disagreements.push(
                `${at.toISOString()}/${id} vs ${readAt.toISOString()}/${readId}: ` +
                  `pure=${pure} sql=${sql}`,
              );
            }
          }
        }
      }
    }

    expect(
      disagreements,
      "hasUnread() and the SQL in unreadMessagesFor() have drifted. The DM read " +
        "is the one unread query that HAS an id on both sides — it compares the " +
        "full (created_at, id) tuple, and it must keep agreeing with the " +
        "definition:\n" + disagreements.join("\n"),
    ).toEqual([]);
  });

  it("🚨 counts the marker's OWN message as read, which is the whole defect", () => {
    // Measured before `precision: 3`: the message carried microseconds
    // (`.107735`, from `defaultNow()`), the marker carried the millisecond
    // truncation of that same instant (`.107`, because it had been through a JS
    // `Date`), and a plain `>` therefore answered "unread" about a marker naming
    // that very message — for ever, for every member with any private message.
    //
    // Both columns are `precision: 3` now, so this case is EQUALITY, and the
    // tie-break is what makes equality mean "read" rather than "compare
    // nothing". Asserted on both sides, because either half alone is a defect:
    // no tie-break and equality can never clear a second message inside the
    // same millisecond; no precision and equality is unreachable.
    const own = { createdAt: T1, id: "msg-a" };
    expect(hasUnread({ at: own.createdAt, id: own.id }, { at: T1, id: "msg-a" })).toBe(false);
    expect(
      dmSqlSemantics(own, { lastReadCreatedAt: T1, lastReadId: "msg-a" }),
    ).toBe(false);

    // And the message after it, inside the same millisecond, is still unread.
    expect(
      dmSqlSemantics({ createdAt: T1, id: "msg-b" }, { lastReadCreatedAt: T1, lastReadId: "msg-a" }),
    ).toBe(true);
  });
});

// ── the resolution rule, which no JS test can express as a value ───────────

describe("🚨 the resolution rule: a compared timestamp column holds milliseconds", () => {
  // ⚠️ **This has to be a SCHEMA assertion, not a value assertion.** A JS `Date`
  // cannot represent a sub-millisecond instant, so no fixture in this file can
  // express the state that broke the DM read — the two sides of every comparison
  // here are `Date`s and therefore trivially comparable. What can be checked is
  // that the columns cannot hold what their readers cannot carry.
  //
  // The rule: a timestamp column compared in SQL against a value that has been
  // through a JS `Date` — a read marker, a live cursor token
  // (`String(at.getTime())`) — declares `precision: 3`. Postgres' default is
  // microseconds, and `defaultNow()` fills them.
  const source = blankComments(
    readFileSync(new URL("../schema.ts", import.meta.url), "utf8"),
  );

  /** The named table's slice of the schema, comments already blanked. */
  const tableSlice = (table: string): string => {
    const at = source.indexOf(`"${table}"`);
    expect(at, `${table} is not declared in this schema any more`).toBeGreaterThan(-1);
    const next = source.indexOf("\nexport const ", at);
    return source.slice(at, next === -1 ? undefined : next);
  };

  // Every column that is one side of an unread comparison or of the live
  // cursor's tuple. Each entry says which comparison puts it here.
  const COMPARED: Array<[table: string, column: string, why: string]> = [
    ["community_messages", "created_at", "unreadMessagesFor() and the live cursor's created half"],
    ["community_messages", "deleted_at", "the live cursor's changed half"],
    ["community_posts", "created_at", "the live cursor's created half"],
    ["community_posts", "edited_at", "the live cursor's changed half"],
    ["community_posts", "deleted_at", "the live cursor's changed half"],
    ["community_discussions", "last_activity_at", "unreadFor/unreadByDiscussion/unreadByGroup"],
    ["community_read_markers", "last_read_created_at", "the right-hand side of all four unread reads"],
  ];

  for (const [table, column, why] of COMPARED) {
    it(`${table}.${column} declares precision 3 — ${why}`, () => {
      const slice = tableSlice(table);
      const at = slice.indexOf(`timestamp("${column}"`);
      expect(at, `${table}.${column} is no longer a timestamp column`).toBeGreaterThan(-1);
      // The options object of THIS declaration: from the column name to the
      // closing brace of the literal that follows it.
      const options = slice.slice(at, slice.indexOf("}", at) + 1);
      expect(
        options,
        `${table}.${column} is compared against a millisecond value (${why}) and ` +
          `does not declare precision: 3. Postgres would stamp microseconds, the ` +
          `comparison would read them as a newer instant than the marker naming ` +
          `that very row, and the indicator would never clear. See ` +
          `community_messages.createdAt in schema.ts for the measured case.`,
      ).toContain("precision: 3");
    });
  }

  it("read the schema rather than an empty string", () => {
    // The probe this repo puts under every text scanner: without it the loop
    // above passes on a file it failed to open.
    expect(source).toContain('pgTable(\n  "community_messages"');
    expect(source.length).toBeGreaterThan(10_000);
    // And the comments really are blanked — the prose in schema.ts explains this
    // rule at length, so a scanner that read comments would pass on the
    // explanation instead of on the declaration.
    expect(source).not.toContain("MILLISECONDS, and it is load-bearing");
  });
});
