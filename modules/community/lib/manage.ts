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

// ── This file is a BARREL, and the list below is the point ─────────────────
//
// It was 5,902 lines: eleven domains in one file, with 18 helpers reaching
// across their boundaries and three circular pairs among them. The domains are
// now one file each, and this names what the module offers.
//
// 🚨 **Named, never `export *`, and that is the whole design decision.** The
// eleven files export more than they used to: helpers that were private inside
// the old file — `guardSendBlock`, `pageOffset`, `grantedKeysFor`,
// `discussionForViewer` and fifteen others — must be visible to their siblings
// now. `export *` would hand every one of them to the rest of the app, and
// anything a barrel exports is something somebody eventually imports. So the
// list below is exactly the surface the module had before the split: 95 names,
// unchanged, and a helper that leaks into it does so because somebody typed it
// here.
//
// The layering, and why each `_`-prefixed file exists (each one dissolves a
// cycle or a helper with four consumers): docs/modules.md → *The community's
// layers*.

export { sendBlockFor } from "./_blocks";
export { POST_IMAGE_SLOT } from "./_post-images";
export type { PostImageUpload } from "./_post-images";
export { addEmbeddedPost, embedAccessFor, embeddedDiscussionView, ensureEmbeddedDiscussion } from "./embedded";
export type { EmbeddedDiscussionView } from "./embedded";
export { FEED_PER_PAGE, feedFor, feedSince } from "./feed";
export type { FeedItem, FeedItemResolved } from "./feed";
export { FOLLOWS_PER_PAGE, followMember, followsFor, isFollowing, unfollowMember } from "./following";
export type { FollowRow } from "./following";
export { assignGroupModerator, createGroup, groupFor, groupsFor, listGroups, moderatorCandidates, removeGroupModerator, reorderGroups, setGroupArchived, updateGroup } from "./groups";
export type { CommunityGroup, GroupInput, GroupModeratorRow } from "./groups";
export { LIVE_POSTS_PER_ANSWER, liveAnswerFor, scrubCommunityContentFor } from "./live";
export type { LiveScope, LiveScopeAnswer } from "./live";
export { CONVERSATIONS_PER_PAGE, MESSAGES_PER_PAGE, blockMember, conversationHeaderFor, hasBlocked, listBlocks, listConversations, listMessages, openConversation, sendMessage, unblockMember, unreadMessagesFor } from "./messages";
export type { ConversationRow, MessageRow } from "./messages";
export { AUDIT_PER_PAGE, moderationAuthority, moderationTrail, removePostAsModerator, setDiscussionLocked } from "./moderation";
export type { AuditRow, ModerationAuthority } from "./moderation";
export { avatarUrlFor, avatarUrlsFor, memberWithProfile, profileFor, refreshAvatarAlt, setProfileAvatar, upsertProfile } from "./profiles";
export type { CommunityProfile } from "./profiles";
export { REPORTS_PER_PAGE, consumeReport, liftSendBlock, openReports, reportConflictFor, reportContent, reportedMessagesFor, reportedPostFor, standingSendBlocks } from "./reports";
export type { SpamReportRow } from "./reports";
export { DISCUSSIONS_PER_PAGE, POSTS_PER_PAGE, addPost, deleteOwnPost, discussionFor, discussionsFor, editOwnPost, lastPageOf, postImagePolicy, postImagesFor, postsFor, startDiscussion } from "./talk";
export type { DiscussionRow, PostRow } from "./talk";
export { acknowledgeRead, unreadByDiscussion, unreadByGroup, unreadFor } from "./unread";
export { changedAt } from "./rules";
