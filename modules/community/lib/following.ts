// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { and, count, desc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { communityFollows, communityMemberBlocks, communityProfiles } from "../schema";
import { record } from "@/lib/rate-limit";
import { CommunityError, canFollow } from "./rules";

import { participationProfile } from "./profiles";

// ───────────────────────────────────────────────────────────────────────────
// Following — one-sided, immediate, and visible on the other person's list
// ───────────────────────────────────────────────────────────────────────────

/** One person on one of the two lists. */
export interface FollowRow {
  memberId: string;
  profileName: string | null;
  accountName: string | null;
  createdAt: Date;
}

/**
 * Is there a member block between these two, in either direction?
 *
 * The DM send path's probe, lifted out so the follow path asks the same
 * question rather than a second one shaped slightly differently. One boolean
 * by design: a caller that could see WHO blocked whom could answer the
 * question the neutral refusal exists not to answer.
 */
async function blockBetween(one: string, other: string): Promise<boolean> {
  const rows = await db
    .select({ id: communityMemberBlocks.id })
    .from(communityMemberBlocks)
    .where(
      or(
        and(
          eq(communityMemberBlocks.blockerId, one),
          eq(communityMemberBlocks.blockedId, other),
        ),
        and(
          eq(communityMemberBlocks.blockerId, other),
          eq(communityMemberBlocks.blockedId, one),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Follow another member.
 *
 * No request, no approval, no pending state — the row IS the follow, and the
 * row is also the visibility: the followed member sees the follower on their
 * own list because it exists, not because anything told them.
 *
 * Insert-on-conflict-do-nothing: a double tap is not an error, and two taps in
 * the same moment are decided by the unique index rather than by a read that
 * raced.
 *
 * The follower is always the caller's own id — the surfaces take the TARGET
 * from the request and never the actor, the same guarantee `blockMember()`
 * gives.
 */
export async function followMember(
  followerId: string,
  followedId: string,
): Promise<void> {
  // Both facts, then one decision in the core. The target's account state is
  // read for the same reason the DM path reads it: an account that is gone or
  // closed is not somebody to follow, and it must refuse with the same code a
  // block does.
  const [[target], blocked, profile] = await Promise.all([
    db
      .select({ blockedAt: users.blockedAt })
      .from(users)
      .where(eq(users.id, followedId))
      .limit(1),
    blockBetween(followerId, followedId),
    participationProfile(followerId),
  ]);

  const denial = canFollow(profile, {
    self: followerId === followedId,
    target: target ?? null,
    blockedEitherWay: blocked,
  });
  if (denial) throw new CommunityError(denial);

  await db
    .insert(communityFollows)
    .values({ followerId, followedId })
    .onConflictDoNothing({
      target: [communityFollows.followerId, communityFollows.followedId],
    });
}

/**
 * Stop following.
 *
 * Deletion, never a flag — the same ruling the block gets one function up, and
 * for the same reason: a "no longer following" marker would be a record of who
 * once followed whom, which nobody asked this app to keep.
 *
 * The WHERE names the caller as the follower, so this can only ever remove
 * one's own row. There is deliberately no way to remove a FOLLOWER: being
 * followed is visible rather than approved, and a "remove this follower"
 * control would be the approval step FR-219 refuses, arriving from the other
 * end. Somebody who does not want to be followed blocks (21.2), which severs
 * it and stops it coming back.
 */
export async function unfollowMember(
  followerId: string,
  followedId: string,
): Promise<void> {
  await db
    .delete(communityFollows)
    .where(
      and(
        eq(communityFollows.followerId, followerId),
        eq(communityFollows.followedId, followedId),
      ),
    );
}

/** Does this member follow that one? For the button's own state. */
export async function isFollowing(
  followerId: string,
  followedId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: communityFollows.id })
    .from(communityFollows)
    .where(
      and(
        eq(communityFollows.followerId, followerId),
        eq(communityFollows.followedId, followedId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * This member's two lists: whom they follow, and who follows them.
 *
 * ⚠️ **Scoped by signature, like the DM readers.** It takes ONE member id and
 * answers only about relationships that member is part of. There is no reader
 * anywhere for somebody else's lists and no reader for the graph — "you get
 * the relationships you are in, never the picture" is the whole of NFR-35's
 * slicing here.
 *
 * ⚠️ **It returns people, never a number.** No count is computed here or
 * anywhere else: how many people follow somebody is a fact about those people,
 * and a number is the cheapest way to start describing a paid room's
 * population. The lists are bounded because the surface pages them, not
 * because a total is available.
 */
export async function followsFor(
  memberId: string,
  limit: number = FOLLOWS_PER_PAGE,
): Promise<{ following: FollowRow[]; followedBy: FollowRow[] }> {
  const [following, followedBy] = await Promise.all([
    db
      .select({
        memberId: communityFollows.followedId,
        profileName: communityProfiles.displayName,
        accountName: users.name,
        createdAt: communityFollows.createdAt,
      })
      .from(communityFollows)
      .leftJoin(users, eq(users.id, communityFollows.followedId))
      .leftJoin(communityProfiles, eq(communityProfiles.memberId, users.id))
      .where(eq(communityFollows.followerId, memberId))
      .orderBy(desc(communityFollows.createdAt))
      .limit(limit),

    db
      .select({
        memberId: communityFollows.followerId,
        profileName: communityProfiles.displayName,
        accountName: users.name,
        createdAt: communityFollows.createdAt,
      })
      .from(communityFollows)
      .leftJoin(users, eq(users.id, communityFollows.followerId))
      .leftJoin(communityProfiles, eq(communityProfiles.memberId, users.id))
      .where(eq(communityFollows.followedId, memberId))
      .orderBy(desc(communityFollows.createdAt))
      .limit(limit),
  ]);

  return { following, followedBy };
}

/**
 * How many people one list page holds.
 *
 * A bound rather than a page count: the lists are read in full up to this
 * many, and there is deliberately no total beside them (see `followsFor()`).
 * Somebody who follows more people than this sees the most recent — which is
 * the honest behaviour for a list whose purpose is "the people worth not
 * losing", and it costs no aggregate.
 */
export const FOLLOWS_PER_PAGE = 100;
