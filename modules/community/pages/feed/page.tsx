// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Rss, Users } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cursorToken, liveCursorBeginning } from "@/modules/community/lib/rules";
import { FeedList } from "@/modules/community/components/feed-list";
import { requireActiveUser } from "@/lib/authz";
import { isCommunityEnabled, livePollSchedule } from "@/modules/community/lib/config";
import { feedFor, followsFor } from "@/modules/community/lib/manage";

// The friends feed.
//
// 🚨 **Everything on this page was derived a moment ago from what the viewer
// may enter RIGHT NOW.** No feed table, no stored copy, no delivery on write
// (AD-68) — so a plan that lapsed between two page loads simply removes the
// activity, with no job to run and nothing to invalidate.
//
// 🚨 **A room the viewer cannot enter contributes nothing at all** — not the
// post, not the room's name, not the thread's title, not a gap in the order.
// A feed that leaked gated activity would turn a purchase into a broadcast and
// would be a second, cheaper access path into a paid room.
//
// ⚠️ DYNAMIC in the sense that matters: `node run.mjs smoke` renders it, but
// only for one account with no follows. The interesting states — a feed with
// items, and the same feed with a gated post that must not appear — are what
// `lib/community/feed-guard.test.ts` and the seeded render check cover.

export async function generateMetadata() {
  const t = await getTranslations("community");
  return { title: t("feedTitle") };
}

export default async function FeedPage() {
  if (!isCommunityEnabled()) notFound();

  const session = await requireActiveUser();
  const viewer = {
    memberId: session.user.id as string,
    role: session.user.role as string,
  };

  const [{ items, nextCursor }, { following }, t] = await Promise.all([
    feedFor(viewer),
    followsFor(viewer.memberId, 1),
    getTranslations("community"),
  ]);

  // Two empty states, and telling them apart is the whole value of the second
  // query: "you follow nobody" has an action behind it, "nothing new" does
  // not, and a member who saw the wrong one would go looking for a broken
  // feature. `followsFor(…, 1)` asks only whether there is at least one — no
  // count is derived here or anywhere else (FR-222).
  const followsNobody = following.length === 0;

  return (
    <>
      <PageHeader title={t("feedTitle")} description={t("feedSubtitle")} />

      {followsNobody ? (
        <EmptyState
          icon={Users}
          title={t("feedNoFollowsTitle")}
          description={t("feedNoFollowsDescription")}
        >
          <Button asChild>
            <Link href="/dashboard/community/people">{t("peopleLink")}</Link>
          </Button>
        </EmptyState>
      ) : (
        // ⚠️ **Mounted even when the feed is empty.** It used to render an
        // `<EmptyState>` INSTEAD of the list, so a member whose feed had
        // nothing in it yet mounted no live component and polled nothing — the
        // first thing their people ever posted could not arrive without a
        // reload, which is the state every new follower is in. The list owns
        // the empty state now, for the same reason `PostList` does.
        <FeedList
          memberId={viewer.memberId}
          /* Field by field, not a spread — see `loadMoreFeedAction()`: the
             author's media id must not travel to the browser beside the
             address that was minted from it. */
          initialItems={items.map((item) => ({
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
          }))}
          initialNextCursor={nextCursor}
          initialLiveCursor={
            items.length > 0
              ? cursorToken({ at: items[0].createdAt, id: items[0].postId })
              : liveCursorBeginning()
          }
          schedule={livePollSchedule()}
        />
      )}
    </>
  );
}
