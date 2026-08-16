// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Rules for the optional password — deliberately PURE functions, no database
// and no crypto.
//
// Why they are separate: these decide whether a credential may be set at all
// and when an attacker has had too many guesses. That makes them
// security-relevant, and they have to be testable one by one
// (lib/credentials/rules.test.ts).
//
// The shell (lib/credentials/manage.ts) calls them BEFORE it writes.
//
// LANGUAGE: this layer returns NO finished sentences, only codes
// ("passwordTooShort"). Translation happens in the UI via the `errors`
// namespace in `messages/*.json`. A sentence written here would exist in
// exactly one language — and that would not necessarily be the user's.

/**
 * Every reason for refusal. Each code MUST have a text in `messages/*.json`
 * under `errors` — `i18n/messages.test.ts` enforces that, and this union is
 * registered there.
 */
export const CREDENTIAL_ERROR_CODES = [
  "passwordTooShort",
  "passwordTooLong",
  "passwordMismatch",
  "passwordWrong",
  "noPasswordSet",
  "tooManyAttempts",
  "credentialUserNotFound",
] as const;

export type CredentialErrorCode = (typeof CREDENTIAL_ERROR_CODES)[number];

/** Result of a check. `null` = allowed, otherwise the reason. */
export type Denial = CredentialErrorCode | null;

/**
 * An error carrying a translatable reason. The server actions catch it and
 * turn it into a message in the user's language via `t(code)`.
 */
export class CredentialError extends Error {
  readonly code: CredentialErrorCode;

  constructor(code: CredentialErrorCode) {
    // The message IS the code — it belongs in logs, not in front of people.
    super(code);
    this.name = "CredentialError";
    this.code = code;
  }
}

/**
 * Minimum length, counted in CODE POINTS rather than UTF-16 units, so that a
 * passphrase made of emoji or CJK characters is measured the way its author
 * sees it — "🔑🔑🔑🔑🔑" is five characters, not ten.
 *
 * Ten, and no composition rules. Length beats composition: a required digit,
 * capital and symbol pushes people toward one predictable shape ("Passwort1!")
 * and toward writing the result down. Current public guidance has advised
 * against composition rules for years, and this app has no reason to differ.
 */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * Upper bound. Not a security rule — scrypt does not care — but an unbounded
 * input to a deliberately slow function is a cheap way to make the server work
 * hard for nothing. Far above any password a person types.
 */
export const MAX_PASSWORD_LENGTH = 200;

/** Length in code points. `"🔑".length` is 2; this counts it as 1. */
export function passwordLength(password: string): number {
  return [...password].length;
}

/**
 * May this become somebody's password?
 *
 * Deliberately NOT trimmed: a leading or trailing space is a legitimate part
 * of a password, and silently removing one would mean the password that gets
 * stored is not the password that was typed — which surfaces later as "it
 * worked yesterday".
 */
export function checkNewPassword(password: string, confirmation: string): Denial {
  const length = passwordLength(password);
  if (length < MIN_PASSWORD_LENGTH) return "passwordTooShort";
  if (length > MAX_PASSWORD_LENGTH) return "passwordTooLong";
  if (password !== confirmation) return "passwordMismatch";
  return null;
}

/** May this account's password be changed or removed? */
export function canChangePassword(state: { hasPassword: boolean }): Denial {
  return state.hasPassword ? null : "noPasswordSet";
}

/**
 * The one way an address typed into a form is turned into the key that
 * `users.email` is compared against.
 *
 * It exists as a named function rather than an inline `.trim().toLowerCase()`
 * because it is now applied in two places that MUST agree: the step-1 lookup on
 * /login, which decides whether a password field is shown, and
 * `verifyPasswordLogin`, which then checks the password. Normalise differently
 * in one of them and the dialog offers a password field and refuses the correct
 * password — a bug that reproduces only for whoever capitalised their address.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

// --- Rate limiting -----------------------------------------------------------
//
// A magic link is protected by the attacker having to read somebody else's
// mail. A password is protected by nothing except the number of guesses it
// allows. Without this limit, adding a password to this app would make it LESS
// safe than it was.
//
// The mechanism lives in lib/rate-limit.ts — shared with the change-address
// mails, which are the other thing here a stranger can trigger repeatedly. Only
// the numbers are decided in this file.

import type { Limit } from "@/lib/rate-limit";

/** How long failures are remembered. */
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/** Failures tolerated inside that window before sign-in is refused. */
export const MAX_ATTEMPTS = 10;

/**
 * Ten guesses per quarter hour, per address.
 *
 * Generous on purpose: the person who most often gets a password wrong ten
 * times is the one who owns the account. It is nowhere near enough to search a
 * password of the minimum length above, and the window slides, so waiting is
 * always a way back in.
 */
export const SIGN_IN_LIMIT: Limit = {
  max: MAX_ATTEMPTS,
  windowMs: ATTEMPT_WINDOW_MS,
};

/** The bucket these hits are counted in. */
export const SIGN_IN_BUCKET = "password-sign-in";

/**
 * The same thing keyed by origin instead of by address.
 *
 * The counter above is keyed by the address being signed into, so it sees one
 * hit per address and never fires against somebody who varies the address on
 * every attempt. That is the shape of spraying one common password across many
 * accounts, and it is exactly the shape per-address limiting cannot see.
 *
 * Counted on FAILURES only, like the address counter. An attacker's attempts
 * all fail, so they all count; an office behind one NAT mostly succeeds, so it
 * does not. Thirty per quarter hour leaves room for people genuinely fumbling
 * a password.
 *
 * It does not defeat a distributed attempt — nothing keyed by origin does.
 *
 * ⚠️ NOT justified by CPU cost, and the record matters because the first
 * version of this comment claimed it was. The theory was that each attempt
 * against an unknown account forces the deliberate dummy hash in
 * lib/credentials/hash.ts, buying ~40 ms of CPU with one cheap request.
 * Measured against a production build, the sign-in endpoint costs **1.6 ms of
 * CPU per attempt** — 500 attempts burned 0.82 s where a hash per attempt would
 * have burned ~20 s. Whatever else that path does, it is not amplification.
 * This limit is worth having on the credential-guessing argument alone; do not
 * re-derive a performance argument for it without measuring first.
 */
export const SIGN_IN_ORIGIN_LIMIT: Limit = {
  max: 30,
  windowMs: ATTEMPT_WINDOW_MS,
};

/** The bucket for origin-keyed sign-in failures. */
export const SIGN_IN_ORIGIN_BUCKET = "password-sign-in:origin";

// --- The step-1 address lookup ------------------------------------------------
//
// The two-step sign-in dialog asks for an address and then decides what to ask
// for next (lib/auth/sign-in-route.ts). That decision is VISIBLE: a password
// field means this address has a password, a "link sent" message means it does
// not. So the dialog answers a question about an address to somebody who has
// proved nothing about it.
//
// That cost was accepted knowingly when the two-step flow was chosen, and it is
// narrower than it first looks — an unknown address and a known passwordless one
// take the same branch, so what leaks is "has a password", not "has an account".
// These limits are the other half of that decision: they do not close the
// oracle, they make it too slow to enumerate with.
//
// Counted on EVERY lookup, unlike the sign-in limits above, which count only
// failures. A lookup has no failure — every one of them is an answer, and the
// answer is the thing being metered.

/**
 * Per address. Bounds a script hammering one address and is far above anything
 * a person retyping their own could reach.
 */
export const LOOKUP_LIMIT: Limit = {
  max: 20,
  windowMs: ATTEMPT_WINDOW_MS,
};

/** The bucket those hits are counted in. */
export const LOOKUP_BUCKET = "sign-in-lookup";

/**
 * Per origin — this is the one that does the work.
 *
 * Enumeration means many DIFFERENT addresses from one place, which is exactly
 * the shape a per-address counter cannot see; the reasoning is written out in
 * full at SIGN_IN_ORIGIN_LIMIT above and applies here unchanged, including the
 * part about it doing nothing against a distributed attempt.
 *
 * Higher than SIGN_IN_ORIGIN_LIMIT despite metering a cheaper action, because
 * it counts hits rather than failures: an office behind one NAT signing in
 * normally produces zero of those and sixty of these.
 */
export const LOOKUP_ORIGIN_LIMIT: Limit = {
  max: 60,
  windowMs: ATTEMPT_WINDOW_MS,
};

/** The bucket for origin-keyed lookups. */
export const LOOKUP_ORIGIN_BUCKET = "sign-in-lookup:origin";

// --- Mailing a sign-in link --------------------------------------------------
//
// The limits above meter an ANSWER — a lookup that reads the database and hands
// something back. These meter an ACT with a cost outside the app: a mail leaves
// the operator's sending domain, addressed to whoever typed the form.
//
// It is the same act lib/email-change/rules.ts already bounds, and the sentence
// there is the one that applies here too — "a way to mail a stranger repeatedly
// from the operator's own verified sending domain, which costs the operator
// their sender reputation, not just the stranger their patience." The
// difference is that this door is OPEN: nobody is signed in, so there is no
// account counter to lean on and no `requireActiveUser()` behind it.
//
// ⚠️ These do not stop an account being created — a magic link creates nothing
// until somebody clicks it, which docs/auth-setup.md → "Creating the
// operator/admin account" says in as many words. What they protect is
// deliverability, which no restart brings back.

/**
 * Per address, three an hour — CONFIRMATION_LIMIT in lib/email-change/rules.ts
 * unchanged, because it is the same act with the same cost. A person whose mail
 * is slow asks twice; a third within the hour is already generous.
 */
export const LINK_SEND_LIMIT: Limit = {
  max: 3,
  windowMs: 60 * 60 * 1000,
};

/** Hits against the address a link would be mailed to. */
export const LINK_SEND_BUCKET = "sign-in-link";

/**
 * Per origin — and here, unlike the lookup pair, this is not the half that does
 * the work but the half that catches the OTHER shape.
 *
 * Varying the address on every request never lets the per-address counter fire,
 * and that is precisely the shape worth having: a script does not want three
 * mails to one person, it wants one mail to three hundred. The full reasoning,
 * including the part about a distributed attempt walking past it, is at
 * SIGN_IN_ORIGIN_LIMIT above and holds here unchanged.
 *
 * Twenty an hour rather than sixty: this is mail, not a database read, and an
 * office behind one NAT does not sign in twenty times in an hour by mail.
 */
export const LINK_SEND_ORIGIN_LIMIT: Limit = {
  max: 20,
  windowMs: 60 * 60 * 1000,
};

/** The bucket for origin-keyed link sends. */
export const LINK_SEND_ORIGIN_BUCKET = "sign-in-link:origin";
