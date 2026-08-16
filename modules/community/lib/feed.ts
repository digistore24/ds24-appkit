// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { cache } from "react";
import { and, asc, desc, eq, gt, inArray, isNull, lte, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { media, users } from "@/db/schema";
import { communityDiscussions, communityFollows, communityGroups, communityPosts, communityProfiles } from "../schema";
import { mayAccess } from "@/lib/media/manage";
import { compareCursor, cursorToken, liveCursorToken, parseCursorToken, parseLiveCursorToken, feedVisible, changedAt } from "./rules";

import { accessibleGroupIds } from "./_access";
import { CHANGED_AT, changedAtParam } from "./_change-stamp";
import { avatarUrlsFor } from "./profiles";

// ───────────────────────────────────────────────────────────────────────────
// The friends feed — derived at read time, stored nowhere
// ───────────────────────────────────────────────────────────────────────────
//
// 🚨 **AD-68: one bounded, indexed read-time join. There is no feed table.**
// No per-follower delivery, no fan-out on write, no cache row, no counter, no
// invalidation hook. That is not an optimisation left for later — it is what
// makes the next paragraph true.
//
// 🚨 **A space the viewer cannot enter right now contributes NOTHING.** Not the
// post, not the room's name, not the thread's title, not a gap in the ordering
// where something used to be. A feed that leaked gated activity would turn a
// purchase into a broadcast: "somebody you follow posted in Diabetes-Coaching
// Premium" is the fact that they bought it, delivered to whoever follows them.
// And it would be a SECOND access path — cheaper to read than the room, and
// readable by somebody who never bought anything.
//
// The access set is derived per request from `accessibleGroupIds()`, the same
// resolver the community section and the unread dot already use. Deriving it
// differently here is the failure this comment exists to prevent: two answers
// to "may they be in this room" drift, and the one that drifts wide is a leak
// nobody sees, because the feed is the surface where nobody expects to find
// the room.
//
// ⚠️ **Embedded discussions are out of the feed entirely**, and that is a
// decision rather than an omission. An embed hangs off a page of the app; its
// door is a declaration in `lib/community/embeds.ts` and its Subject Key names
// course structure, which is why an embedded row carries no title. A feed item
// for one would either say nothing useful or say what a member has not bought.
// Rooms only.
//
// ⚠️ **Nothing in this block may name a direct-message table.** A feed reads
// `community_posts` and their discussions; a private message is not activity
// anybody may see. `lib/community/feed-guard.test.ts` asserts the structural
// version of that rather than an instance of it.

/** One thing that happened, as the feed reads it out of the database. */
export interface FeedItem {
  postId: string;
  discussionId: string;
  discussionTitle: string;
  groupId: string;
  groupName: string;
  authorId: string | null;
  authorProfileName: string | null;
  authorAccountName: string | null;
  /**
   * The author's picture as an ID, not as an address — it rides the same join
   * that already brings their name, so it costs no query of its own.
   *
   * ⚠️ **An id is not permission and this field is never rendered.** The
   * address is minted by `feedFor()` through `avatarUrlsFor()`, which asks
   * `mayAccess()` first; a renderer handed this value could do nothing with it,
   * which is the point of stopping here.
   */
  authorAvatarMediaId: string | null;
  content: string;
  createdAt: Date;
}

/**
 * One thing that happened, with the author's picture resolved for one viewer.
 *
 * The page's shape. `FeedItem` above is the row; this is the row after
 * `feedFor()` has asked `mayAccess()` once per author and minted what may be
 * shown — `null` for a member with no picture, one they uploaded and then
 * deleted, or one this viewer may not have.
 */
export interface FeedItemResolved extends FeedItem {
  authorAvatarUrl: string | null;
}

/** How many items one answer may carry. A ceiling, not a suggestion. */
export const FEED_PER_PAGE = 30;

/**
 * The viewer's readable rooms and the people they follow — the two sets every
 * feed read starts from, resolved per request.
 *
 * `null` for either means the feed is empty, and the caller returns before
 * touching a post: somebody who follows nobody, or who can enter no room, has
 * no feed and no query should be spent finding that out.
 */
async function feedScope(viewer: {
  memberId: string;
  role: string;
}): Promise<{ groupIds: string[]; authorIds: string[] } | null> {
  const [groupIds, follows] = await Promise.all([
    accessibleGroupIds(viewer.memberId, viewer.role),
    db
      .select({ followedId: communityFollows.followedId })
      .from(communityFollows)
      .where(eq(communityFollows.followerId, viewer.memberId)),
  ]);

  if (groupIds.length === 0 || follows.length === 0) return null;
  return { groupIds, authorIds: follows.map((row) => row.followedId) };
}

/**
 * The rows themselves — one join, one order, one limit.
 *
 * Shared by the page read and the live answer so the two cannot derive
 * different sets: they differ in the cursor's DIRECTION and in nothing else.
 */
async function feedRows(
  scope: { groupIds: string[]; authorIds: string[] },
  where: ReturnType<typeof and>,
  newestFirst: boolean,
): Promise<FeedItem[]> {
  const rows = await db
    .select({
      postId: communityPosts.id,
      discussionId: communityDiscussions.id,
      discussionTitle: communityDiscussions.title,
      groupId: communityGroups.id,
      groupName: communityGroups.name,
      authorId: communityPosts.authorId,
      authorProfileName: communityProfiles.displayName,
      authorAccountName: users.name,
      // One more column on a join that is already there. The alternative — a
      // lookup per author — is the N+1 `avatarUrlFor()`'s header refuses.
      authorAvatarMediaId: communityProfiles.avatarMediaId,
      content: communityPosts.content,
      createdAt: communityPosts.createdAt,
      deletedAt: communityPosts.deletedAt,
      deletedBy: communityPosts.deletedBy,
      hiddenAt: communityPosts.hiddenAt,
    })
    .from(communityPosts)
    .innerJoin(
      communityDiscussions,
      eq(communityDiscussions.id, communityPosts.discussionId),
    )
    // INNER, and that is the embed exclusion: an embedded discussion has no
    // group, so it cannot match and never reaches a feed.
    .innerJoin(
      communityGroups,
      eq(communityGroups.id, communityDiscussions.groupId),
    )
    .leftJoin(users, eq(users.id, communityPosts.authorId))
    .leftJoin(communityProfiles, eq(communityProfiles.memberId, users.id))
    .where(
      and(
        // The people they follow…
        inArray(communityPosts.authorId, scope.authorIds),
        // …in the rooms they may enter RIGHT NOW. Both sets were derived a
        // moment ago from the plans this member holds, never from stored
        // access state.
        inArray(communityDiscussions.groupId, scope.groupIds),
        // A deleted post is not an event to announce. Filtered in SQL as well
        // as judged in the core below — the clause keeps the page bounded (a
        // limit that counted tombstones would return short pages), the core
        // is what decides.
        isNull(communityPosts.deletedAt),
        // Same clause, same reason, for the automatic lock: `feedVisible()`
        // already drops these, so without this the `limit` would spend its
        // budget on rows the core is about to discard and hand back a short
        // page. ⚠️ Not a second opinion about visibility — the core stays the
        // decision, and dropping this line would change how FULL a page is,
        // never what is in it.
        isNull(communityPosts.hiddenAt),
        where,
      ),
    )
    .orderBy(
      newestFirst
        ? desc(communityPosts.createdAt)
        : asc(communityPosts.createdAt),
      newestFirst ? desc(communityPosts.id) : asc(communityPosts.id),
    )
    .limit(FEED_PER_PAGE);

  return rows.filter(feedVisible).map((row) => ({
    postId: row.postId,
    discussionId: row.discussionId,
    // An embedded row's title is NULL and cannot appear here (see the inner
    // join); a scrubbed one is the empty string, which the surface renders as
    // a neutral heading through `titleState()`.
    discussionTitle: row.discussionTitle ?? "",
    groupId: row.groupId,
    groupName: row.groupName,
    authorId: row.authorId,
    authorProfileName: row.authorProfileName,
    authorAccountName: row.authorAccountName,
    authorAvatarMediaId: row.authorAvatarMediaId,
    content: row.content,
    createdAt: row.createdAt,
  }));
}

/**
 * A page of the feed — newest first, older than the cursor.
 *
 * The cursor is the module's one currency (AD-70): an opaque `(createdAt, id)`
 * token the client stores and echoes back. Never an offset — an offset over a
 * list that grows at the top shows the same post twice and skips another.
 *
 * `nextCursor` is `null` when this page is the end of what there is.
 *
 * 🚨 **The authors' pictures are resolved HERE, in one query for the whole
 * page.** Thirty items are routinely written by a handful of people, so the
 * addresses come from `avatarUrlsFor()` — one `media` statement, `mayAccess()`
 * per row, and the answer keyed by media id. Resolving them in the renderer
 * instead is the forty-posts-forty-queries failure `avatarUrlFor()`'s header
 * names; resolving them per item HERE would be the same failure one line lower.
 * `modules/community/lib/avatar-batch.test.ts` counts the statements rather
 * than asserting a shape, because "looks fast" is not the claim.
 */
export async function feedFor(
  viewer: { memberId: string; role: string },
  cursorToken_?: unknown,
): Promise<{ items: FeedItemResolved[]; nextCursor: string | null }> {
  const scope = await feedScope(viewer);
  if (!scope) return { items: [], nextCursor: null };

  const cursor = parseCursorToken(cursorToken_);
  const rows = await feedRows(
    scope,
    cursor
      ? or(
          lt(communityPosts.createdAt, cursor.at),
          and(
            eq(communityPosts.createdAt, cursor.at),
            lt(communityPosts.id, cursor.id),
          ),
        )
      : undefined,
    true,
  );

  const avatars = await avatarUrlsFor(
    rows.map((row) => row.authorAvatarMediaId),
    viewer,
  );
  const items: FeedItemResolved[] = rows.map((row) => ({
    ...row,
    authorAvatarUrl: row.authorAvatarMediaId
      ? (avatars.get(row.authorAvatarMediaId) ?? null)
      : null,
  }));

  const oldest = items[items.length - 1];
  return {
    items,
    // A short page is the end. Handing back a cursor there would make the
    // client ask again for ever on a quiet app.
    nextCursor:
      items.length === FEED_PER_PAGE && oldest
        ? cursorToken({ at: oldest.createdAt, id: oldest.postId })
        : null,
  };
}

/**
 * What is new in the feed since one cursor — the live channel's half.
 *
 * The same derivation, the same token, the other direction. It writes nothing,
 * like every other scope on that endpoint, and it re-checks access on every
 * answer: a member who loses a plan mid-view stops receiving that room's
 * activity on the next poll, which is the property polling buys and a
 * long-lived stream would have to solve while running.
 *
 * ⚠️ **Unlike a thread's scope, a deletion does NOT ride this answer.** A
 * feed item that disappears is not a state change the reader is owed — the
 * post is gone from a list they were skimming, not from a conversation they
 * were in the middle of. Carrying tombstones into a feed would put "this was
 * removed" rows in front of people who never saw the original, which is a
 * worse disclosure than the omission. The thread view is where a deletion is
 * shown, and it has its own scope.
 *
 * ⚠️ **And it deliberately does NOT resolve the authors' pictures**, which is
 * why it answers `FeedItem` where `feedFor()` answers `FeedItemResolved`. The
 * client uses this answer as a SIGNAL — `FeedList` asks the router to refresh
 * when something arrived and the server then renders the new items with their
 * context — so an address minted here would be signed, sent, and never
 * rendered. A signed address that reaches a browser unused is a cost and a
 * small disclosure for nothing.
 */
export async function feedSince(
  viewer: { memberId: string; role: string },
  cursorToken_?: unknown,
): Promise<{ items: FeedItem[]; cursor: string | null; stale: boolean }> {
  const scope = await feedScope(viewer);
  if (!scope) return { items: [], cursor: null, stale: false };

  // `parseLiveCursorToken`, not `parseCursorToken`: it reads the single-position
  // form too, and it is what lets an EMPTY feed say "before everything" instead
  // of saying nothing. While the two were the same `null`, a feed that rendered
  // empty could never be told about its first item — the resync branch answered
  // with no items AND a cursor past whatever had arrived.
  const parsed = parseLiveCursorToken(cursorToken_);
  const cursor = parsed?.created;
  // The second position, for the staleness question. A single-position token
  // reads as both, so an older client simply asks from where it stood.
  const changedCursor = parsed?.changed ?? { at: new Date(0), id: "0" };

  if (!cursor) {
    // A token this build cannot read: resynchronise rather than deliver.
    const newest = await feedRows(scope, undefined, true);
    const first = newest[0];
    return {
      items: [],
      stale: false,
      cursor: first
        ? liveCursorToken({
            created: { at: first.createdAt, id: first.postId },
            changed: { at: first.createdAt, id: first.postId },
          })
        : null,
    };
  }

  const items = await feedRows(
    scope,
    or(
      gt(communityPosts.createdAt, cursor.at),
      and(
        eq(communityPosts.createdAt, cursor.at),
        gt(communityPosts.id, cursor.id),
      ),
    ),
    false,
  );

  // ── The silent half: did something the reader is HOLDING go away? ────────
  //
  // 🚨 **One bit, and deliberately not a row.** The argument above stands for
  // what may be SENT — a tombstone in a feed would put "this was removed" in
  // front of people who never saw the original. It never covered a post
  // already on somebody's screen, and that reader HAS seen it, so nothing is
  // disclosed to them by it going away. Without this, a member who deletes
  // their account left their words on an open feed indefinitely: the client
  // only re-renders when a NEW item arrives, and on a quiet feed there is no
  // next item.
  //
  // Bounded and content-free: the newest changed row, one row, and only its
  // timestamps are read. No ids, no words, and nothing reaches the client but
  // `stale: true`.
  const [changedRow] = await db
    .select({
      deletedAt: communityPosts.deletedAt,
      editedAt: communityPosts.editedAt,
      // The automatic lock is a state change like the other two, and it is the
      // one this feed would otherwise be slowest to notice: an item nobody is
      // adding to, on a quiet feed, sitting on screen after the community took
      // it down. `CHANGED_AT` in the `WHERE` above already counts it — reading
      // it here is what keeps this row's `changedAt()` the same arithmetic.
      hiddenAt: communityPosts.hiddenAt,
    })
    .from(communityPosts)
    .innerJoin(
      communityDiscussions,
      eq(communityDiscussions.id, communityPosts.discussionId),
    )
    .where(
      and(
        inArray(communityPosts.authorId, scope.authorIds),
        inArray(communityDiscussions.groupId, scope.groupIds),
        // Only what this reader could already be holding — a change to
        // something created after their cursor arrives as a normal item.
        lte(communityPosts.createdAt, cursor.at),
        sql`${CHANGED_AT} > ${changedAtParam(changedCursor.at)}`,
      ),
    )
    .orderBy(sql`${CHANGED_AT} desc`)
    .limit(1);

  const changedAtSeen = changedRow ? changedAt(changedRow) : null;
  const stale = changedAtSeen !== null;

  let next = cursor;
  for (const item of items) {
    const candidate = { at: item.createdAt, id: item.postId };
    if (compareCursor(candidate, next) > 0) next = candidate;
  }

  return {
    items,
    stale,
    cursor: liveCursorToken({
      created: next,
      // Advance only past what was actually looked at, so a change landing
      // between two polls is still found by the next one.
      changed: changedAtSeen
        ? { at: changedAtSeen, id: changedCursor.id }
        : changedCursor,
    }),
  };
}
