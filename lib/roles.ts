// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Roles — pure definitions, WITHOUT server dependencies.
//
// Why a file of its own: `lib/authz.ts` depends on `auth.ts` (and through it
// on mail sending). If a client component imported from there, the bundler
// would pull server-side modules into the browser bundle and the build would
// break. Anything the browser needs too therefore belongs here.
//
// lib/authz.ts re-exports these helpers so server code still needs only one
// import.

/**
 * The canonical roles. Three of them:
 *   "owner"     = operator/admin — may do everything, including user management
 *   "moderator" = a member the operator trusts to keep community rooms clean.
 *                 NOT an admin: no user management, no roles, no billing —
 *                 every admin rule answers "notOwner" for a moderator, and
 *                 `requireOwner()` refuses them like any member. What a
 *                 moderator may DO is granted per duty (groups, Epic 23),
 *                 never by this value alone.
 *   "member"    = ordinary user/customer — the default when signing up yourself
 *
 * In the UI they are called "Admin", "Moderator" and "User" — those display
 * names live in `messages/*.json` under `roles`, not here (see <RoleBadge>,
 * components/role-badge.tsx). The CLI additionally accepts the aliases
 * admin→owner and user→member (scripts/users/_db.mjs).
 */
export const ROLES = ["owner", "moderator", "member"] as const;
export type Role = (typeof ROLES)[number];

/** Checks whether an arbitrary value is a valid role (e.g. form input). */
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** true if the role carries operator/admin rights. */
export function isOwner(role?: string | null): boolean {
  return role === "owner";
}

/** true if the role is in the list of allowed ones. */
export function hasRole(
  role: string | null | undefined,
  allowed: readonly string[],
): boolean {
  return role != null && allowed.includes(role);
}
