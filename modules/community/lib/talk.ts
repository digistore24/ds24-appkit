// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { and, asc, count, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { media, users } from "@/db/schema";
import { communityDiscussions, communityGroups, communityPostMedia, communityPosts, communityProfiles } from "../schema";
import { forgetOne, isLimited, record } from "@/lib/rate-limit";
import { mediaConfig } from "@/lib/media/config";
import { formatBytes, slotCeilingBytes } from "@/lib/media/rules";
import { findMedia, mayAccess, type Viewer } from "@/lib/media/manage";
import { mediaImageFor } from "@/lib/media/url";
import { communityConfig } from "./config";
import { findEmbed } from "./embeds";
import { COMMUNITY_POST_RATE_BUCKET, CommunityError, canDeleteOwnPost, canEditOwnPost, canPost, canStartDiscussion, checkDiscussionTitle, checkPostContent, type PostImage, type PostImagePolicy, contentState, mayEnterGroup, mayViewEmbed, planKeysToResolve, postLimit, postVisibleTo } from "./rules";

import { grantedKeysFor } from "./_access";
import { guardSendBlock } from "./_blocks";
import { pageOffset } from "./_paging";
import { PostImageUpload, attachPostImages, discardPostImages, judgePostImages, storePostImages } from "./_post-images";
import { CommunityGroup, groupFor } from "./groups";
import { participationProfile } from "./profiles";

// ───────────────────────────────────────────────────────────────────────────
// Talk — discussions and posts
// ───────────────────────────────────────────────────────────────────────────

/**
 * How many threads a group page shows at once, and how many posts a thread
 * page does.
 *
 * Page-number pagination with LIMIT/OFFSET on the indexes the schema declares.
 * Boring on purpose: "bounded render" is the requirement, and a cursor is the
 * live channel's currency rather than a list's — mixing the two would put two
 * grammars for "what comes next" into one module.
 */
export const DISCUSSIONS_PER_PAGE = 30;
export const POSTS_PER_PAGE = 50;

/**
 * Which page holds the newest content, given how much of it there is.
 *
 * Exists so the thread view can default to the END of a conversation. Posts are
 * ordered oldest-first, so page 1 of a sixty-post thread is the first fifty —
 * and since the read receipt acknowledges the newest post THIS PAGE delivered,
 * opening such a thread normally could never clear its unread dot. The member
 * had to notice the pager and walk to the last page, and there was no
 * jump-to-newest link to notice instead.
 */
export function lastPageOf(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / perPage));
}

/** A thread as a list renders it. */
export interface DiscussionRow {
  id: string;
  groupId: string;
  title: string;
  createdBy: string | null;
  lockedAt: Date | null;
  lastActivityAt: Date;
  createdAt: Date;
  /** The starter's name fields — resolved through `displayNameFor()` by the UI. */
  starterProfileName: string | null;
  starterAccountName: string | null;
}

/**
 * Re-exported so a server caller reading `PostRow` needs no second import — the
 * shape itself lives in the pure core, and its own comment says why.
 */
export type { PostImage };

/** One post, with everything a renderer needs and nothing it does not. */
export interface PostRow {
  id: string;
  authorId: string | null;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  deletedBy: "author" | "moderator" | "system" | null;
  /** The automatic lock — a second axis, never part of the deletion triple. */
  hiddenAt: Date | null;
  removedReason: string | null;
  authorProfileName: string | null;
  authorAccountName: string | null;
  /**
   * The pictures the author attached, in the order they chose.
   *
   * **Empty for a post that is not visible**, on the same line and for the same
   * reason as `content` being blanked: what a server hands a browser is what a
   * reader may see, and an address minted for a tombstoned post is a picture
   * still fetchable out of a page's own payload.
   */
  images: PostImage[];
}

/**
 * The pictures for a LIST of posts — **one query, whatever the list holds.**
 *
 * 🚨 **`mayAccess()` before `mediaImageFor()`, inside this one function** — the
 * invariant `modules/courses/lib/media.ts` states and `avatarUrlsFor()` above
 * keeps for faces. A batch door that handed back ROWS and let the page mint the
 * addresses would be this function with the guarantee removed; a variant is the
 * same row's bytes at another width, so the candidates inherit that one decision
 * and are never authorised separately.
 *
 * ⚠️ **This is why the attachments are a TABLE.** Forty posts is one statement
 * here — `community_posts` → `community_post_media` → `media` — and an
 * `integer[]` of ids on the post row could not be joined at all, so the same
 * page would have cost forty `findMedia()` calls. `CLAUDE.md` states the rule as
 * "forty posts must not be forty queries", and `avatar-batch.test.ts` counts
 * them rather than asserting a shape.
 *
 * The join is INNER on `media`, which is exactly right: `media_id` is `set null`
 * (a picture deleted, an account erased), and a row with nothing behind it has
 * nothing to render. Same three-reasons-one-state ruling as a missing avatar —
 * gone, never there, or not for this viewer are indistinguishable, deliberately.
 */
export async function postImagesFor(
  postIds: readonly string[],
  viewer: Viewer,
): Promise<Map<string, PostImage[]>> {
  const byPost = new Map<string, PostImage[]>();

  // Empty means no query at all: a page of posts with no pictures on it must not
  // cost a statement to find that out. Deduplicated for the same reason
  // `avatarUrlsFor()` deduplicates — a caller assembling ids from two halves of
  // a live answer can legitimately hand the same post twice.
  const wanted = [...new Set(postIds.filter((id) => id !== ""))];
  if (wanted.length === 0) return byPost;

  const rows = await db
    .select({ postId: communityPostMedia.postId, position: communityPostMedia.position, media })
    .from(communityPostMedia)
    .innerJoin(media, eq(media.id, communityPostMedia.mediaId))
    .where(inArray(communityPostMedia.postId, wanted))
    .orderBy(asc(communityPostMedia.postId), asc(communityPostMedia.position));

  for (const row of rows) {
    if (!(await mayAccess(row.media, viewer))) continue;
    const image = mediaImageFor(row.media);
    const list = byPost.get(row.postId) ?? [];
    list.push({
      mediaId: row.media.id,
      src: image.src,
      srcSet: image.srcSet,
      width: image.width,
      height: image.height,
      alt: row.media.alt,
    });
    byPost.set(row.postId, list);
  }

  return byPost;
}

/**
 * What the composer may offer, assembled once on the server.
 *
 * The ceiling is `slotCeilingBytes()` and not the kind's own `maxBytes`: these
 * bytes travel in a **Server Action** body, whose cap is `next.config.ts`'s
 * `bodySizeLimit`, and Next refuses while it DECODES the payload — before the
 * action exists — so an oversized file would otherwise produce an unhandled
 * rejection with no number in it. Same call as the avatar card's
 * (`components/account-card.tsx`), because it is the same door.
 */
export function postImagePolicy(locale: string): PostImagePolicy {
  const ceilingBytes = slotCeilingBytes(mediaConfig().kinds.image.maxBytes);
  return {
    max: communityConfig().posting.imagesMax,
    ceilingBytes,
    maxLabel: formatBytes(ceilingBytes, locale),
  };
}

/**
 * The door a thread is behind, and whether this viewer is through it — `null`
 * when the answer is no, whatever the reason.
 *
 * ⚠️ **Re-derived on EVERY read and EVERY write, never carried over.** A
 * discussion's door is its group's door — or, for an embedded one, its
 * declaration's — and either is answered from the plans the member holds at
 * this moment (AD-60). A page must not resolve access once and let the
 * composer's action trust it: a refund between the render and the submit has
 * to refuse the write, and that is the whole point of deriving rather than
 * storing.
 *
 * ⚠️ **`group` is `null` for an EMBEDDED discussion, and that is the load-
 * bearing half.** The join is a LEFT join for exactly that reason: an embedded
 * row has no `group_id`, so an inner join would have made every embedded
 * thread invisible to `postForViewer()` — a member could post into an embed
 * and then be told their own post did not exist when they tried to edit it.
 * Callers that need a room (`discussionFor()`, the section's pages) refuse a
 * `null` group themselves, which is what keeps an embedded discussion
 * unreachable through `/dashboard/community` where it has no home.
 */
export async function discussionForViewer(
  discussionId: string,
  viewer: { memberId: string; role: string },
): Promise<{
  discussion: typeof communityDiscussions.$inferSelect;
  group: CommunityGroup | null;
} | null> {
  const [row] = await db
    .select({ discussion: communityDiscussions, group: communityGroups })
    .from(communityDiscussions)
    .leftJoin(
      communityGroups,
      eq(communityGroups.id, communityDiscussions.groupId),
    )
    .where(eq(communityDiscussions.id, discussionId))
    .limit(1);
  if (!row) return null;

  // The embedded leg: the access level comes from the declaration, and an
  // undeclared key is refused exactly like an unentitled one (`mayViewEmbed()`
  // merges the two, once).
  if (row.discussion.subjectKey !== null) {
    const declaration = findEmbed(row.discussion.subjectKey);
    const grantedKeys = await grantedKeysFor(
      viewer.memberId,
      planKeysToResolve(declaration ? [declaration] : []),
    );
    if (mayViewEmbed(declaration, { role: viewer.role, grantedKeys })) {
      return null;
    }
    return { discussion: row.discussion, group: null };
  }

  // A room's thread. The check constraint makes a row with neither coordinate
  // impossible, so a missing group here is a room deleted by hand — refused,
  // like every other way of not being in one.
  if (!row.group) return null;

  const grantedKeys = await grantedKeysFor(
    viewer.memberId,
    planKeysToResolve([row.group]),
  );
  if (!mayEnterGroup(row.group, { role: viewer.role, grantedKeys }))
    return null;

  return { discussion: row.discussion, group: row.group };
}

/**
 * The posting brake, asked once per write.
 *
 * Recorded only when the write is about to happen — a refusal further up (no
 * display name, a locked thread) must not spend an allowance, or a member who
 * has not named themselves could lock themselves out by pressing a disabled-
 * looking button.
 */
export function guardPostRate(memberId: string): void {
  const limit = postLimit(communityConfig().posting.maxPer10Min);
  if (isLimited(COMMUNITY_POST_RATE_BUCKET, memberId, limit)) {
    throw new CommunityError("communityPostRateLimited");
  }
  record(COMMUNITY_POST_RATE_BUCKET, memberId, limit);
}

/**
 * Run a write that has already spent an allowance, and give the allowance back
 * if it fails.
 *
 * `guardPostRate()` records BEFORE the write, which is the right order — a
 * check that records afterwards is not a brake for two requests in flight. The
 * cost of that order is that a transaction which then rolls back has charged a
 * member for a post that does not exist, and after a handful of those they are
 * refused for a thread they never started. `forgetOne()` exists in
 * `lib/rate-limit.ts` for exactly this and was not being used.
 *
 * Deliberately NOT a full compensation: it drops one recorded hit, so under a
 * genuine flood the allowance still runs out. It is an undo for the failure
 * case, not a way to retry for free.
 */
export async function releaseRateOnFailure<T>(
  memberId: string,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    forgetOne(COMMUNITY_POST_RATE_BUCKET, memberId);
    throw error;
  }
}

/**
 * Start a thread: a title and its first post, in one transaction.
 *
 * Nothing half-created — a title with no post is a row every renderer would
 * have to special-case, and the one that forgot would show a thread that
 * cannot be replied to because there is nothing to reply under.
 *
 * The order of the checks IS the design: enablement (at the surface) → access
 * → participation → rate limit → write. Core before write, cheapest refusal
 * first, and the allowance spent last.
 */
export async function startDiscussion(
  groupId: string,
  viewer: { memberId: string; role: string },
  input: {
    title: unknown;
    content: unknown;
    images?: readonly PostImageUpload[];
    imageAlts?: readonly unknown[];
  },
): Promise<{ discussionId: string }> {
  const group = await groupFor(groupId, viewer);
  if (!group) throw new CommunityError("notFound");

  const denial = canStartDiscussion(
    await participationProfile(viewer.memberId),
  );
  if (denial) throw new CommunityError(denial);

  // The spam loop's brake. Reading is untouched — a blocked member still sees
  // every room they could see before.
  await guardSendBlock(viewer.memberId);

  const title = checkDiscussionTitle(input.title);
  if (!title.ok) throw new CommunityError(title.code);
  const content = checkPostContent(input.content);
  if (!content.ok) throw new CommunityError(content.code);
  // The pictures, judged before a byte is read: too many, undescribed, or not
  // allowed here at all are all refusals that cost nothing.
  const pictures = judgePostImages(input);

  guardPostRate(viewer.memberId);

  return releaseRateOnFailure(viewer.memberId, async () => {
    // Stored BEFORE the transaction, because a bucket write is not something to
    // hold a database transaction open across — and after every guard above, so
    // nobody who may not post here can reach the store. A failure here throws
    // and has already taken its own objects back.
    const mediaIds = await storePostImages(viewer, pictures.uploads, pictures.alts);

    try {
      return await db.transaction(async (tx) => {
        const now = new Date();
        const [discussion] = await tx
          .insert(communityDiscussions)
          .values({
            groupId,
            title: title.title,
            createdBy: viewer.memberId,
            // The materialization, written inside the post-write transaction and
            // nowhere else (see the schema header). A thread's first post IS
            // activity, so it is set here rather than left to `defaultNow()`.
            lastActivityAt: now,
            createdAt: now,
          })
          .returning();

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

        return { discussionId: discussion.id };
      });
    } catch (error) {
      // The rows rolled back, so nothing points at these objects any more and
      // nothing ever will — the row is the only record they exist.
      await discardPostImages(mediaIds);
      throw error;
    }
  });
}

/**
 * Reply.
 *
 * `lastActivityAt` moves in the same transaction as the row, and this and
 * `startDiscussion()` are the only two places in the module that write it —
 * not an edit (an edit is not new activity), not a deletion (a deletion
 * bumping a thread would resurrect it at the top of the list).
 */
export async function addPost(
  discussionId: string,
  viewer: { memberId: string; role: string },
  input: {
    content: unknown;
    images?: readonly PostImageUpload[];
    imageAlts?: readonly unknown[];
  },
): Promise<{ postId: string }> {
  const found = await discussionForViewer(discussionId, viewer);
  if (!found) throw new CommunityError("notFound");

  const denial = canPost(
    await participationProfile(viewer.memberId),
    found.discussion,
  );
  if (denial) throw new CommunityError(denial);

  await guardSendBlock(viewer.memberId);

  const content = checkPostContent(input.content);
  if (!content.ok) throw new CommunityError(content.code);
  const pictures = judgePostImages(input);

  guardPostRate(viewer.memberId);

  return releaseRateOnFailure(viewer.memberId, async () => {
    // See `storePostImages()`: after every guard, before the transaction.
    const mediaIds = await storePostImages(viewer, pictures.uploads, pictures.alts);

    try {
      return await db.transaction(async (tx) => {
        const now = new Date();
        const [post] = await tx
          .insert(communityPosts)
          .values({
            discussionId,
            authorId: viewer.memberId,
            content: content.content,
            createdAt: now,
          })
          .returning({ id: communityPosts.id });

        await attachPostImages(tx, post.id, mediaIds);

        await tx
          .update(communityDiscussions)
          .set({ lastActivityAt: now })
          .where(eq(communityDiscussions.id, discussionId));

        return { postId: post.id };
      });
    } catch (error) {
      await discardPostImages(mediaIds);
      throw error;
    }
  });
}

/**
 * The room a post is in, and whether this viewer may still be in it.
 *
 * ⚠️ **Every write into the community re-derives access, including the two
 * that only touch a row the member already owns.** Authorship is not the whole
 * question: a member whose plan lapsed is out of the room, and editing a post
 * there is publishing into a room they are not in — the same act as replying,
 * arriving through a different door. Without this, a refunded customer could
 * go back through their own old posts in a paid room and replace them with
 * advertising, one row at a time, and every check would pass because every row
 * is theirs.
 *
 * `null` when the post does not exist, or its room does not, or this viewer
 * may not enter it — one answer, because telling the three apart tells a
 * prober which post ids are real.
 */
async function postForViewer(
  postId: string,
  viewer: { memberId: string; role: string },
): Promise<{
  post: { authorId: string | null; deletedAt: Date | null };
  discussion: { lockedAt: Date | null };
} | null> {
  const [post] = await db
    .select({
      discussionId: communityPosts.discussionId,
      authorId: communityPosts.authorId,
      deletedAt: communityPosts.deletedAt,
    })
    .from(communityPosts)
    .where(eq(communityPosts.id, postId))
    .limit(1);
  if (!post) return null;

  const found = await discussionForViewer(post.discussionId, viewer);
  if (!found) return null;

  // ⚠️ **The discussion comes back too, and that is not convenience.** This
  // used to return the post's two fields and throw the thread away, so
  // `editOwnPost` and `deleteOwnPost` had no way to see `lockedAt` even though
  // the row was already loaded — which is how "locked" came to mean "no new
  // rows" while every participant could still rewrite the posts already there.
  return {
    post: { authorId: post.authorId, deletedAt: post.deletedAt },
    discussion: found.discussion,
  };
}

/**
 * Edit one's own post.
 *
 * ⚠️ **Authorship is in the WHERE clause, not only in the check above it.**
 * The rules layer produces the sentence; the scoped UPDATE is what makes an
 * IDOR impossible — a post id from a form can only ever match a row this
 * member wrote. Both, deliberately: the check alone would be a decision a
 * refactor could route around, the clause alone would be a silent no-op.
 *
 * Access is re-derived first, per AD-60 — see `postForViewer()` for why owning
 * the row is not the whole question.
 *
 * `editedAt` is set and `lastActivityAt` is NOT touched: a reply that answers
 * a sentence which has since changed reads as a non-sequitur, so the edit is
 * disclosed — but it is not new activity and must not pull the thread back to
 * the top of everybody's list.
 *
 * A deleted post cannot be edited back into existence: the WHERE clause
 * demands `deleted_at IS NULL`.
 */
export async function editOwnPost(
  postId: string,
  viewer: { memberId: string; role: string },
  input: { content: unknown },
): Promise<void> {
  const found = await postForViewer(postId, viewer);
  if (!found) throw new CommunityError("notFound");

  // The core decides, then the write happens — the same order as every other
  // path in this module. This call is what refuses an edit into a locked
  // thread; the function used to reach the UPDATE with no core decision at all.
  const denial = canEditOwnPost(found.post, viewer.memberId, found.discussion);
  if (denial) throw new CommunityError(denial);

  const content = checkPostContent(input.content);
  if (!content.ok) throw new CommunityError(content.code);

  // ⚠️ **An edit spends an allowance too.** Without this the brake covered
  // two of the four write paths, and a member who hit `communityPostRateLimited` could
  // simply switch to editing in a loop — the same access re-derivation, the
  // same UPDATE, the same `revalidatePath()`, and none of the brake. A write
  // path with the cost of a post and none of its limit is the way around the
  // limit.
  guardPostRate(viewer.memberId);

  try {
    const [row] = await db
      .update(communityPosts)
      .set({ content: content.content, editedAt: new Date() })
      .where(
        and(
          eq(communityPosts.id, postId),
          eq(communityPosts.authorId, viewer.memberId),
          isNull(communityPosts.deletedAt),
        ),
      )
      .returning({ id: communityPosts.id });

    if (!row) throw new CommunityError("notFound");
  } catch (error) {
    // The allowance goes back when the write did not happen. Spending it on a
    // post that does not exist is a brake applied to nothing, and
    // `lib/rate-limit.ts` ships `forgetOne()` for exactly this.
    forgetOne(COMMUNITY_POST_RATE_BUCKET, viewer.memberId);
    throw error;
  }
}

/**
 * Delete one's own post.
 *
 * ⚠️ **`content` is deliberately NOT scrubbed here**, and the schema comment
 * carries the full argument: a report about a post has to be able to show a
 * moderator what was reported, and "delete it quickly" is the obvious way to
 * dodge one. So the row is hidden from every surface immediately — every
 * renderer asks `contentState()` — and the words survive in the row until the
 * account is deleted, which is the one path that scrubs them.
 *
 * `deleted_at IS NULL` in the WHERE clause is the one-deletion-event rule
 * expressed where it cannot be routed around, and it matters in one direction
 * in particular: an author must not overwrite a moderator's removal and
 * relabel it as their own tidying-up.
 *
 * ⚠️ **Access is re-derived here too**, which means a member who can no longer
 * enter the room cannot delete their old post in it either. That is the
 * consistent reading of AD-60 rather than an oversight, and it costs nothing in
 * practice — the page the button lives on already answers not-found for them,
 * so this only ever refuses a crafted request. Somebody who genuinely wants
 * their words out of a room they have left asks the operator, or deletes their
 * account, which is the path that scrubs every post they ever wrote.
 */
export async function deleteOwnPost(
  postId: string,
  viewer: { memberId: string; role: string },
): Promise<void> {
  const before = await postForViewer(postId, viewer);

  // The sentence comes from the core; the clause below is what enforces it.
  const denial = before
    ? canDeleteOwnPost(before.post, viewer.memberId, before.discussion)
    : ("notFound" as const);
  if (denial) throw new CommunityError(denial);

  const [row] = await db
    .update(communityPosts)
    .set({ deletedAt: new Date(), deletedBy: "author" })
    .where(
      and(
        eq(communityPosts.id, postId),
        eq(communityPosts.authorId, viewer.memberId),
        isNull(communityPosts.deletedAt),
      ),
    )
    .returning({ id: communityPosts.id });

  // ⚠️ **The result is inspected, and that is the difference between a
  // guarantee and a hope.** The WHERE's `deleted_at IS NULL` correctly protects
  // the first deletion event when a moderator's removal commits between the
  // read above and this write — but leaving the outcome unread told the member
  // "your post was deleted" for an act that did nothing, while the record says
  // a moderator removed it. `editOwnPost` throws for the identical race; this
  // one used to stay quiet.
  if (!row) throw new CommunityError("communityAlreadyDeleted");
}

/**
 * One thread, if this viewer may be in the room it is in.
 *
 * Unknown id, archived room, room behind a plan they do not hold: one `null`,
 * one 404 — the same indistinguishable absence the group page answers.
 *
 * ⚠️ **An EMBEDDED discussion answers `null` here too**, and that is the
 * design rather than a gap: it has no room, so `/dashboard/community` has no
 * page to show it on and no breadcrumb to draw. It is reached through the one
 * component that declares it, on the page that carries it — and a Subject Key
 * that could be walked back into the community section would be a second,
 * unguarded door onto the same words.
 */
export async function discussionFor(
  discussionId: string,
  viewer: { memberId: string; role: string },
): Promise<{ discussion: DiscussionRow; group: CommunityGroup } | null> {
  const found = await discussionForViewer(discussionId, viewer);
  if (!found?.group) return null;

  const [starter] = found.discussion.createdBy
    ? await db
        .select({
          profileName: communityProfiles.displayName,
          accountName: users.name,
        })
        .from(users)
        .leftJoin(communityProfiles, eq(communityProfiles.memberId, users.id))
        .where(eq(users.id, found.discussion.createdBy))
        .limit(1)
    : [];

  return {
    discussion: {
      ...found.discussion,
      // The check constraint `title IS NULL ⇔ subject_key IS NOT NULL` makes
      // this non-null for every row that has a group, and the line above has
      // just refused every row that has not. `?? ""` is therefore not a
      // fallback anybody reaches — it is the type system being told what the
      // database already enforces, and `""` reads back through `titleState()`
      // as `scrubbed`, which is the mildest way to be wrong about a row that
      // cannot exist.
      title: found.discussion.title ?? "",
      groupId: found.group.id,
      starterProfileName: starter?.profileName ?? null,
      starterAccountName: starter?.accountName ?? null,
    },
    group: found.group,
  };
}

/**
 * A room's threads, most recently active first, one page at a time.
 *
 * The starter's name fields are JOINED, never fetched per row: thirty threads
 * must not be thirty queries, and `displayNameFor()` takes values for exactly
 * that reason.
 *
 * Ordered by `(lastActivityAt DESC, id)` — the id breaks a tie, so a page
 * boundary cannot show the same thread twice or skip one. Columns only in the
 * ORDER BY: a literal there is a Postgres syntax error that typechecks
 * perfectly on the way to a render.
 */
export async function discussionsFor(
  groupId: string,
  page: number,
): Promise<{ rows: DiscussionRow[]; total: number }> {
  const offset = pageOffset(page, DISCUSSIONS_PER_PAGE);

  const [rows, [counted]] = await Promise.all([
    db
      .select({
        discussion: communityDiscussions,
        profileName: communityProfiles.displayName,
        accountName: users.name,
      })
      .from(communityDiscussions)
      .leftJoin(users, eq(users.id, communityDiscussions.createdBy))
      .leftJoin(communityProfiles, eq(communityProfiles.memberId, users.id))
      .where(eq(communityDiscussions.groupId, groupId))
      .orderBy(
        desc(communityDiscussions.lastActivityAt),
        asc(communityDiscussions.id),
      )
      .limit(DISCUSSIONS_PER_PAGE)
      .offset(offset),
    db
      .select({ value: count() })
      .from(communityDiscussions)
      .where(eq(communityDiscussions.groupId, groupId)),
  ]);

  return {
    rows: rows.map((row) => ({
      ...row.discussion,
      // Both narrowings are the WHERE clause restated for the type checker: it
      // filters on `group_id = …`, and the check constraint makes a row with a
      // group a row with a title. See `discussionFor()` for the full argument.
      groupId,
      title: row.discussion.title ?? "",
      starterProfileName: row.profileName,
      starterAccountName: row.accountName,
    })),
    total: counted?.value ?? 0,
  };
}

/**
 * A thread's posts, oldest first, one page at a time.
 *
 * Deleted posts are RETURNED, not filtered out: their tombstone is what keeps
 * the thread readable, and `contentState()` decides what each one renders as.
 * What must never leave this function is the `content` of a row that is not
 * visible — so it is blanked here, once, rather than trusted to every
 * renderer. A word that never reaches the browser cannot be read out of a
 * page's own payload.
 */
export async function postsFor(
  discussionId: string,
  page: number | "last",
  viewer: Viewer,
): Promise<{ rows: PostRow[]; total: number; page: number }> {
  const countPosts = db
    .select({ value: count() })
    .from(communityPosts)
    .where(eq(communityPosts.discussionId, discussionId));

  // ⚠️ **"last" costs a round trip, and it is worth it.** The offset cannot be
  // computed without knowing how many posts there are, so the count runs first
  // instead of beside the rows. A thread opened with no explicit page is opened
  // at its end — which is where a conversation is — and that is also what makes
  // the read receipt able to acknowledge the newest post rather than the
  // fiftieth-oldest.
  const total = page === "last" ? ((await countPosts)[0]?.value ?? 0) : null;
  const resolved =
    page === "last" ? lastPageOf(total ?? 0, POSTS_PER_PAGE) : page;

  const rowsAt = (offset: number) =>
    db
      .select({
        post: communityPosts,
        profileName: communityProfiles.displayName,
        accountName: users.name,
      })
      .from(communityPosts)
      .leftJoin(users, eq(users.id, communityPosts.authorId))
      .leftJoin(communityProfiles, eq(communityProfiles.memberId, users.id))
      .where(eq(communityPosts.discussionId, discussionId))
      .orderBy(asc(communityPosts.createdAt), asc(communityPosts.id))
      .limit(POSTS_PER_PAGE)
      .offset(offset);

  const [firstRows, counted] =
    total === null
      ? await Promise.all([
          rowsAt(pageOffset(resolved, POSTS_PER_PAGE)),
          countPosts.then((r) => r[0]?.value ?? 0),
        ])
      : [await rowsAt(pageOffset(resolved, POSTS_PER_PAGE)), total];

  // ⚠️ **The page a caller asked for is clamped at BOTH ends, and only here.**
  // `pageOffset()` bounds the low end so the driver gets something it can
  // serialise; the high end needs the count, which is why it cannot live there
  // and says so. Without this, `?page=99` on a two-page thread answers
  // `page: 99, rows: []` — and every renderer downstream then draws a heading
  // over a blank area, because "is there anything here" and "am I past the end"
  // look identical from the outside. The re-read costs a second round trip and
  // fires only when somebody typed a page number past the end, which is the
  // only way that state is ever reached.
  const wanted = Math.max(1, Math.floor(Number.isFinite(resolved) ? resolved : 1));
  const current = Math.min(wanted, lastPageOf(counted, POSTS_PER_PAGE));
  const rows =
    current === wanted
      ? firstRows
      : await rowsAt(pageOffset(current, POSTS_PER_PAGE));

  // ⚠️ **ONE query for the whole page's pictures**, and only for the posts whose
  // words a reader may see — a tombstone's attachments are not fetched, so there
  // is no address to blank afterwards and nothing to forget to blank. The door
  // asks `mayAccess()` before it mints anything (`postImagesFor()`).
  // ⚠️ `postVisibleTo()` and not `contentState()`, because a locked post is not
  // the same fact for everybody: its own author is shown it, so their pictures
  // are fetched and everybody else's are not.
  const showsWords = (row: { post: { authorId: string | null; deletedAt: Date | null; deletedBy: "author" | "moderator" | "system" | null; hiddenAt: Date | null } }) =>
    postVisibleTo(contentState(row.post), row.post.authorId, viewer.memberId) ===
    "words";
  const visibleIds = rows.filter(showsWords).map((row) => row.post.id);
  const images = await postImagesFor(visibleIds, viewer);

  return {
    page: current,
    rows: rows.map((row) => ({
      ...row.post,
      // The words of a hidden post do not travel. `deleteOwnPost` keeps them
      // in the ROW on purpose (the report queue needs them), and this is the
      // line that keeps that decision from becoming a disclosure: what a
      // server component receives is what a reader may see.
      content: showsWords(row) ? row.post.content : "",
      // ⚠️ **Blanked HERE as well as excluded from the statement above**, and the
      // redundancy is deliberate — the same shape `content` has. The `where`
      // clause is what makes the query cheap; this line is what makes the claim
      // TRUE, locally, in the function that hands the browser its payload. A
      // guarantee that lives only in a filter is one a later `inArray` edit can
      // take away silently, and `post-images.test.ts` asserts it on a mixed page
      // for exactly that reason.
      images: showsWords(row) ? (images.get(row.post.id) ?? []) : [],
      authorProfileName: row.profileName,
      authorAccountName: row.accountName,
    })),
    total: counted,
  };
}
