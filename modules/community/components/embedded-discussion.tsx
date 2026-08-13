// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// **A discussion, on any page of this app.**
//
// The whole integration is two things: one entry in `lib/community/embeds.ts`
// naming a Subject Key and its access level, and this component on the page.
// Nothing else — no route, no table row, no admin surface, and nothing the
// host page has to guard on the discussion's behalf.
//
// ```tsx
// // app/dashboard/course/[unit]/page.tsx — after the page's own guard
// <EmbeddedDiscussion
//   subjectKey={`course:birth-prep:${unit.slug}`}
//   heading={t("discussionHeading")}
// />
// ```
//
// ── It breathes, and the host page does nothing about that either ─────────
// Once it is on the page, a post somebody else writes arrives by itself — the
// component hands `LiveDiscussion` the scope and the shipped poll schedule, and
// that is the whole of it. Nothing here is a prop the host page has to know
// about, and there is no second endpoint to wire up.
//
// ── The four things it refuses, in order ──────────────────────────────────
//
//   1. **The community is off** → `null`. No wrapper, no placeholder, no hint.
//      A lesson page must look as if the module never existed (AD-67, NFR-34):
//      a box saying "the community is not active here" tells a probing member
//      that a community EXISTS on this installation, which is the distinction
//      the off state is built to erase. The operator's diagnosis lives on
//      `/dashboard/community` and nowhere else.
//   2. **Nobody is signed in, or the account is blocked** → `null`.
//      `currentActiveUser()`, never `requireActiveUser()`: a redirect out of a
//      component would take the HOST page with it, and a public lesson page
//      that bounces to `/login` because of a discussion nobody can see is this
//      component deciding something that is not its to decide.
//   3. **The key is not declared** → `null`.
//   4. **It is declared and this member is not entitled** → `null`, *the same
//      `null`*. 3 and 4 are one refusal (`mayViewEmbed()` merges them once, in
//      the pure core), so nothing here can tell them apart and nothing here
//      can leak the difference. A member who could would be able to walk a
//      course's table of contents by trying keys.
//
// ── The heading is the host page's, never the key's ───────────────────────
// `heading` is a prop, in the reader's language, chosen by the page that knows
// what it is about. Deriving one from the Subject Key would render a slug —
// `course:birth-prep:unit-3` — into visible text, which is course structure
// disclosed to whoever was reading the page.
//
// ── One renderer, one composer, one action ────────────────────────────────
// The posts are drawn by 19.6's `PostList` and written by 19.6's
// `PostComposer` and `addPostAction`, imported from the community section
// rather than copied. That import points from `components/` into `app/`, which
// is the wrong direction on paper and the right one here: a second post
// renderer is a second rendering policy for the template's stored-XSS surface,
// and a second composer is a second write path to keep in step with the
// guards. `lib/community/render-safety.test.ts` scans both trees for exactly
// that reason.
import { getLocale, getTranslations } from "next-intl/server";
import { MessagesSquare } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { currentActiveUser } from "@/lib/authz";
import { isCommunityEnabled, livePollSchedule } from "@/modules/community/lib/config";
import {
  POSTS_PER_PAGE,
  embeddedDiscussionView,
  postImagePolicy,
  profileFor,
  type PostRow,
} from "@/modules/community/lib/manage";
import {
  canParticipate,
  cursorToken,
  liveCursorBeginning,
} from "@/modules/community/lib/rules";
import type { PostView } from "@/modules/community/pages/ui";

import { LiveDiscussion } from "./live-discussion";
import { Pager } from "./pager";
import { wirePost } from "../lib/wire";

/**
 * A row as the client reads it.
 *
 * Dates cross as ISO strings — a `Date` that has crossed JSON is a string
 * wearing a `Date`'s type, and this template converts on arrival rather than
 * pretending. The shape is the live endpoint's `wirePost()`, deliberately: the
 * first render and every poll after it must hand the list the same thing.
 */

/**
 * Where the live channel should start reading from: the newest row THIS render
 * delivered.
 *
 * Minted on the server so the client never constructs a cursor — AD-70's
 * contract — and so the first poll asks "what happened since the page was
 * drawn" rather than costing a round trip to find out where it is.
 */
function cursorFor(rows: PostRow[]): string {
  const newest = rows[rows.length - 1];
  // ⚠️ An empty view says "before everything", NOT "no cursor". The endpoint
  // reads a missing cursor as a token it cannot parse and resynchronises past
  // whatever arrived meanwhile — which used to swallow the first post ever
  // written into a declared embed. See `liveCursorBeginning()`.
  return newest
    ? cursorToken({ at: newest.createdAt, id: newest.id })
    : liveCursorBeginning();
}

export interface EmbeddedDiscussionProps {
  /** The declared Subject Key. Opaque, this app's own, never a row id. */
  subjectKey: string;
  /** What to call the discussion on this page. Translated by the host page. */
  heading?: string;
  /** One optional line under the heading — the host page's words too. */
  description?: string;
  /**
   * Which page of posts. Defaults to the END of the conversation, exactly as
   * the thread page does: posts run oldest-first, so page 1 of a long
   * discussion is the part nobody is talking about any more.
   */
  page?: number | "last";
  /**
   * Optional — a host page that owns a query parameter can hand in a link
   * builder and get 19.6's pager. Without it the embed shows the newest page
   * and says so; **it is optional because "declaration + component" has to
   * stay the whole integration.**
   */
  pageHref?: (page: number) => string;
}

export async function EmbeddedDiscussion({
  subjectKey,
  heading,
  description,
  page = "last",
  pageHref,
}: EmbeddedDiscussionProps) {
  // 1. Enablement, per request. Reading `lib/community/config.ts`, never the
  //    JSON — a malformed file counts as off, and this is the branch that
  //    honours it on a page the module does not own.
  if (!isCommunityEnabled()) return null;

  // 2. The session.
  const current = await currentActiveUser();
  if (current.state !== "active") return null;

  const memberId = current.session.user.id;
  const viewer = { memberId, role: current.session.user.role };

  // 3. + 4. Declaration and entitlement, as ONE answer.
  const view = await embeddedDiscussionView(subjectKey, viewer, page);
  if (!view) return null;

  const [profile, t] = await Promise.all([
    profileFor(memberId),
    getTranslations("community"),
  ]);

  // Cosmetics on top of the core refusal, never instead of it: the composer
  // shows one sentence naming what to do, and `addEmbeddedPost()` asks again on
  // every submit.
  const mayWrite = canParticipate(profile) === null;
  const pages = Math.max(1, Math.ceil(view.total / POSTS_PER_PAGE));

  // ⚠️ **Only the LAST page breathes.** Posts run oldest-first, so an arriving
  // one belongs at the end of the last page — appending it to page one of three
  // would put a post in front of the member that is not where they are looking,
  // in an order that is not the thread's. An embed with no `page` prop is on
  // the last page by definition (`page = "last"`), so this is only ever false
  // for a host page that wired up its own pager.
  const live = view.page >= pages;

  return (
    <section className="mt-10" aria-labelledby={heading ? "embedded-discussion" : undefined}>
      {heading && (
        <h2 id="embedded-discussion" className="text-lg font-medium">
          {heading}
        </h2>
      )}
      {description && (
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      )}

      <div className="mt-4">
        {/* ⚠️ **The empty state belongs to the LIST, not to this render.** It
            used to be drawn here and gated on `!live` — and a default embed is
            on the last page by definition, so that branch was unreachable and
            the epic's two strings shipped as dead translations. What a member
            actually met on a declared embed nobody had posted in was a heading
            over blank space with a composer under it. Drawing it here
            unconditionally would be the other error: it would stay on screen
            under the first arriving post. `PostList` knows the current list, so
            `PostList` owns it. Found by all three review layers, 2026-08-06. */}
        <LiveDiscussion
          // One mount per Subject Key. Without a key React reconciles by
          // POSITION, so a client-side navigation between two lesson pages
          // keeps the first embed's posts, cursor and stop-latch — and a cursor
          // from another scope windows this one against a foreign timestamp.
          key={subjectKey}
          empty={
            <EmptyState
              icon={MessagesSquare}
              title={t("embedEmptyTitle")}
              description={t("embedEmptyDescription")}
            />
          }
          scope={{ kind: "subject", subjectKey }}
          // `discussionId` is empty until somebody posts: a post cannot exist
          // without the row (20.1's creator runs in the same transaction), so
          // an empty one is only ever an empty discussion, where there is
          // nothing to edit or delete anyway.
          discussionId={view.discussionId ?? ""}
          memberId={memberId}
          viewerProfileName={profile?.displayName ?? null}
          viewerAccountName={(current.session.user.name as string | null) ?? null}
          initialPosts={view.rows.map(wirePost)}
          // The same policy the section's thread page hands its composer. An
          // embed is a place to write like any other, and a picture in a lesson's
          // discussion is the same thing as one in a room's.
          imagePolicy={postImagePolicy(await getLocale())}
          initialCursor={cursorFor(view.rows)}
          canParticipate={mayWrite}
          locked={view.locked}
          schedule={livePollSchedule()}
          live={live}
        />

        {view.rows.length > 0 && (
          <>
            {pages > 1 &&
              (pageHref ? (
                <Pager page={view.page} pages={pages} hrefFor={pageHref} />
              ) : (
                // Said rather than hidden: a member looking at the newest fifty
                // of two hundred posts is entitled to know that is what they
                // are looking at. A host page that wants the pager hands in
                // `pageHref`.
                <p className="text-muted-foreground mt-4 text-sm">
                  {t("embedShowingLatest", {
                    count: view.rows.length,
                    total: view.total,
                  })}
                </p>
              ))}
          </>
        )}
      </div>
    </section>
  );
}
