// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What a module says about itself on `/dashboard/account` — the shape.
//
// Hand-written; `lib/modules/account-notes-registry.ts` is the generated list.
//
// ── Why this exists at all ─────────────────────────────────────────────────
// A module with tables already owes an Art. 15 answer in both exports
// (`lib/modules/privacy.ts`). That answers "what does the file contain". It does
// NOT answer the other question a member asks, which they ask BEFORE pressing
// anything: what is in this download, and what exactly disappears if I delete my
// account.
//
// Those two sentences used to live in the core's own message files and
// enumerated other people's data — the community's profile, moderator duties,
// posts and read markers; the api module's keys. That is wrong in both
// directions at once, which is why neither obvious fix works:
//
//   · a fresh app has none of those modules, so the core promised a member data
//     it did not hold and offered to delete rows that do not exist;
//   · simply deleting the clauses would make an app that DOES hold that data
//     describe its own Art. 15 answer too narrowly — and understating an access
//     request is the worse direction of the two.
//
// Only the module knows what it stores, so the module writes the sentence. The
// manifest refuses a module with `tables` that declares no `privacy.accountNotes`
// (`scripts/modules/manifest.mjs`), the same way it already refuses one that
// cannot answer Art. 15 at all.
//
// ── Keys, not sentences ────────────────────────────────────────────────────
// A manifest carries message KEYS and the text lives in the module's own
// `messages/{de,en}.json`, like every other text in this app — a sentence in a
// manifest would be the one string in the product that cannot be translated.
// The key has to sit in a namespace the module declares, which the manifest also
// checks: a module writes its own text and never into somebody else's.
//
// ── Client-safe, and that is a rule ────────────────────────────────────────
// `app/dashboard/account/privacy-ui.tsx` is a client component, so everything
// reachable from the generated registry lands in the browser bundle. These
// entries are two strings and a module id — no config reader, no `@/db`, no
// module logic. The same rule `lib/modules/nav.ts` states for navigation, for
// the same reason.

/** One installed module's two sentences for the account page. */
export interface ModuleAccountNote {
  /** The module id — a stable React key, and what the ordering follows. */
  module: string;
  /**
   * Message key for the download's hint: what of this module's data is in the
   * member's own export. Fully qualified, e.g. `community.accountExportNote`.
   */
  export: string;
  /**
   * Message key for the deletion dialog's "what goes" list.
   *
   * ⚠️ It says what GOES. A module whose rows partly survive — the community's
   * posts stay as empty placeholders so the replies under them still make
   * sense — says so in this sentence rather than leaving a member to discover
   * it afterwards. The core's `deleteStaysBody` covers only the core's own
   * accounting records and cannot speak for a module.
   */
  deletion: string;
}
