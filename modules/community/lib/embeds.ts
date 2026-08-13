// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// **The embedded discussions this app has. Nothing else.**
//
// A discussion can hang off a room (`/dashboard/community/groups/…`, the
// operator creates those) or off a PAGE of this app — the conversation about
// lesson three, under lesson three. The second kind exists only by being
// declared here, in code, and this file is the only place a Subject Key and
// its access level are ever written down.
//
// One list the app edits — the role `modules/activity/activities.ts` and
// `lib/ai/companions.ts` play, and deliberately that model rather than a
// table: **an embedded discussion the template declared would be a discussion
// nobody chose.** So this ships **empty**, and a page that wants one adds an
// entry here and puts one component on itself:
//
// ```tsx
// <EmbeddedDiscussion subjectKey="kurs:wehen-atmung:lektion-3" heading={…} />
// ```
//
// That is the whole integration. The component
// (`components/community/embedded-discussion.tsx`) brings its own guards, its
// own empty state and — since the live channel shipped — its own updating: a
// post somebody else writes appears without the page doing anything about it.
//
// ── Why a registry in CODE and not a table ────────────────────────────────
// Declarations deploy with the pages that embed them. A row would not: rows do
// not travel with `git push` (the trap `docs/content.md` describes), so a
// lesson page shipped to PROD would find its discussion undeclared there —
// and, worse, an admin surface for embeds would be a second place to write an
// access level, which is the one field this file exists to own.
//
// ── The three rules that keep a Subject Key from becoming a door ───────────
//
// 1. 🚨 **PROVENANCE.** The access level comes from THIS FILE, keyed by the
//    Subject Key — never from the request. The component takes a key and the
//    heading of the page it sits on; it never takes an access level and never
//    takes plan keys. A gate the browser sends is no gate (the same IDOR class
//    `modules/activity/activities.ts` rule 2 documents).
//
// 2. 🚨 **COMPOSITION.** The host page's own guard does not substitute for
//    this one. A lesson page gated on `course_complete` and a discussion gated
//    on `course_complete_plus` compose: the page decides whether the page is
//    shown, the discussion decides — server-side, on every read and every
//    write — whether the discussion is. Neither delegates to the other, so
//    moving the component to a differently-gated page cannot widen it.
//
// 3. 🚨 **THE KEY IS OPAQUE, AND IT IS THE APP'S OWN SLUG.** Never a foreign
//    key, never a row id — the exact convention `db/schema-chat.ts` documents
//    for `conversationId`: a real foreign key would demand a taxonomy for
//    subjects this module cannot know about, and a row id does not survive a
//    re-seed. Beyond "non-empty" and "unique" this file puts no grammar on it;
//    the grammar belongs to the app. **It is never rendered**, either: an
//    embedded discussion draws its heading from the host page's context, and a
//    Subject Key on screen is course structure disclosed to somebody who was
//    reading a page.
//
// A worked example, to copy rather than to uncomment — it names a product key
// that does not exist here, so uncommenting it fails the test beside this file
// rather than shipping a room nobody meant:
//
// ```ts
// export const EMBEDS: readonly EmbedDeclaration[] = [
//   {
//     subjectKey: "course:birth-prep:unit-3",
//     // The same four levels a room has (`GROUP_ACCESS_LEVELS`) — this module
//     // has ONE access grammar, not one per surface.
//     accessLevel: "plan",
//     // Meaningful for "plan" and empty for every other level. ANY of them
//     // opens it, never all — a member mid-upgrade briefly holds two keys, or
//     // neither.
//     planKeys: ["course_complete"],   // keys from config/digistore-products.json
//   },
// ];
// ```
//
// ── Where the check happens, and why the TEST is the write gate ────────────
// A group's plan keys are validated when the operator SAVES the group
// (`groupPlanProblems()`), because `hasPlan()` THROWS on a key the product
// registry does not know — an unvalidated key would not mean "no access", it
// would take down the lesson page for a paying member. A code registry has no
// save: **build time is write time**, so `embeds.test.ts` runs that same
// validation function over every declaration and a typo'd or retired key fails
// the build instead of a customer.
import type { GroupAccessLevel } from "./rules";

/**
 * One embedded discussion, declared.
 *
 * The access shape is the group's, reused rather than re-minted: `mayViewEmbed()`
 * in `rules.ts` answers it by calling `mayEnterGroup()`, so a room and an embed
 * cannot start disagreeing about what "plan" means.
 */
export interface EmbedDeclaration {
  /** This app's own opaque slug for the thing the discussion sits on. See rule 3. */
  subjectKey: string;
  /** Exactly one of the four levels, never a set. */
  accessLevel: GroupAccessLevel;
  /** The product keys a `plan` embed accepts — empty for every other level. */
  planKeys: readonly string[];
}

/**
 * Every embedded discussion this app has.
 *
 * It ships **empty** — see the header for why, and for the worked example.
 */
export const EMBEDS: readonly EmbedDeclaration[] = [];

/**
 * The declaration for a Subject Key, or `null`.
 *
 * ⚠️ **`null` is not an error and never becomes its own answer.** A key nobody
 * declared and a key this member is not entitled to are ONE refusal, merged in
 * `mayViewEmbed()` — so a member cannot learn which Subject Keys exist on this
 * installation by trying them, which for a course is the table of contents of
 * something they have not bought.
 */
export function findEmbed(subjectKey: string): EmbedDeclaration | null {
  return EMBEDS.find((embed) => embed.subjectKey === subjectKey) ?? null;
}
