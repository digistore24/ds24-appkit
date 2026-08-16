// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What this module answers about one person, for the member's own download.
//
// The twin is `sections.mjs` — the operator's command is bare Node and cannot
// import TypeScript, so the same fourteen queries exist twice, in Drizzle and
// in raw SQL. Both declare the same `sections`, and
// `scripts/modules/privacy.test.ts` compares them with the manifest.
//
// 🚨 Neither half asks whether the community is switched ON, and that is a
// correction rather than an omission. These sections used to be emitted only
// when `isCommunityEnabled()` said yes, on the argument that "a module shipping
// off must leave no trace". That argument is right about the product and wrong
// about this file. Switching the community off DELETES nothing:
// `community_groups` archives rather than deletes by design, and every post,
// profile, duty and marker written while it was on is still in the database. An
// app that ran a community for a year and then set `enabled: false` was
// answering a subject access request with silence about data it demonstrably
// still held.
//
// Worse, the two halves gated on DIFFERENT predicates (`isCommunityEnabled()`
// against a local `.enabled === true`), so one typo in `config/community.json`
// made a member's own download and the operator's command describe two
// different applications. `lib/users/manage.ts` reached the right ruling for
// the other half of the same question and says it in one line: an erasure
// request is about the DATA, not about which features are currently enabled.
// Access is the same request read from the other end.
//
// The only thing that may make these sections absent is the MODULE being
// absent — and `module remove` refuses while these tables still hold rows.
import { asc, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { media } from "@/db/schema-media";
import type { ModulePrivacy } from "@/lib/modules/privacy";
import {
  communityConversations,
  communityDiscussions,
  communityFollows,
  communityGroupModerators,
  communityGroups,
  communityMemberBlocks,
  communityMemberStanding,
  communityMessages,
  communityModerationAudit,
  communityPostMedia,
  communityPosts,
  communityProfiles,
  communityReadMarkers,
  communitySpamReports,
} from "../schema";

const privacy: ModulePrivacy = {
  sections: [
    "communityProfile",
    // The moderator duties are the OTHER end of a two-subject table:
    // `community_group_moderators` names a group and a person, and the person is
    // the data subject — "this app asked me to look after these rooms" is a fact
    // about them. The group is structure and has no subject at all, which is why
    // the `community_groups` ROW is in neither export. Its NAME travels here and
    // on posts as context, because "you moderate group 8f41…" answers nothing
    // anybody asked.
    "communityModeratorDuties",
    // The threads this member STARTED. A title is their own words — the schema
    // says so and the account-deletion scrub empties it for that reason — so a
    // table we scrub on Art. 17 has to be answerable on Art. 15. It used to be in
    // neither export while posts were in both, which is exactly the asymmetry
    // AD-65 exists to close.
    "communityDiscussions",
    // A member's own posts, CONTENT INCLUDED — including the ones they deleted
    // themselves, because those are still their words and a subject access
    // request is not a request for what is currently on screen. A post a
    // MODERATOR removed hands over its state alongside the text, for the same
    // reason; `removedReason` travels with it, because a moderator's reason is
    // something written ABOUT this person (the `grants[].note` rule, applied
    // where it bites hardest). A post tombstoned by an account deletion cannot
    // appear here at all — `author_id` is NULL by then, so no export predicate
    // matches it.
    "communityPosts",
    // Which picture sat on which post — the LINK, and only the link.
    //
    // ⚠️ **The pictures themselves are in the CORE's `media` section, and this is
    // deliberately not a second copy of them.** `lib/privacy/export.ts` answers
    // for every row a member owns at `OWNED_MEDIA_VISIBILITIES` — filename, mime,
    // size, when it was stored — and a post image is exactly such a row
    // (`visibility: "members"`, `ownerId` the author). One table, one owner, one
    // answer; what the MODULE knows and the core cannot is which post a picture
    // belongs to, and the description the member wrote for it.
    //
    // One subject, so nothing to slice: a row here names a post and a picture,
    // both of which are the same person's. That is the question this module's
    // schema header demands of every new table, answered.
    "communityPostImages",
    "communityReadMarkers",
    // The private conversations this member is in, and every message in them.
    //
    // ⚠️ **Both directions travel, and that is a decided reading rather than an
    // oversight.** FR-203 says a member's own DM history belongs to their export
    // and that the other participant's export carries the same conversation from
    // their side. What a participant's export carries is therefore every
    // conversation they are in WITH ALL ITS MESSAGES — exactly what their own
    // read surface already shows them, so the export discloses nothing the
    // product has not already disclosed, and the query is participant-scoped by
    // construction (the same WHERE every reader uses).
    //
    // NFR-35's two-subject slicing bites where one subject must NOT see the
    // other's slice — a report, an audit row, a block (Story 21.2 withholds the
    // blocked side). It does not bite here: both subjects are already readers of
    // every row. The `DELIBERATELY_NOT_SELF_SERVICE` style of explained decision,
    // written down because the silence beside it would read as an oversight.
    "communityConversations",
    "communityMessages",
    // Whom this member has blocked, and when.
    //
    // ⚠️ **The blocker's own rows, and NOTHING from the other direction** — the
    // sharpest per-subject slicing decision in this module, and the one that has
    // to be argued rather than assumed. A block row names two people, so the
    // reflex is to put it in both exports. That reflex would defeat FR-201: a
    // blocked member meets a refusal deliberately indistinguishable from every
    // other undeliverable message, and an export saying "X blocked you on the
    // 3rd" hands them by post exactly what the refusal is built not to say.
    //
    // So the blocked side's export contains no trace — not an empty section
    // about them, no count, nothing. What they hold instead is the honest
    // general answer: this app records that some members have chosen not to
    // receive messages, and does not disclose who (docs/data-protection.md).
    "communityBlocks",
    // Whom this member follows, and who follows them.
    //
    // The EASY case of the two-subject rule, and worth saying why it is easy
    // where the block one directly above is not: a follow is visible to both its
    // people by design (that is FR-220 — the module ships no way to follow
    // silently), so each side's export names the counterparty openly and
    // discloses nothing the product has not already shown them. What the slicing
    // means here is narrower: you get the relationships you are PART OF, never
    // the graph.
    "communityFollows",
    // Moderation, from BOTH ends, and the asymmetry between them is the point.
    //
    //  - `communityModerationActs` — what this member DID as a moderator: the
    //    act, what it was about, their own reason, when. A record of power they
    //    exercised, and theirs.
    //  - `communityModerationReceived` — what was done to THEIR content: the
    //    act, the reason written about them, when.
    //
    // ⚠️ **The received slice does NOT name the moderator**, and that is a
    // decision rather than an omission. No surface in the app ever showed a
    // member which moderator removed their post — the stub says "removed by
    // moderation" — and an export that named one would disclose through the
    // back door what the product deliberately does not disclose through the
    // front: in a small community, naming the moderator is naming a person to
    // be angry at. What the member gets is the act, the reason and the
    // timestamp, which is everything they need to dispute it. The operator's
    // own export (`node run.mjs data-export`) carries the full trail, because
    // that is the surface FR-208 gives it to.
    //
    // The `DELIBERATELY_NOT_SELF_SERVICE` style of explained decision, written
    // here because a reviewer noticing the missing actor should find the
    // argument rather than a gap.
    "communityModerationActs",
    "communityModerationReceived",
    // Spam reports, from both ends — and this is the sharpest withholding in the
    // module after the block.
    //
    //  - `communitySpamReportsMade` — what this member reported, in full. Their
    //    own act and their own words.
    //  - `communitySpamReportsReceived` — that their content was reported, when,
    //    and whether it has been dealt with. **Not who reported it, and not the
    //    reporter's reason.**
    //
    // ⚠️ Naming a reporter is how a report becomes a reprisal, and the reason is
    // free text that routinely identifies its author in a small community ("you
    // spammed my thread on Tuesday"). What the reported member gets is the fact
    // and the date, which is what they need to know something happened. The
    // moderator's OWN reason for acting is a different field and IS in their
    // export (`communityModerationReceived`) — a decision taken about you is
    // owed to you; an accusation made about you is not, while it is unproven.
    //
    // The one place the app admits anonymity cannot be delivered is a
    // conversation with exactly two people in it, and the report dialog says so
    // there rather than letting this file imply a protection it does not have.
    "communitySpamReportsMade",
    "communitySpamReportsReceived",
    // What an operator has DECIDED about this member and left standing: the
    // whitelist and the two blacklists.
    //
    // ⚠️ **A state, not an act, and that is why it needs a slice of its own.**
    // The acts that put them on a list are already carried by the two
    // moderation slices above — `community_moderation_audit` holds a row per
    // decision. What no slice would otherwise answer is "and what is true about
    // me RIGHT NOW", which is the part that is actually operating on them: a
    // member whose reports have quietly counted for nothing since March cannot
    // learn that from a trail of acts they would have to read backwards.
    //
    // ⚠️ It does NOT name the operator who set it, the same withholding as
    // `communityModerationReceived` and for the same reason: in a small
    // community, naming somebody is naming a person to be angry at. The
    // decision, its date and its reason are what a member needs to dispute it.
    //
    // 🚨 Note what is NOT here and cannot be: the reporter weight. It is
    // computed at the moment a block is derived and stored nowhere, so there is
    // no row to export — an accident of the derived design that happens to be
    // the privacy-friendly one, since a stored reputation number about a person
    // would have to travel in both exports and would sit in a table waiting to
    // be asked for.
    "communityMemberStanding",
  ],

  async build(memberId: string) {
    const [
      communityProfileRows,
      communityDutyRows,
      communityDiscussionRows,
      communityPostRows,
      communityPostImageRows,
      communityReadMarkerRows,
    ] = await Promise.all([
      // Their community profile — the name they chose, what they wrote about
      // themselves, the picture they picked. At most one row: the table is 1:1
      // and keyed by the member id.
      //
      // Queried whether or not the community is switched on — see the header:
      // the switch is a product state, not a disclosure boundary.
      db
        .select({
          displayName: communityProfiles.displayName,
          about: communityProfiles.about,
          avatarMediaId: communityProfiles.avatarMediaId,
          createdAt: communityProfiles.createdAt,
          updatedAt: communityProfiles.updatedAt,
        })
        .from(communityProfiles)
        .where(eq(communityProfiles.memberId, memberId)),

      // The rooms they were asked to look after. The GROUP's name travels with
      // it, because "you moderate group 8f41…" answers nothing a person asked —
      // and a group name is the operator's own copy, not another member's data.
      db
        .select({
          groupId: communityGroupModerators.groupId,
          groupName: communityGroups.name,
          createdAt: communityGroupModerators.createdAt,
        })
        .from(communityGroupModerators)
        .innerJoin(
          communityGroups,
          eq(communityGroups.id, communityGroupModerators.groupId),
        )
        .where(eq(communityGroupModerators.memberId, memberId))
        .orderBy(asc(communityGroupModerators.createdAt)),

      // The threads this member STARTED. Their title is their own words; the
      // room name travels as context the same way it does on a post.
      db
        .select({
          discussionId: communityDiscussions.id,
          groupName: communityGroups.name,
          title: communityDiscussions.title,
          createdAt: communityDiscussions.createdAt,
          lastActivityAt: communityDiscussions.lastActivityAt,
          lockedAt: communityDiscussions.lockedAt,
        })
        .from(communityDiscussions)
        .innerJoin(
          communityGroups,
          eq(communityGroups.id, communityDiscussions.groupId),
        )
        .where(eq(communityDiscussions.createdBy, memberId))
        .orderBy(asc(communityDiscussions.createdAt)),

      // Their posts, with the thread and room they are in — an id answers
      // nothing anybody asked. The DELETION columns travel too, so that a person
      // reading this file can see which of their posts is still on screen and
      // which is not; `contentState()` is what turns the pair into a word, and
      // this file deliberately hands over the raw pair rather than a rendering.
      //
      // ⚠️ `discussionTitle` is the one field here that is ANOTHER member's
      // authored text, and it travels deliberately: without it a post reads as an
      // answer to nothing, and the title is text this member could already read
      // — it is the heading of a thread they posted in, on a page they had access
      // to. That is a narrower disclosure than the webhook bodies the core export
      // refuses (Art. 15(4), where the third party never met the requester), and
      // it is written down here rather than left to be noticed, because the group
      // name two lines up got its own argument and the silence beside it read as
      // an oversight.
      //
      // `removedReason` travels too. It is free text a MODERATOR wrote about this
      // member, which is the `grants[].note` category — "what we wrote about this
      // person" belongs in the answer — and §7 of docs/data-protection.md says an
      // operator reads the file before forwarding it.
      db
        .select({
          postId: communityPosts.id,
          groupName: communityGroups.name,
          discussionTitle: communityDiscussions.title,
          content: communityPosts.content,
          createdAt: communityPosts.createdAt,
          editedAt: communityPosts.editedAt,
          deletedAt: communityPosts.deletedAt,
          deletedBy: communityPosts.deletedBy,
          removedReason: communityPosts.removedReason,
        })
        .from(communityPosts)
        .innerJoin(
          communityDiscussions,
          eq(communityDiscussions.id, communityPosts.discussionId),
        )
        .innerJoin(
          communityGroups,
          eq(communityGroups.id, communityDiscussions.groupId),
        )
        .where(eq(communityPosts.authorId, memberId))
        .orderBy(asc(communityPosts.createdAt)),

      // The pictures on their posts, as the link plus the words they wrote about
      // each one.
      //
      // ⚠️ **A LEFT join on `media`, and that is the load-bearing half.**
      // `media_id` is `set null`, so a picture the member already deleted — or one
      // erased by an earlier partial cleanup — leaves a row here with nothing
      // behind it. An INNER join would silently drop those, and what a subject
      // access request would then say is "you attached no picture to that post",
      // which is false: the app still holds the row saying they did. `null` in
      // `mediaId` is the honest answer, and `alt` is null with it.
      //
      // The post's thread travels as context, exactly as it does on the post
      // itself — a bare post id answers nothing anybody asked.
      db
        .select({
          postId: communityPostMedia.postId,
          discussionTitle: communityDiscussions.title,
          position: communityPostMedia.position,
          mediaId: communityPostMedia.mediaId,
          // Their own sentence about their own picture. Stored on the `media` row
          // because that is where the delivery layer reads it; it is the member's
          // text either way, so it belongs in the answer.
          alt: media.alt,
        })
        .from(communityPostMedia)
        .innerJoin(communityPosts, eq(communityPosts.id, communityPostMedia.postId))
        .innerJoin(
          communityDiscussions,
          eq(communityDiscussions.id, communityPosts.discussionId),
        )
        .leftJoin(media, eq(media.id, communityPostMedia.mediaId))
        .where(eq(communityPosts.authorId, memberId))
        .orderBy(asc(communityPostMedia.postId), asc(communityPostMedia.position)),

      // How far they have read in each thread. The thread's title travels with
      // it for the same reason the posts carry theirs — an id answers nothing.
      // The stored cursor itself is deliberately included: it is what the app
      // holds, and paraphrasing it as "read" would be a rendering rather than a
      // copy of the data.
      //
      // ⚠️ **A LEFT join, not an inner one.** The table is check-constrained to
      // carry either a discussion id or a conversation id, and an inner join on
      // discussions silently discards every row of the second kind — the shape
      // Epic 21's direct messages will write. Nothing writes it today, which is
      // exactly why this would not have been revisited: the export would simply
      // have stopped mentioning a whole class of marker, on the day the feature
      // shipped, with no test failing. `discussionTitle` is null for those rows
      // and `conversationId` says what the marker points at instead.
      db
        .select({
          discussionTitle: communityDiscussions.title,
          conversationId: communityReadMarkers.conversationId,
          lastReadCreatedAt: communityReadMarkers.lastReadCreatedAt,
          lastReadId: communityReadMarkers.lastReadId,
          updatedAt: communityReadMarkers.updatedAt,
        })
        .from(communityReadMarkers)
        .leftJoin(
          communityDiscussions,
          eq(communityDiscussions.id, communityReadMarkers.discussionId),
        )
        .where(eq(communityReadMarkers.memberId, memberId))
        .orderBy(asc(communityReadMarkers.updatedAt)),
    ]);

    // ── The private conversations ───────────────────────────────────────────
    // Two reads rather than one join: the messages are keyed by the
    // conversations found first, which is what keeps the scope visible — a
    // member's export can only ever contain messages of conversations they
    // participate in, because that is the only list the second query is given.
    const conversationRows = await db
      .select({
        conversationId: communityConversations.id,
        // The other person's member id. They are not a stranger to this reader:
        // it is somebody this member has been writing to, whose profile page
        // they can already open. `null` once that account is deleted — the FK
        // NULLs the column and the conversation stays (FR-203).
        counterpartId: sql<
          string | null
        >`case when ${communityConversations.participantAId} = ${memberId} then ${communityConversations.participantBId} else ${communityConversations.participantAId} end`,
        createdAt: communityConversations.createdAt,
      })
      .from(communityConversations)
      .where(
        or(
          eq(communityConversations.participantAId, memberId),
          eq(communityConversations.participantBId, memberId),
        ),
      )
      .orderBy(asc(communityConversations.createdAt));

    const conversationIds = conversationRows.map((row) => row.conversationId);

    const communityMessageRows = conversationIds.length
      ? await db
          .select({
            conversationId: communityMessages.conversationId,
            // Whose message it is, said in a word rather than as an id — the
            // person reading this file wants to know which half they wrote.
            // `null` on a tombstoned message: the author link is gone, and
            // inventing one would be worse than the honest blank.
            fromMe: sql<boolean>`(${communityMessages.authorId} = ${memberId})`,
            content: communityMessages.content,
            createdAt: communityMessages.createdAt,
            // The deletion columns travel raw, exactly as they do on a post:
            // `contentState()` is what turns the pair into a word, and this file
            // hands over the data rather than a rendering. `removedReason` is a
            // moderator's own text about somebody — the `grants[].note` category.
            deletedAt: communityMessages.deletedAt,
            deletedBy: communityMessages.deletedBy,
            removedReason: communityMessages.removedReason,
          })
          .from(communityMessages)
          .where(inArray(communityMessages.conversationId, conversationIds))
          .orderBy(asc(communityMessages.createdAt))
      : [];

    // ⚠️ **`blockerId` only.** See the section list for the argument: the rows
    // where this member is the BLOCKED one are somebody else's decision about
    // their own inbox, and disclosing them here would answer the question the
    // neutral refusal exists to leave unanswered. There is no reader for that
    // direction anywhere in the module, which is what makes this a shape rather
    // than a filter somebody could drop.
    const blockRows = await db
      .select({
        blockedId: communityMemberBlocks.blockedId,
        createdAt: communityMemberBlocks.createdAt,
      })
      .from(communityMemberBlocks)
      .where(eq(communityMemberBlocks.blockerId, memberId))
      .orderBy(asc(communityMemberBlocks.createdAt));

    const [moderationActs, moderationReceived] = await Promise.all([
      db
        .select({
          act: communityModerationAudit.act,
          postId: communityModerationAudit.postId,
          discussionId: communityModerationAudit.discussionId,
          reason: communityModerationAudit.reason,
          createdAt: communityModerationAudit.createdAt,
        })
        .from(communityModerationAudit)
        .where(eq(communityModerationAudit.actorId, memberId))
        .orderBy(asc(communityModerationAudit.createdAt)),

      // ⚠️ No `actorId` in this projection, and no join to fetch a name — see
      // the section list for the argument. The absence is structural: there is
      // no field here for a later edit to render by accident.
      db
        .select({
          act: communityModerationAudit.act,
          postId: communityModerationAudit.postId,
          discussionId: communityModerationAudit.discussionId,
          reason: communityModerationAudit.reason,
          createdAt: communityModerationAudit.createdAt,
        })
        .from(communityModerationAudit)
        .where(eq(communityModerationAudit.targetMemberId, memberId))
        .orderBy(asc(communityModerationAudit.createdAt)),
    ]);

    const [reportsMade, reportsReceived] = await Promise.all([
      db
        .select({
          postId: communitySpamReports.postId,
          messageId: communitySpamReports.messageId,
          reason: communitySpamReports.reason,
          createdAt: communitySpamReports.createdAt,
          consumedAt: communitySpamReports.consumedAt,
        })
        .from(communitySpamReports)
        .where(eq(communitySpamReports.reporterId, memberId))
        .orderBy(asc(communitySpamReports.createdAt)),

      // ⚠️ No `reporterId` and no `reason` in this projection — see the section
      // list. The absence is structural: there is no field here for a later
      // edit to render by accident.
      db
        .select({
          postId: communitySpamReports.postId,
          messageId: communitySpamReports.messageId,
          createdAt: communitySpamReports.createdAt,
          consumedAt: communitySpamReports.consumedAt,
        })
        .from(communitySpamReports)
        .where(eq(communitySpamReports.reportedMemberId, memberId))
        .orderBy(asc(communitySpamReports.createdAt)),
    ]);

    // The operator's standing decisions about this member. At most one row —
    // the table is 1:1 — and no row is the ordinary case, which is why the key
    // is always present and `null` rather than absent: an absent heading would
    // say "this application has no such thing", which is a claim about the
    // data. `setBy` is deliberately not selected; see the section's note.
    const [standingRow] = await db
      .select({
        protectedAt: communityMemberStanding.protectedAt,
        writeBlockedAt: communityMemberStanding.writeBlockedAt,
        reportsIgnoredAt: communityMemberStanding.reportsIgnoredAt,
        createdAt: communityMemberStanding.createdAt,
        updatedAt: communityMemberStanding.updatedAt,
      })
      .from(communityMemberStanding)
      .where(eq(communityMemberStanding.memberId, memberId))
      .limit(1);

    // Both directions, in one section — the two lists this member can already
    // see on their own page. No count is derived here or anywhere else.
    const [followingRows, followedByRows] = await Promise.all([
      db
        .select({
          memberId: communityFollows.followedId,
          createdAt: communityFollows.createdAt,
        })
        .from(communityFollows)
        .where(eq(communityFollows.followerId, memberId))
        .orderBy(asc(communityFollows.createdAt)),
      db
        .select({
          memberId: communityFollows.followerId,
          createdAt: communityFollows.createdAt,
        })
        .from(communityFollows)
        .where(eq(communityFollows.followedId, memberId))
        .orderBy(asc(communityFollows.createdAt)),
    ]);

    return {
      // At most one row — the table is 1:1. Kept as the row itself rather than
      // an array so the section reads as "your profile" and not "your
      // profiles".
      //
      // The key is always present, `null` when they never named themselves. It
      // used to be absent entirely on an installation with the community off —
      // see the header for why that was wrong: an absent heading says "this
      // application has no such thing", which is a claim about the DATA, and the
      // data is still there after the switch is flipped.
      communityProfile: communityProfileRows[0] ?? null,
      // A list, unlike the profile: a member may look after several rooms, and
      // an empty array is the honest answer for the many who look after none.
      communityModeratorDuties: communityDutyRows,
      communityDiscussions: communityDiscussionRows,
      communityPosts: communityPostRows,
      communityPostImages: communityPostImageRows,
      communityReadMarkers: communityReadMarkerRows,
      communityConversations: conversationRows,
      communityMessages: communityMessageRows,
      communityBlocks: blockRows,
      communityFollows: { following: followingRows, followedBy: followedByRows },
      communityModerationActs: moderationActs,
      communityModerationReceived: moderationReceived,
      communitySpamReportsMade: reportsMade,
      communitySpamReportsReceived: reportsReceived,
      communityMemberStanding: standingRow ?? null,
    };
  },
};

export default privacy;
