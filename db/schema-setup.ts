// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The three tables behind `/api/setup` — the surface a developer's coding agent
// uses to set an environment up. `docs/setup-mcp.md` is the reference.
//
// ── Why this surface has tables of its own ─────────────────────────────────
// It is the third delivery layer, and the only one that takes ids. Pages serve
// a human on a session; `/api/v1` serves a member's own program and NEVER
// accepts an id, which is what makes an IDOR impossible there rather than
// merely unlikely. This one accepts ids, because acting on somebody else's row
// is the entire job — creating an owner, granting a plan, uploading a course's
// media into production.
//
// That property cannot be bought back, so it is paid for instead: an
// operator-only key (`setup_keys`), a surface small enough to enumerate, and a
// record of every act (`setup_audit`). The reasoning, and the list of things
// deliberately left unbuildable, is the architecture spine's SECURITY.md.

import { pgTable, text, timestamp, integer, index, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./schema-core";

/** What the app itself resolved — never what the caller claimed. */
export const setupEnvEnum = pgEnum("setup_app_env", ["development", "staging", "production"]);

/**
 * How an act ended.
 *
 * `planned` is a first-class outcome rather than a non-event: outside DEV every
 * mutation is plan → apply, and a plan that was never applied is exactly the
 * thing somebody wants to see when they ask what an agent was doing.
 */
export const setupOutcomeEnum = pgEnum("setup_outcome", ["planned", "applied", "refused"]);

/**
 * A key that opens the setup surface of THIS environment.
 *
 * ⚠️ Deliberately not a row in `api_keys`, and not a third value in that
 * table's audience enum. A key must not widen by being pasted somewhere else,
 * and the two surfaces answer opposite questions about identity — one refuses
 * to take an id, this one exists to take them. Sharing a table would be one
 * `WHERE audience = …` away from a member's key acting as an operator's.
 *
 * There is nothing to scope: the surface is enumerated and every tool in it is
 * an operator tool. `read`/`write` would be a distinction without a difference.
 */
export const setupKeys = pgTable(
  "setup_keys",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // The operator who minted it. `cascade`: a key belonging to a deleted
    // account is not a record of anything, it is a credential nobody may use.
    //
    // 🚨 This is provenance, not authority. The role is re-read from `users` at
    // the moment of every act — a JWT, or a column read once at mint time,
    // carries what somebody WAS. The community module learned this about
    // moderators; it is the same rule.
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // What the operator called it ("Claude on my laptop"). Personal data, and
    // therefore in docs/data-protection.md.
    name: text("name").notNull(),
    // SHA-256 of the whole key, hex. UNIQUE, so authenticating is one index
    // probe rather than a scan on the request path.
    tokenHash: text("token_hash").notNull().unique(),
    // The first characters, in clear, so the list can say WHICH key a row is
    // ("ds24setup_a3F…") without being able to show it. Not a secret.
    prefix: text("prefix").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at"),
    // NULL means no expiry. A bootstrap key always sets one — see
    // `scripts/setup/bootstrap.mjs`; a credential minted before anybody has
    // signed in should not outlive the afternoon.
    expiresAt: timestamp("expires_at"),
    // Revoking keeps the row: "which key did I revoke, and when" is exactly the
    // question somebody asks right after revoking one in a hurry.
    revokedAt: timestamp("revoked_at"),
  },
  (table) => [index("setup_keys_owner_idx").on(table.ownerId)],
);

/**
 * The nonce behind plan → apply.
 *
 * 🚨 Its own table, and not a column on `setup_audit`, for one reason:
 * spending a token is a conditional `UPDATE ... WHERE spent_at IS NULL` — the
 * shape `lib/cron/scheduler.ts` uses so two instances cannot both take a job —
 * and the audit table has no update path by construction. A nonce table and an
 * audit table are different things and stay different tables.
 *
 * ⚠️ A token that is merely CHECKED and not spent is replayable for its whole
 * window, which would make the two-act protocol a formality. The conditional
 * update is the control; the lookup is not.
 */
export const setupConfirmations = pgTable(
  "setup_confirmations",
  {
    // SHA-256 of the token. The token itself is returned by `plan` once.
    tokenHash: text("token_hash").primaryKey(),
    keyId: text("key_id")
      .notNull()
      .references(() => setupKeys.id, { onDelete: "cascade" }),
    tool: text("tool").notNull(),
    // 🚨 The canonical hash of the CALL — the schema-applied input and, at the
    // one door that carries a payload, the sha256 of those bytes. So a token
    // minted for one input cannot apply another, and a token minted for one
    // FILE cannot apply a different one (A79: the input at `/api/setup/media`
    // is a `path` this app never opens, so an input-only binding confirmed a
    // label while the bytes were free to change). `canonicalCallHash()` in
    // lib/setup/rules.ts is the ONE spelling of it — plan and apply both call
    // that helper.
    //
    // ⚠️ The COLUMN keeps its name. Renaming it is a migration for a word, on a
    // table whose rows live two minutes; the comment is where the truth is, and
    // the value is one hash rather than two columns so that a caller cannot tell
    // "wrong input" from "wrong file" apart (see `spendConfirmation()`).
    inputHash: text("input_hash").notNull(),
    appEnv: setupEnvEnum("app_env").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
    spentAt: timestamp("spent_at"),
  },
  (table) => [index("setup_confirmations_key_idx").on(table.keyId)],
);

/**
 * Every setup act, once, append-only.
 *
 * Append-only in the sense that matters: **nothing that writes an act ever
 * rewrites one.** There are exactly TWO other writers in this application, both
 * named here because an absolute claim that a reader can disprove in one grep
 * teaches them to distrust the rest of this comment:
 *
 *   · `lib/setup/manage.ts` — the retention sweep (`prune-setup-audit`), which
 *     DELETES rows older than the bound. Ageing out is not rewriting history.
 *   · `lib/users/manage.ts` — erasure, which nulls `reason` when the member the
 *     row is about deletes their account (§ 14g). The ACT stays; the prose
 *     somebody wrote about a person goes. A trail with a way to erase yourself
 *     out of it is not a trail, and a trail that keeps free text about a deleted
 *     member is not lawful — this is the seam between the two.
 *
 * `lib/setup/audit-writers.test.ts` holds that list to the tree. Anything else
 * touching this table is the failure this comment exists to make visible. It is the compensating control for a surface that
 * takes ids: the answer to "what touched production?" is a query rather than an
 * investigation.
 *
 * 🚨 **Identifiers and numbers — never payload content.** The rule
 * `cron_runs.lastDetail` and `docs/reports/module-removals.md` already follow,
 * and it bites harder here: an audit trail that quotes what was written becomes
 * a second copy of the data it exists to police — outside the retention rules,
 * outside the Art. 15 inventory, and readable by everyone who can read the
 * trail. `target` is `member@example.com` or `gruppe-einsteiger`, never what was
 * said to them.
 */
export const setupAudit = pgTable(
  "setup_audit",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // 🚨 NULLABLE, both of them, and that is not laziness about referential
    // integrity. A non-nullable key reference cannot record the one call you
    // most want recorded — an attempt with a key that does not exist. A tidy
    // schema drops exactly the failed-authentication row.
    //
    // `set null` rather than `cascade` for the same reason: revoking or
    // deleting a key must not erase what was done with it.
    keyId: text("key_id").references(() => setupKeys.id, { onDelete: "set null" }),
    ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
    // The member this act was ABOUT, when it was about one.
    //
    // Without this column the Art. 15 slice is impossible: `target` is
    // polymorphic text and cannot be queried per person, so the operator's
    // export could carry this section while the member's own download could
    // not — and `lib/privacy/export.test.ts` compares the two section by
    // section and fails on precisely that asymmetry.
    subjectMemberId: text("subject_member_id").references(() => users.id, {
      onDelete: "set null",
    }),
    appEnv: setupEnvEnum("app_env").notNull(),
    tool: text("tool").notNull(),
    /** A natural key — an email, a slug. Never content. */
    target: text("target"),
    /**
     * The role a tool wrote, when it wrote one.
     *
     * The named exception to "identifiers, never content", because under the
     * owner-promotion rule the role IS the security question — and an audit
     * that omits it is an audit of everything except the thing worth auditing.
     */
    role: text("role"),
    /**
     * The written reason, where a tool demands one.
     *
     * The second named exception, for the argument the operator pages already
     * make: a written reason IS the accountability, and it belongs on the act.
     * ⚠️ `revokeGrantByHand()` does not ask for one — it takes `{actor, grantId}`
     * and writes the constant `REVOKED` — so the TOOL asks, and this is where
     * the answer lands.
     */
    reason: text("reason"),
    outcome: setupOutcomeEnum("outcome").notNull(),
    /** The refusal code from SETUP_ERROR_CODES, when it was refused. */
    code: text("code"),
    /** How many rows. Never which. */
    rows: integer("rows").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    // The read path: "what happened here lately", newest first.
    index("setup_audit_created_idx").on(table.createdAt),
    // The Art. 15 path.
    index("setup_audit_subject_idx").on(table.subjectMemberId),
  ],
);
