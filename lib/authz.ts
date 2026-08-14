// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Role-based access control.
//
// 🚨 The role is read from the DATABASE on every act, never taken from the
// session token — `currentActiveUser()` below, and the reasoning is there.
// `auth.config.ts` puts a role in the JWT at sign-in; that value is what the
// app shows before a guard has spoken, and it is never what a guard believes.
// Convention (db/schema.ts): "owner" = SAAS operator (admin), "member" = customer.
//
// `proxy.ts` only guards "signed in vs. not" — the *role* check happens
// server-side in the individual page or route via requireOwner().
//
// The pure predicates (isOwner/hasRole/isRole) live in lib/roles.ts and are
// re-exported here — that way client components can import them too, without
// the bundler dragging in auth.ts (and with it the mail sending). requireOwner
// loads auth() at runtime (dynamic import); `redirect` stays static —
// next/navigation is lightweight and gives us the `never` type narrowing.
import { redirect } from "next/navigation";
import type { Session } from "next-auth";

// Role definitions and predicates live in lib/roles.ts (free of server
// dependencies, so client components can import them too) and are passed
// through here — server code then needs only one import.
export { ROLES, isRole, isOwner, hasRole } from "./roles";
export type { Role } from "./roles";
import { isOwner } from "./roles";

/**
 * The error parameter the sign-in page uses to show "this account is blocked".
 * Deliberately the same value Auth.js sets itself when the signIn callback
 * rejects a sign-in (auth.ts) — so both paths produce exactly one message
 * instead of two that say the same thing.
 */
export const ACCESS_DENIED = "AccessDenied";

/** Who is asking — and if nobody, why not. */
export type ActiveUser =
  | { state: "active"; session: Session }
  | { state: "anonymous" }
  | { state: "blocked" };

/**
 * The same two checks `requireActiveUser()` makes, WITHOUT the redirect.
 *
 * For route handlers. A `redirect()` inside one produces a redirect response to
 * an HTML page, which is a nonsensical answer to `fetch("/api/…")` — the
 * browser follows it, the caller parses the sign-in page as JSON and reports a
 * syntax error instead of "you are signed out". A route handler answers 401 and
 * says so.
 *
 * Route handlers need this at all because **`proxy.ts` does not guard them**:
 * its matcher covers `/dashboard/:path*` and nothing else, so everything under
 * `app/api/` is public until it protects itself. See `docs/auth-setup.md` for
 * the three things a new protected area needs, and CLAUDE.md → Rules, first
 * bullet, for the refusal itself.
 *
 * The distinction between anonymous and blocked is kept because the page path
 * needs it (two different messages). A route handler is free to answer both
 * with 401, and should — a signed-out caller has no business learning which of
 * the two they are.
 */
export async function currentActiveUser(): Promise<ActiveUser> {
  const { auth } = await import("@/auth");
  const session = await auth();
  if (!session?.user) return { state: "anonymous" };

  const { accountState } = await import("@/lib/users/blocked");
  const account = await accountState(session.user.id);
  if (account.blocked) return { state: "blocked" };

  // 🚨 The role comes back from the DATABASE, and the session every caller gets
  // carries THAT one rather than the token's.
  //
  // This is the single place it can be done, and it is why the fix is one
  // function rather than forty call sites: every guard, page, action and route
  // handler in the app reaches its session through here. Before it, a JWT
  // signed at sign-in carried the role for thirty idle-refreshing days —
  // `setUserRole()` writes the column and nothing else, so taking `owner` away
  // took nothing away. `CLAUDE.md` → *Users & roles* has promised the opposite
  // for as long as it has existed; this is the code catching up with it.
  //
  // The row was already being read for the block, so the fresh role costs
  // nothing: one column, no second round trip.
  const role = account.role ?? session.user.role;
  if (role === session.user.role) return { state: "active", session };

  // Copied rather than mutated: `auth()` may hand out a cached object, and a
  // guard that rewrote it would be changing what an unrelated caller sees.
  return {
    state: "active",
    session: { ...session, user: { ...session.user, role } },
  };
}

/**
 * Guard for EVERY signed-in page.
 * - not signed in → redirect to /login
 * - blocked       → redirect to /login with the blocked message
 * Returns the session if access holds.
 *
 * The block check MUST happen here and not in the proxy: that one sees only
 * the JWT — which says nothing about the account having been blocked since —
 * and is kept free of the database on purpose. lib/users/blocked.ts explains
 * why this is necessary.
 */
export async function requireActiveUser() {
  const current = await currentActiveUser();
  if (current.state === "anonymous") redirect("/login");
  if (current.state === "blocked") redirect(`/login?error=${ACCESS_DENIED}`);

  return current.session;
}

/**
 * Guard for operator/admin areas.
 * - not signed in → redirect to /login
 * - blocked       → redirect to /login with the blocked message
 * - not an owner  → redirect to /dashboard
 * Returns the session if the role fits.
 *
 * You could additionally gate path prefixes in auth.config.ts:authorized();
 * this is deliberately server-side so that role and block are checked fresh
 * against the database — the JWT would only hold the state from sign-in time.
 *
 * That sentence was a claim before it was true: the block was read fresh and
 * the ROLE was not, so this guard was judging a thirty-day-old token. It is
 * `currentActiveUser()` that makes it true, for every caller at once.
 */
export async function requireOwner() {
  const session = await requireActiveUser();
  if (!isOwner(session.user.role)) redirect("/dashboard");
  return session;
}
