// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// The friends feed, as a list that grows downwards and notices new things at
// the top.
//
// ── The live half uses the endpoint as a SIGNAL, not as rows ──────────────
// `LiveDiscussion` and `LiveConversation` splice arriving rows straight into
// their lists, because a post and a message carry everything their renderer
// needs. A feed item does not: it needs the ROOM it was written in and the
// THREAD it belongs to, and neither is a field on a post. Carrying them on the
// wire would mean a second answer shape for one scope — precisely the second
// grammar AD-70's one-currency rule exists to prevent.
//
// So this component polls the same endpoint with the same opaque cursor, and
// when the answer says something arrived it asks the router to refresh the
// route. The server then renders the new items WITH their context, through the
// one derivation, with access re-checked — which is also the honest behaviour
// for a feed: a list somebody is skimming does not need rows appearing under
// their thumb, it needs to be current when they look.
//
// ── What it deliberately does not do ──────────────────────────────────────
// No counts, anywhere (FR-222). No "3 new posts" badge — that is an aggregate
// over the follow graph wearing a friendly hat.
import * as React from "react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";

import { Rss } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { PostBody } from "@/modules/community/components/post-body";
import { Button } from "@/components/ui/button";
import { displayNameFor, type PollSchedule } from "@/modules/community/lib/rules";

import { useLiveScope } from "./use-live-scope";
import {
  loadMoreFeedAction,
  type FeedItemView,
} from "@/modules/community/pages/feed/actions";

/** One scope's answer, as the endpoint sends it. */
type ScopeAnswer =
  | { state: "unavailable" }
  | { state: "ok"; cursor: string | null; posts: unknown[] };

export function FeedList({
  memberId,
  initialItems,
  initialNextCursor,
  schedule,
  initialLiveCursor,
}: {
  memberId: string;
  initialItems: FeedItemView[];
  initialNextCursor: string | null;
  schedule: PollSchedule;
  /**
   * Where the live channel starts reading — minted on the SERVER, never here.
   * For a feed that rendered nothing this is `liveCursorBeginning()`, not
   * `null`: the endpoint reads a missing cursor as one it could not parse and
   * resynchronises past whatever arrived meanwhile, so an empty feed could
   * never be told about its first item.
   */
  initialLiveCursor: string;
}) {
  const t = useTranslations("community");
  const format = useFormatter();
  const router = useRouter();

  const [items, setItems] = useState(initialItems);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [pending, startLoading] = useTransition();

  // A page render replaces the list — otherwise a router refresh would leave
  // the stale rows sitting under the fresh ones.
  useEffect(() => {
    setItems(initialItems);
    setNextCursor(initialNextCursor);
  }, [initialItems, initialNextCursor]);

  // The polling loop is `useLiveScope` — shared with both discussion surfaces.
  // This file used to carry its own copy, which is how it kept two defects a
  // review had already fixed next door.
  //
  // The answer is used as a yes/no: the feed is a read-time join, so the
  // cheapest correct refresh is to let the route re-render rather than to merge
  // rows the server would derive differently.
  const seen = useRef(false);
  useLiveScope<unknown>({
    scope: { kind: "feed" },
    initialCursor: initialLiveCursor,
    schedule,
    live: true,
    onAnswer: (answer) => {
      // The first answer only establishes where "now" is — refreshing on it
      // would reload the page once for every mount.
      //
      // `stale` is the removal half: a feed carries no tombstones, so a post
      // that went away says so as one bit and the fresh render simply does not
      // contain it. Without it a member who deleted their account left their
      // words on an open feed until something else happened to arrive.
      if (seen.current && (answer.posts.length > 0 || answer.stale)) {
        router.refresh();
      }
      seen.current = true;
    },
  });

  const loadMore = () => {
    if (!nextCursor) return;
    startLoading(async () => {
      const more = await loadMoreFeedAction(nextCursor);
      setItems((current) => [...current, ...more.items]);
      setNextCursor(more.nextCursor);
    });
  };

  const placeholderLabel = t("memberPlaceholder");

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Rss}
        title={t("feedEmptyTitle")}
        description={t("feedEmptyDescription")}
      />
    );
  }

  return (
    <>
      <ol className="grid gap-4">
        {items.map((item) => {
          // Computed once per item so the picture and the link cannot disagree
          // about who this is — the fallback initial is drawn from the same
          // resolved name the link renders.
          const authorName = item.authorId
            ? displayNameFor({
                profileName: item.authorProfileName,
                accountName: item.authorAccountName,
                memberId: item.authorId,
                placeholderLabel,
              })
            : t("formerMember");
          // `[...name][0]`, never `slice(0, 1)` — an emoji or any astral
          // character is a surrogate PAIR, and slicing one in half renders as
          // `�`. Same reasoning as the profile card and the member page.
          const initial = [...authorName][0]?.toUpperCase() ?? "";

          return (
          <li key={item.postId} className="bg-card rounded-xl border p-4">
            <div className="text-muted-foreground mb-2 flex flex-wrap items-center gap-x-2 text-sm">
              {/* The picture, or the initial. Resolved on the SERVER through
                  `avatarUrlsFor()` — one `media` query for the whole page,
                  `mayAccess()` per row — so this component receives an address
                  or nothing and decides neither.

                  `alt=""` on purpose: the name is rendered right beside it, so
                  a screen reader announcing the picture too would say it twice.
                  `object-cover` rather than `AvatarImage`'s default, or a 3:4
                  portrait gets squashed into the circle. */}
              <Avatar className="size-6">
                {item.authorAvatarUrl && (
                  <AvatarImage src={item.authorAvatarUrl} alt="" className="object-cover" />
                )}
                <AvatarFallback className="text-[10px]">{initial}</AvatarFallback>
              </Avatar>

              {/* The author's name links to their profile — the same door
                  every post uses, and the only place a member meets a name. */}
              {item.authorId ? (
                <Link
                  href={`/dashboard/community/members/${encodeURIComponent(item.authorId)}`}
                  className="text-foreground font-medium hover:underline"
                >
                  {authorName}
                </Link>
              ) : (
                <span className="text-foreground font-medium">{authorName}</span>
              )}
              {/* The room's name is safe to show HERE and only here: this item
                  exists because the viewer may enter that room. A feed that
                  named a room somebody cannot enter would be the leak the
                  whole derivation exists to prevent. */}
              <span>{t("feedIn", { group: item.groupName })}</span>
              <time dateTime={item.createdAt}>
                {format.dateTime(new Date(item.createdAt), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
            </div>

            <Link
              href={`/dashboard/community/discussions/${encodeURIComponent(item.discussionId)}`}
              className="font-medium hover:underline"
            >
              {/* An empty title is a thread whose starter deleted their
                  account — `titleState()`'s marker. The neutral heading is the
                  same sentence the thread page shows. */}
              {item.discussionTitle === ""
                ? t("deletedDiscussionTitle")
                : item.discussionTitle}
            </Link>

            <div className="mt-2">
              {/* The one renderer of member-written text. */}
              <PostBody content={item.content} />
            </div>
          </li>
          );
        })}
      </ol>

      {nextCursor && (
        <div className="mt-6 flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={pending}>
            {t("feedMore")}
          </Button>
        </div>
      )}
    </>
  );
}
