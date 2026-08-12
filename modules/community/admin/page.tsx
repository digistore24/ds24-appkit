// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { requireOwner } from "@/lib/authz";
import { isCommunityEnabled } from "@/modules/community/lib/config";
import { listGroups, moderatorCandidates } from "@/modules/community/lib/manage";
import { allProducts } from "@/lib/digistore/products";

import { CreateGroupDialog, GroupTable } from "./ui";

export async function generateMetadata() {
  const t = await getTranslations("communityAdmin");
  return { title: t("title") };
}

// The rooms — where the operator builds the community's structure.
//
// ⚠️ **The guard order is the decision, not a formality: disabled beats
// owner.** A community that is not running answers not-found here for
// EVERYONE, the operator included. There is no admin preview of a switched-off
// module: switching it on is an edit to `config/community.json` plus the next
// deploy, and rooms are configured after that. So the enablement check comes
// FIRST, before any session work.
//
// A community that is switched ON but whose config does not hold gets the same
// answer. This is not the diagnosis surface — `/dashboard/community` is, and
// the module keeps exactly one of those. The honest rule here is: anything but
// "on and coherent" is not-found, which is what `isCommunityEnabled()` already
// means.
//
// Then `requireOwner()`, and moderators are refused by it like any member:
// they look after rooms, they do not create them.
export default async function CommunityAdminPage() {
  if (!isCommunityEnabled()) notFound();
  await requireOwner();

  const [groups, candidates, t] = await Promise.all([
    listGroups(),
    moderatorCandidates(),
    getTranslations("communityAdmin"),
  ]);

  // The keys a plan-gated room may name. Token packages are left out on
  // purpose and not merely unchecked: `hasPlan()` answers false for a balance
  // for ever, so offering one here would offer a door nobody could open. The
  // server refuses it too (`groupPlanProblems`) — this is the half that keeps
  // the operator from making the mistake in the first place.
  const plans = allProducts()
    .filter((product) => product.kind !== "token")
    .map((product) => ({ key: product.key, name: product.name }));

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description", { count: groups.length })}
      >
        <CreateGroupDialog plans={plans} />
      </PageHeader>

      <GroupTable groups={groups} plans={plans} candidates={candidates} />
    </>
  );
}
