// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// How much is going on in here — the two numbers a room list and a thread list
// need, and no others.
//
// ── 🚨 This module refuses counts elsewhere. Read why these two are different ──
//
// `unreadByGroup()` one file over says a room card gets "something is new" and
// never a number, `docs/community.md` says "a badge saying *3* is the same
// broadcast as a post, one number smaller", and `schema.ts` says "no roster, no
// member count". Those three are about TWO things, and neither of them is what
// this file counts:
//
//  1. **A room the viewer may not enter.** That room contributes nothing at all
//     — no dot, no number, no timing — because "there is activity somewhere you
//     cannot see" is purchase information about the people in it. Every function
//     here takes ids the caller has ALREADY access-checked (they came out of
//     `groupsFor()` / a `discussionsFor()` the viewer just rendered), so a room
//     nobody may enter cannot reach these queries. `activity-leak.test.ts` is
//     the guard that keeps that true rather than intended.
//  2. **How many PEOPLE are in a room.** A roster, in aggregate. Nothing here
//     touches `users`, a plan or a membership — there is no membership row to
//     count, which is the point of `mayEnterGroup()` being a live question.
//
// What is left is the room's own content, to somebody already inside it: how
// many conversations there are and when the last one moved. That is not a
// broadcast — it is the table of contents of a page this person may open in
// full, one click further on. A room list that says nothing about its rooms
// makes every one of them look identical, which is what a member reported it
// as: four cards, four names, and no way to tell the busy room from the one
// that has been quiet since March.
//
// ⚠️ **The unread DOT stays what it was**: existence, never a count. "3 new"
// is pressure aimed at a member; "12 conversations, last one yesterday" is a
// description of the room. This file adds the second and does not touch the
// first.
import { count, inArray, max } from "drizzle-orm";
import { db } from "@/db";

import { communityDiscussions, communityPosts } from "../schema";

/** What a room card says about itself. */
export interface GroupActivity {
  /** Conversations in this room. */
  readonly topics: number;
  /** When the newest of them last moved. `null` when the room is empty. */
  readonly lastActivityAt: Date | null;
}

/**
 * The two numbers per room, in one statement.
 *
 * Takes group ids the caller has ALREADY access-checked, exactly as
 * `unreadByGroup()` does — the accessible set is derived once per render, in
 * `groupsFor()`, and never a second time here.
 *
 * 🚨 **`isNull(archivedAt)` is not repeated and must not be**: an archived room
 * is not in `groupsFor()`'s answer, so its id never arrives. Re-deriving that
 * rule here would be a second opinion about which rooms exist.
 *
 * A room with no conversations gets no row back and is simply absent from the
 * map — the caller reads that as `{ topics: 0 }`, which is what the card shows
 * as "still quiet in here".
 */
export async function activityByGroup(
  groupIds: readonly string[],
): Promise<Map<string, GroupActivity>> {
  if (groupIds.length === 0) return new Map();

  const rows = await db
    .select({
      groupId: communityDiscussions.groupId,
      topics: count(),
      // `max()` from drizzle rather than a `sql<Date>` template: a cast is a
      // claim the query does not keep, and `db/sql-cast.test.ts` fails the
      // build on one.
      lastActivityAt: max(communityDiscussions.lastActivityAt),
    })
    .from(communityDiscussions)
    .where(inArray(communityDiscussions.groupId, [...groupIds]))
    .groupBy(communityDiscussions.groupId);

  return new Map(
    rows
      // `groupId` is nullable — an embedded discussion has a `subjectKey`
      // instead — but `inArray` never matches a NULL, so this narrows the type
      // rather than filtering anything out.
      .filter((row): row is typeof row & { groupId: string } => row.groupId !== null)
      .map((row) => [
        row.groupId,
        { topics: Number(row.topics), lastActivityAt: row.lastActivityAt ?? null },
      ]),
  );
}

/**
 * How many posts each of these conversations holds.
 *
 * ⚠️ **Every post, deleted ones included — and that is not sloppiness, it is
 * parity.** `postsFor()` counts and renders exactly the same set: a removed
 * post keeps its place in the thread as a tombstone ("this post was removed by
 * the moderation"), so a count that skipped it would promise a shorter thread
 * than the one that opens. The line an operator's removal draws is about the
 * CONTENT, never about the fact that something was there.
 *
 * Takes discussion ids the caller has already rendered — a thread the viewer
 * may not see cannot be in that list.
 */
export async function postCountByDiscussion(
  discussionIds: readonly string[],
): Promise<Map<string, number>> {
  if (discussionIds.length === 0) return new Map();

  const rows = await db
    .select({ discussionId: communityPosts.discussionId, posts: count() })
    .from(communityPosts)
    .where(inArray(communityPosts.discussionId, [...discussionIds]))
    .groupBy(communityPosts.discussionId);

  return new Map(rows.map((row) => [row.discussionId, Number(row.posts)]));
}
