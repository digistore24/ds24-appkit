// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The bare-Node twin of `sections.ts` — the operator's `node run.mjs
// data-export` runs with no bundler and cannot import TypeScript, so the query
// exists a second time as raw SQL.
//
// Both declare the same `sections`, and `scripts/modules/privacy.test.ts`
// compares them with the manifest. That clamp is not ceremony: the core's two
// exports drifted apart once, and one Art. 15 request got two different
// answers.

export const sections = ["metricsEvents"];

/**
 * @param {import("postgres").Sql} sql
 * @param {string | null} memberId
 */
export async function build(sql, memberId) {
  const rows = memberId
    ? await sql`
        select event, experiment, variant, occurred_at
        from metrics_events
        where member_id = ${memberId}
        order by occurred_at
      `
    : [];
  return { metricsEvents: rows };
}
