// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 What a module answers about one person — the shape of both halves.
//
// A module with tables holds personal data, so it owes an Art. 15 answer in
// BOTH exports: the member's own download (`lib/privacy/export.ts`) and the
// operator's command (`scripts/privacy/export-data.mjs`). The manifest refuses a
// module that declares `tables` without both contributors, so there is no way to
// ship one that stores rows and cannot name them.
//
// ── Why TWO files per module and not one ───────────────────────────────────
// The command is bare Node — it runs against a `DATABASE_URL` with no bundler,
// no `@/` alias and no TypeScript — while the app reads through Drizzle. That
// split already exists in the core (the command mirrors every query as raw SQL)
// and it is the reason `privacy.ts` and `privacy.mjs` are separate.
//
// ── And the clamp that keeps them saying the same thing ────────────────────
// Both, and the manifest, declare the same `sections`. `scripts/modules/
// privacy.test.ts` compares all three and fails the build on a disagreement.
//
// That is not ceremony: the core's two exports drifted once, one gated on
// `isCommunityEnabled()` and the other on a local `.enabled === true`, and a
// single typo in a config file made a member's own download claim the app held
// no community data while the operator's command returned every row. Two
// answers to one Art. 15 request. `lib/privacy/export.test.ts` carries the full
// account.
//
// ── 🚨 And what neither may do ─────────────────────────────────────────────
// **Consult whether the module is switched on.** Switching a module off deletes
// nothing; an export says what the app HOLDS. A section that appears and
// vanishes with a config flag describes the PRODUCT instead of the DATA. The
// only thing that may make a section absent is the module being absent — and
// `module remove` refuses while its tables hold rows, precisely so that absent
// code and absent data stay the same statement.

/** What a module contributes to the member's own download. */
export interface ModulePrivacy {
  /**
   * The section names this module adds — identical to its manifest's
   * `privacy.sections` and to the `.mjs` twin's.
   */
  readonly sections: readonly string[];

  /**
   * Everything this module holds about one member, keyed by section.
   *
   * Every declared section is a key in the result, always — an empty array or
   * `null` for a member with nothing, never an absent heading. An absent
   * heading reads as "this application has no such thing", which is a claim
   * about the data rather than about this member.
   */
  build(memberId: string): Promise<Record<string, unknown>>;
}
