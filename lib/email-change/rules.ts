// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Rules for changing the account address — deliberately PURE functions, no
// database and no crypto.
//
// The one thing this feature is: the proof that the Operator's own path
// (setUserEmail, lib/users/manage.ts) is allowed to skip. An Operator changes an
// address on a support call, having heard the customer; a Member has only a
// session, and a session is exactly what an attacker has. Everything below
// exists so that a session alone cannot move an account.
//
// LANGUAGE: codes, never sentences. Translation happens in the delivery layer
// via the `errors` namespace in `messages/*.json`.

/**
 * Reasons a change can be refused. `invalidEmail` and `emailTaken` are shared
 * with lib/users/rules.ts on purpose — same meaning, same text, one entry in
 * `messages/*.json`. The union is registered in `i18n/messages.test.ts`, which
 * checks each code has a translation.
 */
export const EMAIL_CHANGE_ERROR_CODES = [
  "invalidEmail",
  "emailTaken",
  "emailUnchanged",
  "changeNotFound",
  "changeExpired",
  "userBlocked",
  "tooManyRequests",
  "mailNotConfigured",
  // An operator signed in AS this member may not move the address. See
  // lib/email-change/manage.ts.
  "notWhileImpersonating",
] as const;

export type EmailChangeErrorCode = (typeof EMAIL_CHANGE_ERROR_CODES)[number];

/** Result of a check. `null` = allowed, otherwise the reason. */
export type Denial = EmailChangeErrorCode | null;

export class EmailChangeError extends Error {
  readonly code: EmailChangeErrorCode;

  constructor(code: EmailChangeErrorCode) {
    super(code);
    this.name = "EmailChangeError";
    this.code = code;
  }
}

/**
 * How long a confirmation link stays usable.
 *
 * The same 24 hours as the magic link (`buildEmailProvider`, lib/email.ts).
 * Deliberately matched: a person who has just requested a change and a person
 * who has just requested a sign-in are in the same situation — waiting on one
 * mail — and two different answers to "how long do I have?" would be a
 * difference nobody could explain.
 */
export const CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * May `next` become the address of the account that currently holds `current`?
 *
 * Takes ALREADY NORMALISED input — normalisation is `normalizeEmail` in
 * lib/users/rules.ts, and doing it in one place is what makes "Sabine@Neu.de "
 * and "sabine@neu.de" the same request everywhere in the app.
 *
 * Whether the address belongs to somebody else cannot be answered here — that
 * needs the database, and it is asked twice: once now (so the requester is told
 * straight away) and once at confirmation time (because it may have been taken
 * in between).
 */
export function checkRequestedEmail(
  current: string | null,
  next: string | null,
): Denial {
  if (!next) return "invalidEmail";
  // Not an error. Somebody who types the address they already have has made no
  // mistake worth a red message — they have simply changed nothing, and saying
  // "invalid" would be a lie about their own address.
  if (current && next === current) return "emailUnchanged";
  return null;
}

/**
 * Has this confirmation link run out?
 *
 * Expiry is compared, never scheduled. No job prunes this table: a row that has
 * timed out is refused the moment somebody presents it, which is the only
 * moment the answer matters.
 */
export function isExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/** When a link requested at `now` stops working. */
export function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + CONFIRMATION_TTL_MS);
}

// --- Rate limiting -----------------------------------------------------------
//
// Requesting a change is the one action in this app where a signed-in person
// chooses BOTH that mail is sent and who it is sent to. Left open, the account
// page is a way to mail a stranger repeatedly from the operator's own verified
// sending domain — which costs the operator their sender reputation, not just
// the stranger their patience.
//
// Two counters, because one of them alone is a hole:
//
//   per account   stops one session hammering the button.
//   per address   stops the same target being hit from several accounts, which
//                 is exactly what somebody who wanted to do this would try.
//
// The mechanism is lib/rate-limit.ts; only the numbers are decided here.

/**
 * Three an hour. A person correcting a typo needs two, and a person who
 * genuinely needs a fourth within the hour can wait — no access depends on it,
 * their current address keeps working throughout, and nothing they own is at
 * risk while they do.
 */
export const CONFIRMATION_LIMIT = { max: 3, windowMs: 60 * 60 * 1000 } as const;

/** Hits by the Member who asked. */
export const CONFIRMATION_ACCOUNT_BUCKET = "email-change:account";

/** Hits against the address the mail would go to. */
export const CONFIRMATION_TARGET_BUCKET = "email-change:target";

/**
 * A third counter, and the one that is not about mail at all.
 *
 * Refusing a taken address openly (FR-19) is a deliberate disclosure: it tells
 * the requester an account exists there. That was judged acceptable — and the
 * judgement quietly assumed a person correcting a typo, not a script.
 *
 * The two counters above cannot constrain it, because a refused request sends
 * nothing and therefore costs nothing: without this, a signed-in attacker can
 * ask "does an account exist at X?" without limit and for free. The disclosure
 * stays — a silent failure at confirmation time is worse for every honest user
 * — but it stops being an unmetered oracle.
 *
 * Twenty an hour, counted on every request that reaches the lookup. Nobody
 * correcting an address approaches it; anybody enumerating hits it at once.
 */
export const PROBE_LIMIT = { max: 20, windowMs: 60 * 60 * 1000 } as const;

/** Hits by the Member who asked, whether or not anything was sent. */
export const PROBE_BUCKET = "email-change:probe";
