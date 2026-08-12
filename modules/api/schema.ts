// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The keys a program uses to reach this app on a member's behalf.
//
// One row per key a Member issued to themselves on `/dashboard/account`. The
// key travels in an `Authorization: Bearer …` header. Today there is one
// audience:
//
//   `api` — a program of the customer's own — typically their mobile app —
//           calling `/api/v1/…`. See `docs/api.md`.
//
// A key is BOUND to its audience anyway: `authenticate()` in
// `modules/api/keys/keys.ts` refuses a key across the line. The point is blast
// radius — if a second key-bearing surface is ever added, a key pasted into
// it must not silently double as a full REST credential, and vice versa.
//
// ── Why the secret is not in this table ────────────────────────────────────
// `tokenHash` is a SHA-256 of the key, and the key itself is shown exactly
// once, in the dialog that created it. Nothing in this app can read it back —
// not the Operator's user page, not `node run.mjs data-export`, not a log line.
// A key is a credential that acts with its owner's rights; an Operator who can
// read one can act as that customer.
//
// The hash is SHA-256 rather than the scrypt of `lib/credentials/hash.ts`, and
// that difference is deliberate rather than an inconsistency:
//
//   a password — chosen by a human, low entropy, guessable. A memory-hard KDF
//                is what makes guessing expensive. 16 MB per check is fine
//                because it happens once per sign-in.
//   a key      — 32 random bytes this app generated. There is no dictionary
//                to run against it and nothing to slow an attacker down that
//                the entropy has not already stopped. Meanwhile it is checked
//                on EVERY call, and 16 MB of RAM per call is a denial of
//                service somebody else pays for.
//
// ── Why the row survives revocation ────────────────────────────────────────
// Revoking sets `revokedAt` and keeps the row. A deleted key leaves the Member
// with no record that it ever existed, and "which of my keys did I revoke, and
// when" is exactly the question somebody asks after they revoke one in a hurry.
// `modules/api/keys/rules.ts` → `keyState()` is what turns these three timestamps
// into live / expired / revoked.
import { pgTable, text, timestamp, index, pgEnum } from "drizzle-orm/pg-core";
import { users } from "@/db/schema-core";

/**
 * What a key may do.
 *
 * Two values, not a permission system. The point of the split is the one thing
 * that actually goes wrong with a key pasted into a program: the caller may be
 * driven by a model reading text somebody else wrote, so a key that can only
 * read cannot be talked into spending, deleting or ordering anything. `read`
 * is the default in the UI for that reason.
 *
 * Enforced in the call path, never in the client and never merely by which
 * tools or endpoints are listed — hiding something is cosmetics, the refusal
 * has to be in the call (`modules/api/api/guard.ts` against the handler's scope
 * requirement, `lib/ai/run-tool.ts` against a tool's `readOnly`).
 *
 * The Postgres enum is still called `mcp_scope` — it predates this table's
 * rename to `api_keys`, and renaming a pg enum buys nothing while adding
 * migration risk.
 */
export const keyScopeEnum = pgEnum("mcp_scope", ["read", "write"]);

/**
 * Which surface a key opens. See the header — a key never crosses over.
 * The Postgres enum keeps the historical `mcp` value: the migrations that
 * created it are immutable, and Postgres cannot drop an enum value. Nothing
 * mints one any more — `AUDIENCES` in `modules/api/keys/rules.ts` is the live
 * list.
 */
export const keyAudienceEnum = pgEnum("api_key_audience", ["mcp", "api"]);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Whose key it is, and whose rights it carries. `cascade`, like the chat
    // transcripts and unlike the billing tables: a key belonging to a deleted
    // account is not a record of anything, it is a credential nobody may use.
    memberId: text("member_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // What the Member called it ("Claude on my laptop"). Theirs to write, so it
    // is personal data and it is in docs/data-protection.md.
    name: text("name").notNull(),
    // SHA-256 of the whole key, hex. UNIQUE so a lookup is one index probe —
    // the request path must not scan a table per call.
    tokenHash: text("token_hash").notNull().unique(),
    // The first characters of the key, in clear. Purely so the list on the
    // account page can say WHICH key a row is ("ds24api_a3F…") without being
    // able to show the key. Not a secret and not enough to be one.
    prefix: text("prefix").notNull(),
    scope: keyScopeEnum("scope").notNull().default("read"),
    audience: keyAudienceEnum("audience").notNull().default("api"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    // Last successful authentication. Written at most once a minute (see
    // modules/api/keys/keys.ts) — an exact value would mean a write on every
    // single call, and "was this key used today" is the question it exists to
    // answer.
    lastUsedAt: timestamp("last_used_at"),
    // When it stops working on its own, or NULL for "until somebody revokes
    // it". An expiry is offered because the common case — a key on a laptop
    // that gets replaced — is one nobody remembers to clean up.
    expiresAt: timestamp("expires_at"),
    // Revoked since. NULL means live. A timestamp rather than a flag for the
    // same reason `users.blockedAt` is one: the database then also records WHEN.
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [
    // Every read from the account page is "this member's keys of one audience,
    // newest first".
    index("api_keys_member").on(t.memberId, t.createdAt),
  ],
);
