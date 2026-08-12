// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Role-based access control.
//
// The role lives in the session (see auth.config.ts → session.user.role).
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

  const { isUserBlocked } = await import("@/lib/users/blocked");
  if (await isUserBlocked(session.user.id as string)) return { state: "blocked" };

  return { state: "active", session };
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
 */
export async function requireOwner() {
  const session = await requireActiveUser();
  if (!isOwner(session.user.role)) redirect("/dashboard");
  return session;
}
