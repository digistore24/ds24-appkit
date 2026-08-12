// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Database schema (Drizzle ORM / Postgres).
//
// Contains:
//  - the Auth.js tables (users, accounts, sessions, verificationTokens) for the
//    @auth/drizzle-adapter.
//  - the Digistore tables (orders, subscriptions, …) — see schema-digistore.ts,
//    which is re-exported here so `drizzle-kit` sees everything in one schema file.
import {
  pgTable,
  text,
  timestamp,
  primaryKey,
  integer,
} from "drizzle-orm/pg-core";

// --- Auth.js core tables -----------------------------------------------------

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  // Role for simple authorization (e.g. "owner" = SAAS operator).
  // Canonical values: "owner" (admin) | "moderator" (trusted member, no admin
  // rights) | "member" (customer) — see lib/roles.ts. Plain text on purpose:
  // adding a role is a TypeScript change, never a migration.
  role: text("role").notNull().default("member"),
  // Creation date — shown in the user management screen.
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  // Corroborates this member's id inside the Digistore24 `tracking[custom]`
  // value (see lib/digistore/custom.ts). 10 random alphanumerics, handed out on
  // the first checkout rather than at sign-up — five different code paths
  // create users, and a backfill would miss whichever is added next.
  //
  // NOT a credential: it never authenticates a session. It only makes a member
  // id insufficient on its own inside a value the server alone writes.
  checkoutToken: text("checkoutToken").unique(),
  // Blocked since — NULL means "not blocked". Deliberately a timestamp rather
  // than a yes/no: this way the database also records SINCE WHEN someone has
  // had no access. How the block is enforced: see lib/users/blocked.ts.
  blockedAt: timestamp("blockedAt", { mode: "date" }),
  // The member's OPTIONAL password, as a scrypt hash — NULL means "this
  // account has no password", which is the default and stays the common case.
  // Signing in by magic link works either way; a password only ever ADDS a
  // second door (lib/credentials/).
  //
  // Never the plaintext, and never readable back: the format is
  // `scrypt$N$r$p$salt$hash` and lib/credentials/hash.ts is the only file that
  // writes or reads it. No admin screen, no export and no log line may show
  // it — an operator who can read a password can impersonate a customer, and
  // customers reuse passwords elsewhere.
  passwordHash: text("passwordHash"),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationTokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);

// --- Digistore tables --------------------------------------------------------
// Kept in a file of their own (domain separation), re-exported here.
export * from "./schema-digistore";

// --- Billing models (subscriptions + prepaid tokens) -------------------------
// Subscriptions plus token balance/ledger for usage-based billing.
// See schema-tokens.ts.
export * from "./schema-tokens";

// --- Entitlements ------------------------------------------------------------
// `grants` — the app's own answer to "may this person use this". The one table
// an access question touches. See schema-entitlements.ts.
export * from "./schema-entitlements";

// --- Self-service account management -----------------------------------------
// `email_changes` — a Member's requested address change, until it is confirmed.
// See schema-email-changes.ts.
export * from "./schema-email-changes";

// --- AI assistant -------------------------------------------------------------
// `chat_messages` — the transcripts of the in-app assistant. Deleted with the
// member, unlike the billing records. See schema-chat.ts.
export * from "./schema-chat";

// --- API keys ----------------------------------------------------------------
// `api_keys` — the credentials a Member issues to reach this app from a
// program of their own calling `/api/v1` (audience `api`). Hashed, never

// --- AI usage -----------------------------------------------------------------
// `ai_usage` — one row per model call: task, provider, model, tokens, outcome.
// Numbers only, never content. See schema-ai-usage.ts.
export * from "./schema-ai-usage";

// --- Scheduled jobs -----------------------------------------------------------
// `cron_runs` — one row per job: when it last ran, whether it worked, and the
// lock that keeps two app instances from running it at once. See schema-cron.ts
// and docs/cron.md.
export * from "./schema-cron";

// --- Operator notifications ------------------------------------------------------
// `notification_sends` — one row per message this app has already sent its
// operator. Two columns, no recipient and no text: the "records that it sent
// one" half of cron rule 1, kept free of any privacy question by construction.
// See schema-notify.ts, lib/notify/sent-once.ts and docs/data-protection.md §11a.
export * from "./schema-notify";

// --- Signing in as a user ------------------------------------------------------
// `impersonations` — one row per support session in which an Operator acted as
// a customer. Written BEFORE the session changes, because the row is also what
// authorises the change. See schema-impersonation.ts.
export * from "./schema-impersonation";

// --- Consent -------------------------------------------------------------------
// `consent_records` — what a Member agreed to, which wording they read, and
// when. Append-only: a withdrawal is a new row, never an edit. Empty in an app
// that declares no purposes in config/consent.json, which is the shipped state.
// See schema-consent.ts and docs/compliance.md.
export * from "./schema-consent";

// --- Media ---------------------------------------------------------------------
// `media` — one row per stored picture, video, recording or downloadable file.
// The BYTES are not here; they live in object storage (lib/media/store.ts), and
// `deleteMedia()` is what keeps the two in step — a cascade removes the row and
// leaves the object, which is a deletion request not honoured. Three
// visibilities: product imagery, a customer's own upload, and the file a buyer
// paid for (gated by hasPlan()). See schema-media.ts and docs/visuals.md.
export * from "./schema-media";

// --- Setup ---------------------------------------------------------------------
// `setup_keys`, `setup_confirmations`, `setup_audit` — the surface a developer's
// coding agent uses to set THIS environment up over MCP: create an owner, grant
// a plan, upload media, create a community group. It is the third delivery
// layer and the only one that takes ids, so it pays for what `/api/v1` gets
// free: an operator-only key, an enumerated surface, and one append-only row per
// act. Empty in every app that has not switched it on in config/setup.json,
// which is the shipped state. See schema-setup.ts and docs/setup-mcp.md.
export * from "./schema-setup";

