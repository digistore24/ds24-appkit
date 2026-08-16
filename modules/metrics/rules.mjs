// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The decisions, with no database under them — which variant a member is in,
// where a funnel loses people, and whether a split test may be read at all.
//
// PURE. No `@/db`, no React, no `node:` builtins, no clock. Everything here
// takes plain values and returns plain values, which is what makes
// `rules.test.ts` able to state the awkward cases (nobody in the funnel, a
// variant with no traffic, a weight of zero) without a fixture.
//
// ── Why `.mjs` and not `.ts` ───────────────────────────────────────────────
// Two runtimes need these: the app, and `node run.mjs metrics-report`, which is
// bare Node and cannot import TypeScript. The same split the core answers with
// `lib/cron/rules.mjs`. The types travel as JSDoc, so a TypeScript caller still
// gets them — `tsconfig.json` has `allowJs`.
//
// 🚨 **The verdict below has to be reachable from the command**, not only from
// the page. An agent reading raw counts out of a JSON file would happily
// announce a winner that is noise; the refusal has to travel with the numbers.

/**
 * One side of a split test.
 * @typedef {{ id: string, weight: number }} Variant
 */

/**
 * A split test, as far as the assignment is concerned.
 * @typedef {{ id: string, variants: Variant[] }} Experiment
 */

/**
 * A 32-bit FNV-1a hash of a string.
 *
 * Written out rather than imported because this file has to stay free of
 * `node:crypto` — it is read by the report, by the command, and one day by
 * something running at the edge. It is not a security primitive and is not used
 * as one: it decides which half of an experiment somebody is in, and the only
 * property that matters is that the same input gives the same answer
 * everywhere, for ever.
 *
 * @param {string} value
 * @returns {number}
 */
export function hash32(value) {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    // The FNV prime, as shifts, because `h * 16777619` loses precision once the
    // product passes 2^53.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * Which variant this member is in — the same answer every time, with no row
 * written anywhere.
 *
 * 🚨 **Stability is the whole contract.** A member who saw variant A on Monday
 * must see A on Friday, or the experiment measures the switching rather than
 * the change. That is why this is a hash of the pair and not a counter, a
 * random draw or a stored assignment: there is no state to lose, no table to
 * migrate, and no way for two servers to disagree.
 *
 * The experiment id is part of the input so that two experiments do not split
 * the same population down the same line — otherwise everybody who was in A of
 * the first would be in A of the second, and the second would measure the
 * first.
 *
 * Returns `null` when nobody can be assigned: no variants, or every weight at
 * zero. A caller that gets `null` records no variant, which is the honest
 * result — "this member was in no experiment" rather than a default side.
 *
 * @param {string} memberId
 * @param {Experiment} experiment
 * @returns {string | null}
 */
export function variantFor(memberId, experiment) {
  const usable = experiment.variants.filter((v) => Number.isFinite(v.weight) && v.weight > 0);
  const total = usable.reduce((sum, v) => sum + v.weight, 0);
  if (usable.length === 0 || total <= 0) return null;

  // A point in [0, total) derived from the pair, then walked down the list.
  const point = (hash32(`${experiment.id}:${memberId}`) / 0x100000000) * total;
  let seen = 0;
  for (const v of usable) {
    seen += v.weight;
    if (point < seen) return v.id;
  }
  // Floating point can leave `point` a hair above the last boundary.
  return usable[usable.length - 1].id;
}

/**
 * One step of the funnel, as counted.
 * @typedef {{ id: string, members: number }} StepCount
 */

/**
 * A step with the two numbers a reader actually wants.
 * @typedef {{ id: string, members: number, share: number, lost: number }} FunnelRow
 */

/**
 * The funnel, as percentages of the first step and losses between steps.
 *
 * ⚠️ **A step can be larger than the one before it, and that is a finding
 * rather than an error.** The steps are independent predicates over app state,
 * not a sequence somebody walks — a member can top up a balance without ever
 * buying a plan. So `lost` floors at zero and the share is computed against the
 * first step rather than the previous one; a row whose share is above 1 is
 * telling the operator their steps are in the wrong order.
 *
 * @param {StepCount[]} steps
 * @returns {FunnelRow[]}
 */
export function funnelFrom(steps) {
  if (steps.length === 0) return [];
  const first = steps[0].members;
  return steps.map((step, i) => ({
    ...step,
    share: first > 0 ? step.members / first : 0,
    lost: i === 0 ? 0 : Math.max(0, steps[i - 1].members - step.members),
  }));
}

/**
 * The funnel as the readers want it: the declared steps in order, plus the
 * milestones that were recorded and belong to no step.
 *
 * ⚠️ The unlisted half is surfaced rather than hidden. An event nobody put in
 * `funnel` is usually a `track()` call whose id was mistyped, and it would
 * otherwise be written for ever and read by nothing.
 *
 * @param {{ event: string, members: number, events: number }[]} rows counted per event
 * @param {string[]} declared the funnel from the config, in order
 */
export function funnelReadingFrom(rows, declared) {
  const byEvent = new Map(rows.map((r) => [r.event, r]));
  const counted = funnelFrom(declared.map((id) => ({ id, members: byEvent.get(id)?.members ?? 0 })));
  return {
    rows: counted.map((row) => ({ ...row, events: byEvent.get(row.id)?.events ?? 0 })),
    unlisted: rows
      .filter((r) => !declared.includes(r.event))
      .map((r) => ({ event: r.event, members: r.members }))
      .sort((a, b) => b.members - a.members),
  };
}

/**
 * Cohort rows, folded into one row per cohort with a share per week.
 *
 * Shares rather than raw counts: two cohorts of different sizes are only
 * comparable as percentages. A cohort of zero gives zeroes rather than NaN,
 * which would render as an empty cell and read as a fault in the app.
 *
 * @param {{ cohort: string, week: number, members: number }[]} rows
 * @param {number} weeks how many weeks wide the grid is
 */
export function cohortsFrom(rows, weeks) {
  const byCohort = new Map();
  for (const row of rows) {
    if (row.week < 0 || row.week >= weeks) continue;
    const bucket = byCohort.get(row.cohort) ?? new Map();
    bucket.set(row.week, row.members);
    byCohort.set(row.cohort, bucket);
  }

  return [...byCohort.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([cohort, bucket]) => {
      const size = bucket.get(0) ?? 0;
      return {
        cohort,
        size,
        weeks: Array.from({ length: weeks }, (_, w) => (size > 0 ? (bucket.get(w) ?? 0) / size : 0)),
      };
    });
}

/**
 * One split test's counts, per declared variant, and the verdict.
 *
 * 🚨 Two variants only. A three-way test compared pairwise inflates the false
 * positive rate — three comparisons at 95% each is not 95% — and this module
 * corrects for nothing. Rather than a reading it cannot defend it returns
 * `null`, and the caller says so.
 *
 * @param {{ id: string, variants: Variant[] }} experiment
 * @param {{ variant: string, exposed: number, reached: number }[]} rows
 */
export function splitReadingFrom(experiment, rows) {
  const byVariant = new Map(rows.map((r) => [r.variant, r]));
  const variants = experiment.variants.map((v) => ({
    id: v.id,
    exposed: byVariant.get(v.id)?.exposed ?? 0,
    reached: byVariant.get(v.id)?.reached ?? 0,
  }));
  const reading = variants.length === 2 ? readSplit(variants[0], variants[1]) : null;
  return { variants, reading };
}

/**
 * The smallest experiment this module will read out.
 *
 * Both have to be met, per variant. 100 exposed is where a difference of a few
 * points stops being one person; 10 conversions is the point below which the
 * proportion itself is too coarse for the test underneath to mean anything.
 * They are deliberately blunt: an operator with 40 customers should be told to
 * wait, not handed a number with three decimal places.
 */
export const MIN_EXPOSED_PER_VARIANT = 100;
export const MIN_CONVERSIONS_PER_VARIANT = 10;

/** Two-sided 95%. The z above which a difference is called a difference. */
export const Z_95 = 1.96;

/**
 * One side of a split test, as counted.
 * @typedef {{ id: string, exposed: number, reached: number }} VariantCount
 */

/**
 * @typedef {"not-enough-data" | "no-difference" | "difference"} SplitVerdict
 */

/**
 * @typedef {{ verdict: SplitVerdict, z: number | null, leader: string | null }} SplitReading
 */

/**
 * What may be said about two variants — and mostly the answer is "not yet".
 *
 * 🚨 **This function exists to REFUSE.** A dashboard that shows two percentages
 * and an arrow invites a decision, and at the sample sizes a young SaaS
 * actually has, that decision is usually noise. So the default is
 * `not-enough-data`, the caller renders it as a sentence rather than a figure,
 * and a winner is only ever named when both variants clear the floors above AND
 * a two-proportion z-test clears 95%.
 *
 * ⚠️ It is a guardrail, not a statistician. It assumes the two groups are
 * independent and that the operator did not change the app mid-flight, and it
 * corrects for nothing when several experiments run at once. Everything it can
 * be wrong about is a reason to run longer, never a reason to trust a smaller
 * number.
 *
 * @param {VariantCount} a
 * @param {VariantCount} b
 * @returns {SplitReading}
 */
export function readSplit(a, b) {
  const enough = (v) =>
    v.exposed >= MIN_EXPOSED_PER_VARIANT && v.reached >= MIN_CONVERSIONS_PER_VARIANT;
  if (!enough(a) || !enough(b)) {
    return { verdict: "not-enough-data", z: null, leader: null };
  }

  const pa = a.reached / a.exposed;
  const pb = b.reached / b.exposed;
  // Pooled proportion — the null hypothesis is that both sides share one rate.
  const pooled = (a.reached + b.reached) / (a.exposed + b.exposed);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.exposed + 1 / b.exposed));
  if (!(se > 0)) return { verdict: "not-enough-data", z: null, leader: null };

  const z = (pa - pb) / se;
  if (Math.abs(z) < Z_95) return { verdict: "no-difference", z, leader: null };
  return { verdict: "difference", z, leader: pa > pb ? a.id : b.id };
}
