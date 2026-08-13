// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireActiveUser } from "@/lib/authz";
import { isCommunityEnabled, livePollSchedule } from "@/modules/community/lib/config";
import {
  POSTS_PER_PAGE,
  discussionFor,
  moderationAuthority,
  postImagePolicy,
  postsFor,
  profileFor,
} from "@/modules/community/lib/manage";
import { mayModerate } from "@/modules/community/lib/rules";
import { LockDiscussionButton } from "../../moderation/ui";
import {
  canPost,
  cursorToken,
  liveCursorBeginning,
  titleState,
} from "@/modules/community/lib/rules";

import { LiveDiscussion } from "@/modules/community/components/live-discussion";
import { Pager } from "@/modules/community/components/pager";
import { ReadReceipt } from "@/modules/community/components/read-receipt";

// One thread.
//
// **A discussion's door is its group's door.** `discussionFor()` loads the
// thread, loads its room, and answers `null` unless this member may be in that
// room right now — so an unknown id, an archived room and a room behind a plan
// they do not hold all produce the same not-found, exactly as on the group
// page. The verdict is NOT cached between this render and the composer's
// action: that action re-derives it on every submit, because a refund between
// the two has to refuse the write.

// "Discussion" — the kind of page, not this discussion's title, and here that is
// the safer answer twice over: `discussionFor()` is viewer-dependent, and a
// title can be scrubbed along with its author's account. A browser tab is a poor
// place to have to get that right a second time.
export async function generateMetadata() {
  const t = await getTranslations("community");
  return { title: t("discussionTitle") };
}

export default async function DiscussionPage({
  params,
  searchParams,
}: {
  params: Promise<{ discussionId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  if (!isCommunityEnabled()) notFound();

  const session = await requireActiveUser();
  const { discussionId } = await params;
  const memberId = session.user.id as string;

  const found = await discussionFor(discussionId, {
    memberId,
    role: session.user.role as string,
  });
  if (!found) notFound();

  // ⚠️ **No `?page=` means the END of the thread, not the beginning.** Posts
  // are ordered oldest-first, so page 1 of a sixty-post thread is the first
  // fifty — and since the receipt below acknowledges the newest post THIS PAGE
  // delivered, opening such a thread normally could never clear its unread
  // dot. The member had to notice the pager and walk to the last page, and
  // nothing on screen suggested they should. An explicit `?page=` still wins,
  // so the pager itself is unchanged.
  const requested = (await searchParams).page;
  const page =
    requested === undefined
      ? ("last" as const)
      : Math.max(1, Number(requested) || 1);

  const [{ rows, total, page: current }, profile, authority, t] =
    await Promise.all([
      // The viewer travels in because a post's pictures are resolved with the
      // page: `postImagesFor()` asks `mayAccess()` before it mints an address,
      // in the same function, so no renderer can do the second half without the
      // first.
      postsFor(found.discussion.id, page, {
        memberId,
        role: session.user.role as string,
      }),
      profileFor(memberId),
      // The AD-63 re-read, for the CONTROLS. Whether they appear is cosmetics:
      // every act re-reads this again on submit, so a stale render cannot
      // grant anything.
      moderationAuthority(memberId),
      getTranslations("community"),
    ]);

  const canModerate =
    authority !== null &&
    mayModerate(authority, found.group.id, authority.duties) === null;

  const denial = canPost(profile, found.discussion);
  const pages = Math.max(1, Math.ceil(total / POSTS_PER_PAGE));

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
        <Link
          href={`/dashboard/community/groups/${encodeURIComponent(found.group.id)}`}
        >
          <ChevronLeft aria-hidden />
          {found.group.name}
        </Link>
      </Button>

      {/* A scrubbed title is a former member's words removed, not an empty
          heading — `titleState()` reads the marker, the sentence is chosen
          here, in the reader's language. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title={
            titleState(found.discussion) === "scrubbed"
              ? t("deletedDiscussionTitle")
              : found.discussion.title
          }
        />
        {canModerate && (
          <LockDiscussionButton
            discussionId={found.discussion.id}
            locked={found.discussion.lockedAt !== null}
          />
        )}
      </div>

      {/* The acknowledgment carries the newest post THIS PAGE delivered, never
          the thread's newest — rendering page 1 of 3 must not mark page 3
          read. The server clamps it to a post that really is in this thread
          before writing anything. */}
      <ReadReceipt
        discussionId={found.discussion.id}
        newestPostId={rows.length > 0 ? rows[rows.length - 1].id : null}
      />

      {/* Dates and the deletion state cross into a client component, so they
          travel as ISO strings: a `Date` that has crossed JSON is a string
          wearing a Date's type, and the house rule is to convert on arrival
          rather than to pretend.

          ⚠️ **The same component the embed renders**, with a different scope.
          A second copy would be a second polling policy and a second
          optimistic-send story — see its header. `live` is false on any page
          but the last, because a post arriving at the end of the thread does
          not belong on page one of three. */}
      <LiveDiscussion
        // One mount per discussion. Without a key React reconciles by POSITION,
        // so navigating between two threads keeps the first one's posts,
        // cursor and stop-latch — and a cursor from another scope windows this
        // one against a foreign timestamp.
        key={found.discussion.id}
        scope={{ kind: "discussion", discussionId: found.discussion.id }}
        discussionId={found.discussion.id}
        memberId={memberId}
        viewerProfileName={profile?.displayName ?? null}
        viewerAccountName={(session.user.name as string | null) ?? null}
        initialPosts={rows.map((post) => ({
          id: post.id,
          authorId: post.authorId,
          content: post.content,
          createdAt: post.createdAt.toISOString(),
          editedAt: post.editedAt?.toISOString() ?? null,
          deletedAt: post.deletedAt?.toISOString() ?? null,
          deletedBy: post.deletedBy,
          authorProfileName: post.authorProfileName,
          authorAccountName: post.authorAccountName,
          // Already resolved and already authorised by `postsFor()` — the
          // addresses were minted beside their `mayAccess()` check, and a post
          // that is not visible arrives with an empty list.
          images: post.images,
        }))}
        initialCursor={
          rows.length > 0
            ? cursorToken({
                at: rows[rows.length - 1].createdAt,
                id: rows[rows.length - 1].id,
              })
            : liveCursorBeginning()
        }
        canParticipate={denial !== "communityProfileIncomplete"}
        locked={found.discussion.lockedAt !== null}
        canModerate={canModerate}
        imagePolicy={postImagePolicy(await getLocale())}
        schedule={livePollSchedule()}
        live={current >= pages}
        lastPageHref={`/dashboard/community/discussions/${encodeURIComponent(found.discussion.id)}?page=${pages}`}
      />

      <Pager
        page={current}
        pages={pages}
        hrefFor={(page) =>
          `/dashboard/community/discussions/${encodeURIComponent(found.discussion.id)}?page=${page}`
        }
        link={Link}
      />
    </>
  );
}
