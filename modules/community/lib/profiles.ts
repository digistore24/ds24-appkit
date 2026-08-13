// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { media, users } from "@/db/schema";
import { communityProfiles } from "../schema";
import { hasPlan } from "@/lib/entitlements/manage";
import { acceptUpload, findMedia, mayAccess, type Viewer } from "@/lib/media/manage";
import { mediaUrlFor } from "@/lib/media/url";
import { CommunityError, checkCommunityAbout, checkCommunityDisplayName } from "./rules";

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

/**
 * The member's own profile, for the participation check.
 *
 * Its own tiny function because every write path needs it and none of them
 * should reach for `profileFor()` and then decide what to do with a whole row.
 */
export async function participationProfile(
  memberId: string,
): Promise<{ displayName: string | null } | null> {
  const [row] = await db
    .select({ displayName: communityProfiles.displayName })
    .from(communityProfiles)
    .where(eq(communityProfiles.memberId, memberId))
    .limit(1);
  return row ?? null;
}
