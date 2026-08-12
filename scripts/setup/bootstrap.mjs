#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `node run.mjs setup-bootstrap` — the first owner and the first setup key, in
// one act, on an environment that has neither.
//
// ── The problem this exists for ────────────────────────────────────────────
// A setup key is minted by an OWNER, on a page in the running app. A freshly
// deployed production database has no owner: `isFirstUserOwnerAllowed()` is
// true only in development, deliberately, because the first visitor to a live
// app may well be a customer and handing them user management is an account
// takeover.
//
// So without this command the very first setup task is the one the setup
// surface cannot perform, and the operator falls straight back to
// `DATABASE_URL="postgres://…prod…" node run.mjs user-create --apply` — the
// procedure this whole feature replaces.
//
// ── Why it grants nothing new ──────────────────────────────────────────────
// It runs where the operator already has authority. Whoever can execute a
// command against an environment's database already owns that application
// entirely — its rows, its secrets, the code that serves it. Minting a key
// there expresses a privilege that already exists; it does not open a door.
//
// And it is a DIFFERENT trust anchor from "was the first visitor", which is
// exactly why `lib/users/bootstrap.ts` stays as it is rather than being
// relaxed.
//
// ── Two conditions, both load-bearing ──────────────────────────────────────
//   * It refuses the moment an owner exists. A bootstrap that worked twice is
//     a back door wearing a setup step's name.
//   * The secret is never printed. It is written with `setEnvValue()` and the
//     output says only that it was — the pattern
//     `scripts/ds24/connect-api-key.mjs` already uses for the Digistore key.
//     A production credential in an agent's transcript is the same failure the
//     .env rule keeps out of git, by another route.
//
// Usage:
//   node run.mjs setup-bootstrap                     # dry run
//   node run.mjs setup-bootstrap --email … --apply
//   node run.mjs setup-bootstrap --env prod --apply  # writes SETUP_KEY_PROD
import { randomBytes, createHash, randomUUID } from "node:crypto";
import "../lib/env.mjs";
import { setEnvValue } from "../lib/env-write.mjs";
import { connect } from "../users/_db.mjs";

const ENV_FILE = ".env";
const KEY_PREFIX = "ds24setup_";
/** Short on purpose: the first act after this is to mint a proper one. */
const BOOTSTRAP_DAYS = 7;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : (args[i + 1] ?? null);
};
const apply = args.includes("--apply");

const email = (flag("email") ?? "").trim().toLowerCase();
if (!email || !email.includes("@")) {
  console.error('ERROR: a valid --email "<address>" is required.');
  console.error("  This becomes the operator account for this environment.");
  process.exit(2);
}

// Which environment's key variable to write. The suffixed-reference convention
// the template already uses for DIGISTORE_IPN_PASSPHRASE_PROD and MEDIA_S3_*.
const target = (flag("env") ?? process.env.APP_ENV ?? "development").trim().toLowerCase();
const ENV_KEY =
  target === "prod" || target === "production"
    ? "SETUP_KEY_PROD"
    : target === "staging"
      ? "SETUP_KEY_STAGING"
      : "SETUP_KEY";

const sql = connect();

try {
  const [{ count }] = await sql`select count(*)::int as count from users where role = 'owner'`;

  if (count > 0) {
    // 🚨 The refusal that makes this a bootstrap rather than a back door.
    console.error(`✗ This environment already has ${count} owner account(s).`);
    console.error("");
    console.error("  A bootstrap runs once, on an environment that has nobody. From here on,");
    console.error("  keys are minted the ordinary way:");
    console.error("");
    console.error("      sign in as an owner → /dashboard/admin/setup-keys");
    console.error("");
    console.error("  That page shows the key exactly once and records who minted it.");
    process.exit(1);
  }

  if (!apply) {
    console.log(`DRY RUN — nothing has been written.\n`);
    console.log(`  environment   ${target}`);
    console.log(`  owner         ${email}   (would be created, role: owner)`);
    console.log(`  setup key     would be minted, valid ${BOOTSTRAP_DAYS} days`);
    console.log(`  written to    ${ENV_FILE} as ${ENV_KEY}`);
    console.log(`\nTo execute, call it again with --apply.`);
    process.exit(0);
  }

  const secret = KEY_PREFIX + randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(secret, "utf8").digest("hex");
  const expiresAt = new Date(Date.now() + BOOTSTRAP_DAYS * 86_400_000);

  // One transaction: an owner without a key, or a key without an owner, are
  // both states somebody would have to clean up by hand.
  const ownerId = await sql.begin(async (tx) => {
    const [owner] = await tx`
      insert into users (id, email, role)
      values (${randomUUID()}, ${email}, 'owner')
      on conflict (email) do update set role = 'owner'
      returning id
    `;
    await tx`
      insert into setup_keys (id, owner_id, name, token_hash, prefix, expires_at)
      values (${randomUUID()}, ${owner.id}, ${"bootstrap"}, ${hash},
              ${secret.slice(0, KEY_PREFIX.length + 4)}, ${expiresAt})
    `;
    return owner.id;
  });

  // ⚠️ Written, never printed. See the header.
  setEnvValue(ENV_FILE, ENV_KEY, secret);

  console.log(`✓ Owner created: ${email}`);
  console.log(`✓ Setup key minted and saved in ${ENV_FILE} as ${ENV_KEY}.`);
  console.log(`  .env is listed in .gitignore — the key does not reach the repository,`);
  console.log(`  and it was not printed here, so it is not in this session's transcript.`);
  console.log(``);
  console.log(`  It expires in ${BOOTSTRAP_DAYS} days. Next steps:`);
  console.log(`    1. switch the surface on: "enabled": true in config/setup.json, then deploy`);
  console.log(`    2. sign in as ${email} and mint a proper key on /dashboard/admin/setup-keys`);
  console.log(`    3. node run.mjs setup-check --env ${target}`);
  void ownerId;
} finally {
  await sql.end({ timeout: 5 });
}
