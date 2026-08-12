// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Issuing, checking and revoking the keys a program authenticates with.
//
// The imperative shell around `modules/api/keys/rules.ts`: this file owns the
// writes and the one query on the request path. Every decision it makes — is
// the shape right, is the key live, may this scope run this — is a pure
// function next door, so it can be tested without a database.
//
// One table, one audience today (`api` — the customer's own programs). Every
// function here still takes the audience it acts for, and `authenticate()`
// refuses a key across the line — so a second key-bearing surface added later
// cannot widen an existing credential. See `modules/api/schema.ts` for why.
//
// ⚠️ NOTHING HERE MAY EVER RETURN A STORED KEY. `createKey()` returns the
// secret once, because it just generated it and the Member has to see it;
// every other function in this file returns rows without one. The table holds
// a SHA-256 and there is nothing to return — see `modules/api/schema.ts` for
// why that hash and not scrypt.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull, or, gt, sql } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { apiKeys } from "../schema";
import {
  KEY_BYTES,
  KEY_PREFIXES,
  MAX_LIVE_KEYS,
  ApiKeyError,
  expiryFor,
  keyState,
  looksLikeKey,
  prefixOf,
  type Audience,
  type KeyState,
  type LifetimeDays,
  type Scope,
} from "./rules";

/** SHA-256, hex. The one place a key becomes what the table stores. */
function hash(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/**
 * A fresh key: the audience's marker plus 32 random bytes as base64url.
 *
 * `randomBytes` and not `Math.random()`, obviously — but worth stating why
 * base64url specifically: the value is pasted into shell commands, JSON config
 * files and environment variables by people following a copy-paste
 * instruction, and base64url is the alphabet that survives all three without
 * quoting. Standard base64 would put `+` and `/` in a URL and a `=` at the end
 * of an env var.
 */
function mint(audience: Audience): string {
  return KEY_PREFIXES[audience] + randomBytes(KEY_BYTES).toString("base64url");
}

// ── Creating ────────────────────────────────────────────────────────────────

export interface CreatedKey {
  id: string;
  name: string;
  scope: Scope;
  expiresAt: Date | null;
  /** The secret, IN CLEAR. Shown once and never obtainable again. */
  secret: string;
}

/**
 * Issues a key for one Member.
 *
 * The caller has already proved who that is — this function takes a `memberId`
 * because it is also what the Operator path would need, but there IS no
 * Operator path and there must not be one: an Operator who can mint a key can
 * act as the customer, which is the same line
 * `app/dashboard/admin/users/[id]` already refuses to cross for passwords.
 * The callers are the Member's own Server Actions and the API's own
 * sign-in→token endpoint — every one of them has authenticated the member
 * first.
 *
 * Throws `ApiKeyError("apiTooManyKeys")` at the limit. Revoked and expired keys
 * do not count, so replacing a key never hits it; the limit is per audience,
 * so one surface's full card could never block another's.
 */
export async function createKey(args: {
  memberId: string;
  name: string;
  scope: Scope;
  lifetimeDays: LifetimeDays;
  audience: Audience;
}): Promise<CreatedKey> {
  const live = await countLiveKeys(args.memberId, args.audience);
  if (live >= MAX_LIVE_KEYS) throw new ApiKeyError("apiTooManyKeys");

  const secret = mint(args.audience);
  const expiresAt = expiryFor(args.lifetimeDays);

  const [row] = await db
    .insert(apiKeys)
    .values({
      memberId: args.memberId,
      name: args.name,
      tokenHash: hash(secret),
      prefix: prefixOf(secret),
      scope: args.scope,
      audience: args.audience,
      expiresAt,
    })
    .returning({ id: apiKeys.id });

  return { id: row.id, name: args.name, scope: args.scope, expiresAt, secret };
}

/**
 * Live keys across the whole installation — what `content-check` asks.
 *
 * 🚨 **A number, and deliberately nothing else.** The presence report is read by
 * whoever can reach the setup surface; whose key it is, what they called it and
 * when it was last used are the member's, not an operator's dashboard. There is
 * no `listAllKeys()` here and adding one would be a different decision.
 *
 * It lives beside `countLiveKeys` rather than in the presence check itself
 * because a module's contributor is a thin caller — `lib/setup/module-boundary.test.ts`
 * refuses one that reaches `@/db`, and a second query against these columns is
 * the copy nobody looks at when the "still valid" rule changes.
 */
export async function countAllLiveKeys(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(apiKeys)
    .where(
      and(
        isNull(apiKeys.revokedAt),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, sql`(now() at time zone 'utc')`)),
      ),
    );
  return row?.n ?? 0;
}

/** Live keys this member holds for one audience — measured against `MAX_LIVE_KEYS`. */
export async function countLiveKeys(memberId: string, audience: Audience): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.memberId, memberId),
        eq(apiKeys.audience, audience),
        isNull(apiKeys.revokedAt),
        // "no end date OR not yet reached". `now() at time zone 'utc'` and not
        // bare `now()`, for the same reason `lib/entitlements/manage.ts` spells
        // it out: `expires_at` is a `timestamp` WITHOUT time zone that MEANS
        // UTC, and comparing it to a `timestamptz` makes Postgres cast the left
        // side using a session time zone nothing in this project sets.
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, sql`(now() at time zone 'utc')`)),
      ),
    );
  return row?.n ?? 0;
}

// ── Listing and revoking ────────────────────────────────────────────────────

export interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  scope: Scope;
  state: KeyState;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

/** This member's keys of one audience, newest first. Never carries a secret. */
export async function listKeys(memberId: string, audience: Audience): Promise<KeyRow[]> {
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      scope: apiKeys.scope,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.memberId, memberId), eq(apiKeys.audience, audience)))
    .orderBy(desc(apiKeys.createdAt));

  return rows.map((row) => ({ ...row, state: keyState(row) }));
}

/**
 * Revokes one key. Idempotent, and scoped to its owner.
 *
 * `memberId` is in the WHERE clause and not merely checked beforehand — that is
 * what makes this immune to an id from a form naming somebody else's key. A
 * Server Action is an HTTP endpoint of its own; the list only rendering the
 * caller's own keys protects nothing. No audience parameter on purpose: both
 * are the member's own keys, and revoking is the one act that must never be
 * blocked on a technicality.
 *
 * Throws `ApiKeyError("apiUnknownKey")` when nothing matched, which covers both
 * "no such key" and "not yours" with one answer — a caller has no business
 * learning which.
 */
export async function revokeKey(args: { memberId: string; keyId: string }): Promise<void> {
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, args.keyId),
        eq(apiKeys.memberId, args.memberId),
        isNull(apiKeys.revokedAt),
      ),
    )
    .returning({ id: apiKeys.id });

  if (!row) {
    // Already revoked is success, not an error — a second click must not
    // produce a red message about a key that is, in fact, revoked.
    const [existing] = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, args.keyId), eq(apiKeys.memberId, args.memberId)))
      .limit(1);
    if (!existing) throw new ApiKeyError("apiUnknownKey");
  }
}

// ── Authenticating a request ────────────────────────────────────────────────

/** Who is calling, and with what rights. */
export type Authenticated =
  | { ok: true; memberId: string; keyId: string; scope: Scope; role: string }
  | { ok: false; reason: "malformed" | "unknown" | "expired" | "revoked" | "blocked" };

/**
 * Turns a bearer value into a member, or says why not.
 *
 * ONE query, joined against `users`: the block check has to happen here because
 * there is no session to hang it off. `requireActiveUser()` covers the browser
 * path; this is the same two checks for a caller that never signs in. A blocked
 * account whose key still worked would be an account that is only blocked in
 * the browser. The `role` rides along in the same join because some endpoints
 * decide by it (media upload) and a second query per request would be waste.
 *
 * The audience is enforced twice: `looksLikeKey` refuses the wrong prefix
 * before any query, and the WHERE clause refuses a row of the wrong audience
 * even if a prefix ever lied. A foreign-audience key is `malformed`, not
 * `unknown` — it never reaches the database.
 *
 * ⚠️ The caller must answer every `ok: false` the same way — 401, no detail.
 * The reasons exist for the server log, where they are the difference between
 * "somebody is guessing" and "a customer's key expired". Telling the caller
 * which turns this endpoint into an oracle for whether a key exists.
 */
export async function authenticate(bearer: string, audience: Audience): Promise<Authenticated> {
  if (!looksLikeKey(bearer, audience)) return { ok: false, reason: "malformed" };

  const [row] = await db
    .select({
      id: apiKeys.id,
      memberId: apiKeys.memberId,
      tokenHash: apiKeys.tokenHash,
      scope: apiKeys.scope,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
      lastUsedAt: apiKeys.lastUsedAt,
      blockedAt: users.blockedAt,
      role: users.role,
    })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.memberId))
    .where(and(eq(apiKeys.tokenHash, hash(bearer)), eq(apiKeys.audience, audience)))
    .limit(1);

  if (!row) return { ok: false, reason: "unknown" };

  // The lookup already matched on the hash, so this compares a value to
  // itself — and it is here on purpose. It costs nothing, and it means the day
  // somebody changes the lookup to fetch by `prefix` and compare afterwards
  // (the obvious "optimisation" when a prefix index gets added), the comparison
  // is already the constant-time one rather than a `===` that leaks.
  const expected = Buffer.from(row.tokenHash, "utf8");
  const actual = Buffer.from(hash(bearer), "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "unknown" };
  }

  const state = keyState(row);
  if (state !== "live") return { ok: false, reason: state };
  if (row.blockedAt) return { ok: false, reason: "blocked" };

  await touch(row.id, row.lastUsedAt);

  return { ok: true, memberId: row.memberId, keyId: row.id, scope: row.scope, role: row.role };
}

/** Written at most once a minute — see `modules/api/schema.ts`. */
const TOUCH_INTERVAL_MS = 60_000;

/**
 * Records that a key was used, without turning every call into a write.
 *
 * A model fires tool calls in bursts, and a mobile app loads a screen with
 * several requests; an exact `lastUsedAt` would mean an UPDATE per call on a
 * row every one of those calls also reads. The question this column answers is
 * "is this key still in use", and a minute's resolution answers it.
 *
 * Failure is swallowed. A key that authenticated is a key that authenticated —
 * losing the bookkeeping must not turn a good call into a 500.
 */
async function touch(keyId: string, lastUsedAt: Date | null): Promise<void> {
  const now = Date.now();
  if (lastUsedAt && now - lastUsedAt.getTime() < TOUCH_INTERVAL_MS) return;
  try {
    await db.update(apiKeys).set({ lastUsedAt: new Date(now) }).where(eq(apiKeys.id, keyId));
  } catch (error) {
    console.error("[api-keys] could not record key usage:", error);
  }
}
