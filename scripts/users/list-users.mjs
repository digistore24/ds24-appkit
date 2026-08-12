#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Lists app users with their role (read-only — no --apply).
//
// Usage:
//   node scripts/users/list-users.mjs
//   node scripts/users/list-users.mjs --role owner       # operators only
//   node scripts/users/list-users.mjs --role moderator   # moderators only
import { parseArgs, resolveRole, connect, CANONICAL_ROLES } from "./_db.mjs";

const args = parseArgs(process.argv.slice(2));
const roleFilter = args.role === undefined ? null : resolveRole(args.role);
if (args.role !== undefined && roleFilter === null) {
  // Derived, never typed out: this line is what an operator reads the moment
  // they mistype, and a hand-kept list here said "owner|member" for a whole
  // release after the third role shipped. `create-user.mjs` does the same.
  console.error(
    `ERROR: invalid role for --role. Allowed: ${CANONICAL_ROLES.join(", ")} ` +
      "(aliases: admin, user).",
  );
  process.exit(2);
}

const sql = connect();
try {
  const rows = roleFilter
    ? await sql`select email, role, name from users where role = ${roleFilter} order by role desc, email`
    : await sql`select email, role, name from users order by role desc, email`;

  if (rows.length === 0) {
    console.log("No users found.");
  } else {
    for (const r of rows) {
      console.log(`${r.role.padEnd(7)}  ${r.email ?? "(no email)"}`);
    }
    console.log(`\n${rows.length} user(s).`);
  }
} catch (e) {
  console.error("ERROR while reading the database:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
