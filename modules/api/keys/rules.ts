// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The key system's decisions, as pure functions.
//
// One key system, and today one audience: the HTTP API (`docs/api.md`). Every
// key still CARRIES its audience, deliberately — a credential must not widen
// by being pasted somewhere else, so a second key-bearing surface added later
// gets its own audience and its own prefix instead of inheriting this one.
// Everything here is testable without a database and without a request — the
// same split `lib/tokens/rules.ts` and `lib/users/rules.ts` make, for the
// same reason: what governs access to somebody's account has to be assertable
// one case at a time.
//
// LANGUAGE: this file has no sentences. It returns CODES, and only the Server
// Action or the page turns one into a sentence in the reader's language
// (AD-10). The API endpoint is the one exception, and deliberately: its
// caller is a program, not a person, so its errors are English and stable.

// ── The key format ──────────────────────────────────────────────────────────

/** Which surface a key opens. A key never crosses over — see `keys.ts`. */
export const AUDIENCES = ["api"] as const;
export type Audience = (typeof AUDIENCES)[number];

/**
 * What every key this app issues starts with, per audience.
 *
 * A visible, greppable prefix is not decoration. It is what lets a secret
 * scanner — GitHub's, your CI's, your own — recognise one of these in a commit
 * and tell somebody, and it is what lets a human reading a config file know
 * what they are looking at. The prefix names the audience, which is how
 * `looksLikeKey` refuses a foreign token before any database is asked — and
 * why a second surface would get its own prefix, never this one.
 */
export const KEY_PREFIXES: Record<Audience, string> = {
  api: "ds24api_",
};

/** Bytes of randomness behind the secret. 32 → 256 bits. */
export const KEY_BYTES = 32;

/**
 * How much of a key the account page may show.
 *
 * The marker plus four characters — enough to tell two keys apart in a list,
 * far too little to be one. Four characters of base64url is 24 bits; guessing
 * the remaining 232 is not a thing that happens.
 */
export const PREFIX_LENGTH = KEY_PREFIXES.api.length + 4;

/** 32 bytes as base64url is 43 characters, unpadded. */
const SECRET_LENGTH = 43;

const SECRET_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${SECRET_LENGTH}}$`);

/**
 * Does this look like a key this app issued FOR THIS AUDIENCE?
 *
 * A cheap shape check in front of the database, so a header full of somebody
 * else's bearer token — a Digistore24 key, a GitHub token, whatever a client
 * had lying around — costs a regex rather than an index probe. The audience
 * is part of the shape: a key with a foreign audience's marker is refused
 * HERE, before any query. It proves nothing about the key being valid; that
 * is `keys.ts`.
 */
export function looksLikeKey(value: string, audience: Audience): boolean {
  const marker = KEY_PREFIXES[audience];
  if (!value.startsWith(marker)) return false;
  return SECRET_PATTERN.test(value.slice(marker.length));
}

/** The part of a key that may be shown. Safe on any input. */
export function prefixOf(key: string): string {
  return key.slice(0, PREFIX_LENGTH);
}

// ── What a key is allowed to do ─────────────────────────────────────────────

export const SCOPES = ["read", "write"] as const;
export type Scope = (typeof SCOPES)[number];

export function isScope(value: unknown): value is Scope {
  return (SCOPES as readonly unknown[]).includes(value);
}

/**
 * May a key with this scope run something with this `readOnly` flag?
 *
 * The one asymmetry worth reading twice: a `read` key may run read-only
 * operations ONLY, while a `write` key may run everything. There is no third
 * scope that can write but not read — an operation that changes something has
 * to be able to see what it changed, and splitting that produces a permission
 * nobody can use.
 */
export function mayRun(scope: Scope, operationIsReadOnly: boolean): boolean {
  return scope === "write" || operationIsReadOnly;
}

// ── The life of a key ───────────────────────────────────────────────────────

/** What a stored key is right now. Only `live` may authenticate. */
export type KeyState = "live" | "expired" | "revoked";

/**
 * Revoked beats expired, deliberately.
 *
 * A key that was revoked and has since also run past its expiry is shown to the
 * Member as revoked, because that is the fact they acted on. The order matters
 * for the label only — neither state authenticates anything.
 */
export function keyState(
  key: { expiresAt: Date | null; revokedAt: Date | null },
  now: Date = new Date(),
): KeyState {
  if (key.revokedAt) return "revoked";
  if (key.expiresAt && key.expiresAt.getTime() <= now.getTime()) return "expired";
  return "live";
}

/** The lifetimes the account page offers, in days. `null` = no end date. */
export const LIFETIMES_DAYS = [30, 90, 365, null] as const;

export type LifetimeDays = (typeof LIFETIMES_DAYS)[number];

export function isLifetime(value: unknown): value is LifetimeDays {
  return (LIFETIMES_DAYS as readonly unknown[]).includes(value);
}

/** The instant a key created now would stop working, or null for never. */
export function expiryFor(days: LifetimeDays, now: Date = new Date()): Date | null {
  if (days === null) return null;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

// ── Limits that keep one account from becoming an attack surface ────────────

/**
 * How many LIVE keys one Member may hold, PER AUDIENCE.
 *
 * Not a licensing limit — a blast-radius one. Somebody with fifty keys has no
 * idea which machines still hold one, and a key nobody can account for is a key
 * nobody revokes. Revoked and expired keys do not count against it, so the
 * limit never blocks replacing a key. Counted per audience because the two
 * lists are managed as two cards — one full card must not block the other.
 */
export const MAX_LIVE_KEYS = 10;

/** Longest a key name may be. It is a label in a list, not a document. */
export const MAX_NAME_LENGTH = 60;

/**
 * The one thing a Member types when creating a key.
 *
 * Returns the cleaned name, or a code. A blank name is rejected rather than
 * defaulted: a list of keys all called "Key" is a list nobody can revoke from
 * with any confidence.
 */
export function checkKeyName(
  value: unknown,
): { ok: true; name: string } | { ok: false; code: ApiKeyErrorCode } {
  if (typeof value !== "string") return { ok: false, code: "apiNameRequired" };
  const name = value.trim().replace(/\s+/g, " ");
  if (name === "") return { ok: false, code: "apiNameRequired" };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, code: "apiNameTooLong" };
  return { ok: true, name };
}

/**
 * The codes the account page translates. No sentences here (AD-10).
 *
 * Listed as a VALUE and not only as a type, because `i18n/messages.test.ts`
 * iterates it: every code has to exist in `de.json` and `en.json` or the build
 * fails. A code with no translation reaches the Member as its own name.
 *
 * `apiDisabled` is here rather than in the feature's own module because it
 * surfaces in the same place as the rest — the key card on
 * `/dashboard/account` — and one registry entry beats two.
 */
export const API_KEY_ERROR_CODES = [
  "apiNameRequired",
  "apiNameTooLong",
  "apiTooManyKeys",
  "apiUnknownKey",
  "apiDisabled",
  // The two refusals the card is supposed to have made already. They exist
  // because the card is never the boundary: `createApiKeyAction` asks the same
  // three questions again, and a Member who reaches it anyway gets a sentence
  // rather than a stack trace.
  "apiSelfServiceOff",
  "apiPlanRequired",
] as const;

export type ApiKeyErrorCode = (typeof API_KEY_ERROR_CODES)[number];

export class ApiKeyError extends Error {
  constructor(public readonly code: ApiKeyErrorCode) {
    super(code);
    this.name = "ApiKeyError";
  }
}
