// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use server";

// One action: the next page of the feed.
//
// ⚠️ **It takes a cursor and nothing else.** The viewer comes from the session,
// so there is nowhere to put somebody else's member id — a feed is the surface
// where an id parameter would be worth the most to an attacker, because it
// would answer "what does this person see" in one request.
//
// The cursor is opaque and is not trusted either: `feedFor()` re-derives the
// readable rooms and the follow set on every call, so the worst a forged token
// can do is name a different point in a list the viewer may already read.
import { notFound } from "next/navigation";

import { requireActiveUser } from "@/lib/authz";
import { isCommunityEnabled } from "@/modules/community/lib/config";
import { feedFor } from "@/modules/community/lib/manage";

/** One item, as it crosses to the client. Dates are ISO strings on the way. */
export interface FeedItemView {
  postId: string;
  discussionId: string;
  discussionTitle: string;
  groupId: string;
  groupName: string;
  authorId: string | null;
  authorProfileName: string | null;
  authorAccountName: string | null;
  /**
   * The author's picture, already minted for THIS viewer — or `null`.
   *
   * ⚠️ **An address, never the media id.** `feedFor()` asked `mayAccess()`
   * before it minted this, and the id it started from stays on the server: a
   * client holding one could not fetch anything with it, and shipping it would
   * be an inventory of who has a picture for no gain.
   */
  authorAvatarUrl: string | null;
  content: string;
  createdAt: string;
}

export async function loadMoreFeedAction(
  cursor: string,
): Promise<{ items: FeedItemView[]; nextCursor: string | null }> {
  if (!isCommunityEnabled()) notFound();
  const session = await requireActiveUser();

  const { items, nextCursor } = await feedFor(
    {
      memberId: session.user.id as string,
      role: session.user.role as string,
    },
    cursor,
  );

  return {
    // ⚠️ **Field by field, not `{ ...item }`.** A resolved feed item carries
    // `authorAvatarMediaId` beside the address that was minted from it, and a
    // spread would ship the id to the browser — where nothing can use it and
    // nothing should have it. The same mapping stands in `page.tsx`; two short
    // literals are the price of not having a spread quietly widen the wire
    // whenever a column is added to the join.
    items: items.map((item) => ({
      postId: item.postId,
      discussionId: item.discussionId,
      discussionTitle: item.discussionTitle,
      groupId: item.groupId,
      groupName: item.groupName,
      authorId: item.authorId,
      authorProfileName: item.authorProfileName,
      authorAccountName: item.authorAccountName,
      authorAvatarUrl: item.authorAvatarUrl,
      content: item.content,
      createdAt: item.createdAt.toISOString(),
    })),
    nextCursor,
  };
}
