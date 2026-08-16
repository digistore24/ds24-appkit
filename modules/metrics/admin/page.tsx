// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Where new customers stop, who came back, and whether the change helped.
//
// Two things here are NOT cosmetics, and are worth naming before somebody
// rearranges the file:
//
//   * **the guard lines, in the order they stand in.** `disabledInConfig` →
//     `notFound()` BEFORE any session work, because OFF BEATS OPERATOR: there
//     is no admin preview of a switched-off module, and switching it on is an
//     edit plus a deploy, never something this page could offer.
//     `modules/admin-guard-order.test.ts` reads this file as text and fails the
//     build if `requireOwner()` comes first — otherwise a member and an
//     operator would get two different documents for the same dead route.
//     In a normally wired app the branch never renders, because `gate.ts`
//     covers this subtree and `proxy.ts` rewrites first; it stays as defence in
//     depth, since hiding is never guarding.
//   * **the BROKEN state falls through to the page.** Switched on with a config
//     that does not hold, the operator reads the diagnosis here — this is the
//     only screen in a deployed app that names the bad value. Same fork
//     `modules/courses/admin/page.tsx` makes, and the reason `gate.ts` reports
//     only `"off"`.
//
// It reads and never writes: there is no action, no form and no client
// component on this page.
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { Callout } from "@/components/ui/callout";
import { requireOwner } from "@/lib/authz";

import { metricsConfigProblems, metricsOffReason } from "../lib/config";
import { parseView, reportFor } from "../lib/report";
import { Cohorts, Funnel, NoSplits, PeriodSwitcher, SplitCard } from "./ui";

export async function generateMetadata() {
  const t = await getTranslations("metricsAdmin");
  return { title: t("title") };
}

export default async function MetricsAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // 🚨 First line, before any session work. See the header.
  if (metricsOffReason() === "disabledInConfig") {
    notFound();
  }

  await requireOwner();

  const t = await getTranslations("metricsAdmin");
  const problems = metricsConfigProblems();
  const view = parseView(await searchParams);
  // One clock for the whole page, so the funnel and the cohorts cannot land on
  // opposite sides of midnight.
  const now = new Date();
  const report = await reportFor(view, now);

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} />

      {problems.length > 0 ? (
        // The diagnosis this page exists to show. It is a `Callout` and not a
        // toast because it must stay on screen: nothing here is transient, and
        // an operator who scrolled past it would keep reading numbers that are
        // missing an experiment nobody told them was ignored.
        <Callout variant="warning" title={t("brokenTitle")}>
          {t("brokenBody")}
          <ul className="mt-2 list-disc pl-5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      <PeriodSwitcher view={view} />

      <Funnel reading={report.funnel} />
      <Cohorts rows={report.cohorts} />

      {report.splits.length === 0 ? (
        <NoSplits />
      ) : (
        report.splits.map((split) => <SplitCard key={split.experiment.id} split={split} />)
      )}
    </div>
  );
}
