// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { LiveConversation } from "@/modules/community/components/live-conversation";
import { Pager } from "@/modules/community/components/pager";
import { ConversationReadReceipt } from "@/modules/community/components/read-receipt";
import { requireActiveUser } from "@/lib/authz";
import { livePollSchedule } from "@/modules/community/lib/config";
import { requireDmActor } from "@/modules/community/lib/dm-actor";
import {
  MESSAGES_PER_PAGE,
  conversationHeaderFor,
  hasBlocked,
  listMessages,
  profileFor,
} from "@/modules/community/lib/manage";
import { BlockControl } from "../ui";
import { Callout } from "@/components/ui/callout";
import {
  canSendMessage,
  cursorToken,
  liveCursorBeginning,
  displayNameFor,
} from "@/modules/community/lib/rules";

// One private conversation.
//
// 🚨 **A conversation's door is being in it, and nothing else.** Both readers
// below take this session's own member id and answer `null` for a conversation
// this member does not participate in — the same `null` an id that names
// nothing gives, so trying ids tells a prober neither which conversations
// exist nor who is in them. There is no role that widens this: a moderator and
// the operator get the same not-found a stranger gets, which is FR-200 in the
// one place a reader would look for an exception.
//
// ⚠️ DYNAMIC route — `node run.mjs smoke` skips it. Call it up by hand with a
// real conversation, then read `node run.mjs errors`.

export async function generateMetadata() {
  const t = await getTranslations("community");
  return { title: t("messagesTitle") };
}

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  // The seam: enablement, the session, and the impersonation carve-out
  // (FR-209). The session itself is still needed for the account name an
  // optimistic message is drawn with.
  const { memberId } = await requireDmActor();
  const session = await requireActiveUser();
  const { conversationId } = await params;

  // ⚠️ **No `?page=` means the END of the conversation**, not the beginning —
  // messages run oldest-first, and the receipt below acknowledges the newest
  // message THIS PAGE delivered, so opening a long conversation normally could
  // otherwise never clear its unread dot.
  const requested = (await searchParams).page;
  const page =
    requested === undefined
      ? ("last" as const)
      : Math.max(1, Number(requested) || 1);

  const [header, listed, profile, t] = await Promise.all([
    conversationHeaderFor(memberId, conversationId),
    listMessages(memberId, conversationId, page),
    profileFor(memberId),
    getTranslations("community"),
  ]);

  if (!header || !listed) notFound();

  // ⚠️ **One direction, and it is the viewer's own.** `hasBlocked()` answers
  // "have I blocked them"; there is no reader in the module for the other
  // direction, so this page cannot accidentally become the place a member
  // learns they were blocked — which is exactly what FR-201's neutral refusal
  // exists to prevent.
  const blocked = header.counterpartId
    ? await hasBlocked(memberId, header.counterpartId)
    : false;

  const { rows, total, page: current } = listed;
  const pages = Math.max(1, Math.ceil(total / MESSAGES_PER_PAGE));
  const name = header.counterpartId
    ? displayNameFor({
        profileName: header.counterpartProfileName,
        accountName: header.counterpartAccountName,
        memberId: header.counterpartId,
        placeholderLabel: t("memberPlaceholder"),
      })
    : t("formerMember");

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
        <Link href="/dashboard/community/messages">
          <ChevronLeft aria-hidden />
          {t("messagesBack")}
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title={name} description={t("messagePrivacyNote")} />
        {/* Not shown once the other account is gone: there is nobody left to
            block, and a control that writes a row against a deleted member
            would be a row the cascade removes on the way in. */}
        {header.counterpartId && (
          <BlockControl
            memberId={header.counterpartId}
            name={name}
            blocked={blocked}
          />
        )}
      </div>

      {blocked && (
        // Said plainly, and only to the person who did it. The other side sees
        // the same neutral refusal every undeliverable message gets.
        <Callout variant="info" title={t("block")} className="mb-4">
          <p>{t("blockedNote")}</p>
        </Callout>
      )}

      {/* The acknowledgment carries the newest message THIS PAGE delivered,
          never the conversation's newest — rendering page 1 of 3 must not mark
          page 3 read. The server clamps it before writing anything. */}
      <ConversationReadReceipt
        conversationId={conversationId}
        newestMessageId={rows.length > 0 ? rows[rows.length - 1].id : null}
      />

      {/* Dates and the deletion state cross into a client component, so they
          travel as ISO strings: a `Date` that has crossed JSON is a string
          wearing a Date's type, and the house rule is to convert on arrival
          rather than to pretend. `live` is false on any page but the last — a
          message arriving at the end does not belong on page one of three. */}
      <LiveConversation
        // One mount per conversation. Without a key React reconciles by POSITION,
        // and the inbox links straight from one conversation to the next — so
        // the second would render with the first's messages and poll with the
        // first's cursor.
        key={conversationId}
        conversationId={conversationId}
        memberId={memberId}
        viewerProfileName={profile?.displayName ?? null}
        viewerAccountName={(session.user.name as string | null) ?? null}
        initialMessages={rows.map((message) => ({
          id: message.id,
          authorId: message.authorId,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
          deletedAt: message.deletedAt?.toISOString() ?? null,
          deletedBy: message.deletedBy,
          authorProfileName: message.authorProfileName,
          authorAccountName: message.authorAccountName,
        }))}
        initialCursor={
          rows.length > 0
            ? cursorToken({
                at: rows[rows.length - 1].createdAt,
                id: rows[rows.length - 1].id,
              })
            : liveCursorBeginning()
        }
        canParticipate={canSendMessage(profile) === null}
        schedule={livePollSchedule()}
        live={current >= pages}
      />

      <Pager
        page={current}
        pages={pages}
        hrefFor={(page) =>
          `/dashboard/community/messages/${encodeURIComponent(conversationId)}?page=${page}`
        }
        link={Link}
      />
    </>
  );
}
