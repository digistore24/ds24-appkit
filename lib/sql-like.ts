// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Escaping for `LIKE`/`ILIKE` patterns — one function, every search box.
//
// ── Why it has a file of its own ───────────────────────────────────────────
// It lived in `lib/digistore/purchase-filter.ts`, where the first search box
// happened to be built. That was already crooked — `modules/courses/lib/manage.ts`
// imports it from there to search LESSONS — and the user list's search made it
// the third caller. Three unrelated searches reaching into a purchases filter
// is how the fourth one quietly writes its own escape instead, and an escape
// that exists twice is one that is wrong in one of the two places
// (`CLAUDE.md` → *A checker that reads source as TEXT goes through
// `blankComments()`* makes the same argument for a different function).
//
// Nothing here touches the database, React or config — it is called from query
// builders, from filter modules and from tests.

/**
 * A fragment, safe to drop between two `%` in an `ILIKE` pattern.
 *
 * `%`, `_` and `\` are LIKE syntax: unescaped, an operator who pastes an
 * address containing one gets a different result set than the one they asked
 * for — and a lone `%` matches everything. Postgres uses `\` as the default
 * escape character for LIKE/ILIKE, so no `ESCAPE` clause is needed; what is
 * needed is that the backslash is doubled FIRST, otherwise the escapes added
 * below would themselves be escaped away.
 */
export function escapeLikeFragment(fragment: string): string {
  return fragment
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}
