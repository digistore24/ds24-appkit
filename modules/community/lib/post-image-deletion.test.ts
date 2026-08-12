// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 **AC 6, second half: a post's pictures go with the account — MEASURED.**
//
// The story asks for it in those words, and it is worth saying what it refuses.
// The tempting argument is one sentence and entirely correct: *"a post image is
// `members`-visible, `members` is in `OWNED_MEDIA_VISIBILITIES`, and the avatar
// is swept today for exactly that reason — so post images are swept too."* Every
// clause is true and the conclusion still is not evidence. It is a claim about two
// constants agreeing today, and constants are what a later story edits: narrow
// `OWNED_MEDIA_VISIBILITIES` back to `owner` alone and that argument reads
// identically while a member's pictures survive their own deletion, in the bucket,
// with `owner_id` nulled so nothing left in the database can ever name them again.
// That is not hypothetical — `listOwnedMedia()`'s own header records the version
// of this bug that shipped.
//
// ── The chain, and where each link is measured ──────────────────────────────
// Three links, and none of them is an inference:
//
//   1. **a post image is STORED at `POST_IMAGE_SLOT.visibility`, owned by its
//      author** — `post-image-write.test.ts`, read off the real `acceptUpload()`
//      call.
//   2. **the account sweep's QUERY asks for that visibility and that owner** —
//      here, by capturing the condition `deleteOwnedMedia()` really builds.
//   3. **whatever that query returns has its objects removed, variants first, and
//      only then its row** — `lib/media/manage.test.ts` → `deleteOwnedMedia`,
//      where the object store is already faked and where the guarantee belongs,
//      because it is the CORE's.
//
// ⚠️ **Link 3 is deliberately not repeated here, and the reason is a gate rather
// than taste.** Observing the store from a module test means naming
// `@/lib/media/store`, and `modules/boundary.test.ts` refuses that outright — a
// module reaching a driver has stepped past `acceptUpload()`. It said so about the
// first version of this file, which is the guard working: the object sweep is the
// core's claim, measured in the core's tree, and what belongs here is the link
// that joins the module's storage decision to it.
//
// ── What is faked ──────────────────────────────────────────────────────────
// The database, and nothing else. `deleteOwnedMedia()` is the real function and
// `storageKey()` is the real key builder — a test with the key or the visibility
// typed in by hand would measure the test.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaRow } from "@/db/schema-media";

const deleteWhere = vi.fn();
const selected = vi.fn<() => Promise<MediaRow[]>>();
const selectedTickets = vi.fn<() => Promise<{ id: string; storageKey: string }[]>>();
const whereArg = vi.fn();

vi.mock("@/lib/entitlements/manage", () => ({
  hasPlan: async () => false,
  entitlementsFor: async () => [],
  planStartedAt: async () => null,
}));

// The two select shapes this sweep issues, told apart by their projection —
// `listOwnedMedia()` asks for whole rows, the open-ticket pass asks for two
// columns. One recorder for both would make the ticket pass look like a second
// walk over the media rows (`lib/media/manage.test.ts` carries the same note).
vi.mock("@/db", () => ({
  db: {
    select: (projection?: unknown) => ({
      from: () => ({
        where: (condition: unknown) => {
          whereArg(condition);
          const result = projection ? selectedTickets() : selected();
          return Object.assign(result, { limit: () => result });
        },
      }),
    }),
    delete: () => ({ where: deleteWhere }),
  },
}));

const { deleteOwnedMedia } = await import("@/lib/media/manage");
const { storageKey } = await import("@/lib/media/rules");
const { POST_IMAGE_SLOT } = await import("./manage");

/**
 * The VALUES bound into a Drizzle condition — what the statement really asks for.
 *
 * Only `Param` nodes, and both halves of that are load-bearing (the same two
 * traps `lib/media/manage.test.ts` documents, which is why this walk is written
 * out again here rather than imported from a test file):
 *
 *  - `JSON.stringify` throws — a condition holds column objects pointing back at
 *    their table, so the structure is circular.
 *  - collecting every nested string finds "public" and "entitled" whatever the
 *    predicate says, because the COLUMN carries the enum's full value list in its
 *    metadata. A test written that way passes and fails for reasons that have
 *    nothing to do with the filter, which would make this whole file decorative.
 */
function boundValues(condition: unknown): string[] {
  const found: string[] = [];
  const seen = new WeakSet<object>();
  const walk = (node: unknown) => {
    if (typeof node !== "object" || node === null) return;
    if (seen.has(node)) return;
    seen.add(node);
    if (
      node.constructor?.name === "Param" &&
      typeof (node as { value?: unknown }).value === "string"
    ) {
      found.push((node as { value: string }).value);
      return;
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(condition);
  return found;
}

const MEMBER = "member-1";

beforeEach(() => {
  vi.clearAllMocks();
  selected.mockResolvedValue([]);
  selectedTickets.mockResolvedValue([]);
});

describe("🚨 AC 6 — the account sweep asks for what a post image is stored as", () => {
  it("names that visibility and that owner, and asks for nothing wider", async () => {
    await deleteOwnedMedia(MEMBER);

    const asked = boundValues(whereArg.mock.calls[0]?.[0]);

    // Non-vacuity first: a walk that found no bound values at all would make
    // every assertion below pass for any predicate whatsoever.
    expect(
      asked.length,
      "no bound values were read out of the sweep's condition — either the walk " +
        "stopped matching Param nodes or the query stopped being built with them, " +
        "and both make every claim in this file vacuous",
    ).toBeGreaterThan(1);

    // The owner half. A sweep scoped to a visibility and not to a person would
    // erase every member's pictures on any one deletion.
    expect(asked).toContain(MEMBER);

    // THE assertion. Not the string `"members"` — `POST_IMAGE_SLOT.visibility`,
    // so changing what this module stores without changing the sweep fails HERE
    // rather than in a customer's bucket.
    expect(
      asked,
      `the account sweep does not ask for "${POST_IMAGE_SLOT.visibility}" media, which is ` +
        `what a post image is stored as. A member's pictures would survive their own ` +
        `account deletion, in the bucket, with owner_id nulled so nothing could name them.`,
    ).toContain(POST_IMAGE_SLOT.visibility);

    // …and it does NOT ask for the operator's product imagery. Without this the
    // assertion above would be satisfied by a filter that asked for everything,
    // which is a different bug pointing the other way: deleting the operator's
    // account would take the app's lesson covers with it.
    expect(asked).not.toContain("entitled");
    expect(asked).not.toContain("public");
  });

  it("removes nothing when the filter matches nothing", async () => {
    // The other direction of the same statement, and what gives the assertion
    // above its teeth: the removal really is "what the query returned" rather
    // than "everything this member owns". `selected()` answering nothing leaves
    // the row deletion untouched.
    const count = await deleteOwnedMedia(MEMBER);

    expect(count).toBe(0);
    expect(deleteWhere).not.toHaveBeenCalled();
  });
});

describe("🚨 AC 6 — the key a post image is stored under is this module's own", () => {
  it("lands in community/post/, derived rather than written down", async () => {
    // The boundary claim measured through the real `storageKey()` rather than
    // asserted about a literal: `modules/boundary.test.ts` refuses a module
    // claiming another's namespace, and this is the same fact read from the
    // deletion end — an operator scoping a bucket lifecycle rule to
    // `community/post/` reaches exactly these objects and nobody else's, and the
    // core's sweep removes exactly the key on the row.
    const key = storageKey({
      namespace: POST_IMAGE_SLOT.namespace,
      category: POST_IMAGE_SLOT.category,
      id: "m-post-1",
      mime: "image/jpeg",
      createdAt: new Date("2026-08-10T09:00:00Z"),
    });

    expect(key).toBe("community/post/2026/08/m-post-1.jpg");
    // Said as a pattern too, so a later change to the date segments fails on the
    // shape rather than only on the literal above.
    expect(key).toMatch(/^community\/post\/\d{4}\/\d{2}\/m-post-1\.jpg$/);
    // 26.1's grammar: the namespace is the module's id and nothing else.
    expect(POST_IMAGE_SLOT.namespace).toBe("community");
  });
});
