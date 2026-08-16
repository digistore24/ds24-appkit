// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { cache } from "react";
import { and, count, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { grants, users } from "@/db/schema";
import {
  communityMemberStanding,
  communityPosts,
  communitySpamReports,
} from "../schema";
import { communityConfig } from "./config";
import {
  CommunityError,
  NO_STANDING,
  blockThresholdWeight,
  countLinks,
  graceLimitsFor,
  graceProblem,
  reporterWeight,
  sendBlockState,
  type GraceLimits,
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
export async function guardSendBlock(
  memberId: string,
  act: WriteAct,
): Promise<void> {
  const standing = await standingFor(memberId);
  if (standing.writeBlocked) throw new CommunityError("communityWriteBlocked");
  const state = await sendBlockFor(memberId);
  if (state.blocked) throw new CommunityError("communitySendBlocked");

  // The grace comes LAST, after both blocks. A member who is silenced and also
  // two hours old must be told they are silenced — the grace is a sentence
  // about being new, and it would read as the reason when it is not.
  //
  // Only posts are counted here. A direct message is braked by the tighter
  // ten-minute bucket in `messages.ts` instead, which needs no query of its own
  // and answers a question a daily count cannot: the shape unwanted contact
  // takes is five conversations in five minutes, not thirty over a day.
  if (act !== "post") return;
  const grace = await graceFor(memberId);
  if (!grace) return;
  const problem = graceProblem(grace, {
    kind: "postCount",
    postsInLast24h: await postsInLast24h(memberId),
  });
  if (problem) throw new CommunityError(problem, undefined, graceDetail(grace));
}

/**
 * Which kind of write is being guarded. **Required, and that is the design.**
 *
 * 🚨 `moderation-guard.test.ts` asserts this guard's reach by COUNTING calls to
 * it, which can say how many callers there are and never whether the set is
 * complete — `openConversation()` sat outside that count for months. A required
 * parameter does not close that hole either, but it closes the next one: a
 * write path added a year from now cannot call this guard *wrongly* without
 * `npm run typecheck` saying so, and the compiler needs nobody to remember it.
 *
 * A plain union rather than an object carrying ids: nothing here needs one, and
 * a field with no reader is a field the next person fills in wrongly.
 */
export type WriteAct = "post" | "dm";

/**
 * The grace this member is under, or `null` — derived, stored nowhere.
 *
 * `cache()`d per REQUEST like the block: a post's guard and its link check
 * happen in one request and must agree, and the next request asks again. Both
 * halves it reads are themselves cached, so this costs one derivation and no
 * query beyond the row `sendBlockFor()` was already fetching.
 */
export const graceFor = cache(async function graceFor(
  memberId: string,
): Promise<GraceLimits | null> {
  const [writer, standing] = await Promise.all([
    writerFactsFor(memberId),
    standingFor(memberId),
  ]);
  return graceLimitsFor({
    memberHours: writer.memberHours,
    paidGrants: writer.paidGrants,
    role: writer.role,
    protected: standing.protected,
    config: communityConfig().newMember,
  });
});

/** What the two grace sentences need to name themselves. Never a member id. */
function graceDetail(grace: GraceLimits): Record<string, number> {
  // ⚠️ **Numbers, not strings, and that is not tidiness.** Both sentences are
  // ICU plurals (`{max, plural, one {one post} other {# posts}}`), and a plural
  // handed a string does not pluralise — it renders the "other" branch or
  // throws, depending on the formatter's mood. `CommunityError.detail` carries
  // `string | number` for exactly this.
  return { max: grace.maxPostsPerDay, hours: grace.hoursLeft };
}

/**
 * Posts this member has written in the last 24 hours.
 *
 * ⚠️ **Only ever asked of a member who IS in their grace**, which in an app
 * that sells access to its community is nobody. It rides
 * `community_posts_author (author_id, created_at, id)` — no migration, and no
 * new index to keep.
 *
 * Deleted posts count. A member who writes five, deletes them and writes five
 * more has written ten, and a limit that could be reset by deleting is not one.
 */
async function postsInLast24h(memberId: string): Promise<number> {
  const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ n: count() })
    .from(communityPosts)
    .where(
      and(
        eq(communityPosts.authorId, memberId),
        gt(communityPosts.createdAt, from),
      ),
    );
  return row?.n ?? 0;
}

/**
 * The links half of the grace, asked once the content is known.
 *
 * Separate from `guardSendBlock()` because of WHEN it can be asked: the guard
 * runs before `checkPostContent()`, on input that is still `unknown`. Pulling
 * the content check above the block would invert the module's documented order
 * — access → participation → block → content → brake — and a silenced member
 * would be told their post is too long.
 */
export async function guardGraceLinks(
  memberId: string,
  content: string,
): Promise<void> {
  const grace = await graceFor(memberId);
  if (!grace) return;
  const problem = graceProblem(grace, { kind: "links", links: countLinks(content) });
  if (problem) throw new CommunityError(problem, undefined, graceDetail(grace));
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

/**
 * "How many live purchased grants does this member hold", as a fragment.
 *
 * 🚨 **One definition, two callers, and that is the point.** `reporterFactsFor()`
 * weighs a reporter with it and `writerFactsFor()` exempts a buyer with it. Two
 * copies would be two answers to "has this person paid" that agree today, and
 * the day they stopped agreeing a customer would be throttled by the grace
 * while their report still counted as a paying member's — a discrepancy nothing
 * could report because each half would be self-consistent.
 *
 * 🚨 **`(now() at time zone 'utc')`, never a JS `Date`.** Inside a raw `sql`
 * fragment there is no column mapper, so a `Date` reaches postgres.js unencoded
 * and the driver throws `ERR_INVALID_ARG_TYPE` — which once took out every spam
 * report in the module, typechecked, with the whole guard suite green because it
 * reads this file as TEXT and nothing ran the query.
 */
export function paidGrantsFragment() {
  return sql<number>`(
    select count(*) from ${grants}
    where ${grants.memberId} = ${OUTER_MEMBER_ID}
      and ${grants.source} = 'purchase'
      and ${grants.endedAt} is null
      and ${grants.suspendedAt} is null
      and (${grants.accessUntil} is null
           or ${grants.accessUntil} > (now() at time zone 'utc'))
  )`.mapWith(Number);
}

/**
 * The outer query's member id, QUALIFIED — `"users"."id"`.
 *
 * 🚨 **Interpolating `users.id` here renders `"id"`, unqualified, and that is
 * silently wrong rather than an error.** Inside `select … from "grants"` the
 * bare name `"id"` resolves to the GRANT's own id, so
 * `where "member_id" = "id"` is a correlation to the wrong table: it is
 * false for every row and the count is always 0. Postgres raises nothing —
 * both tables have an `id`.
 *
 * ⚠️ **It was wrong for a long time and nothing could see it.** The three
 * subqueries in `reporterFactsFor()` were written this way, and their only
 * consumer is `reporterWeight()`, which returns early while `weighting` ships
 * OFF — so `paidGrants`, `reportsMade` and `reportsAgainst` were 0 in every
 * app, every unit test passed (they hand the pure function its numbers
 * directly), and the defect had no symptom. It surfaced the day the grace
 * became a second, always-on consumer: a member with a live purchase was
 * throttled anyway, found by posting in a real app rather than by any test.
 *
 * `sql.identifier()` rather than a raw string so the quoting stays drizzle's.
 * `_blocks.sql.test.ts` reads the generated SQL and fails on the bare form.
 */
const OUTER_MEMBER_ID = sql`${sql.identifier("users")}.${sql.identifier("id")}`;

/** Everything the WRITE path needs about the member doing the writing. */
export interface WriterFacts {
  role: string;
  /** Elapsed whole hours since the account was created. */
  memberHours: number;
  paidGrants: number;
}

/**
 * The writer's own facts — role, age and whether they have paid — in ONE query.
 *
 * 🚨 **This costs nothing, and that is what lets the grace ship switched on.**
 * `sendBlockFor()` already read a row from `users` on every write path to get
 * the role; `createdAt` sits in that same row and `paidGrants` is the subquery
 * `reporterFactsFor()` was already running beside it. So the floor under a free
 * room is not a query per post — it is three columns where there were one.
 *
 * `cache()`d per REQUEST like everything else here: a write, its send-block
 * guard and its grace check happen in one request and must see one answer.
 *
 * ⚠️ **The hours are computed in JS, deliberately.** This is elapsed time, not a
 * calendar date, so `APP_TIME_ZONE` has no business in it — the same ruling
 * `reporterFactsFor()`'s `memberDays` carries one function down.
 */
export const writerFactsFor = cache(async function writerFactsFor(
  memberId: string,
): Promise<WriterFacts> {
  const now = Date.now();
  const [row] = await db
    .select({
      role: users.role,
      createdAt: users.createdAt,
      paidGrants: paidGrantsFragment(),
    })
    .from(users)
    .where(eq(users.id, memberId))
    .limit(1);

  // No row means the account is gone. "member" and no grants is the closed
  // reading of both questions it feeds, which is where an absent account
  // belongs.
  if (!row) return { role: "member", memberHours: 0, paidGrants: 0 };

  return {
    role: row.role,
    memberHours: Math.max(
      0,
      Math.floor((now - row.createdAt.getTime()) / (60 * 60 * 1000)),
    ),
    paidGrants: row.paidGrants,
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
      // 🚨 **"Now" is the DATABASE's, never the `now` above** — the reasoning,
      // and the outage it is about, are at `paidGrantsFragment()`, which is
      // where this question is defined for both of its callers. The `now` below
      // stays: that one is arithmetic in JS and never travels into SQL.
      paidGrants: paidGrantsFragment(),
      // ⚠️ `OUTER_MEMBER_ID`, never `${users.id}` — see its comment. These two
      // counted 0 for every member in every app until 2026-08-16.
      reportsMade: sql<number>`(
        select count(*) from ${communitySpamReports}
        where ${communitySpamReports.reporterId} = ${OUTER_MEMBER_ID}
      )`.mapWith(Number),
      reportsAgainst: sql<number>`(
        select count(*) from ${communitySpamReports}
        where ${communitySpamReports.reportedMemberId} = ${OUTER_MEMBER_ID}
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

  const [writer, reports, standing] = await Promise.all([
    // The same row this used to read for the role alone — see `writerFactsFor()`
    // for why it now brings two more columns back and why that is free.
    writerFactsFor(memberId),
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
    role: writer.role,
    protected: standing.protected,
    thresholdWeight: blockThresholdWeight(config.threshold),
    windowHours: config.windowHours,
    expiryDays: config.expiryDays,
    now: new Date(),
  });
});
