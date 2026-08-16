// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The community's own tables — the place members meet each other.
//
// ⚠️ **This file speaks for the DOMAIN, not for one table.** It grows one
// table per story — profiles here, groups and their duties next, discussions
// and posts after that, the two direct-message tables, unread markers last —
// so the doctrines below are
// written once and every table added underneath answers them explicitly rather
// than restating them.
//
// ── Why a table and not columns on `users` ────────────────────────────────
// A profile is what the COMMUNITY shows of a person; `users` is the account
// that pays and signs in. Keeping them apart is what lets an app run with the
// community switched off and carry no trace of it (AD-69) — no columns nobody
// fills, no export section that is structurally present and semantically
// meaningless, and nothing to migrate away if an operator never switches it
// on. It also keeps the blast radius of a community feature inside the
// community: no story in this epic touches the table that authenticates.
//
// ── Which way deletion goes, and why it differs per table ─────────────────
// The rule this domain inherits is `schema-chat.ts`'s, and it is worth
// restating in the form that decides each new table: **money records outlive
// the account, a person's own words and self-description do not.** `orders`,
// `subscriptions` and `token_accounts` keep their rows when a customer is
// deleted, because the fact that money moved is a record with a retention
// obligation behind it. A profile is the opposite kind of thing — it is the
// member's own chosen name and their sentence about themselves, personal data
// with nothing behind it that outlives them. So it cascades, and it is in
// `docs/data-protection.md` and in both exports for the same reason
// (AD-65: the privacy plumbing rides the change that creates the table, never
// a later cleanup pass).
//
// A table added here that holds TWO subjects' data — a duty naming both the
// member and the operator who granted it, a post inside a group — answers the
// slicing question in its own comment rather than inheriting an answer. That
// case first bites with groups; it does not bite here, because a profile has
// exactly one subject.
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { users } from "@/db/schema-core";
import { media } from "@/db/schema-media";

/**
 * One member's public face inside the community.
 *
 * **1:1 with `users`, and the primary key IS the foreign key** — one row per
 * member, no id of its own, no unique index to keep honest, and no way for a
 * second profile to exist for one person. The row is created the first time a
 * member chooses a name and never before: an account that has never opened the
 * community has no row here at all, which is what makes "has this person set
 * themselves up?" a row-existence question rather than a column inspection.
 */
export const communityProfiles = pgTable("community_profiles", {
  // Both the primary key and the cascade FK. Deleting the account takes the
  // profile with it — see the deletion doctrine at the top of this file.
  memberId: text("member_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),

  // The name other members see. NOT NULL, and that is load-bearing rather than
  // tidiness: it makes the row's EXISTENCE the answer to "did this member
  // choose a name", so `canParticipate()` in lib/community/rules.ts is a
  // null-check on the row and cannot drift out of step with a column. A
  // nullable column with a row written on first touch was the alternative and
  // is defensible; it leaves more states, and every one of them would need the
  // refusal to ask a second question.
  //
  // ── OQ-2, decided here (2026-08-05) ─────────────────────────────────────
  // **No uniqueness, and no separate handle.** There is deliberately no unique
  // index on this column and no second identifier beside it:
  //
  //   - Two members may legitimately share a name; real people do. A unique
  //     index turns that into an error message a member cannot act on, at the
  //     moment they are trying to introduce themselves.
  //   - A handle (`@name`) would be a second, scarcer namespace to explain,
  //     defend and migrate — for a community whose rooms are small and whose
  //     members already have one identity per app.
  //   - Renaming is therefore the same edit as first naming, with no cooldown
  //     and no operator force-rename in v1.
  //
  // What this leaves open is impersonation-by-name, and the answer is the
  // report path (Epic 23) rather than a constraint: a name collision is a
  // moderation question, not a database one, and a unique index would refuse
  // the honest case in order to inconvenience the dishonest one.
  displayName: text("display_name").notNull(),

  // The member's own sentence about themselves. NULL means they have not
  // written one — the `NULL` means "not" idiom this schema uses throughout.
  about: text("about"),

  // Their picture. The COLUMN ships with this table so that the avatar story
  // is a pure pipeline change rather than a second migration against a table
  // that already holds rows.
  //
  // `set null` and not `cascade`: deleting the picture must leave the person.
  // A cascade here would mean an operator pruning a media row silently deletes
  // profiles — the reference goes, the member stays, and the page falls back to
  // the placeholder avatar it already renders.
  avatarMediaId: text("avatar_media_id").references(() => media.id, {
    onDelete: "set null",
  }),

  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

/**
 * How a room decides who is in it. Exactly one level per group, never a set.
 *
 *   open       — every active member of this app.
 *   plan       — anybody holding ANY of the group's product keys. "Any", not
 *                "all": a member mid-upgrade briefly holds two keys (or none),
 *                and an all-of rule would lock them out of a room they paid for.
 *   moderators — the moderators and the operator.
 *   operator   — the operator alone.
 *
 * The level is the WHOLE answer. There is no per-group allow-list beside it,
 * because a second mechanism would be a second place a refund has to reach.
 */
export const communityGroupAccessEnum = pgEnum("community_group_access", [
  "open",
  "plan",
  "moderators",
  "operator",
]);

/**
 * A room — the operator's structure for who meets whom.
 *
 * ── There is no membership table, and that is the design ──────────────────
 * No `community_group_members`, no join/leave, no roster, no member count, no
 * avatar pile on the card. Access is DERIVED at the moment of the read —
 * `mayEnterGroup()` in `lib/community/rules.ts` compares this row's level
 * against the viewer's role and the keys `hasPlan()` answers for right now —
 * so a refund, a chargeback, a missed payment or an expiry changes what a
 * member can open with **nothing to reconcile**: no cleanup job, no stale
 * boolean, no row that outlives the entitlement it was copied from.
 *
 * The second reason is privacy rather than plumbing, and it is the one that
 * makes a roster refusable even when somebody offers to keep it fresh:
 * **presence in a plan-gated group IS purchase information.** A list saying
 * who is in "Diabetes-Coaching Premium" is a list of who bought it, and the
 * flagship example of this template is health-adjacent. A member becomes
 * visible in a room by POSTING in it, which is a thing they chose to do.
 *
 * ── Rows do not travel with a deploy ──────────────────────────────────────
 * Groups are operational structure, per environment. `git push` moves code,
 * not rows — a group created on a laptop does not exist in PROD until somebody
 * creates it there, and the admin page says so in its empty state rather than
 * leaving a live app looking broken. This is the template's documented
 * content-in-PROD trap (`docs/content.md`); it applies here in full.
 *
 * ── Privacy: this table is in NEITHER export, deliberately ────────────────
 * A group is operator-authored structure — a name, a description, an access
 * level. It has no data subject: nothing in a row is about any member, and the
 * absence of a membership column is what keeps that true. So it appears in
 * neither the member's own download nor the operator's subject-access report,
 * and the deliberate absence is written here rather than left to be noticed.
 * (The duty table below is the opposite case and says so.)
 *
 * ── Archive, never delete ─────────────────────────────────────────────────
 * `archivedAt` set means the room disappears from every member surface and
 * keeps every row behind it. There is no delete, in v1: deleting a group would
 * cascade into its discussions and the members' own words, and a moderation
 * question ("what was said here?") must still have an answer afterwards.
 * `NULL` means "not archived" — the `users.blockedAt` idiom this schema uses
 * throughout.
 */
export const communityGroups = pgTable("community_groups", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),

  // What the room is called, and one or two sentences saying what belongs in
  // it. Operator copy, not member text — it is not translated (the same ruling
  // `config/digistore-products.json` gets: the operator writes it once, in
  // their own words) and it is not a stored-XSS surface for the same reason.
  name: text("name").notNull(),
  description: text("description"),

  // Where the room sits in the list. A plain integer the operator moves with
  // up/down buttons — no fractional indexing, no drag-and-drop dependency.
  // Ties break by `createdAt` in the read, so two rooms that share a position
  // still have a stable order.
  position: integer("position").notNull().default(0),

  accessLevel: communityGroupAccessEnum("access_level").notNull(),

  // The product keys a `plan` room accepts — meaningful for that level only,
  // and empty for every other. **Validated at WRITE time**, against the product
  // registry, by `groupPlanProblems()` in `lib/community/rules.ts`: `hasPlan()`
  // THROWS on a key it does not know, so an unchecked entry here would not mean
  // "no access", it would take down the page that lists the room. The precedent
  // is `lib/media/config.ts`'s `planProblem()`, and the read path mirrors
  // `mayAccess()`'s retired-key guard — write-time validation cannot cover a
  // registry edit made afterwards.
  planKeys: text("plan_keys").array().notNull().default([]),

  // NULL means "not archived". See the header.
  archivedAt: timestamp("archived_at", { mode: "date" }),

  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

/**
 * The Group-Moderator Duty — which moderator looks after which room.
 *
 * ── Two subjects, and the slicing question answered ───────────────────────
 * The file header says a table holding two subjects' data answers the slicing
 * question in its own comment rather than inheriting one. This is that table,
 * and the answer is: **the row is the MODERATOR's personal data.** It says
 * this named person has a duty in this app — a fact about them, in their own
 * subject-access export and in the operator's, and gone with their account
 * (cascade). The group is the other end of the row and is not a person; it
 * contributes structure, not a subject.
 *
 * ── The primary key IS the uniqueness ─────────────────────────────────────
 * `(groupId, memberId)` is the whole row's identity, so there is no `id`
 * column and no separate unique index to keep honest — the same idiom
 * `community_profiles` uses one table up. Assigning twice is the same row.
 *
 * ── It grants nothing yet, and that is deliberate ─────────────────────────
 * Nothing reads this table for authorization at this point in the epic. The
 * moderation surfaces re-read the member's ROLE **and** their duty from the
 * database at the moment of the act — this is the seam they will read, and
 * they are the story that writes `hasDuty()`. What exists now is the
 * assignment and the list: the operator says who looks after a room, and the
 * refusal on assignment (`communityNotModerator` — the target must hold the moderator
 * role) is write-validation, not an authorization system.
 *
 * **The operator needs no row here.** They moderate everywhere by role, and no
 * code path ever writes an operator duty — so an empty duty list means "the
 * operator looks after it", never "nobody does".
 */
export const communityGroupModerators = pgTable(
  "community_group_moderators",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => communityGroups.id, { onDelete: "cascade" }),
    // Cascade: the duty is a fact about this person, and it goes with them.
    memberId: text("member_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.memberId] }),
    // The export and the cascade both walk every duty of ONE member, across
    // groups — the primary key's leading column is the group, so that read
    // needs an index of its own.
    index("community_group_moderators_member").on(t.memberId),
  ],
);

/**
 * Who made a piece of content go away.
 *
 * ⚠️ **Three values, and they are three different sentences on screen.** "The
 * author deleted this", "a moderator removed this" and "the account was
 * deleted" are not the same thing to whoever is reading the thread, and
 * collapsing them into a boolean is how a moderator's decision ends up looking
 * like a member's change of mind. `contentState()` in `lib/community/rules.ts`
 * is the ONLY reader of this column and of `deletedAt` — no renderer
 * interprets them itself, so the three states cannot drift apart per surface.
 *
 * `moderator` has no writer yet; the state exists from the first table so that
 * the moderation release adds an ACT rather than a migration under live data.
 */
export const communityDeletedByEnum = pgEnum("community_deleted_by", [
  "author",
  "moderator",
  "system",
]);

/**
 * A thread — a title and the posts under it.
 *
 * ── TWO kinds of thread, and the constraints are what keep them apart ──────
 * A discussion hangs off **either** a room (`group_id`, a title the starter
 * wrote) **or** a page of this app (`subject_key`, no title of its own — the
 * heading is the host page's context). Never both, never neither: the check
 * constraints below say so rather than a convention, because a row with
 * neither coordinate is reachable from no surface at all and a row with both
 * would have two access levels deciding it.
 *
 * `title IS NULL` **means** embedded, and that is load-bearing in both
 * directions: `checkDiscussionTitle()` refuses a blank title, so a NULL can
 * only ever have come from the embedded leg, and an embedded row must never be
 * given one — a Subject Key rendered as a heading is course structure
 * disclosed to whoever was reading the page.
 *
 * ⚠️ **An embedded row's `createdBy` is NULL, always.** Nobody starts an
 * embedded discussion; the row materializes under the first post
 * (`ensureEmbeddedDiscussion()`, the module's one lazy creator). Writing an
 * author there would also break the account-deletion path:
 * `scrubPostsOfDepartingMember()` blanks the titles of every thread that
 * member started, and `title = ''` on a row carrying a Subject Key violates
 * the check constraint below — an erasure request would fail on a row that has
 * no personal data in it.
 *
 * ── The unique partial index is what makes lazy creation race-safe ─────────
 * One key, at most one row — enforced by the database rather than by hope, so
 * two members whose first posts land in the same millisecond both end up in
 * the same discussion instead of one of them getting a duplicate.
 *
 * ── `lastActivityAt` is the module's ONE materialization ───────────────────
 * Everything else in this module is derived at read time; this column is the
 * deliberate exception, because "which rooms moved" cannot be answered by
 * scanning posts on every shell render. It is therefore held to a rule that is
 * worth quoting rather than paraphrasing: **it is written solely inside the
 * transaction that writes a post.** Not by an edit — an edit is not new
 * activity. Not by a deletion — a deletion bumping a thread would resurrect it
 * at the top of a list. A second writer appearing anywhere is the thing to
 * refuse in review.
 *
 * ── Privacy ───────────────────────────────────────────────────────────────
 * The title is a member's own words, so it is personal data and cascades with
 * `createdBy` set to NULL — see `community_posts` below, which carries the
 * argument for both: the row outlives the account, its words do not.
 */
export const communityDiscussions = pgTable(
  "community_discussions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // NULL for an embedded discussion — see the header. A room's thread
    // cascades with the room; the room itself is archived rather than deleted,
    // so this cascade is the "somebody ran a DELETE by hand" path.
    groupId: text("group_id").references(() => communityGroups.id, {
      onDelete: "cascade",
    }),

    // The app's own opaque slug for the page this discussion hangs on — NULL
    // for a room's thread. **Never a foreign key**, the exact convention
    // `db/schema-chat.ts` documents for `conversationId`: a real one would
    // demand a taxonomy for subjects this module cannot know about. What the
    // key may be is decided in ONE place, `lib/community/embeds.ts`; a key that
    // is not declared there creates nothing.
    subjectKey: text("subject_key"),

    // What the thread is called. Member-authored text — rendered as text and
    // never as markup, like every post (see `postSegments()`). NULL means the
    // discussion is embedded and takes its heading from the host page.
    title: text("title"),

    // SET NULL, not cascade: the thread survives its starter leaving, because
    // everybody else's replies are still in it. See `community_posts`. Always
    // NULL on an embedded row — the header says why that is a rule and not an
    // accident.
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),

    // NULL means "not locked" — the house idiom. Nothing writes it yet; the
    // moderation release does, and the core already refuses a write into a
    // locked thread so that the act is all that is missing.
    lockedAt: timestamp("locked_at", { mode: "date" }),

    // See the header. Written by `startDiscussion` and `addPost`, inside their
    // transactions, and by nothing else — ever.
    //
    // `precision: 3`: this is the left-hand side of all three unread reads
    // (`unreadFor`, `unreadByDiscussion`, `unreadByGroup`), compared against a
    // read marker that can only ever hold milliseconds. Same rule as
    // `community_messages.createdAt` — the reasoning is there.
    lastActivityAt: timestamp("last_activity_at", { mode: "date", precision: 3 })
      .notNull()
      .defaultNow(),

    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    // The one read a group page does: this room's threads, most recently
    // active first. Filter and order in one index.
    index("community_discussions_group_activity").on(t.groupId, t.lastActivityAt),

    // A room's thread or an embedded one, never both and never neither. `<>`
    // is XOR over booleans in Postgres — the same idiom
    // `community_read_markers_one_target` two tables down uses.
    check(
      "community_discussions_one_home",
      sql`(${t.groupId} is null) <> (${t.subjectKey} is null)`,
    ),

    // `title IS NULL` ⇔ `subject_key IS NOT NULL`. Both halves matter: an
    // embedded row must not carry a title (the heading is the host page's),
    // and a room's thread must not be without one (`checkDiscussionTitle()`
    // refuses a blank, and a NULL would render as nothing at the top of a
    // list).
    check(
      "community_discussions_title_shape",
      sql`(${t.title} is null) = (${t.subjectKey} is not null)`,
    ),

    // One Subject Key, at most one row. **This index is what makes
    // `ensureEmbeddedDiscussion()`'s insert-on-conflict race-safe** — two
    // first-posters both try, one inserts, both get the row. Partial, because
    // every room's thread has a NULL here and NULLs do not collide.
    uniqueIndex("community_discussions_subject")
      .on(t.subjectKey)
      .where(sql`${t.subjectKey} is not null`),
  ],
);

/**
 * One post. **The template's first stored surface for text somebody else
 * wrote, and the module's risk lives here.**
 *
 * Rendering: `content` is rendered by exactly one component
 * (`components/community/post-body.tsx`) through the pure `postSegments()`,
 * as React text nodes plus links whose scheme has been whitelisted. No HTML
 * parsing, no markdown, and `dangerouslySetInnerHTML` is kept out of the whole
 * community tree by a test that reads the files. React escaping alone is not
 * the answer being relied on — the next developer adding "just bold" is.
 *
 * ── SET NULL, where `chat_messages` cascades — and why the difference ──────
 * A chat transcript dies with its account because nothing points at it: it is
 * one person talking to a machine. A post is one turn in a conversation other
 * people are still having, and its ROW is what holds the thread together —
 * remove it and the replies to it become answers to nothing. So the row
 * outlives the account and the author link goes NULL.
 *
 * **That is not a licence to keep the words.** Account deletion scrubs
 * `content` to empty, sets `deletedAt` and `deletedBy = "system"` in the same
 * transaction as the account, and what is left is a tombstone: thread
 * structure with no personal data in it. The distinction this table draws is
 * between a RECORD (kept, per `orders`) and STRUCTURE (kept, with the data
 * taken out) — a post is the second.
 *
 * ── Why an AUTHOR's own deletion does NOT scrub the words ─────────────────
 * `deleteOwnPost` sets the state and leaves `content` alone. That looks like a
 * half-measure and is the opposite: a report about a post has to be able to
 * show a moderator what was reported, and "delete it quickly" is the obvious
 * way to dodge a report. So an author-deleted post is hidden from every
 * surface immediately by `contentState()` and its words survive in the row
 * until either the report is dealt with or the account is deleted. The
 * consequence is stated rather than left to be discovered: those words are
 * still in the author's own subject-access export, which is correct — they are
 * still the author's words. Scrubbing here would make the moderation release's
 * defence unbuildable, so if a future change wants it, that is the argument to
 * answer.
 */
export const communityPosts = pgTable(
  "community_posts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    discussionId: text("discussion_id")
      .notNull()
      .references(() => communityDiscussions.id, { onDelete: "cascade" }),

    // SET NULL. See the header — the tombstone has to outlive the account.
    authorId: text("author_id").references(() => users.id, {
      onDelete: "set null",
    }),

    // Member-authored text. NOT NULL, and scrubbed to the empty string rather
    // than nulled when an account goes: "there was a post here" and "there was
    // never a post here" are different facts about a thread.
    content: text("content").notNull(),

    // `precision: 3` for the reason spelled out at `community_messages
    // .createdAt`: all three of these are compared against a millisecond
    // cursor. Today every writer here passes a JS `Date` explicitly, so the
    // values are already milliseconds — the precision is what makes that a
    // property of the COLUMN rather than of somebody remembering.
    createdAt: timestamp("created_at", { mode: "date", precision: 3 })
      .notNull()
      .defaultNow(),
    // NULL means "never edited". Shown beside the post, because a reply that
    // answers a sentence which has since changed reads as a non-sequitur.
    editedAt: timestamp("edited_at", { mode: "date", precision: 3 }),

    // ── The deletion triple. Read ONLY through `contentState()` ────────────
    // At most one deletion event per row: a later attempt is refused rather
    // than allowed to overwrite the first. That matters in one direction in
    // particular — an author must not be able to relabel a moderator's removal
    // as their own tidying-up.
    deletedAt: timestamp("deleted_at", { mode: "date", precision: 3 }),
    deletedBy: communityDeletedByEnum("deleted_by"),
    // The moderator's reason, and theirs alone: an author deleting their own
    // post is never asked for one, and the system never writes one.
    removedReason: text("removed_reason"),

    // ── The automatic lock. A SECOND axis, deliberately not the triple ─────
    //
    // 🚨 **Why this is not `deletedBy: "system"`.** Four independent reasons,
    // any one of which is enough:
    //
    //   1. It would say something false. `contentState()` maps `"system"` to
    //      `accountDeleted`, and the renderer then tells every reader the post
    //      is from a deleted account and replaces the author's name. This post
    //      is from a living member who is about to be judged.
    //   2. It would spend the one deletion slot. AD-72 allows a single
    //      deletion event per row, so `removalProblem()` would answer
    //      `communityAlreadyDeleted` and a moderator could no longer remove
    //      the post PROPERLY — with a reason, with a trail row. The suspicion
    //      would have crowded out the verdict.
    //   3. It could not be taken back. Undoing would mean writing `deletedAt`
    //      to NULL, which nothing in this module does and two guards forbid.
    //   4. It would confuse the deferred scrub, which branches on
    //      `deletedBy !== "author"`.
    //
    // The distinction underneath all four: **the triple records an EVENT** —
    // stamped once, hence at most one — **and this records a STATE**, and
    // states are allowed to flip. Its history is not in this row but in the
    // append-only trail, exactly as `docs/community.md` puts it: "Audit
    // records EVENTS; derivation records STATE."
    //
    // ⚠️ **A stamp, not a standing derivation.** The threshold was crossed;
    // that happened, and it does not un-happen because a reporter's
    // subscription lapsed and the live weight sank. It is cleared by an ACT —
    // consuming the reports, or lifting the block — never by arithmetic. The
    // failure direction is a suspected post staying hidden until somebody
    // looks, which is the safe one.
    //
    // No `hiddenBy`: there is exactly one writer and it is nobody, the same
    // reason `sendBlockFallen` writes `actorId: null`. No `hiddenReason`: the
    // reason is the report. No counter: the queue counts, live.
    //
    // `precision: 3` like every other stamp on this table — it is compared
    // against a millisecond cursor in `CHANGED_AT`, and a post that goes
    // hidden has to reach an open tab.
    hiddenAt: timestamp("hidden_at", { mode: "date", precision: 3 }),
  },
  (t) => [
    // The paginated read of a thread: this discussion's posts, oldest first,
    // id as the tie-break so two posts in one millisecond still have an order.
    index("community_posts_discussion").on(t.discussionId, t.createdAt, t.id),
    // The export and the account-deletion scrub both walk every post of ONE
    // member across every thread.
    //
    // ⚠️ **Three columns, not one, and the two extra are the friends feed.**
    // The feed asks "the recent posts of these authors, newest first" and then
    // pages through them by the module's `(createdAt, id)` cursor — so filter
    // AND order have to be one index, or a member following thirty people
    // makes the app sort every post those thirty ever wrote on every scroll.
    // The export and the scrub still ride the leading column exactly as
    // before. NFR-41's "indexed for their access pattern at design time",
    // stated here so the next reader knows which query the tail serves.
    index("community_posts_author").on(t.authorId, t.createdAt, t.id),
  ],
);

/**
 * The pictures a member attached to a post.
 *
 * ── Why a table and not a column ──────────────────────────────────────────
 * A post carries between zero and `posting.imagesMax` pictures, in an order the
 * member chose. An array column on `community_posts` would express that too —
 * and would make the ONE query this feature actually needs impossible: the
 * batch door (`postImagesFor()`) resolves the pictures of a whole page of posts
 * in one statement by joining this table to `media`, exactly as
 * `avatarUrlsFor()` resolves a list of faces. An `integer[]` of ids cannot be
 * joined, so forty posts would be forty `findMedia()` calls — the invariant
 * `CLAUDE.md` states as "forty posts must not be forty queries", broken by the
 * cheaper-looking column.
 *
 * ── The two foreign keys go in opposite directions, deliberately ───────────
 * `post_id` **cascades**: an attachment with no post is a row nothing can ever
 * reach, and unlike a post itself there is no tombstone to keep — a deleted
 * post keeps its own row (see `communityPosts`' header), so nothing here is
 * lost by cascading when the post row itself is genuinely gone.
 *
 * `media_id` is **SET NULL**, the shape `community_profiles.avatarMediaId`
 * already uses and for the same reason turned around: deleting a picture must
 * not delete the post it was attached to. What is left is a row saying "there
 * was a picture in this position" with nothing to render, which is the honest
 * state — and it is the state a member's own account deletion produces, because
 * the sweep that erases their pictures (`deleteOwnedMedia()`) works on `media`
 * and reaches this table only through this key.
 *
 * ── Two subjects? No — one, and it is the post's author ───────────────────
 * The slicing question this file's header demands of every new table: a row
 * here names a post and a picture, both of which belong to the same person.
 * There is no second subject to withhold anything from. It is in the module's
 * Art. 15 answer as `communityPostImages` (the LINK — which picture sat on
 * which post); the picture's own facts are in the CORE export's `media`
 * section, because that is whose table it is.
 *
 * ── The position, and why it is part of the key ────────────────────────────
 * `(post_id, position)` is the primary key, so a post cannot have two pictures
 * in the same place and the read order is the key's own order — no `id` column
 * to generate and no second index to keep. Positions are dense and start at
 * zero because the writer assigns them from the order the form delivered.
 */
export const communityPostMedia = pgTable(
  "community_post_media",
  {
    postId: text("post_id")
      .notNull()
      .references(() => communityPosts.id, { onDelete: "cascade" }),

    // SET NULL — see the header. Nullable because that is what the FK does when
    // the picture goes, not because a row is ever WRITTEN without one.
    mediaId: text("media_id").references(() => media.id, {
      onDelete: "set null",
    }),

    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.position] }),
    // ⚠️ **The reverse direction needs its own index, and Postgres does not
    // create one.** `ON DELETE SET NULL` makes every `delete from media` scan
    // this table for referencing rows — and account deletion deletes a member's
    // pictures one row at a time (`deleteOwnedMedia()`), so without this the
    // sweep is one sequential scan of every attachment in the app per picture.
    // The primary key leads with `post_id` and cannot serve it.
    index("community_post_media_media").on(t.mediaId),
  ],
);

/**
 * A private conversation between exactly two members.
 *
 * ── Two columns, not a join table (AD-73) ─────────────────────────────────
 * The participants are two explicit columns, ordered so that
 * `participant_a_id < participant_b_id` (a CHECK says so, `canonicalPair()` in
 * `lib/community/rules.ts` is the one place that arithmetic lives), with a
 * unique index over the pair. A join table would have expressed "a
 * conversation has participants" — which is a group conversation, and v1 does
 * not have one. Two columns express "a conversation IS a pair", so starting a
 * conversation twice is an insert-on-conflict that lands in the same row
 * rather than a second row nobody can tell from the first, and every read
 * scopes by `participant_a_id = me or participant_b_id = me` on an index
 * instead of joining through a table.
 *
 * ── SET NULL on both participants, and why it cannot collide ──────────────
 * The surviving participant keeps their own side of the conversation
 * (FR-203), so the row has to outlive a departed account. A NULLed column
 * cannot collide with the unique index in practice — Postgres treats NULLs as
 * distinct — and the CHECK is NULL-tolerant too, because a comparison with
 * NULL is NULL rather than FALSE. Nor can a new conversation ever name a
 * deleted account: every write path checks the counterpart is a live,
 * unblocked member first. The doctrine behind the choice is
 * `db/schema-chat.ts`'s and `community_posts`' — the row is structure and
 * survives, the words are personal data and are scrubbed (Story 21.4).
 *
 * ── There is NO `lastMessageAt`, deliberately ─────────────────────────────
 * `community_discussions.lastActivityAt` is the module's ONE permitted
 * materialization (AD-62). A recency column here would be a second, with a
 * second set of writers to keep honest. The inbox orders by a bounded,
 * indexed aggregate over `community_messages` instead, which is what the
 * `(conversation_id, created_at, id)` index below is for; NFR-41's "indexed
 * at design time" is satisfied by that index rather than by a cached column.
 * Whoever finds it slow later changes the architecture consciously.
 *
 * ── Privacy ───────────────────────────────────────────────────────────────
 * Both participants are data subjects and both are already readers of every
 * row — so the conversation is in BOTH exports, from each side, and there is
 * nothing to slice (NFR-35 bites where one subject must not see the other's
 * half; here neither learns anything the read surface has not already shown
 * them). There is no operator view and no admin surface: `lib/community/
 * dm-guard.test.ts` fails the build if a file outside a short allowlist so
 * much as names this table.
 */
export const communityConversations = pgTable(
  "community_conversations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // Canonicalized: a < b, always. See the header — and note that the ONE
    // function that decides which of two ids is `a` lives in `rules.ts`, so a
    // caller cannot get the order right in one place and wrong in another.
    participantAId: text("participant_a_id").references(() => users.id, {
      onDelete: "set null",
    }),
    participantBId: text("participant_b_id").references(() => users.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    // One conversation per unordered pair. This index is what makes
    // `openConversation()`'s insert-on-conflict race-safe: two members
    // pressing "write" at the same moment both end up in the same row.
    uniqueIndex("community_conversations_pair").on(
      t.participantAId,
      t.participantBId,
    ),
    // The canonical order, enforced rather than assumed — without it the pair
    // (x, y) and the pair (y, x) are two rows and the unique index says
    // nothing. NULL-tolerant, which is what lets an account deletion NULL a
    // column without violating it.
    check(
      "community_conversations_canonical",
      sql`${t.participantAId} < ${t.participantBId}`,
    ),
    // The inbox read: every conversation of ONE member. Two indexes because
    // the member can be on either side, and a composite over both columns
    // would only serve the left one.
    index("community_conversations_a").on(t.participantAId),
    index("community_conversations_b").on(t.participantBId),
  ],
);

/**
 * One direct message.
 *
 * The `community_posts` doctrine, one room narrower: the ROW is structure that
 * holds the conversation together and survives its author's account, the WORDS
 * are personal data and are scrubbed when that account goes (Story 21.4). So
 * `author_id` is SET NULL and `content` becomes the empty string, exactly as
 * `scrubPostsOfDepartingMember()` does one table up, and the surviving
 * participant keeps everything they themselves wrote.
 *
 * ⚠️ **The deletion triple ships from birth, with no writer.** `deletedAt`,
 * `deletedBy` and `removedReason` are AD-72's one state model, and they are
 * here on the day the table is created so that the account-deletion scrub
 * (Story 21.4) and the moderation release (Epic 23) add an ACT rather than a
 * migration under live data — the same reason `community_posts` shipped them
 * before anything wrote one. Read them ONLY through `contentState()`.
 *
 * There is no `editedAt`: a direct message cannot be edited in v1. What was
 * sent to somebody was sent, and an edit that silently rewrites what the other
 * person already read is a different feature with a different argument behind
 * it.
 */
export const communityMessages = pgTable(
  "community_messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // Cascade: a message cannot outlive its conversation. Conversations
    // themselves are never deleted in v1 — they outlive both accounts as
    // tombstones.
    conversationId: text("conversation_id")
      .notNull()
      .references(() => communityConversations.id, { onDelete: "cascade" }),

    // SET NULL. The tombstone outlives the account — see the header.
    authorId: text("author_id").references(() => users.id, {
      onDelete: "set null",
    }),

    // Scrubbed to the empty string rather than nulled, for the reason
    // `community_posts.content` carries: "there was a message here" and "there
    // was never a message here" are different facts about a conversation.
    content: text("content").notNull(),

    // 🚨 `precision: 3` — MILLISECONDS, and it is load-bearing. See
    // `unread-parity.test.ts` → *the resolution rule*.
    //
    // This column is compared against values that have been through a JS
    // `Date`, which holds milliseconds and nothing finer: the read marker
    // (`community_read_markers.last_read_created_at`) and the live cursor's
    // token, which travels as `String(at.getTime())`. Postgres' default is
    // MICROseconds, and `defaultNow()` really fills them — `sendMessage()`
    // passes no `createdAt`, so the database stamped the row.
    //
    // The consequence measured before this precision existed: drizzle read
    // `16:53:16.107735` into a `Date` as `.107`, `acknowledgeRead()` wrote that
    // back as the marker, and `unreadMessagesFor()`'s `>` then found the
    // message newer than the marker that NAMES it — every private conversation
    // stayed unread for ever. A column that cannot express what its readers
    // cannot carry is the fix; the tie-break beside it is the other half.
    createdAt: timestamp("created_at", { mode: "date", precision: 3 })
      .notNull()
      .defaultNow(),

    // ── The deletion triple. Read ONLY through `contentState()` ────────────
    // `precision: 3` for the reason above: the live cursor's second half
    // compares this column against a millisecond token.
    deletedAt: timestamp("deleted_at", { mode: "date", precision: 3 }),
    deletedBy: communityDeletedByEnum("deleted_by"),
    removedReason: text("removed_reason"),
  },
  (t) => [
    // Serves three reads with one index: the conversation view (oldest first,
    // id as the tie-break), the live cursor's tuple comparison, and the
    // inbox's `max(created_at)` per conversation — which is the aggregate
    // standing in for the `lastMessageAt` column this schema refuses.
    index("community_messages_conversation").on(
      t.conversationId,
      t.createdAt,
      t.id,
    ),
    // The export and the account-deletion scrub both walk every message of ONE
    // member across every conversation.
    index("community_messages_author").on(t.authorId),
    // 🚨 The retention sweep, and it needs its OWN index — the one above cannot
    // serve it. `community-prune` asks "every message older than X, across all
    // conversations", and an index leading with `conversation_id` is unusable
    // for that.
    //
    // ⚠️ What it buys is the DAILY run, not the first one. Measured: on a table
    // of 40,000 messages with none old enough, the sweep's query is an
    // `Index Scan using community_messages_created` at cost 4.31 — where without
    // the index Postgres must read every row to establish that there is nothing
    // to do, once a day for ever, on the largest table this module has. The first
    // catch-up run is a sequential scan either way and correctly so: when most of
    // the table qualifies, scanning beats seeking. So this is not the batching's
    // other half by way of speed — batching bounds the ONE enormous run, this
    // bounds the thousand small ones. `schema.test.ts` holds all three swept
    // tables to having such an index.
    index("community_messages_created").on(t.createdAt),
  ],
);

/**
 * Somebody said "this is spam".
 *
 * 🚨 **A report is a FROZEN FACT (AD-71).** Whether the reporter was allowed
 * to report is decided once, at the moment they press the button, and never
 * again. The row then counts until it is consumed — even if the content is
 * deleted afterwards, even if the reporter's plan lapses and they lose access
 * to the room, even if the reported member's role changes.
 *
 * That is deliberate and it is the opposite of how everything else in this
 * module works, where access is derived at read time and stored nowhere. The
 * reason is that a report is not an access question, it is an EVENT: "an
 * eligible member said this was spam on Tuesday" does not stop being true on
 * Wednesday. Re-deriving eligibility later would mean a spammer could clear
 * the reports against them by getting the reporters' access revoked — or, more
 * ordinarily, that reports would evaporate whenever somebody's subscription
 * lapsed.
 *
 * `reportedMemberId` is **denormalized at write** for exactly the same reason:
 * joined at read time it would follow the content's author column, which goes
 * NULL when that account is deleted, and the block derived from it would
 * quietly stop existing.
 *
 * ── One target, never two ─────────────────────────────────────────────────
 * A report names a post XOR a message — the check constraint says so, the same
 * shape `community_read_markers` uses for its either/or. The message leg is
 * the one exception the direct-message guard ever grants, and it is bounded:
 * see AD-71 and Story 23.3.
 *
 * ── Duplicates count once ─────────────────────────────────────────────────
 * The two partial unique indexes absorb a second report of the same content by
 * the same member. Not an error — a member tapping twice is not doing anything
 * wrong, and an error would tell them their first tap failed.
 *
 * ── Privacy: two subjects, and the reporter is withheld ───────────────────
 * The reporter's export carries their own reports in full. The reported
 * member's export carries the fact and the date and **not who reported them** —
 * naming a reporter is how a report becomes a reprisal. The one place the app
 * is honest that anonymity cannot be delivered is a conversation with exactly
 * two people in it, and the report dialog says so there rather than implying a
 * protection it cannot give.
 *
 * `reason` is free text, so it is scrubbed when EITHER side deletes their
 * account: it is the reporter's own words and it is about the reported member.
 */
export const communitySpamReports = pgTable(
  "community_spam_reports",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // SET NULL rather than cascade, on both. Deleting the reporter's account
    // must not un-report spam — the fact that an eligible member reported it
    // is frozen — and deleting the reported member leaves a row that matches
    // no threshold and harms nobody.
    reporterId: text("reporter_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reportedMemberId: text("reported_member_id").references(() => users.id, {
      onDelete: "set null",
    }),

    // Exactly one of these. Content rows are never hard-deleted in this module
    // (AD-72 tombstones them), so neither FK produces a surprise.
    postId: text("post_id").references(() => communityPosts.id, {
      onDelete: "set null",
    }),
    messageId: text("message_id").references(() => communityMessages.id, {
      onDelete: "set null",
    }),

    // What the reporter wrote, if anything. Optional: a report with no
    // sentence is still a report, and demanding one would cost the taps that
    // make a spam loop work.
    reason: text("reason"),

    // The messages the reporter chose to attach from their own conversation —
    // Story 23.3's bounded window. The column ships with the table so that
    // story adds an act rather than a migration; the bound is checked at
    // write against `config/community.json`.
    attachedMessageIds: text("attached_message_ids").array(),

    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),

    // NULL means "not yet dealt with" — the `users.blockedAt` idiom this
    // schema uses throughout. ⚠️ An UNCONSUMED row is the derivation set of
    // the automatic send-block (AD-64), which is why `community-prune` never
    // touches one.
    consumedAt: timestamp("consumed_at", { mode: "date" }),
  },
  (t) => [
    check(
      "community_spam_reports_one_target",
      sql`(${t.postId} is null) <> (${t.messageId} is null)`,
    ),
    // Reporting the same thing twice is one report. Partial, because the other
    // column is NULL on every row of the opposite kind and NULLs do not
    // collide.
    uniqueIndex("community_spam_reports_post")
      .on(t.reporterId, t.postId)
      .where(sql`${t.postId} is not null`),
    uniqueIndex("community_spam_reports_message")
      .on(t.reporterId, t.messageId)
      .where(sql`${t.messageId} is not null`),
    // The threshold read (AD-64) and the queue both ask "unconsumed reports
    // against this member, recently" — filter and order in one partial index,
    // per NFR-41's indexed-at-design-time.
    index("community_spam_reports_open")
      .on(t.reportedMemberId, t.createdAt)
      .where(sql`${t.consumedAt} is null`),
    // 🚨 The retention sweep, and the index above is not merely wrongly ordered
    // for it — it EXCLUDES the rows the sweep touches. That one is partial on
    // `consumed_at is null`; the sweep deletes handled reports, so
    // `consumed_at is not null`. An unhandled report is never deleted at any age
    // (those rows ARE the derivation of the automatic send-block), so the sweep's
    // predicate is exactly this index's, and it is partial for the same reason
    // the other one is: it is the only shape either query asks for.
    index("community_spam_reports_handled")
      .on(t.createdAt)
      .where(sql`${t.consumedAt} is not null`),
    // The weighting's own read: "how much has this member reported". Its twin —
    // "how much has this member BEEN reported" — is already served by
    // `community_spam_reports_open` above, whose leading column is
    // `reported_member_id`. NFR-41: indexed for its access pattern at design
    // time, and named here so the next reader knows which query it is for.
    //
    // ⚠️ NOT partial. Both weighting counts are over EVERY report, consumed or
    // not: "this member has reported forty things" is a fact about them whether
    // or not a moderator has got round to the rows yet, and a partial index
    // would silently stop serving the query the day the queue is worked
    // through.
    index("community_spam_reports_reporter").on(t.reporterId),
  ],
);

/**
 * What an operator has decided about ONE member, standing until they change it.
 *
 * 🚨 **This is the deliberate opposite of the send-block, and the difference is
 * WHO DECIDED.** The block is a calculation over rows that exist anyway, so it
 * is derived and stored nowhere (AD-64) — a stored copy would go stale, and a
 * stale copy of "this person may not write" needs a job to clear it. These
 * three are not calculations. Nothing derives them, no rule produces them, they
 * follow from no other row: a person looked at a case and decided. They have to
 * survive a redeploy, and they are the surface an operator corrects the
 * automation with. Deriving them would not be tidier, it would delete them.
 *
 * ── Does `writeBlockedAt` re-open AD-64? No ───────────────────────────────
 * AD-64's argument is worth quoting exactly, because the analogy is tempting
 * and wrong: *a stored flag would need a job to clear it, and a job nobody runs
 * is a member silenced for ever* — **by five taps from strangers**. The load is
 * on "needs a job", and a job is needed there because the block's dissolving
 * condition is TIME. This column has no dissolving condition at all: a person
 * wrote it, their name is on the trail row beside it, and a person takes it
 * back. A row a machine cannot write gags nobody.
 *
 * ── One row, three questions ──────────────────────────────────────────────
 * `NULL` means "not", a timestamp means "since when" — the `users.blockedAt`
 * idiom this schema uses throughout. A row exists only while at least one of
 * the three is set; clearing the last one deletes it, so "no row" and "on no
 * list" are the same state rather than two that can disagree.
 *
 * Protected and write-blocked at once is refused by `standingProblem()` rather
 * than resolved by a precedence rule — the two mean opposite things, and a
 * precedence rule is a sentence somebody has to remember correctly at the
 * moment it matters.
 *
 * ── Who wrote it lives in the trail, not here ─────────────────────────────
 * No `setBy`, no `reason`: six acts in `community_moderation_audit` carry both,
 * and a lock and its later lift are two rows there for the same reason a
 * discussion's are. A column here would be a second, lossy copy of the last
 * one of them.
 *
 * ── Privacy ───────────────────────────────────────────────────────────────
 * A standing decision about a person IS personal data, and it travels in both
 * exports (`privacy/sections.ts`, and its `.mjs` twin) as the STATE — the acts
 * are already carried by the moderation slices. It does not name the operator
 * who set it, exactly as `communityModerationReceived` does not: in a small
 * community, naming a moderator is naming somebody to be angry at. The cascade
 * takes the row when the member's account goes, so there is no scrub statement
 * — there is nobody left for it to be about.
 */
export const communityMemberStanding = pgTable("community_member_standing", {
  // Primary key AND foreign key — one row per member, no id of its own and no
  // unique index that has to be kept honest. The same shape
  // `community_profiles` uses, and cascade for the same reason.
  memberId: text("member_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),

  // Whitelist: the automatic block and the automatic post lock never touch
  // this member. It does NOT make them a moderator and grants nothing.
  protectedAt: timestamp("protected_at", { mode: "date", precision: 3 }),

  // Blacklist A: an operator took their writing away by hand. Refused at every
  // write path with its OWN sentence — never the automatic block's, which
  // speaks of reports this member may not have.
  writeBlockedAt: timestamp("write_blocked_at", { mode: "date", precision: 3 }),

  // Blacklist B: their reports weigh nothing.
  //
  // ⚠️ Their reports are still WRITTEN, at weight 0. Refusing them instead
  // would answer this member differently from everybody else, and a
  // distinguishable refusal announces the list — after which they open a
  // second account. The module already makes this call twice, in
  // `canDeliverTo()` and in `reportProblem()`. It also keeps the evidence:
  // twenty ignored reports against one person is something a moderator wants
  // to see.
  reportsIgnoredAt: timestamp("reports_ignored_at", {
    mode: "date",
    precision: 3,
  }),

  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

/**
 * Every act of moderation power, written down as it happens.
 *
 * ── Append-only, and that is enforced by there being no writer ────────────
 * There is no `updatedAt` and no update path anywhere in `lib/community/
 * manage.ts`: a lock and its later unlock are TWO rows, a send-block and its
 * lifting are two rows. An editable audit trail is not an audit trail — the
 * whole value of the record is that the person who acted cannot revise it
 * afterwards, and the cheapest way to guarantee that is to ship no function
 * that could. `lib/community/moderation-guard.test.ts` reads the module and
 * fails the build if one appears.
 *
 * ── One row, in the act's own transaction ─────────────────────────────────
 * Each act appends exactly one row inside the same transaction that performs
 * it, so an act without its record cannot exist. That is the `impersonations`
 * discipline — write the record BEFORE (or with) the power, never after —
 * applied to the second place in this app where somebody exercises authority
 * over another person's data.
 *
 * ── SET NULL on both people, where the profile CASCADES ───────────────────
 * The contrast with almost every other table here is deliberate. A profile is
 * the member's own self-description and goes with them; a post's words go and
 * its row stays. An audit row is neither: it is a record OF AN ACT, closer to
 * `impersonations` than to anything a member wrote. It has to outlive both the
 * moderator who acted and the member acted upon — a trail that emptied itself
 * when somebody deleted their account would be a trail with a way to erase
 * yourself from it. So both references go NULL and the row remains, carrying
 * what happened and when. AD-65 asks for the declaration; this is it.
 *
 * `reason` is free text a moderator wrote ABOUT a member, so it is that
 * member's personal data on the `grants.note` argument — it travels in both
 * exports and the account-deletion scrub empties it, exactly as
 * `community_posts.removedReason` does.
 *
 * ── Privacy: TWO subjects, sliced ────────────────────────────────────────
 * A row names the actor and the person acted upon. Each side's export carries
 * their own slice: what I did, and what was done to my content.
 * `lib/privacy/export.ts` carries the withheld-with-reason note for the one
 * asymmetry (a member does not learn WHICH moderator removed their post,
 * because no surface ever showed them).
 */
export const communityModerationAudit = pgTable(
  "community_moderation_audit",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // Who exercised the power. NULL once that account is gone — the act
    // still happened.
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),

    // What they did. The values live in `MODERATION_ACTS` in
    // `lib/community/rules.ts` — a `const` union rather than an enum, because
    // later stories add values and an enum would need a migration for each.
    act: text("act").notNull(),

    // Whose content it was about. NULL for an act with no single subject.
    targetMemberId: text("target_member_id").references(() => users.id, {
      onDelete: "set null",
    }),

    // One target coordinate per act shape; the rest are NULL. Cascade: a
    // removal of a post whose discussion is gone has nothing left to point at,
    // and the ACT is still recorded by `act`, `reason` and the two member
    // references.
    postId: text("post_id").references(() => communityPosts.id, {
      onDelete: "set null",
    }),
    discussionId: text("discussion_id").references(
      () => communityDiscussions.id,
      { onDelete: "set null" },
    ),

    // What the moderator wrote. Required for a removal (the core refuses an
    // empty one), absent for a lock.
    reason: text("reason"),

    // ⚠️ **Written by exactly one act, and it ships with the table.** When a
    // moderator opens the bounded window onto a reported private message
    // (AD-71), the ids of the messages that became visible are recorded here —
    // so "who saw what of my correspondence" has an answer. The column is here
    // from the table's first day so that story adds an ACT rather than a
    // migration under live data, the same reason `community_posts` shipped its
    // deletion triple before anything wrote one.
    exposedMessageIds: text("exposed_message_ids").array(),

    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    // The operator's trail: everything, newest first.
    index("community_moderation_audit_time").on(t.createdAt),
    // A moderator's own acts, and the export's actor slice.
    index("community_moderation_audit_actor").on(t.actorId, t.createdAt),
    // The export's target slice: what was done to this member's content.
    index("community_moderation_audit_target").on(t.targetMemberId),
  ],
);

/**
 * One member follows another — the people worth not losing sight of.
 *
 * ── One-sided, immediate, and VISIBLE ─────────────────────────────────────
 * There is no request, no approval and no pending state: the row IS the
 * follow, from the moment it is written. And the row is also the visibility —
 * the followed member sees the follower on their own list because the row
 * exists, not because anything notified them.
 *
 * ⚠️ **There is deliberately no way to follow somebody without appearing on
 * their list**, and that is a shape rather than a setting. No private-follow
 * flag, no hide-me column, no config that could grow one, and no second
 * "bookmark this member" feature that would shadow a follow while staying
 * invisible — that last one is the version somebody builds by accident, and
 * it is exactly the silent watching FR-220 refuses. Whoever wants to keep
 * track of a person is seen keeping track of them.
 *
 * ── No counts. Anywhere ───────────────────────────────────────────────────
 * No follower count on a profile, no number on a card, no aggregate on an
 * operator page. The same reasoning as the missing roster one table up: how
 * many people follow somebody is a fact about those people, and a number is
 * the cheapest way to start describing a paid room's population. The lists
 * exist for the two people in them and nowhere else.
 *
 * ── CASCADE on BOTH columns, and that IS the deletion feature ─────────────
 * A follow is a relationship, not a record: with either person gone there is
 * nothing left to be about, no words to tombstone and nobody to be answered.
 * So FR-223's "deletion removes the relationships in both directions" needs
 * no deletion code at all — it falls out of these two declarations, which is
 * why AD-65 asks for the declaration to be written down and why
 * `lib/community/deletion.test.ts`'s sibling asserts it: an untested cascade
 * is one somebody later "tidies" into `set null`.
 *
 * ── The block DELETES these rows, it never filters them ───────────────────
 * `blockMember()` in `lib/community/manage.ts` removes every follow between
 * the pair inside the same transaction that writes the block (AD-73). Not a
 * read-time filter: a filtered row still exists, and it would then travel in
 * the follower's export — which would disclose that a block exists, the one
 * thing the neutral refusal is built not to say. Lifting a block resurrects
 * nothing; following again is a new, deliberate act.
 *
 * ── Privacy ───────────────────────────────────────────────────────────────
 * Both people are subjects and both can already see the row (that is FR-220),
 * so each side's export names the counterparty openly. What the slicing means
 * here is narrower than elsewhere: you get the relationships you are part of,
 * never the graph.
 */
export const communityFollows = pgTable(
  "community_follows",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    followerId: text("follower_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    followedId: text("followed_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    // Following twice is one row — a double tap is not an error. The leading
    // column is the follower, which is also the direction the friends feed
    // reads (`follower_id = me`), so it needs no index of its own.
    uniqueIndex("community_follows_pair").on(t.followerId, t.followedId),
    // The other direction: "who follows me", for the second of the two lists.
    index("community_follows_followed").on(t.followedId),
    // Following oneself is not a relationship. Refused in the core so it
    // becomes a sentence, and here so it cannot become a row by another route.
    check("community_follows_not_self", sql`${t.followerId} <> ${t.followedId}`),
  ],
);

/**
 * One member has decided not to hear from another.
 *
 * 🚨 **THREE things in this design are called a block, and this is exactly one
 * of them.** Getting them confused is the realistic mistake, so they are named
 * here rather than in a document somebody would have to find:
 *
 * | What | Where it lives | Whose decision |
 * |---|---|---|
 * | Account block | `users.blockedAt`, `lib/users/blocked.ts` | the operator's |
 * | Member → member block | **this table** | the member's own |
 * | Spam send-block | **no table at all** — derived from unconsumed report rows (AD-64) | nobody's; it falls automatically |
 *
 * ⚠️ **The third one must never be persisted here.** AD-64 is explicit: the
 * send-block has no table, and `community_member_blocks` is the DM and follow
 * block exclusively. Whoever builds the spam loop (Epic 23) will find a table
 * named "blocks" and a column shape that looks close enough — it is not. A
 * derived block lifts itself when the reports age out; a row does not, and a
 * member silenced by a row nobody remembers writing has no way back.
 *
 * ── Directional, and the pair is the identity ─────────────────────────────
 * A blocking B and B blocking A are two different facts and two rows. The
 * unique index is over `(blocker_id, blocked_id)` in that order, so blocking
 * twice is one row and lifting a block is a DELETE — severing is deletion,
 * never a flag, which is the same ruling Epic 22's follow-severing inherits.
 *
 * ── CASCADE, where the conversation tables SET NULL ───────────────────────
 * The contrast is worth stating, because it looks inconsistent one table up.
 * A message row is structure that has to outlive its author (the tombstone,
 * the survivor's own side), so its author link is nulled and the row stays. A
 * block row is pure relation: with either end gone it protects nobody and
 * records nothing anyone may see. So both ends cascade — which also discharges
 * "deletion removes them" structurally rather than in a transaction somebody
 * has to remember to write.
 *
 * ── Privacy: ONE subject, and it is the blocker ───────────────────────────
 * The row is in the BLOCKER's export — whom they blocked, and when. It is in
 * the blocked member's export not at all, and that asymmetry is the decision
 * rather than an oversight: FR-201 requires the refusal a blocked member meets
 * to be indistinguishable from any other undeliverable message, and an export
 * that listed "you were blocked by X" would hand them by post exactly what the
 * refusal is built not to say. NFR-35's two-subject slicing, applied where it
 * actually bites.
 */
export const communityMemberBlocks = pgTable(
  "community_member_blocks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // Who decided. Always the session's own id — no surface anywhere lets one
    // member write a block on another's behalf.
    blockerId: text("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // Whom it is about.
    blockedId: text("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    // Blocking twice is one row, and the blocker's own list reads off the
    // leading column.
    uniqueIndex("community_member_blocks_pair").on(t.blockerId, t.blockedId),
    // The send path asks "is there a block between these two, in EITHER
    // direction" — a standing block makes the pair mutually undeliverable for
    // new messages. The unique index above serves the `blocker_id = me` half;
    // this one serves the other half, so the probe is two index lookups and
    // never a scan.
    index("community_member_blocks_blocked").on(t.blockedId),
  ],
);

/**
 * How far a member has read — one row per member and per thread.
 *
 * ── The tuple, and why it is minted here rather than in the live channel ───
 * `(lastReadCreatedAt, lastReadId)` is the module's ONE currency for "what is
 * new since X". Four features would otherwise invent four grammars for the
 * same question — this unread badge, a live room, direct-message unread, a
 * feed's recency — and any two of them disagreeing is a member being told
 * something is new on one page and read on another.
 *
 * It is a TUPLE rather than a timestamp because two posts can land in the same
 * millisecond under load, and a timestamp alone has no total order: the id
 * breaks the tie, and Postgres compares `(a, b) < (c, d)` lexicographically —
 * which is exactly `compareCursor()` in `lib/community/rules.ts`. The
 * arithmetic lives there, in one pure function, and the SQL and the JS agree
 * because they are the same comparison.
 *
 * ── ONE table, two kinds of target, and both legs are now live ─────────────
 * A marker points at *either* a discussion *or* a conversation, never both and
 * never neither — a check constraint says so rather than a convention.
 *
 * The column shipped with 19.7, deliberately empty and deliberately without a
 * REFERENCES clause, because the conversations table did not exist yet; the
 * direct-message release adds the foreign key and nothing else here moves.
 * That was the whole point of the shape: adding the column later would have
 * migrated this table under live data — the check constraint, the unique
 * indexes, the export section and every reader changing at once, on a table
 * already holding a row per member per thread.
 *
 * ⚠️ **Both legs go through the ONE writer**, `acknowledgeRead()` in
 * `lib/community/manage.ts`. A second marker-advance path is the thing the
 * either/or shape exists to prevent.
 *
 * ── No primary key, and the partial uniques are why ────────────────────────
 * A composite key would have to include a nullable column. The two partial
 * unique indexes express the real rule — one marker per member per target —
 * and each covers exactly the rows of its own kind.
 *
 * ── Privacy ───────────────────────────────────────────────────────────────
 * A marker says which discussions this member has read and when. That is
 * personal data of one clear subject: it is in both exports as one section,
 * and it cascades with the account.
 */
export const communityReadMarkers = pgTable(
  "community_read_markers",
  {
    memberId: text("member_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // Exactly one of the next two is set. See the header.
    discussionId: text("discussion_id").references(() => communityDiscussions.id, {
      onDelete: "cascade",
    }),
    // Cascade, like the discussion leg: a marker pointing at a conversation
    // that is gone is not a state anything can read.
    conversationId: text("conversation_id").references(
      () => communityConversations.id,
      { onDelete: "cascade" },
    ),

    // The tuple. Both NOT NULL: a marker with half a cursor cannot be compared
    // against anything, and "read up to somewhere" is not a state.
    //
    // `precision: 3` — the RIGHT-hand side of every unread comparison, and the
    // half that can only ever hold milliseconds: it is written from a JS
    // `Date`. Declaring it says so instead of leaving a column that permits
    // microseconds it will never receive, next to columns that must not send
    // them. The reasoning is at `community_messages.createdAt`.
    lastReadCreatedAt: timestamp("last_read_created_at", {
      mode: "date",
      precision: 3,
    }).notNull(),
    lastReadId: text("last_read_id").notNull(),

    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    // Never both, never neither. `<>` is XOR over booleans in Postgres.
    check(
      "community_read_markers_one_target",
      sql`(${t.discussionId} is null) <> (${t.conversationId} is null)`,
    ),
    uniqueIndex("community_read_markers_discussion")
      .on(t.memberId, t.discussionId)
      .where(sql`${t.discussionId} is not null`),
    uniqueIndex("community_read_markers_conversation")
      .on(t.memberId, t.conversationId)
      .where(sql`${t.conversationId} is not null`),
  ],
);
