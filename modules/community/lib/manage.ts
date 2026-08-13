// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The community's imperative shell — the only file in the module that talks to
// the database. Decisions live next door in `rules.ts` and are made BEFORE
// anything is written; this file owns the reads, the writes and the
// transactions, and nothing else.
//
// ⚠️ **No MEMBER-facing function here takes a member id it did not get from a
// session.** The account acted on is always the caller's own, the same
// guarantee `spendTokens()` gives by having no `memberId` parameter at all.
// Where an id IS a parameter — `profileFor()`, because a member may look at
// somebody else's profile — it names whose profile to READ, never whose to
// write, and the reading side deliberately returns nothing an account page
// would show.
//
// The group-moderator duties are the one place a function writes a row naming
// somebody else, and they are the operator's tools rather than a member's:
// `assignGroupModerator()` / `removeGroupModerator()` are reachable only from
// `app/dashboard/admin/community/`, whose page AND every action open with
// `requireOwner()`. They are the same shape as `setUserRole()` — an operator
// acting on a customer — and they carry the same obligation: the guard is at
// the surface, on every action, not on the page alone.
//
// Enablement is NOT checked here. Every caller is a page or an action that has
// already opened with the community check per request (AD-67), and a second
// read in this layer would look like the guard while being an easy one to
// forget — the guard is at the surface, where a request arrives.
import { cache } from "react";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/db";
import { media, users } from "@/db/schema";
import { communityConversations, communityDiscussions, communityFollows, communityGroupModerators, communityGroups, communityMemberBlocks, communityMessages, communityModerationAudit, communityPostMedia, communityPosts, communitySpamReports, communityProfiles, communityReadMarkers } from "../schema";
import { hasPlan } from "@/lib/entitlements/manage";
import { isOwner } from "@/lib/roles";
import { forgetOne, isLimited, record } from "@/lib/rate-limit";
import { mediaConfig, planProblem } from "@/lib/media/config";
import { formatBytes, slotCeilingBytes } from "@/lib/media/rules";
import { acceptUpload, deleteMedia, findMedia, mayAccess, type Viewer } from "@/lib/media/manage";
import { guardUploadEntry } from "@/lib/media/upload-endpoint";
import { mediaImageFor, mediaUrlFor } from "@/lib/media/url";

import { communityConfig } from "./config";
import { findEmbed } from "./embeds";
import {
  COMMUNITY_DM_RATE_BUCKET,
  COMMUNITY_POST_RATE_BUCKET,
  COMMUNITY_REPORT_RATE_BUCKET,
  MAX_MODERATION_REASON_LENGTH,
  CommunityError,
  canDeleteOwnPost,
  canEditOwnPost,
  canBlockMember,
  canDeliverTo,
  conflictOfInterest,
  mayConsumeReport,
  canFollow,
  canParticipate,
  canPost,
  canSendMessage,
  canStartDiscussion,
  canonicalPair,
  advanceCursor,
  compareCursor,
  counterpartOf,
  cursorToken,
  liveCursorToken,
  parseCursorToken,
  parseLiveCursorToken,
  type LiveCursor,
  checkCommunityAbout,
  checkCommunityDisplayName,
  checkDiscussionTitle,
  checkGroupDescription,
  checkGroupName,
  checkMessageContent,
  checkPostContent,
  checkPostImages,
  type PostImage,
  type PostImagePolicy,
  contentState,
  feedVisible,
  groupPlanProblems,
  hasUnread,
  lockProblem,
  mayEnterGroup,
  mayModerate,
  mayViewEmbed,
  messageLimit,
  planKeysToResolve,
  postLimit,
  removalProblem,
  reportLimit,
  reportProblem,
  sendBlockState,
  type SendBlockState,
  windowMessageIds,
  type GroupAccessLevel,
} from "./rules";

/** A profile as the app reads it back. */
export interface CommunityProfile {
  memberId: string;
  displayName: string;
  about: string | null;
  avatarMediaId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One member's profile, or `null` when they have never named themselves.
 *
 * `null` is a normal answer, not a failure: an account that has not opened the
 * community has no row, and every renderer resolves the name through
 * `displayNameFor()` with `profileName: null` rather than treating the absence
 * as an error.
 */
export async function profileFor(
  memberId: string,
): Promise<CommunityProfile | null> {
  const [row] = await db
    .select()
    .from(communityProfiles)
    .where(eq(communityProfiles.memberId, memberId))
    .limit(1);
  return row ?? null;
}

/**
 * A member and their profile in ONE query — what every profile-shaped page
 * needs, and the shape the renderers in later stories will reuse for lists.
 *
 * Returns `null` when no such account exists, which is what lets a page answer
 * `notFound()` for a member id somebody typed. The account fields returned are
 * deliberately only the two the community may show: the name (as the fallback
 * for `displayNameFor`) and the role (for the badge). **The email is not
 * selected at all** — not filtered out later, not selected and ignored, simply
 * never read, so no future edit to a renderer can put it on screen (FR-184).
 */
export async function memberWithProfile(memberId: string): Promise<{
  memberId: string;
  accountName: string | null;
  role: string;
  profile: CommunityProfile | null;
} | null> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      profile: communityProfiles,
    })
    .from(users)
    .leftJoin(communityProfiles, eq(communityProfiles.memberId, users.id))
    .where(eq(users.id, memberId))
    .limit(1);

  if (!row) return null;
  return {
    memberId: row.id,
    accountName: row.name,
    role: row.role,
    profile: row.profile ?? null,
  };
}

/**
 * Point a member's profile at a picture, and answer which one it replaced.
 *
 * The caller deletes the old one AFTER this returns — never before, so that a
 * failure anywhere in the chain leaves the member with the face they had
 * rather than none at all. The FK is `set null`, so the two operations are
 * safe in either order as far as the database is concerned; the order is about
 * what the member sees when something goes wrong.
 *
 * Takes no `ownerId` for the media row and cannot: the row was already stored
 * by `acceptUpload()` under the session's own member id.
 */
export async function setProfileAvatar(
  memberId: string,
  avatarMediaId: string | null,
): Promise<string | null> {
  // A transaction with the row LOCKED, not a select followed by an update.
  //
  // Under the old shape two submissions racing both read the same `previous`,
  // both wrote, and both then deleted it — so whichever new row lost the race
  // was left referenced by nothing, still in the bucket and still
  // members-visible. `upsertProfile()` above explains why it uses a single
  // atomic statement; this function did the opposite two lines below it.
  //
  // `SELECT … FOR UPDATE` inside the transaction is the honest fix: Postgres
  // only exposes a pre-update tuple to `RETURNING` through constructs Drizzle
  // does not model, so rather than reach for raw SQL the row is held for the
  // few microseconds between reading the old pointer and writing the new one.
  // A member updating their own profile contends with nobody but themselves.
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ avatarMediaId: communityProfiles.avatarMediaId })
      .from(communityProfiles)
      .where(eq(communityProfiles.memberId, memberId))
      .for("update")
      .limit(1);

    // No row at all: nothing to point anywhere. The caller has just upserted
    // the profile, so this is a genuine anomaly rather than a normal state —
    // it is surfaced instead of silently no-opping and leaving a stored media
    // row that nothing references.
    if (!before) throw new CommunityError("communityProfileIncomplete");

    await tx
      .update(communityProfiles)
      .set({ avatarMediaId, updatedAt: new Date() })
      .where(eq(communityProfiles.memberId, memberId));

    return before.avatarMediaId ?? null;
  });
}

/**
 * Keep a stored avatar's alternative text in step with the name it sits beside.
 *
 * `media.alt` is written once, at upload. The community grants free renames
 * with no cooldown (OQ-2), so without this a member who uploads as "Anna
 * Schmidt" and later renames leaves that name on the row — disclosed back to
 * them in both subject-access exports, and shown by any renderer that uses
 * `row.alt`. A comment in the upload action used to claim the alt "follows a
 * rename"; it did not, and this is that claim made true.
 */
export async function refreshAvatarAlt(
  avatarMediaId: string,
  displayName: string,
): Promise<void> {
  await db
    .update(media)
    .set({ alt: displayName })
    .where(eq(media.id, avatarMediaId));
}

/**
 * The address for a member's avatar, or `null` when there is none to show.
 *
 * ⚠️ **The access check is in here on purpose.** `mediaUrlFor()` grants
 * nothing and checks nothing — it is the step AFTER `mayAccess()` said yes,
 * and calling it without that check is how a private file becomes a public
 * one (its own header says so). Putting both in one function means no renderer
 * can perform the second half without the first.
 *
 * ⚠️ **One avatar per call, and that is still a real limit rather than a
 * style.** It costs a `findMedia()` per id, so this door is for a surface
 * showing ONE person — a profile page, the member's own preview card. A
 * renderer showing forty post authors through it would issue forty queries,
 * which is the invariant this epic wrote into `CLAUDE.md` ("forty posts must
 * not be forty queries") broken by following the wrong door.
 *
 * ✅ **The batch-shaped door now exists beside it: `avatarUrlsFor()` below**,
 * and its consumer is the friends feed (`feedFor()` resolves every author's
 * picture in one `media` query). This comment used to refuse to build it, on
 * the grounds that nothing listed avatars yet and guessing at the join would be
 * building blind; the story that lists them has arrived, so the refusal is
 * replaced by the thing it was waiting for rather than left to describe a state
 * that no longer holds.
 *
 * Neither door is written in terms of the other, deliberately. Routing this one
 * through the batch would mean building a `Set`, an `inArray` of one and a `Map`
 * to answer a question about a single row — more moving parts for the caller
 * that is already correct.
 *
 * Answers `null` rather than throwing for a missing row: a picture whose media
 * row was deleted is a profile with no picture, which every caller already
 * renders as the initial-based placeholder.
 */
export async function avatarUrlFor(
  avatarMediaId: string | null,
  viewer: Viewer,
): Promise<string | null> {
  if (!avatarMediaId) return null;
  const row = await findMedia(avatarMediaId);
  if (!row) return null;
  if (!(await mayAccess(row, viewer))) return null;
  return mediaUrlFor(row);
}

/**
 * The addresses for a LIST of members' avatars — **one `media` query, whatever
 * the list holds.**
 *
 * 🚨 **The access check is in here, exactly as it is in `avatarUrlFor()`, and
 * for exactly the same reason.** `mayAccess()` before `mediaUrlFor()` in ONE
 * function, so no renderer can perform the second half without the first —
 * the invariant `modules/courses/lib/media.ts` states in its own header. A
 * batch door that handed back ROWS and let the page mint the addresses would
 * be the same function with the guarantee removed.
 *
 * ⚠️ **The saving is the query, not the check.** The `select` is one statement
 * for N ids; `mayAccess()` still runs per row, because it is a decision about a
 * row and a viewer and there is no batch shape for a decision. For a `members`
 * avatar it touches nothing — that visibility is answered from the row and the
 * session alone — so the loop below costs no I/O at all in the shipped case.
 * A future caller batching `entitled` rows through here would pay one
 * `hasPlan()` per row, and that is the honest cost of asking a different
 * question.
 *
 * Keyed by MEDIA id rather than by member: this function never sees a member,
 * which is what keeps it usable from any list — the feed's authors, a follow
 * list, a moderation queue — without a join it would have to guess at.
 *
 * **An id with no entry in the answer is a placeholder**, and the three reasons
 * are deliberately indistinguishable: no such row, a row this viewer may not
 * have, or a row whose object is gone. Every caller already renders that state
 * as the initial-based fallback, which is what `avatarUrlFor()` answering
 * `null` buys on the single-row path.
 */
export async function avatarUrlsFor(
  avatarMediaIds: readonly (string | null)[],
  viewer: Viewer,
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();

  // Deduplicated, because a list of posts routinely carries the same author
  // twice and a bucket address is not worth signing twice. Empty means no
  // query at all — a feed of authors who have uploaded nothing must not cost a
  // statement to find that out.
  const wanted = [
    ...new Set(
      avatarMediaIds.filter((id): id is string => typeof id === "string" && id !== ""),
    ),
  ];
  if (wanted.length === 0) return urls;

  const rows = await db.select().from(media).where(inArray(media.id, wanted));

  for (const row of rows) {
    if (!(await mayAccess(row, viewer))) continue;
    urls.set(row.id, mediaUrlFor(row));
  }

  return urls;
}

/**
 * Write the caller's own profile — creating it the first time, updating it
 * afterwards.
 *
 * One statement, `insert … on conflict do update`, and that is not a
 * micro-optimisation: a read-then-write would let two submissions from the same
 * member race into a duplicate-key error on a table whose primary key is the
 * member id. There is nothing to lock and no transaction to open, because the
 * row belongs to exactly one person and the statement is atomic.
 *
 * Validation happens in the pure core BEFORE anything is written, and a refusal
 * throws a `CommunityError` carrying a code — the delivery layer turns it into
 * a sentence (AD-10). Naming and renaming are the SAME operation by decision
 * (OQ-2): there is no cooldown, no uniqueness check and no separate rename path.
 */
export async function upsertProfile(
  memberId: string,
  input: { displayName: unknown; about?: unknown },
): Promise<CommunityProfile> {
  const name = checkCommunityDisplayName(input.displayName);
  if (!name.ok) throw new CommunityError(name.code);

  // ── ABSENT is not CLEARED, and the difference is a silent data loss ──────
  // `formData.get("about")` answers `null` for a field that was not in the
  // post, and `""` for one that was there and empty. Treating both as "clear
  // it" means any request that mentions only the display name wipes a
  // member's self-description — no error, no confirmation. Through the shipped
  // form that cannot happen (the textarea always submits); through a crafted
  // post, or the second form a later story adds to this card, it can. A server
  // action is a public endpoint, so the distinction is made here rather than
  // assumed at the caller.
  const aboutGiven = input.about !== undefined;
  const about = aboutGiven ? checkCommunityAbout(input.about) : null;
  if (about && !about.ok) throw new CommunityError(about.code);

  const now = new Date();
  const [row] = await db
    .insert(communityProfiles)
    .values({
      memberId,
      displayName: name.name,
      about: about?.ok ? about.about : null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: communityProfiles.memberId,
      // `createdAt` is deliberately absent: it records when this person joined
      // the community, and an edit is not a new arrival. `about` is absent too
      // when the request did not carry the field — see above.
      set: {
        displayName: name.name,
        ...(about?.ok ? { about: about.about } : {}),
        updatedAt: now,
      },
    })
    .returning();

  return row;
}

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
 * Which of these product keys does this member hold RIGHT NOW.
 *
 * One indexed query per DISTINCT key, run together — never per group. A list
 * of twelve rooms sharing two keys costs two queries, and that is the whole
 * cost envelope of the member-facing list.
 *
 * ⚠️ **The retired-key guard, mirrored from `mayAccess()`.** Keys are
 * validated when a group is SAVED, but a registry edit afterwards is outside
 * that promise — an operator who removes a product from
 * `config/digistore-products.json` leaves rooms pointing at a key `hasPlan()`
 * throws on. Asking anyway would answer 500 on the community page rather than
 * "you are not in that room". So a key the registry can no longer answer for is
 * logged and simply never granted: `mayEnterGroup()` finds it missing and
 * refuses, which is the right answer — a plan nobody can hold is a plan nobody
 * holds. (`lib/media/manage.ts` reached this exact branch first.)
 */
/**
 * Keys already complained about, so the complaint is made once per process.
 *
 * ⚠️ **Without this the log line below is emitted once per key PER MEMBER PER
 * PROTECTED PAGE RENDER**, because `grantedKeysFor()` is reached from
 * `accessibleGroupIds()` → `unreadFor()`, which the dashboard layout runs for
 * every page under it. One operator retiring a product while a room still
 * names its key then turns `node run.mjs errors` permanently red and buries
 * the real faults that command exists to surface. The condition is a stable,
 * operator-scoped fact about configuration — it wants saying once, not on a
 * timer and not per request.
 *
 * Process-scoped on purpose: a restart is the moment somebody is looking, and
 * a fixed config stops producing the line at exactly the same moment.
 */
const complainedPlanKeys = new Set<string>();

/**
 * Does this member hold this one key — asked at most once per key per request.
 *
 * ⚠️ **`cache()` on the SINGLE key, not on the list.** React's `cache()` keys
 * on argument identity, and every caller builds a fresh key array, so
 * memoising `grantedKeysFor` would never hit. Two scalars do, which is what
 * makes the layout's `unreadFor()` and the community page's `groupsFor()`
 * share one entitlement round trip per key instead of taking two each — the
 * same fan-out, run twice, in one render.
 */
const heldKey = cache(async function heldKey(
  memberId: string,
  key: string,
): Promise<boolean> {
  return hasPlan(memberId, key);
});

async function grantedKeysFor(
  memberId: string,
  keys: readonly string[],
): Promise<string[]> {
  const askable = keys.filter((key) => {
    const problem = planProblem(key);
    if (problem) {
      if (!complainedPlanKeys.has(key)) {
        complainedPlanKeys.add(key);
        // "cannot unlock", not "is no longer a product": `planProblem()` also
        // answers non-null for a key that IS a product of `kind === "token"`,
        // and telling the operator to "restore the product" would send them
        // looking for something that is already there. The reason itself says
        // which of the two it is.
        console.error(
          `[community] group plan key "${key}" cannot unlock anything — access ` +
            `refused for everybody until the group or the registry changes. (${problem})`,
        );
      }
      return false;
    }
    return true;
  });

  const held = await Promise.all(
    askable.map(async (key) => ((await heldKey(memberId, key)) ? key : null)),
  );
  return held.filter((key): key is string => key !== null);
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
 * Turn a page number from a query string into an OFFSET Postgres will accept.
 *
 * ⚠️ **`Math.floor` and the finite check are the load-bearing parts.** The
 * callers clamp with `Math.max(1, Number(x) || 1)`, which filters NaN and
 * negatives but NOT fractions or infinities — so `?page=1.1` produced an offset
 * of `5.000000000000004` and `?page=1e999` produced `Infinity`, and Postgres
 * refuses both (`argument of OFFSET must be type bigint`). An out-of-range page
 * is meant to be an empty page, not a 500 on a signed-in member's screen.
 *
 * `Number.MAX_SAFE_INTEGER` as the ceiling rather than a business limit: this
 * function's job is to hand the driver something it can serialise, and "how far
 * may somebody page" is the caller's question.
 */
function pageOffset(page: number, perPage: number): number {
  if (!Number.isFinite(page)) return 0;
  const whole = Math.max(1, Math.floor(page));
  return Math.min(Math.max(0, whole - 1) * perPage, Number.MAX_SAFE_INTEGER);
}

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
 * Where a post's pictures go in the bucket, and what they are.
 *
 * 🚨 **One object, used by the writer AND by the test that measures the account
 * sweep.** AC 6 of Story 26.2 asks for the deletion to be *measured* rather than
 * inferred from "`members` is in `OWNED_MEDIA_VISIBILITIES`, and the avatar is
 * swept" — and a measurement built on values retyped into the test would prove
 * something about the test. `post-image-deletion.test.ts` reads these, so the
 * row it hands `deleteOwnedMedia()` is stored exactly as a real post image is.
 *
 * `namespace` is this module's own id and may not be anything else:
 * `modules/boundary.test.ts` refuses a slot naming another module's namespace,
 * because a key claiming to be somebody else's is how a lifecycle rule scoped to
 * one subsystem quietly deletes another's. With `category` it makes the key
 * `community/post/<YYYY>/<MM>/<id>.<ext>` — 26.1's grammar, one slot per thing
 * this module stores.
 */
export const POST_IMAGE_SLOT = {
  namespace: "community",
  category: "post",
  /**
   * ⚠️ **`members`, not `owner`, and the choice is the whole point of that
   * visibility.** A picture in a room has to be readable by everybody else in
   * the room; `owner` would show it to nobody but its author, `entitled` would
   * bind it to a Product Key the room may not have, and `public` would put a
   * member's photograph on an anonymous bucket address. `members` is any active
   * session and nothing more (`lib/media/rules.ts` argues the other three), and
   * it is what puts these rows inside `OWNED_MEDIA_VISIBILITIES` — so they go
   * with the account, which is the second half of AC 6.
   *
   * The ROOM's door is not this decision: a picture is only ever reached through
   * a post, and a post is only ever reached through a thread whose access is
   * re-derived per request. `members` is the floor, not the gate.
   */
  visibility: "members",
  /**
   * A picture, and only a picture. `mayUpload.member` also allows
   * `application/pdf`, so without this a member could attach a 50 MB document
   * to a post and every reader would render a broken image. The `accept` on the
   * input is a browser hint and is not a check.
   */
  onlyKinds: ["image"],
} as const;

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
 * The member's own profile, for the participation check.
 *
 * Its own tiny function because every write path needs it and none of them
 * should reach for `profileFor()` and then decide what to do with a whole row.
 */
async function participationProfile(
  memberId: string,
): Promise<{ displayName: string | null } | null> {
  const [row] = await db
    .select({ displayName: communityProfiles.displayName })
    .from(communityProfiles)
    .where(eq(communityProfiles.memberId, memberId))
    .limit(1);
  return row ?? null;
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
async function discussionForViewer(
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
function guardPostRate(memberId: string): void {
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
async function releaseRateOnFailure<T>(
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
 * One picked file, as a write path receives it.
 *
 * ⚠️ **Bytes, not a `File`.** The bytes have to be in this process for the
 * location data to come off them (`profile-ui.tsx` says why `direct` is absent
 * for exactly this reason), and a `File` in the signature would tie this layer to
 * the shape a Server Action happens to receive. The action converts once; every
 * test hands the same three fields.
 */
export interface PostImageUpload {
  bytes: Uint8Array;
  claimedMime: string | null;
  filename: string | null;
}

/**
 * Store a post's pictures — the WHOLE shipped pipeline, per file, in order.
 *
 * `guardUploadEntry()` is the outer half — is media switched on, is the store
 * usable, has this member had their share of the hour — and `acceptUpload()` the
 * inner one: bytes sniffed rather than believed, the role's ceiling, EXIF
 * stripped, no SVG. Both, in that order, for every file. A door that calls only
 * the second is an upload path with no rate limit on which the operator's media
 * kill switch silently does nothing, and it is a bug this template has already
 * shipped once (Story 19.4).
 *
 * ⚠️ **It runs INSIDE `addPost()` / `startDiscussion()`, after their guards.**
 * Not in the action: an upload before the access check would let somebody who is
 * no longer in the room put bytes in the operator's bucket and spend their hourly
 * allowance on a post that is then refused. Same reasoning as `avatarUrlsFor()`
 * keeping `mayAccess()` and the mint in one function — the order is the design,
 * so it lives where nothing can enter past it.
 *
 * 🚨 **A picture that cannot be stored fails the whole post**, which is the
 * OPPOSITE of what the avatar path does, and the difference is deliberate.
 * `profile-actions.ts` saves the name and reports the picture separately because
 * the two are independent edits to a form. A post is one utterance: publishing
 * the words without the pictures somebody attached to them puts half a
 * contribution in a room permanently — and there is no way back, because editing
 * a post does not take pictures. So the refusal keeps their text in the composer
 * (NFR-37) and they can try again. Anything this attempt already stored is
 * removed on the way out.
 */
async function storePostImages(
  viewer: { memberId: string; role: string },
  uploads: readonly PostImageUpload[],
  alts: readonly string[],
): Promise<string[]> {
  const stored: string[] = [];
  try {
    for (let index = 0; index < uploads.length; index += 1) {
      guardUploadEntry(viewer.memberId);
      const row = await acceptUpload({
        ownerId: viewer.memberId,
        role: viewer.role || "member",
        ...POST_IMAGE_SLOT,
        bytes: uploads[index].bytes,
        claimedMime: uploads[index].claimedMime,
        filename: uploads[index].filename,
        // Required and never derived — see `checkPostImages()`. A prompt, a
        // filename or the post's own text would each be a sentence about
        // something other than the picture.
        alt: alts[index],
      });
      stored.push(row.id);
    }
    return stored;
  } catch (error) {
    await discardPostImages(stored);
    throw error;
  }
}

/**
 * Take back pictures a post never got.
 *
 * Best-effort and logged rather than thrown: the caller is already on its way
 * out with a refusal, and turning a failed cleanup into a second, different
 * error would replace a sentence the member can act on with one nobody can. An
 * object left behind is swept when the account is deleted, and `node run.mjs
 * errors` finds the line meanwhile.
 */
async function discardPostImages(mediaIds: readonly string[]): Promise<void> {
  for (const id of mediaIds) {
    try {
      await deleteMedia(id);
    } catch (error) {
      console.error("[community] could not remove an unattached post image", id, error);
    }
  }
}

/**
 * The pictures a member attached, as they are read in `checkPostImages()`'s
 * terms — pure decision first, bytes afterwards.
 *
 * Shared by both write paths so a thread's first post and a reply cannot come to
 * disagree about the ceiling, the descriptions or the order of the checks.
 */
function judgePostImages(input: {
  images?: readonly PostImageUpload[];
  imageAlts?: readonly unknown[];
}): { uploads: readonly PostImageUpload[]; alts: string[] } {
  const uploads = input.images ?? [];
  const judged = checkPostImages(
    uploads.length,
    input.imageAlts ?? [],
    communityConfig().posting.imagesMax,
  );
  if (!judged.ok) throw new CommunityError(judged.code);
  return { uploads, alts: judged.alts };
}

/**
 * Write the attachment rows — inside the post's own transaction, always.
 *
 * `position` is the index the form delivered, dense and from zero: it is the
 * order the member chose, and it is part of the primary key, so a post cannot
 * end up with two pictures in one place.
 */
async function attachPostImages(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  postId: string,
  mediaIds: readonly string[],
): Promise<void> {
  if (mediaIds.length === 0) return;
  await tx.insert(communityPostMedia).values(
    mediaIds.map((mediaId, position) => ({ postId, mediaId, position })),
  );
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
  const visibleIds = rows
    .filter((row) => contentState(row.post) === "visible")
    .map((row) => row.post.id);
  const images = await postImagesFor(visibleIds, viewer);

  return {
    page: current,
    rows: rows.map((row) => ({
      ...row.post,
      // The words of a hidden post do not travel. `deleteOwnPost` keeps them
      // in the ROW on purpose (the report queue needs them), and this is the
      // line that keeps that decision from becoming a disclosure: what a
      // server component receives is what a reader may see.
      content: contentState(row.post) === "visible" ? row.post.content : "",
      // ⚠️ **Blanked HERE as well as excluded from the statement above**, and the
      // redundancy is deliberate — the same shape `content` has. The `where`
      // clause is what makes the query cheap; this line is what makes the claim
      // TRUE, locally, in the function that hands the browser its payload. A
      // guarantee that lives only in a filter is one a later `inArray` edit can
      // take away silently, and `post-images.test.ts` asserts it on a mixed page
      // for exactly that reason.
      images: contentState(row.post) === "visible" ? (images.get(row.post.id) ?? []) : [],
      authorProfileName: row.profileName,
      authorAccountName: row.accountName,
    })),
    total: counted,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Embedded discussions — a conversation hanging off a page instead of a room
// ───────────────────────────────────────────────────────────────────────────
//
// Four functions, and the split between them is AD-62's whole mechanic:
// **reading never creates anything, and exactly one function writes the row.**
// A discussion that came into existence because somebody loaded a page would
// be a table an anonymous-ish request can grow, keyed by a string the browser
// chose; a discussion that comes into existence under the first POST is a row
// per conversation somebody actually had.

/**
 * The row for a Subject Key, or `null` — **a SELECT and nothing else.**
 *
 * ⚠️ `null` is the normal answer, not a failure: it means "nobody has posted
 * under this key yet", and the component renders the empty discussion. Do not
 * "fix" it by creating the row here. That is the one line AD-62 draws, and the
 * reason it is drawn is that this function runs on every render of every page
 * carrying an embed.
 *
 * It does not check access and is not exported for surfaces to call directly —
 * `embeddedDiscussionView()` below is the door, and it asks first.
 */
async function embeddedDiscussionFor(
  subjectKey: string,
): Promise<typeof communityDiscussions.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(communityDiscussions)
    .where(eq(communityDiscussions.subjectKey, subjectKey))
    .limit(1);
  return row ?? null;
}

/**
 * May this member see the discussion declared for this Subject Key?
 *
 * `null` when yes, the code `communityNotEntitled` when no — **and "no" covers both an
 * undeclared key and a declared one this member has not bought.** The merge
 * happens in `mayViewEmbed()`, once; this function only resolves the two
 * things that need a database: which declaration the registry holds, and which
 * of its product keys this member holds RIGHT NOW (AD-60 — at the moment of
 * the read, never cached, never carried over from a render).
 *
 * Enablement is deliberately not asked here, like everywhere else in this
 * file: the surface asks it, per request, because that is where a request
 * arrives.
 */
export async function embedAccessFor(
  subjectKey: string,
  viewer: { memberId: string; role: string },
): Promise<"communityNotEntitled" | null> {
  const declaration = findEmbed(subjectKey);
  const grantedKeys = await grantedKeysFor(
    viewer.memberId,
    planKeysToResolve(declaration ? [declaration] : []),
  );
  return mayViewEmbed(declaration, { role: viewer.role, grantedKeys });
}

/**
 * **The one function in this module that creates an embedded discussion row,
 * and the post-write transaction is its only caller.**
 *
 * Not a render path, not a component, not a server action of its own: the row
 * materializes the moment a first post lands under a Subject Key, inside the
 * same transaction that writes that post and bumps `lastActivityAt` (AD-62).
 *
 * ⚠️ **It refuses an undeclared key before writing anything.** The registry is
 * the provenance, so a request naming a key nobody declared creates nothing at
 * all — otherwise the table would be a place a signed-in member can put rows
 * with keys of their own choosing.
 *
 * ⚠️ **`onConflictDoNothing` + re-select, against the partial unique index.**
 * That pairing is what makes two first-posters race-safe: both call this, one
 * inserts, the other conflicts and reads back the row the first just wrote.
 * `returning()` is empty on a conflict — hence the second read, which is not a
 * belt-and-braces extra but the other half of the answer.
 *
 * ⚠️ **`createdBy` and `title` stay NULL.** Nobody starts an embedded
 * discussion, and the check constraint would refuse a title anyway; the
 * account-deletion scrub blanks the titles of threads a departing member
 * started, and a title of `""` on a row carrying a Subject Key would make an
 * erasure request fail. `db/schema-community.ts` carries the full argument.
 */
export async function ensureEmbeddedDiscussion(
  tx: { insert: typeof db.insert; select: typeof db.select },
  subjectKey: string,
  now: Date,
): Promise<{ id: string }> {
  // The provenance check, before the write rather than beside it.
  if (!findEmbed(subjectKey)) throw new CommunityError("communityNotEntitled");

  const [created] = await tx
    .insert(communityDiscussions)
    .values({
      subjectKey,
      groupId: null,
      title: null,
      createdBy: null,
      lastActivityAt: now,
      createdAt: now,
    })
    // The unique index is PARTIAL (`where subject_key is not null`), so the
    // conflict target has to carry the same predicate or Postgres cannot infer
    // which index is meant and refuses the statement outright. Same trap
    // `acknowledgeRead()`'s `targetWhere` answers one table over.
    .onConflictDoNothing({
      target: communityDiscussions.subjectKey,
      where: sql`${communityDiscussions.subjectKey} is not null`,
    })
    .returning({ id: communityDiscussions.id });
  if (created) return created;

  const [existing] = await tx
    .select({ id: communityDiscussions.id })
    .from(communityDiscussions)
    .where(eq(communityDiscussions.subjectKey, subjectKey))
    .limit(1);
  // Nothing inserted and nothing there is not a state this can reach — the
  // conflict IS the row. Refusing loudly beats returning an id nobody has.
  if (!existing) throw new CommunityError("notFound");
  return existing;
}

/** What an embedded discussion hands the component that draws it. */
export interface EmbeddedDiscussionView {
  /** `null` until somebody has posted — the empty discussion is a real state. */
  discussionId: string | null;
  locked: boolean;
  rows: PostRow[];
  total: number;
  page: number;
}

/**
 * Everything the embed component needs, or `null` when it may not have it.
 *
 * ⚠️ **`null` is ONE answer for "no such declaration" and "not entitled"**, so
 * the component renders identically for both — which is the render-side half
 * of the refusal `embedAccessFor()` makes indistinguishable at the write side.
 *
 * Read-only throughout: an unknown-but-declared key answers an empty
 * discussion rather than creating one (see `embeddedDiscussionFor()`).
 */
export async function embeddedDiscussionView(
  subjectKey: string,
  viewer: { memberId: string; role: string },
  page: number | "last",
): Promise<EmbeddedDiscussionView | null> {
  if (await embedAccessFor(subjectKey, viewer)) return null;

  const discussion = await embeddedDiscussionFor(subjectKey);
  if (!discussion) {
    return { discussionId: null, locked: false, rows: [], total: 0, page: 1 };
  }

  const posts = await postsFor(discussion.id, page, viewer);
  return {
    discussionId: discussion.id,
    locked: discussion.lockedAt !== null,
    ...posts,
  };
}

/**
 * Post into an embedded discussion, creating it if this is the first one.
 *
 * The same order of checks as `addPost()`, for the same reasons — access →
 * participation → the thread's own state → the content → the brake → the
 * write — with the one addition this leg needs: **the row is ensured inside
 * the transaction that writes the post**, never before it and never on a read.
 *
 * ⚠️ **The coordinate is the Subject Key, never a discussion id from the
 * browser.** An id would let a member aim a post at any thread whose id they
 * had; a key is looked up in the registry first, and an undeclared one is
 * refused with the same code somebody without the plan gets.
 */
export async function addEmbeddedPost(
  subjectKey: string,
  viewer: { memberId: string; role: string },
  input: {
    content: unknown;
    images?: readonly PostImageUpload[];
    imageAlts?: readonly unknown[];
  },
): Promise<{ postId: string }> {
  const refusal = await embedAccessFor(subjectKey, viewer);
  if (refusal) throw new CommunityError(refusal);

  const denial = canParticipate(await participationProfile(viewer.memberId));
  if (denial) throw new CommunityError(denial);

  // The fourth send path — an embed is a place to write like any other.
  await guardSendBlock(viewer.memberId);

  // A lock is a property of the row, so it can only exist once the row does —
  // an embed nobody has posted in yet is not locked, it is empty. This is an
  // early exit for the common case only; it is read again inside the
  // transaction below, where it actually gates the write.
  const existing = await embeddedDiscussionFor(subjectKey);
  if (existing?.lockedAt) throw new CommunityError("communityDiscussionLocked");

  const content = checkPostContent(input.content);
  if (!content.ok) throw new CommunityError(content.code);
  const pictures = judgePostImages(input);

  guardPostRate(viewer.memberId);

  return releaseRateOnFailure(viewer.memberId, async () => {
    // See `storePostImages()`: after every guard, before the transaction. The
    // embedded leg is a place to write like any other and gets the same order.
    const mediaIds = await storePostImages(viewer, pictures.uploads, pictures.alts);

    try {
      return await db.transaction(async (tx) => {
      const now = new Date();
      // The module's one lazy materialization, in the one transaction that is
      // allowed to perform it.
      const discussion = await ensureEmbeddedDiscussion(tx, subjectKey, now);

      // ⚠️ **Re-checked here, and `.for("update")` is what makes it a check.**
      // The read above happens before this transaction opens, so a lock applied
      // in the gap between the two would otherwise let this write through — the
      // same shape `communityDiscussionLocked` above exists to prevent, just closer to
      // the write. A PLAIN select would not close it either: Postgres runs
      // READ COMMITTED, so every statement takes a fresh snapshot and a lock
      // committing between this line and the insert below is invisible to both.
      // The row lock is what makes the two statements one decision — and it is
      // taken here rather than left to the `lastActivityAt` update at the end,
      // which is the first statement that would otherwise take one, by which
      // point the post is already in.
      const [current] = await tx
        .select({ lockedAt: communityDiscussions.lockedAt })
        .from(communityDiscussions)
        .where(eq(communityDiscussions.id, discussion.id))
        .limit(1)
        .for("update");
      // No row means it went away under us — refuse rather than fall through to
      // an insert whose foreign key would fail as an untranslated driver error.
      if (!current) throw new CommunityError("notFound");
      if (current.lockedAt) throw new CommunityError("communityDiscussionLocked");

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

      // `lastActivityAt` moves in the same transaction as the post and nowhere
      // else — the rule the schema header states, applied to the third and
      // last write path that is allowed to touch it.
      await tx
        .update(communityDiscussions)
        .set({ lastActivityAt: now })
        .where(eq(communityDiscussions.id, discussion.id));

      return { postId: post.id };
      });
    } catch (error) {
      await discardPostImages(mediaIds);
      throw error;
    }
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Live — "what is new since X", for one scope
// ───────────────────────────────────────────────────────────────────────────

/**
 * How many rows one answer may carry (NFR-41 — every read is bounded).
 *
 * The same page size the thread view uses. A viewer who has been away long
 * enough to be further behind than this gets the oldest slice first and
 * catches up over the next few polls, which is the honest behaviour: the
 * alternative is one request that reads an unbounded number of rows because a
 * tab was open over a weekend.
 */
export const LIVE_POSTS_PER_ANSWER = POSTS_PER_PAGE;

/**
 * What a client subscribes to.
 *
 * ⚠️ **Two kinds, and there is a reason it is not one.** An embedded
 * discussion can be viewed before its row exists (20.1's lazy creation), so
 * its stable coordinate is the Subject Key; a room's thread has a row from the
 * moment it is started, so its coordinate is the id. The CURSOR currency —
 * AD-70's actual one-grammar clause — is identical across both.
 *
 * `"conversation"` is Epic 21's addition and the third coordinate: a
 * conversation has a row from the moment it is opened, so it is named by its
 * id, and its door is participant-ship rather than a room's access level. What
 * it does NOT add is a second token shape, a second comparison or a second
 * serializer — AD-70's one-currency clause is the reason this union grew a
 * member instead of a sibling endpoint.
 *
 * An unknown kind is refused exactly like an inaccessible scope, which keeps
 * the refusal from becoming a probe for which kinds this build understands.
 */
export type LiveScope =
  | { kind: "discussion"; discussionId: string; cursor?: unknown }
  | { kind: "subject"; subjectKey: string; cursor?: unknown }
  | { kind: "conversation"; conversationId: string; cursor?: unknown }
  // The friends feed. It has no coordinate at all — the scope IS the viewer,
  // and who that is comes from the session rather than from the request. That
  // is what makes it the one scope nobody can ask for on somebody else's
  // behalf.
  | { kind: "feed"; cursor?: unknown };

/**
 * When a post last CHANGED state — the ordering key of a live answer's second
 * half, as SQL.
 *
 * `'epoch'` rather than `NULL` for the untouched case, because `GREATEST`
 * ignores NULLs in Postgres but a row that has never changed still has to sort
 * somewhere, and before everything is the only honest place.
 *
 * ⚠️ **Used in `WHERE` and `ORDER BY` only, never selected.** A `sql<Date>`
 * comes back from the driver as a string wearing a `Date`'s type
 * (`db/sql-cast.test.ts` measures exactly that), so the value that becomes a
 * cursor is computed by {@link changedAt} from the typed columns instead. Two
 * restatements of one rule, which is why `live-parity.test.ts` runs both over
 * the same matrix.
 */
const CHANGED_AT = sql`greatest(coalesce(${communityPosts.deletedAt}, 'epoch'), coalesce(${communityPosts.editedAt}, 'epoch'))`;

/**
 * A `Date` bound against {@link CHANGED_AT}, carrying a column's own converter.
 *
 * 🚨 The WRITE side of the rule the comment above states for reads, and it is
 * not symmetry for its own sake: a raw `sql\`${CHANGED_AT} > ${someDate}\``
 * hands postgres.js the `Date` OBJECT — there is no column on that side of the
 * comparison to convert it, and `drizzle()` has replaced the driver's own date
 * serialisers with `(val) => val` because it means to convert at the column —
 * so the object travels straight into a function that wants a string and throws
 * `TypeError: The "string" argument must be … Received an instance of Date`.
 * Measured on Postgres 16 with Node 22.22.1, postgres 3.4.9, drizzle-orm 0.45.2:
 * the same shape that took the setup surface's two-act apply down (A71).
 * `CHANGED_AT` is `greatest(deletedAt, editedAt)`, so `editedAt` is the column
 * whose converter is the right one to borrow — the same trick `.mapWith()` is
 * for reads. `db/sql-date-param.test.ts` keeps the raw shape out.
 */
const changedAtParam = (at: Date) => sql.param(at, communityPosts.editedAt);

/**
 * The JS twin of {@link CHANGED_AT}. Timezone-innocent: it compares `Date`
 * values handed in and never reads a clock.
 */
export function changedAt(post: {
  deletedAt: Date | null;
  editedAt: Date | null;
}): Date {
  const deleted = post.deletedAt?.getTime() ?? 0;
  const edited = post.editedAt?.getTime() ?? 0;
  return new Date(Math.max(deleted, edited));
}

/**
 * One scope's answer.
 *
 * ⚠️ **`unavailable` is ONE state for every no.** Not entitled, un-declared, no
 * such row, a kind this build does not know: the client cannot tell them apart,
 * which is 20.1's indistinguishable refusal extended to this surface. Below the
 * delivery layer the codes still exist and still mean different things; what
 * crosses the wire is the merged state.
 */
export type LiveScopeAnswer =
  | { state: "unavailable" }
  | {
      state: "ok";
      /** The next cursor. `null` only when the scope holds nothing at all. */
      cursor: string | null;
      /** Scope-level state — a thread locked since the cursor rides here. */
      locked: boolean;
      /**
       * Something the client is HOLDING has changed, and this answer does not
       * say what.
       *
       * ⚠️ **The silent half of AD-70, for the one scope that cannot carry
       * tombstones.** A thread delivers a deletion as row-state, because the
       * reader was in that conversation. A feed must not: a "this was removed"
       * row would land in front of people who never saw the original, which is
       * a worse disclosure than the omission — the argument is on `feedSince()`
       * and it stands. But it only covers what may be SENT. It never covered a
       * post already on somebody's screen, and that reader HAS seen the
       * original, so nothing is disclosed to them by it going away.
       *
       * So: no row, no id, no words — one bit saying "ask for a fresh render".
       * The re-render simply does not contain the post.
       */
      stale: boolean;
      posts: PostRow[];
    };

/**
 * Resolve a scope to the discussion behind it, with access re-checked.
 *
 * `{ ok: false }` is every refusal. `{ ok: true, discussion: null }` is the one
 * case that looks like a refusal and is not: a declared Subject Key this member
 * IS entitled to, under which nobody has posted yet.
 */
async function liveScopeTarget(
  viewer: { memberId: string; role: string },
  scope: LiveScope,
): Promise<
  | { ok: false }
  | { ok: true; discussion: typeof communityDiscussions.$inferSelect | null }
> {
  if (scope.kind === "discussion") {
    // The same function the full read uses (NFR-36) — enablement is the
    // surface's, access is re-derived here, per request, from the plans this
    // member holds right now.
    const found = await discussionForViewer(scope.discussionId, viewer);
    return found ? { ok: true, discussion: found.discussion } : { ok: false };
  }

  if (scope.kind === "subject") {
    if (await embedAccessFor(scope.subjectKey, viewer)) return { ok: false };
    return { ok: true, discussion: await embeddedDiscussionFor(scope.subjectKey) };
  }

  // An unknown kind. Not its own answer — see `LiveScopeAnswer`.
  return { ok: false };
}

/**
 * What is new in one scope since one cursor.
 *
 * ⚠️ **It writes NOTHING, and that is a rule rather than an accident of this
 * implementation.** It never advances a read marker — "what is new since X" and
 * "I have seen up to X" are different claims, and a channel that marked things
 * read because it delivered them would empty the inbox of a tab left open
 * overnight (`acknowledgeRead()` carries the full argument). It never creates a
 * discussion row either: 20.1's one creator lives in the post-write
 * transaction, and a poll is a read.
 *
 * ── The query has TWO halves, and the second one is AD-70's whole point ────
 * A cursor over creation order alone would answer an old post's deletion **by
 * omission** — the row simply stops being sent, and a viewer with the tab open
 * goes on reading words the database no longer shows anybody. So the answer
 * carries (a) rows created past the cursor and (b) rows whose `deletedAt` or
 * `editedAt` postdates the cursor's time component, each shaped by the same
 * `contentState()` every other surface asks. The client treats an arriving row
 * as **upsert-by-id**, never as an append.
 *
 * ⚠️ **The two halves keep two POSITIONS, and the reason is a measured defect
 * rather than tidiness.** This function used to run both halves as one `OR`
 * over one position, ordered by creation and capped at
 * `LIVE_POSTS_PER_ANSWER`. The paragraph that stood here argued the cost was
 * "one row per poll, bounded and idempotent" and that a second position "would
 * re-open a decided AD for a saving that does not justify it". Both halves of
 * that were wrong, and three independent review layers found it on 2026-08-06:
 *
 *   - Half (b) rows are OLD — a deletion touches a post written last month — so
 *     under `ORDER BY created_at` they sort FIRST and eat the whole limit,
 *     while a cursor that may only move forward cannot be advanced by any of
 *     them. At fifty such rows in one discussion the cursor STOPS: the same
 *     fifty tombstones ride every poll and no new post is ever delivered to any
 *     open tab again. Not degraded — stopped, silently, with a reload
 *     re-wedging on its first poll.
 *   - Fifty is not a thought experiment. `scrubCommunityContentFor()` sets
 *     `deletedAt` on **every** live post of a departing member in one
 *     statement, so one member exercising their right to erasure ends the live
 *     channel of any thread they were active in, for everybody watching it.
 *
 * AD-70 is not re-opened by this: its rule is that there is ONE comparison, and
 * there still is — `compareCursor()`, applied twice. What grew is the number of
 * positions an answer remembers, because its two halves are sorted by different
 * columns and a single position cannot be monotonic in both. Advancing on half
 * (a) alone is not a lesser fix but a lossy one: it moves the window past
 * tombstones half (b) has not delivered, and those deletions then never arrive.
 *
 * The change time is `GREATEST(deleted_at, edited_at)` and it is computed in
 * SQL for ordering and filtering **only** — never selected. A `sql<Date>` comes
 * back as a string (`db/sql-cast.test.ts` measures it), so the cursor is built
 * in JS from the typed columns instead.
 */
export async function liveAnswerFor(
  viewer: { memberId: string; role: string },
  scope: LiveScope,
): Promise<LiveScopeAnswer> {
  // The conversation leg. Same token, same two-halves query, same
  // upsert-by-id contract — a different table and a different door.
  if (scope.kind === "conversation") {
    return liveConversationAnswer(viewer, scope);
  }

  // The feed leg. `feedSince()` re-derives the readable rooms and the follow
  // set on every answer, so a plan lost mid-view stops delivering that room's
  // activity on the next poll — with nothing to invalidate, because nothing
  // was stored.
  if (scope.kind === "feed") {
    const answer = await feedSince(viewer, scope.cursor);
    return {
      state: "ok",
      cursor: answer.cursor,
      locked: false,
      // Deletions ride this scope as row-state, so it is never stale.
      stale: false,
      // The wire shape is one shape (AD-70). A feed item is drawn from a post,
      // so it travels as one — the fields the feed needs beyond a post's own
      // (the room, the thread) ride the client's existing rows, which it
      // already has for everything it rendered.
      posts: answer.items.map((item) => ({
        id: item.postId,
        authorId: item.authorId,
        content: item.content,
        createdAt: item.createdAt,
        editedAt: null,
        deletedAt: null,
        deletedBy: null,
        removedReason: null,
        // ⚠️ **The feed carries no pictures, and that is a scope decision rather
        // than a gap in the resolution.** A feed item is a pointer INTO a
        // conversation — the room, the thread, an excerpt of what was said — and
        // the pictures are where the conversation is. Rendering them here would
        // mean minting a `srcset` per item for a surface whose whole job is to
        // get somebody to the thread, and it would put a member's photograph on
        // a page they never chose to publish it to. `feed-list.tsx` renders
        // `content` and nothing else for the same reason.
        images: [],
        authorProfileName: item.authorProfileName,
        authorAccountName: item.authorAccountName,
      })),
    };
  }

  const target = await liveScopeTarget(viewer, scope);
  if (!target.ok) return { state: "unavailable" };

  const discussion = target.discussion;
  if (!discussion) {
    // Declared, entitled, and nobody has written yet. A real state, and not
    // the same one as `unavailable`: this member IS in the room.
    return { state: "ok", cursor: null, locked: false, stale: false, posts: [] };
  }

  const locked = discussion.lockedAt !== null;
  const cursor = parseLiveCursorToken(scope.cursor);

  if (!cursor) {
    // A token this build cannot read: resynchronise rather than deliver. It
    // gets the current point and nothing else.
    //
    // ⚠️ **A page that rendered NOTHING does not come through here**, and the
    // difference is a defect this branch used to have. An empty view mints
    // `liveCursorBeginning()` rather than no cursor at all, precisely so that
    // "I have nothing" stays distinguishable from "I cannot read my token".
    // While the two were the same `null`, the first post ever written into a
    // declared embed was answered with `posts: []` **and a cursor past it** —
    // so it never arrived, on that poll or any later one, and the symptom was
    // "the first post in a new embed never shows up". Which is the state every
    // embed is in on the day it is declared.
    const [newest] = await db
      .select({ id: communityPosts.id, createdAt: communityPosts.createdAt })
      .from(communityPosts)
      .where(eq(communityPosts.discussionId, discussion.id))
      .orderBy(desc(communityPosts.createdAt), desc(communityPosts.id))
      .limit(1);

    return {
      state: "ok",
      locked,
      stale: false,
      posts: [],
      cursor: newest
        ? liveCursorToken({
            created: { at: newest.createdAt, id: newest.id },
            changed: { at: newest.createdAt, id: newest.id },
          })
        : null,
    };
  }

  const selection = {
    post: communityPosts,
    profileName: communityProfiles.displayName,
    accountName: users.name,
  };
  const join = () =>
    db
      .select(selection)
      .from(communityPosts)
      .leftJoin(users, eq(users.id, communityPosts.authorId))
      .leftJoin(communityProfiles, eq(communityProfiles.memberId, users.id));

  // The two halves run as two bounded queries rather than one `OR`, because
  // they are ordered by different columns and neither may starve the other.
  // In parallel: two statements, one round trip of latency.
  const [createdRows, changedRows] = await Promise.all([
    // Half (a): created past the created-position. The tuple comparison written
    // out with typed columns rather than as a raw `(a,b) > (c,d)` — a raw
    // expression has no mapper, and this schema's own rule is that a date
    // crossing raw SQL is a string wearing a Date's clothes.
    // `live-parity.test.ts` transcribes this back into JS and runs both over
    // the same matrix, exactly as `unread-parity.test.ts` does.
    join()
      .where(
        and(
          eq(communityPosts.discussionId, discussion.id),
          or(
            gt(communityPosts.createdAt, cursor.created.at),
            and(
              eq(communityPosts.createdAt, cursor.created.at),
              gt(communityPosts.id, cursor.created.id),
            ),
          ),
        ),
      )
      .orderBy(asc(communityPosts.createdAt), asc(communityPosts.id))
      .limit(LIVE_POSTS_PER_ANSWER),

    // Half (b): changed past the changed-position — deletions, removals,
    // account scrubs and edits, the states that would otherwise arrive by
    // omission. Ordered by WHEN THEY CHANGED, which is what lets this half
    // advance without waiting on half (a).
    join()
      .where(
        and(
          eq(communityPosts.discussionId, discussion.id),
          or(
            sql`${CHANGED_AT} > ${changedAtParam(cursor.changed.at)}`,
            and(
              sql`${CHANGED_AT} = ${changedAtParam(cursor.changed.at)}`,
              gt(communityPosts.id, cursor.changed.id),
            ),
          ),
        ),
      )
      .orderBy(sql`${CHANGED_AT} asc`, asc(communityPosts.id))
      .limit(LIVE_POSTS_PER_ANSWER),
  ]);

  // A row can satisfy both halves (created since the last poll AND edited
  // since). It travels once; the client upserts by id either way.
  const byId = new Map<string, (typeof createdRows)[number]>();
  for (const row of [...createdRows, ...changedRows]) byId.set(row.post.id, row);

  // The same one query `postsFor()` runs, over the union of both halves — and
  // over the VISIBLE ones only, so a tombstone arriving through half (b) carries
  // no address for a picture its words are no longer shown with. That is not a
  // detail: half (b) exists precisely to deliver deletions, so it is the half
  // that would otherwise hand a reader a live `srcset` for a removed post.
  const images = await postImagesFor(
    [...byId.values()]
      .filter((row) => contentState(row.post) === "visible")
      .map((row) => row.post.id),
    viewer,
  );

  const posts: PostRow[] = [...byId.values()].map((row) => ({
    ...row.post,
    // The same blanking `postsFor()` does, for the same reason: what a server
    // hands a browser is what a reader may see, and a hidden post's words must
    // not travel just because a different surface asked for them.
    content: contentState(row.post) === "visible" ? row.post.content : "",
    // Blanked here as well as excluded from the statement — see `postsFor()` for
    // why both. It matters more on this path: half (b) exists to deliver
    // tombstones, so this is the line that keeps a removal from arriving at an
    // open tab with a live `srcset` still on it.
    images: contentState(row.post) === "visible" ? (images.get(row.post.id) ?? []) : [],
    authorProfileName: row.profileName,
    authorAccountName: row.accountName,
  }));

  // ⚠️ **Neither position ever goes backwards**, and each advances only over
  // the rows ITS OWN half delivered — a created-position moved by a half (b)
  // row would step over undelivered posts, and a changed-position moved by a
  // half (a) row would step over undelivered tombstones.
  const next: LiveCursor = {
    created: advanceCursor(
      cursor.created,
      createdRows.map((row) => ({ at: row.post.createdAt, id: row.post.id })),
    ),
    changed: advanceCursor(
      cursor.changed,
      changedRows.map((row) => ({ at: changedAt(row.post), id: row.post.id })),
    ),
  };

  return { state: "ok", locked, stale: false, posts, cursor: liveCursorToken(next) };
}

/**
 * What is new in one CONVERSATION since one cursor.
 *
 * `liveAnswerFor()`'s post query, message for message — read that function's
 * header for the reasoning behind every part of it, because none of it is
 * different here:
 *
 *   - it writes NOTHING (the marker is `acknowledgeRead()`'s, and only when
 *     the client says it saw the content);
 *   - the query has the same two halves, so a deletion since the cursor
 *     arrives as row-state rather than by omission and the client upserts by
 *     id;
 *   - the next cursor never goes backwards, for the same reason.
 *
 * What IS different is one line: the door. A conversation's access question is
 * participant-ship, re-asked here through the same scoped reader every other
 * DM path uses — so a member who is not in it gets the one `unavailable`
 * state, indistinguishable from a conversation that does not exist.
 *
 * `locked` is always false: a conversation has no lock in v1. The field stays
 * because the wire shape is one shape (AD-70), and a second answer type would
 * be the second grammar this whole design refuses.
 */
async function liveConversationAnswer(
  viewer: { memberId: string; role: string },
  scope: { conversationId: string; cursor?: unknown },
): Promise<LiveScopeAnswer> {
  const conversation = await conversationForParticipant(
    viewer.memberId,
    scope.conversationId,
  );
  if (!conversation) return { state: "unavailable" };

  const cursor = parseLiveCursorToken(scope.cursor);

  if (!cursor) {
    // A token this build cannot read: resynchronise rather than deliver. An
    // empty view mints `liveCursorBeginning()` instead, so it does not come
    // through here — see `liveAnswerFor()` for why that distinction is load
    // bearing.
    const [newest] = await db
      .select({
        id: communityMessages.id,
        createdAt: communityMessages.createdAt,
      })
      .from(communityMessages)
      .where(eq(communityMessages.conversationId, conversation.id))
      .orderBy(desc(communityMessages.createdAt), desc(communityMessages.id))
      .limit(1);

    return {
      state: "ok",
      locked: false,
      // Deletions ride this scope as row-state, so it is never stale.
      stale: false,
      posts: [],
      cursor: newest
        ? liveCursorToken({
            created: { at: newest.createdAt, id: newest.id },
            changed: { at: newest.createdAt, id: newest.id },
          })
        : null,
    };
  }

  const selection = {
    message: communityMessages,
    profileName: communityProfiles.displayName,
    accountName: users.name,
  };
  const join = () =>
    db
      .select(selection)
      .from(communityMessages)
      .leftJoin(users, eq(users.id, communityMessages.authorId))
      .leftJoin(communityProfiles, eq(communityProfiles.memberId, users.id));

  // Two halves, two positions, two bounded queries — `liveAnswerFor()`'s
  // header carries the measured reason a single position starves. A message
  // has no `editedAt`, so this half's key is `deletedAt` alone.
  const [createdRows, changedRows] = await Promise.all([
    join()
      .where(
        and(
          eq(communityMessages.conversationId, conversation.id),
          or(
            // Written out with typed columns rather than as a raw row
            // comparison — a raw expression has no mapper, and a date crossing
            // it is a string wearing a Date's type.
            gt(communityMessages.createdAt, cursor.created.at),
            and(
              eq(communityMessages.createdAt, cursor.created.at),
              gt(communityMessages.id, cursor.created.id),
            ),
          ),
        ),
      )
      .orderBy(asc(communityMessages.createdAt), asc(communityMessages.id))
      .limit(LIVE_POSTS_PER_ANSWER),

    join()
      .where(
        and(
          eq(communityMessages.conversationId, conversation.id),
          or(
            gt(communityMessages.deletedAt, cursor.changed.at),
            and(
              eq(communityMessages.deletedAt, cursor.changed.at),
              gt(communityMessages.id, cursor.changed.id),
            ),
          ),
        ),
      )
      .orderBy(asc(communityMessages.deletedAt), asc(communityMessages.id))
      .limit(LIVE_POSTS_PER_ANSWER),
  ]);

  const byId = new Map<string, (typeof createdRows)[number]>();
  for (const row of [...createdRows, ...changedRows]) {
    byId.set(row.message.id, row);
  }

  const posts: PostRow[] = [...byId.values()].map((row) => ({
    // A message has no `editedAt` — the column does not exist, because a
    // direct message cannot be edited in v1. It is filled in here rather than
    // splitting the wire shape in two: `null` says "never edited", which is
    // exactly what a message that cannot be edited is.
    ...toMessageRow(row.message, row.profileName, row.accountName),
    editedAt: null,
    // ⚠️ **A private message cannot carry a picture, and this is the line that
    // says so rather than implying it.** Story 26.2 put images on POSTS: a room
    // is a place with a moderator and a report queue in it, and a private
    // conversation has neither — an unsolicited picture there is the one delivery
    // nobody can review and nobody else can see. So the column does not exist on
    // `community_messages`, and this is `[]` by construction rather than by
    // resolution. It is filled in here for the same reason `editedAt` is: the
    // wire shape is ONE shape (AD-70).
    images: [],
  }));

  const next: LiveCursor = {
    created: advanceCursor(
      cursor.created,
      createdRows.map((row) => ({
        at: row.message.createdAt,
        id: row.message.id,
      })),
    ),
    changed: advanceCursor(
      cursor.changed,
      changedRows.map((row) => ({
        at: row.message.deletedAt ?? new Date(0),
        id: row.message.id,
      })),
    ),
  };

  return {
    state: "ok",
    locked: false,
    stale: false,
    posts,
    cursor: liveCursorToken(next),
  };
}

/**
 * Take a departing member's words out of everything they wrote here, keeping
 * the tombstones.
 *
 * ⚠️ **Called inside the SAME transaction as the account deletion**, and it
 * takes the transaction as an argument for exactly that reason: a scrub that
 * committed separately would leave a window in which the account is gone and
 * the words are not, or the reverse.
 *
 * What this does and does not do, precisely:
 *
 *   - `content` becomes the empty string. The words go.
 *   - `deletedAt` / `deletedBy = "system"` are set, so `contentState()`
 *     answers `accountDeleted` and every surface renders the tombstone
 *     wording rather than a blank post with a blank author.
 *   - the ROW stays, and the FK sets `author_id` to NULL on its own. That is
 *     the difference from `chat_messages`, which cascades: a chat transcript
 *     is one person talking to a machine and nothing points at it, while a
 *     post is one turn in a conversation other people are still having.
 *     Removing it would turn every reply to it into an answer to nothing.
 *
 * ⚠️ **It runs whether or not the community is switched on**, and that is not
 * an oversight to tidy up. An app that ran a community and later switched it
 * off still holds every row written while it was on; an erasure request is
 * about the data, not about which features are currently enabled. The EXPORT
 * is conditional (a heading naming a feature the operator never enabled is a
 * trace of it); deletion never is.
 *
 * A post already carrying a deletion event keeps its actor — an author's own
 * deletion or a moderator's removal is a record of who acted, and the account
 * going does not rewrite that. Its content is scrubbed either way: the reason
 * those words survived a deletion was the report queue, and the account
 * deletion outranks it.
 */
export async function scrubCommunityContentFor(
  tx: {
    update: typeof db.update;
  },
  memberId: string,
): Promise<void> {
  // ⚠️ TWO statements, scoped by whether the row already carries a deletion,
  // and the split is the point. One statement over every post of this member
  // would set `deletedBy = "system"` on a post a MODERATOR removed — erasing
  // the record of a moderation decision, which is precisely what the
  // one-deletion-event rule exists to prevent. Here it would be erased by an
  // unrelated act, which is worse than by the author.
  //
  // Still live: this deletion is the deletion event.
  await tx
    .update(communityPosts)
    .set({ content: "", deletedAt: new Date(), deletedBy: "system" })
    .where(
      and(
        eq(communityPosts.authorId, memberId),
        isNull(communityPosts.deletedAt),
      ),
    );

  // Already deleted by the author or removed by a moderator: the actor stays,
  // only the words go. The report queue was the reason those words survived
  // their deletion; an erasure request outranks it.
  //
  // ⚠️ `removedReason` goes with them, and the split from `deletedBy` is the
  // whole point: WHO acted is the record of a moderation decision and survives,
  // WHAT was written about the person does not. A removal reason is free text a
  // moderator wrote about this member — it routinely quotes or names them — so
  // it is their personal data on the same argument that puts `grants[].note`
  // into the export. Nothing writes the column yet; the moderation release
  // does, and by then this statement is already here.
  await tx
    .update(communityPosts)
    .set({ content: "", removedReason: null })
    .where(
      and(
        eq(communityPosts.authorId, memberId),
        isNotNull(communityPosts.deletedAt),
      ),
    );

  // ── The private half: the same two statements over `community_messages` ──
  //
  // ⚠️ **Both content tables, or the promise is half kept.** A member asking to
  // be deleted means the words they wrote to one person as much as the ones
  // they wrote to a room — arguably more. The messages are the reason this
  // function stopped being called `scrubPostsOfDepartingMember`: a name that
  // says "posts" is a name the next content table quietly does not join.
  //
  // The ROW stays, and that is the `community_posts` argument one table over
  // rather than a copy of it: the surviving participant keeps their own side of
  // the conversation (FR-203), and removing the departed member's rows would
  // turn every answer they got into an answer to nothing. What is left is a
  // tombstone — structure with no personal data in it.
  await tx
    .update(communityMessages)
    .set({ content: "", deletedAt: new Date(), deletedBy: "system" })
    .where(
      and(
        eq(communityMessages.authorId, memberId),
        isNull(communityMessages.deletedAt),
      ),
    );

  // Already carrying a deletion event: the actor stays, only the words go —
  // and `removedReason` with them, for the reason the post half gives.
  await tx
    .update(communityMessages)
    .set({ content: "", removedReason: null })
    .where(
      and(
        eq(communityMessages.authorId, memberId),
        isNotNull(communityMessages.deletedAt),
      ),
    );

  // ── What somebody wrote in a spam report ─────────────────────────────────
  //
  // The report itself stays — an unconsumed one is what the automatic
  // send-block is derived from (AD-64), and deleting an account must not lift
  // a block against somebody else. The SENTENCE goes, from both directions:
  // it is the reporter's own words when they are the one leaving, and it is
  // text written about the reported member when they are. Either way it is
  // free text about a person, which is the `grants[].note` category.
  await tx
    .update(communitySpamReports)
    .set({ reason: null })
    .where(
      or(
        eq(communitySpamReports.reporterId, memberId),
        eq(communitySpamReports.reportedMemberId, memberId),
      ),
    );

  // ── What a moderator wrote ABOUT this member ─────────────────────────────
  //
  // ⚠️ **The ACT stays, the sentence goes** — and the split is the same one
  // the post half makes. Who acted, what they did and when is the record of a
  // moderation decision and survives the person it was about; `reason` is free
  // text a moderator wrote about them, which is the `grants[].note` category
  // and is theirs. A trail that emptied itself on an erasure request would be
  // a trail with a way to erase yourself from it; one that kept the sentence
  // would be an erasure request answered with "not that bit".
  //
  // Scoped to rows where this member is the TARGET. A reason on a row they
  // wrote as an actor is about somebody else, and stays.
  await tx
    .update(communityModerationAudit)
    .set({ reason: null })
    .where(eq(communityModerationAudit.targetMemberId, memberId));

  // ⚠️ **A discussion TITLE is the member's own words too, and it was the one
  // piece of authored text that survived an erasure request.** The FK sets
  // `created_by` to NULL, so the row stayed with the sentence intact and no
  // author attached — de-attributed rather than deleted, which is precisely
  // the shape the module's deletion doctrine rules out. Three shipped texts
  // said the opposite of what the code did: the schema header on this table,
  // `docs/data-protection.md` §14c, and Story 19.6's own acceptance criteria.
  //
  // The title goes to the empty string rather than to a placeholder sentence,
  // for the reason every code in this module is a code: a message born in
  // `lib/` exists in exactly one language. `titleState()` in `rules.ts` reads
  // the empty title back as `scrubbed` and the renderer says it in the
  // reader's own — the same split `contentState()` already uses for a post.
  // `checkDiscussionTitle()` refuses a blank title, so an empty one in the
  // database can only ever have come from here.
  await tx
    .update(communityDiscussions)
    .set({ title: "" })
    .where(eq(communityDiscussions.createdBy, memberId));
}

// ───────────────────────────────────────────────────────────────────────────
// Unread — one writer, one read, and no second path
// ───────────────────────────────────────────────────────────────────────────

/**
 * Record how far a member has read in one thread.
 *
 * ⚠️ **The ONLY function in this module that writes a read marker, and it must
 * stay the only one.** In particular a live-updates endpoint must never write
 * one as a side effect of answering: "what is new since X" and "I have seen up
 * to X" are different claims, and a channel that marks things read because it
 * delivered them marks a message read that nobody looked at — a tab left open
 * overnight would empty somebody's inbox. Acknowledgment is a separate act,
 * from the client, after the content actually rendered.
 *
 * Three properties, each of which is a refusal of a cheaper implementation:
 *
 *  1. **Access is re-checked.** A member acknowledging a thread they may no
 *     longer enter writes nothing. Not an error — there is nothing wrong with
 *     the request, a refund simply happened between the render and the
 *     acknowledgment — so it returns quietly.
 *
 *  2. **The tuple is CLAMPED to a post that really is in this thread.** The
 *     browser sends an id; this looks it up and uses the row's own
 *     `createdAt`, so a hostile client cannot acknowledge a point in the
 *     future and silence a thread for ever. An id naming a post of another
 *     thread, or none, writes nothing.
 *
 *  3. **Advance-only, in the conflict clause itself.** Re-rendering page 1 of
 *     an old thread must not un-read the newer posts already acknowledged.
 *     Postgres compares `(a, b) < (c, d)` lexicographically — which is exactly
 *     `compareCursor()`'s order, so the SQL and the pure function are the same
 *     comparison rather than two that agree today. (The raw-SQL date trap does
 *     not bite here: nothing is selected back through this expression, it is
 *     only compared inside Postgres.)
 *
 * ── TWO legs, ONE writer ──────────────────────────────────────────────────
 * The direct-message release extended THIS function rather than adding a
 * second writer, which is the whole point of the marker table having one
 * shape with an either/or check constraint. The legs differ in exactly three
 * things — what access means (being in the room / being in the conversation),
 * which table the clamp reads, and which partial unique index the conflict
 * targets — and share everything else, including the advance-only clause that
 * is the easiest half to get subtly wrong twice.
 */
export async function acknowledgeRead(
  input:
    | {
        discussionId: string;
        postId: string;
        viewer: { memberId: string; role: string };
      }
    | {
        conversationId: string;
        messageId: string;
        viewer: { memberId: string; role: string };
      },
): Promise<void> {
  const isConversation = "conversationId" in input;

  // 1. Access. A member acknowledging something they may no longer reach
  //    writes nothing, and it is not an error — a refund or a departed
  //    counterpart simply happened between the render and the acknowledgment.
  if (isConversation) {
    const conversation = await conversationForParticipant(
      input.viewer.memberId,
      input.conversationId,
    );
    if (!conversation) return;
  } else {
    const found = await discussionForViewer(input.discussionId, input.viewer);
    if (!found) return;
  }

  // 2. The clamp. The `createdAt` used is the ROW's, never the browser's — and
  //    the row must really be in the thread or conversation being acknowledged,
  //    so an id from another one writes nothing.
  const [row] = isConversation
    ? await db
        .select({
          id: communityMessages.id,
          createdAt: communityMessages.createdAt,
        })
        .from(communityMessages)
        .where(
          and(
            eq(communityMessages.id, input.messageId),
            eq(communityMessages.conversationId, input.conversationId),
          ),
        )
        .limit(1)
    : await db
        .select({ id: communityPosts.id, createdAt: communityPosts.createdAt })
        .from(communityPosts)
        .where(
          and(
            eq(communityPosts.id, input.postId),
            eq(communityPosts.discussionId, input.discussionId),
          ),
        )
        .limit(1);
  if (!row) return;

  // 3. The write. The unique indexes are PARTIAL, so each conflict target has
  //    to carry its own predicate or Postgres cannot infer which index is
  //    meant — and the check constraint means exactly one of the two target
  //    columns is ever set.
  const target = isConversation
    ? {
        columns: [
          communityReadMarkers.memberId,
          communityReadMarkers.conversationId,
        ],
        where: sql`${communityReadMarkers.conversationId} is not null`,
        values: {
          conversationId: input.conversationId,
        },
      }
    : {
        columns: [
          communityReadMarkers.memberId,
          communityReadMarkers.discussionId,
        ],
        where: sql`${communityReadMarkers.discussionId} is not null`,
        values: {
          discussionId: input.discussionId,
        },
      };

  await db
    .insert(communityReadMarkers)
    .values({
      memberId: input.viewer.memberId,
      ...target.values,
      lastReadCreatedAt: row.createdAt,
      lastReadId: row.id,
    })
    .onConflictDoUpdate({
      target: target.columns,
      targetWhere: target.where,
      set: {
        lastReadCreatedAt: sql`excluded.last_read_created_at`,
        lastReadId: sql`excluded.last_read_id`,
        updatedAt: new Date(),
      },
      // Advance-only. A regressing acknowledgment becomes a no-op instead of
      // un-reading newer content. Postgres compares `(a, b) < (c, d)`
      // lexicographically — which is exactly `compareCursor()`'s order.
      setWhere: sql`(${communityReadMarkers.lastReadCreatedAt}, ${communityReadMarkers.lastReadId}) < (excluded.last_read_created_at, excluded.last_read_id)`,
    });
}

/**
 * Nothing that happened before this member existed counts as unread.
 *
 * ⚠️ **Without it the dot is lit on the day somebody signs up and stays lit.**
 * "No marker" means unread, so a member joining an app whose community already
 * holds three hundred threads is told every one of them is new — and the only
 * way to clear the indicator is to open all of them, in every room they can
 * reach. That is the permanent dot `hasUnread()`'s own header argues against:
 * an indicator that is always on is an indicator nobody reads.
 *
 * The watermark is on the ACCOUNT, not on the room, and the difference matters.
 * A member who buys a plan-gated room months after signing up still sees that
 * room's older threads as unread — correctly, because the room is new to them
 * even though the threads are not. This only silences what existed before they
 * did, which is the one set they can never have missed.
 *
 * `cache()`d: all three unread reads ask for it, and on the community page two
 * of them run in the same render.
 */
const joinWatermark = cache(async function joinWatermark(memberId: string) {
  const [member] = await db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, memberId))
    .limit(1);
  // No row (an impersonated or vanishing account): no watermark rather than a
  // wrong one. `undefined` drops out of `and()` and the read behaves as before.
  if (!member?.createdAt) return undefined;
  return gt(communityDiscussions.lastActivityAt, member.createdAt);
});

/**
 * Which of these groups can this viewer enter — the set every unread read
 * starts from.
 *
 * ⚠️ **NFR-41's leak clause lives here.** A discussion in a room the viewer
 * may not enter contributes nothing: no dot, no count, no timing signal. An
 * indicator that lit up because a paid room moved would be a second access
 * path — cheaper to read than the room itself, and readable by somebody who
 * never bought anything.
 */
const accessibleGroupIds = cache(async function accessibleGroupIds(
  memberId: string,
  role: string,
): Promise<string[]> {
  // Four columns, not `SELECT *`. `mayEnterGroup()` reads three of them and
  // the caller wants the id; every other column was being carried across the
  // wire for every room on every protected page render.
  const groups = await db
    .select({
      id: communityGroups.id,
      accessLevel: communityGroups.accessLevel,
      planKeys: communityGroups.planKeys,
      archivedAt: communityGroups.archivedAt,
    })
    .from(communityGroups)
    .where(isNull(communityGroups.archivedAt));

  const grantedKeys = await grantedKeysFor(memberId, planKeysToResolve(groups));
  return groups
    .filter((group) => mayEnterGroup(group, { role, grantedKeys }))
    .map((group) => group.id);
});

/**
 * Is there anything new for this member anywhere they can reach?
 *
 * ⚠️ **This runs on effectively every shell render of a community-on app**, so
 * its cost is a design constraint rather than an afterthought. The budget,
 * stated honestly because it used to be stated wrongly — this comment and the
 * layout's both said "ONE existence query" while three things were happening:
 *
 *   1. one room query (`accessibleGroupIds`, four columns, bounded by however
 *      many rooms the operator made),
 *   2. one `hasPlan()` per DISTINCT plan key across those rooms, and
 *   3. the existence query itself — `LIMIT 1`, because the question is "is
 *      there any", never "how many", riding the `(group_id, last_activity_at)`
 *      index and the marker's own unique index.
 *
 * So: 2 + one per distinct key. Steps 1 and 2 are `cache()`d per request, which
 * is what stops the community page from deriving the same set again moments
 * later — that was the same work twice in one render, not merely a warm path.
 * Collapsing step 2 into a single query needs an `inArray` variant in the
 * entitlements seam; that belongs to Epic 20, and until it exists this is the
 * budget rather than a claim of one query.
 *
 * A count would invite an unbounded aggregation on the busiest path in the
 * app, and nothing asks for one — the indicator is a dot.
 *
 * The layout calls this only when the community is switched on, so an app that
 * never enabled the module issues no community query at all.
 */
export async function unreadFor(viewer: {
  memberId: string;
  role: string;
}): Promise<boolean> {
  const groupIds = await accessibleGroupIds(viewer.memberId, viewer.role);
  if (groupIds.length === 0) return false;

  const [row] = await db
    .select({ id: communityDiscussions.id })
    .from(communityDiscussions)
    .leftJoin(
      communityReadMarkers,
      and(
        eq(communityReadMarkers.discussionId, communityDiscussions.id),
        eq(communityReadMarkers.memberId, viewer.memberId),
      ),
    )
    .where(
      and(
        inArray(communityDiscussions.groupId, groupIds),
        await joinWatermark(viewer.memberId),
        // No marker at all, or activity strictly newer than the marker. The
        // nav path has no post id to compare with, so equality counts as READ
        // — `hasUnread()` carries the reasoning, and this SQL is its twin.
        sql`(${communityReadMarkers.memberId} is null or ${communityDiscussions.lastActivityAt} > ${communityReadMarkers.lastReadCreatedAt})`,
      ),
    )
    .limit(1);

  return Boolean(row);
}

/**
 * Which of these discussions have moved since this member last read them.
 *
 * The same comparison as `unreadFor`, without the `LIMIT 1` and scoped to the
 * discussions a page has already decided to render — so it stays bounded by
 * the page size rather than by the number of threads that exist.
 *
 * It takes ids the caller has ALREADY access-checked (they came out of
 * `discussionsFor()` for a group this viewer may enter), which is why it does
 * not re-derive the accessible set: doing so would cost a second pass of
 * `hasPlan()` per render for an answer the page already has.
 */
export async function unreadByDiscussion(
  memberId: string,
  discussionIds: readonly string[],
): Promise<Set<string>> {
  if (discussionIds.length === 0) return new Set();

  const rows = await db
    .select({ id: communityDiscussions.id })
    .from(communityDiscussions)
    .leftJoin(
      communityReadMarkers,
      and(
        eq(communityReadMarkers.discussionId, communityDiscussions.id),
        eq(communityReadMarkers.memberId, memberId),
      ),
    )
    .where(
      and(
        inArray(communityDiscussions.id, [...discussionIds]),
        await joinWatermark(memberId),
        sql`(${communityReadMarkers.memberId} is null or ${communityDiscussions.lastActivityAt} > ${communityReadMarkers.lastReadCreatedAt})`,
      ),
    );

  return new Set(rows.map((row) => row.id));
}

/**
 * Which of these ROOMS hold something this member has not read.
 *
 * The same comparison as `unreadByDiscussion`, rolled up one level: a room's
 * card says "something in here is new" without saying how much or where. That
 * is deliberate on the same grounds as everything else about a room card —
 * a count would be an aggregation on a page every member opens, and it would
 * start describing how busy a paid room is to somebody deciding whether to buy.
 *
 * Takes group ids the caller has ALREADY access-checked (they came out of
 * `groupsFor()`), so the accessible set is not derived twice per render.
 */
export async function unreadByGroup(
  memberId: string,
  groupIds: readonly string[],
): Promise<Set<string>> {
  if (groupIds.length === 0) return new Set();

  const rows = await db
    .selectDistinct({ groupId: communityDiscussions.groupId })
    .from(communityDiscussions)
    .leftJoin(
      communityReadMarkers,
      and(
        eq(communityReadMarkers.discussionId, communityDiscussions.id),
        eq(communityReadMarkers.memberId, memberId),
      ),
    )
    .where(
      and(
        inArray(communityDiscussions.groupId, [...groupIds]),
        await joinWatermark(memberId),
        sql`(${communityReadMarkers.memberId} is null or ${communityDiscussions.lastActivityAt} > ${communityReadMarkers.lastReadCreatedAt})`,
      ),
    );

  // `group_id` became nullable when embedded discussions arrived, and the
  // filter above is what keeps a NULL out of this set: `inArray` never matches
  // one, so an embedded discussion contributes to no room's dot. That is the
  // right answer rather than a gap — an embed has no card in the community
  // section to light up, and its unread indicator is the host page's question,
  // which nothing has asked yet.
  return new Set(
    rows
      .map((row) => row.groupId)
      .filter((groupId): groupId is string => groupId !== null),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Direct messages — every reader takes a participant id, and there is no other
// kind of reader
// ───────────────────────────────────────────────────────────────────────────
//
// 🚨 **The module's hardest line lives in this block.** Two members talk
// privately, and private means private — the two participants, nobody else,
// structurally (FR-200, AD-59). Concretely, and these are rules rather than
// descriptions of the current code:
//
//   1. **Every function below takes `participantId` as its FIRST parameter**
//      and puts it in the WHERE clause of every statement it issues. Not "the
//      caller checks first" — the scoping is in the query, so a caller that
//      forgets cannot read anything anyway.
//   2. **There is no unscoped reader, for anyone.** No moderator view, no
//      operator view, no admin surface, no "just for support". The report
//      queue (Epic 23) is the one exception this module will ever grant, it
//      arrives with its own bounded window (AD-71), and it joins the
//      allowlist in `dm-guard.test.ts` deliberately rather than by accident.
//   3. **`lib/community/dm-guard.test.ts` reads this file** and fails the
//      build when an exported function touches a DM table without naming a
//      participant, or when a file outside a short allowlist mentions one of
//      the two tables at all. A rule nobody can remember, enforced by
//      something that reads the tree — the `leak-guard.test.ts` shape.

/** How many conversations one page of the inbox holds. */
export const CONVERSATIONS_PER_PAGE = 30;

/** How many messages one page of a conversation holds. */
export const MESSAGES_PER_PAGE = 50;

/** One direct message, with everything a renderer needs and nothing it does not. */
export interface MessageRow {
  id: string;
  authorId: string | null;
  content: string;
  createdAt: Date;
  deletedAt: Date | null;
  deletedBy: "author" | "moderator" | "system" | null;
  removedReason: string | null;
  /** The author's name fields — resolved through `displayNameFor()` by the UI. */
  authorProfileName: string | null;
  authorAccountName: string | null;
}

/** One conversation, as the inbox renders it. */
export interface ConversationRow {
  id: string;
  /** The other person, `null` once their account is gone. */
  counterpartId: string | null;
  counterpartProfileName: string | null;
  counterpartAccountName: string | null;
  /** When the newest message landed. Derived, never stored — see the schema. */
  lastMessageAt: Date;
  /** A preview of the newest message, already blanked if it is not visible. */
  lastMessagePreview: string;
  unread: boolean;
}

/**
 * How long a preview may be.
 *
 * Cut on the SERVER rather than with CSS: an inbox row that ships a whole
 * message and hides it with an ellipsis has shipped the whole message, and
 * "what does the page's payload contain" is the question that matters for text
 * one person wrote to another.
 */
const PREVIEW_LENGTH = 140;

/**
 * Can this member be written to at all?
 *
 * ⚠️ **Every "no" here becomes ONE code.** No such account, a blocked account,
 * oneself, and — from Story 21.2 — a member who blocked this sender. FR-201
 * requires the block's refusal to be indistinguishable from any other
 * undeliverable message, and that is only true if the causes never separate
 * above this function. See `communityNotDeliverable` in `rules.ts`.
 *
 * The block re-check is `lib/users/blocked.ts`'s pattern rather than its
 * function: `isUserBlocked()` treats an unknown id as blocked, which is right
 * for a running session and would merge "no such member" into "blocked" here
 * — the same answer, but reached by accident rather than by decision. One
 * query, read explicitly.
 */
async function isDeliverableTo(
  memberId: string,
  targetId: string,
): Promise<boolean> {
  // ⚠️ **Both facts are read every time, even when the first one already
  // decides.** A short-circuit here would make the causes tell each other
  // apart by timing: one database round trip for "no such account", two for
  // "blocked you", measurable with enough samples. `lib/impersonation/
  // session.ts` gives the same reasoning for refusing silently, and this is
  // the cheaper version of it — two indexed lookups on a path that already
  // does several.
  const [[target], blocks] = await Promise.all([
    db
      .select({ blockedAt: users.blockedAt })
      .from(users)
      .where(eq(users.id, targetId))
      .limit(1),

    // A block in EITHER direction. Two equality pairs rather than a clever
    // one — each rides its own index (`…_pair` and `…_blocked`), and the
    // answer is one boolean by design: a caller that could see WHO blocked
    // whom could answer the question the neutral refusal exists not to
    // answer.
    db
      .select({ id: communityMemberBlocks.id })
      .from(communityMemberBlocks)
      .where(
        or(
          and(
            eq(communityMemberBlocks.blockerId, memberId),
            eq(communityMemberBlocks.blockedId, targetId),
          ),
          and(
            eq(communityMemberBlocks.blockerId, targetId),
            eq(communityMemberBlocks.blockedId, memberId),
          ),
        ),
      )
      .limit(1),
  ]);

  return (
    canDeliverTo({
      self: memberId === targetId,
      target: target ?? null,
      blockedEitherWay: blocks.length > 0,
    }) === null
  );
}

/**
 * Block another member — and sever whatever they had between them.
 *
 * ⚠️ **The severing happens INSIDE this transaction, and it is a DELETE.**
 * Two wrong builds were available and both are worth naming, because each
 * looks reasonable on its own:
 *
 *  - **Read-time filtering** ("hide follows where a block exists") leaves the
 *    row in the table. It would then travel in the follower's own export — so
 *    the export would disclose that a block exists, which is precisely what
 *    the neutral refusal is built not to say. A hidden relationship is not a
 *    severed one.
 *  - **A database trigger** would move the invariant out of the one
 *    transaction the shell owns and out of sight of every test that drives
 *    this layer.
 *
 * Symmetric: both directions of follow go, whichever direction the block has.
 * And final — `unblockMember()` touches follows not at all, so lifting a block
 * resurrects nothing and following again is a new, deliberate act.
 *
 * Idempotent: blocking twice is one row, decided by the unique index rather
 * than by a read that raced. Self-blocking is refused in the core.
 *
 * The blocker is the caller's own id — no surface anywhere passes somebody
 * else's, the `spendTokens()` guarantee applied to a relation.
 */
export async function blockMember(
  blockerId: string,
  blockedId: string,
): Promise<void> {
  const denial = canBlockMember(blockerId, blockedId);
  if (denial) throw new CommunityError(denial);

  await db.transaction(async (tx) => {
    await tx
      .insert(communityMemberBlocks)
      .values({ blockerId, blockedId })
      .onConflictDoNothing({
        target: [
          communityMemberBlocks.blockerId,
          communityMemberBlocks.blockedId,
        ],
      });

    // Both directions, in the same transaction as the block itself — there is
    // no moment in which the block stands and a follow between the two
    // survives it.
    await tx
      .delete(communityFollows)
      .where(
        or(
          and(
            eq(communityFollows.followerId, blockerId),
            eq(communityFollows.followedId, blockedId),
          ),
          and(
            eq(communityFollows.followerId, blockedId),
            eq(communityFollows.followedId, blockerId),
          ),
        ),
      );
  });
}

/**
 * Lift one's own block.
 *
 * Deletion, never a flag — a lifted block leaves no trace, which is what makes
 * it genuinely reversible and keeps the table from growing a history of who
 * once did not want to hear from whom.
 *
 * The signature carries no third path: only the blocker can lift their own
 * block, because `blockerId` is the only place a member id goes and it is
 * always the session's.
 */
export async function unblockMember(
  blockerId: string,
  blockedId: string,
): Promise<void> {
  await db
    .delete(communityMemberBlocks)
    .where(
      and(
        eq(communityMemberBlocks.blockerId, blockerId),
        eq(communityMemberBlocks.blockedId, blockedId),
      ),
    );
}

/**
 * Whom this member has blocked — their own list, and nobody else's.
 *
 * The AD-59 signature shape applied to the block table: the id is the scope,
 * in the WHERE clause. There is deliberately no reader for the other
 * direction anywhere in this module — "who has blocked me" is the question
 * the neutral refusal exists to leave unanswered.
 */
export async function listBlocks(
  blockerId: string,
): Promise<Array<{ blockedId: string; createdAt: Date }>> {
  return db
    .select({
      blockedId: communityMemberBlocks.blockedId,
      createdAt: communityMemberBlocks.createdAt,
    })
    .from(communityMemberBlocks)
    .where(eq(communityMemberBlocks.blockerId, blockerId))
    .orderBy(asc(communityMemberBlocks.createdAt));
}

/**
 * Has this member blocked that one? For the surface's own label.
 *
 * ⚠️ **One direction only, and it is the caller's own.** It answers "have I
 * blocked them", never "have they blocked me" — a button that could say the
 * second would be the disclosure FR-201 refuses, arriving through the UI
 * instead of through an error message.
 */
export async function hasBlocked(
  blockerId: string,
  blockedId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: communityMemberBlocks.id })
    .from(communityMemberBlocks)
    .where(
      and(
        eq(communityMemberBlocks.blockerId, blockerId),
        eq(communityMemberBlocks.blockedId, blockedId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * The conversation, if this member is in it.
 *
 * ⚠️ **`null` for "no such conversation" AND for "not yours"**, one answer —
 * the 20.1 precedent applied to a row instead of a room. Telling the two apart
 * would let somebody walk conversation ids and learn which exist, and what
 * exists here is who talks to whom.
 *
 * Participant-ship is in the WHERE clause, not merely checked after the read.
 * The check afterwards would be a decision a refactor could route around; the
 * clause is what makes the row unreachable.
 */
async function conversationForParticipant(
  participantId: string,
  conversationId: string,
): Promise<typeof communityConversations.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(communityConversations)
    .where(
      and(
        eq(communityConversations.id, conversationId),
        or(
          eq(communityConversations.participantAId, participantId),
          eq(communityConversations.participantBId, participantId),
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * The direct-message brake, asked once per send.
 *
 * `guardPostRate()`'s twin on its own bucket (the third of the module's
 * three), recorded only when the write is about to happen — a refusal further
 * up must not spend an allowance.
 */
function guardMessageRate(memberId: string): void {
  const limit = messageLimit(communityConfig().messaging.maxPer10Min);
  if (isLimited(COMMUNITY_DM_RATE_BUCKET, memberId, limit)) {
    throw new CommunityError("communityMessageRateLimited");
  }
  record(COMMUNITY_DM_RATE_BUCKET, memberId, limit);
}

/**
 * Start (or find) the conversation between this member and one other.
 *
 * **Insert-on-conflict against the canonical pair**, so starting twice lands
 * in the same row: two members who each press "write" in the same second get
 * one conversation, decided by the unique index rather than by a read that
 * raced. `canonicalPair()` is the one place the column order is decided.
 *
 * The returned row is only ever one this member participates in — by
 * construction, since the pair is built from their own id.
 */
export async function openConversation(
  participantId: string,
  otherMemberId: string,
): Promise<{ conversationId: string }> {
  const denial = canSendMessage(await participationProfile(participantId));
  if (denial) throw new CommunityError(denial);

  if (!(await isDeliverableTo(participantId, otherMemberId))) {
    throw new CommunityError("communityNotDeliverable");
  }

  const pair = canonicalPair(participantId, otherMemberId);
  // Unreachable in practice — `isDeliverableTo()` refuses oneself — and kept
  // because the alternative is a CHECK-constraint violation reaching a member
  // as a 500 if that ever changes.
  if (!pair) throw new CommunityError("communityNotDeliverable");

  const [row] = await db
    .insert(communityConversations)
    .values(pair)
    .onConflictDoUpdate({
      target: [
        communityConversations.participantAId,
        communityConversations.participantBId,
      ],
      // Nothing to change — the row IS the pair. `DO UPDATE` rather than
      // `DO NOTHING` because only the former returns the existing row, and
      // this function's whole job is to hand back an id.
      set: { participantAId: pair.participantAId },
    })
    .returning({ id: communityConversations.id });

  return { conversationId: row.id };
}

/**
 * Write into a conversation this member is in.
 *
 * The order of the checks IS the design, and it is `addPost()`'s: enablement
 * (at the surface) → participant-ship, re-read from the row → participation →
 * content → rate limit → write. Nothing is carried over from the render that
 * drew the composer.
 *
 * ⚠️ **The counterpart's deliverability is re-checked on every message, not
 * only when the conversation is opened.** An account blocked after the first
 * message — and, from Story 21.2, a member who blocked this sender afterwards
 * — must stop receiving, and a conversation that already exists is exactly the
 * door somebody would come back through.
 */
export async function sendMessage(
  participantId: string,
  conversationId: string,
  input: { content: unknown },
): Promise<{ messageId: string }> {
  const conversation = await conversationForParticipant(
    participantId,
    conversationId,
  );
  if (!conversation) throw new CommunityError("notFound");

  const denial = canSendMessage(await participationProfile(participantId));
  if (denial) throw new CommunityError(denial);

  await guardSendBlock(participantId);

  const counterpartId = counterpartOf(conversation, participantId);
  // A departed counterpart is not deliverable — the conversation survives as
  // a tombstone (FR-203) and is readable, but nobody is there to write to.
  if (
    counterpartId === null ||
    !(await isDeliverableTo(participantId, counterpartId))
  ) {
    throw new CommunityError("communityNotDeliverable");
  }

  const content = checkMessageContent(input.content);
  if (!content.ok) throw new CommunityError(content.code);

  guardMessageRate(participantId);

  return releaseMessageRateOnFailure(participantId, async () => {
    const [message] = await db
      .insert(communityMessages)
      .values({
        conversationId,
        authorId: participantId,
        content: content.content,
      })
      .returning({ id: communityMessages.id });
    return { messageId: message.id };
  });
}

/**
 * `releaseRateOnFailure()` on the DM bucket — same reasoning, same deliberate
 * non-compensation: it drops one recorded hit, so under a genuine flood the
 * allowance still runs out.
 */
async function releaseMessageRateOnFailure<T>(
  memberId: string,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    forgetOne(COMMUNITY_DM_RATE_BUCKET, memberId);
    throw error;
  }
}

/**
 * This member's inbox, newest conversation first.
 *
 * ── Recency without a materialization ─────────────────────────────────────
 * There is no `lastMessageAt` column (AD-62 permits exactly one
 * materialization in this module and it is `community_discussions`), so the
 * order comes from a grouped aggregate over `community_messages` riding the
 * `(conversation_id, created_at, id)` index. `.mapWith()` rather than a bare
 * ``sql<Date>`` — a raw expression has no mapper, and a timestamp that arrives
 * as a Postgres string wearing a `Date`'s type is this repo's own documented
 * trap.
 *
 * ── A conversation with no messages is not in anybody's inbox ─────────────
 * The join is an INNER one, deliberately. `openConversation()` writes a row
 * before the first message is sent, and an empty row appearing in the other
 * person's inbox would be a way to put yourself in front of somebody without
 * saying anything — contact with no content, which is precisely what a member
 * cannot report and Story 21.2's block would have nothing to attach to. The
 * initiator loses nothing: they are on the conversation page, and their first
 * message brings the row into both inboxes at once.
 *
 * ── Unread is `hasUnread()`, in JS, and that is affordable HERE ───────────
 * The three room-side unread reads must compare inside a `WHERE` because they
 * are unbounded; this one is bounded by the page size, so it can call the pure
 * core directly. That closes the gap `hasUnread()`'s own header names — it had
 * no production caller — with the definition rather than with a fourth
 * transcription of it into SQL.
 */
export async function listConversations(
  participantId: string,
  page: number = 1,
): Promise<{ rows: ConversationRow[]; total: number; page: number }> {
  const mine = or(
    eq(communityConversations.participantAId, participantId),
    eq(communityConversations.participantBId, participantId),
  );

  // `count(distinct …)`, not `count()`: the inner join produces one row per
  // MESSAGE, so a plain count would page the inbox by how much was said rather
  // than by how many conversations there are. `sql<number>` is safe here in a
  // way `sql<Date>` never is — a number has no mapper to lose, and `mapWith`
  // says so explicitly.
  const [{ total }] = await db
    .select({
      total: sql<number>`count(distinct ${communityConversations.id})`.mapWith(
        Number,
      ),
    })
    .from(communityConversations)
    .innerJoin(
      communityMessages,
      eq(communityMessages.conversationId, communityConversations.id),
    )
    .where(mine);

  // No `"last"` here, unlike a thread: the inbox is newest-first, so page 1
  // already holds what somebody opened it for.
  const pages = lastPageOf(total, CONVERSATIONS_PER_PAGE);
  const current = Math.min(Math.max(1, page), pages);

  const rows = await db
    .select({
      id: communityConversations.id,
      participantAId: communityConversations.participantAId,
      participantBId: communityConversations.participantBId,
      lastMessageAt: sql`max(${communityMessages.createdAt})`.mapWith(
        communityMessages.createdAt,
      ),
      // `max()` over a left join that yields at most one marker row per
      // conversation — the aggregate is there because the query is grouped,
      // not because there is anything to aggregate.
      lastReadCreatedAt: sql`max(${communityReadMarkers.lastReadCreatedAt})`.mapWith(
        communityReadMarkers.lastReadCreatedAt,
      ),
      lastReadId: sql<string | null>`max(${communityReadMarkers.lastReadId})`,
    })
    .from(communityConversations)
    .innerJoin(
      communityMessages,
      eq(communityMessages.conversationId, communityConversations.id),
    )
    // The marker is this member's own, or none. Scoped in the JOIN rather than
    // in the WHERE: a left join filtered afterwards is an inner join wearing a
    // disguise, and would drop every conversation nobody has acknowledged yet.
    .leftJoin(
      communityReadMarkers,
      and(
        eq(communityReadMarkers.conversationId, communityConversations.id),
        eq(communityReadMarkers.memberId, participantId),
      ),
    )
    .where(mine)
    // Grouped by the COLUMNS, never by a repeated select expression — a
    // repeated expression emits a fresh placeholder and Postgres cannot prove
    // the two are equal (the documented Drizzle trap, which typechecks and
    // fails only on a real render).
    .groupBy(
      communityConversations.id,
      communityConversations.participantAId,
      communityConversations.participantBId,
    )
    .orderBy(sql`max(${communityMessages.createdAt}) desc`)
    .limit(CONVERSATIONS_PER_PAGE)
    .offset(pageOffset(current, CONVERSATIONS_PER_PAGE));

  if (rows.length === 0) return { rows: [], total, page: current };

  // The counterpart's name, and the newest message's text — two bounded reads
  // over the page's own rows rather than a wider join, because the aggregate
  // above cannot carry a non-grouped column.
  const conversationIds = rows.map((row) => row.id);
  const counterpartIds = [
    ...new Set(
      rows
        .map((row) => counterpartOf(row, participantId))
        .filter((id): id is string => id !== null),
    ),
  ];

  const [names, newest] = await Promise.all([
    counterpartIds.length
      ? db
          .select({
            memberId: users.id,
            accountName: users.name,
            profileName: communityProfiles.displayName,
          })
          .from(users)
          .leftJoin(
            communityProfiles,
            eq(communityProfiles.memberId, users.id),
          )
          .where(inArray(users.id, counterpartIds))
      : Promise.resolve([]),

    db
      .select({
        conversationId: communityMessages.conversationId,
        content: communityMessages.content,
        createdAt: communityMessages.createdAt,
        id: communityMessages.id,
        deletedAt: communityMessages.deletedAt,
        deletedBy: communityMessages.deletedBy,
      })
      .from(communityMessages)
      .where(inArray(communityMessages.conversationId, conversationIds))
      .orderBy(
        asc(communityMessages.conversationId),
        desc(communityMessages.createdAt),
        desc(communityMessages.id),
      ),
  ]);

  const nameOf = new Map(names.map((row) => [row.memberId, row]));
  const previewOf = new Map<string, (typeof newest)[number]>();
  for (const message of newest) {
    if (!previewOf.has(message.conversationId)) {
      previewOf.set(message.conversationId, message);
    }
  }

  return {
    total,
    page: current,
    rows: rows.map((row) => {
      const counterpartId = counterpartOf(row, participantId);
      const name = counterpartId ? nameOf.get(counterpartId) : undefined;
      const last = previewOf.get(row.id);
      // The same blanking every other surface does: a hidden message's words
      // must not travel just because a list asked for them.
      const visible =
        last !== undefined &&
        contentState({
          deletedAt: last.deletedAt,
          deletedBy: last.deletedBy,
        }) === "visible";

      return {
        id: row.id,
        counterpartId,
        counterpartProfileName: name?.profileName ?? null,
        counterpartAccountName: name?.accountName ?? null,
        lastMessageAt: row.lastMessageAt,
        lastMessagePreview: visible
          ? last.content.slice(0, PREVIEW_LENGTH)
          : "",
        // ⚠️ **A FULL tuple on both sides** — the newest message's
        // `(createdAt, id)` against the marker's. The room-side reads compare
        // timestamps only, because `lastActivityAt` has no id beside it and
        // `hasUnread()` therefore has to call an equal timestamp "read"; here
        // the id is available on both sides, so the tie-break is live and an
        // equal instant is decided rather than assumed.
        unread: hasUnread(
          last ? { at: last.createdAt, id: last.id } : { at: row.lastMessageAt },
          row.lastReadCreatedAt && row.lastReadId
            ? { at: row.lastReadCreatedAt, id: row.lastReadId }
            : null,
        ),
      };
    }),
  };
}

/**
 * One conversation's messages, oldest first — for a participant, or for nobody.
 *
 * `postsFor()`'s shape, with the access question answered differently: a
 * thread's door is its room's, a conversation's door is being in it. A
 * non-participant gets the same empty answer an unknown id gets, and the
 * caller turns that into the same not-found.
 */
export async function listMessages(
  participantId: string,
  conversationId: string,
  page: number | "last" = "last",
): Promise<{ rows: MessageRow[]; total: number; page: number } | null> {
  const conversation = await conversationForParticipant(
    participantId,
    conversationId,
  );
  if (!conversation) return null;

  const [{ total }] = await db
    .select({ total: count() })
    .from(communityMessages)
    .where(eq(communityMessages.conversationId, conversationId));

  const pages = lastPageOf(total, MESSAGES_PER_PAGE);
  const current =
    page === "last" ? pages : Math.min(Math.max(1, page), pages);

  const rows = await db
    .select({
      message: communityMessages,
      profileName: communityProfiles.displayName,
      accountName: users.name,
    })
    .from(communityMessages)
    .leftJoin(users, eq(users.id, communityMessages.authorId))
    .leftJoin(communityProfiles, eq(communityProfiles.memberId, users.id))
    .where(eq(communityMessages.conversationId, conversationId))
    .orderBy(asc(communityMessages.createdAt), asc(communityMessages.id))
    .limit(MESSAGES_PER_PAGE)
    .offset(pageOffset(current, MESSAGES_PER_PAGE));

  return {
    total,
    page: current,
    rows: rows.map((row) => toMessageRow(row.message, row.profileName, row.accountName)),
  };
}

/** One selected message row, blanked where it must be, named where it can be. */
function toMessageRow(
  message: typeof communityMessages.$inferSelect,
  profileName: string | null,
  accountName: string | null,
): MessageRow {
  return {
    id: message.id,
    authorId: message.authorId,
    // What a server hands a browser is what a reader may see.
    content:
      contentState(message) === "visible" ? message.content : "",
    createdAt: message.createdAt,
    deletedAt: message.deletedAt,
    deletedBy: message.deletedBy,
    removedReason: message.removedReason,
    authorProfileName: profileName,
    authorAccountName: accountName,
  };
}

/**
 * Who the other person is, for the conversation page's heading — and `null`
 * when this member is not in the conversation.
 *
 * A reader like every other one here: it takes the participant id and answers
 * only about conversations they are in.
 */
export async function conversationHeaderFor(
  participantId: string,
  conversationId: string,
): Promise<{
  id: string;
  counterpartId: string | null;
  counterpartProfileName: string | null;
  counterpartAccountName: string | null;
} | null> {
  const conversation = await conversationForParticipant(
    participantId,
    conversationId,
  );
  if (!conversation) return null;

  const counterpartId = counterpartOf(conversation, participantId);
  if (!counterpartId) {
    return {
      id: conversation.id,
      counterpartId: null,
      counterpartProfileName: null,
      counterpartAccountName: null,
    };
  }

  const [row] = await db
    .select({
      accountName: users.name,
      profileName: communityProfiles.displayName,
    })
    .from(users)
    .leftJoin(communityProfiles, eq(communityProfiles.memberId, users.id))
    .where(eq(users.id, counterpartId))
    .limit(1);

  return {
    id: conversation.id,
    counterpartId,
    counterpartProfileName: row?.profileName ?? null,
    counterpartAccountName: row?.accountName ?? null,
  };
}

/**
 * Is anything unread in this member's inbox?
 *
 * `unreadFor()`'s twin on the DM side, and it exists as its own existence
 * query for the same reason: this runs on the shell render of a
 * community-on app, so it is `LIMIT 1` and never a count.
 *
 * ⚠️ **No join watermark, and that is not an omission.** The room-side read
 * silences everything that happened before a member existed, because a new
 * member would otherwise be told three hundred threads are new. Nothing here
 * can predate them: a conversation requires them as a participant, so every
 * message in their inbox was sent to them.
 *
 * The comparison is `hasUnread()`'s, restated in SQL for the same reason the
 * room-side reads restate it — a pure function cannot be called from a
 * `WHERE`, and equality counts as READ because the marker for the newest
 * message carries that message's own instant.
 *
 * 🚨 **This one carries the `(created_at, id)` tie-break, where the three
 * room-side reads deliberately do not — and the difference is not
 * inconsistency.** A discussion row offers `last_activity_at` with no post id
 * beside it, so those reads have nothing to break a tie WITH; this query joins
 * `community_messages`, whose id is right there in the row. That asymmetry used
 * to be recorded as a decision covering all four reads
 * (`unread-parity.test.ts`), and it silently covered this one too — while the
 * justification for it was only ever true of the other three.
 *
 * ⚠️ Without the tie-break, equality could not be reached at all: the column
 * held microseconds, the marker milliseconds, and the plain `>` therefore
 * answered "unread" for ever about a marker naming that very message. `precision:
 * 3` on both columns is what makes equality the NORMAL case — and equality with
 * no tie-break would be the same defect inverted, a second message inside the
 * same millisecond that can never become unread. The two halves are one fix.
 */
export async function unreadMessagesFor(participantId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: communityMessages.id })
    .from(communityConversations)
    .innerJoin(
      communityMessages,
      eq(communityMessages.conversationId, communityConversations.id),
    )
    .leftJoin(
      communityReadMarkers,
      and(
        eq(communityReadMarkers.conversationId, communityConversations.id),
        eq(communityReadMarkers.memberId, participantId),
      ),
    )
    .where(
      and(
        or(
          eq(communityConversations.participantAId, participantId),
          eq(communityConversations.participantBId, participantId),
        ),
        // Typed columns rather than a raw row comparison, for the reason the
        // live cursor's read gives above it: `(a, b) > (c, d)` in a raw
        // expression is an untyped tuple, and this shape is the one the rest of
        // the module already uses for the same question.
        or(
          // The LEFT JOIN found no marker: nothing has been acknowledged.
          isNull(communityReadMarkers.memberId),
          gt(communityMessages.createdAt, communityReadMarkers.lastReadCreatedAt),
          and(
            eq(communityMessages.createdAt, communityReadMarkers.lastReadCreatedAt),
            gt(communityMessages.id, communityReadMarkers.lastReadId),
          ),
        ),
      ),
    )
    .limit(1);

  return Boolean(row);
}

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
async function requireModerator(
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

/**
 * The refusal every WRITE path asks, and no read path does.
 *
 * ⚠️ **Blocked means silenced, never blinded.** A blocked member keeps reading
 * everything they could read before — the rooms, their inbox, the feed. Taking
 * their reading away would punish them for what somebody else reported, before
 * anybody looked at it.
 */
async function guardSendBlock(memberId: string): Promise<void> {
  const state = await sendBlockFor(memberId);
  if (state.blocked) throw new CommunityError("communitySendBlocked");
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
