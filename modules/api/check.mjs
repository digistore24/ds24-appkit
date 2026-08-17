// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Checks the HTTP API — settings, and (with --live) a real round-trip.
//
//   node run.mjs api-check
//   node run.mjs api-check --live
//   node run.mjs api-check --live --email you@example.com
//
// Two jobs, the same split as ai-check:
//
//  1. **Settings.** `config/api.json` against `config/digistore-products.json`.
//     `npm run test` fails on the same problems, but it says "expected [] to
//     equal [...]"; this says which field and what to put there.
//  2. **Does it actually answer?** `--live` mints a temporary key, calls
//     `GET /api/v1/me` against the running app, and revokes the key again.
//     That is the only check that covers the whole path — settings, route,
//     guard, auth, audience. Green tests are no proof that an endpoint
//     answers.
//
// Plain Node, no bundler, no TypeScript, no dependency beyond what the app
// already has — it has to run on Linux, macOS and in a Git Bash on Windows
// (CLAUDE.md, "Three systems"). `fetch` is built in; there is no curl here.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { connect, parseArgs } from "../../scripts/users/_db.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// Kept in step with modules/api/keys/rules.ts by hand — this script cannot import
// the TypeScript. If the prefix ever changes there, it changes here too; a
// mismatch shows up immediately as a --live run that gets a 401.
const KEY_PREFIX = "ds24api_";

function readJson(...parts) {
  return JSON.parse(readFileSync(join(ROOT, ...parts), "utf8"));
}

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

// ── 1. The settings ─────────────────────────────────────────────────────────

const config = readJson("config", "api.json");
const registry = readJson("config", "digistore-products.json");

const problems = [];

if (typeof config.enabled !== "boolean") {
  problems.push('"enabled" must be true or false.');
}

if (config.selfService !== undefined && typeof config.selfService !== "boolean") {
  problems.push('"selfService" must be true or false.');
}

if (config.requiresPlan != null) {
  const product = registry.products?.[config.requiresPlan];
  if (!product) {
    problems.push(
      `"requiresPlan": there is no product "${config.requiresPlan}" in config/digistore-products.json.`,
    );
  } else if (product.kind === "token") {
    problems.push(
      `"requiresPlan": "${config.requiresPlan}" is a token package. A balance is not an ` +
        `entitlement, so hasPlan() answers false for it for ever — every customer would be locked out.`,
    );
  }
}

console.log("HTTP API\n");
console.log(`  enabled       ${config.enabled ? "yes" : "no  (config/api.json → \"enabled\": true)"}`);
console.log(`  requiresPlan  ${config.requiresPlan ?? "— (every member)"}`);
console.log(
  `  selfService   ${config.selfService === true ? "yes (the App keys card is on /dashboard/account)" : "no  (no card — keys come from POST /api/v1/auth/token)"}`,
);

if (problems.length > 0) {
  console.error("\nProblems in config/api.json:");
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const base = `${appUrl}/api/v1`;
console.log(`  endpoints     ${base}/…`);

if (!config.enabled) {
  console.log(
    "\nThe API is switched off, so every /api/v1 path answers 404. Set \"enabled\": true " +
      "in config/api.json once your app is meant to have an external client — the skill " +
      "`mobile-companion` walks through that.",
  );
  process.exit(0);
}

console.log("\n✓ The settings are coherent.");

// Who can actually GET a key, spelled out. "enabled: true" with no card and a
// plan gate is a perfectly good arrangement and it looks like a broken one from
// the account page, so the check says which of the two doors is open.
if (config.selfService !== true || config.requiresPlan != null) {
  const doors = [];
  if (config.selfService === true) doors.push("the card on /dashboard/account");
  doors.push("POST /api/v1/auth/token (email + password)");
  console.log(
    `\n  A key comes from: ${doors.join(", or ")}.` +
      (config.requiresPlan != null
        ? `\n  Only members holding "${config.requiresPlan}" may mint or use one.`
        : "") +
      (config.selfService !== true
        ? "\n  Members see no App keys card; those who already hold keys can still revoke them."
        : ""),
  );
}

const args = parseArgs(process.argv.slice(2));
if (!args.live) {
  console.log("\nTo actually call it (the app has to be running):  node run.mjs api-check --live");
  process.exit(0);
}

// ── 2. The round-trip ───────────────────────────────────────────────────────

const sql = connect();

try {
  // Whose key. A member's view is the one that matters.
  const wanted = typeof args.email === "string" ? args.email.trim().toLowerCase() : null;
  const [member] = wanted
    ? await sql`select id, email from users where lower(email) = ${wanted} limit 1`
    : await sql`select id, email from users order by "createdAt" asc limit 1`;

  if (!member) {
    fail(
      wanted
        ? `No account for ${wanted}. Create one: node run.mjs user-create --email ${wanted} --apply`
        : "There is no account in the database yet. Create one: node run.mjs user-create --email you@example.com --apply",
    );
  }

  // A throw-away key, revoked in the `finally` below whatever happens. It is
  // written straight to the table rather than through the UI so this stays one
  // command; it is a real key for its lifetime and the guard cannot tell the
  // difference — which is the point.
  //
  // ⚠️ The five minutes are `sql.typed.utcTimestamp(...)` and not a bare
  // `${date}`: a `Date` is typed timestamptz on the wire and `expires_at` is
  // `timestamp`, so Postgres would convert it in the database session's zone —
  // on a server at UTC+2 the "five minute" key would live two hours and five
  // minutes, and on one west of UTC it would be born expired and this check
  // would report a 401 as if the route were broken. `scripts/lib/pg-utc.mjs`.
  const secret = KEY_PREFIX + randomBytes(32).toString("base64url");
  const keyId = randomUUID();
  await sql`
    insert into api_keys (id, member_id, name, token_hash, prefix, scope, audience, expires_at)
    values (
      ${keyId}, ${member.id}, ${"api-check (temporary)"},
      ${createHash("sha256").update(secret, "utf8").digest("hex")},
      ${secret.slice(0, KEY_PREFIX.length + 4)}, ${"read"}, ${"api"},
      ${sql.typed.utcTimestamp(new Date(Date.now() + 5 * 60_000))}
    )`;

  console.log(`\nCalling ${base}/me as ${member.email} …`);

  let response;
  try {
    response = await fetch(`${base}/me`, {
      headers: { authorization: `Bearer ${secret}`, accept: "application/json" },
    });
  } catch (error) {
    fail(
      `Could not reach ${base}/me: ${error.message}\n` +
        `  Is the app running? node run.mjs status — and check APP_URL in .env.`,
    );
  }

  const text = await response.text();
  if (!response.ok) {
    fail(
      `GET /api/v1/me answered HTTP ${response.status}: ${text.slice(0, 300)}\n` +
        `  A 404 with the switch on means the app is still running the old config — restart it.`,
    );
  }

  const me = JSON.parse(text);
  console.log(`  ✓ GET /me      ${me.email} (role ${me.role})`);

  // 🚨 The closing line follows `selfService`, because it used to contradict
  // this run's own header eleven lines up: with the switch off, the settings
  // block says "no card — keys come from POST /api/v1/auth/token" and this
  // sentence still sent the reader to a card that renders for nobody
  // (`keysCardMode()` hides it for a member holding no key, and shows a
  // revoke-only list to one who does). Two sentences, one output, opposite
  // answers — and the wrong one is the one somebody acts on.
  console.log(
    `\n✓ The API answers.\n\nA program signs in like this (docs/api.md):\n\n` +
      `  POST ${base}/auth/token\n` +
      `  { "email": "…", "password": "…", "name": "My phone" }\n\n` +
      (config.selfService === true
        ? `Members can also create keys by hand at /dashboard/account.`
        : `That is the only door: with "selfService": false nobody creates a key on ` +
          `/dashboard/account — a member holding one sees it there to revoke it, and ` +
          `nothing more.`),
  );

  // Revoked rather than deleted, so the row is still there to be seen if
  // somebody wonders what that key was.
  await sql`update api_keys set revoked_at = now() where id = ${keyId}`;
} finally {
  await sql.end();
}
