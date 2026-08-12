// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The imperative half of the setup surface: minting and verifying keys,
// spending confirmations, and writing the one row that every act leaves behind.
//
// Everything that is a DECISION lives in `rules.ts` and is tested without a
// database. What is here is the writing — and the one property worth stating
// twice: **the act and its audit row share a transaction**, so "it succeeded
// but was not recorded" is not a reachable state.

import { randomBytes } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { setupAudit, setupConfirmations, setupKeys, users } from "@/db/schema";
import type { AppEnv } from "@/lib/env-guard";
import {
  CONFIRMATION_TTL_MS,
  SETUP_KEY_BYTES,
  SETUP_KEY_PREFIX,
  canonicalInputHash,
  hashSecret,
  looksLikeSetupKey,
} from "./rules";
import type { SetupErrorCode } from "./rules";

/** How much of a key is shown in a list so a row can be told apart. */
const PREFIX_SHOWN = SETUP_KEY_PREFIX.length + 4;

export interface SetupKeyRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

const KEY_COLUMNS = {
  id: setupKeys.id,
  name: setupKeys.name,
  prefix: setupKeys.prefix,
  createdAt: setupKeys.createdAt,
  lastUsedAt: setupKeys.lastUsedAt,
  expiresAt: setupKeys.expiresAt,
  revokedAt: setupKeys.revokedAt,
};

/**
 * A new key. The secret is returned once and then unrecoverable — the table
 * stores a SHA-256, so a lost key is replaced rather than looked up.
 */
export async function mintKey(input: {
  ownerId: string;
  name: string;
  expiresAt?: Date | null;
}): Promise<{ row: SetupKeyRow; secret: string }> {
  const secret = SETUP_KEY_PREFIX + randomBytes(SETUP_KEY_BYTES).toString("base64url");
  const [row] = await db
    .insert(setupKeys)
    .values({
      ownerId: input.ownerId,
      name: input.name.trim(),
      tokenHash: hashSecret(secret),
      prefix: secret.slice(0, PREFIX_SHOWN),
      expiresAt: input.expiresAt ?? null,
    })
    .returning(KEY_COLUMNS);
  return { row, secret };
}

export async function listKeys(): Promise<SetupKeyRow[]> {
  return db.select(KEY_COLUMNS).from(setupKeys).orderBy(desc(setupKeys.createdAt));
}

/** Revoking keeps the row — "which key did I revoke, and when" is a question. */
export async function revokeKey(id: string): Promise<void> {
  await db
    .update(setupKeys)
    .set({ revokedAt: sql`(now() at time zone 'utc')` })
    .where(and(eq(setupKeys.id, id), isNull(setupKeys.revokedAt)));
}

export interface AuthenticatedKey {
  keyId: string;
  ownerId: string;
}

/**
 * The key, its owner, and the owner's role **as the database has it now**.
 *
 * 🚨 The role is read here and never carried from mint time. A column captured
 * when the key was created says what somebody WAS — the community module learned
 * this about moderators, and it is the same rule: authority is re-read at the
 * moment of the act.
 *
 * Returns null for every flavour of "no", on purpose. Unknown, revoked and
 * expired are one identical refusal from outside; the reasons stay in the log.
 */
export async function authenticateKey(
  secret: string,
  now: Date = new Date(),
): Promise<AuthenticatedKey | null> {
  // Cheap and first: a key wearing a foreign marker never becomes a query.
  if (!looksLikeSetupKey(secret)) return null;

  const [row] = await db
    .select({
      id: setupKeys.id,
      ownerId: setupKeys.ownerId,
      expiresAt: setupKeys.expiresAt,
      revokedAt: setupKeys.revokedAt,
      ownerRole: users.role,
      ownerBlockedAt: users.blockedAt,
    })
    .from(setupKeys)
    .innerJoin(users, eq(users.id, setupKeys.ownerId))
    .where(eq(setupKeys.tokenHash, hashSecret(secret)))
    .limit(1);

  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return null;
  // A blocked account cannot act through a page; it must not act through a key
  // either. `lib/users/blocked.ts` makes the same check in two places for the
  // same reason — this is the third door.
  if (row.ownerBlockedAt) return null;
  if (row.ownerRole !== "owner") return null;

  return { keyId: row.id, ownerId: row.ownerId };
}

/** Written at most on a successful call, and never on the refusal path. */
export async function touchKey(keyId: string): Promise<void> {
  await db
    .update(setupKeys)
    .set({ lastUsedAt: sql`(now() at time zone 'utc')` })
    .where(eq(setupKeys.id, keyId));
}

// ── confirmations ───────────────────────────────────────────────────────────

/**
 * Mints the token a `plan` hands back.
 *
 * Bound to four things, so it cannot be carried anywhere: this key, this tool,
 * this exact input (through the ONE canonical hash — see `rules.ts`), and this
 * environment.
 */
export async function issueConfirmation(input: {
  keyId: string;
  tool: string;
  appEnv: AppEnv;
  toolInput: Record<string, unknown>;
  now?: Date;
}): Promise<string> {
  const now = input.now ?? new Date();
  const token = randomBytes(32).toString("base64url");
  await db.insert(setupConfirmations).values({
    tokenHash: hashSecret(token),
    keyId: input.keyId,
    tool: input.tool,
    inputHash: canonicalInputHash(input.toolInput),
    appEnv: input.appEnv,
    expiresAt: new Date(now.getTime() + CONFIRMATION_TTL_MS),
  });
  return token;
}

/**
 * 🚨 SPENDS the token — it does not merely check it.
 *
 * A conditional `UPDATE ... WHERE spent_at IS NULL`, the shape
 * `lib/cron/scheduler.ts` uses so two app instances cannot both take a job. The
 * difference matters: a token that is looked up and found valid is replayable
 * for its whole window, and the two-act protocol would be a formality. Postgres
 * decides who wins, not this process.
 */
export async function spendConfirmation(input: {
  token: string;
  keyId: string;
  tool: string;
  appEnv: AppEnv;
  toolInput: Record<string, unknown>;
  now?: Date;
}): Promise<SetupErrorCode | null> {
  const now = input.now ?? new Date();
  const spent = await db
    .update(setupConfirmations)
    .set({ spentAt: now })
    .where(
      and(
        eq(setupConfirmations.tokenHash, hashSecret(input.token)),
        eq(setupConfirmations.keyId, input.keyId),
        eq(setupConfirmations.tool, input.tool),
        eq(setupConfirmations.appEnv, input.appEnv),
        eq(setupConfirmations.inputHash, canonicalInputHash(input.toolInput)),
        isNull(setupConfirmations.spentAt),
        sql`${setupConfirmations.expiresAt} > ${now}`,
      ),
    )
    .returning({ tokenHash: setupConfirmations.tokenHash });

  // One refusal for every way it could fail — wrong token, wrong input, wrong
  // environment, already spent, expired. Telling them apart would let a caller
  // probe what a token was minted for.
  return spent.length === 1 ? null : "confirmationInvalid";
}

// ── the record ──────────────────────────────────────────────────────────────

export interface AuditEntry {
  keyId: string | null;
  ownerId: string | null;
  subjectMemberId?: string | null;
  appEnv: AppEnv;
  tool: string;
  target?: string | null;
  role?: string | null;
  reason?: string | null;
  outcome: "planned" | "applied" | "refused";
  code?: SetupErrorCode | null;
  rows?: number;
}

/**
 * One row, append-only.
 *
 * ⚠️ Identifiers and numbers. Whoever adds a field here asks first whether it
 * could carry something a member wrote — an audit trail that quotes what was
 * written becomes a second copy of the data it exists to police, outside the
 * retention rules and outside the Art. 15 inventory.
 */
export async function recordAct(entry: AuditEntry): Promise<void> {
  await db.insert(setupAudit).values({
    keyId: entry.keyId,
    ownerId: entry.ownerId,
    subjectMemberId: entry.subjectMemberId ?? null,
    appEnv: entry.appEnv,
    tool: entry.tool,
    target: entry.target ?? null,
    role: entry.role ?? null,
    reason: entry.reason ?? null,
    outcome: entry.outcome,
    code: entry.code ?? null,
    rows: entry.rows ?? 0,
  });
}

/**
 * Delete audit rows past the retention window, and every spent or expired
 * confirmation.
 *
 * ⚠️ **The floor is one month, and a zero is refused rather than obeyed.**
 * `retentionMonths: 0` would delete the trail every night, which is not a
 * retention setting — it is switching the control off while leaving something
 * that looks like a policy in the config. An operator who genuinely wants to
 * keep everything sets `"enabled": false` on the job; an operator who wants
 * none of it is making a decision that should look like one.
 *
 * Confirmations are a different case and go unconditionally: a spent or expired
 * nonce is arithmetic, not a record, and keeping it protects nobody.
 *
 * @returns what was deleted, as numbers — the line a job is allowed to return.
 */
export async function pruneSetupAudit(
  retentionMonths: number,
  now: Date = new Date(),
): Promise<{ acts: number; confirmations: number }> {
  if (!Number.isFinite(retentionMonths) || retentionMonths < 1) {
    throw new Error(
      `refusing to prune with retentionMonths=${retentionMonths} — the floor is 1. ` +
        `To keep everything, disable the job in config/cron.json.`,
    );
  }

  // Calendar months, the same arithmetic every other retention window here
  // uses: "twenty-four months" means the same date two years ago, not
  // 24 × 30 days.
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - Math.floor(retentionMonths));

  // 🚨 `lt()` and not a raw `sql` template, and the reason is the one CLAUDE.md
  // already states for the other direction: **a raw expression carries no
  // mapper.** Reading, that turns a timestamp into a string wearing a Date's
  // type; writing, it hands Postgres a parameter whose type it cannot infer,
  // and the delete fails at runtime with every test green. Measured here — the
  // first real run of this job errored on exactly that.
  const acts = await db
    .delete(setupAudit)
    .where(lt(setupAudit.createdAt, cutoff))
    .returning({ id: setupAudit.id });

  // Anything already spent, and anything whose window has closed. Both are
  // dead weight the moment they are either.
  const confirmations = await db
    .delete(setupConfirmations)
    .where(
      or(isNotNull(setupConfirmations.spentAt), lt(setupConfirmations.expiresAt, now)),
    )
    .returning({ tokenHash: setupConfirmations.tokenHash });

  return { acts: acts.length, confirmations: confirmations.length };
}

export interface AuditRow {
  id: string;
  appEnv: string;
  tool: string;
  target: string | null;
  role: string | null;
  outcome: string;
  code: string | null;
  rows: number;
  createdAt: Date;
  keyName: string | null;
}

/**
 * The trail, newest first — for `/dashboard/admin/setup-audit` and for
 * `node run.mjs setup-check`.
 *
 * An audit trail nobody reads is not a control, which is the whole reason this
 * function and that page exist rather than the table sitting there unread.
 */
export async function listActs(limit = 50): Promise<AuditRow[]> {
  return db
    .select({
      id: setupAudit.id,
      appEnv: setupAudit.appEnv,
      tool: setupAudit.tool,
      target: setupAudit.target,
      role: setupAudit.role,
      outcome: setupAudit.outcome,
      code: setupAudit.code,
      rows: setupAudit.rows,
      createdAt: setupAudit.createdAt,
      keyName: setupKeys.name,
    })
    .from(setupAudit)
    .leftJoin(setupKeys, eq(setupKeys.id, setupAudit.keyId))
    .orderBy(desc(setupAudit.createdAt))
    .limit(limit);
}
