// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { communityGroupModerators, communityGroups, communityProfiles } from "../schema";
import { planProblem } from "@/lib/media/config";
import { CommunityError, checkGroupDescription, checkGroupName, groupPlanProblems, mayEnterGroup, planKeysToResolve, type GroupAccessLevel } from "./rules";

import { grantedKeysFor } from "./_access";

// ───────────────────────────────────────────────────────────────────────────
// Groups — the operator's rooms, and the doors a member sees
// ───────────────────────────────────────────────────────────────────────────

/** A room as any surface reads it back. */
export interface CommunityGroup {
  id: string;
  name: string;
  description: string | null;
  position: number;
  accessLevel: GroupAccessLevel;
  planKeys: string[];
  archivedAt: Date | null;
  createdAt: Date;
}

/** One assigned duty, with the fields a renderer needs to name the person. */
export interface GroupModeratorRow {
  memberId: string;
  /** The name they chose for the community, or `null` if they have not. */
  profileName: string | null;
  /** Their account name — `displayNameFor()`'s second step. */
  accountName: string | null;
  role: string;
  createdAt: Date;
}

/**
 * The rooms this member may enter — the member-facing list.
 *
 * Rooms they may NOT enter are absent, not locked: v1 advertises no doors it
 * will not open, so a plan-gated room is invisible to somebody who has not
 * bought the plan. That is the same decision the no-roster rule rests on — the
 * existence of "Diabetes-Coaching Premium" is close enough to purchase
 * information to be worth not broadcasting.
 *
 * Archived rooms are excluded in the query AND refused again by
 * `mayEnterGroup()`. That redundancy is deliberate: the filter is the cheap
 * half, the core is the one that decides.
 */
export async function groupsFor(viewer: {
  memberId: string;
  role: string;
}): Promise<CommunityGroup[]> {
  const rows = await db
    .select()
    .from(communityGroups)
    .where(isNull(communityGroups.archivedAt))
    // Ties break by creation time, so two rooms sharing a position still have
    // one stable order. Columns only — a literal in ORDER BY is a syntax error
    // in Postgres and typechecks perfectly on the way there.
    .orderBy(asc(communityGroups.position), asc(communityGroups.createdAt));

  const grantedKeys = await grantedKeysFor(
    viewer.memberId,
    planKeysToResolve(rows),
  );
  return rows.filter((row) =>
    mayEnterGroup(row, { role: viewer.role, grantedKeys }),
  );
}

/**
 * One room, if this member may enter it — `null` for every other case.
 *
 * **One indistinguishable absence.** Unknown id, archived room, room behind a
 * plan they do not hold: all three answer `null`, and the page turns that into
 * the framework's not-found. A member who tries ids must not be able to tell
 * "there is no such room" from "there is one and you are not in it" — the
 * second is purchase information about somebody else's product.
 */
export async function groupFor(
  groupId: string,
  viewer: { memberId: string; role: string },
): Promise<CommunityGroup | null> {
  const [row] = await db
    .select()
    .from(communityGroups)
    .where(eq(communityGroups.id, groupId))
    .limit(1);
  if (!row) return null;

  const grantedKeys = await grantedKeysFor(
    viewer.memberId,
    planKeysToResolve([row]),
  );
  return mayEnterGroup(row, { role: viewer.role, grantedKeys }) ? row : null;
}

/**
 * Every room, archived ones included, each with its assigned moderators —
 * the operator's view.
 *
 * Two queries and not one per room: the duties are fetched for the whole set
 * and grouped in JS. `listUsers()`-shaped, deliberately — an admin table is
 * one page of rows, and a join per row is how an admin page gets slow long
 * before a member page does.
 */
export async function listGroups(): Promise<
  Array<CommunityGroup & { moderators: GroupModeratorRow[] }>
> {
  const groups = await db
    .select()
    .from(communityGroups)
    .orderBy(asc(communityGroups.position), asc(communityGroups.createdAt));

  if (groups.length === 0) return [];

  const duties = await db
    .select({
      groupId: communityGroupModerators.groupId,
      memberId: communityGroupModerators.memberId,
      createdAt: communityGroupModerators.createdAt,
      accountName: users.name,
      role: users.role,
      profileName: communityProfiles.displayName,
    })
    .from(communityGroupModerators)
    .innerJoin(users, eq(users.id, communityGroupModerators.memberId))
    .leftJoin(communityProfiles, eq(communityProfiles.memberId, users.id))
    .where(
      inArray(
        communityGroupModerators.groupId,
        groups.map((group) => group.id),
      ),
    )
    .orderBy(asc(communityGroupModerators.createdAt));

  return groups.map((group) => ({
    ...group,
    moderators: duties
      .filter((duty) => duty.groupId === group.id)
      // Fields named one by one rather than spread-minus-groupId: the return
      // type is what a renderer reads, and a rest spread would silently widen
      // it the day this select grows a column.
      .map((duty) => ({
        memberId: duty.memberId,
        profileName: duty.profileName,
        accountName: duty.accountName,
        role: duty.role,
        createdAt: duty.createdAt,
      })),
  }));
}

/**
 * The accounts that may be given a duty — everybody holding the moderator role.
 *
 * The operator is deliberately not in this list and never gets a duty row: they
 * moderate everywhere by role, so an empty duty list means "the operator looks
 * after it", never "nobody does".
 */
export async function moderatorCandidates(): Promise<
  Array<{
    memberId: string;
    accountName: string | null;
    profileName: string | null;
  }>
> {
  const rows = await db
    .select({
      memberId: users.id,
      accountName: users.name,
      profileName: communityProfiles.displayName,
    })
    .from(users)
    .leftJoin(communityProfiles, eq(communityProfiles.memberId, users.id))
    // Blocked accounts are not candidates. `blockedAt` means "no access for
    // them", and offering somebody who cannot sign in as the answer to "who
    // looks after this room" is a duty nobody is doing. The `users.blockedAt`
    // idiom: NULL means not blocked.
    .where(and(eq(users.role, "moderator"), isNull(users.blockedAt)))
    .orderBy(asc(users.createdAt));
  return rows;
}

/** What the operator submits when creating or editing a room. */
export interface GroupInput {
  name: unknown;
  description?: unknown;
  accessLevel: GroupAccessLevel;
  planKeys: readonly string[];
}

/**
 * Validate a room's fields — the core, called BEFORE anything is written.
 *
 * Keys are dropped for every level except `plan`, rather than kept and
 * ignored: a room switched from `plan` to `open` must not carry a stale key
 * that a later validation would refuse, or that a later feature would read.
 */
function checkedGroup(input: GroupInput): {
  name: string;
  description: string | null;
  accessLevel: GroupAccessLevel;
  planKeys: string[];
} {
  const name = checkGroupName(input.name);
  if (!name.ok) throw new CommunityError(name.code);

  const description = checkGroupDescription(input.description);
  if (!description.ok) throw new CommunityError(description.code);

  const planKeys =
    input.accessLevel === "plan"
      ? [
          ...new Set(
            input.planKeys.map((key) => String(key).trim()).filter(Boolean),
          ),
        ]
      : [];

  // `planProblem` is passed in rather than imported by the core: `rules.ts` is
  // bundled for the browser, and this check reads the product registry. Its
  // header carries the reasoning.
  const problem = groupPlanProblems(
    { accessLevel: input.accessLevel, planKeys },
    planProblem,
  );
  if (problem) {
    throw new CommunityError(
      problem.code,
      problem.code === "communityUnknownPlanKey" ? problem.reason : undefined,
      problem.code === "communityUnknownPlanKey" ? { key: problem.key } : undefined,
    );
  }

  return {
    name: name.name,
    description: description.description,
    accessLevel: input.accessLevel,
    planKeys,
  };
}

/**
 * Create a room.
 *
 * New rooms land at the end of the list: `position` is one past the current
 * maximum, so creating one never reshuffles the others. The read orders by
 * `(position, createdAt)`, so even a tie lands somewhere stable.
 */
export async function createGroup(input: GroupInput): Promise<CommunityGroup> {
  const checked = checkedGroup(input);

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ position: communityGroups.position })
      .from(communityGroups);
    const position = existing.reduce(
      (max, row) => Math.max(max, row.position + 1),
      0,
    );

    const [row] = await tx
      .insert(communityGroups)
      .values({ ...checked, position })
      .returning();
    return row;
  });
}

/** Edit a room's name, description, access level or keys. */
export async function updateGroup(
  groupId: string,
  input: GroupInput,
): Promise<CommunityGroup> {
  const checked = checkedGroup(input);

  const [row] = await db
    .update(communityGroups)
    .set(checked)
    .where(eq(communityGroups.id, groupId))
    .returning();

  if (!row) throw new CommunityError("notFound");
  return row;
}

/**
 * Archive a room, or bring it back.
 *
 * There is no delete, in v1, and the schema comment carries the reason: a
 * deletion would cascade into the discussions and the members' own words, and
 * "what was said in here?" must still have an answer after a room closes.
 */
export async function setGroupArchived(
  groupId: string,
  archived: boolean,
): Promise<CommunityGroup> {
  const [row] = await db
    .update(communityGroups)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(communityGroups.id, groupId))
    .returning();

  if (!row) throw new CommunityError("notFound");
  return row;
}

/**
 * Write the whole order in one go.
 *
 * The admin UI submits the ordered id list (its up/down buttons produce it),
 * and one transaction rewrites every position — no swap arithmetic, no
 * fractional indices, and no state where two rooms have briefly traded places
 * in one direction only. Ids the list does not mention are left alone; ids
 * that no longer exist are ignored rather than refused, because two operators
 * reordering the same page is a race worth surviving rather than reporting.
 */
export async function reorderGroups(
  orderedIds: readonly string[],
): Promise<void> {
  if (orderedIds.length === 0) return;

  await db.transaction(async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(communityGroups)
        .set({ position: index })
        .where(eq(communityGroups.id, id));
    }
  });
}

/**
 * Put a moderator on a room.
 *
 * Refuses a target who does not hold the moderator role — a write-validation,
 * not an authorization system: nothing reads this table for permission yet
 * (the moderation surfaces will re-read role AND duty at the moment of the
 * act). Refusing here is what keeps the list meaningful, so that "who looks
 * after this room" never names somebody the role check would turn away.
 *
 * Assigning twice is the same row, not an error: the primary key is
 * `(groupId, memberId)` and a second click is the operator saying the same
 * thing again.
 */
export async function assignGroupModerator(
  groupId: string,
  memberId: string,
): Promise<void> {
  const [group] = await db
    .select({ id: communityGroups.id })
    .from(communityGroups)
    .where(eq(communityGroups.id, groupId))
    .limit(1);
  if (!group) throw new CommunityError("notFound");

  const [target] = await db
    .select({ id: users.id, role: users.role, blockedAt: users.blockedAt })
    .from(users)
    .where(eq(users.id, memberId))
    .limit(1);
  if (!target) throw new CommunityError("notFound");
  // The operator is deliberately not assignable — they moderate everywhere by
  // role, and a duty row for them would make an empty list ambiguous.
  if (target.role !== "moderator") throw new CommunityError("communityNotModerator");
  // A blocked account cannot sign in, so it cannot look after anything. The
  // same refusal as the candidate list above, said again here because this is
  // an HTTP endpoint in its own right and the list is only a convenience —
  // and because the duty table is the seam the moderation release will read
  // for authorization, so a stale row written now is consumed later.
  if (target.blockedAt) throw new CommunityError("communityNotModerator");

  await db
    .insert(communityGroupModerators)
    .values({ groupId, memberId })
    .onConflictDoNothing();
}

/** Take a moderator off a room. Removing a duty that is not there is a no-op. */
export async function removeGroupModerator(
  groupId: string,
  memberId: string,
): Promise<void> {
  await db
    .delete(communityGroupModerators)
    .where(
      and(
        eq(communityGroupModerators.groupId, groupId),
        eq(communityGroupModerators.memberId, memberId),
      ),
    );
}
