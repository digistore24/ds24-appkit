// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 **AC 5: what happens when a member attaches a picture to a post.**
//
// Four claims, and none of them is visible in a shape assertion on the return
// value — `addPost()` answers `{ postId }` whether it did any of this or not:
//
//   1. **The bytes go through the WHOLE pipeline, in order.**
//      `guardUploadEntry()` — is media on, is the store usable, has this member
//      had their share of the hour — and THEN `acceptUpload()`, per file. A door
//      that calls only the second is an upload path with no rate limit on which
//      the operator's kill switch silently does nothing, and it is a bug this
//      template has already shipped once (Story 19.4, recorded in
//      `lib/media/upload-endpoint.ts`).
//   2. **Nothing is uploaded for somebody who may not post here.** The access
//      re-derivation, the participation check and the send-block all come first;
//      an upload in front of them lets a refunded member put bytes in the
//      operator's bucket and spend their hourly allowance on a post that is then
//      refused.
//   3. **The slot is this module's own**, and read from `POST_IMAGE_SLOT` rather
//      than typed in here — `modules/boundary.test.ts` refuses a module naming
//      another's namespace, and this is the same fact measured at the call.
//   4. **A picture that cannot be stored fails the WHOLE post, and takes back
//      whatever it already stored.** The opposite of the avatar path, on purpose:
//      a post is one utterance, and publishing the words without the pictures
//      leaves half a contribution in a room with no way back (editing a post does
//      not take pictures).
//
// ── What is faked ──────────────────────────────────────────────────────────
// The database, `acceptUpload()`, `guardUploadEntry()` and `deleteMedia()`. The
// ORDER those three are called in is the thing under test, so they are recorded
// against one shared log rather than three counters — a per-function counter
// cannot tell "guard then accept" from "accept then guard".
import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Every guard and every store call, in the order they really happened. */
const log: string[] = [];

const fake = vi.hoisted(() => {
  const rows: Record<string, unknown[]> = {};
  const inserts: Array<{ table: string; values: unknown }> = [];
  const updates: string[] = [];
  /** Set to make the post-writing transaction fail. */
  const failures = { transaction: false };

  const select = (selection?: unknown) => {
    const counting =
      selection !== null &&
      typeof selection === "object" &&
      Object.hasOwn(selection as object, "value");
    let table = "";
    const chain: Record<string, unknown> = {
      from(value: unknown) {
        table = getTableName(value as Parameters<typeof getTableName>[0]);
        return chain;
      },
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      groupBy: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      offset: () => chain,
      for: () => chain,
      then: (ok: (value: unknown[]) => unknown, fail: (reason: unknown) => unknown) =>
        Promise.resolve(
          counting ? [{ value: (rows[table] ?? []).length }] : (rows[table] ?? []),
        ).then(ok, fail),
    };
    return chain;
  };

  // ⚠️ **Two writers, and they are NOT the same object.** The first version of
  // this harness handed `db` and the transaction one shared writer — so the
  // "written inside the transaction" assertion passed for a version that wrote the
  // attachment rows on `db` instead, which is precisely the defect that assertion
  // exists to catch. The prefix is what tells them apart in the log; a probe
  // swapping `tx` for `db` now fails.
  const makeWriter = (prefix: string) => ({
    select,
    insert(table: unknown) {
      const name = getTableName(table as Parameters<typeof getTableName>[0]);
      const chain = {
        values(values: unknown) {
          inserts.push({ table: name, values });
          log.push(`${prefix}:${name}`);
          return chain;
        },
        onConflictDoNothing: () => chain,
        onConflictDoUpdate: () => chain,
        returning: async () => [{ id: `${name}-row-1` }],
        then: (ok: (value: unknown) => unknown) => Promise.resolve(undefined).then(ok),
      };
      return chain;
    },
    update(table: unknown) {
      const name = getTableName(table as Parameters<typeof getTableName>[0]);
      const chain = {
        set: () => chain,
        where: async () => {
          updates.push(`${prefix}:${name}`);
          return undefined;
        },
      };
      return chain;
    },
  });

  /** What a statement outside any transaction logs. */
  const outside = makeWriter("insert-outside");
  /** …and what one inside the post-writing transaction logs. */
  const inside = makeWriter("insert");

  const db = {
    ...outside,
    async transaction<T>(body: (tx: typeof inside) => Promise<T>): Promise<T> {
      log.push("transaction:begin");
      if (failures.transaction) {
        log.push("transaction:failed");
        throw new Error("serialization failure");
      }
      const answer = await body(inside);
      log.push("transaction:commit");
      return answer;
    },
  };

  return { rows, inserts, updates, failures, db };
});

vi.mock("@/db", () => ({ db: fake.db }));

vi.mock("@/lib/entitlements/manage", () => ({
  hasPlan: async () => false,
  entitlementsFor: async () => [],
  planStartedAt: async () => null,
}));

vi.mock("@/lib/media/url", () => ({
  mediaImageFor: () => ({ src: "x", srcSet: null, width: null, height: null }),
  mediaUrlFor: () => "x",
}));

const guardUploadEntry = vi.fn((memberId: string) => {
  log.push(`guardUploadEntry:${memberId}`);
});
vi.mock("@/lib/media/upload-endpoint", () => ({
  guardUploadEntry: (memberId: string) => guardUploadEntry(memberId),
}));

const acceptUpload = vi.fn(async (input: Record<string, unknown>) => {
  log.push(`acceptUpload:${String(input.alt)}`);
  return { id: `m-${String(input.alt)}` };
});
const deleteMedia = vi.fn(async (id: string) => {
  log.push(`deleteMedia:${id}`);
});
vi.mock("@/lib/media/manage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/media/manage")>()),
  acceptUpload: (input: Record<string, unknown>) => acceptUpload(input),
  deleteMedia: (id: string) => deleteMedia(id),
}));

const { POST_IMAGE_SLOT, addPost } = await import("./manage");
const { CommunityError } = await import("./rules");

const VIEWER = { memberId: "author-1", role: "member" };

/** One picked file, as the action hands it over. */
function upload(n: number) {
  return {
    bytes: new Uint8Array([0xff, 0xd8, 0xff, n]),
    claimedMime: "image/jpeg",
    filename: `shelf-${n}.jpg`,
  };
}

/** The fixture: one open room, one thread in it, and a member who has a name. */
function seed(over: { locked?: boolean; profile?: boolean } = {}) {
  log.length = 0;
  fake.inserts.length = 0;
  fake.updates.length = 0;
  fake.failures.transaction = false;
  for (const key of Object.keys(fake.rows)) delete fake.rows[key];

  fake.rows["community_discussions"] = [
    {
      discussion: {
        id: "d-1",
        groupId: "g-1",
        subjectKey: null,
        lockedAt: over.locked ? new Date("2026-08-01T00:00:00Z") : null,
      },
      group: { id: "g-1", accessLevel: "open", planKeys: [], archivedAt: null },
    },
  ];
  fake.rows["community_profiles"] =
    over.profile === false ? [] : [{ displayName: "Anna" }];
  // No unconsumed reports, so `guardSendBlock()` lets the write through.
  fake.rows["community_spam_reports"] = [];
}

const uploadCalls = () => acceptUpload.mock.calls.map((call) => call[0]);

beforeEach(() => {
  vi.clearAllMocks();
});

// ⚠️ **The posting brake is REAL in this file** — `guardPostRate()` records into
// the in-memory bucket in `lib/rate-limit.ts`, which no mock here replaces. That
// is deliberate (it is part of the order under test), and it is why the writes
// below are counted: four of these tests reach the brake and commit, three reach
// it and hand their hit back through `releaseRateOnFailure()`. Well under the
// shipped twenty per ten minutes — but a test added here that posts in a loop
// would start failing its NEIGHBOURS with `communityPostRateLimited`, so give one
// a member id of its own rather than raising anything.

describe("🚨 AC 5 — the whole pipeline, per file, in order", () => {
  it("guards the entry before it accepts the bytes, once per picture", async () => {
    seed();

    await addPost("d-1", VIEWER, {
      content: "Mein Regal ist fertig",
      images: [upload(1), upload(2)],
      imageAlts: ["eins", "zwei"],
    });

    // THE order assertion, as one comparison over the shared log — so a version
    // that called the outer guard once for the batch, or after the upload, fails
    // here rather than passing on a superset of calls.
    expect(log.slice(0, 4)).toEqual([
      "guardUploadEntry:author-1",
      "acceptUpload:eins",
      "guardUploadEntry:author-1",
      "acceptUpload:zwei",
    ]);
    expect(guardUploadEntry).toHaveBeenCalledTimes(2);
  });

  it("stores them in this module's own namespace, at the members visibility", async () => {
    seed();

    await addPost("d-1", VIEWER, {
      content: "x",
      images: [upload(1)],
      imageAlts: ["mein Regal"],
    });

    // Read out of the slot rather than typed in: changing what the module claims
    // has to change this assertion's expectation with it, which is what keeps the
    // boundary rule and the call in step.
    expect(uploadCalls()[0]).toMatchObject({
      ownerId: "author-1",
      role: "member",
      namespace: POST_IMAGE_SLOT.namespace,
      category: POST_IMAGE_SLOT.category,
      visibility: POST_IMAGE_SLOT.visibility,
      onlyKinds: POST_IMAGE_SLOT.onlyKinds,
      claimedMime: "image/jpeg",
      // The member's own sentence, never derived from the post's text or the
      // filename — see `checkPostImages()`.
      alt: "mein Regal",
    });
    // And the namespace really is the module's id, which is what
    // `modules/boundary.test.ts` scans the source for.
    expect(uploadCalls()[0].namespace).toBe("community");
  });

  it("writes the attachment rows inside the post's own transaction, densely", async () => {
    seed();

    await addPost("d-1", VIEWER, {
      content: "x",
      images: [upload(1), upload(2), upload(3)],
      imageAlts: ["a", "b", "c"],
    });

    // Both inserts between begin and commit — an attachment row written outside
    // the transaction is a post that can exist without its pictures.
    const begin = log.indexOf("transaction:begin");
    const commit = log.indexOf("transaction:commit");
    const attachments = log.indexOf("insert:community_post_media");
    expect(begin).toBeGreaterThan(-1);
    expect(attachments).toBeGreaterThan(begin);
    expect(attachments).toBeLessThan(commit);

    const written = fake.inserts.find((row) => row.table === "community_post_media");
    expect(written?.values).toEqual([
      { postId: "community_posts-row-1", mediaId: "m-a", position: 0 },
      { postId: "community_posts-row-1", mediaId: "m-b", position: 1 },
      { postId: "community_posts-row-1", mediaId: "m-c", position: 2 },
    ]);
  });

  it("writes no attachment statement at all for a post with no pictures", async () => {
    seed();

    await addPost("d-1", VIEWER, { content: "nur Text" });

    expect(acceptUpload).not.toHaveBeenCalled();
    expect(guardUploadEntry).not.toHaveBeenCalled();
    expect(log).not.toContain("insert:community_post_media");
  });
});

describe("🚨 AC 5 — nothing is uploaded for somebody who may not post", () => {
  it("refuses an unreachable thread before it touches a byte", async () => {
    seed();
    fake.rows["community_discussions"] = [];

    await expect(
      addPost("d-1", VIEWER, { content: "x", images: [upload(1)], imageAlts: ["a"] }),
    ).rejects.toThrow(CommunityError);

    expect(guardUploadEntry).not.toHaveBeenCalled();
    expect(acceptUpload).not.toHaveBeenCalled();
  });

  it("refuses a member who has not named themselves before it touches a byte", async () => {
    seed({ profile: false });

    await expect(
      addPost("d-1", VIEWER, { content: "x", images: [upload(1)], imageAlts: ["a"] }),
    ).rejects.toThrow(CommunityError);

    expect(guardUploadEntry).not.toHaveBeenCalled();
    expect(acceptUpload).not.toHaveBeenCalled();
  });

  it("refuses a locked thread before it touches a byte", async () => {
    seed({ locked: true });

    await expect(
      addPost("d-1", VIEWER, { content: "x", images: [upload(1)], imageAlts: ["a"] }),
    ).rejects.toThrow(CommunityError);

    expect(acceptUpload).not.toHaveBeenCalled();
  });

  it("refuses too many pictures before it touches a byte", async () => {
    seed();
    const many = Array.from({ length: 20 }, (_, i) => upload(i));

    await expect(
      addPost("d-1", VIEWER, {
        content: "x",
        images: many,
        imageAlts: many.map((_, i) => `alt ${i}`),
      }),
    ).rejects.toThrow(/communityTooManyImages/);

    // The point of the ceiling being a PURE check: twenty files were refused
    // without twenty round trips to a bucket.
    expect(acceptUpload).not.toHaveBeenCalled();
    expect(guardUploadEntry).not.toHaveBeenCalled();
  });

  it("refuses a picture nobody described before it touches a byte", async () => {
    seed();

    await expect(
      addPost("d-1", VIEWER, { content: "x", images: [upload(1)], imageAlts: [""] }),
    ).rejects.toThrow(/communityImageAltInvalid/);

    expect(acceptUpload).not.toHaveBeenCalled();
  });
});

describe("🚨 AC 5 — a picture that cannot be stored fails the whole post", () => {
  it("writes no post, and takes back what it had already stored", async () => {
    seed();
    acceptUpload
      .mockImplementationOnce(async (input: Record<string, unknown>) => {
        log.push(`acceptUpload:${String(input.alt)}`);
        return { id: `m-${String(input.alt)}` };
      })
      .mockImplementationOnce(async () => {
        log.push("acceptUpload:failed");
        throw new Error("the bucket said no");
      });

    await expect(
      addPost("d-1", VIEWER, {
        content: "Mein Regal ist fertig",
        images: [upload(1), upload(2)],
        imageAlts: ["eins", "zwei"],
      }),
    ).rejects.toThrow(/the bucket said no/);

    // No post — the words stay in the composer, which is what NFR-37 buys, and
    // half a contribution never reaches the room.
    expect(log).not.toContain("insert:community_posts");
    expect(log).not.toContain("transaction:begin");
    // …and the first picture does not stay in the bucket as an orphan.
    expect(deleteMedia).toHaveBeenCalledWith("m-eins");
  });

  it("takes the pictures back when the TRANSACTION is what fails", async () => {
    // The other half, and the one easy to miss: the objects are stored before the
    // transaction opens (a bucket write is not something to hold one across), so a
    // rollback leaves them with nothing pointing at them — and the row is the only
    // record they exist.
    seed();
    fake.failures.transaction = true;

    await expect(
      addPost("d-1", VIEWER, { content: "x", images: [upload(1)], imageAlts: ["eins"] }),
    ).rejects.toThrow(/serialization failure/);

    expect(deleteMedia).toHaveBeenCalledWith("m-eins");
  });

  it("does not lose the post when the CLEANUP is what fails", async () => {
    // A failed cleanup must not replace a sentence the member can act on with a
    // different error. It is logged for `node run.mjs errors` and the original
    // refusal is what propagates.
    seed();
    acceptUpload.mockImplementationOnce(async () => {
      throw new Error("the bucket said no");
    });
    deleteMedia.mockRejectedValueOnce(new Error("and it said no again"));

    await expect(
      addPost("d-1", VIEWER, { content: "x", images: [upload(1)], imageAlts: ["eins"] }),
    ).rejects.toThrow(/the bucket said no/);
  });
});
