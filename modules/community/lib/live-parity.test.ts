// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The twin of `unread-parity.test.ts`, for the live channel's window.
//
// AD-70 says unread arithmetic and live arithmetic are ONE comparison in one
// pure-core function. `compareCursor()` is that function — and it cannot be
// called from inside a Postgres `WHERE`, so `liveAnswerFor()` restates it as a
// predicate over columns. A restatement is exactly the thing that drifts:
// somebody makes the tuple comparison inclusive because a post seemed to be
// missed, every test stays green, and the shipped predicate goes on doing the
// old thing because it is a query.
//
// `createdHalf()` and `changedHalf()` below are the two shipped predicates
// transcribed into JS, and each is run over the same matrix as the pure
// comparison. If one changes and the other does not, this file fails and names
// the case.
//
// ⚠️ **The second half is the one worth staring at.** A window over creation
// order ALONE answers an old post's deletion by omission — the row simply stops
// being sent, and a viewer with the tab open goes on reading words the database
// no longer shows anybody. The `deletedAt`/`editedAt` disjunct is what AD-70
// means by "deletions, removals and locks ride the same answer as row-state,
// never by omission", and a matrix that only exercised new posts would pass
// without it.
//
// ⚠️ **And the second half is why there are two POSITIONS, which is the third
// describe block in this file.** Until 2026-08-06 both halves were one `OR`
// over one position ordered by `created_at`, and there was no test over the
// advance loop at all — so a channel that stops for ever after fifty
// tombstones shipped, and three review layers had to find it by reading. The
// arithmetic was pinned; the LOOP around it was not. It is now.
import { describe, expect, it } from "vitest";

import { LIVE_POSTS_PER_ANSWER, changedAt } from "./manage";
import { advanceCursor, compareCursor, type Cursor, type LiveCursor } from "./rules";

/** A post, as much of one as the two predicates look at. */
interface Row {
  createdAt: Date;
  id: string;
  deletedAt: Date | null;
  editedAt: Date | null;
}

/**
 * Half (a) of the shipped `WHERE`, transcribed.
 *
 *   created_at > :at
 *   or (created_at = :at and id > :id)
 *
 * Nothing but the tuple comparison — this half is ordered by `created_at`, and
 * a state disjunct hiding in it is precisely what used to starve it.
 */
function createdHalf(row: Row, position: Cursor): boolean {
  const at = position.at.getTime();
  if (row.createdAt.getTime() > at) return true;
  if (row.createdAt.getTime() === at && row.id > position.id) return true;
  return false;
}

/**
 * Half (b) of the shipped `WHERE`, transcribed.
 *
 *   greatest(coalesce(deleted_at, 'epoch'), coalesce(edited_at, 'epoch')) > :at
 *   or (that same expression = :at and id > :id)
 *
 * The key is `CHANGED_AT` in `manage.ts`, and its JS twin is `changedAt()` —
 * imported rather than re-derived here, because two transcriptions of one
 * expression is the drift this file exists to catch, not something to add more
 * of. `coalesce(…, 'epoch')` is what makes an untouched row key at the epoch
 * instead of dropping out of a `GREATEST` that ignores NULLs.
 */
function changedHalf(row: Row, position: Cursor): boolean {
  const key = changedAt(row).getTime();
  const at = position.at.getTime();
  if (key > at) return true;
  if (key === at && row.id > position.id) return true;
  return false;
}

/** The pure half: is this row's own creation coordinate past the position? */
function pureSemantics(row: Row, position: Cursor): boolean {
  return compareCursor({ at: row.createdAt, id: row.id }, position) > 0;
}

/** The pure half, keyed the way half (b) orders. */
function pureChangeSemantics(row: Row, position: Cursor): boolean {
  return compareCursor({ at: changedAt(row), id: row.id }, position) > 0;
}

const T0 = new Date("2026-08-01T10:00:00.000Z");
const T1 = new Date("2026-08-01T10:00:00.001Z");
const T2 = new Date("2026-08-02T09:00:00.000Z");
const MOMENTS = [T0, T1, T2];
const IDS = ["a", "m", "z"];

describe("the creation half and compareCursor() are the same comparison", () => {
  it("agrees for every (row, cursor) pair the tuple can express", () => {
    const disagreements: string[] = [];

    for (const createdAt of MOMENTS) {
      for (const id of IDS) {
        for (const at of MOMENTS) {
          for (const cursorId of IDS) {
            const row: Row = { createdAt, id, deletedAt: null, editedAt: null };
            const cursor: Cursor = { at, id: cursorId };
            const sqlSaid = createdHalf(row, cursor);
            const pureSaid = pureSemantics(row, cursor);
            if (sqlSaid !== pureSaid) {
              disagreements.push(
                `row(${createdAt.toISOString()}, ${id}) vs cursor(${at.toISOString()}, ${cursorId}): ` +
                  `SQL says ${sqlSaid}, compareCursor says ${pureSaid}`,
              );
            }
          }
        }
      }
    }

    expect(
      disagreements,
      "the live window's SQL and the module's one comparison have drifted. " +
        "AD-70: unread arithmetic and live arithmetic are one comparison.",
    ).toEqual([]);
  });

  it("excludes the cursor's own row — a window is exclusive at its start", () => {
    // The row a client last received must not come back on every poll.
    const row: Row = { createdAt: T1, id: "m", deletedAt: null, editedAt: null };
    expect(createdHalf(row, { at: T1, id: "m" })).toBe(false);
    expect(pureSemantics(row, { at: T1, id: "m" })).toBe(false);
  });

  it("still separates two posts that share a millisecond", () => {
    // Real under load, and the reason the cursor is a tuple rather than a
    // timestamp: without the id half, one of these two would be lost for ever.
    const cursor: Cursor = { at: T1, id: "m" };
    expect(createdHalf({ createdAt: T1, id: "z", deletedAt: null, editedAt: null }, cursor)).toBe(true);
    expect(createdHalf({ createdAt: T1, id: "a", deletedAt: null, editedAt: null }, cursor)).toBe(false);
  });

  it("ignores a deletion entirely — that is the OTHER half's row to deliver", () => {
    // The half-(a)-only property, asserted rather than assumed: the moment a
    // state disjunct creeps back into this predicate, the half ordered by
    // `created_at` starts carrying old rows again and the starvation below
    // returns with it.
    const row: Row = { createdAt: T0, id: "a", deletedAt: T2, editedAt: T2 };
    expect(createdHalf(row, { at: T1, id: "m" })).toBe(false);
  });
});

describe("the change half and compareCursor() are the same comparison", () => {
  // The same matrix, keyed by `changedAt()` instead of `createdAt`. Every
  // combination of "never touched", "deleted", "edited" and "both" is walked,
  // because `GREATEST` over two nullable columns is where a transcription
  // quietly stops matching: JS would compare `null` where Postgres yields NULL,
  // and `coalesce(…, 'epoch')` is the reason neither side has to.
  const STATES: { label: string; deletedAt: Date | null; editedAt: Date | null }[] = [
    { label: "untouched", deletedAt: null, editedAt: null },
    { label: "deleted @T0", deletedAt: T0, editedAt: null },
    { label: "edited @T2", deletedAt: null, editedAt: T2 },
    { label: "deleted @T2, edited @T0", deletedAt: T2, editedAt: T0 },
    { label: "deleted @T0, edited @T2", deletedAt: T0, editedAt: T2 },
  ];

  it("agrees for every (row state, cursor) pair the tuple can express", () => {
    const disagreements: string[] = [];

    for (const state of STATES) {
      for (const id of IDS) {
        for (const at of MOMENTS) {
          for (const cursorId of IDS) {
            const row: Row = {
              createdAt: T0,
              id,
              deletedAt: state.deletedAt,
              editedAt: state.editedAt,
            };
            const position: Cursor = { at, id: cursorId };
            const sqlSaid = changedHalf(row, position);
            const pureSaid = pureChangeSemantics(row, position);
            if (sqlSaid !== pureSaid) {
              disagreements.push(
                `row(${state.label}, ${id}) vs cursor(${at.toISOString()}, ${cursorId}): ` +
                  `SQL says ${sqlSaid}, compareCursor says ${pureSaid}`,
              );
            }
          }
        }
      }
    }

    expect(
      disagreements,
      "the change half's SQL and the module's one comparison have drifted. " +
        "AD-70: what grew is the number of POSITIONS, never the number of " +
        "comparisons.",
    ).toEqual([]);
  });

  it("keys a row on the LATER of its two state columns", () => {
    // `GREATEST`, not "whichever is set": a post edited in the morning and
    // removed in the afternoon has to ride the answer for the removal, and a
    // key taken from the edit would sit behind a cursor that already delivered
    // it.
    expect(changedAt({ deletedAt: T2, editedAt: T0 }).getTime()).toBe(T2.getTime());
    expect(changedAt({ deletedAt: T0, editedAt: T2 }).getTime()).toBe(T2.getTime());
  });

  it("keys an untouched row at the epoch, the way coalesce does", () => {
    // The transcription's null handling, stated where it can be read. `'epoch'`
    // is before every real cursor, so an untouched row is never delivered by
    // this half — and never removed from the answer either, because half (a)
    // is what carries it.
    expect(changedAt({ deletedAt: null, editedAt: null }).getTime()).toBe(0);
    expect(
      changedHalf(
        { createdAt: T0, id: "a", deletedAt: null, editedAt: null },
        { at: T1, id: "m" },
      ),
    ).toBe(false);
  });

  it("separates two rows that changed in the same millisecond", () => {
    // The tie-break half (b) grew when it got its own position. Without it, two
    // posts tombstoned by one `UPDATE` — which is exactly what an account
    // deletion does — would be indistinguishable to a cursor that may only move
    // forward, and one of them would be lost.
    const position: Cursor = { at: T2, id: "m" };
    const later: Row = { createdAt: T0, id: "z", deletedAt: T2, editedAt: null };
    const earlier: Row = { createdAt: T0, id: "a", deletedAt: T2, editedAt: null };
    expect(changedHalf(later, position)).toBe(true);
    expect(changedHalf(earlier, position)).toBe(false);
  });
});

describe("the state half — what would otherwise arrive by omission", () => {
  const cursor: Cursor = { at: T1, id: "m" };

  it("delivers an OLD post that was deleted after the cursor", () => {
    const row: Row = { createdAt: T0, id: "a", deletedAt: T2, editedAt: null };
    expect(pureSemantics(row, cursor), "its own coordinate is behind the cursor").toBe(false);
    expect(
      changedHalf(row, cursor),
      "a post deleted since the cursor must RIDE the answer as row-state. " +
        "Without this disjunct the viewer keeps reading words the database " +
        "no longer shows anybody.",
    ).toBe(true);
  });

  it("delivers an OLD post that was edited after the cursor", () => {
    const row: Row = { createdAt: T0, id: "a", deletedAt: null, editedAt: T2 };
    expect(changedHalf(row, cursor)).toBe(true);
  });

  it("leaves an old, untouched post alone", () => {
    const row: Row = { createdAt: T0, id: "a", deletedAt: null, editedAt: null };
    expect(changedHalf(row, cursor)).toBe(false);
    expect(createdHalf(row, cursor)).toBe(false);
  });

  it("leaves a post deleted BEFORE the cursor alone", () => {
    // The client already received that state; redelivering it for ever is the
    // cost this bound exists to keep small.
    const row: Row = { createdAt: T0, id: "a", deletedAt: T0, editedAt: null };
    expect(changedHalf(row, cursor)).toBe(false);
  });

  it("treats NULL as 'not', the way Postgres does", () => {
    // `column > value` is NULL — not true — when the column is NULL, and
    // `coalesce(…, 'epoch')` turns that into a row that keys before everything.
    // A transcription that compared `null` in JS would answer differently,
    // which is exactly the drift this file exists to catch.
    const row: Row = { createdAt: T0, id: "a", deletedAt: null, editedAt: null };
    expect(changedHalf(row, { at: T0, id: "a" })).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The advance loop — the half of the channel that had no test at all
// ───────────────────────────────────────────────────────────────────────────

/**
 * The shipped answer, transcribed: two bounded queries, two positions.
 *
 * `liveAnswerFor()` runs half (a) ordered by `(created_at, id)` and half (b)
 * ordered by `(GREATEST(deleted_at, edited_at), id)`, caps each at
 * `LIVE_POSTS_PER_ANSWER`, merges by id, and advances each position over the
 * rows ITS OWN half delivered. That is what this function does, over an array
 * instead of a table — the limit and the constant are the shipped ones, so a
 * page size somebody tunes is exercised rather than guessed at.
 */
function liveWindow(
  rows: readonly Row[],
  cursor: LiveCursor,
): { posts: Row[]; cursor: LiveCursor } {
  const createdRows = rows
    .filter((row) => createdHalf(row, cursor.created))
    .sort((a, b) =>
      compareCursor({ at: a.createdAt, id: a.id }, { at: b.createdAt, id: b.id }),
    )
    .slice(0, LIVE_POSTS_PER_ANSWER);

  const changedRows = rows
    .filter((row) => changedHalf(row, cursor.changed))
    .sort((a, b) =>
      compareCursor({ at: changedAt(a), id: a.id }, { at: changedAt(b), id: b.id }),
    )
    .slice(0, LIVE_POSTS_PER_ANSWER);

  const byId = new Map<string, Row>();
  for (const row of [...createdRows, ...changedRows]) byId.set(row.id, row);

  return {
    posts: [...byId.values()],
    cursor: {
      created: advanceCursor(
        cursor.created,
        createdRows.map((row) => ({ at: row.createdAt, id: row.id })),
      ),
      changed: advanceCursor(
        cursor.changed,
        changedRows.map((row) => ({ at: changedAt(row), id: row.id })),
      ),
    },
  };
}

/**
 * The window as it was SHIPPED until 2026-08-06 — kept executable so the
 * defect below is measured rather than described.
 *
 * One position, one `OR` of both halves, ordered by `created_at`, capped at the
 * same limit, and advanced over whatever came back. Nothing about it looks
 * wrong until the rows half (b) matches are older than the rows half (a) would
 * have carried — and then they sort first, fill the limit, and cannot move a
 * position that may only go forward.
 */
function theOldSinglePositionWindow(
  rows: readonly Row[],
  cursor: Cursor,
): { posts: Row[]; cursor: Cursor } {
  const matched = rows
    .filter((row) => createdHalf(row, cursor) || changedHalf(row, cursor))
    .sort((a, b) =>
      compareCursor({ at: a.createdAt, id: a.id }, { at: b.createdAt, id: b.id }),
    )
    .slice(0, LIVE_POSTS_PER_ANSWER);

  return {
    posts: matched,
    cursor: advanceCursor(
      cursor,
      matched.map((row) => ({ at: row.createdAt, id: row.id })),
    ),
  };
}

describe("the cursor advance loop — the channel that used to stop for ever", () => {
  // ⚠️ **This is the test whose absence let the defect ship.** Every predicate
  // above was pinned; nothing asked what happens to the POSITION after an
  // answer, and that is where a live channel dies.
  //
  // The scene is one a real app reaches in one statement:
  // `scrubCommunityContentFor()` sets `deletedAt` on EVERY live post of a
  // departing member at once, so a thread they were active in acquires more
  // than `LIVE_POSTS_PER_ANSWER` rows that are old by creation and new by
  // change. Then somebody posts.
  const CURSOR_AT = new Date("2026-08-01T12:00:00.000Z");
  const SCRUB_AT = new Date("2026-08-01T12:05:00.000Z");
  const NEW_POST_AT = new Date("2026-08-01T12:06:00.000Z");

  /** One tombstone per post of a departing member: written long ago, deleted just now. */
  const TOMBSTONES: Row[] = Array.from(
    { length: LIVE_POSTS_PER_ANSWER + 10 },
    (_unused, index) => ({
      // Well before the cursor: these are last month's posts.
      createdAt: new Date(CURSOR_AT.getTime() - 30 * 24 * 60 * 60 * 1000 + index),
      id: `old-${String(index).padStart(4, "0")}`,
      deletedAt: SCRUB_AT,
      editedAt: null,
    }),
  );

  const FRESH: Row = {
    createdAt: NEW_POST_AT,
    id: "new-0001",
    deletedAt: null,
    editedAt: null,
  };

  const ROWS: Row[] = [...TOMBSTONES, FRESH];
  const START: LiveCursor = {
    created: { at: CURSOR_AT, id: "cursor" },
    changed: { at: CURSOR_AT, id: "cursor" },
  };

  it("delivers the new post and MOVES the created position past it", () => {
    const answer = liveWindow(ROWS, START);

    expect(
      answer.posts.map((row) => row.id),
      "the post written after the erasure has to reach an open tab",
    ).toContain(FRESH.id);
    expect(
      compareCursor(answer.cursor.created, START.created),
      "the created position stood still, so the next poll asks the same " +
        "question and the same tombstones come back for ever",
    ).toBeGreaterThan(0);
  });

  it("stops redelivering what it has already sent, poll after poll", () => {
    // The window has to DRAIN. Three polls with nothing new happening in
    // between must end with an empty answer — the property the old shape could
    // not have, because its position never got past the tombstones.
    let cursor = START;
    let last: Row[] = [];
    for (let poll = 0; poll < 3; poll += 1) {
      const answer = liveWindow(ROWS, cursor);
      cursor = answer.cursor;
      last = answer.posts;
    }
    expect(last, "the channel is still repeating itself after three polls").toEqual([]);
  });

  it("advances the two positions independently, on their own halves", () => {
    // A created position moved by a half (b) row would step over undelivered
    // posts; a changed position moved by a half (a) row would step over
    // undelivered tombstones. Each is measured against the key its own half
    // orders by.
    const answer = liveWindow(ROWS, START);
    expect(answer.cursor.created.at.getTime()).toBe(NEW_POST_AT.getTime());
    expect(answer.cursor.changed.at.getTime()).toBe(SCRUB_AT.getTime());
  });

  it("was BROKEN under the single-position window — this is what shipped", () => {
    // ⚠️ Why the test above is red against the old logic, executed rather than
    // asserted in prose: with one position ordered by `created_at`, the
    // tombstones sort FIRST (created last month), fill the limit of
    // `LIVE_POSTS_PER_ANSWER` on their own, and leave the fresh post outside
    // entirely. And none of them can advance the cursor, because every one of
    // them was created BEFORE it and the position may only move forward. So the
    // next poll asks the identical question, gets the identical rows, and the
    // channel is stopped — not degraded, stopped, with a reload re-wedging on
    // its first poll.
    const before: Cursor = { at: CURSOR_AT, id: "cursor" };
    const answer = theOldSinglePositionWindow(ROWS, before);

    expect(answer.posts.map((row) => row.id)).not.toContain(FRESH.id);
    expect(answer.cursor).toEqual(before);

    // And it stays stopped: the second poll is the first one again.
    const second = theOldSinglePositionWindow(ROWS, answer.cursor);
    expect(second.cursor).toEqual(before);
    expect(second.posts.map((row) => row.id)).toEqual(
      answer.posts.map((row) => row.id),
    );
  });

  it("carries an erasure's tombstones too, over the polls it takes", () => {
    // The other half of the repair, and the reason "just advance on half (a)"
    // was rejected: moving the created position past rows half (b) has not
    // delivered means those deletions never arrive at all. More tombstones
    // than one answer may carry is two polls, and every one of them lands.
    let cursor = START;
    const seen = new Set<string>();
    for (let poll = 0; poll < 3; poll += 1) {
      const answer = liveWindow(ROWS, cursor);
      cursor = answer.cursor;
      for (const row of answer.posts) seen.add(row.id);
    }
    for (const row of TOMBSTONES) {
      expect(seen.has(row.id), `${row.id} was never delivered`).toBe(true);
    }
  });
});
