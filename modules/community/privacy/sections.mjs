// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The bare-Node twin of `sections.ts` — the operator's `node run.mjs
// data-export` runs with no bundler and cannot import TypeScript, so the same
// fourteen queries exist a second time as raw SQL.
//
// `scripts/modules/privacy.test.ts` compares both halves with the manifest.
//
// 🚨 None of it is gated on `config/community.json`, and that is a correction
// rather than an omission. This used to read the switch and drop the sections
// when it said off — with a comment claiming "same coercion the module
// applies", which was half of it: the app's `isCommunityEnabled()` is
// `enabled && problems.length === 0`, so one typo in that file made the
// operator's answer and the member's own download describe different
// applications.
//
// Both halves are fixed the same way, by deleting the question. Switching the
// community off deletes nothing — groups archive rather than delete by design —
// so an app that ran one for a year still holds every row, and an access
// request is about the data rather than about which features are currently
// enabled. That is the ruling `lib/users/manage.ts` already applies to erasure;
// this is the same request read from the other end.

export const sections = [
  "communityProfile",
  "communityModeratorDuties",
  "communityDiscussions",
  "communityPosts",
  "communityPostImages",
  "communityReadMarkers",
  "communityConversations",
  "communityMessages",
  "communityBlocks",
  "communityFollows",
  "communityModerationActs",
  "communityModerationReceived",
  "communitySpamReportsMade",
  "communitySpamReportsReceived",
  // The operator's standing decisions about this member — the whitelist and the
  // two blacklists. A STATE, where the two moderation slices above carry the
  // acts: what is actually operating on somebody right now is not readable from
  // a trail they would have to reconstruct backwards. It does not name the
  // operator who set it, the same withholding as `communityModerationReceived`.
  "communityMemberStanding",
];

/**
 * @param {import("postgres").Sql} sql
 * @param {string | null} memberId
 */
export async function build(sql, memberId) {
  // --- Their face in the community -------------------------------------------
  // The name they chose, their sentence about themselves, the picture they
  // picked. At most one row — the table is 1:1 and keyed by the member id — and
  // none at all on an app whose community was never switched on. The section
  // stays in the report either way: "nothing under this heading" is an answer,
  // an absent heading is a gap somebody has to explain later.
  const communityProfileRows = memberId
    ? await sql`
        select display_name, about, avatar_media_id, created_at, updated_at
        from community_profiles
        where member_id = ${memberId}`
    : [];

  // --- The rooms they were asked to look after -------------------------------
  // `community_group_moderators` names a group and a person; the PERSON is the
  // data subject — "this app asked me to look after these rooms" is a fact
  // about them. The group at the other end is operator-authored structure with
  // no subject at all, which is why `community_groups` appears in NEITHER
  // export. Its name travels with the duty because "you moderate group
  // 8f41…" answers nothing anybody asked.
  const communityDuties = memberId
    ? await sql`
        select d.group_id, g.name as group_name, d.created_at
        from community_group_moderators d
        join community_groups g on g.id = d.group_id
        where d.member_id = ${memberId}
        order by d.created_at`
    : [];

  // --- The threads they started ----------------------------------------------
  // A discussion title is the starter's own words — the schema says so and the
  // account-deletion scrub empties it for exactly that reason. A table this app
  // scrubs on Art. 17 has to be answerable on Art. 15; it used to be in neither
  // export while posts were in both, which is the asymmetry AD-65 exists to
  // close.
  const communityDiscussionRows = memberId
    ? await sql`
        select d.id as discussion_id, g.name as group_name, d.title,
               d.created_at, d.last_activity_at, d.locked_at
        from community_discussions d
        join community_groups g on g.id = d.group_id
        where d.created_by = ${memberId}
        order by d.created_at`
    : [];

  // --- What they wrote in the community --------------------------------------
  // Their own posts, CONTENT INCLUDED — including the ones they deleted
  // themselves, because those are still their words and a subject access
  // request is not a request for what is currently on screen. A post
  // tombstoned by an account deletion has nothing left to hand over; one
  // removed by a moderator hands over its state alongside the text, and its
  // `removed_reason` with it — that is free text a moderator wrote ABOUT this
  // member, which is the `grants[].note` category: what we wrote about a person
  // belongs in the answer. §7 is where the operator is told to read the file
  // before forwarding it. The room and the thread travel with each row: an id
  // answers nothing anybody asked.
  const communityPostRows = memberId
    ? await sql`
        select p.id as post_id, g.name as group_name, d.title as discussion_title,
               p.content, p.created_at, p.edited_at, p.deleted_at, p.deleted_by,
               p.removed_reason
        from community_posts p
        join community_discussions d on d.id = p.discussion_id
        join community_groups g on g.id = d.group_id
        where p.author_id = ${memberId}
        order by p.created_at`
    : [];

  // --- Which picture sat on which post ---------------------------------------
  // The LINK and the member's own description of each picture — not a second copy
  // of the picture's own facts, which are in the CORE report's media section
  // (`node run.mjs data-export` answers for every row a member owns at
  // OWNED_MEDIA_VISIBILITIES, and a post image is one of those). What the module
  // knows and the core cannot is which post a picture belongs to.
  //
  // ⚠️ **A LEFT join on `media`.** `media_id` is `set null`, so a picture already
  // deleted leaves a row here with nothing behind it — and an INNER join would
  // answer "you attached no picture to that post", which is false while the app
  // still holds the row saying they did. The twin does the same, and
  // `scripts/modules/privacy.test.ts` is what keeps the two halves one answer.
  const communityPostImageRows = memberId
    ? await sql`
        select pm.post_id, d.title as discussion_title, pm.position,
               pm.media_id, m.alt
        from community_post_media pm
        join community_posts p on p.id = pm.post_id
        join community_discussions d on d.id = p.discussion_id
        left join media m on m.id = pm.media_id
        where p.author_id = ${memberId}
        order by pm.post_id, pm.position`
    : [];

  // --- How far they have read ------------------------------------------------
  // One row per thread they have opened. A marker says which discussions this
  // member read and when — a small but plain record of their activity, so it
  // belongs in the answer. The thread's title travels with it; an id answers
  // nothing anybody asked.
  const communityReadMarkerRows = memberId
    ? await sql`
        select d.title as discussion_title, m.conversation_id,
               m.last_read_created_at, m.last_read_id, m.updated_at
        from community_read_markers m
        left join community_discussions d on d.id = m.discussion_id
        where m.member_id = ${memberId}
        order by m.updated_at`
    : [];

  // --- Their private conversations --------------------------------------------
  // Every conversation this member is in, and every message in it — both
  // directions. FR-203: a member's own DM history belongs to their export, and
  // the other participant's export carries the same conversation from their
  // side. What travels is exactly what their own inbox already shows them, so
  // the file discloses nothing the product has not, and the query is
  // participant-scoped by construction.
  //
  // ⚠️ **This is the ONE place outside the module's own `manage.ts` and the
  // member's own download that may name these tables**, and
  // `dm-guard.test.ts` fails the build if that stops being true. There is no
  // operator VIEW of a conversation anywhere in the app — this report is a
  // subject access request about one named person, answered by hand, and it is
  // not a support tool.
  const communityConversationRows = memberId
    ? await sql`
        select c.id as conversation_id,
               case when c.participant_a_id = ${memberId}
                    then c.participant_b_id else c.participant_a_id end
                 as counterpart_id,
               c.created_at
        from community_conversations c
        where c.participant_a_id = ${memberId} or c.participant_b_id = ${memberId}
        order by c.created_at`
    : [];

  const communityMessageRows = memberId
    ? await sql`
        select m.conversation_id, (m.author_id = ${memberId}) as from_me,
               m.content, m.created_at, m.deleted_at, m.deleted_by,
               m.removed_reason
        from community_messages m
        join community_conversations c on c.id = m.conversation_id
        where c.participant_a_id = ${memberId} or c.participant_b_id = ${memberId}
        order by m.created_at`
    : [];

  // --- Whom they have blocked --------------------------------------------------
  // ⚠️ **`blocker_id` only, and the asymmetry is the decision.** A block row
  // names two people, so the reflex is to answer it from both ends. That
  // reflex would defeat FR-201: a blocked member meets a refusal deliberately
  // indistinguishable from every other undeliverable message, and a report
  // saying "X blocked you on the 3rd" hands them exactly what the refusal is
  // built not to say. So this section is whom THIS person chose not to hear
  // from; the rows where they are the blocked one are somebody else's decision
  // about their own inbox and appear nowhere.
  const communityBlockRows = memberId
    ? await sql`
        select blocked_id, created_at
        from community_member_blocks
        where blocker_id = ${memberId}
        order by created_at`
    : [];

  // --- Whom they follow, and who follows them ----------------------------------
  // The easy case of the two-subject rule: a follow is visible to both its
  // people by design (the module ships no way to follow silently), so each
  // side's answer names the counterparty openly. What is sliced is the GRAPH —
  // this person gets the relationships they are part of and nothing else.
  const communityFollowingRows = memberId
    ? await sql`
        select followed_id as member_id, created_at
        from community_follows where follower_id = ${memberId}
        order by created_at`
    : [];
  const communityFollowedByRows = memberId
    ? await sql`
        select follower_id as member_id, created_at
        from community_follows where followed_id = ${memberId}
        order by created_at`
    : [];

  // --- Moderation, from both ends ----------------------------------------------
  // What this person DID as a moderator, and what was done to their content.
  //
  // ⚠️ **The received slice deliberately does not name the moderator.** No
  // surface in the app ever showed a member which moderator removed their post
  // — the stub says "removed by moderation" — and an export naming one would
  // disclose through the back door what the product does not disclose through
  // the front: in a small community, naming the moderator is naming a person
  // to be angry at. This report is the OPERATOR's, so it could carry it; it
  // does not, because the member's own download and this file answer the same
  // request and must not describe two different applications.
  //
  // The full trail, with actors, is on /dashboard/community/moderation, which
  // is the surface FR-208 gives it to.
  const communityModerationActs = memberId
    ? await sql`
        select act, post_id, discussion_id, reason, created_at
        from community_moderation_audit where actor_id = ${memberId}
        order by created_at`
    : [];
  const communityModerationReceived = memberId
    ? await sql`
        select act, post_id, discussion_id, reason, created_at
        from community_moderation_audit where target_member_id = ${memberId}
        order by created_at`
    : [];

  // --- Spam reports, from both ends --------------------------------------------
  // ⚠️ **The received slice names neither the reporter nor their reason**, and
  // the operator's report withholds them exactly as the member's own download
  // does — the two answer the same request and must not describe two different
  // applications. Naming a reporter is how a report becomes a reprisal, and a
  // reason in a small community routinely identifies its author. The open
  // queue on /dashboard/community/reports is where a moderator judges the
  // content, and it does not name the reporter either.
  const communityReportsMade = memberId
    ? await sql`
        select post_id, message_id, reason, created_at, consumed_at
        from community_spam_reports where reporter_id = ${memberId}
        order by created_at`
    : [];
  const communityReportsReceived = memberId
    ? await sql`
        select post_id, message_id, created_at, consumed_at
        from community_spam_reports where reported_member_id = ${memberId}
        order by created_at`
    : [];

  // At most one row — the table is 1:1 — and no row is the ordinary case.
  // `member_id` is not selected: it is this member, which the file already says
  // at its top, and `updated_at`/`created_at` are what date the decision.
  const communityStandingRows = memberId
    ? await sql`
        select protected_at, write_blocked_at, reports_ignored_at,
               created_at, updated_at
        from community_member_standing where member_id = ${memberId}
        limit 1`
    : [];

  return {
    // Always present, `null` when they never named themselves — see the note at
    // the top of this file. An absent heading says "this application has no
    // such thing", which is a claim about the DATA, and the data survives the
    // switch being flipped.
    communityProfile: communityProfileRows[0] ?? null,
    // A list, unlike the profile: a member may look after several rooms, and an
    // empty array is the honest answer for the many who look after none.
    communityModeratorDuties: communityDuties,
    communityDiscussions: communityDiscussionRows,
    communityPosts: communityPostRows,
    communityPostImages: communityPostImageRows,
    communityReadMarkers: communityReadMarkerRows,
    communityConversations: communityConversationRows,
    communityMessages: communityMessageRows,
    communityBlocks: communityBlockRows,
    communityFollows: {
      following: communityFollowingRows,
      followedBy: communityFollowedByRows,
    },
    communityModerationActs,
    communityModerationReceived,
    communitySpamReportsMade: communityReportsMade,
    communitySpamReportsReceived: communityReportsReceived,
    communityMemberStanding: communityStandingRows[0] ?? null,
  };
}
