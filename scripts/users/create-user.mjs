#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Creates an app user or sets their role (idempotent, keyed by email).
//
// Purpose: the operator needs a sign-in with an elevated role ("owner" = admin)
// before signing in via the email magic link. If the users row already exists
// (created here), the sign-in reuses it — the operator is an owner right away.
//
// Usage:
//   node scripts/users/create-user.mjs --email owner@example.com --role owner
//   node scripts/users/create-user.mjs --email owner@example.com --role owner --apply
//   node scripts/users/create-user.mjs --email customer@example.com            # default: member
//
// Roles: the canonical list is CANONICAL_ROLES in _db.mjs (owner, moderator,
// member) — the error message below derives from it rather than repeating it.
// Aliases: admin→owner, user→member. Default: member.
// Dry run is the default. To execute: --apply
import { randomUUID } from "node:crypto";
import { parseArgs, resolveRole, connect, CANONICAL_ROLES } from "./_db.mjs";

const args = parseArgs(process.argv.slice(2));
const apply = Boolean(args.apply);

const email =
  typeof args.email === "string" ? args.email.trim().toLowerCase() : null;
if (!email || !email.includes("@")) {
  console.error('ERROR: a valid --email "<address>" is required.');
  process.exit(2);
}

// Without --role: default "member". With --role: validate/normalise.
const role = args.role === undefined ? "member" : resolveRole(args.role);
if (role === null) {
  console.error(
    `ERROR: invalid role. Allowed: ${CANONICAL_ROLES.join(", ")} ` +
      "(aliases: admin, user).",
  );
  process.exit(2);
}

const name = typeof args.name === "string" ? args.name : null;

if (!apply) {
  console.log("DRY RUN — the following user would be created/updated:");
  console.log(JSON.stringify({ email, role, name }, null, 2));
  console.log("\nTo execute, call it again with --apply.");
  process.exit(0);
}

const sql = connect();
try {
  // Upsert by email: create a new row or update role/name.
  const [row] = await sql`
    insert into users (id, email, name, role)
    values (${randomUUID()}, ${email}, ${name}, ${role})
    on conflict (email) do update set
      role = excluded.role,
      name = coalesce(excluded.name, users.name)
    returning email, role, name
  `;
  console.log(
    `✓ User set: ${row.email} (role: ${row.role}` +
      (row.name ? `, name: ${row.name}` : "") +
      ")",
  );
  if (row.role === "owner") {
    console.log(
      "  → owner = admin/operator. Sign in now via the email magic link at /login.",
    );
  }
} catch (e) {
  console.error("ERROR while writing to the database:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
