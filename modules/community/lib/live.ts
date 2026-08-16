// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { and, asc, desc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { communityDiscussions, communityMessages, communityModerationAudit, communityPosts, communitySpamReports, communityProfiles } from "../schema";
import { record } from "@/lib/rate-limit";
import { advanceCursor, liveCursorToken, parseLiveCursorToken, type LiveCursor, contentState, changedAt, postVisibleTo } from "./rules";

import { CHANGED_AT, changedAtParam } from "./_change-stamp";
import { embedAccessFor, embeddedDiscussionFor } from "./embedded";
import { feedSince } from "./feed";
import { conversationForParticipant, toMessageRow } from "./messages";
import { POSTS_PER_PAGE, PostRow, discussionForViewer, postImagesFor } from "./talk";

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
 * The JS twin of {@link CHANGED_AT} — now in the pure core, and re-exported
 * here so no call site moved.
 *
 * 🚨 It was the ONE thing making this file's two halves circular. `Live` calls
 * `feedSince()` in the friends-feed section and the friends feed calls this
 * back — measured as the only mutual dependency among the file's ten sections.
 * It is also the one that never belonged on this side: `rules.ts`'s charter is
 * "functions in here take values and answer values", and this reads no clock,
 * no config and no row.
 */
export { changedAt } from "./rules";

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
        // A feed answer only ever carries VISIBLE posts — `feedVisible()` drops
        // the rest before this map runs — so the lock is null by construction
        // rather than by omission.
        hiddenAt: null,
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
  // 🚨 `postVisibleTo()`, not `contentState()`: a locked post is shown to its
  // own author and to nobody else, so whose request this is decides whether its
  // pictures are minted at all.
  const showsWords = (row: {
    post: {
      authorId: string | null;
      deletedAt: Date | null;
      deletedBy: "author" | "moderator" | "system" | null;
      hiddenAt: Date | null;
    };
  }) =>
    postVisibleTo(contentState(row.post), row.post.authorId, viewer.memberId) ===
    "words";
  const images = await postImagesFor(
    [...byId.values()].filter(showsWords).map((row) => row.post.id),
    viewer,
  );

  const posts: PostRow[] = [...byId.values()].map((row) => ({
    ...row.post,
    // The same blanking `postsFor()` does, for the same reason: what a server
    // hands a browser is what a reader may see, and a hidden post's words must
    // not travel just because a different surface asked for them.
    // 🚨 **A locked post still TRAVELS to everybody, with its words removed.**
    // Omitting the row instead would be exactly what AD-70 forbids — "deletions
    // ride the same answer as row-state, never by omission" — and the failure
    // is concrete: an open tab already showing the post would never learn to
    // take it down, which is the one moment this feature is for. So the state
    // arrives and the RENDERER drops it; the words never leave the server.
    content: showsWords(row) ? row.post.content : "",
    // Blanked here as well as excluded from the statement — see `postsFor()` for
    // why both. It matters more on this path: half (b) exists to deliver
    // tombstones, so this is the line that keeps a removal from arriving at an
    // open tab with a live `srcset` still on it.
    images: showsWords(row) ? (images.get(row.post.id) ?? []) : [],
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
    // And no automatic lock either, for the reason `messages.ts` gives: a
    // message has one reader and hiding it after delivery protects nobody.
    hiddenAt: null,
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
