// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// **The one lazy creator, and the three things about it that are decisions.**
//
// AD-62 permits exactly one materialization of an embedded discussion row, and
// it happens inside the transaction that writes the first post. This file is
// the `deletion.test.ts` technique applied to it: `ensureEmbeddedDiscussion()`
// takes its transaction as an argument, so a fake one records exactly what
// would have been written without a database being involved.
//
// What is pinned here, and why each one is easy to lose:
//
//   1. **An undeclared key writes NOTHING.** The provenance check is what
//      keeps `community_discussions` from being a table a signed-in member can
//      grow with keys of their own choosing. A version that refused after the
//      insert would look identical in every test that only reads the return
//      value.
//
//   2. **`createdBy` and `title` are NULL.** ⚠️ Measured against the live
//      database, `UPDATE community_discussions SET title = ''` on a row
//      carrying a Subject Key is REFUSED by the check constraint
//      `community_discussions_title_shape` — and that update is exactly what
//      `scrubCommunityContentFor()` runs over every thread a departing
//      member started. So an embedded row that ever acquired an author would
//      make that member's ERASURE REQUEST fail, months later, on a row holding
//      no personal data at all. NULL here is not tidiness; it is what keeps a
//      GDPR deletion from throwing.
//
//   3. **The conflict target carries the partial index's predicate.** Without
//      it Postgres cannot infer which index `ON CONFLICT` means and refuses the
//      statement outright — a runtime-only failure that typechecks perfectly,
//      and the one that would strike the second member ever to post under a
//      key rather than the first.
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/media/manage", () => ({ findMedia: vi.fn(), mayAccess: vi.fn() }));
vi.mock("@/lib/media/url", () => ({ mediaUrlFor: vi.fn() }));
vi.mock("@/lib/entitlements/manage", () => ({ hasPlan: vi.fn(async () => false) }));
vi.mock("@/modules/community/lib/embeds", () => ({ findEmbed: vi.fn() }));

import { ensureEmbeddedDiscussion } from "./manage";
import { findEmbed } from "./embeds";
import { CommunityError } from "./rules";

const DECLARED = {
  subjectKey: "course:birth-prep:unit-3",
  accessLevel: "open" as const,
  planKeys: [],
};

const dialect = new PgDialect();

interface RecordedInsert {
  values: Record<string, unknown>;
  /** The rendered `ON CONFLICT … WHERE …` predicate, or `null` if none. */
  conflictWhere: string | null;
  conflictTarget: unknown;
}

/**
 * A transaction that writes nothing and remembers everything.
 *
 * `returns` decides what the insert's `RETURNING` hands back — `[]` is the
 * conflict case, which is the branch the re-select exists for.
 */
function fakeTx(returns: Array<{ id: string }>, existing: Array<{ id: string }>) {
  const inserts: RecordedInsert[] = [];
  let selected = 0;

  const tx = {
    insert() {
      const record: RecordedInsert = {
        values: {},
        conflictWhere: null,
        conflictTarget: undefined,
      };
      const chain = {
        values(values: Record<string, unknown>) {
          record.values = values;
          return chain;
        },
        onConflictDoNothing(config: { target?: unknown; where?: unknown }) {
          record.conflictTarget = config.target;
          record.conflictWhere = config.where
            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
              dialect.sqlToQuery(config.where as any).sql
            : null;
          return chain;
        },
        returning() {
          inserts.push(record);
          return Promise.resolve(returns);
        },
      };
      return chain;
    },
    select() {
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: () => {
          selected += 1;
          return Promise.resolve(existing);
        },
      };
      return chain;
    },
  };

  return { tx, inserts, selects: () => selected };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("an undeclared Subject Key", () => {
  it("creates nothing at all", async () => {
    vi.mocked(findEmbed).mockReturnValue(null);
    const { tx, inserts } = fakeTx([{ id: "d1" }], []);

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ensureEmbeddedDiscussion(tx as any, "course:invented:unit-9", new Date()),
    ).rejects.toThrow(CommunityError);

    expect(
      inserts,
      "a key nobody declared reached the INSERT. The registry is the " +
        "provenance — refusing after the write makes this table one a " +
        "signed-in member can grow with keys of their own choosing.",
    ).toEqual([]);
  });

  it("refuses with the same code an unentitled member gets", async () => {
    vi.mocked(findEmbed).mockReturnValue(null);
    const { tx } = fakeTx([{ id: "d1" }], []);
    await expect(
      ensureEmbeddedDiscussion(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tx as any,
        "course:invented:unit-9",
        new Date(),
      ),
    ).rejects.toMatchObject({ code: "communityNotEntitled" });
  });
});

describe("the row it writes", () => {
  it("carries no author and no title", async () => {
    vi.mocked(findEmbed).mockReturnValue(DECLARED);
    const now = new Date("2026-08-06T10:00:00Z");
    const { tx, inserts } = fakeTx([{ id: "d1" }], []);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ensureEmbeddedDiscussion(tx as any, DECLARED.subjectKey, now);

    expect(inserts).toHaveLength(1);
    expect(
      inserts[0].values,
      "an embedded row with an author would make an ERASURE REQUEST fail: " +
        "scrubCommunityContentFor() sets title = '' on every thread that " +
        "member started, and the check constraint refuses that on a row " +
        "carrying a Subject Key. Read this file's header before changing it.",
    ).toEqual({
      subjectKey: DECLARED.subjectKey,
      groupId: null,
      title: null,
      createdBy: null,
      lastActivityAt: now,
      createdAt: now,
    });
  });

  it("names the partial index's own predicate as the conflict target", async () => {
    vi.mocked(findEmbed).mockReturnValue(DECLARED);
    const { tx, inserts } = fakeTx([{ id: "d1" }], []);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ensureEmbeddedDiscussion(tx as any, DECLARED.subjectKey, new Date());

    expect(inserts[0].conflictTarget).toBeDefined();
    expect(
      inserts[0].conflictWhere,
      "the unique index on subject_key is PARTIAL. Without the same " +
        "predicate on the conflict target, Postgres cannot infer the index " +
        "and refuses the statement — at runtime, for the second member ever " +
        "to post under a key.",
    ).toMatch(/subject_key.*is not null/);
  });
});

describe("two first-posters racing", () => {
  it("reads the row back when the insert conflicted", async () => {
    vi.mocked(findEmbed).mockReturnValue(DECLARED);
    // The loser of the race: RETURNING is empty because nothing was inserted.
    const { tx, inserts, selects } = fakeTx([], [{ id: "written-by-the-winner" }]);

    const row = await ensureEmbeddedDiscussion(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tx as any,
      DECLARED.subjectKey,
      new Date(),
    );

    expect(inserts).toHaveLength(1);
    expect(selects(), "a conflict returns nothing — the re-select is the other half of the answer").toBe(1);
    expect(row).toEqual({ id: "written-by-the-winner" });
  });

  it("does not read back when it inserted the row itself", async () => {
    vi.mocked(findEmbed).mockReturnValue(DECLARED);
    const { tx, selects } = fakeTx([{ id: "mine" }], []);

    const row = await ensureEmbeddedDiscussion(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tx as any,
      DECLARED.subjectKey,
      new Date(),
    );

    expect(row).toEqual({ id: "mine" });
    expect(selects(), "the winner already has the id — a second query would be one per first post").toBe(0);
  });
});
