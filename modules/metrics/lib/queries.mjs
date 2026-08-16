// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Every query this module asks, written once.
//
// ── Why a `.mjs`, and why each function takes its own tag ──────────────────
// Two runtimes need these: the app (Drizzle, TypeScript, `db.execute(sql…)`)
// and the command `node run.mjs metrics-report`, which is bare Node with no
// bundler and cannot import TypeScript. The template's usual answer to that
// split is two copies with a test clamping them together — that is what the
// two `privacy/sections` halves are, because there one side is Drizzle's query
// BUILDER and the other is raw SQL, and no single expression can be both.
//
// Here it can. Drizzle's `sql` and postgres.js's `sql` are both **tagged
// template functions**, so a function that takes the tag as an argument is one
// query with two executors — and parameters stay bound on each side rather than
// being pasted into a string. There is nothing to keep in step, because there is
// only one of it.
//
// ⚠️ **No conditional fragments, deliberately.** Nesting one tagged fragment
// inside another works differently in the two libraries, so "all time" is a very
// old date rather than a missing `where`. One shape, both runtimes.
//
// 🚨 **Dates cross as `YYYY-MM-DD` strings with an explicit `::date`, never as a
// `Date`.** postgres.js binds parameters as text and throws
// `ERR_INVALID_ARG_TYPE` on a Date — measured while building this module, and
// the rule `db/sql-date-param.test.ts` exists for.

/** The "since the beginning" bound. Older than any row this app can hold. */
export const EPOCH_DAY = "1970-01-01";

/** The periods both readers offer, and how many days each covers. */
export const PERIOD_DAYS = { "7d": 7, "30d": 30, "90d": 90, all: 0 };

/**
 * The first day a period covers, as `YYYY-MM-DD` — `EPOCH_DAY` for "all".
 *
 * Calendar days back from the start of today in UTC, never `n * 86_400_000`
 * from now: the second form leaves a partial first bucket and drifts by an hour
 * twice a year.
 *
 * @param {string} period one of `PERIOD_DAYS`; anything else counts as "all"
 * @param {Date} now
 * @returns {string}
 */
export function fromDayFor(period, now) {
  const days = PERIOD_DAYS[period] ?? 0;
  if (days === 0) return EPOCH_DAY;
  const from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days + 1),
  );
  return from.toISOString().slice(0, 10);
}

/**
 * Distinct members and raw occurrences per milestone.
 *
 * @param {Function} tag a tagged-template function — Drizzle's `sql` or postgres.js's
 * @param {string} fromDay `YYYY-MM-DD`, inclusive
 */
export function funnelQuery(tag, fromDay) {
  return tag`
    select event,
           count(distinct member_id)::int as members,
           count(*)::int as events
    from metrics_events
    where occurred_at >= ${fromDay}::date
    group by event
  `;
}

/**
 * Who came back, by the week they first appeared.
 *
 * Deliberately unbounded in time: a cohort is only meaningful next to the ones
 * before it, and cutting the window would drop the very rows the comparison
 * needs. The caller trims to the last N weeks.
 */
export function cohortQuery(tag) {
  return tag`
    with firsts as (
      select member_id, min(occurred_at) as first_at
      from metrics_events
      where member_id is not null
      group by member_id
    )
    select to_char(date_trunc('week', f.first_at), 'YYYY-MM-DD') as cohort,
           floor(extract(epoch from (e.occurred_at - f.first_at)) / 604800)::int as week,
           count(distinct e.member_id)::int as members
    from firsts f
    join metrics_events e on e.member_id = f.member_id
    group by 1, 2
    order by 1, 2
  `;
}

/**
 * One split test: who was in it, and who then succeeded.
 *
 * 🚨 Two events, not one. `exposure` is the denominator and `goal` the
 * numerator; if only the goal carried the experiment every variant would read
 * 100% and the comparison could not differ.
 */
export function splitQuery(tag, { id, exposure, goal, fromDay }) {
  return tag`
    select variant,
           count(distinct member_id) filter (where event = ${exposure})::int as exposed,
           count(distinct member_id) filter (where event = ${goal})::int as reached
    from metrics_events
    where experiment = ${id}
      and member_id is not null
      and occurred_at >= ${fromDay}::date
    group by variant
  `;
}

/**
 * Recompute whole days of `metrics_daily` from `metrics_events`.
 *
 * Idempotent by the unique index: a day is recomputed, never accumulated, so a
 * missed run repairs itself and a second run costs one query.
 *
 * ⚠️ The bucket is a **UTC** day and may never become a setting — once the
 * events are pruned this table is all that is left, and a boundary that moved
 * would re-cut history nobody can recompute.
 */
export function rollupQuery(tag, fromDay) {
  return tag`
    insert into metrics_daily (id, day, event, experiment, variant, members, events, computed_at)
    select
      gen_random_uuid()::text,
      to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD'),
      event,
      experiment,
      variant,
      count(distinct member_id)::int,
      count(*)::int,
      now()
    from metrics_events
    where occurred_at >= ${fromDay}::date
    group by 2, 3, 4, 5
    on conflict (day, event, experiment, variant) do update
      set members = excluded.members,
          events = excluded.events,
          computed_at = excluded.computed_at
  `;
}
