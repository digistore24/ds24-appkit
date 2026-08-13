// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { cache } from "react";
import { and, asc, count, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { communityDiscussions, communityMessages, communityModerationAudit, communityPosts, communitySpamReports, communityProfiles } from "../schema";
import { isOwner } from "@/lib/roles";
import { isLimited, record } from "@/lib/rate-limit";
import { communityConfig } from "./config";
import { COMMUNITY_REPORT_RATE_BUCKET, MAX_MODERATION_REASON_LENGTH, CommunityError, conflictOfInterest, mayConsumeReport, contentState, mayModerate, reportLimit, reportProblem, sendBlockState, windowMessageIds } from "./rules";

import { sendBlockFor } from "./_blocks";
import { pageOffset } from "./_paging";
import { MessageRow, conversationForParticipant, toMessageRow } from "./messages";
import { moderationAuthority, requireModerator } from "./moderation";
import { participationProfile } from "./profiles";
import { discussionForViewer, lastPageOf } from "./talk";

// ───────────────────────────────────────────────────────────────────────────
// Spam reports — decided once, then frozen
// ───────────────────────────────────────────────────────────────────────────
//
// 🚨 **AD-71: eligibility is checked at the moment of the report and never
// again.** Everything else in this module derives access at read time; this is
// the deliberate exception, because a report is an EVENT rather than an access
// question. "An eligible member said this was spam on Tuesday" does not stop
// being true on Wednesday — and if it did, a spammer could clear the reports
// against them by getting the reporters' access revoked.
//
// ⚠️ **`reportedMemberId` is written into the row, not joined at read time.**
// A join would follow the content's author column, which goes NULL when that
// account is deleted — and the send-block derived from these rows would
// quietly stop existing at the moment it mattered most.

/** The report bucket, asked once per report. */
function guardReportRate(memberId: string): void {
  const limit = reportLimit(communityConfig().report.maxPer10Min);
  if (isLimited(COMMUNITY_REPORT_RATE_BUCKET, memberId, limit)) {
    throw new CommunityError("communityReportRateLimited");
  }
  record(COMMUNITY_REPORT_RATE_BUCKET, memberId, limit);
}

/**
 * Report a post, or a private message.
 *
 * Exactly one of `postId` / `messageId`, matching the table's check
 * constraint. The two legs differ in how "could the reporter read this" is
 * answered — a room's door for a post, participant-ship for a message — and in
 * nothing else.
 *
 * ⚠️ **A second report of the same content by the same member is absorbed, not
 * refused.** The partial unique index decides it, and the caller is told the
 * report landed: a member tapping twice is not doing anything wrong, and an
 * error would tell them their first tap failed.
 */
export async function reportContent(input: {
  reporterId: string;
  postId?: string;
  messageId?: string;
  reason?: unknown;
  /** Story 23.3's bounded window — ids from the reporter's OWN conversation. */
  attachedMessageIds?: string[];
}): Promise<void> {
  // ⚠️ The role is read from the DATABASE, not taken from a caller. A
  // moderators-only room is readable by a moderator, so a hardcoded "member"
  // here would refuse the report of the one person most likely to file it.
  const [[account], profile] = await Promise.all([
    db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, input.reporterId))
      .limit(1),
    participationProfile(input.reporterId),
  ]);
  const role = account?.role ?? "member";

  let reportedMemberId: string | null = null;
  let readable = false;
  let own = false;
  let conversationId: string | null = null;

  if (input.postId) {
    const [row] = await db
      .select({
        authorId: communityPosts.authorId,
        discussionId: communityPosts.discussionId,
      })
      .from(communityPosts)
      .where(eq(communityPosts.id, input.postId))
      .limit(1);
    if (row) {
      // The SAME access derivation the read path uses — FR-211's "eligible
      // means members who could read the reported content themselves", and a
      // second arithmetic here would drift from the one that decides what is
      // on screen.
      const viewer = { memberId: input.reporterId, role };
      const found = await discussionForViewer(row.discussionId, viewer);
      readable = found !== null;
      reportedMemberId = row.authorId;
      own = row.authorId === input.reporterId;
    }
  } else if (input.messageId) {
    const [row] = await db
      .select({
        authorId: communityMessages.authorId,
        conversationId: communityMessages.conversationId,
      })
      .from(communityMessages)
      .where(eq(communityMessages.id, input.messageId))
      .limit(1);
    if (row) {
      // Participant-ship, through the one scoped resolver — so the report path
      // cannot read a conversation the reporter is not in, any more than any
      // other DM path can.
      const conversation = await conversationForParticipant(
        input.reporterId,
        row.conversationId,
      );
      readable = conversation !== null;
      reportedMemberId = row.authorId;
      own = row.authorId === input.reporterId;
      conversationId = row.conversationId;
    }
  } else {
    throw new CommunityError("notFound");
  }

  const problem = reportProblem({ readable, own, profile });
  if (problem) throw new CommunityError(problem);

  // The TARGET's role, for the crossing check — role-holders are never
  // auto-blocked (see `sendBlockState()`), and reading it here keeps the
  // transaction short.
  let targetRole = "member";
  if (reportedMemberId) {
    const [target] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, reportedMemberId))
      .limit(1);
    targetRole = target?.role ?? "member";
  }

  const reason =
    typeof input.reason === "string" && input.reason.trim() !== ""
      ? input.reason.trim().slice(0, MAX_MODERATION_REASON_LENGTH)
      : null;

  // ── The bounded window (AD-71) ─────────────────────────────────────────────
  //
  // 🚨 Bounded HERE, against the config and against the CONVERSATION — never
  // by the form. Every id the reporter sends is checked to be in the same
  // conversation as the reported message before it can widen what a moderator
  // sees; an id from somewhere else is dropped silently rather than refused,
  // because a refusal would tell the reporter whether that other id exists.
  //
  // A group-post report attaches nothing, ever: `attached` stays NULL and the
  // interface never offers it.
  let window: string[] | null = null;
  if (input.messageId && conversationId) {
    const siblings = input.attachedMessageIds?.length
      ? await db
          .select({ id: communityMessages.id })
          .from(communityMessages)
          .where(
            and(
              eq(communityMessages.conversationId, conversationId),
              inArray(communityMessages.id, input.attachedMessageIds),
            ),
          )
      : [];

    window = windowMessageIds({
      reportedId: input.messageId,
      attached: input.attachedMessageIds ?? [],
      sameConversation: siblings.map((row) => row.id),
      max: communityConfig().report.attachmentMax,
    });
  }

  // What is STORED on the report is the context the reporter chose — the
  // reported message is already named by `messageId` and is not repeated.
  const attached = window && window.length > 1 ? window.slice(1) : null;

  guardReportRate(input.reporterId);

  await db.transaction(async (tx) => {
    await tx
      .insert(communitySpamReports)
      .values({
        reporterId: input.reporterId,
        reportedMemberId,
        postId: input.postId ?? null,
        messageId: input.messageId ?? null,
        reason,
        attachedMessageIds: attached,
      })
      .onConflictDoNothing();

    // 🚨 **The visibility event, in the SAME transaction as the report.** A
    // report that granted a moderator sight of part of a private conversation
    // WITHOUT its record cannot exist — that is the whole of AD-71's
    // accountability half, and it is why this is one transaction rather than
    // two statements that usually both run.
    //
    // `exposedMessageIds` is exactly what will be shown: the reported message
    // first, then the context the reporter chose. Not a range, not a
    // neighbourhood, not "the conversation".
    if (window) {
      await tx.insert(communityModerationAudit).values({
        // The REPORTER is the actor of this act — they are the one who decided
        // to show it. A moderator reading the queue later is not: they were
        // shown what somebody handed them.
        actorId: input.reporterId,
        act: "dmVisibility",
        targetMemberId: reportedMemberId,
        exposedMessageIds: window,
      });
    }

    // ── AD-64: the crossing, recorded exactly once ──────────────────────────
    //
    // The block itself is a derivation and is stored nowhere. What IS worth
    // recording is the EVENT — the moment it crossed — because a member asking
    // "why can I not write" and a moderator asking "when did this start" both
    // need an answer, and a derivation has no history.
    //
    // ⚠️ **Only on the crossing.** The state before this insert is compared
    // with the state after it, inside the transaction: a second report while
    // the block already stands changes nothing and appends nothing.
    //
    // 🚨 **Two racing reports are serialised on the TARGET's row, and it has to
    // be a row both of them can see.** The `SELECT … FOR UPDATE` below used to
    // be the whole of the claim, and it cannot be: `FOR UPDATE` locks the rows
    // present in the statement's own snapshot, and under READ COMMITTED each
    // transaction has already inserted a report the other cannot see. So
    // neither counted the other, and a spam wave — several members reporting
    // one account within seconds, which is the feature's designed scenario —
    // produced either TWO `sendBlockFallen` rows for one crossing, or, one
    // reporter earlier, NONE at all while the member was silenced anyway. Both
    // questions the block exists to answer ("why can I not write", "when did
    // this start") then have no answer.
    //
    // Locking `users` first fixes it because that row exists before either
    // transaction started: the second one waits, and its next statement takes a
    // fresh snapshot that includes the first one's report.
    if (reportedMemberId) {
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, reportedMemberId))
        .for("update");

      const rows = await tx
        .select({
          reporterId: communitySpamReports.reporterId,
          createdAt: communitySpamReports.createdAt,
          consumedAt: communitySpamReports.consumedAt,
        })
        .from(communitySpamReports)
        .where(eq(communitySpamReports.reportedMemberId, reportedMemberId))
        .for("update");

      const blockConfig = communityConfig().sendBlock;
      const now = new Date();
      const state = sendBlockState({
        reports: rows,
        role: targetRole,
        threshold: blockConfig.threshold,
        windowHours: blockConfig.windowHours,
        expiryDays: blockConfig.expiryDays,
        now,
      });

      // Was it already blocked WITHOUT this report? If so the state did not
      // change and there is nothing to record.
      const before = sendBlockState({
        reports: rows.filter(
          (row) => row.reporterId !== input.reporterId,
        ),
        role: targetRole,
        threshold: blockConfig.threshold,
        windowHours: blockConfig.windowHours,
        expiryDays: blockConfig.expiryDays,
        now,
      });

      if (state.blocked && !before.blocked) {
        await tx.insert(communityModerationAudit).values({
          // Nobody decided this — it fell. The actor is NULL, and that is the
          // honest answer: an audit row with a moderator's name on an
          // automatic act would be a person credited with a threshold.
          actorId: null,
          act: "sendBlockFallen",
          targetMemberId: reportedMemberId,
          exposedMessageIds: state.reporterIds,
        });
      }
    }
  });
}

/**
 * Lift a standing block: consume everything counted against the member.
 *
 * 🚨 **The lift IS the consumption.** There is no block state to clear, so
 * "lifted" means the reports that derived it are marked dealt-with — which
 * also completes any deferred scrub they were holding open (23.3), and which
 * is why re-blocking needs FRESH reports rather than the same judged set.
 *
 * Site-wide power: no group duty is required, because a block is not about a
 * room. Refused for a moderator whose own report is among the counted ones —
 * somebody who reported a member is not the person to judge whether that
 * report should stand. The operator is never conflicted out; somebody must
 * always be able to act.
 */
export async function liftSendBlock(input: {
  actorId: string;
  memberId: string;
}): Promise<void> {
  const authority = await moderationAuthority(input.actorId);
  if (!authority) throw new CommunityError("notFound");
  const denial = mayModerate(authority, null, authority.duties);
  if (denial) throw new CommunityError(denial);

  const state = await sendBlockFor(input.memberId);
  const conflict = conflictOfInterest(
    { id: input.actorId, role: authority.role },
    state.reporterIds,
  );
  if (conflict) throw new CommunityError(conflict);

  await db.transaction(async (tx) => {
    const consumed = await tx
      .update(communitySpamReports)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(communitySpamReports.reportedMemberId, input.memberId),
          isNull(communitySpamReports.consumedAt),
        ),
      )
      .returning({ id: communitySpamReports.id });

    await tx.insert(communityModerationAudit).values({
      actorId: input.actorId,
      act: "blockLifted",
      targetMemberId: input.memberId,
      // The ids that were judged, so "which reports did this lift cover" has
      // an answer a year later.
      exposedMessageIds: consumed.map((row) => row.id),
    });
  });
}

/**
 * The members standing auto-blocked right now, for the queue's banner.
 *
 * ⚠️ **Derived, like the block itself.** The candidate set comes from the
 * unconsumed reports — there is no list of blocked members to read — and each
 * candidate is then put through the same pure function every send path asks.
 * Bounded by how many members currently have open reports, which is the
 * queue's own size.
 */
export async function standingSendBlocks(actorId: string): Promise<
  Array<{
    memberId: string;
    name: string | null;
    since: Date;
    reporterIds: string[];
    /** May THIS moderator lift it? The core decides; the button obeys. */
    conflicted: boolean;
  }> | null
> {
  const authority = await moderationAuthority(actorId);
  if (!authority) return null;
  if (mayModerate(authority, null, authority.duties)) return null;

  const candidates = await db
    .selectDistinct({ memberId: communitySpamReports.reportedMemberId })
    .from(communitySpamReports)
    .where(isNull(communitySpamReports.consumedAt));

  const standing: Array<{
    memberId: string;
    name: string | null;
    since: Date;
    reporterIds: string[];
    conflicted: boolean;
  }> = [];

  for (const candidate of candidates) {
    if (!candidate.memberId) continue;
    const state = await sendBlockFor(candidate.memberId);
    if (!state.blocked || !state.since) continue;
    const [account] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, candidate.memberId))
      .limit(1);
    standing.push({
      memberId: candidate.memberId,
      name: account?.name ?? null,
      since: state.since,
      reporterIds: state.reporterIds,
      conflicted:
        conflictOfInterest(
          { id: actorId, role: authority.role },
          state.reporterIds,
        ) !== null,
    });
  }

  return standing;
}

/** One report, as the queue renders it. */
export interface SpamReportRow {
  id: string;
  reporterId: string | null;
  reportedMemberId: string | null;
  postId: string | null;
  messageId: string | null;
  reason: string | null;
  attachedMessageIds: string[] | null;
  createdAt: Date;
  consumedAt: Date | null;
}

/** How many reports one page of the queue holds. */
export const REPORTS_PER_PAGE = 50;

/**
 * The open queue — unconsumed reports, oldest first.
 *
 * Oldest first, deliberately, where every other list in this module is newest
 * first: a queue is worked through, and the report that has been waiting
 * longest is the one that should be looked at next.
 *
 * ⚠️ **Whoever may read this is re-read from the database**, like every other
 * moderation surface, and `null` is the answer for anybody who may not.
 */
export async function openReports(
  actorId: string,
  page: number = 1,
): Promise<{
  rows: (SpamReportRow & { conflicted: boolean })[];
  total: number;
  page: number;
} | null> {
  const authority = await moderationAuthority(actorId);
  if (!authority) return null;
  if (mayModerate(authority, null, authority.duties)) return null;

  // ⚠️ **The queue shows what this moderator may ACT on, and nothing else.**
  // It used to list every open report in the installation, so a moderator of
  // the free welcome room saw — and could open — a post reported inside a
  // plan-gated course. Listing rows whose detail page now refuses would be the
  // other half of the same mistake: a queue full of doors that do not open.
  //
  // Group-less rows stay visible to every moderator on purpose: a DM belongs to
  // no room, an embedded discussion hangs off a page, and `mayModerate()`'s
  // group-less answer is the decided one for both.
  const open = isNull(communitySpamReports.consumedAt);
  const mine = isOwner(authority.role)
    ? open
    : and(
        open,
        or(
          isNull(communityDiscussions.groupId),
          inArray(communityDiscussions.groupId, authority.duties),
        ),
      );

  // The joins are what make `community_discussions.group_id` reachable, and
  // both queries carry them so the count and the page describe one set.
  const [{ total }] = await db
    .select({ total: count() })
    .from(communitySpamReports)
    .leftJoin(
      communityPosts,
      eq(communityPosts.id, communitySpamReports.postId),
    )
    .leftJoin(
      communityDiscussions,
      eq(communityDiscussions.id, communityPosts.discussionId),
    )
    .where(mine);

  const pages = lastPageOf(total, REPORTS_PER_PAGE);
  const current = Math.min(Math.max(1, page), pages);

  const picked = await db
    .select({ report: communitySpamReports })
    .from(communitySpamReports)
    .leftJoin(
      communityPosts,
      eq(communityPosts.id, communitySpamReports.postId),
    )
    .leftJoin(
      communityDiscussions,
      eq(communityDiscussions.id, communityPosts.discussionId),
    )
    .where(mine)
    .orderBy(asc(communitySpamReports.createdAt))
    .limit(REPORTS_PER_PAGE)
    .offset(pageOffset(current, REPORTS_PER_PAGE));
  const rows = picked.map((row) => row.report);

  // Whether this moderator may act on each row, decided by the same function
  // `consumeReport()` refuses with — so the button and the server answer come
  // from one rule rather than two that agree today. `sendBlockFor()` is
  // `cache()`d per member per request, so a page of reports about three people
  // costs three derivations, not fifty.
  const annotated = await Promise.all(
    rows.map(async (row) => {
      const block = row.reportedMemberId
        ? await sendBlockFor(row.reportedMemberId)
        : { blocked: false as const, reporterIds: [] };
      return {
        ...row,
        conflicted:
          mayConsumeReport({ id: actorId, role: authority.role }, row, block) !==
          null,
      };
    }),
  );

  return { rows: annotated, total, page: current };
}

/**
 * Mark a report dealt with.
 *
 * ⚠️ **Consuming is what makes the automatic send-block liftable** (AD-64):
 * the block is derived from UNCONSUMED rows, so a moderator who looks at a
 * report and decides it was noise removes it from the derivation by consuming
 * it — no separate "lift the block" state, and nothing to keep in step.
 *
 * The row is not deleted: it stays as the record that somebody reported
 * something and it was dealt with, and `community-prune` is what eventually
 * removes it by age.
 */
/**
 * Which room a report is about — `null` when it is about nothing that lives in
 * one.
 *
 * ⚠️ **This exists because `null` meant two different things at two ends of the
 * same call.** `mayModerate(actor, null, duties)` is the GROUP-LESS case, and
 * its answer — operator, plus any moderator holding a duty somewhere — is a
 * recorded decision (FR-206, and Story 23.3 reuses it for DM reports on
 * purpose: "one function already owns the question"). The report readers used
 * to pass `null` unconditionally, which silently turned that decision into
 * "duty scoping does not apply to reports at all". So a moderator of the free
 * welcome room could read a post reported inside a plan-gated course.
 *
 * The module's own rule is one sentence long and this restores it: **the role
 * says WHAT somebody is, the duty says WHERE they act.**
 *
 * Group-less stays group-less, deliberately: a DM belongs to no room, and an
 * embedded discussion hangs off a page rather than a group. Both keep the
 * decided answer.
 */
async function roomOfReport(reportId: string): Promise<string | null> {
  const [row] = await db
    .select({ groupId: communityDiscussions.groupId })
    .from(communitySpamReports)
    .leftJoin(
      communityPosts,
      eq(communityPosts.id, communitySpamReports.postId),
    )
    .leftJoin(
      communityDiscussions,
      eq(communityDiscussions.id, communityPosts.discussionId),
    )
    .where(eq(communitySpamReports.id, reportId))
    .limit(1);
  return row?.groupId ?? null;
}

/**
 * Is this moderator conflicted on this report?
 *
 * The read-only twin of the refusal inside `consumeReport()`, for the surfaces
 * that want to show the rule instead of letting somebody walk into it. It
 * decides nothing on its own — the server refuses again on every act.
 */
export async function reportConflictFor(
  actorId: string,
  reportId: string,
): Promise<boolean> {
  const authority = await moderationAuthority(actorId);
  if (!authority) return false;
  if (mayModerate(authority, null, authority.duties)) return false;

  const [row] = await db
    .select({
      reporterId: communitySpamReports.reporterId,
      reportedMemberId: communitySpamReports.reportedMemberId,
    })
    .from(communitySpamReports)
    .where(eq(communitySpamReports.id, reportId))
    .limit(1);
  if (!row) return false;

  const block = row.reportedMemberId
    ? await sendBlockFor(row.reportedMemberId)
    : { blocked: false as const, reporterIds: [] };
  return (
    mayConsumeReport({ id: actorId, role: authority.role }, row, block) !== null
  );
}

export async function consumeReport(input: {
  actorId: string;
  reportId: string;
}): Promise<void> {
  // The authority is read rather than only asserted, because the conflict
  // decision below needs the actor's role — the same shape `liftSendBlock()`
  // uses, which is the sibling refusal this one was missing.
  const authority = await moderationAuthority(input.actorId);
  if (!authority) throw new CommunityError("notFound");
  // Scoped by the report's own room, like both readers above it.
  const denial = mayModerate(
    authority,
    await roomOfReport(input.reportId),
    authority.duties,
  );
  if (denial) throw new CommunityError(denial);

  const [report] = await db
    .select({
      id: communitySpamReports.id,
      postId: communitySpamReports.postId,
      messageId: communitySpamReports.messageId,
      reportedMemberId: communitySpamReports.reportedMemberId,
      reporterId: communitySpamReports.reporterId,
      consumedAt: communitySpamReports.consumedAt,
    })
    .from(communitySpamReports)
    .where(eq(communitySpamReports.id, input.reportId))
    .limit(1);
  if (!report || report.consumedAt) return;

  // ⚠️ **The conflict is re-decided here, on the server, from the database.**
  // The button is disabled for a conflicted moderator, and a disabled button is
  // not a permission — this is the refusal. It reads the block fresh rather
  // than taking anything from the request, the same way `liftSendBlock()` does.
  const block = report.reportedMemberId
    ? await sendBlockFor(report.reportedMemberId)
    : { blocked: false as const, reporterIds: [] };
  const conflict = mayConsumeReport(
    { id: input.actorId, role: authority.role },
    report,
    block,
  );
  if (conflict) throw new CommunityError(conflict);

  await db.transaction(async (tx) => {
    await tx
      .update(communitySpamReports)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(communitySpamReports.id, input.reportId),
          // Advance-only in spirit: consuming twice must not move the
          // timestamp, because the first consumption is when it was actually
          // dealt with.
          isNull(communitySpamReports.consumedAt),
        ),
      );

    await tx.insert(communityModerationAudit).values({
      actorId: input.actorId,
      act: "consumeReport",
      targetMemberId: report.reportedMemberId,
      postId: report.postId,
    });

    // ── The deferred scrub completes here ─────────────────────────────────
    //
    // An author who deletes their own post keeps its words in the row, and
    // `db/schema-community.ts` says why: a report has to be able to show a
    // moderator what was reported, and "delete it quickly" is the obvious way
    // to dodge one. That deferral has to END somewhere, or an author's
    // deletion would be permanently half-done.
    //
    // It ends here, at the moment the LAST unconsumed report referencing that
    // row is dealt with. What the author asked for then happens: the words go,
    // the tombstone stays. Nothing schedules this and nothing has to — the act
    // that removes the reason for keeping the words is the act that removes
    // them.
    await completeDeferredScrub(tx, report);
  });
}

/**
 * Finish an author's own deletion once no unconsumed report needs the words.
 *
 * Takes the transaction, like every other scrub in this module: the check for
 * remaining reports and the emptying have to see the same moment, or two
 * moderators consuming the last two reports at once would each decide the
 * other one still needs it.
 */
async function completeDeferredScrub(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  report: { id: string; postId: string | null; messageId: string | null },
): Promise<void> {
  if (report.postId) {
    const [post] = await tx
      .select({
        deletedAt: communityPosts.deletedAt,
        deletedBy: communityPosts.deletedBy,
        content: communityPosts.content,
      })
      .from(communityPosts)
      .where(eq(communityPosts.id, report.postId))
      .limit(1);
    // Only an AUTHOR's own deletion is deferred. A moderator's removal keeps
    // its words for the same reason it always did, and a live post is not
    // being deleted at all.
    if (!post || post.deletedBy !== "author" || post.content === "") return;

    const others = await tx
      .select({ id: communitySpamReports.id })
      .from(communitySpamReports)
      .where(
        and(
          eq(communitySpamReports.postId, report.postId),
          isNull(communitySpamReports.consumedAt),
          ne(communitySpamReports.id, report.id),
        ),
      )
      .limit(1);
    if (others.length > 0) return;

    await tx
      .update(communityPosts)
      .set({ content: "" })
      .where(eq(communityPosts.id, report.postId));
  }
}

/**
 * The reported post, with the words an author's own deletion deferred.
 *
 * ⚠️ **This is the one reader that does NOT blank an author-deleted post**, and
 * it is the whole reason the deferral exists: `db/schema-community.ts` says an
 * author-deleted post keeps its words "until either the report is dealt with
 * or the account is deleted", because "delete it quickly" is the obvious way
 * to dodge a report. A queue that showed the tombstone would make that dodge
 * work.
 *
 * It still refuses two things: a post an ACCOUNT DELETION scrubbed (there are
 * no words left, and an erasure request outranks a report — 21.4's ruling),
 * and anybody who is not a moderator.
 */
export async function reportedPostFor(
  actorId: string,
  reportId: string,
): Promise<{ content: string; state: string; discussionId: string } | null> {
  // Scoped by the room the reported post is in — see `roomOfReport()`. Reading
  // what was reported discloses more than removing it does, so it cannot be
  // looser than `removePostAsModerator()`, which has always scoped by
  // `row.groupId`.
  await requireModerator(actorId, await roomOfReport(reportId));

  const [row] = await db
    .select({
      content: communityPosts.content,
      deletedAt: communityPosts.deletedAt,
      deletedBy: communityPosts.deletedBy,
      discussionId: communityPosts.discussionId,
    })
    .from(communitySpamReports)
    .innerJoin(
      communityPosts,
      eq(communityPosts.id, communitySpamReports.postId),
    )
    .where(eq(communitySpamReports.id, reportId))
    .limit(1);
  if (!row) return null;

  return {
    content: row.content,
    state: contentState(row),
    discussionId: row.discussionId,
  };
}

/**
 * The messages a report made visible — by EXPLICIT ID, and nothing around them.
 *
 * 🚨 **This is the one place in the app where somebody who is not a
 * participant reads a private message, and every word of its shape is a
 * bound.** It selects by an id list — the reported message plus what the
 * REPORTER attached — and then re-checks that each row it got back is in the
 * conversation the reported message is in. There is no conversation-scoped
 * query anywhere in it, no "show more", no neighbour, no link into the
 * conversation, and no way to pass an id that was not already recorded on the
 * report row.
 *
 * A message id smuggled onto the report row from another conversation
 * therefore renders nothing: the second check drops it. That is asserted
 * rather than argued, in `moderation-guard.test.ts`.
 */
export async function reportedMessagesFor(
  actorId: string,
  reportId: string,
): Promise<MessageRow[]> {
  // `roomOfReport()` answers `null` for a DM, which is the DECIDED group-less
  // scope (Story 23.3 reuses `mayModerate()`'s answer on purpose) rather than
  // the accidental one this call used to make. Written this way so the two
  // readers ask the same question even though this one can only ever get
  // `null`.
  await requireModerator(actorId, await roomOfReport(reportId));

  const [report] = await db
    .select({
      messageId: communitySpamReports.messageId,
      attachedMessageIds: communitySpamReports.attachedMessageIds,
    })
    .from(communitySpamReports)
    .where(eq(communitySpamReports.id, reportId))
    .limit(1);
  if (!report?.messageId) return [];

  const ids = [report.messageId, ...(report.attachedMessageIds ?? [])];

  // The conversation the REPORTED message is in. Everything returned has to
  // belong to it — the report row is data, and data is not a permission.
  const [reported] = await db
    .select({ conversationId: communityMessages.conversationId })
    .from(communityMessages)
    .where(eq(communityMessages.id, report.messageId))
    .limit(1);
  if (!reported) return [];

  const rows = await db
    .select({
      message: communityMessages,
      profileName: communityProfiles.displayName,
      accountName: users.name,
    })
    .from(communityMessages)
    .leftJoin(users, eq(users.id, communityMessages.authorId))
    .leftJoin(communityProfiles, eq(communityProfiles.memberId, users.id))
    .where(
      and(
        inArray(communityMessages.id, ids),
        eq(communityMessages.conversationId, reported.conversationId),
      ),
    )
    .orderBy(asc(communityMessages.createdAt), asc(communityMessages.id));

  return rows.map((row) =>
    toMessageRow(row.message, row.profileName, row.accountName),
  );
}
