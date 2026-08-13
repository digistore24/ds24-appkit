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
  // 🚨 LEFT joins, and `course_slug` may be null — the .ts twin argues it in
  // full: a bare lesson slug is a coordinate the person cannot place once an
  // app holds several courses, and an INNER join would drop a completion whose
  // lesson has since been deleted. The two halves must say the same thing;
  // `scripts/modules/privacy.test.ts` compares them against the manifest.
  const coursesCompletions = memberId
    ? await sql`
        select c.slug as course_slug, cc.unit_slug, cc.completed_at
        from courses_completions cc
        left join courses_units u on u.slug = cc.unit_slug
        left join courses_blocks b on b.id = u.block_id
        left join courses_courses c on c.id = b.course_id
        where cc.member_id = ${memberId}
        order by cc.completed_at
      `
    : [];

  // `replied_by` is deliberately absent — see the .ts twin: who answered is a
  // third party's identity, not this member's data.
  const coursesSubmissions = memberId
    ? await sql`
        select c.slug as course_slug, s.unit_slug, s.body, s.submitted_at, s.reply, s.replied_at
        from courses_submissions s
        left join courses_units u on u.slug = s.unit_slug
        left join courses_blocks b on b.id = u.block_id
        left join courses_courses c on c.id = b.course_id
        where s.member_id = ${memberId}
        order by s.submitted_at
      `
    : [];

  return { coursesCompletions, coursesSubmissions };
}
