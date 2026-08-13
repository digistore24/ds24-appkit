// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Inbox } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pager } from "@/modules/community/components/pager";
import { requireActiveUser } from "@/lib/authz";
import { isCommunityEnabled } from "@/modules/community/lib/config";
import {
  REPORTS_PER_PAGE,
  openReports,
  standingSendBlocks,
} from "@/modules/community/lib/manage";

import { ConsumeReportButton, LiftBlockButton } from "./ui";
import { Callout } from "@/components/ui/callout";

// The open queue — unconsumed reports, oldest first.
//
// 🚨 **Who may read it is answered by the database**, through the same
// authority re-read every moderation surface uses, and `null` becomes the
// framework's not-found. A member probing the URL learns nothing.
//
// ⚠️ **This page does not show the reported CONTENT of a private message.**
// It shows that a message was reported, by nobody-named, with the reporter's
// reason. Opening the bounded window onto the message itself is Story 23.3,
// and it is a deliberate act that writes its own audit row — not something a
// queue renders on the way past.
//
// Oldest first, where every other list in this module is newest first: a queue
// is worked through, and the report that has waited longest is the one to look
// at next.

export async function generateMetadata() {
  const t = await getTranslations("community");
  return { title: t("reportsTitle") };
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  if (!isCommunityEnabled()) notFound();

  const session = await requireActiveUser();
  const requested = (await searchParams).page;
  const page = Math.max(1, Number(requested) || 1);

  const [queue, blocks, t, format] = await Promise.all([
    openReports(session.user.id, page),
    // ⚠️ Derived from the same unconsumed rows the queue lists — there is no
    // block table to read (AD-64). This banner IS v1's notification channel,
    // and nothing else is built: a member silenced automatically is somebody a
    // moderator should meet at the top of their queue.
    standingSendBlocks(session.user.id),
    getTranslations("community"),
    getFormatter(),
  ]);

  if (!queue) notFound();

  const pages = Math.max(1, Math.ceil(queue.total / REPORTS_PER_PAGE));

  return (
    <>
      <PageHeader
        title={t("reportsTitle")}
        description={t("reportsSubtitle")}
      />

      {(blocks ?? []).map((block) => (
        <Callout
          key={block.memberId}
          variant="warning"
          title={t("blockBannerTitle")}
          className="mb-4"
        >
          <p>
            {t("blockBannerBody", {
              since: format.dateTime(block.since, {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            })}
          </p>
          <div className="mt-3">
            <LiftBlockButton
              memberId={block.memberId}
              conflicted={block.conflicted}
            />
          </div>
        </Callout>
      ))}

      {queue.rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={t("reportsEmptyTitle")}
          description={t("reportsEmptyDescription")}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("reportsWhen")}</TableHead>
              <TableHead>{t("reportsWhat")}</TableHead>
              <TableHead>{t("reportsReason")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {queue.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {format.dateTime(row.createdAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </TableCell>
                <TableCell>
                  {/* What KIND of content, never who reported it. Naming a
                      reporter to anybody is how a report becomes a reprisal —
                      and a moderator does not need the name to judge the
                      content. */}
                  {row.postId ? t("reportsPost") : t("reportsMessage")}
                </TableCell>
                <TableCell className="text-muted-foreground max-w-sm text-sm">
                  {row.reason ?? "—"}
                </TableCell>
                <TableCell className="flex justify-end gap-2 text-right">
                  {/* Opening the window is a deliberate step, not something
                      the queue does on the way past — for a DM report it is
                      the moment a moderator is shown part of somebody's
                      private conversation. */}
                  <Button variant="outline" size="sm" asChild>
                    <Link
                      href={`/dashboard/community/reports/${encodeURIComponent(row.id)}`}
                    >
                      {t("reportOpen")}
                    </Link>
                  </Button>
                  <ConsumeReportButton reportId={row.id} conflicted={row.conflicted} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Pager
        page={queue.page}
        pages={pages}
        hrefFor={(page) => `/dashboard/community/reports?page=${page}`}
        link={Link}
      />
    </>
  );
}
