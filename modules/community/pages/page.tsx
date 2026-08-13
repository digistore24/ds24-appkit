// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Flag, Mail, MessagesSquare, Rss, ScrollText, Users } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireActiveUser } from "@/lib/authz";
import { isOwner } from "@/lib/roles";
import {
  communityConfigProblems,
  communityOffReason,
} from "@/modules/community/lib/config";
import {
  groupsFor,
  moderationAuthority,
  unreadByGroup,
} from "@/modules/community/lib/manage";
import { hasUnreadMessages } from "@/modules/community/lib/dm-presence";
import { mayModerate } from "@/modules/community/lib/rules";

// The community section.
//
// Unlike `/dashboard/chat`, this page does NOT always render — disabled means
// the framework's not-found, for everyone, per request (AD-67). The chat's
// reasoning ("smoke reads a 5xx as broken") does not bite: a 404 is an
// answered page, and the smoke script asserts this exact 404 against a
// pre-module baseline, so "off looks like never-existed" is measured, not
// hoped. The check order is the story's contract:
//
//   disabled  → notFound() BEFORE any session work. No operator preview —
//               groups are configured after switching on, by decision. In a
//               normally wired app this branch never renders: `proxy.ts`
//               rewrites a disabled community to an unmatched path first, so
//               the answer is the SAME document a never-existed route sends
//               (the dashboard-layout-wrapped not-found this branch would
//               produce is distinguishable — see the proxy comment). It stays
//               as defense in depth: hiding is never guarding, and a proxy
//               matcher edit must not open this page.
//   broken    → session, then the role fork: the OPERATOR reads the diagnosis
//               (this is the only surface in the module where an off-reason
//               becomes a sentence); everyone else gets notFound().
//   on        → the section shell. Groups and discussions arrive with
//               stories 19.5/19.6; until then an EmptyState says where the
//               rooms come from.

// The browser tab. This page IS the section, so `title` is right here — the two
// pages under it get their own, because four routes sharing one tab is how a
// member with three rooms open loses track of which is which.
//
// ⚠️ The `app/` wrapper has to re-export it or the route never sees it; that
// omission is what 2026-08-12 reported for this page and the two below it, and
// `modules/boundary.test.ts` §1b has refused it since the same day.
export async function generateMetadata() {
  const t = await getTranslations("community");
  return { title: t("title") };
}

export default async function CommunityPage() {
  if (communityOffReason() === "disabledInConfig") {
    notFound();
  }

  const session = await requireActiveUser();
  const t = await getTranslations("community");

  if (communityOffReason() === "brokenConfig") {
    if (!isOwner(session.user.role)) {
      notFound();
    }
    return (
      <>
        <PageHeader title={t("title")} />
        <Callout variant="warning" title={t("brokenTitle")}>
          <p>{t("brokenIntro")}</p>
          <ul className="mt-2 list-disc pl-5">
            {communityConfigProblems().map((problem) => (
              <li key={problem}>
                <code>{problem}</code>
              </li>
            ))}
          </ul>
        </Callout>
      </>
    );
  }

  // The doors this member may open, derived at render time from their role and
  // the plans they hold RIGHT NOW (AD-60) — no membership row exists to be out
  // of date, so a refund closes a door with nothing to reconcile.
  //
  // ⚠️ **Rooms they may not enter are ABSENT, not locked.** No "you need plan
  // X to join" teaser, no greyed-out card, no count of what they are missing:
  // the existence of a room called "Diabetes-Coaching Premium" is close enough
  // to purchase information about the people in it to be worth not
  // broadcasting, and it is the same decision the no-roster rule rests on.
  // Selling the plan is `/plans`'s job.
  //
  // ⚠️ And no member counts on these cards, ever. `db/schema-community.ts`
  // carries the argument; this is the surface where the idea arrives.
  const groups = await groupsFor({
    memberId: session.user.id,
    role: session.user.role,
  });

  // Which rooms hold something new. Existence per room, never a count: a
  // number here would start describing how busy a paid room is to somebody
  // who has not bought it, which is the roster rule arriving from a new angle.
  const unread = await unreadByGroup(
    session.user.id,
    groups.map((group) => group.id),
  );

  // Is anything waiting in their inbox? Existence, never a count — the same
  // ruling the room cards get, for the same reason: a number is an aggregate
  // on a page every member opens, and a dot is what the question deserves.
  const hasMessages = await hasUnreadMessages(session);

  // The moderation entry, for whoever the DATABASE says may moderate — never
  // the session's role. Cosmetics either way: the page re-reads it and answers
  // not-found to anybody else.
  const authority = await moderationAuthority(session.user.id);
  const canModerate =
    authority !== null && mayModerate(authority, null, authority.duties) === null;

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />

      {/* The way into the private half. It is a link on this page rather than
          a second entry in `NAVIGATION`: the inbox lives under the community's
          own `featureKey`, so an app with the module off shows no trace of it
          and there is no second flag to answer the "switched on but broken"
          question with. */}
      <div className="mb-6 flex flex-wrap gap-2">
        {canModerate && (
          <>
            <Button variant="outline" asChild>
              <Link href="/dashboard/community/reports">
                <Flag aria-hidden />
                {t("reportsLink")}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/community/moderation">
                <ScrollText aria-hidden />
                {t("moderationLink")}
              </Link>
            </Button>
          </>
        )}
        <Button variant="outline" asChild>
          <Link href="/dashboard/community/feed">
            <Rss aria-hidden />
            {t("feedLink")}
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/dashboard/community/people">
            <Users aria-hidden />
            {t("peopleLink")}
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/dashboard/community/messages">
            <Mail aria-hidden />
            {t("messagesLink")}
            {hasMessages && (
              <>
                <span
                  aria-hidden
                  className="bg-primary size-2 shrink-0 rounded-full"
                />
                <span className="sr-only">{t("unread")}</span>
              </>
            )}
          </Link>
        </Button>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {groups.map((group) => (
            <Card
              key={group.id}
              className="hover:border-primary/50 relative transition-colors"
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {/* The whole card is the target, but the LINK is the title —
                      a card-wide click handler is invisible to a keyboard and
                      to a screen reader. `after:absolute` stretches the hit
                      area without taking the link out of the tab order. */}
                  <Link
                    href={`/dashboard/community/groups/${encodeURIComponent(group.id)}`}
                    className="after:absolute after:inset-0 hover:underline"
                  >
                    {group.name}
                  </Link>
                  {unread.has(group.id) && (
                    <>
                      <span
                        aria-hidden
                        className="bg-primary size-2 shrink-0 rounded-full"
                      />
                      <span className="sr-only">{t("unread")}</span>
                    </>
                  )}
                </CardTitle>
              </CardHeader>
              {group.description && (
                <CardContent className="text-muted-foreground text-sm">
                  {group.description}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
