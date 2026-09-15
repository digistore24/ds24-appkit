// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The first account on a fresh installation becomes the owner.
//
// Why this exists: a working copy that has just been created (`make
// deploy-local` → `node run.mjs start`) has an EMPTY users table. Whoever signs in
// first — with any address, through the development login — would otherwise
// land as a "member": no admin area, no "Users" entry in the navigation, and
// no way to hand themselves the role, because that is exactly what the admin
// area is for. They would have to know `node run.mjs user-create` before they could
// even look at their own app.
//
// ============================================================================
// This is a bootstrap, NOT a rule of the app: it applies ONLY in the DEV
// environment. In STAGING and PROD the first person to sign in is not
// necessarily the operator — it may well be the first customer, and handing
// them user management would be an account takeover. There the operator
// creates their own account beforehand, deliberately:
//
//   node run.mjs user-create --email me@example.com --role owner --apply
//
// The environment check is the same allowlist used everywhere else (appEnv()
// in lib/env-guard.ts): anything not clearly recognized as development counts
// as production. A typo in APP_ENV therefore closes this door, it does not
// open it.
// ============================================================================
//
// ── "First" means the first PERSON, not the first row (2026-09-15) ─────────
// The rule used to be "the users table is empty". It never is by the time the
// customer signs in: an agent that builds a stage runs `node run.mjs smoke`,
// and smoke's signed-in pass needs an owner, so the agent creates one with
// `user-create` first. The customer then followed the hand-back — "sign in
// with any address, that account is the admin" — and landed as a member with
// no admin area and a buy button on her own course. Measured in three runs in
// a row; twice the agent had read the rule that said to name the test account
// instead, and wrote "any address" anyway. So the sentence is made TRUE rather
// than forbidden: an owner row counts only once somebody has actually signed
// in to it — a verified address, a linked sign-in provider or a password of
// its own. An owner a command created for a check has none of those, and the
// customer's own first sign-in still becomes the admin. Two owners on a
// developer's machine are not a security problem (see `roleForNewUser`).
import { db } from "@/db";
import { users } from "@/db/schema";
import { and, count, eq, isNotNull, or, sql } from "drizzle-orm";
import { appEnv } from "@/lib/env-guard";
import type { Role } from "@/lib/roles";

/** true if a first account may be promoted to owner in this environment. */
export function isFirstUserOwnerAllowed(env: { APP_ENV?: string }): boolean {
  return appEnv(env.APP_ENV) === "development";
}

/**
 * The decision itself, as a pure function — it hands out user management, and
 * that is worth a test of its own (lib/users/bootstrap.test.ts).
 */
export function decideRoleForNewUser(input: {
  APP_ENV?: string;
  /**
   * Is there an owner somebody has really signed in to? A row a command
   * created for a check does not count — see the header.
   */
  ownerClaimed: boolean;
}): Role {
  if (!isFirstUserOwnerAllowed(input)) return "member";
  return input.ownerClaimed ? "member" : "owner";
}

/**
 * Has a person ever signed in to an owner account on this installation?
 *
 * Three traces a real sign-in leaves, any one is enough: `emailVerified` (the
 * magic link and the development login write it), a row in `accounts` (Google),
 * a `passwordHash` (only the account's own holder sets one). `user-create`,
 * `db-seed` and `setup-bootstrap` write none of them.
 *
 * ⚠️ The `accounts` test is written as literal SQL with explicit aliases, not
 * as a drizzle `exists(db.select()…)`: a correlated subquery built that way can
 * render its columns unqualified, and `"userId" = "id"` would then compare
 * `accounts` with itself and answer true for everyone.
 */
export async function ownerClaimed(): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(
      and(
        eq(users.role, "owner"),
        or(
          isNotNull(users.emailVerified),
          isNotNull(users.passwordHash),
          sql`exists (select 1 from "accounts" a where a."userId" = "users"."id")`,
        ),
      ),
    );
  return Number(row?.n ?? 0) > 0;
}

/**
 * The role an account that is being created RIGHT NOW gets — "member" as the
 * normal case, "owner" for the very first one on a fresh DEV installation.
 *
 * Called at creation time, not afterwards: the session is a JWT and carries
 * the role from the moment of sign-in (auth.config.ts → jwt callback). A
 * promotion applied after the fact would only take effect on the next sign-in
 * — the first look at the app would still be missing the admin area.
 *
 * Deliberately not serialized: two sign-ups in the same instant would both
 * read an empty table and both become owner. That cannot happen on one
 * developer's machine, and a write lock in front of every sign-up would be a
 * high price for it — two admins locally is not a security problem.
 */
export async function roleForNewUser(): Promise<Role> {
  return decideRoleForNewUser({
    APP_ENV: process.env.APP_ENV,
    // Only asked when the answer can still change anything — outside of DEV
    // the query would be a pointless round trip on every sign-up.
    ownerClaimed: isFirstUserOwnerAllowed({ APP_ENV: process.env.APP_ENV })
      ? await ownerClaimed()
      : true,
  });
}
