// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The imperative shell for the optional password: it owns the database writes
// and calls the pure rules (rules.ts) before making any of them.
//
// Everything here acts on ONE account — the one that asked. No function takes
// an account id from a form; the caller passes the id it read from the session
// itself. A Member managing their own credentials is the only use case, and
// widening it later should require deleting this sentence first.
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/credentials/hash";
import {
  CredentialError,
  LINK_SEND_BUCKET,
  LINK_SEND_LIMIT,
  LINK_SEND_ORIGIN_BUCKET,
  LINK_SEND_ORIGIN_LIMIT,
  LOOKUP_BUCKET,
  LOOKUP_LIMIT,
  LOOKUP_ORIGIN_BUCKET,
  LOOKUP_ORIGIN_LIMIT,
  SIGN_IN_BUCKET,
  SIGN_IN_LIMIT,
  SIGN_IN_ORIGIN_BUCKET,
  SIGN_IN_ORIGIN_LIMIT,
  canChangePassword,
  checkNewPassword,
  normaliseEmail,
} from "@/lib/credentials/rules";
import { clearKey, isLimited, record, resetRateLimits } from "@/lib/rate-limit";

export interface SignInState {
  /** The account's address as the DATABASE holds it — see below. */
  email: string | null;
  hasPassword: boolean;
}

/**
 * How this account is signed into: the address, and whether a password exists.
 * Never returns the hash itself.
 *
 * ⛔ The address comes from the database and NOT from the session, and that is
 * not interchangeable here. Sessions are JWTs (auth.config.ts): the email in one
 * is the email at the moment of sign-in, so a Member who has just confirmed an
 * address change would be shown their OLD address by the very page that just
 * changed it. The sidebar still shows the cached one until the next sign-in —
 * a cosmetic lag, and it corrects itself. Being wrong HERE would not be
 * cosmetic; it is the page somebody opens to check what their address is.
 */
export async function signInState(userId: string): Promise<SignInState> {
  const [row] = await db
    .select({ passwordHash: users.passwordHash, email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  if (!row) throw new CredentialError("credentialUserNotFound");
  return { email: row.email, hasPassword: Boolean(row.passwordHash) };
}

/**
 * Sets or replaces the password on the caller's own account.
 *
 * `current` is required exactly when one is already set. Setting a FIRST
 * password rests on the session alone — there is no older secret to ask for.
 */
export async function setPassword(
  userId: string,
  input: { password: string; confirmation: string; current?: string },
): Promise<{ email: string | null; created: boolean }> {
  const denial = checkNewPassword(input.password, input.confirmation);
  if (denial) throw new CredentialError(denial);

  const [row] = await db
    .select({ passwordHash: users.passwordHash, email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  if (!row) throw new CredentialError("credentialUserNotFound");

  if (row.passwordHash) {
    const ok = await verifyPassword(input.current ?? "", row.passwordHash);
    if (!ok) throw new CredentialError("passwordWrong");
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(input.password) })
    .where(eq(users.id, userId));

  // A changed password is a good moment to forget old failures: the guesses
  // that accumulated were against a secret that no longer exists.
  clearAttempts(row.email);

  // Returned so the delivery layer can tell the Member what happened. WHICH of
  // the two it was comes from the database rather than from the form — the
  // notice must describe what actually occurred.
  return { email: row.email, created: !row.passwordHash };
}

/**
 * Removes the password from the caller's own account. Magic-link sign-in is
 * unaffected and remains available, which is what makes this safe to offer:
 * the account never ends up with no way in.
 *
 * Not account closure, and nothing else changes — not the address, not the
 * session, not the balance, not access.
 */
export async function removePassword(
  userId: string,
  input: { current: string },
): Promise<{ email: string | null }> {
  const [row] = await db
    .select({ passwordHash: users.passwordHash, email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  if (!row) throw new CredentialError("credentialUserNotFound");

  const denial = canChangePassword({ hasPassword: Boolean(row.passwordHash) });
  if (denial) throw new CredentialError(denial);

  const ok = await verifyPassword(input.current, row.passwordHash);
  if (!ok) throw new CredentialError("passwordWrong");

  await db
    .update(users)
    .set({ passwordHash: null })
    .where(eq(users.id, userId));

  clearAttempts(row.email);

  return { email: row.email };
}

// --- Sign-in -----------------------------------------------------------------

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
}

/**
 * The password sign-in check, for the Credentials provider in
 * lib/auth/password-login.ts.
 *
 * Answers with the account or with null, and never says WHY — not to the
 * caller and not through how long it took. "No such account", "no password
 * set", "wrong password" and "blocked" are one answer, because any difference
 * between them tells a stranger which addresses have accounts here.
 *
 * The one exception is deliberate: too many failures is reported as such, via
 * `RateLimited`. A silent refusal there would leave the real owner locking
 * themselves out with no idea why.
 */
export type SignInResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; rateLimited: boolean };

/**
 * Does this ADDRESS have a password? — the step-1 lookup of the sign-in dialog.
 *
 * ⛔ THE EXCEPTION TO THE RULE AT THE TOP OF THIS FILE. Every other function
 * here acts on an id the caller read from a session; this one takes an
 * identifier straight from a form typed by a stranger. That is deliberate and it
 * is the only such function — signing in is the one moment where nobody has a
 * session yet, so there is no id to read.
 *
 * Two properties keep it as narrow as a form-fed lookup can be, and both are
 * load-bearing rather than stylistic:
 *
 *   1. **An unknown address answers `false`**, exactly as a known address with
 *      no password does. So the caller can distinguish "has a password" from
 *      "does not" — and never "exists" from "does not exist".
 *   2. **It returns a boolean about passwords and nothing else.** Not the row,
 *      not the id, not `emailVerified`, not `blockedAt`. Whoever needs one of
 *      those on the sign-in path is writing a different, worse function and
 *      should notice that they are.
 *
 * It is still an oracle — that was accepted when the two-step dialog was chosen
 * (see LOOKUP_LIMIT in rules.ts) — so it is metered. Over the limit it answers
 * `rateLimited` WITHOUT reading the database: a limit that still returns the
 * answer it was added to withhold protects nothing.
 */
export type LookupResult =
  | { ok: true; hasPassword: boolean }
  | { ok: false; rateLimited: true };

export async function addressHasPassword(
  email: string,
  /** Where the lookup came from — see `originOf` in lib/auth/password-login.ts. */
  origin?: string | null,
): Promise<LookupResult> {
  const key = normaliseEmail(email);

  if (isLimited(LOOKUP_BUCKET, key, LOOKUP_LIMIT)) return { ok: false, rateLimited: true };
  if (origin && isLimited(LOOKUP_ORIGIN_BUCKET, origin, LOOKUP_ORIGIN_LIMIT)) {
    return { ok: false, rateLimited: true };
  }

  // Counted BEFORE the answer is produced, and on every hit rather than on
  // failures — a lookup has no failure, and the answer is the thing metered.
  record(LOOKUP_BUCKET, key, LOOKUP_LIMIT);
  if (origin) record(LOOKUP_ORIGIN_BUCKET, origin, LOOKUP_ORIGIN_LIMIT);

  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, key));

  return { ok: true, hasPassword: Boolean(row?.passwordHash) };
}

/**
 * May a sign-in link be MAILED to this address right now?
 *
 * ⛔ THE SECOND EXCEPTION to the rule at the top of this file, and for the same
 * reason as the first: nobody has a session on the sign-in page, so there is no
 * id to read. It touches no database and returns no fact about the address —
 * only whether the counter has room.
 *
 * 🚨 **It lives here rather than in `sendVerificationRequest()`** (lib/email.ts),
 * which is the tempting place and the wrong one. That function is what
 * `signIn("email")` calls from EVERY caller — including the operator's
 * invitation on /dashboard/admin/users, which is `requireOwner()`-gated and has
 * no business being metered. Deciding here keeps the whole sign-in metric in one
 * file and makes that exemption a visible choice instead of an accident.
 *
 * Counted like the lookup above: on every hit rather than on failures, and
 * BEFORE the mail is handed to Auth.js. A brake that fires after the send has
 * already paid for what it refuses.
 */
export async function mayMailSignInLink(
  email: string,
  /** Where the request came from — see `originOf` in lib/auth/password-login.ts. */
  origin?: string | null,
): Promise<boolean> {
  const key = normaliseEmail(email);

  if (isLimited(LINK_SEND_BUCKET, key, LINK_SEND_LIMIT)) return false;
  if (origin && isLimited(LINK_SEND_ORIGIN_BUCKET, origin, LINK_SEND_ORIGIN_LIMIT)) {
    return false;
  }

  record(LINK_SEND_BUCKET, key, LINK_SEND_LIMIT);
  if (origin) record(LINK_SEND_ORIGIN_BUCKET, origin, LINK_SEND_ORIGIN_LIMIT);

  return true;
}

export async function verifyPasswordLogin(
  email: string,
  password: string,
  /**
   * Where the attempt came from, if the caller can tell. Optional so that a
   * script or a test can call this without inventing one — but the provider
   * always passes it, and without it the address counter alone bounds nothing:
   * varying the address on every attempt never lets it fire.
   */
  origin?: string | null,
): Promise<SignInResult> {
  // The SAME normalisation the step-1 lookup used — see normaliseEmail().
  const key = normaliseEmail(email);
  if (isRateLimited(key)) return { ok: false, rateLimited: true };
  if (origin && isLimited(SIGN_IN_ORIGIN_BUCKET, origin, SIGN_IN_ORIGIN_LIMIT)) {
    return { ok: false, rateLimited: true };
  }

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      blockedAt: users.blockedAt,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, key));

  // verifyPassword spends its time even when there is nothing to compare
  // against, so an unknown address costs the same as a known one.
  const matches = await verifyPassword(password, row?.passwordHash ?? null);

  // The block is checked HERE as well as in the signIn callback in auth.ts.
  // Two independent gates on purpose: this provider returns a user object
  // straight into Auth.js, and a future refactor of that callback must not be
  // able to quietly open a door for blocked accounts.
  if (!row || !matches || row.blockedAt) {
    recordFailedAttempt(key);
    if (origin) record(SIGN_IN_ORIGIN_BUCKET, origin, SIGN_IN_ORIGIN_LIMIT);
    return { ok: false, rateLimited: false };
  }

  clearAttempts(key);
  return {
    ok: true,
    user: { id: row.id, email: row.email, name: row.name, role: row.role },
  };
}

// --- Failed-attempt bookkeeping ----------------------------------------------
//
// The counter itself lives in lib/rate-limit.ts, including the note about it
// being per process. These are the sign-in-shaped names for it.

export function isRateLimited(key: string, now: number = Date.now()): boolean {
  return isLimited(SIGN_IN_BUCKET, key, SIGN_IN_LIMIT, now);
}

export function recordFailedAttempt(key: string, now: number = Date.now()): void {
  record(SIGN_IN_BUCKET, key, SIGN_IN_LIMIT, now);
}

export function clearAttempts(key: string | null): void {
  if (key) clearKey(SIGN_IN_BUCKET, normaliseEmail(key));
}

/** Test seam — drops all recorded failures, in every bucket. */
export function resetAttempts(): void {
  resetRateLimits();
}
