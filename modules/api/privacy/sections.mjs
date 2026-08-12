// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The bare-Node twin of `sections.ts` — the operator's `node run.mjs
// data-export` runs with no bundler and cannot import TypeScript, so the query
// exists a second time as raw SQL.
//
// `scripts/modules/privacy.test.ts` compares both halves with the manifest.

export const sections = ["apiKeys"];

/**
 * @param {import("postgres").Sql} sql
 * @param {string | null} memberId
 */
export async function build(sql, memberId) {
  // ⛔ `token_hash` is not selected — see the reasoning in `sections.ts`. It is
  // the credential, and this file's output is handed to a person.
  const rows = memberId
    ? await sql`
        select name, prefix, scope, audience,
               created_at, last_used_at, expires_at, revoked_at
        from api_keys
        where member_id = ${memberId}
        order by created_at
      `
    : [];
  return { apiKeys: rows };
}
