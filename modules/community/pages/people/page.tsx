// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Users } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireActiveUser } from "@/lib/authz";
import { isCommunityEnabled } from "@/modules/community/lib/config";
import { followsFor, type FollowRow } from "@/modules/community/lib/manage";
import { displayNameFor } from "@/modules/community/lib/rules";

import { FollowButton } from "./ui";

// "My people" — the two lists, and only ever the session's own.
//
// ⚠️ **The reader takes the session's member id and no request ever supplies
// one.** There is no `?member=` on this page and no reader anywhere in the
// module for somebody else's lists: you get the relationships you are part of,
// never the graph (NFR-35's slicing, applied where it is easy — a follow is
// visible to both its people by design).
//
// ⚠️ **No counts.** Neither list shows how many, here or anywhere else. The
// lists show PEOPLE; a number would start describing a paid room's population
// from a new angle, which is the no-roster rule arriving through the back
// door.

export async function generateMetadata() {
  const t = await getTranslations("community");
  return { title: t("peopleTitle") };
}

export default async function PeoplePage() {
  if (!isCommunityEnabled()) notFound();

  const session = await requireActiveUser();
  const memberId = session.user.id;

  const [{ following, followedBy }, t] = await Promise.all([
    followsFor(memberId),
    getTranslations("community"),
  ]);

  const placeholderLabel = t("memberPlaceholder");

  // The `following` list carries the button, because those are the
  // relationships this member owns. The `followedBy` list deliberately does
  // NOT: there is no "remove this follower" control anywhere, because being
  // followed is visible rather than approved — and an approval step is exactly
  // what FR-219 refuses. Somebody who does not want to be followed blocks,
  // which severs it and stops it coming back.
  const person = (row: FollowRow, withButton: boolean) => (
    <li
      key={row.memberId}
      className="flex items-center justify-between gap-3 border-b py-3 last:border-b-0"
    >
      <Link
        href={`/dashboard/community/members/${encodeURIComponent(row.memberId)}`}
        className="font-medium hover:underline"
      >
        {displayNameFor({
          profileName: row.profileName,
          accountName: row.accountName,
          memberId: row.memberId,
          placeholderLabel,
        })}
      </Link>
      {withButton && (
        <FollowButton memberId={row.memberId} following size="sm" />
      )}
    </li>
  );

  return (
    <>
      <PageHeader title={t("peopleTitle")} description={t("peopleSubtitle")} />

      {/* Said once, on the page where somebody would wonder: following is not
          a quiet bookmark. There is no setting that would make it one. */}
      <Callout variant="info" title={t("peopleTitle")} className="mb-6">
        <p>{t("followVisibleNote")}</p>
      </Callout>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("following")}</CardTitle>
          </CardHeader>
          <CardContent>
            {following.length === 0 ? (
              <EmptyState
                icon={Users}
                title={t("followingEmptyTitle")}
                description={t("followingEmptyDescription")}
              />
            ) : (
              <ul>{following.map((row) => person(row, true))}</ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("followedBy")}</CardTitle>
          </CardHeader>
          <CardContent>
            {followedBy.length === 0 ? (
              <EmptyState
                icon={Users}
                title={t("followedByEmptyTitle")}
                description={t("followedByEmptyDescription")}
              />
            ) : (
              <ul>{followedBy.map((row) => person(row, false))}</ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
