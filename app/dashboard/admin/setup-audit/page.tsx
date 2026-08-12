// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { getTranslations, getFormatter } from "next-intl/server";
import { ScrollText } from "lucide-react";

import { requireOwner } from "@/lib/authz";
import { listActs } from "@/lib/setup/manage";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export async function generateMetadata() {
  const t = await getTranslations("setupAudit");
  return { title: t("title") };
}

/**
 * What the setup surface has done here — owners only.
 *
 * 🚨 This page is a control, not a nicety. The setup surface is the only one in
 * this app that takes ids, and the record is what pays for that. An audit trail
 * nobody reads is not a control at all — so the trail has a page, and
 * `node run.mjs setup-check` prints the same rows for whoever is in a terminal.
 *
 * Read-only by construction: `setup_audit` has no update and no delete path
 * anywhere in this application, and there is deliberately nothing here that
 * would need one.
 */
export default async function SetupAuditPage() {
  await requireOwner();
  const t = await getTranslations("setupAudit");
  const format = await getFormatter();
  const rows = await listActs(100);

  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} />

      {rows.length === 0 ? (
        <EmptyState icon={ScrollText} title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("when")}</TableHead>
              <TableHead>{t("environment")}</TableHead>
              <TableHead>{t("tool")}</TableHead>
              <TableHead>{t("target")}</TableHead>
              <TableHead>{t("key")}</TableHead>
              <TableHead>{t("outcome")}</TableHead>
              <TableHead className="text-right">{t("rows")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap">
                  {format.dateTime(row.createdAt, { dateStyle: "short", timeStyle: "short" })}
                </TableCell>
                <TableCell>{row.appEnv}</TableCell>
                <TableCell className="font-mono text-sm">{row.tool}</TableCell>
                {/* An identifier, never content — see db/schema-setup.ts. */}
                <TableCell>{row.target ?? "—"}</TableCell>
                {/* A refusal with no key is the row that matters most: somebody
                    called with a credential that does not exist. */}
                <TableCell>{row.keyName ?? t("noKey")}</TableCell>
                <TableCell>
                  <Badge variant={row.outcome === "refused" ? "destructive" : "default"}>
                    {row.outcome === "refused" && row.code
                      ? `${t(`outcome_${row.outcome}` as never)} · ${row.code}`
                      : t(`outcome_${row.outcome}` as never)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.rows}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
