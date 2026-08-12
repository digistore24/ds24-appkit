// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// A requested-but-unconfirmed move of a Member's account address.
//
// This table holds ONLY changes still in flight. A confirmed one is applied to
// `users.email` and its row is deleted; an abandoned one simply sits here until
// it is replaced or expires. There is no history — what the address used to be
// is not a question this app answers, and keeping a log of every address a
// customer ever held is data nobody asked us to store.
//
// Why a table of its own rather than Auth.js's `verificationTokens`: there,
// `identifier` means "the address to sign in AS". Here the address is the one
// to move TO, and the account it belongs to is a separate fact. Reusing the
// column would make one word mean two things in the one place where confusing
// them hands somebody else your account.
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./schema-core";

export const emailChanges = pgTable("email_changes", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  // One pending change per Member — a new request replaces the previous one, so
  // a typo is corrected by asking again rather than by finding a cancel button.
  memberId: text("memberId")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  // Already normalised (trimmed, lowercased) when it is written.
  newEmail: text("newEmail").notNull(),
  // The SHA-256 of the token, never the token. A database dump must not yield
  // working confirmation links — each one moves an account to an address the
  // reader chooses. SHA-256 rather than scrypt on purpose: this is 32 bytes of
  // CSPRNG output, not a human-chosen secret, so there is nothing to brute
  // force and no reason to make our own lookup slow.
  tokenHash: text("tokenHash").notNull().unique(),
  requestedAt: timestamp("requestedAt", { mode: "date" }).notNull().defaultNow(),
  expiresAt: timestamp("expiresAt", { mode: "date" }).notNull(),
});
