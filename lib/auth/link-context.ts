// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Whether the magic link about to be sent is an OPERATOR'S INVITATION.
//
// Finding M-6 of the 2026-08-18 scan: the brake on the sign-in link sat in
// `app/login/actions.ts` on the argument that "both ways in pass through this
// function and neither reaches the other". They do not — `POST
// /api/auth/signin/email` with a csrf token and any address goes straight to
// the Auth.js provider, past the action, and the provider exists exactly when a
// mail transport is configured, which in STAGING and PROD is mandatory. The
// unmetered door existed precisely where it counted.
//
// So the meter moved to `sendVerificationRequest()`, the one place both paths
// really pass through. What the old comment in `lib/credentials/manage.ts` was
// protecting is real, though: the operator's invitation on
// `/dashboard/admin/users` is `requireOwner()`-gated and has no business being
// counted against the person being invited. That is a reason for an EXEMPTION,
// not for a gap — so the exemption is stated here, by an act, rather than being
// implied by the absence of a counter.
//
// 🚨 `AsyncLocalStorage`, not a module-level boolean. Two requests are served
// concurrently in the same process, and a flag set by one of them would exempt
// whatever the other happened to be sending at that moment — a gap with the
// shape of the one this file closes.
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<{ invitation: true }>();

/**
 * Runs `fn` marked as the operator's invitation, so the link it sends is not
 * metered. Wrap the `signIn("email", …)` call and nothing wider.
 */
export function asOperatorInvitation<T>(fn: () => Promise<T>): Promise<T> {
  return store.run({ invitation: true }, fn);
}

/** True only inside `asOperatorInvitation()`. */
export function isOperatorInvitation(): boolean {
  return store.getStore()?.invitation === true;
}

/**
 * 🚨 The brake on mailing a sign-in link — throws when there is no room.
 *
 * It lives HERE rather than inline in `buildEmailProvider()` for one reason and
 * it is a testable one: the provider closes over the module's own
 * `isEmailLoginEnabled()` and `sendLoginEmail()`, so a test can neither switch
 * it on nor stop it opening a socket without faking the whole module — and a
 * partial mock does not intercept a module's calls to itself. A decision that
 * cannot be driven is a decision nothing holds.
 *
 * `app/login/link-meter.test.ts` drives this function directly and then reads
 * the provider's source to prove it is REACHED before the send.
 *
 * The origin is read where a request context can supply one. This module is
 * also reachable from a script with no request at all, so a failure there means
 * "no origin" and never a throw: the per-address counter still holds.
 */
export async function guardSignInLink(identifier: string): Promise<void> {
  if (isOperatorInvitation()) return;

  const { mayMailSignInLink } = await import("@/lib/credentials/manage");

  let origin: string | null = null;
  try {
    const { headers } = await import("next/headers");
    const { originOf } = await import("@/lib/auth/password-login");
    origin = originOf({ headers: await headers() });
  } catch {
    origin = null;
  }

  if (!(await mayMailSignInLink(identifier, origin, { commit: true }))) {
    // Auth.js turns this into an `AuthError`, which `app/login/actions.ts`
    // already renders as a refusal rather than a stack trace. The dialog's own
    // look-ahead is what produces the friendlier "too many links".
    throw new Error("sign-in link rate limit");
  }
}
