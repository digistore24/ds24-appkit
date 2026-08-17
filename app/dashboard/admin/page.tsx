// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Users, Receipt, Coins, KeyRound, LogIn, ArrowRight } from "lucide-react";

import { requireOwner } from "@/lib/authz";
import { MODULE_NAV } from "@/lib/modules/nav-registry";
import { moduleShellState } from "@/lib/modules/shell-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("title") };
}

// Operator/admin area — role "owner" only (see lib/authz.ts).
// A blueprint for your own admin pages: requireOwner() as the first line is
// all it takes.
export default async function AdminPage() {
  const session = await requireOwner();
  const [t, nav, shell] = await Promise.all([
    getTranslations("admin"),
    // The module entries' labels live in the `nav` namespace, merged in from
    // each module's own message file — the same strings the sidebar renders,
    // so the hub and the menu cannot call one page two things.
    getTranslations("nav"),
    moduleShellState({
      memberId: session.user.id,
      role: session.user.role,
      impersonating: Boolean(session.user.impersonation),
    }),
  ]);

  const moduleAdmin = MODULE_NAV.flatMap((mod) => mod.NAVIGATION).filter(
    (item) =>
      item.ownerOnly &&
      (item.featureKey === undefined || shell.features[item.featureKey] !== false),
  );

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description", { email: session.user.email ?? "" })}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="bg-primary/10 text-primary mb-2 grid size-9 place-items-center rounded-lg">
              <Users aria-hidden className="size-4.5" />
            </div>
            <CardTitle>{t("usersTitle")}</CardTitle>
            <CardDescription>{t("usersBody")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/dashboard/admin/users">
                {t("usersCta")}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="bg-primary/10 text-primary mb-2 grid size-9 place-items-center rounded-lg">
              <Receipt aria-hidden className="size-4.5" />
            </div>
            <CardTitle>{t("purchasesTitle")}</CardTitle>
            <CardDescription>{t("purchasesBody")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/dashboard/admin/purchases">
                {t("purchasesCta")}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="bg-primary/10 text-primary mb-2 grid size-9 place-items-center rounded-lg">
              <Coins aria-hidden className="size-4.5" />
            </div>
            <CardTitle>{t("aiCostsTitle")}</CardTitle>
            <CardDescription>{t("aiCostsBody")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/dashboard/admin/ai-costs">
                {t("aiCostsCta")}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* The setup surface's two pages. They live here rather than in the
            sidebar on purpose: an operator opens them twice — once to mint a
            key, once when they want to know what touched an environment — and a
            permanent menu entry for that is noise on every other page. */}
        <Card>
          <CardHeader>
            <div className="bg-primary/10 text-primary mb-2 grid size-9 place-items-center rounded-lg">
              <KeyRound aria-hidden className="size-4.5" />
            </div>
            <CardTitle>{t("setupKeysTitle")}</CardTitle>
            <CardDescription>{t("setupKeysBody")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/dashboard/admin/setup-keys">
                {t("setupKeysCta")}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/dashboard/admin/setup-audit">{t("setupAuditCta")}</Link>
            </Button>
          </CardContent>
        </Card>

        {/* ⚠️ In the sidebar since Epic 30 and missing from this hub until
            2026-08-17 — the one CORE operator surface the page did not name.
            It is not behind a feature key: the sidebar shows it to every owner,
            and `isImpersonationEnabled()` decides what the PAGE does, not
            whether an operator may read the record. */}
        <Card>
          <CardHeader>
            <div className="bg-primary/10 text-primary mb-2 grid size-9 place-items-center rounded-lg">
              <LogIn aria-hidden className="size-4.5" />
            </div>
            <CardTitle>{t("impersonationsTitle")}</CardTitle>
            <CardDescription>{t("impersonationsBody")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/dashboard/admin/impersonations">
                {t("impersonationsCta")}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("ownerOnlyTitle")}</CardTitle>
            <CardDescription>
              {t.rich("ownerOnlyBody", {
                code: (chunks) => <code>{chunks}</code>,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs">
              node run.mjs user-create --email … --role owner --apply
            </pre>
          </CardContent>
        </Card>
      </div>

      {/* ── What the installed modules add ────────────────────────────────
          🚨 **Read off `MODULE_NAV`, never a list kept here.** A hand-written
          one is a list that is right on the day it is written: this hub named
          five core pages while an app with the modules installed had nine
          operator surfaces, and the four it did not name were reachable only
          from the sidebar. A fifth module would have repeated it.

          The visibility question is the SIDEBAR's, asked once —
          `moduleShellState()` resolves the same feature keys for the same
          viewer, so an entry the sidebar hides cannot appear here. An entry
          whose key nobody resolves is SHOWN (`!== false`), which is the
          shipped meaning of an absent key in `app-shell.tsx` too.

          A label and a way in, and no description: a module's nav entry
          carries `labelKey` and nothing else, and inventing a sentence per
          module here would be prose the module cannot correct. */}
      {moduleAdmin.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-1 text-lg font-semibold">{t("moduleSurfacesTitle")}</h2>
          <p className="text-muted-foreground mb-4 text-sm">{t("moduleSurfacesBody")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {moduleAdmin.map((item) => (
              <Card key={item.href}>
                <CardHeader>
                  <div className="bg-primary/10 text-primary mb-2 grid size-9 place-items-center rounded-lg">
                    <item.icon aria-hidden className="size-4.5" />
                  </div>
                  <CardTitle>{nav(item.labelKey)}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline">
                    <Link href={item.href}>
                      {t("moduleSurfaceCta")}
                      <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
