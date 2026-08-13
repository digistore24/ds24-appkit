// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What a lesson's slug may look like — one grammar, for the app and for the
// applier.
//
// ── Why this is `.mjs` ─────────────────────────────────────────────────────
// Two writers reach `courses_units.slug`, and only one of them can import
// TypeScript:
//
//   admin/actions.ts                 — the operator's form, behind requireOwner()
//   content/appliers/course.mjs      — a repo content file, applied with a SETUP_KEY
//
// The rule lived in `rules.ts` and its own docstring claimed the applier
// enforced it — *"Refusing it HERE means the applier says so about a content
// file, which is a sentence somebody can act on, rather than a page that
// scrolls nowhere."* It did not. The applier checked only non-empty and unique
// (2026-08-13), so a content file could write `Übung 1` or `a/b` and the app
// would then spell that one address three different ways: the course overview
// percent-encodes it, `content-source.ts` builds it raw for the assistant's deep
// link, and `pages/actions.ts` revalidates the raw path. One of the three works.
//
// ⚠️ `rules.ts` re-exports it, so nothing that already imports `slugProblem`
// from there has to change, and `module.json`'s `coreExport` names this file
// too — `scripts/core/purity.test.ts` requires every import of a manifest file
// to be a manifest file itself.

/**
 * Why this is not a usable slug, or `null`.
 *
 * Lower case, digits, single hyphens. ⚠️ ASCII only, deliberately: the slug
 * becomes a url, and `lib/content-source/anchors.ts` refuses a non-ASCII one, so
 * `knoten-fuer-anfaenger` is legal and `knoten-für-anfänger` is not.
 *
 * @param {string} slug
 * @returns {string | null}
 */
export function slugProblem(slug) {
  if (!slug) return "a slug may not be empty";
  if (slug.length > 80) return `"${slug}" is longer than 80 characters`;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return `"${slug}" is not a slug — lower-case ASCII letters, digits and single hyphens`;
  }
  return null;
}

/**
 * What an operator may write into ONE lesson. Ceilings, not targets.
 *
 * Here rather than in `rules.ts` for the same reason the slug grammar is: the
 * content applier is a `.mjs` and cannot import a `.ts`, and a ceiling only one
 * of two writers enforces is a ceiling the other walks past. `rules.ts`
 * re-exports both.
 */
export const MAX_UNIT_BODY_CHARS = 100_000;
export const MAX_UNIT_TITLE_CHARS = 200;
