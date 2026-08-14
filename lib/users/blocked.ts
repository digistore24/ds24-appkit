// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Enforcement of the account block.
//
// A block that only stops the next sign-in is not a block: this app's sessions
// are JWTs (auth.config.ts → session.strategy = "jwt"), and a JWT stays valid
// until it expires — even if the database has said "blocked" for a while.
// Anyone already signed in would stay in for weeks.
//
// So the check happens in TWO places:
//
//  1. on sign-in — the `signIn` callback in auth.ts. Prevents new sessions.
//  2. on every request to the protected area — app/dashboard/layout.tsx via
//     requireActiveUser() in lib/authz.ts. Ends running sessions.
//
// Why not in the proxy: it deliberately has no database access (see proxy.ts)
// and sees only the JWT. The check therefore costs one small query per
// dashboard page load — the price for a block that takes effect immediately
// instead of at the next sign-in.
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

/** What the database says about an account id. */
export type SignInVerdict = "blocked" | "allowed" | "unknown";

/**
 * May a sign-in proceed? PURE — the two lookups happen in the caller.
 *
 * The interesting case is `unknown`, and it is the reason this function
 * exists. `isUserBlocked()` treats an id with no row as blocked, which is
 * right for a RUNNING session — the account was deleted underneath it. At
 * SIGN-IN it is exactly wrong: Auth.js hands the callback a freshly minted id
 * for an account it is about to create, so "no row" means "about to exist".
 *
 * Treating that as blocked turns every first-ever sign-in into "account
 * blocked" — and it is invisible in development, where the dev login inserts
 * the row before the callback ever runs.
 *
 * For an account that does not exist yet, the address is what can carry a
 * block, so that is what decides.
 */
export function maySignIn(verdict: SignInVerdict, emailBlocked: boolean): boolean {
  if (verdict === "blocked") return false;
  if (verdict === "allowed") return true;
  return !emailBlocked;
}

/** Blocked, allowed, or no such account — one query, three answers. */
export async function signInVerdict(id: string): Promise<SignInVerdict> {
  const [row] = await db
    .select({ blockedAt: users.blockedAt })
    .from(users)
    .where(eq(users.id, id));
  if (!row) return "unknown";
  return row.blockedAt !== null ? "blocked" : "allowed";
}

/** What a RUNNING session is worth right now, as the database sees it. */
export interface AccountState {
  blocked: boolean;
  /** `null` only when there is no row — an account deleted mid-session. */
  role: string | null;
}

/**
 * The two facts a guard needs about a signed-in account, in ONE query.
 *
 * 🚨 The role is here because it must not come out of the token. A JWT carries
 * what somebody WAS when they signed in, and this app's sessions last thirty
 * days with idle refresh — so taking `owner` away used to leave the admin
 * surface open to them for weeks: plans, token balances, deleting users,
 * impersonation, appointing moderators. The block took effect immediately and
 * the role change did not, although `CLAUDE.md` promised both.
 *
 * Reading it beside `blockedAt` is what makes that free: `requireActiveUser()`
 * already paid for this row on every protected page load. One column more is
 * no round trip more.
 *
 * ⚠️ It is asked about `session.user.id`, which during an impersonation is the
 * MEMBER's id — deliberately (AD-23), and the answer is then the member's role,
 * which is the same statement the session already made and now makes freshly.
 */
export async function accountState(id: string): Promise<AccountState> {
  const [row] = await db
    .select({ blockedAt: users.blockedAt, role: users.role })
    .from(users)
    .where(eq(users.id, id));
  // No hit means the account was deleted while the session was running. That
  // access belongs terminated too — "not found" is not "may come in".
  if (!row) return { blocked: true, role: null };
  return { blocked: row.blockedAt !== null, role: row.role };
}

/**
 * Is this account blocked? Unknown IDs count as blocked.
 *
 * For a RUNNING session (requireActiveUser). Do not use at sign-in — see
 * maySignIn() above for why.
 */
export async function isUserBlocked(id: string): Promise<boolean> {
  return (await accountState(id)).blocked;
}

/**
 * Is the account for this address blocked? For the sign-in path, where (with a
 * magic link) only the address is known and there is no user ID yet.
 *
 * Unknown addresses are NOT blocked here: someone signing in for the first
 * time has no account yet — Auth.js is about to create it.
 */
export async function isEmailBlocked(email: string): Promise<boolean> {
  const [row] = await db
    .select({ blockedAt: users.blockedAt })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()));
  return row ? row.blockedAt !== null : false;
}
