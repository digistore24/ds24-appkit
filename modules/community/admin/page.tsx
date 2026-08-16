// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { requireOwner } from "@/lib/authz";
import { isCommunityEnabled } from "@/modules/community/lib/config";
import { listGroups, listedMembers, moderatorCandidates } from "@/modules/community/lib/manage";
import { StandingControls } from "@/modules/community/pages/blocks/ui";
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

  const [groups, candidates, listed, t, community] = await Promise.all([
    listGroups(),
    moderatorCandidates(),
    listedMembers(),
    getTranslations("communityAdmin"),
    getTranslations("community"),
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

      {/* ── The three lists, second home ─────────────────────────────────
          🚨 **The same `StandingControls` the review list renders, not a copy.**
          "An operator can do this in both places" was the requirement, and two
          components would be two answers to one question — drifting the moment
          one of them grew a fourth list or a different confirmation, invisibly,
          because both would keep compiling and both would keep posting to the
          same action.

          What differs is the SET each place offers it for, and that is the
          point of having two: the review list works from whoever is silenced
          right now, this one from whoever is already on a list, so an operator
          can take somebody off without waiting for a case. Adding somebody who
          is on neither happens where their name is — the member page. */}
      <section className="mt-10">
        <h2 className="mb-1 text-lg font-semibold">{community("listsTitle")}</h2>
        <p className="text-muted-foreground mb-4 text-sm">
          {community("listsSubtitle")}
        </p>
        {listed.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {community("listsEmpty")}
          </p>
        ) : (
          <ul className="grid gap-3">
            {listed.map((row) => (
              <li
                key={row.memberId}
                className="bg-card flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
              >
                <span className="text-sm">{row.memberId}</span>
                <span className="flex flex-wrap gap-2">
                  <StandingControls
                    memberId={row.memberId}
                    standing={{
                      protected: row.protected,
                      writeBlocked: row.writeBlocked,
                      reportsIgnored: row.reportsIgnored,
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
