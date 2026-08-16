// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { cache } from "react";
import { and, count, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { grants, users } from "@/db/schema";
import { communityMemberStanding, communitySpamReports } from "../schema";
import { communityConfig } from "./config";
import {
  CommunityError,
  NO_STANDING,
  blockThresholdWeight,
  reporterWeight,
  sendBlockState,
  type MemberStanding,
  type SendBlockState,
} from "./rules";

/**
 * The refusal every WRITE path asks, and no read path does.
 *
 * ⚠️ **Blocked means silenced, never blinded.** A blocked member keeps reading
 * everything they could read before — the rooms, their inbox, the feed. Taking
 * their reading away would punish them for what somebody else reported, before
 * anybody looked at it.
 *
 * 🚨 **Two refusals, two sentences, and never one code for both.** The
 * hand-written block is checked FIRST and answers `communityWriteBlocked`;
 * the automatic one answers `communitySendBlocked`, whose sentence tells the
 * member there are reports against them. Collapsing them would send somebody an
 * operator silenced by hand off to look for reports that do not exist — which
 * is the opposite of the neutral-refusal rule elsewhere in this module, and
 * deliberately so: `canDeliverTo()` blurs its causes because naming one would
 * expose a THIRD party's decision to be left alone. Here the decision is the
 * operator's own and is about the person reading the sentence, so being clear
 * costs nobody anything.
 */
export async function guardSendBlock(memberId: string): Promise<void> {
  const standing = await standingFor(memberId);
  if (standing.writeBlocked) throw new CommunityError("communityWriteBlocked");
  const state = await sendBlockFor(memberId);
  if (state.blocked) throw new CommunityError("communitySendBlocked");
}

/**
 * The operator's standing decisions about one member, or none.
 *
 * `cache()`d per REQUEST, like the block itself: a write and its guard in the
 * same request must see one answer. No row means on no list — the two states
 * are the same, which is why the table holds no row for an ordinary member.
 */
export const standingFor = cache(async function standingFor(
  memberId: string,
): Promise<MemberStanding> {
  const [row] = await db
    .select({
      protectedAt: communityMemberStanding.protectedAt,
      writeBlockedAt: communityMemberStanding.writeBlockedAt,
      reportsIgnoredAt: communityMemberStanding.reportsIgnoredAt,
    })
    .from(communityMemberStanding)
    .where(eq(communityMemberStanding.memberId, memberId))
    .limit(1);
  if (!row) return NO_STANDING;
  return {
    protected: row.protectedAt !== null,
    writeBlocked: row.writeBlockedAt !== null,
    reportsIgnored: row.reportsIgnoredAt !== null,
  };
});

/** Everything `reporterWeight()` needs about one member, read in one sweep. */
export interface ReporterFacts {
  memberDays: number;
  paidGrants: number;
  reportsMade: number;
  reportsAgainst: number;
  reportsIgnored: boolean;
}

const NO_FACTS: ReporterFacts = {
  memberDays: 0,
  paidGrants: 0,
  reportsMade: 0,
  reportsAgainst: 0,
  reportsIgnored: false,
};

/**
 * The weighting facts for a whole SET of reporters — **four questions, one
 * round trip, whatever the set holds.**
 *
 * 🚨 **This is the price of computing the weight instead of storing it, and
 * paying it in one query is the whole reason that choice is affordable.**
 * `sendBlockFor()` runs on every write path; `openReports()` annotates a page
 * of fifty. Asking four questions per reporter would be the N+1 this module's
 * own `postImagesFor()` exists to refuse — "forty posts must not be forty
 * queries" — with the twist that here N is attacker-influenced, since reporting
 * is what creates rows.
 *
 * Three aggregates plus the standing row, grouped by member. Not `cache()`d
 * itself: the caching that matters happens one level up at `sendBlockFor()`,
 * which is keyed by a string and therefore actually hits. A `cache()` on an
 * array argument would key on the array's identity and miss every time, which
 * is worse than none because it reads as if it worked.
 */
export async function reporterFactsFor(
  ids: readonly string[],
): Promise<Map<string, ReporterFacts>> {
  const unique = [...new Set(ids)];
  const facts = new Map<string, ReporterFacts>();
  if (unique.length === 0) return facts;

  const now = new Date();
  const rows = await db
    .select({
      id: users.id,
      createdAt: users.createdAt,
      reportsIgnoredAt: communityMemberStanding.reportsIgnoredAt,
      // Correlated subqueries rather than joins: three independent one-to-many
      // relations joined at once multiply each other's rows, and the counts
      // would come back as products of one another. Each rides an index whose
      // leading column is the one being matched — `grants_member`,
      // `community_spam_reports_reporter`, `community_spam_reports_open`.
      //
      // 🚨 **"Now" is the DATABASE's, never the `now` above.** Inside a raw
      // `sql` fragment there is no column mapper, so a JS `Date` reaches
      // postgres.js unencoded and the driver throws `ERR_INVALID_ARG_TYPE` —
      // which took out every spam report in the module, because this sweep runs
      // on the reporter of the row `reportContent()` has just inserted. It
      // typechecked and no test saw it: the whole guard suite reads this file as
      // TEXT, and nothing ran the query. `(now() at time zone 'utc')` is the
      // house form for this exact question — `lib/entitlements/manage.ts` asks
      // it of this very column that way. The `now` below stays: that one is
      // arithmetic in JS and never travels into SQL.
      paidGrants: sql<number>`(
        select count(*) from ${grants}
        where ${grants.memberId} = ${users.id}
          and ${grants.source} = 'purchase'
          and ${grants.endedAt} is null
          and ${grants.suspendedAt} is null
          and (${grants.accessUntil} is null
               or ${grants.accessUntil} > (now() at time zone 'utc'))
      )`.mapWith(Number),
      reportsMade: sql<number>`(
        select count(*) from ${communitySpamReports}
        where ${communitySpamReports.reporterId} = ${users.id}
      )`.mapWith(Number),
      reportsAgainst: sql<number>`(
        select count(*) from ${communitySpamReports}
        where ${communitySpamReports.reportedMemberId} = ${users.id}
      )`.mapWith(Number),
    })
    .from(users)
    .leftJoin(
      communityMemberStanding,
      eq(communityMemberStanding.memberId, users.id),
    )
    .where(inArray(users.id, unique));

  for (const row of rows) {
    facts.set(row.id, {
      // Whole days, floored: a member of eleven hours is a member of no days.
      // ⚠️ Elapsed time, not calendar days — this is a duration rather than a
      // date, so `APP_TIME_ZONE` has no business in it and the daylight-saving
      // trap `docs/conventions.md` warns about does not apply.
      memberDays: Math.max(
        0,
        Math.floor(
          (now.getTime() - row.createdAt.getTime()) / (24 * 60 * 60 * 1000),
        ),
      ),
      paidGrants: row.paidGrants,
      reportsMade: row.reportsMade,
      reportsAgainst: row.reportsAgainst,
      reportsIgnored: row.reportsIgnoredAt !== null,
    });
  }
  return facts;
}

/**
 * The weights for a set of reporters, ready for the pure core.
 *
 * A member the sweep found nothing for weighs **nothing**, not one: the only
 * way to be missing from `users` is to have been deleted, and a deleted account
 * does not get to keep silencing somebody. `sendBlockState()` drops a zero.
 */
export async function reporterWeightsFor(
  ids: readonly string[],
): Promise<Map<string, number>> {
  const config = communityConfig().weighting;
  const facts = await reporterFactsFor(ids);
  const weights = new Map<string, number>();
  for (const id of new Set(ids)) {
    const row = facts.get(id);
    weights.set(id, row ? reporterWeight({ ...row, config }) : 0);
  }
  return weights;
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

  const [[account], reports, standing] = await Promise.all([
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
    standingFor(memberId),
  ]);

  // One sweep for however many distinct reporters this member has, and only
  // for the rows that could still count — the query above already dropped the
  // consumed and the out-of-window ones, so nothing is weighed that the core
  // is about to throw away.
  const weights = await reporterWeightsFor(
    reports.map((row) => row.reporterId).filter((id) => id !== null),
  );

  return sendBlockState({
    reports: reports.map((row) => ({
      ...row,
      weight: row.reporterId ? (weights.get(row.reporterId) ?? 0) : 0,
    })),
    role: account?.role ?? "member",
    protected: standing.protected,
    thresholdWeight: blockThresholdWeight(config.threshold),
    windowHours: config.windowHours,
    expiryDays: config.expiryDays,
    now: new Date(),
  });
});
