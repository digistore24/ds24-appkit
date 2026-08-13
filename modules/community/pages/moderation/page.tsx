// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ScrollText } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Callout } from "@/components/ui/callout";
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
  AUDIT_PER_PAGE,
  moderationAuthority,
  moderationTrail,
} from "@/modules/community/lib/manage";
import { isOwner } from "@/lib/roles";

// The moderation trail.
//
// 🚨 **Who may read this is answered by the database, not by the session.**
// `moderationTrail()` re-reads the role and the duty rows and answers `null`
// for anybody who may not moderate — and this page turns that into the
// framework's not-found. A member probing the URL learns nothing: not that
// moderation exists here, not who has it.
//
// 🚨 **The narrowing is in the QUERY.** The operator sees every row; a
// moderator sees the rows where they are the actor, because that is what the
// query asked for — not because the template hid the rest. A page that fetched
// everything and rendered a subset would have shipped the rest in its own
// payload.

export async function generateMetadata() {
  const t = await getTranslations("community");
  return { title: t("moderationTitle") };
}

export default async function ModerationPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  if (!isCommunityEnabled()) notFound();

  const session = await requireActiveUser();
  const actorId = session.user.id;

  const requested = (await searchParams).page;
  const page = Math.max(1, Number(requested) || 1);

  const [trail, authority, t, format] = await Promise.all([
    moderationTrail(actorId, page),
    moderationAuthority(actorId),
    getTranslations("community"),
    getFormatter(),
  ]);

  // `null` covers "no such account", "not a moderator" and "a moderator with
  // no duty anywhere" alike — one answer, so the URL is not a probe.
  if (!trail || !authority) notFound();

  const pages = Math.max(1, Math.ceil(trail.total / AUDIT_PER_PAGE));

  return (
    <>
      <PageHeader
        title={t("moderationTitle")}
        description={t("moderationSubtitle")}
      />

      {!isOwner(authority.role) && (
        // Said plainly rather than left to be inferred from a short list: a
        // moderator who thought they were seeing everything would draw wrong
        // conclusions from an empty page.
        <Callout variant="info" title={t("moderationTitle")} className="mb-6">
          <p>{t("moderationOwnOnly")}</p>
        </Callout>
      )}

      {trail.rows.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={t("moderationEmptyTitle")}
          description={t("moderationEmptyDescription")}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("moderationWhen")}</TableHead>
              <TableHead>{t("moderationActor")}</TableHead>
              <TableHead>{t("moderationAct")}</TableHead>
              <TableHead>{t("moderationReason")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trail.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {format.dateTime(row.createdAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </TableCell>
                <TableCell>
                  {/* An act outlives its actor's account — the FK nulls the
                      column and the row stays, because the trail is the record
                      of power exercised. `formerMember` is the honest label
                      for that, and inventing a name would be worse. */}
                  {row.actorName ?? t("formerMember")}
                </TableCell>
                <TableCell>
                  {/* The act codes are translated here, at the delivery layer,
                      like every other code in this module. An unknown value —
                      a row written by a newer version — renders as itself
                      rather than as a crash. */}
                  {t.has(`act_${row.act}`) ? t(`act_${row.act}`) : row.act}
                </TableCell>
                <TableCell className="text-muted-foreground max-w-sm text-sm">
                  {row.discussionId ? (
                    <Link
                      href={`/dashboard/community/discussions/${encodeURIComponent(row.discussionId)}`}
                      className="underline underline-offset-2"
                    >
                      {row.reason ?? "—"}
                    </Link>
                  ) : (
                    (row.reason ?? "—")
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Pager
        page={trail.page}
        pages={pages}
        hrefFor={(page) => `/dashboard/community/moderation?page=${page}`}
        link={Link}
      />
    </>
  );
}
