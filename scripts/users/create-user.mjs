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
import { ensureOperatorPreviewGrants } from "../../lib/entitlements/preview.mjs";
import { syncEnvFromAppEnv } from "../ds24/_env.mjs";
import { isLocalDatabaseUrl } from "../lib/media-env.mjs";

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
    returning id, email, role, name
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
    // An owner created here has bought nothing, so in DEV she is locked out of
    // the very things she sells — chat, gated activities, rooms, courses
    // (measured 2026-09-15). ensureOperatorPreviewGrants is a no-op outside
    // development and on a second run. Its own try/catch: a comp that could not
    // be written must not turn a created account into an error.
    // `dev` is decided HERE, not from APP_ENV alone: docs/DEPLOY.md creates the
    // first PROD owner with this very command and a production DATABASE_URL in
    // the shell of a laptop whose APP_ENV is unset. A comp must never land in
    // that database (reviewed 2026-09-15).
    try {
      const preview = await ensureOperatorPreviewGrants({
        memberId: row.id,
        dev:
          syncEnvFromAppEnv(process.env.APP_ENV) === "dev" &&
          isLocalDatabaseUrl(process.env.DATABASE_URL),
        sql,
      });
      if (preview.granted?.length) {
        console.log(
          `  → DEV preview: this owner now holds every product on sale ` +
            `(${preview.granted.join(", ")}) — revoke under Users → that account.`,
        );
      }
    } catch (e) {
      console.log(`  → DEV preview: not added (${e.message}).`);
    }
  }
} catch (e) {
  console.error("ERROR while writing to the database:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
