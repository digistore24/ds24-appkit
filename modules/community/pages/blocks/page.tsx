// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ShieldCheck } from "lucide-react";

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
import { requireActiveUser } from "@/lib/authz";
import { isOwner } from "@/lib/roles";
import { communityConfig, isCommunityEnabled } from "@/modules/community/lib/config";
import {
  contradictoryStandings,
  listedMembers,
  memberWithProfile,
  moderationAuthority,
  standingSendBlocks,
} from "@/modules/community/lib/manage";
import { displayNameFor } from "@/modules/community/lib/rules";

import { LiftBlockButton } from "../reports/ui";
import { StandingControls } from "./ui";

// Who is silenced right now, and why — the page that answers a question
// nothing in this module answered before.
//
// 🚨 **It shows TWO kinds of silence side by side, and they are not the same
// thing.** The automatic one is a derivation over unconsumed reports: it can
// dissolve on its own when they age out of the window or when the reporters'
// weights fall, and nobody decided that. The hand-set one is a row somebody
// wrote, and only somebody can take it back. Merging them into one list would
// be tidier and would hide exactly the distinction an operator is here to
// judge, so each row says which it is.
//
// ⚠️ **Moderators READ it, the operator ALSO writes.** The lift is a
// site-wide moderator power that already exists; the three lists are the
// operator's, because a standing decision has no WHERE and a room-scoped
// moderator could otherwise neutralise somebody who reports them elsewhere.
// The controls are simply absent for a moderator — the server refuses either
// way, and a control that always errors is a worse answer than no control.

export async function generateMetadata() {
  const t = await getTranslations("community");
  return { title: t("blocksTitle") };
}

export default async function BlocksPage() {
  if (!isCommunityEnabled()) notFound();

  const session = await requireActiveUser();
  const authority = await moderationAuthority(session.user.id);
  // The same not-found every moderation surface answers. A member probing the
  // URL learns nothing about whether this installation has moderators.
  if (!authority) notFound();

  const [derived, listed, contradictions, t, format] = await Promise.all([
    standingSendBlocks(session.user.id),
    listedMembers(),
    contradictoryStandings(),
    getTranslations("community"),
    getFormatter(),
  ]);
  if (!derived) notFound();

  const mayList = isOwner(authority.role);
  const grace = communityConfig().newMember;

  // ⚠️ The derived half already carries the account name — `standingSendBlocks()`
  // resolves it while it walks the candidates. The hand-set half does not, and
  // it deliberately stays a plain id lookup rather than growing a join: this
  // table holds one row per LISTED member, which is a handful in any community
  // small enough for an operator to be reading this page at all.
  const named = new Map(derived.map((row) => [row.memberId, row.name]));
  const listedNames = await Promise.all(
    listed.map(async (row) =>
      named.has(row.memberId)
        ? ([row.memberId, named.get(row.memberId) ?? null] as const)
        : ([row.memberId, (await memberWithProfile(row.memberId))?.accountName ?? null] as const),
    ),
  );
  for (const [id, name] of listedNames) named.set(id, name);
  const nameOf = (id: string) =>
    displayNameFor({
      // No profile name on this surface: it is the ACCOUNT that is silenced,
      // and a member who never chose a community name still has to be nameable
      // here. `placeholderLabel` is the translated word for exactly that.
      profileName: null,
      accountName: named.get(id) ?? null,
      memberId: id,
      placeholderLabel: t("memberPlaceholder"),
    });

  const empty = derived.length === 0 && listed.length === 0;

  return (
    <>
      <PageHeader title={t("blocksTitle")} description={t("blocksSubtitle")} />

      {contradictions.length > 0 && (
        <Callout
          variant="warning"
          title={t("blocksContradictionTitle")}
          className="mb-4"
        >
          {/* 🚨 The one state the rule cannot PREVENT: the role is granted in
              the core's user administration, which knows nothing about this
              module, so somebody write-blocked by hand can be made a moderator
              afterwards. Surfaced rather than repaired — which of the two an
              operator meant is not a machine's guess. */}
          <p>
            {t("blocksContradictionBody", {
              names: contradictions.map(nameOf).join(", "),
            })}
          </p>
        </Callout>
      )}

      {/* 🚨 **The RULE, never the people it currently binds** — and that
          distinction is the whole of why the grace has no audit act and no
          export section. It is a derivation over `users.createdAt` and
          `grants`: there is no moment anybody decided, nothing to record, and
          a per-member list here would be the reputation table this module
          refuses to have. What an operator needs is the answer to "somebody
          wrote to me saying they cannot post" — one sentence, no query, no
          personal data. `docs/data-protection.md` §14g leans on this staying
          a sentence. */}
      {grace.enabled && (
        <Callout variant="info" title={t("blocksGraceTitle")} className="mb-4">
          <p>
            {t("blocksGraceBody", {
              hours: grace.graceHours,
              posts: grace.maxPostsPerDay,
              links: grace.maxLinksPerPost,
            })}
          </p>
        </Callout>
      )}

      {empty ? (
        <EmptyState
          icon={ShieldCheck}
          title={t("blocksEmptyTitle")}
          description={t("blocksEmptyDescription")}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("blocksWho")}</TableHead>
              <TableHead>{t("blocksKind")}</TableHead>
              <TableHead>{t("blocksSince")}</TableHead>
              <TableHead>{t("blocksWeight")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {derived.map((row) => (
              <TableRow key={`derived-${row.memberId}`}>
                <TableCell>{nameOf(row.memberId)}</TableCell>
                <TableCell>{t("blocksKindAutomatic")}</TableCell>
                <TableCell>
                  {format.dateTime(row.since, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {/* 🚨 The weight AND the count, because "five ordinary
                      reporters" and "two long-standing customers" are the same
                      `blocked: true` and are not the same thing to judge. This
                      is the one surface that may say it: a member never sees a
                      score, and the reporters are still not named. */}
                  {t("blocksWeightValue", {
                    reporters: row.reporterIds.length,
                    weight: (row.weight / 100).toFixed(1),
                  })}
                </TableCell>
                <TableCell className="flex flex-wrap justify-end gap-2 text-right">
                  <LiftBlockButton
                    memberId={row.memberId}
                    conflicted={row.conflicted}
                  />
                  {mayList && (
                    <StandingControls memberId={row.memberId} standing={null} />
                  )}
                </TableCell>
              </TableRow>
            ))}

            {listed.map((row) => (
              <TableRow key={`listed-${row.memberId}`}>
                <TableCell>{nameOf(row.memberId)}</TableCell>
                <TableCell>{t("blocksKindByHand")}</TableCell>
                <TableCell>
                  {row.updatedAt
                    ? format.dateTime(row.updatedAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {/* A hand-set decision has no weight — nothing was counted.
                      An em dash rather than a zero: zero is a measurement. */}
                  —
                </TableCell>
                <TableCell className="flex flex-wrap justify-end gap-2 text-right">
                  {mayList && (
                    <StandingControls
                      memberId={row.memberId}
                      standing={{
                        protected: row.protected,
                        writeBlocked: row.writeBlocked,
                        reportsIgnored: row.reportsIgnored,
                      }}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
