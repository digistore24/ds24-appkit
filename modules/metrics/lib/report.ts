// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Everything the dashboard and the command read — the queries, and nothing
// about React.
//
// ── One time zone, and it is UTC ───────────────────────────────────────────
// 🚨 Every bucket here is a UTC day or a UTC week, and that is not a
// simplification to be fixed later. `metrics_daily` stores a day as a string
// computed in UTC, and once the events behind it are pruned that table is all
// there is — so a boundary that moved when somebody changed a display setting
// would silently re-cut history that can no longer be recomputed. The core's
// `lib/ai/report.ts` does convert to a display zone, and is right to: it never
// throws its rows away. This module deliberately does not import that logic
// either, because a module sold into somebody else's app must not depend on the
// internals of a core file that can change under it.
//
// ── Reading the URL ────────────────────────────────────────────────────────
// The same shape as `lib/ai/report.ts`: an unknown value falls back to the
// default rather than throwing, because these come from a query string and
// therefore from anybody.
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { cohortQuery, funnelQuery, splitQuery, fromDayFor } from "./queries.mjs";
import { funnelSteps, experiments, type ExperimentConfig } from "./config";
import {
  cohortsFrom,
  funnelReadingFrom,
  splitReadingFrom,
  type FunnelRow,
  type SplitReading,
  type VariantCount,
} from "../rules.mjs";

export const PERIODS = ["7d", "30d", "90d", "all"] as const;
export type Period = (typeof PERIODS)[number];

export interface ReportView {
  readonly period: Period;
}

function oneOf<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]) {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : fallback;
}

export function parseView(params: Record<string, string | string[] | undefined>): ReportView {
  const raw = params.period;
  return { period: oneOf(Array.isArray(raw) ? raw[0] : raw, PERIODS, "30d") };
}

/**
 * The period's first day as `YYYY-MM-DD` — the epoch for "everything".
 *
 * The arithmetic lives in `queries.mjs` beside the queries that take it, so the
 * command computes the same bound rather than its own. 🚨 A string, never a
 * `Date`: postgres.js binds parameters as text and throws
 * `ERR_INVALID_ARG_TYPE` on a `Date`, which is the rule
 * `db/sql-date-param.test.ts` exists for.
 */
export function fromDay(view: ReportView, now: Date): string {
  return fromDayFor(view.period, now);
}

// ── The funnel ─────────────────────────────────────────────────────────────

export interface FunnelReading {
  /** The steps in the order the config names them. Empty when none are declared. */
  readonly rows: readonly (FunnelRow & { readonly events: number })[];
  /** Milestones that were recorded but are in no declared step. */
  readonly unlisted: readonly { readonly event: string; readonly members: number }[];
}

export async function funnelFor(view: ReportView, now: Date): Promise<FunnelReading> {
  const rows = (await db.execute(
    funnelQuery(sql, fromDay(view, now)),
  )) as unknown as { event: string; members: number; events: number }[];

  // The shaping is in `rules.mjs` so the command produces the same reading
  // rather than its own.
  return funnelReadingFrom(rows, funnelSteps());
}

// ── Retention ──────────────────────────────────────────────────────────────

export interface CohortRow {
  /** Monday of the week this cohort first appeared, as `YYYY-MM-DD` (UTC). */
  readonly cohort: string;
  /** Members in the cohort — its week 0. */
  readonly size: number;
  /** Share of the cohort still doing something in week N, index 0 = week 0. */
  readonly weeks: readonly number[];
}

/**
 * Who came back, by the week they first appeared.
 *
 * ⚠️ **This is ACTIVITY retention, not billing retention.** It answers "did
 * they come back and do something", which is what an onboarding change can move.
 * Whether they are still PAYING is a different question with a different answer
 * — `grants` and `orders` hold it, and the admin purchases page already shows
 * it. Reading one as the other is the commonest way to be pleased about the
 * wrong number.
 */
export async function cohortsFor(weeks = 8): Promise<CohortRow[]> {
  const rows = (await db.execute(cohortQuery(sql))) as unknown as {
    cohort: string;
    week: number;
    members: number;
  }[];

  return cohortsFrom(rows, weeks);
}

// ── Split tests ────────────────────────────────────────────────────────────

export interface SplitTestReading {
  readonly experiment: ExperimentConfig;
  readonly variants: readonly VariantCount[];
  /** Only computed for exactly two variants — see below. */
  readonly reading: SplitReading | null;
}

export async function splitFor(
  experiment: ExperimentConfig,
  view: ReportView,
  now: Date,
): Promise<SplitTestReading> {
  const rows = (await db.execute(
    splitQuery(sql, {
      id: experiment.id,
      exposure: experiment.exposure,
      goal: experiment.goal,
      fromDay: fromDay(view, now),
    }),
  )) as unknown as { variant: string; exposed: number; reached: number }[];

  return { experiment, ...splitReadingFrom(experiment, rows) };
}

// ── Everything at once ─────────────────────────────────────────────────────

export interface Report {
  readonly view: ReportView;
  readonly generatedAt: string;
  readonly funnel: FunnelReading;
  readonly cohorts: readonly CohortRow[];
  readonly splits: readonly SplitTestReading[];
}

export async function reportFor(view: ReportView, now: Date): Promise<Report> {
  const [funnel, cohorts, splits] = await Promise.all([
    funnelFor(view, now),
    cohortsFor(),
    Promise.all(experiments().map((e) => splitFor(e, view, now))),
  ]);
  return { view, generatedAt: now.toISOString(), funnel, cohorts, splits };
}
