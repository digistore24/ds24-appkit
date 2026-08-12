// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 **A page of posts costs ONE attachment query, and this file COUNTS them.**
//
// The same claim `avatar-batch.test.ts` makes about faces, made about pictures,
// and it is the reason `community_post_media` is a TABLE rather than an
// `integer[]` on the post row: an array of media ids cannot be joined, so fifty
// posts would have been fifty `findMedia()` calls. A shape assertion
// (`expect(rows[0].images[0].src)…`) is satisfied by both implementations, so the
// only assertion that can tell them apart is the number of statements.
//
// ── How the counting works ─────────────────────────────────────────────────
// The database is the chainable stand-in `avatar-batch.test.ts` uses, with two
// additions this file needs: `offset()` (the paginated read ends on it) and a
// COUNT mode — `postsFor()` issues `select({ value: count() })`, and a stand-in
// that answered that with the row fixture would report a total of `undefined`.
//
// The counter is reads of `community_post_media` rather than of `media`, because
// that is the table the batch statement starts `from()`: `media` arrives through
// an inner join, so counting it would count nothing and report every
// implementation as batched. This is exactly the trap
// `avatar-batch.test.ts`'s own header names, one table along.
//
// ── Why `mayAccess()` is NOT mocked ────────────────────────────────────────
// It is half of what the batch door promises: `mayAccess()` before
// `mediaImageFor()`, in ONE function, so no renderer can do the second half
// without the first. Mocking it would leave that to a spy that agrees.
// `mediaImageFor()` IS mocked, which is what makes "never minted for a viewer who
// may not have it" assertable — an address minted and then withheld is an address
// that exists.
//
// ── The non-vacuity probe ──────────────────────────────────────────────────
// The last describe block resolves the SAME posts one at a time and asserts the
// counter then reads N. Without it, a counter that had stopped counting — a
// renamed table, a builder method the chain no longer answers — would report any
// implementation as batched. Proving the walk ran is not proving the comparison
// did.
import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaRow } from "@/db/schema-media";

const fake = vi.hoisted(() => {
  const rows: Record<string, unknown[]> = {};
  const froms: string[] = [];

  const select = (selection?: unknown) => {
    // `postsFor()` asks for `{ value: count() }` before it asks for rows. Without
    // this branch the count answers the ROW fixture, `[0]?.value` is undefined,
    // and the function reports a thread of nought posts — which would make every
    // assertion below run over an empty page.
    const counting =
      selection !== null &&
      typeof selection === "object" &&
      Object.hasOwn(selection as object, "value");

    let table = "";
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
      offset: () => chain,
      then: (ok: (value: unknown[]) => unknown, fail: (reason: unknown) => unknown) => {
        const answer = counting
          ? [{ value: (rows[table] ?? []).length }]
          : (rows[table] ?? []);
        return Promise.resolve(answer).then(ok, fail);
      },
    };
    return chain;
  };

  return { rows, froms, db: { select } };
});

vi.mock("@/db", () => ({ db: fake.db }));

const mediaImageFor = vi.fn((row: MediaRow) => ({
  src: `https://bucket.example/${row.id}?signed`,
  srcSet: `https://bucket.example/${row.id}-w480?signed 480w`,
  width: row.width,
  height: row.height,
}));
vi.mock("@/lib/media/url", () => ({
  mediaImageFor: (row: MediaRow) => mediaImageFor(row),
  mediaUrlFor: (row: MediaRow) => `https://bucket.example/${row.id}?signed`,
}));

// Never reached in these fixtures — every picture is `members`-visible — but
// `mayAccess()` reaches it for an `entitled` row, and one assertion below proves
// it is not reached for an anonymous viewer.
const hasPlan = vi.fn(async () => false);
vi.mock("@/lib/entitlements/manage", () => ({
  hasPlan: () => hasPlan(),
  entitlementsFor: async () => [],
  planStartedAt: async () => null,
}));

const { POST_IMAGE_SLOT, postImagesFor, postsFor } = await import("./manage");
const { mayAccess } = await import("@/lib/media/manage");

const VIEWER = { memberId: "reader", role: "member" };

/** A `members`-visible post picture — what `POST_IMAGE_SLOT` really stores. */
function picture(id: string, over: Partial<MediaRow> = {}): MediaRow {
  return {
    id,
    ownerId: "author-1",
    kind: "image",
    visibility: "members",
    requiresPlan: null,
    storageKey: `community/post/2026/08/${id}.jpg`,
    mime: "image/jpeg",
    filename: "shelf.jpg",
    bytes: 204_800,
    width: 1600,
    height: 900,
    variants: [480, 960],
    durationSeconds: null,
    sha256: "x",
    source: "upload",
    alt: "Mein fertiges Regal",
    prompt: null,
    provider: null,
    model: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    ...over,
  } as MediaRow;
}

/** One post row, as `postsFor()`'s projection returns it. */
function post(n: number, over: Partial<Record<string, unknown>> = {}) {
  return {
    post: {
      id: `p-${n}`,
      discussionId: "d-1",
      authorId: "author-1",
      content: `Beitrag ${n}`,
      createdAt: new Date(Date.UTC(2026, 7, 1, 12, 0, n)),
      editedAt: null,
      deletedAt: null,
      deletedBy: null,
      removedReason: null,
      ...over,
    },
    profileName: "Anna",
    accountName: null,
  };
}

/** One attachment row, as the batch statement's projection returns it. */
function attachment(postId: string, position: number, media: MediaRow) {
  return { postId, position, media };
}

function seed(posts: unknown[], attachments: unknown[]) {
  for (const key of Object.keys(fake.rows)) delete fake.rows[key];
  fake.froms.length = 0;
  fake.rows["community_posts"] = posts;
  fake.rows["community_post_media"] = attachments;
}

const attachmentQueries = () =>
  fake.froms.filter((table) => table === "community_post_media").length;

beforeEach(() => {
  vi.clearAllMocks();
  mediaImageFor.mockImplementation((row: MediaRow) => ({
    src: `https://bucket.example/${row.id}?signed`,
    srcSet: `https://bucket.example/${row.id}-w480?signed 480w`,
    width: row.width,
    height: row.height,
  }));
});

describe("🚨 AC 5 — a page of posts costs one attachment query", () => {
  it("resolves every picture on twelve posts with a single statement", async () => {
    const posts = Array.from({ length: 12 }, (_, i) => post(i));
    seed(posts, [
      attachment("p-0", 0, picture("m-a")),
      attachment("p-0", 1, picture("m-b")),
      attachment("p-3", 0, picture("m-c")),
      attachment("p-7", 0, picture("m-d")),
    ]);

    const { rows } = await postsFor("d-1", 1, VIEWER);

    expect(rows).toHaveLength(12);
    // THE assertion of this file. Twelve posts, four pictures, one statement —
    // exact rather than "at most", because a second read would be a second place
    // deciding what a viewer may see.
    expect(attachmentQueries()).toBe(1);
    expect(rows.find((row) => row.id === "p-0")?.images.map((i) => i.mediaId)).toEqual([
      "m-a",
      "m-b",
    ]);
    expect(rows.find((row) => row.id === "p-3")?.images).toHaveLength(1);
    expect(rows.find((row) => row.id === "p-1")?.images).toEqual([]);
    // One mint per picture, and the address is the door's rather than a caller's.
    expect(mediaImageFor).toHaveBeenCalledTimes(4);
    expect(rows.find((row) => row.id === "p-3")?.images[0]).toEqual({
      mediaId: "m-c",
      src: "https://bucket.example/m-c?signed",
      srcSet: "https://bucket.example/m-c-w480?signed 480w",
      width: 1600,
      height: 900,
      alt: "Mein fertiges Regal",
    });
  });

  it("keeps the order the statement delivered, which is the order the member chose", async () => {
    // ⚠️ **What this can and cannot prove.** The stand-in answers rows in fixture
    // order, so this asserts the GROUPING preserves arrival order — the half that
    // lives in this function. That the arrival order is `position` is the `order
    // by` in the statement, which only a real database can demonstrate; the module
    // deploy profile is where that runs, and `(post_id, position)` being the
    // primary key is what makes the ordering total.
    seed([post(0)], [
      attachment("p-0", 0, picture("m-first")),
      attachment("p-0", 1, picture("m-second")),
      attachment("p-0", 2, picture("m-third")),
    ]);

    const { rows } = await postsFor("d-1", 1, VIEWER);

    expect(rows[0].images.map((image) => image.mediaId)).toEqual([
      "m-first",
      "m-second",
      "m-third",
    ]);
  });

  it("asks nothing at all when every post on the page is a tombstone", async () => {
    // A page of hidden posts has nothing to resolve — and the statement is not
    // merely filtered afterwards, it is not issued. Which is the same property
    // that makes the blanking unnecessary: there is no address to forget to
    // remove, because none was minted.
    seed(
      [
        post(0, { deletedAt: new Date("2026-08-02T00:00:00Z"), deletedBy: "author" }),
        post(1, { deletedAt: new Date("2026-08-02T00:00:00Z"), deletedBy: "moderator" }),
      ],
      [attachment("p-0", 0, picture("m-a"))],
    );

    const { rows } = await postsFor("d-1", 1, VIEWER);

    expect(attachmentQueries()).toBe(0);
    expect(mediaImageFor).not.toHaveBeenCalled();
    expect(rows.every((row) => row.images.length === 0)).toBe(true);
  });

  it("🚨 a hidden post's pictures never travel, even beside a visible one", async () => {
    // The mixed page, which is the one that actually happens: a moderator removes
    // one post in a live thread. The removed post's words are blanked and its
    // pictures must go the same way — an address left on it is a picture still
    // fetchable out of the page's own payload, which is the disclosure the
    // blanking of `content` exists to prevent.
    //
    // 🚨 **This assertion found a real weakness in the first version of the
    // code.** The stand-in ignores `where`, so the statement here answers the
    // removed post's attachment too — and the function grouped it under `p-1` and
    // handed it out, because the only thing keeping it away was the `inArray` of
    // visible ids. That is a guarantee living in a filter rather than in the
    // function, which a later edit to the id list takes away in silence. So
    // `postsFor()` now blanks the list the same way it blanks `content`, and the
    // `where` clause is what makes it cheap rather than what makes it correct.
    seed(
      [
        post(0),
        post(1, { deletedAt: new Date("2026-08-02T00:00:00Z"), deletedBy: "moderator" }),
      ],
      [
        attachment("p-0", 0, picture("m-visible")),
        attachment("p-1", 0, picture("m-removed")),
      ],
    );

    const { rows } = await postsFor("d-1", 1, VIEWER);

    expect(rows.find((row) => row.id === "p-0")?.images.map((i) => i.mediaId)).toEqual([
      "m-visible",
    ]);
    expect(rows.find((row) => row.id === "p-1")?.images).toEqual([]);
    expect(rows.find((row) => row.id === "p-1")?.content).toBe("");
  });
});

describe("🚨 AC 5 — the check stays in front of the mint, in one function", () => {
  it("never mints an address for a row this viewer may not have", async () => {
    // An `owner`-visible row belonging to somebody else. The shipped door stores
    // `members`, which is exactly why this is worth pinning: the guarantee has to
    // be the batch door's, not the caller's discipline about what it puts in.
    seed([], [
      attachment("p-1", 0, picture("m-private", { visibility: "owner", ownerId: "somebody-else" })),
      attachment("p-1", 1, picture("m-shared")),
    ]);

    const images = await postImagesFor(["p-1"], VIEWER);

    // The refused row is absent and the one beside it is not — a refusal per row,
    // never per statement.
    expect(images.get("p-1")?.map((image) => image.mediaId)).toEqual(["m-shared"]);
    expect(mediaImageFor).toHaveBeenCalledTimes(1);
    expect(mediaImageFor.mock.calls[0][0].id).toBe("m-shared");
  });

  it("hands an anonymous viewer nothing, and asks no entitlement question", async () => {
    seed([], [attachment("p-1", 0, picture("m-a"))]);

    const images = await postImagesFor(["p-1"], { memberId: null, role: null });

    // The row was read — one statement, as always — and refused afterwards.
    expect(attachmentQueries()).toBe(1);
    expect(images.size).toBe(0);
    expect(mediaImageFor).not.toHaveBeenCalled();
    expect(hasPlan).not.toHaveBeenCalled();
  });

  it("deduplicates and skips the statement entirely for an empty list", async () => {
    seed([], [attachment("p-1", 0, picture("m-a"))]);

    const twice = await postImagesFor(["p-1", "p-1", ""], VIEWER);
    expect(twice.size).toBe(1);
    expect(attachmentQueries()).toBe(1);

    fake.froms.length = 0;
    const none = await postImagesFor([], VIEWER);
    expect(none.size).toBe(0);
    expect(attachmentQueries()).toBe(0);
  });
});

describe("🚨 AC 5 — the visibility a post image is stored with is the one a room needs", () => {
  // ── Why this is here and not left to the constant ───────────────────────────
  // `POST_IMAGE_SLOT.visibility` is one word, and all four of the alternatives
  // read plausibly in a diff. What tells them apart is what `mayAccess()` then
  // answers for the people who have to see the picture, so that is what is asked
  // — with the REAL function, and with the value read out of the slot rather than
  // typed in here.
  //
  // Without this, a change to `owner` would leave every other test in this file
  // green (its fixtures build their own rows) and every reader of a room would
  // see a broken image beside somebody else's post.
  const stored = (id: string) =>
    picture(id, { visibility: POST_IMAGE_SLOT.visibility, ownerId: "author-1" });

  it("another signed-in member may have it", async () => {
    // The whole point. A picture in a room is for the room, and the author is not
    // the only person in it — `owner` would show it to nobody but them.
    expect(await mayAccess(stored("m-a"), { memberId: "somebody-else", role: "member" })).toBe(true);
  });

  it("nobody signed out may have it", async () => {
    // …and `public` would put a member's photograph on an anonymous bucket
    // address, which is the other direction the one word could go.
    expect(await mayAccess(stored("m-a"), { memberId: null, role: null })).toBe(false);
  });

  it("asks no entitlement question, so a room's plan cannot break its pictures", async () => {
    // `entitled` would bind the picture to a Product Key, and a room's door is
    // not the picture's: a member moved between plan-gated rooms would find the
    // pictures gone from a thread they can still read.
    expect(hasPlan).not.toHaveBeenCalled();
  });
});

describe("🚨 the counter can tell the two implementations apart", () => {
  it("reads N when the same posts are resolved one at a time", async () => {
    // ── Non-vacuity ────────────────────────────────────────────────────────
    // The per-post implementation, expressed as a probe rather than left to a
    // future editor to try. If the chain ever stopped recording `from()` — a
    // renamed table, a builder method the stand-in does not answer — every
    // assertion above would pass for ANY implementation, and this line is what
    // fails instead.
    const ids = ["p-0", "p-1", "p-2", "p-3", "p-4", "p-5"];
    seed([], ids.map((id, i) => attachment(id, 0, picture(`m-${i}`))));

    for (const id of ids) await postImagesFor([id], VIEWER);

    expect(attachmentQueries()).toBe(6);
  });
});
