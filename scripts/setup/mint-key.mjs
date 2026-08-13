// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// A further setup key, for an owner who already exists — without a browser.
//
// ── The gap this closes, measured 2026-08-12 ───────────────────────────────
// `node run.mjs smoke` recommends `user-create --email … --role owner --apply`
// so its second pass can render the protected pages. From that moment
// `setup-bootstrap` refuses — correctly, and its refusal is the whole reason it
// is a bootstrap rather than a back door. But its message then names exactly one
// way on: *"sign in as an owner → /dashboard/admin/setup-keys"*. An agent with
// no browser is finished there, and with it `node run.mjs content-check`, which
// `CLAUDE.md` makes the exit condition for content.
//
// ── Why this is not a new privilege ────────────────────────────────────────
// 🚨 It needs `DATABASE_URL`, and **whoever holds that does not need a setup
// key**: the surface exists so an agent can change an environment WITHOUT a
// production connection string in a shell. So this hands nobody anything they
// could not already do — it removes a detour on the one machine where the
// detour is impossible. On a deployed environment nothing changes: you do not
// have that database, and the admin page stays the way in.
//
// ── The two conditions it keeps ────────────────────────────────────────────
// Both are `bootstrap.mjs`'s and both are load-bearing:
//
//   * **It mints for an owner that EXISTS and never creates one.** Creating the
//     first owner is a different act with a different guard, and merging the two
//     would give this command the back door the other one refuses to be.
//   * **The secret is never printed.** It is written with `setEnvValue()` and
//     the output says only that it was. A production credential in an agent's
//     transcript is the same failure the `.env` rule keeps out of git, by
//     another route.
//
// Dry run is the normal case, `--apply` writes — the convention every script
// under `scripts/` follows.

import { randomUUID } from "node:crypto";

import { connect } from "../users/_db.mjs";
import { loadEnv } from "../lib/env.mjs";
import { readEnvValue, setEnvValue } from "../lib/env-write.mjs";
import { hashSetupKey, newSetupKey, setupKeyPrefixOf } from "../../lib/setup/key.mjs";

loadEnv();

const argv = process.argv.slice(2);

/**
 * A flag's value — and a REFUSAL when the flag is there without one.
 *
 * 🚨 Returning `undefined` for `--email --apply` is the shape that makes this
 * command guess: with one owner in the table it would mint for them and report
 * success, for a person who never named anybody. The comment further down says
 * "never the first one, the trail is the whole point", and a silent fallback
 * here is exactly that, one typo earlier.
 */
const flag = (name) => {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    console.error(`✗ --${name} needs a value.`);
    process.exit(2);
  }
  return value;
};

const APPLY = argv.includes("--apply");
const ENV_FILE = ".env";

/** Same three environments, same three variable names as the bootstrap. */
const asked = flag("env");
const here = (process.env.APP_ENV ?? "development").trim().toLowerCase();
const target = (asked ?? here).trim().toLowerCase();
const ENV_KEY =
  target === "prod" || target === "production"
    ? "SETUP_KEY_PROD"
    : target === "staging"
      ? "SETUP_KEY_STAGING"
      : "SETUP_KEY";

/**
 * Short by default and CAPPED: a key that outlives its errand is a key nobody
 * revokes, and this one is never printed, so a long-lived one is a credential
 * in a file that nobody can even recognise later.
 */
const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;
const days = Number(flag("days") ?? DEFAULT_DAYS);

if (!process.env.DATABASE_URL) {
  console.error("✗ DATABASE_URL is not set — this command talks to the database directly.");
  console.error("  That is deliberate: it is for the machine that already has the database.");
  process.exit(1);
}

// 🚨 `--env` picks the VARIABLE, never the database — the row is minted in
// whatever `DATABASE_URL` points at. So `--env prod` on a development machine
// would mint a DEV key and write it over `SETUP_KEY_PROD`, destroying the real
// production key (which is never printed, so it cannot be typed back) and
// leaving `content-publish --env prod` failing to authenticate for a reason
// nothing on screen explains. It is refused rather than trusted.
if (asked !== undefined && target !== here && target !== "development") {
  console.error(`✗ --env ${target}, but APP_ENV here is "${here}".`);
  console.error("");
  console.error(`  This command mints into the database DATABASE_URL points at — it cannot`);
  console.error(`  reach another environment's. Writing ${ENV_KEY} from this machine would`);
  console.error(`  overwrite a key minted there, and that one was never printed either.`);
  console.error("");
  console.error(`  Mint ${target}'s key where ${target} runs, or on its admin page.`);
  process.exit(2);
}

if (!Number.isFinite(days) || days <= 0 || days > MAX_DAYS) {
  console.error(
    `✗ --days must be a whole number of days between 1 and ${MAX_DAYS} (got ${flag("days")}).`,
  );
  process.exit(2);
}

// `connect()`, never `postgres()` — `scripts/lib/pg-utc.test.ts` refuses a
// second connector, because a raw one reads timestamps in the session timezone
// and this file writes an expiry date.
const sql = connect();

try {
  // ⚠️ `blockedAt is null` as well as the role. `authenticateKey()` re-reads it
  // and refuses, so a key for a blocked owner is dead on arrival — but this
  // command would print `✓ Setup key minted` and send somebody to `setup-check`
  // with no way to find out why it does not work.
  //
  // ⚠️ Quoted camelCase throughout — this schema does not snake_case its
  // columns, and an unquoted `created_at` is a runtime error Postgres only
  // raises when the query runs. Caught on this command's first real run.
  const email = flag("email")?.trim().toLowerCase();
  const owners = email
    ? await sql`select id, email from users
                where role = 'owner' and "blockedAt" is null and lower(email) = ${email}`
    : await sql`select id, email from users
                where role = 'owner' and "blockedAt" is null order by "createdAt" asc`;

  if (owners.length === 0) {
    // The other command's job, and its message says so better than a repeat of
    // it would. Naming it is the point: these two are halves of one path.
    console.error(
      email
        ? `✗ No owner with the address ${email}.`
        : "✗ This environment has no owner account.",
    );
    console.error("");
    console.error("  A key belongs to an owner. For an environment that has nobody yet:");
    console.error("");
    console.error("      node run.mjs setup-bootstrap --email you@example.com --apply");
    console.error("");
    process.exit(1);
  }
  if (owners.length > 1 && !email) {
    // 🚨 Never "the first one". Which account a key is recorded against is the
    // whole of the audit trail, and guessing it makes the trail a fiction.
    console.error(`✗ This environment has ${owners.length} owner accounts. Name one:`);
    console.error("");
    for (const owner of owners) console.error(`      --email ${owner.email}`);
    console.error("");
    process.exit(2);
  }

  const owner = owners[0];
  const name = flag("name")?.trim() || "command line";
  const expiresAt = new Date(Date.now() + days * 86_400_000);

  // ⚠️ Is there already one? Unlike the bootstrap, this command is repeatable —
  // and `setEnvValue()` REPLACES. The key it writes over was never printed
  // either, so it cannot be typed back; it simply stays live in `setup_keys`
  // until it expires, revocable only on the admin page this command exists to
  // do without. Said out loud rather than discovered.
  const replacing = readEnvValue(ENV_FILE, ENV_KEY) ? ENV_KEY : null;

  if (!APPLY) {
    console.log(`Dry run — nothing was written. It would:`);
    console.log(`  · mint a setup key for ${owner.email}, named "${name}"`);
    console.log(`  · valid for ${days} day(s)`);
    console.log(`  · save it in ${ENV_FILE} as ${ENV_KEY} — never printed`);
    if (replacing) {
      console.log("");
      console.log(`  ⚠️  ${replacing} already has a value, and this REPLACES it. The old key`);
      console.log(`      stays valid until it expires and can only be revoked on`);
      console.log(`      /dashboard/admin/setup-keys.`);
    }
    console.log("");
    console.log(`  Repeat with --apply to do it.`);
    process.exit(0);
  }

  const secret = newSetupKey();
  const id = randomUUID();
  await sql`
    insert into setup_keys (id, owner_id, name, token_hash, prefix, expires_at)
    values (${id}, ${owner.id}, ${name}, ${hashSetupKey(secret)},
            ${setupKeyPrefixOf(secret)}, ${sql.typed.utcTimestamp(expiresAt)})
  `;

  // ⚠️ Written, never printed. See the header.
  //
  // 🚨 And the row goes back if the write fails. A read-only `.env`, a full
  // disk, a `.env` that is a directory — any of them leaves a live key in the
  // table that NOBODY holds, because the secret only ever existed in this
  // process. `bootstrap.mjs` wraps its two inserts for the same reason one step
  // further in: a half-done state somebody has to clean up by hand.
  try {
    setEnvValue(ENV_FILE, ENV_KEY, secret);
  } catch (error) {
    await sql`delete from setup_keys where id = ${id}`;
    console.error(`✗ Could not write ${ENV_FILE}: ${error?.message ?? error}`);
    console.error(`  The key was taken back out — nothing is live that nobody holds.`);
    process.exit(1);
  }

  console.log(`✓ Setup key minted for ${owner.email} and saved in ${ENV_FILE} as ${ENV_KEY}.`);
  console.log(`  .env is listed in .gitignore — the key does not reach the repository,`);
  console.log(`  and it was not printed here, so it is not in this session's transcript.`);
  if (replacing) {
    console.log(``);
    console.log(`  ⚠️  It replaced the ${replacing} that was there. That key is still valid`);
    console.log(`      until it expires — revoke it on /dashboard/admin/setup-keys.`);
  }
  console.log(``);
  console.log(`  It expires in ${days} days. It is listed on /dashboard/admin/setup-keys`);
  console.log(`  as "${name}", and that is where it is revoked when the errand is done.`);
  console.log(``);
  console.log(`  Next: node run.mjs setup-check --env ${target}`);
} finally {
  await sql.end({ timeout: 5 });
}
