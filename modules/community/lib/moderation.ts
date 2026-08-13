// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { cache } from "react";
import { and, count, desc, eq, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { communityDiscussions, communityGroupModerators, communityModerationAudit, communityPosts } from "../schema";
import { isOwner } from "@/lib/roles";
import { record } from "@/lib/rate-limit";
import { CommunityError, lockProblem, mayModerate, removalProblem } from "./rules";

import { pageOffset } from "./_paging";
import { lastPageOf } from "./talk";

// ───────────────────────────────────────────────────────────────────────────
// Moderation — the authority is re-read, and every act writes its own record
// ───────────────────────────────────────────────────────────────────────────
//
// 🚨 **Authority comes from the DATABASE, at the moment of the act. Never from
// the session.** Sessions here are JWTs and carry the role somebody had when
// they signed in — so an operator who takes the moderator role away at eleven
// would otherwise find it still working until that person's token expires.
// This is `lib/users/blocked.ts`'s argument for the account block, applied to
// the second thing in this app that is a power over other people's data
// (AD-63). `moderation-guard.test.ts` drives an act with a session claiming
// `moderator` over a database row that says `member`, and proves the refusal
// comes from the re-read.
//
// 🚨 **The trail is append-only, and nothing here can write to it twice.**
// There is no update path and no delete path for an audit row anywhere in this
// module — a lock and its later unlock are two rows. An editable trail is not
// a trail: its whole value is that the person who acted cannot revise it, and
// the cheapest guarantee is to ship no function that could. The same test
// reads this file and fails the build if one appears.

/** What the database says about somebody's power, right now. */
export interface ModerationAuthority {
  role: string;
  blockedAt: Date | null;
  /** The rooms a duty row names them for. Empty for the operator, who needs none. */
  duties: string[];
}

/**
 * Read somebody's authority fresh.
 *
 * One round trip for the account, one for the duties, and neither is cached
 * anywhere — a `cache()` here would be per-request, which is fine, and per
 * SESSION, which would be the bug this whole function exists to prevent. It is
 * called at the top of every act and every moderation surface.
 */
export async function moderationAuthority(
  actorId: string,
): Promise<ModerationAuthority | null> {
  const [[account], duties] = await Promise.all([
    db
      .select({ role: users.role, blockedAt: users.blockedAt })
      .from(users)
      .where(eq(users.id, actorId))
      .limit(1),
    db
      .select({ groupId: communityGroupModerators.groupId })
      .from(communityGroupModerators)
      .where(eq(communityGroupModerators.memberId, actorId)),
  ]);

  if (!account) return null;
  return {
    role: account.role,
    blockedAt: account.blockedAt,
    duties: duties.map((row) => row.groupId),
  };
}

/**
 * The authority check every act opens with — refusing with `notFound`.
 *
 * ⚠️ **One code for "you may not" and "there is no such thing".** A member who
 * probes the moderation actions learns nothing about which rooms have
 * moderators or which posts exist; the 20.1 indistinguishability precedent,
 * applied to power instead of to content.
 */
export async function requireModerator(
  actorId: string,
  groupId: string | null,
): Promise<void> {
  const authority = await moderationAuthority(actorId);
  if (!authority) throw new CommunityError("notFound");
  const denial = mayModerate(authority, groupId, authority.duties);
  if (denial) throw new CommunityError(denial);
}

/**
 * Remove somebody else's post, with a stated reason.
 *
 * The order is the module's: authority (re-read) → the row and its room → the
 * core decision → the write, and the audit row in the SAME transaction as the
 * write. An act whose record failed to save would be a moderation decision
 * nobody can review, so the two succeed together or neither does.
 *
 * ⚠️ **The words are NOT scrubbed.** `deletedAt` / `deletedBy` hide the post
 * from every surface at once through `contentState()`, and the text stays in
 * the row — because a report about a post has to be able to show what was
 * reported, and because the author's own subject access request should still
 * answer with their words. The account deletion is what erases them (21.4).
 */
export async function removePostAsModerator(input: {
  actorId: string;
  postId: string;
  reason: unknown;
}): Promise<void> {
  const [row] = await db
    .select({
      postId: communityPosts.id,
      authorId: communityPosts.authorId,
      deletedAt: communityPosts.deletedAt,
      discussionId: communityPosts.discussionId,
      groupId: communityDiscussions.groupId,
    })
    .from(communityPosts)
    .innerJoin(
      communityDiscussions,
      eq(communityDiscussions.id, communityPosts.discussionId),
    )
    .where(eq(communityPosts.id, input.postId))
    .limit(1);
  if (!row) throw new CommunityError("notFound");

  await requireModerator(input.actorId, row.groupId);

  const problem = removalProblem(row, input.reason);
  if (problem) throw new CommunityError(problem);
  const reason = (input.reason as string).trim();

  await db.transaction(async (tx) => {
    const removed = await tx
      .update(communityPosts)
      .set({
        deletedAt: new Date(),
        deletedBy: "moderator",
        removedReason: reason,
      })
      .where(
        and(
          eq(communityPosts.id, input.postId),
          // The one-deletion-event rule in the WHERE as well as in the core:
          // the check produces the sentence, the clause is what refuses the
          // write when the read above it has gone stale.
          isNull(communityPosts.deletedAt),
        ),
      )
      .returning({ id: communityPosts.id });

    // ⚠️ **No act, no row.** The clause above protects the UPDATE; it used to
    // protect nothing else, and the INSERT two lines down ran unconditionally.
    // So an author deleting their own post in the gap between the read and the
    // write left a moderator's removal REASON in the trail for something the
    // moderator never removed — and `docs/data-protection.md` sends that reason
    // into both subject-access exports, so the member is handed it. The pure
    // core already names the refusal; this is the same one, decided a moment
    // later against the row rather than against a copy of it.
    if (removed.length === 0) throw new CommunityError("communityAlreadyDeleted");

    await tx.insert(communityModerationAudit).values({
      actorId: input.actorId,
      act: "removePost",
      targetMemberId: row.authorId,
      postId: row.postId,
      discussionId: row.discussionId,
      reason,
    });
  });
}

/**
 * Close a thread to new posts, or open it again.
 *
 * ⚠️ **Unlocking appends its OWN row.** It is not an edit of the lock's row
 * and never will be: "this was locked on Tuesday and opened on Thursday" is
 * two facts, and a trail that recorded only the current state would answer
 * "was this ever closed?" with silence.
 *
 * The lock is enforced in the core on every write path already
 * (`canPost()` / `canEditOwnPost()` / `canDeleteOwnPost()` return
 * `communityDiscussionLocked`), so this function only moves the state.
 */
export async function setDiscussionLocked(input: {
  actorId: string;
  discussionId: string;
  locked: boolean;
}): Promise<void> {
  const [row] = await db
    .select({
      id: communityDiscussions.id,
      groupId: communityDiscussions.groupId,
      lockedAt: communityDiscussions.lockedAt,
      createdBy: communityDiscussions.createdBy,
    })
    .from(communityDiscussions)
    .where(eq(communityDiscussions.id, input.discussionId))
    .limit(1);
  if (!row) throw new CommunityError("notFound");

  await requireModerator(input.actorId, row.groupId);

  const problem = lockProblem(row, input.locked);
  if (problem) throw new CommunityError(problem);

  await db.transaction(async (tx) => {
    const moved = await tx
      .update(communityDiscussions)
      .set({ lockedAt: input.locked ? new Date() : null })
      .where(
        and(
          eq(communityDiscussions.id, input.discussionId),
          // ⚠️ **The state this act expects to find, in the WHERE.** The read
          // above happens outside the transaction, so two moderators locking
          // the same thread both passed `lockProblem()` and both wrote — one
          // lock, two `lockDiscussion` rows, and the second write moved the
          // timestamp of the first. `lockProblem()`'s own reasoning is that "a
          // trail with rows for acts that changed nothing is a trail nobody
          // trusts"; this is that sentence as a clause.
          input.locked
            ? isNull(communityDiscussions.lockedAt)
            : isNotNull(communityDiscussions.lockedAt),
        ),
      )
      .returning({ id: communityDiscussions.id });

    // No act, no row — the same refusal the core makes, a moment later.
    if (moved.length === 0) {
      throw new CommunityError(input.locked ? "communityAlreadyLocked" : "communityNotLocked");
    }

    await tx.insert(communityModerationAudit).values({
      actorId: input.actorId,
      act: input.locked ? "lockDiscussion" : "unlockDiscussion",
      // The thread's starter is the closest thing to a subject a lock has, and
      // it is who the act is about from their side.
      targetMemberId: row.createdBy,
      discussionId: row.id,
    });
  });
}

/** One row of the trail, as the moderation page renders it. */
export interface AuditRow {
  id: string;
  act: string;
  actorId: string | null;
  actorName: string | null;
  targetMemberId: string | null;
  postId: string | null;
  discussionId: string | null;
  reason: string | null;
  createdAt: Date;
}

/** How many trail rows one page holds. */
export const AUDIT_PER_PAGE = 50;

/**
 * The trail — everything for the operator, their own acts for a moderator.
 *
 * ⚠️ **The narrowing is in the QUERY, never in the template.** A page that
 * fetched every row and rendered a subset would have shipped the rest in its
 * own payload; and the filter is derived from the authority read here rather
 * than passed in, so no caller can widen it.
 */
export async function moderationTrail(
  actorId: string,
  page: number = 1,
): Promise<{ rows: AuditRow[]; total: number; page: number } | null> {
  const authority = await moderationAuthority(actorId);
  if (!authority) return null;
  if (mayModerate(authority, null, authority.duties)) return null;

  const mine = isOwner(authority.role)
    ? undefined
    : eq(communityModerationAudit.actorId, actorId);

  const [{ total }] = await db
    .select({ total: count() })
    .from(communityModerationAudit)
    .where(mine);

  const pages = lastPageOf(total, AUDIT_PER_PAGE);
  const current = Math.min(Math.max(1, page), pages);

  const rows = await db
    .select({
      id: communityModerationAudit.id,
      act: communityModerationAudit.act,
      actorId: communityModerationAudit.actorId,
      actorName: users.name,
      targetMemberId: communityModerationAudit.targetMemberId,
      postId: communityModerationAudit.postId,
      discussionId: communityModerationAudit.discussionId,
      reason: communityModerationAudit.reason,
      createdAt: communityModerationAudit.createdAt,
    })
    .from(communityModerationAudit)
    .leftJoin(users, eq(users.id, communityModerationAudit.actorId))
    .where(mine)
    .orderBy(desc(communityModerationAudit.createdAt))
    .limit(AUDIT_PER_PAGE)
    .offset(pageOffset(current, AUDIT_PER_PAGE));

  return { rows, total, page: current };
}
