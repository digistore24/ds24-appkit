// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations, getFormatter } from "next-intl/server";
import { ChevronLeft, MessagesSquare } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireActiveUser } from "@/lib/authz";
import { isCommunityEnabled } from "@/modules/community/lib/config";
import {
  DISCUSSIONS_PER_PAGE,
  discussionsFor,
  groupFor,
  postImagePolicy,
  profileFor,
  unreadByDiscussion,
} from "@/modules/community/lib/manage";
import {
  canStartDiscussion,
  displayNameFor,
  titleState,
} from "@/modules/community/lib/rules";

import { Pager } from "@/modules/community/components/pager";
import { StartDiscussionDialog } from "../../ui";

// One room, and the threads in it.
//
// ⚠️ **Three different situations answer with the same not-found, and that is
// the point.** There is no such room; the room is archived; the room exists and
// this member may not enter it — all three render exactly the same page.
// Telling them apart would let anybody with a signed-in account learn which
// rooms exist on this installation by trying ids, and the name of a plan-gated
// room is close enough to purchase information about the people in it to be
// worth not confirming. `groupFor()` collapses the three into one `null` in
// the shell rather than leaving the distinction here to be lost by accident.
//
// The access decision is re-derived HERE, per request, from the plans the
// member holds right now — never carried over from the list page that linked
// here, and never trusted by the composer's action, which asks again on every
// submit. A refund between the two closes the door.

// "Group" — the kind of page, not this group's name. `groupFor()` is
// viewer-dependent, so putting the real name in the tab would mean a second,
// access-checked load per request purely to fill a tab. See the note on
// `modules/community/pages/page.tsx`.
export async function generateMetadata() {
  const t = await getTranslations("community");
  return { title: t("groupTitle") };
}

export default async function CommunityGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  if (!isCommunityEnabled()) notFound();

  const session = await requireActiveUser();
  const { groupId } = await params;
  const memberId = session.user.id;

  const group = await groupFor(groupId, {
    memberId,
    role: session.user.role,
  });
  if (!group) notFound();

  const page = Math.max(1, Number((await searchParams).page ?? "1") || 1);
  const [{ rows, total }, profile, t, format] = await Promise.all([
    discussionsFor(group.id, page),
    profileFor(memberId),
    getTranslations("community"),
    getFormatter(),
  ]);

  // Cosmetics on top of the core refusal, never instead of it: the dialog is
  // replaced by one sentence naming what to do, and the action refuses again
  // regardless (`canStartDiscussion` inside `startDiscussion`).
  const mayWrite = canStartDiscussion(profile) === null;

  // Which of the threads on THIS page have moved since the member last read
  // them. Scoped to the rendered page, so the cost is the page size rather
  // than the number of threads that exist — and the ids are already
  // access-checked (they came out of a group this viewer may enter), so the
  // accessible set is not derived a second time.
  const unread = await unreadByDiscussion(
    memberId,
    rows.map((row) => row.id),
  );
  const pages = Math.max(1, Math.ceil(total / DISCUSSIONS_PER_PAGE));
  const placeholderLabel = t("memberPlaceholder");

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
        <Link href="/dashboard/community">
          <ChevronLeft aria-hidden />
          {t("backToGroups")}
        </Link>
      </Button>

      <PageHeader title={group.name} description={group.description ?? undefined}>
        <StartDiscussionDialog
          groupId={group.id}
          canParticipate={mayWrite}
          imagePolicy={postImagePolicy(await getLocale())}
        />
      </PageHeader>

      {rows.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title={t("groupEmptyTitle")}
          description={t("groupEmptyDescription")}
        />
      ) : (
        <ul className="grid gap-2">
          {rows.map((discussion) => (
            <li key={discussion.id} className="bg-card relative rounded-xl border p-4">
              <h2 className="flex items-center gap-2 font-medium">
                <Link
                  href={`/dashboard/community/discussions/${encodeURIComponent(discussion.id)}`}
                  className="after:absolute after:inset-0 hover:underline"
                >
                  {/* An account deletion scrubs the title — the starter's own
                      words go with them. The empty string in the row is the
                      marker; the sentence is chosen here, in the reader's
                      language, exactly as `contentState()` works for a post. */}
                  {titleState(discussion) === "scrubbed"
                    ? t("deletedDiscussionTitle")
                    : discussion.title}
                </Link>
                {unread.has(discussion.id) && (
                  <>
                    <span
                      aria-hidden
                      className="bg-primary size-2 shrink-0 rounded-full"
                    />
                    <span className="sr-only">{t("unread")}</span>
                  </>
                )}
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {/* ⚠️ A starter whose account is gone is a FORMER member, not
                    an anonymous one. `createdBy` is NULL after the deletion,
                    and seeding `displayNameFor()` with the discussion id
                    instead produced a stable, name-shaped identity ("Member
                    4f2a") for somebody who no longer exists — while `PostList`
                    said "former member" about the same person two lines down.
                    One surface inventing a person the other says is gone. */}
                {t("startedBy", {
                  name:
                    discussion.createdBy === null
                      ? t("formerMember")
                      : displayNameFor({
                          profileName: discussion.starterProfileName,
                          accountName: discussion.starterAccountName,
                          memberId: discussion.createdBy,
                          placeholderLabel,
                        }),
                })}{" "}
                ·{" "}
                {format.dateTime(discussion.lastActivityAt, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Pager
        page={page}
        pages={pages}
        hrefFor={(target) =>
          `/dashboard/community/groups/${encodeURIComponent(group.id)}?page=${target}`
        }
        link={Link}
      />
    </>
  );
}
