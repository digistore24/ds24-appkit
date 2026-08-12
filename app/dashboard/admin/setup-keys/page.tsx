// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { getTranslations } from "next-intl/server";

import { requireOwner } from "@/lib/authz";
import { listKeys } from "@/lib/setup/manage";
import { isSetupEnabled } from "@/lib/setup/config";
import { PageHeader } from "@/components/page-header";
import { Callout } from "@/components/ui/callout";
import { SetupKeys } from "./ui";

export async function generateMetadata() {
  const t = await getTranslations("setupKeys");
  return { title: t("title") };
}

/**
 * Where the keys for the setup surface are minted — owners only.
 *
 * ⚠️ The page works whether or not the surface is switched on, deliberately.
 * The switch is a deploy (`config/setup.json`), so an operator will routinely
 * mint a key BEFORE the deploy that turns the surface on — and a page that
 * refused until then would send them looking for a shell instead. The notice
 * below says which state they are in; the key itself is inert until the
 * surface answers.
 */
export default async function SetupKeysPage() {
  await requireOwner();
  const t = await getTranslations("setupKeys");
  const rows = await listKeys();
  const on = isSetupEnabled();

  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} />

      {on ? null : (
        <div className="mb-6">
          <Callout variant="warning" title={t("offTitle")}>
            {t("offBody")}
          </Callout>
        </div>
      )}

      <SetupKeys
        rows={rows.map((row) => ({
          id: row.id,
          name: row.name,
          prefix: row.prefix,
          // Serialised at the boundary: a Date that crossed into a client
          // component is a string wearing a Date's type.
          createdAt: row.createdAt.toISOString(),
          lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
          expiresAt: row.expiresAt?.toISOString() ?? null,
          revokedAt: row.revokedAt?.toISOString() ?? null,
        }))}
      />
    </>
  );
}
