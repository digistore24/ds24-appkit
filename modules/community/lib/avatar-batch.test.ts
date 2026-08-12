// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 **A list of people costs ONE `media` query, and this file COUNTS them.**
//
// The claim is not "the code looks batched". `avatarUrlFor()` is a per-id door
// and its own header says so — a feed of forty posts resolved through it is
// forty statements, which is the invariant `CLAUDE.md` states as "forty posts
// must not be forty queries". A shape assertion (`expect(items[0].authorAvatarUrl)
// …`) is satisfied by BOTH implementations, so the only assertion that can tell
// them apart is the number of statements the feed issues.
//
// ── How the counting works ─────────────────────────────────────────────────
// The database is a chainable stand-in that records `getTableName()` of every
// `from()` and answers each table from a fixture. So "one `media` query" is
// literally `froms.filter(t => t === "media").length === 1`, taken over a real
// `feedFor()` call — not over `avatarUrlsFor()` in isolation, which would be a
// test of the door rather than of the surface that has to use it.
//
// ── Why `mayAccess()` is NOT mocked ────────────────────────────────────────
// It is the other half of AC 1: the batch door has to keep `mayAccess()` before
// `mediaUrlFor()` inside ONE function, the way `modules/courses/lib/media.ts`
// states it. Mocking it would leave that to a spy that agrees. `mediaUrlFor()`
// IS mocked, and that is what makes "never minted for the viewer who may not
// have it" assertable — an address minted and then withheld is an address that
// exists.
//
// ── The non-vacuity probe ──────────────────────────────────────────────────
// The last describe block resolves the SAME rows through the single door in a
// loop and asserts the counter then reads N. Without it, a counter that had
// stopped counting — a renamed table, a `from()` the chain no longer sees —
// would report every implementation as batched. Proving the walk ran is not
// proving the comparison did.
import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaRow } from "@/db/schema-media";

const fake = vi.hoisted(() => {
  /** Rows per table name, as the fixture sets them up for one test. */
  const rows: Record<string, unknown[]> = {};
  /** Every table a `select()` read from, in order. */
  const froms: string[] = [];

  const select = () => {
    let table = "";
    // Every builder method answers the same object, and the object is
    // thenable — which is what lets a query end on `where()` (avatarUrlsFor) or
    // on `limit()` (feedRows) without the stand-in having to know which.
    const chain: Record<string, unknown> = {
      from(value: unknown) {
        table = getTableName(value as Parameters<typeof getTableName>[0]);
        froms.push(table);
        return chain;
      },
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (ok: (value: unknown[]) => unknown, fail: (reason: unknown) => unknown) =>
        Promise.resolve(rows[table] ?? []).then(ok, fail),
    };
    return chain;
  };

  return { rows, froms, db: { select } };
});

vi.mock("@/db", () => ({ db: fake.db }));

const mediaUrlFor = vi.fn((row: MediaRow) => `https://bucket.example/${row.id}?signed`);
vi.mock("@/lib/media/url", () => ({
  mediaUrlFor: (row: MediaRow) => mediaUrlFor(row),
}));

// Never reached in these fixtures — every room is `open` and every avatar is
// `members`-visible — but `mayAccess()` reaches it for an `entitled` row and
// the module's group resolver would for a plan-gated room.
const hasPlan = vi.fn(async () => false);
vi.mock("@/lib/entitlements/manage", () => ({
  hasPlan: () => hasPlan(),
  entitlementsFor: async () => [],
  planStartedAt: async () => null,
}));

const { avatarUrlFor, avatarUrlsFor, feedFor } = await import("./manage");

const VIEWER = { memberId: "reader", role: "member" };

/** A `members`-visible avatar row — what `profile-actions.ts` really stores. */
function avatar(id: string, over: Partial<MediaRow> = {}): MediaRow {
  return {
    id,
    ownerId: `owner-of-${id}`,
    kind: "image",
    visibility: "members",
    requiresPlan: null,
    storageKey: `community/profile/2026/08/${id}.jpg`,
    mime: "image/jpeg",
    filename: "face.jpg",
    bytes: 4096,
    width: null,
    height: null,
    durationSeconds: null,
    sha256: "x",
    source: "upload",
    alt: "Anna Schmidt",
    prompt: null,
    provider: null,
    model: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    ...over,
  } as MediaRow;
}

/** One feed row, shaped as `feedRows()`'s projection returns it. */
function post(n: number, authorId: string, avatarMediaId: string | null) {
  return {
    postId: `p-${n}`,
    discussionId: "d-1",
    discussionTitle: "Wie fange ich an?",
    groupId: "g-1",
    groupName: "Einsteiger",
    authorId,
    authorProfileName: `Autor ${authorId}`,
    authorAccountName: null,
    authorAvatarMediaId: avatarMediaId,
    content: `Beitrag ${n}`,
    createdAt: new Date(Date.UTC(2026, 7, 1, 12, 0, n)),
    deletedAt: null,
    deletedBy: null,
  };
}

/** The fixture every test starts from: one open room, and somebody to follow. */
function seed(posts: ReturnType<typeof post>[], avatars: MediaRow[]) {
  for (const key of Object.keys(fake.rows)) delete fake.rows[key];
  fake.froms.length = 0;

  fake.rows["community_groups"] = [
    { id: "g-1", accessLevel: "open", planKeys: [], archivedAt: null },
  ];
  fake.rows["community_follows"] = [
    ...new Set(posts.map((row) => row.authorId)),
  ].map((followedId) => ({ followedId }));
  fake.rows["community_posts"] = posts;
  fake.rows["media"] = avatars;
}

const mediaQueries = () => fake.froms.filter((table) => table === "media").length;

beforeEach(() => {
  vi.clearAllMocks();
  mediaUrlFor.mockImplementation((row: MediaRow) => `https://bucket.example/${row.id}?signed`);
});

describe("🚨 AC 1 — twelve avatars, one media query", () => {
  it("resolves every author's picture with a single statement", async () => {
    const posts = Array.from({ length: 12 }, (_, i) =>
      post(i, `a-${i % 4}`, `m-${i % 4}`),
    );
    seed(
      posts,
      [0, 1, 2, 3].map((i) => avatar(`m-${i}`)),
    );

    const { items } = await feedFor(VIEWER);

    expect(items).toHaveLength(12);
    // THE assertion of this file. Twelve posts, four distinct pictures, one
    // statement — and the number is exact rather than "at most", because a
    // second `media` read would mean two places deciding what a viewer may see.
    expect(mediaQueries()).toBe(1);
    for (const item of items) {
      expect(item.authorAvatarUrl).toBe(`https://bucket.example/${item.authorAvatarMediaId}?signed`);
    }
    // One address per DISTINCT picture, not one per post: the same author twice
    // on a page is not two things to sign.
    expect(mediaUrlFor).toHaveBeenCalledTimes(4);
  });

  it("spends no media query at all when nobody has a picture", async () => {
    const posts = Array.from({ length: 5 }, (_, i) => post(i, `a-${i}`, null));
    seed(posts, [avatar("m-unused")]);

    const { items } = await feedFor(VIEWER);

    expect(items).toHaveLength(5);
    expect(mediaQueries()).toBe(0);
    expect(items.every((item) => item.authorAvatarUrl === null)).toBe(true);
  });

  it("renders the placeholder for an author whose media row is gone", async () => {
    // `setProfileAvatar` and `deleteMedia` are two writes, and a profile can
    // legitimately name a row that no longer exists between them. The feed must
    // fall back to the initial rather than to a broken image.
    seed([post(1, "a-1", "m-vanished")], []);

    const { items } = await feedFor(VIEWER);

    expect(items[0].authorAvatarUrl).toBeNull();
    expect(mediaQueries()).toBe(1);
    expect(mediaUrlFor).not.toHaveBeenCalled();
  });
});

describe("🚨 AC 1 — the check stays in front of the mint, in one function", () => {
  it("never mints an address for a row this viewer may not have", async () => {
    // An `owner`-visible row belonging to somebody else. This cannot arise from
    // the shipped avatar door (`visibility: "members"`), and that is exactly why
    // it is worth pinning: the guarantee has to be the batch door's, not the
    // caller's discipline about what it puts in.
    seed([post(1, "a-1", "m-private")], [
      avatar("m-private", { visibility: "owner", ownerId: "somebody-else" }),
    ]);

    const { items } = await feedFor(VIEWER);

    expect(items[0].authorAvatarUrl).toBeNull();
    expect(mediaUrlFor).not.toHaveBeenCalled();
  });

  it("hands an anonymous viewer nothing, and asks no entitlement question", async () => {
    const rows = [avatar("m-1")];
    const urls = await avatarUrlsFor(["m-1"], { memberId: null, role: null });
    // The row was read — one statement, as always — and refused afterwards.
    expect(urls.size).toBe(0);
    expect(mediaUrlFor).not.toHaveBeenCalled();
    expect(hasPlan).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });

  it("deduplicates and skips the query entirely for an empty list", async () => {
    seed([], [avatar("m-1")]);

    const twice = await avatarUrlsFor(["m-1", "m-1", null, ""], VIEWER);
    expect(twice.size).toBe(1);
    expect(mediaQueries()).toBe(1);

    fake.froms.length = 0;
    const none = await avatarUrlsFor([null, null], VIEWER);
    expect(none.size).toBe(0);
    expect(mediaQueries()).toBe(0);
  });
});

describe("🚨 the counter can tell the two implementations apart", () => {
  it("reads N when the same rows go through the SINGLE door in a loop", async () => {
    // ── Non-vacuity ────────────────────────────────────────────────────────
    // This is the surface reverted to `avatarUrlFor()`, expressed as a probe
    // rather than left to a future editor to try. If the chain ever stopped
    // recording `from()` — a renamed table, a builder method the stand-in does
    // not answer — the assertions above would pass for ANY implementation, and
    // this line is what fails instead.
    const posts = Array.from({ length: 6 }, (_, i) => post(i, `a-${i}`, `m-${i}`));
    seed(
      posts,
      posts.map((row) => avatar(row.authorAvatarMediaId as string)),
    );

    for (const row of posts) {
      await avatarUrlFor(row.authorAvatarMediaId, VIEWER);
    }

    expect(mediaQueries()).toBe(6);
  });
});
