// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { cache } from "react";
import { and, count, eq, gt, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { communityDiscussions, communityMessages, communityPosts, communityReadMarkers } from "../schema";
import { hasPlan } from "@/lib/entitlements/manage";

import { accessibleGroupIds } from "./_access";

import { conversationForParticipant } from "./messages";
import { discussionForViewer } from "./talk";

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
