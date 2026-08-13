// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { communityDiscussions, communityPosts } from "../schema";
import { findEmbed } from "./embeds";
import { CommunityError, canParticipate, checkPostContent, mayViewEmbed, planKeysToResolve } from "./rules";

import { grantedKeysFor } from "./_access";
import { guardSendBlock } from "./_blocks";
import { PostImageUpload, attachPostImages, discardPostImages, judgePostImages, storePostImages } from "./_post-images";
import { participationProfile } from "./profiles";
import { PostRow, guardPostRate, postsFor, releaseRateOnFailure } from "./talk";

// ───────────────────────────────────────────────────────────────────────────
// Embedded discussions — a conversation hanging off a page instead of a room
// ───────────────────────────────────────────────────────────────────────────
//
// Four functions, and the split between them is AD-62's whole mechanic:
// **reading never creates anything, and exactly one function writes the row.**
// A discussion that came into existence because somebody loaded a page would
// be a table an anonymous-ish request can grow, keyed by a string the browser
// chose; a discussion that comes into existence under the first POST is a row
// per conversation somebody actually had.

/**
 * The row for a Subject Key, or `null` — **a SELECT and nothing else.**
 *
 * ⚠️ `null` is the normal answer, not a failure: it means "nobody has posted
 * under this key yet", and the component renders the empty discussion. Do not
 * "fix" it by creating the row here. That is the one line AD-62 draws, and the
 * reason it is drawn is that this function runs on every render of every page
 * carrying an embed.
 *
 * It does not check access and is not exported for surfaces to call directly —
 * `embeddedDiscussionView()` below is the door, and it asks first.
 */
export async function embeddedDiscussionFor(
  subjectKey: string,
): Promise<typeof communityDiscussions.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(communityDiscussions)
    .where(eq(communityDiscussions.subjectKey, subjectKey))
    .limit(1);
  return row ?? null;
}

/**
 * May this member see the discussion declared for this Subject Key?
 *
 * `null` when yes, the code `communityNotEntitled` when no — **and "no" covers both an
 * undeclared key and a declared one this member has not bought.** The merge
 * happens in `mayViewEmbed()`, once; this function only resolves the two
 * things that need a database: which declaration the registry holds, and which
 * of its product keys this member holds RIGHT NOW (AD-60 — at the moment of
 * the read, never cached, never carried over from a render).
 *
 * Enablement is deliberately not asked here, like everywhere else in this
 * file: the surface asks it, per request, because that is where a request
 * arrives.
 */
export async function embedAccessFor(
  subjectKey: string,
  viewer: { memberId: string; role: string },
): Promise<"communityNotEntitled" | null> {
  const declaration = findEmbed(subjectKey);
  const grantedKeys = await grantedKeysFor(
    viewer.memberId,
    planKeysToResolve(declaration ? [declaration] : []),
  );
  return mayViewEmbed(declaration, { role: viewer.role, grantedKeys });
}

/**
 * **The one function in this module that creates an embedded discussion row,
 * and the post-write transaction is its only caller.**
 *
 * Not a render path, not a component, not a server action of its own: the row
 * materializes the moment a first post lands under a Subject Key, inside the
 * same transaction that writes that post and bumps `lastActivityAt` (AD-62).
 *
 * ⚠️ **It refuses an undeclared key before writing anything.** The registry is
 * the provenance, so a request naming a key nobody declared creates nothing at
 * all — otherwise the table would be a place a signed-in member can put rows
 * with keys of their own choosing.
 *
 * ⚠️ **`onConflictDoNothing` + re-select, against the partial unique index.**
 * That pairing is what makes two first-posters race-safe: both call this, one
 * inserts, the other conflicts and reads back the row the first just wrote.
 * `returning()` is empty on a conflict — hence the second read, which is not a
 * belt-and-braces extra but the other half of the answer.
 *
 * ⚠️ **`createdBy` and `title` stay NULL.** Nobody starts an embedded
 * discussion, and the check constraint would refuse a title anyway; the
 * account-deletion scrub blanks the titles of threads a departing member
 * started, and a title of `""` on a row carrying a Subject Key would make an
 * erasure request fail. `db/schema-community.ts` carries the full argument.
 */
export async function ensureEmbeddedDiscussion(
  tx: { insert: typeof db.insert; select: typeof db.select },
  subjectKey: string,
  now: Date,
): Promise<{ id: string }> {
  // The provenance check, before the write rather than beside it.
  if (!findEmbed(subjectKey)) throw new CommunityError("communityNotEntitled");

  const [created] = await tx
    .insert(communityDiscussions)
    .values({
      subjectKey,
      groupId: null,
      title: null,
      createdBy: null,
      lastActivityAt: now,
      createdAt: now,
    })
    // The unique index is PARTIAL (`where subject_key is not null`), so the
    // conflict target has to carry the same predicate or Postgres cannot infer
    // which index is meant and refuses the statement outright. Same trap
    // `acknowledgeRead()`'s `targetWhere` answers one table over.
    .onConflictDoNothing({
      target: communityDiscussions.subjectKey,
      where: sql`${communityDiscussions.subjectKey} is not null`,
    })
    .returning({ id: communityDiscussions.id });
  if (created) return created;

  const [existing] = await tx
    .select({ id: communityDiscussions.id })
    .from(communityDiscussions)
    .where(eq(communityDiscussions.subjectKey, subjectKey))
    .limit(1);
  // Nothing inserted and nothing there is not a state this can reach — the
  // conflict IS the row. Refusing loudly beats returning an id nobody has.
  if (!existing) throw new CommunityError("notFound");
  return existing;
}

/** What an embedded discussion hands the component that draws it. */
export interface EmbeddedDiscussionView {
  /** `null` until somebody has posted — the empty discussion is a real state. */
  discussionId: string | null;
  locked: boolean;
  rows: PostRow[];
  total: number;
  page: number;
}

/**
 * Everything the embed component needs, or `null` when it may not have it.
 *
 * ⚠️ **`null` is ONE answer for "no such declaration" and "not entitled"**, so
 * the component renders identically for both — which is the render-side half
 * of the refusal `embedAccessFor()` makes indistinguishable at the write side.
 *
 * Read-only throughout: an unknown-but-declared key answers an empty
 * discussion rather than creating one (see `embeddedDiscussionFor()`).
 */
export async function embeddedDiscussionView(
  subjectKey: string,
  viewer: { memberId: string; role: string },
  page: number | "last",
): Promise<EmbeddedDiscussionView | null> {
  if (await embedAccessFor(subjectKey, viewer)) return null;

  const discussion = await embeddedDiscussionFor(subjectKey);
  if (!discussion) {
    return { discussionId: null, locked: false, rows: [], total: 0, page: 1 };
  }

  const posts = await postsFor(discussion.id, page, viewer);
  return {
    discussionId: discussion.id,
    locked: discussion.lockedAt !== null,
    ...posts,
  };
}

/**
 * Post into an embedded discussion, creating it if this is the first one.
 *
 * The same order of checks as `addPost()`, for the same reasons — access →
 * participation → the thread's own state → the content → the brake → the
 * write — with the one addition this leg needs: **the row is ensured inside
 * the transaction that writes the post**, never before it and never on a read.
 *
 * ⚠️ **The coordinate is the Subject Key, never a discussion id from the
 * browser.** An id would let a member aim a post at any thread whose id they
 * had; a key is looked up in the registry first, and an undeclared one is
 * refused with the same code somebody without the plan gets.
 */
export async function addEmbeddedPost(
  subjectKey: string,
  viewer: { memberId: string; role: string },
  input: {
    content: unknown;
    images?: readonly PostImageUpload[];
    imageAlts?: readonly unknown[];
  },
): Promise<{ postId: string }> {
  const refusal = await embedAccessFor(subjectKey, viewer);
  if (refusal) throw new CommunityError(refusal);

  const denial = canParticipate(await participationProfile(viewer.memberId));
  if (denial) throw new CommunityError(denial);

  // The fourth send path — an embed is a place to write like any other.
  await guardSendBlock(viewer.memberId);

  // A lock is a property of the row, so it can only exist once the row does —
  // an embed nobody has posted in yet is not locked, it is empty. This is an
  // early exit for the common case only; it is read again inside the
  // transaction below, where it actually gates the write.
  const existing = await embeddedDiscussionFor(subjectKey);
  if (existing?.lockedAt) throw new CommunityError("communityDiscussionLocked");

  const content = checkPostContent(input.content);
  if (!content.ok) throw new CommunityError(content.code);
  const pictures = judgePostImages(input);

  guardPostRate(viewer.memberId);

  return releaseRateOnFailure(viewer.memberId, async () => {
    // See `storePostImages()`: after every guard, before the transaction. The
    // embedded leg is a place to write like any other and gets the same order.
    const mediaIds = await storePostImages(viewer, pictures.uploads, pictures.alts);

    try {
      return await db.transaction(async (tx) => {
      const now = new Date();
      // The module's one lazy materialization, in the one transaction that is
      // allowed to perform it.
      const discussion = await ensureEmbeddedDiscussion(tx, subjectKey, now);

      // ⚠️ **Re-checked here, and `.for("update")` is what makes it a check.**
      // The read above happens before this transaction opens, so a lock applied
      // in the gap between the two would otherwise let this write through — the
      // same shape `communityDiscussionLocked` above exists to prevent, just closer to
      // the write. A PLAIN select would not close it either: Postgres runs
      // READ COMMITTED, so every statement takes a fresh snapshot and a lock
      // committing between this line and the insert below is invisible to both.
      // The row lock is what makes the two statements one decision — and it is
      // taken here rather than left to the `lastActivityAt` update at the end,
      // which is the first statement that would otherwise take one, by which
      // point the post is already in.
      const [current] = await tx
        .select({ lockedAt: communityDiscussions.lockedAt })
        .from(communityDiscussions)
        .where(eq(communityDiscussions.id, discussion.id))
        .limit(1)
        .for("update");
      // No row means it went away under us — refuse rather than fall through to
      // an insert whose foreign key would fail as an untranslated driver error.
      if (!current) throw new CommunityError("notFound");
      if (current.lockedAt) throw new CommunityError("communityDiscussionLocked");

      const [post] = await tx
        .insert(communityPosts)
        .values({
          discussionId: discussion.id,
          authorId: viewer.memberId,
          content: content.content,
          createdAt: now,
        })
        .returning({ id: communityPosts.id });

      await attachPostImages(tx, post.id, mediaIds);

      // `lastActivityAt` moves in the same transaction as the post and nowhere
      // else — the rule the schema header states, applied to the third and
      // last write path that is allowed to touch it.
      await tx
        .update(communityDiscussions)
        .set({ lastActivityAt: now })
        .where(eq(communityDiscussions.id, discussion.id));

      return { postId: post.id };
      });
    } catch (error) {
      await discardPostImages(mediaIds);
      throw error;
    }
  });
}
