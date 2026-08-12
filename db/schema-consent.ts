// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What a Member agreed to, and when.
//
// ── Why this table exists at all ───────────────────────────────────────────
// As it ships, this app needs no consent from anybody. A purchase runs on
// Art. 6(1)(b) GDPR — performance of a contract — and the only cookies set are
// the session, the language and the theme, all either strictly necessary or the
// direct result of somebody operating a switch. `docs/data-protection.md` §5
// says so and means it.
//
// This table is for the moment the app grows something that DOES need one: a
// marketing mail (§ 7 UWG), an analytics tag that touches the device
// (§ 25 TDDDG), a feature that sends more to a third party than the product
// requires. It ships EMPTY, with no purposes declared in `config/consent.json`,
// and an app that never declares one never writes a row here.
//
// ── Append-only. Nothing here is ever updated ──────────────────────────────
// A withdrawal is a NEW row with `granted: false`, not an edit of the old one.
// That is the difference between a consent store and a consent *record*:
// Art. 7(1) requires you to be able to demonstrate that consent was given, and
// a row you overwrote demonstrates nothing. The current answer for a purpose is
// simply its newest row (`lib/consent/rules.ts` → `currentConsent`).
//
// It also means refusals are kept. A refusal is worth as much as a consent —
// it is the evidence that "no" was honoured, and it is what stops the dialog
// asking again tomorrow.
//
// ── Why a boolean is not enough, and `textVersion` is the reason ───────────
// Consent is consent to something SPECIFIC. Somebody who agreed to
// "we mail you when your invoice is ready" has not agreed to
// "we mail you offers from our partners", and an app that changed the sentence
// and kept the old `true` is processing without a basis while believing the
// opposite. So the version of the wording travels with the record, and a bump
// in `config/consent.json` makes every consent given under the old text count
// as unasked again.
//
// ── Why it cascades ────────────────────────────────────────────────────────
// Same reasoning as `chat_messages` and the opposite of `orders`: this is the
// member's own declaration, held for as long as it is being relied on. There is
// no retention obligation pulling the other way — once the account is gone, the
// processing it permitted is gone too, so keeping the record would be keeping
// personal data for its own sake.
//
// ── What is deliberately NOT here ──────────────────────────────────────────
// The IP address. Consent logs in the wild routinely store one "as proof", and
// it proves very little — this app does not store IP addresses anywhere
// (`docs/data-protection.md` §4) and Art. 7(1) does not ask for one. Adding it
// would put a new category of personal data into the app in the name of data
// protection.
//
// Also not here: consent from somebody who is not signed in. A visitor cannot
// be attributed to a row without first identifying them on their device, which
// is the very thing § 25 TDDDG governs — that case belongs on the device, not
// in this table. See `docs/compliance.md` §2.
import { pgTable, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { users } from "./schema-core";

export const consentRecords = pgTable(
  "consent_records",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // NOT NULL, like `chat_messages.member_id`: a declaration with nobody
    // attached is not evidence of anything, and no page or export could ever
    // find it again.
    memberId: text("member_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The purpose key from `config/consent.json`. Free text on purpose — a
    // Postgres enum would need a migration every time an app declares a new
    // purpose, which is a thing the OPERATOR does, not the developer.
    purpose: text("purpose").notNull(),
    /** `true` = agreed. `false` = refused, or withdrawn — see the note above. */
    granted: boolean("granted").notNull(),
    // Which wording they read. Kept as it was at the time, never back-filled:
    // the whole point is that it can differ from what the config says today.
    textVersion: text("text_version").notNull(),
    // Which language they read it in. Part of "informed": a person shown the
    // German text agreed to the German sentence, and if the two translations
    // ever drift, this row says which one is the one they saw.
    locale: text("locale").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // Every read is "this member's newest row for this purpose" — and the
    // account page asks for all of them at once, which this serves too.
    index("consent_records_member").on(t.memberId, t.purpose, t.createdAt),
  ],
);
