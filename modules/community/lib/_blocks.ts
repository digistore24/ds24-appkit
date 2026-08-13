// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { cache } from "react";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { communitySpamReports } from "../schema";
import { communityConfig } from "./config";
import { CommunityError, sendBlockState, type SendBlockState } from "./rules";

/**
 * The refusal every WRITE path asks, and no read path does.
 *
 * ⚠️ **Blocked means silenced, never blinded.** A blocked member keeps reading
 * everything they could read before — the rooms, their inbox, the feed. Taking
 * their reading away would punish them for what somebody else reported, before
 * anybody looked at it.
 */
export async function guardSendBlock(memberId: string): Promise<void> {
  const state = await sendBlockFor(memberId);
  if (state.blocked) throw new CommunityError("communitySendBlocked");
}

/**
 * The send-block, derived for one member.
 *
 * 🚨 **This is the whole of the block — there is no table to read** (AD-64).
 * The shell fetches the frozen report rows and the target's role (fresh, per
 * AD-63) and hands them to the pure core, which re-derives nothing.
 *
 * `cache()`d per REQUEST, not per session: a post write and its guard in the
 * same request must see one answer, and the next request must ask again.
 */
export const sendBlockFor = cache(async function sendBlockFor(
  memberId: string,
): Promise<SendBlockState> {
  const config = communityConfig().sendBlock;
  const from = new Date(
    Date.now() - config.windowHours * 60 * 60 * 1000,
  );

  const [[account], reports] = await Promise.all([
    db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, memberId))
      .limit(1),
    db
      .select({
        reporterId: communitySpamReports.reporterId,
        createdAt: communitySpamReports.createdAt,
        consumedAt: communitySpamReports.consumedAt,
      })
      .from(communitySpamReports)
      .where(
        and(
          eq(communitySpamReports.reportedMemberId, memberId),
          isNull(communitySpamReports.consumedAt),
          gt(communitySpamReports.createdAt, from),
        ),
      ),
  ]);

  return sendBlockState({
    reports,
    role: account?.role ?? "member",
    threshold: config.threshold,
    windowHours: config.windowHours,
    expiryDays: config.expiryDays,
    now: new Date(),
  });
});
