// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent } from "@/components/ui/card";
import { PostBody } from "@/modules/community/components/post-body";
import { requireActiveUser } from "@/lib/authz";
import { isCommunityEnabled } from "@/modules/community/lib/config";
import {
  reportedMessagesFor,
  reportConflictFor,
  reportedPostFor,
} from "@/modules/community/lib/manage";
import { displayNameFor } from "@/modules/community/lib/rules";

import { ConsumeReportButton } from "../ui";

// 🚨 **The bounded window (AD-71) — the one place somebody who is not a
// participant reads a private message.**
//
// What it shows is an EXPLICIT id list: the reported message, plus whatever
// the REPORTER chose to attach. Not a range, not a neighbourhood, not the
// conversation. There is no "show more" and no link into the conversation,
// and `reportedMessagesFor()` re-checks that every row it got back belongs to
// the reported message's conversation — the report row is data, and data is
// not a permission.
//
// Which messages became visible was recorded when the report was written, in
// the same transaction, as a `dmVisibility` act. "Who saw what of my
// correspondence" has an answer.
//
// ⚠️ DYNAMIC route — `node run.mjs smoke` skips it.

export async function generateMetadata() {
  const t = await getTranslations("community");
  return { title: t("reportDetailTitle") };
}

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  if (!isCommunityEnabled()) notFound();

  const session = await requireActiveUser();
  const actorId = session.user.id as string;
  const { reportId } = await params;

  // Both readers re-read the authority themselves (AD-63) and throw for
  // anybody who may not moderate — which this page turns into a not-found, so
  // the URL is not a probe.
  let post: Awaited<ReturnType<typeof reportedPostFor>> = null;
  let messages: Awaited<ReturnType<typeof reportedMessagesFor>> = [];
  let conflicted = false;
  try {
    [post, messages] = await Promise.all([
      reportedPostFor(actorId, reportId),
      reportedMessagesFor(actorId, reportId),
    ]);
    conflicted = await reportConflictFor(actorId, reportId);
  } catch {
    notFound();
  }

  if (!post && messages.length === 0) notFound();

  const [t, format] = await Promise.all([
    getTranslations("community"),
    getFormatter(),
  ]);
  const placeholderLabel = t("memberPlaceholder");

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
        <Link href="/dashboard/community/reports">
          <ChevronLeft aria-hidden />
          {t("reportBack")}
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title={t("reportShowContent")} />
        <ConsumeReportButton reportId={reportId} conflicted={conflicted} />
      </div>

      {messages.length > 0 && (
        // Said on the page a moderator is reading, not only in a document:
        // this is a window somebody opened for them, not a conversation they
        // may browse.
        <Callout variant="warning" title={t("reportShowContent")} className="mb-4">
          <p>{t("reportWindowNote")}</p>
        </Callout>
      )}

      {post && (
        <Card>
          <CardContent>
            {/* ⚠️ An author-deleted post still shows its words HERE and
                nowhere else — that deferral is what stops "delete it quickly"
                from being a way to dodge a report. It ends when this report
                is consumed. */}
            <PostBody content={post.content} />
          </CardContent>
        </Card>
      )}

      {messages.length > 0 && (
        <ol className="grid gap-3">
          {messages.map((message) => (
            <li key={message.id} className="bg-card rounded-xl border p-3">
              <div className="text-muted-foreground mb-1 flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="text-foreground font-medium">
                  {message.authorId
                    ? displayNameFor({
                        profileName: message.authorProfileName,
                        accountName: message.authorAccountName,
                        memberId: message.authorId,
                        placeholderLabel,
                      })
                    : t("formerMember")}
                </span>
                <time dateTime={message.createdAt.toISOString()}>
                  {format.dateTime(message.createdAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
              </div>
              <PostBody content={message.content} />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
