// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Shared helpers for the user management scripts (plain Node ESM).
//
// Access to the same Postgres as the app — connection via DATABASE_URL
// (see db/index.ts). No need to import the TypeScript DB layer; the
// users table is stable (id, email, name, role).
import { connectUtc } from "../lib/pg-utc.mjs";
import "../lib/env.mjs";

/** Minimal flag parser: --key value  and  --flag (boolean). */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

// Canonical roles (convention from db/schema.ts; the app's copy of this list
// is ROLES in lib/roles.ts — a bare-Node script cannot import that, so this
// second copy exists by necessity and the two are kept in step by hand):
//   "owner"     = SAAS operator (admin)
//   "moderator" = trusted member who keeps community rooms clean — NOT an admin
//   "member"    = regular customer
export const CANONICAL_ROLES = ["owner", "moderator", "member"];

// Friendly aliases → canonical. That way both --role owner and --role admin
// work (member/user likewise), without mixing two vocabularies in the code.
// "moderator" has no alias: nothing shorter is a name anybody reaches for.
const ROLE_ALIASES = { admin: "owner", user: "member" };

/**
 * Normalises a role input to a canonical role.
 * @returns one of CANONICAL_ROLES, or null for invalid input.
 */
export function resolveRole(input) {
  if (input == null || input === true) return null;
  const v = String(input).trim().toLowerCase();
  if (CANONICAL_ROLES.includes(v)) return v;
  if (Object.prototype.hasOwnProperty.call(ROLE_ALIASES, v)) {
    return ROLE_ALIASES[v];
  }
  return null;
}

/** Reads DATABASE_URL or aborts with a clear message. */
export function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "ERROR: DATABASE_URL is not set. Locally: `docker compose up -d`\n" +
        "and set DATABASE_URL in .env (see .env.example).",
    );
    process.exit(2);
  }
  return url;
}

/** Opens a short-lived Postgres connection (max 1) for a script. */
export function connect() {
  return connectUtc(requireDatabaseUrl(), { max: 1 });
}
