// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The bare-Node twin of `sections.ts` — the operator's `node run.mjs
// data-export` runs with no bundler and cannot import TypeScript, so the query
// exists a second time as raw SQL.
//
// Both declare the same `sections`, and `scripts/modules/privacy.test.ts`
// compares them with the manifest. That clamp is not ceremony: the core's two
// exports drifted apart once, and one Art. 15 request got two different answers.

export const sections = ["coursesCompletions", "coursesSubmissions"];

/**
 * @param {import("postgres").Sql} sql
 * @param {string | null} memberId
 */
export async function build(sql, memberId) {
  const coursesCompletions = memberId
    ? await sql`
        select unit_slug, completed_at
        from courses_completions
        where member_id = ${memberId}
        order by completed_at
      `
    : [];

  // `replied_by` is deliberately absent — see the .ts twin: who answered is a
  // third party's identity, not this member's data.
  const coursesSubmissions = memberId
    ? await sql`
        select unit_slug, body, submitted_at, reply, replied_at
        from courses_submissions
        where member_id = ${memberId}
        order by submitted_at
      `
    : [];

  return { coursesCompletions, coursesSubmissions };
}
