#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Seed — starting data for local development.
//
// Runs automatically at the end of `node run.mjs db-reset` and on its own via `node run.mjs db-seed`.
// It has to be idempotent: running it repeatedly must not break anything (hence
// "on conflict do update/nothing" everywhere).
//
// Development data belongs in here (admin account, example content) — NO real
// customer data and no secrets. And no PRODUCT content: this seed is
// development-only, so anything it creates dies with the local database.
// Content that must exist in PROD goes through `node run.mjs content-apply`
// (docs/content.md).
import { randomUUID } from "node:crypto";
import "../lib/env.mjs";
import { connectUtc } from "../lib/pg-utc.mjs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("ERROR: DATABASE_URL is not set (see .env).");
  process.exit(2);
}

// The admin address is free to choose: put SEED_OWNER_EMAIL in .env (not as a
// command-line prefix — PowerShell has no such syntax; see docs/database.md).
const ownerEmail = (process.env.SEED_OWNER_EMAIL ?? "owner@example.com")
  .trim()
  .toLowerCase();
const memberEmail = (process.env.SEED_MEMBER_EMAIL ?? "customer@example.com")
  .trim()
  .toLowerCase();

const sql = connectUtc(url, { max: 1 });
try {
  for (const [email, role] of [
    [ownerEmail, "owner"],
    [memberEmail, "member"],
  ]) {
    await sql`
      insert into users (id, email, role)
      values (${randomUUID()}, ${email}, ${role})
      on conflict (email) do update set role = excluded.role
    `;
    console.log(`✓ User: ${email} (${role})`);
  }
  console.log(
    "\nSign in: http://localhost:3000/login — magic link to the address above.",
  );
} catch (e) {
  console.error("ERROR in the seed:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
