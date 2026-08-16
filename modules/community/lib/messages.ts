// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { and, asc, count, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { communityConversations, communityFollows, communityMemberBlocks, communityMessages, communityProfiles, communityReadMarkers } from "../schema";
import { forgetOne, isLimited, record } from "@/lib/rate-limit";
import { communityConfig } from "./config";
import { COMMUNITY_DM_RATE_BUCKET, CommunityError, canBlockMember, canDeliverTo, canSendMessage, canonicalPair, counterpartOf, checkMessageContent, contentState, hasUnread, messageLimit } from "./rules";

import { guardSendBlock } from "./_blocks";
import { pageOffset } from "./_paging";
import { participationProfile } from "./profiles";
import { lastPageOf } from "./talk";

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
export async function conversationForParticipant(
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
          // A private message carries no automatic lock, and it is not an
          // omission. The lock exists to take spam off a page other people are
          // reading; a message has exactly one reader, and it is the person who
          // reported it. Hiding it after the fact protects nobody and would cost
          // a column on `community_messages` that only ever holds NULL.
          hiddenAt: null,
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
export function toMessageRow(
  message: typeof communityMessages.$inferSelect,
  profileName: string | null,
  accountName: string | null,
): MessageRow {
  return {
    id: message.id,
    authorId: message.authorId,
    // What a server hands a browser is what a reader may see.
    // `hiddenAt: null` — see the note in `conversationsFor()`: a direct message
    // has no automatic lock, by decision rather than by oversight.
    content:
      contentState({ ...message, hiddenAt: null }) === "visible"
        ? message.content
        : "",
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
