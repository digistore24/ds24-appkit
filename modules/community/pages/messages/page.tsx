// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { getTranslations, getFormatter } from "next-intl/server";
import { Mail } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pager } from "@/modules/community/components/pager";
import { requireDmActor } from "@/modules/community/lib/dm-actor";
import { CONVERSATIONS_PER_PAGE, listConversations } from "@/modules/community/lib/manage";
import { displayNameFor } from "@/modules/community/lib/rules";

// The inbox — every conversation this member is in, newest first.
//
// ⚠️ **The list is scoped in the QUERY, not on this page.**
// `listConversations()` takes the session's own member id and answers only
// about conversations they participate in; there is no filtering here that a
// refactor could drop. That is AD-59 as a shape rather than as a rule
// somebody has to remember.
//
// The check order is the module's contract: enablement first, before any
// session work, then the session. While the community is off this route
// answers the framework's not-found for everyone — `proxy.ts` rewrites
// `/dashboard/community/*` before the request arrives, and this branch is the
// defense in depth behind it.
//
// There is no operator fork and no diagnosis view here, unlike
// `/dashboard/community`: an operator looking at somebody's inbox is the one
// thing this module promises does not happen.

export async function generateMetadata() {
  const t = await getTranslations("community");
  return { title: t("messagesTitle") };
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  // Enablement, the session, and the impersonation carve-out in one call —
  // the seam every DM surface passes through (FR-209). An impersonated session
  // gets the same not-found a disabled surface gets.
  const { memberId } = await requireDmActor();

  const requested = (await searchParams).page;
  const page = Math.max(1, Number(requested) || 1);

  const [{ rows, total, page: current }, t, format] = await Promise.all([
    listConversations(memberId, page),
    getTranslations("community"),
    getFormatter(),
  ]);

  const pages = Math.max(1, Math.ceil(total / CONVERSATIONS_PER_PAGE));
  const placeholderLabel = t("memberPlaceholder");

  return (
    <>
      <PageHeader title={t("messagesTitle")} description={t("messagesSubtitle")} />

      {rows.length === 0 ? (
        // The state most members meet first, and the one that has to say where
        // a conversation comes from — there is no address book to point at.
        <EmptyState
          icon={Mail}
          title={t("messagesEmptyTitle")}
          description={t("messagesEmptyDescription")}
        />
      ) : (
        <ul className="grid gap-3">
          {rows.map((conversation) => (
            <li key={conversation.id}>
              <Card className="hover:border-primary/50 relative transition-colors">
                <CardContent className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {/* The whole card is the target, but the LINK is the
                          name — a card-wide click handler is invisible to a
                          keyboard and to a screen reader. */}
                      <Link
                        href={`/dashboard/community/messages/${encodeURIComponent(conversation.id)}`}
                        className="font-medium after:absolute after:inset-0 hover:underline"
                      >
                        {conversation.counterpartId
                          ? displayNameFor({
                              profileName: conversation.counterpartProfileName,
                              accountName: conversation.counterpartAccountName,
                              memberId: conversation.counterpartId,
                              placeholderLabel,
                            })
                          : t("formerMember")}
                      </Link>
                      {conversation.unread && (
                        <>
                          <span
                            aria-hidden
                            className="bg-primary size-2 shrink-0 rounded-full"
                          />
                          <span className="sr-only">{t("unread")}</span>
                        </>
                      )}
                    </div>
                    {/* Cut on the SERVER — `lastMessagePreview` arrives already
                        shortened, so the page's payload does not carry a whole
                        private message that CSS then hides. */}
                    <p className="text-muted-foreground truncate text-sm">
                      {conversation.lastMessagePreview}
                    </p>
                  </div>
                  <time
                    dateTime={conversation.lastMessageAt.toISOString()}
                    className="text-muted-foreground shrink-0 text-xs"
                  >
                    {format.dateTime(conversation.lastMessageAt, {
                      dateStyle: "medium",
                    })}
                  </time>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Pager
        page={current}
        pages={pages}
        hrefFor={(page) => `/dashboard/community/messages?page=${page}`}
        link={Link}
      />
    </>
  );
}
