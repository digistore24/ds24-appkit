// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// **The discussion surface that breathes — one implementation, both homes.**
//
// The community section's thread page and 20.1's embed render THIS, with a
// different scope. That is the "one `ChatWindow`, two places" doctrine applied
// to the second thing in this template that has two places: a second copy would
// be a second polling policy, a second optimistic-send story and a second place
// to get the refused-scope behaviour subtly wrong.
//
// ── What it owns, and what it deliberately does not ───────────────────────
// It owns the list of posts after the first render, the cursor, and the timer.
// It does NOT own how a post is drawn (`PostList` → `post-body.tsx`, the one
// renderer) and it does not own any decision: every gate this file appears to
// apply is cosmetics on top of a refusal the server makes again on every
// request. `stopped` below hides a composer; `addPostAction` refuses anyway.
//
// ── The four behaviours worth knowing before changing anything ────────────
//
// 1. **Arriving rows are UPSERTS by id, never appends.** AD-70: a deletion
//    since the cursor rides the answer as row-state rather than by omission, so
//    a post that arrives for the second time is that post CHANGING — a
//    tombstone replacing words somebody is in the middle of reading. Appending
//    would render it twice, once in each state.
//
// 2. **The own send is optimistic, and a failure keeps the text** (NFR-37).
//    The member's post appears the moment they press the button, carrying a
//    placeholder id; when the server answers it takes on the real id, so the
//    poll that delivers it a second later upserts rather than duplicates. When
//    the server REFUSES, the placeholder goes and what they wrote stays in the
//    composer — the composer is not a `<form action={…}>` for exactly that
//    reason (see `useFormSubmit` in the section's `ui.tsx`).
//
// 3. **A refused scope stops the timer and says so ONCE.** A refund landing
//    mid-view, or a declaration withdrawn: the answer is one neutral state
//    (the server cannot tell the reasons apart either — 20.1's rule), and the
//    client reacts by stopping, rendering one sentence, and touching nothing
//    the member was composing. FR-197 names the anti-pattern: it does not error
//    repeatedly, and it does not destroy text they were writing.
//
// 4. **The interval comes from `pollDelayMs()` in the pure core**, and the tab's
//    visibility is its only input here. That function is where SM-16's
//    counter-metric is measured (`rules.test.ts` counts requests over a
//    simulated window with the shipped defaults) — this hook is a thin consumer
//    of it, and it has to stay thin for that measurement to mean anything.
import * as React from "react";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Callout } from "@/components/ui/callout";
import {
  mergeRows,
  type PollSchedule,
  type PostImagePolicy,
} from "@/modules/community/lib/rules";

import { useLiveScope } from "./use-live-scope";
import {
  PostComposer,
  PostList,
  type PostView,
} from "@/modules/community/pages/ui";

/** What the client subscribes to. Mirrors `LiveScope` in `lib/community/manage.ts`. */
export type LiveScope =
  | { kind: "discussion"; discussionId: string }
  | { kind: "subject"; subjectKey: string };

/** One scope's answer, as the endpoint sends it. */
type ScopeAnswer =
  | { state: "unavailable" }
  | { state: "ok"; cursor: string | null; locked: boolean; posts: PostView[] };

/**
 * The id an optimistic post carries until the server names the real one.
 *
 * One constant rather than a counter: the send button is disabled while a
 * submit is in flight, so there is never more than one.
 */
const PENDING_ID = "__pending__";

export interface LiveDiscussionProps {
  scope: LiveScope;
  /**
   * The row id, for the edit and delete forms. Empty when no row exists yet —
   * an embed nobody has posted in — which is fine, because there is then
   * nothing to edit or delete.
   */
  discussionId: string;
  memberId: string;
  /** The viewer's own name fields, so an optimistic post is named like a real one. */
  viewerProfileName: string | null;
  viewerAccountName: string | null;
  initialPosts: PostView[];
  initialCursor: string | null;
  canParticipate: boolean;
  locked: boolean;
  /**
   * What the composer's picture fields may offer.
   *
   * Assembled on the server (`postImagePolicy()`) and passed straight through —
   * this component decides nothing about it, exactly as it decides nothing about
   * the poll schedule. `max: 0` means the fields are not rendered at all.
   */
  imagePolicy: PostImagePolicy;
  /** May the viewer moderate this room? Cosmetics — see `PostList`. */
  canModerate?: boolean;
  schedule: PollSchedule;
  /**
   * Whether this view should breathe at all.
   *
   * ⚠️ **False on any page of a thread but the last**, and that is not a
   * performance choice. Posts run oldest-first, so a new one belongs at the end
   * of the LAST page — appending it to page one of three would show the member
   * a post that is not where they are looking, in an order that is not the
   * thread's.
   */
  live: boolean;
  /**
   * Where the last page of this thread lives, when the host page knows.
   *
   * Only consulted when `live` is false — i.e. the member is reading an older
   * page — and only after their own post was accepted. A host page that has a
   * pager already computes this; one without a pager is always `live`, so it
   * never needs it.
   */
  lastPageHref?: string;
  /**
   * What to draw when the list is empty.
   *
   * Handed in by the host so the words stay the host page's, and consumed by
   * `PostList` — the one place that knows whether the list is empty AFTER the
   * poll has run, which a server render cannot.
   */
  empty?: React.ReactNode;
}

export function LiveDiscussion({
  scope,
  discussionId,
  memberId,
  viewerProfileName,
  viewerAccountName,
  initialPosts,
  initialCursor,
  canParticipate,
  locked,
  imagePolicy,
  canModerate = false,
  schedule,
  live,
  lastPageHref,
  empty,
}: LiveDiscussionProps) {
  const t = useTranslations("community");
  const router = useRouter();
  const [posts, setPosts] = useState<PostView[]>(initialPosts);
  const [locking, setLocking] = useState(locked);

  // The cursor and the scope live in refs as well as in props: the polling loop
  // reschedules itself, and a loop that closed over the first render's cursor
  // would ask the same question for ever.
  // The polling loop is `useLiveScope` — shared with the conversation surface
  // and the feed. It used to live here, and the two copies made of it kept the
  // defects this one had already been cleared of.
  const { stopped, poll } = useLiveScope<PostView>({
    scope,
    initialCursor,
    schedule,
    live,
    onAnswer: (answer) => {
      setLocking(answer.locked);
      if (answer.posts.length > 0) {
        setPosts((current) => mergeRows(current, answer.posts));
      }
    },
  });

  /** The member pressed send. Show it now; the server has not answered yet. */
  const onSending = useCallback(
    (content: string) => {
      if (!live) return;
      setPosts((current) =>
        mergeRows(current, [
          {
            id: PENDING_ID,
            authorId: memberId,
            content,
            createdAt: new Date().toISOString(),
            editedAt: null,
            deletedAt: null,
            deletedBy: null,
            // The member's own post, a moment old and not yet on the server.
            // Nothing could have reported it yet.
            hiddenAt: null,
            authorProfileName: viewerProfileName,
            authorAccountName: viewerAccountName,
            // ⚠️ **Empty, and it stays empty until the poll answers.** The
            // pictures are in the browser's file inputs, not on a server that has
            // minted an address for them — and an optimistic copy that guessed
            // one would be a `<img>` pointing at nothing. `onSent()` gives this
            // row the real id and polls, and the answer that comes back carries
            // the pictures, upserting by id (AD-70). What the member sees is
            // their words immediately and their pictures a moment later, which is
            // the honest order.
            images: [],
          },
        ]),
      );
    },
    [live, memberId, viewerProfileName, viewerAccountName],
  );

  /** The server answered. Give the post its real id, or take it back. */
  const onSent = useCallback(
    (postId: string | null) => {
      // ⚠️ **A member's own post is not somebody else's.** `live` is false on
      // any page of a thread but the last, and the reason is sound for
      // ARRIVING posts: appending one to page 1 of 3 puts a post in front of
      // somebody where it does not belong. It was never a reason to answer
      // their OWN send with nothing at all, which is what AC 5 asks about —
      // they pressed send, the server accepted, and the screen did not move.
      // Their post is at the end of the last page, so that is where they go.
      if (!live) {
        if (postId && lastPageHref) router.push(lastPageHref);
        return;
      }
      setPosts((current) => {
        const without = current.filter((post) => post.id !== PENDING_ID);
        if (!postId) return without;
        const pending = current.find((post) => post.id === PENDING_ID);
        if (!pending) return without;
        // The real id, so the poll that delivers this same post a moment later
        // upserts it instead of showing it twice.
        return mergeRows(without, [{ ...pending, id: postId }]);
      });
      void poll();
    },
    [live, poll, lastPageHref, router],
  );

  return (
    <>
      <PostList
        discussionId={discussionId}
        memberId={memberId}
        posts={posts}
        canModerate={canModerate}
        onChanged={live ? poll : undefined}
        empty={empty}
      />

      {stopped && (
        // ⚠️ One sentence, once, and it names no reason — the server did not
        // send one and could not have: "not entitled" and "no such declaration"
        // are one state by design (20.1). What the member gets is the true and
        // sufficient fact that this view has stopped updating.
        <Callout variant="info" title={t("liveStoppedTitle")} className="mt-6">
          <p>{t("liveStoppedBody")}</p>
        </Callout>
      )}

      <div className="mt-6">
        {/* ⚠️ **`stopped` deliberately changes NOTHING about the composer**, and
            it took a rendered probe to see why. Passing `canParticipate={… &&
            !stopped}` here looked tidy and did two forbidden things at once: it
            unmounted the textarea, destroying whatever the member was in the
            middle of writing — the exact anti-pattern FR-197 names — and it
            replaced it with "choose a name first", which is a sentence about a
            profile, said to somebody whose profile is fine.

            So the composer stays exactly as it was, with their words in it. The
            callout above is the one statement they get; if they press send, the
            server refuses with its own sentence, which is an answer to an
            action rather than an error repeating itself. */}
        <PostComposer
          // Exactly one of the two, spread rather than passed as a pair of
          // ternaries: the composer's props are a discriminated union, so
          // "the other one is `undefined`" is not the same statement as "the
          // other one is absent", and only the second one type-checks.
          {...(scope.kind === "discussion"
            ? { discussionId: scope.discussionId }
            : { subjectKey: scope.subjectKey })}
          canParticipate={canParticipate}
          locked={locking}
          imagePolicy={imagePolicy}
          onSending={onSending}
          onSent={onSent}
        />
      </div>
    </>
  );
}
