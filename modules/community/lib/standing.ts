// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The three lists — an operator's standing decisions about one member.
//
// 🚨 **Why this is a TABLE while the weight beside it is a calculation.** The
// send-block and a reporter's weight are derived from rows that exist anyway,
// so storing either would be a second truth that goes stale (AD-64). These
// three follow from nothing: no rule produces them, no derivation can recover
// them, and a person decided each one. The line is "who decided", not "how few
// tables" — and deriving a whitelist would not be tidier, it would delete it.
//
// ── Why its own file ──────────────────────────────────────────────────────
// Not `groups.ts` (this is about a person, not a room) and not `reports.ts`
// (that file owns the frozen report and the derivations over it; this owns a
// decision that OVERRIDES them). The barrel re-exports it by name.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { communityMemberStanding, communityModerationAudit } from "../schema";
import {
  CommunityError,
  MAX_MODERATION_REASON_LENGTH,
  NO_STANDING,
  standingProblem,
  type MemberStanding,
  type ModerationAct,
} from "./rules";

/** One member's standing, plus who they are — what the review list renders. */
export interface StandingRow extends MemberStanding {
  memberId: string;
  updatedAt: Date | null;
}

/**
 * The act each transition writes.
 *
 * Two acts per list rather than one with a flag: "protected on Tuesday and
 * unprotected on Thursday" is two facts, and a trail that recorded only the
 * current state would answer "was this ever lifted?" with silence — the same
 * argument `lockDiscussion`/`unlockDiscussion` already makes one table over.
 */
const ACTS: Record<keyof MemberStanding, [ModerationAct, ModerationAct]> = {
  protected: ["memberProtected", "memberUnprotected"],
  writeBlocked: ["writeBlocked", "writeUnblocked"],
  reportsIgnored: ["reportsIgnored", "reportsCounted"],
};

const COLUMNS = {
  protected: communityMemberStanding.protectedAt,
  writeBlocked: communityMemberStanding.writeBlockedAt,
  reportsIgnored: communityMemberStanding.reportsIgnoredAt,
} as const;

function toStanding(row: {
  protectedAt: Date | null;
  writeBlockedAt: Date | null;
  reportsIgnoredAt: Date | null;
}): MemberStanding {
  return {
    protected: row.protectedAt !== null,
    writeBlocked: row.writeBlockedAt !== null,
    reportsIgnored: row.reportsIgnoredAt !== null,
  };
}

/**
 * Put one member on a list, or take them off it.
 *
 * ⚠️ **One field per call, and the OTHER two are read from the database rather
 * than taken from the caller.** A form that posted all three would let a stale
 * page silently undo a decision another operator made between the render and
 * the submit — and `standingProblem()` has to judge the state that will
 * actually exist, not the one this browser last saw.
 *
 * 🚨 The reason is required and is the member's personal data: it travels in
 * both exports and is emptied when they delete their account, exactly like a
 * removal reason. A decision about a person with no reason recorded is one
 * nobody can review, which is the whole purpose of the trail.
 *
 * Authorization is the CALLER's — `requireOwner()`, in the action. Not
 * `mayModerate()`: a standing decision has no WHERE, so a moderator with a duty
 * in one room could otherwise neutralise somebody who reports them in another.
 */
export async function setMemberStanding(input: {
  actorId: string;
  memberId: string;
  field: keyof MemberStanding;
  value: boolean;
  reason: unknown;
}): Promise<void> {
  const reason =
    typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason === "" || reason.length > MAX_MODERATION_REASON_LENGTH) {
    throw new CommunityError("reasonRequired");
  }

  const [target] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, input.memberId))
    .limit(1);
  if (!target) throw new CommunityError("notFound");

  await db.transaction(async (tx) => {
    // 🚨 The row is locked before it is read, so two operators pressing two
    // buttons in the same second cannot each decide against a state the other
    // is about to leave. `users` rather than the standing row itself: the
    // standing row may not exist yet, and a lock on a row that is not there
    // locks nothing.
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.memberId))
      .for("update");

    const [existing] = await tx
      .select({
        protectedAt: communityMemberStanding.protectedAt,
        writeBlockedAt: communityMemberStanding.writeBlockedAt,
        reportsIgnoredAt: communityMemberStanding.reportsIgnoredAt,
      })
      .from(communityMemberStanding)
      .where(eq(communityMemberStanding.memberId, input.memberId))
      .limit(1);

    const current = existing ? toStanding(existing) : NO_STANDING;
    // Nothing to do, and nothing to record: an act that changed no state is
    // not an act. The same refusal `setDiscussionLocked()` makes.
    if (current[input.field] === input.value) return;

    const next = { ...current, [input.field]: input.value };
    const problem = standingProblem(target, next);
    if (problem) throw new CommunityError(problem);

    const stamps = {
      protectedAt: next.protected ? (existing?.protectedAt ?? new Date()) : null,
      writeBlockedAt: next.writeBlocked
        ? (existing?.writeBlockedAt ?? new Date())
        : null,
      reportsIgnoredAt: next.reportsIgnored
        ? (existing?.reportsIgnoredAt ?? new Date())
        : null,
    };

    // ⚠️ No row when they are on no list, so "no row" and "on nothing" cannot
    // become two states that disagree. Deleting rather than keeping a row of
    // three NULLs also means the export's `null` says exactly one thing.
    if (!next.protected && !next.writeBlocked && !next.reportsIgnored) {
      await tx
        .delete(communityMemberStanding)
        .where(eq(communityMemberStanding.memberId, input.memberId));
    } else {
      await tx
        .insert(communityMemberStanding)
        .values({ memberId: input.memberId, ...stamps })
        .onConflictDoUpdate({
          target: communityMemberStanding.memberId,
          set: { ...stamps, updatedAt: new Date() },
        });
    }

    // In the SAME transaction, like every other act in this module: a decision
    // whose record failed to save would be one nobody can review.
    await tx.insert(communityModerationAudit).values({
      actorId: input.actorId,
      act: ACTS[input.field][input.value ? 0 : 1],
      targetMemberId: input.memberId,
      reason,
    });
  });
}

/**
 * Everybody currently on a list — the hand-set half of the review list.
 *
 * The derived half (members the automatic block is silencing right now) is
 * `standingSendBlocks()` in `reports.ts`: one is a table read and the other is
 * arithmetic over reports, and merging them into one query would mean storing
 * the block.
 */
export async function listedMembers(): Promise<StandingRow[]> {
  const rows = await db
    .select({
      memberId: communityMemberStanding.memberId,
      protectedAt: communityMemberStanding.protectedAt,
      writeBlockedAt: communityMemberStanding.writeBlockedAt,
      reportsIgnoredAt: communityMemberStanding.reportsIgnoredAt,
      updatedAt: communityMemberStanding.updatedAt,
    })
    .from(communityMemberStanding);

  return rows.map((row) => ({
    memberId: row.memberId,
    updatedAt: row.updatedAt,
    ...toStanding(row),
  }));
}

/**
 * Members an operator has write-blocked by hand who have since been given the
 * moderator role — the one state `standingProblem()` cannot prevent.
 *
 * ⚠️ **It refuses to CREATE that combination and cannot refuse to inherit
 * one**: the role is granted in the core's user administration, which knows
 * nothing about this module. So the review list surfaces it rather than
 * pretending it cannot happen — and nothing here repairs it silently, because
 * which of the two an operator meant is not a machine's guess.
 */
export async function contradictoryStandings(): Promise<string[]> {
  const rows = await db
    .select({ memberId: communityMemberStanding.memberId })
    .from(communityMemberStanding)
    .innerJoin(users, eq(users.id, communityMemberStanding.memberId))
    .where(
      and(
        isNull(users.blockedAt),
        eq(users.role, "moderator"),
      ),
    );
  return rows.map((row) => row.memberId);
}
