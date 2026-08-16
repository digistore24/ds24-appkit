// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The operator's view of the numbers — presentation only.
//
// 🚨 **No client component, no state, no action.** Every control is a `<Link>`
// back to the same path with a different query string, exactly as
// `app/dashboard/admin/ai-costs/ui.tsx` does it: the whole page stays out of the
// browser bundle, every view is bookmarkable, and there is nothing here that can
// mutate anything.
//
// ⚠️ Formatting is done by TINY ASYNC COMPONENTS (`<Pct>`, `<Day>`) rather than
// by awaiting inside a `.map()`. A map callback marked `async` returns an array
// of Promises, which is not a renderable node; an async component is. Same
// reason the numbers are never hand-formatted: `CLAUDE.md` → Languages.
//
// ⚠️ **This page is the app's product surface, and it is yours to change.** A
// module's pages are the one part a vendor legitimately redesigns. What is not
// cosmetics is the refusal in `<SplitCard>` — see the comment there.
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { MIN_CONVERSIONS_PER_VARIANT, MIN_EXPOSED_PER_VARIANT } from "../rules.mjs";
import { PERIODS, type ReportView } from "../lib/report";
import type { CohortRow, FunnelReading, SplitTestReading } from "../lib/report";

const PATH = "/dashboard/admin/metrics";

/** A share, formatted by the locale rather than by hand. */
async function Pct({ value }: { value: number }) {
  const format = await getFormatter();
  return <>{format.number(value, { style: "percent", maximumFractionDigits: 1 })}</>;
}

/** A `YYYY-MM-DD` bucket, rendered in UTC because that is what it means. */
async function Day({ value }: { value: string }) {
  const format = await getFormatter();
  return (
    <>
      {format.dateTime(new Date(`${value}T00:00:00.000Z`), {
        timeZone: "UTC",
        dateStyle: "medium",
      })}
    </>
  );
}

export async function PeriodSwitcher({ view }: { view: ReportView }) {
  const t = await getTranslations("metricsAdmin");
  return (
    <nav className="flex flex-wrap gap-2" aria-label={t("periodLabel")}>
      {PERIODS.map((period) => (
        <Button
          key={period}
          asChild
          size="sm"
          variant={period === view.period ? "default" : "outline"}
        >
          <Link
            href={`${PATH}?period=${period}`}
            aria-current={period === view.period ? "page" : undefined}
          >
            {t(`period_${period}`)}
          </Link>
        </Button>
      ))}
    </nav>
  );
}

export async function Funnel({ reading }: { reading: FunnelReading }) {
  const t = await getTranslations("metricsAdmin");

  return (
    <Card>
      <CardHeader>
        <CardTitle level="h2">{t("funnelTitle")}</CardTitle>
        <CardDescription>{t("funnelSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {reading.rows.length === 0 ? (
          // The state most operators meet first, and it is not a fault: nothing
          // is declared yet. Saying so beats an empty table, which reads broken.
          <EmptyState title={t("funnelEmptyTitle")} description={t("funnelEmptyBody")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("step")}</TableHead>
                  <TableHead className="text-right">{t("members")}</TableHead>
                  <TableHead className="text-right">{t("share")}</TableHead>
                  <TableHead className="text-right">{t("lost")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reading.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.id}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.members}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Pct value={row.share} />
                      {/* A step larger than the first is not an error — the
                          steps are independent predicates, not a path. Marked
                          rather than hidden, because it usually means the order
                          in the config is wrong. */}
                      {row.share > 1 ? (
                        <Badge variant="outline" className="ml-2">
                          {t("orderWarning")}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.lost > 0 ? row.lost : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {reading.unlisted.length > 0 ? (
          <Callout variant="info" title={t("unlistedTitle")}>
            {t("unlistedBody", { events: reading.unlisted.map((u) => u.event).join(", ") })}
          </Callout>
        ) : null}
      </CardContent>
    </Card>
  );
}

export async function Cohorts({ rows }: { rows: readonly CohortRow[] }) {
  const t = await getTranslations("metricsAdmin");
  const weeks = rows[0]?.weeks.length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle level="h2">{t("cohortsTitle")}</CardTitle>
        <CardDescription>{t("cohortsSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState title={t("cohortsEmptyTitle")} description={t("cohortsEmptyBody")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("cohort")}</TableHead>
                  <TableHead className="text-right">{t("size")}</TableHead>
                  {Array.from({ length: weeks }, (_, w) => (
                    <TableHead key={w} className="text-right">
                      {t("week", { n: w })}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.cohort}>
                    <TableCell className="font-medium">
                      <Day value={row.cohort} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.size}</TableCell>
                    {row.weeks.map((share, w) => (
                      <TableCell key={w} className="text-muted-foreground text-right tabular-nums">
                        <Pct value={share} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export async function SplitCard({ split }: { split: SplitTestReading }) {
  const t = await getTranslations("metricsAdmin");
  const { experiment, variants, reading } = split;

  return (
    <Card>
      <CardHeader>
        <CardTitle level="h2">{experiment.id}</CardTitle>
        <CardDescription>
          {t("splitSubtitle", { exposure: experiment.exposure, goal: experiment.goal })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("variant")}</TableHead>
                <TableHead className="text-right">{t("exposed")}</TableHead>
                <TableHead className="text-right">{t("reached")}</TableHead>
                <TableHead className="text-right">{t("rate")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {variants.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">
                    {v.id}
                    {reading?.leader === v.id ? (
                      <Badge className="ml-2">{t("leader")}</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{v.exposed}</TableCell>
                  <TableCell className="text-right tabular-nums">{v.reached}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {v.exposed > 0 ? <Pct value={v.reached / v.exposed} /> : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* 🚨 NOT cosmetics, and the one part of this page not to redesign away.
            Two percentages and an arrow invite a decision, and at the sample
            sizes a young SaaS has that decision is usually noise. The verdict is
            a SENTENCE, and below the floors it says so plainly. */}
        {reading === null ? (
          <Callout variant="info" title={t("splitManyVariantsTitle")}>
            {t("splitManyVariantsBody")}
          </Callout>
        ) : reading.verdict === "not-enough-data" ? (
          <Callout variant="info" title={t("verdictNotEnoughTitle")}>
            {t("verdictNotEnoughBody", {
              exposed: MIN_EXPOSED_PER_VARIANT,
              reached: MIN_CONVERSIONS_PER_VARIANT,
            })}
          </Callout>
        ) : reading.verdict === "no-difference" ? (
          <Callout variant="info" title={t("verdictNoDifferenceTitle")}>
            {t("verdictNoDifferenceBody")}
          </Callout>
        ) : (
          <Callout
            variant="success"
            title={t("verdictDifferenceTitle", { leader: reading.leader ?? "" })}
          >
            {t("verdictDifferenceBody")}
          </Callout>
        )}
      </CardContent>
    </Card>
  );
}

export async function NoSplits() {
  const t = await getTranslations("metricsAdmin");
  return (
    <Card>
      <CardHeader>
        <CardTitle level="h2">{t("splitsTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <EmptyState title={t("splitsEmptyTitle")} description={t("splitsEmptyBody")} />
      </CardContent>
    </Card>
  );
}
