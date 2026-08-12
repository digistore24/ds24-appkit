// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Does the app's own notebook know what has been built?
//
// `docs/app.md` is the one file that describes THIS app — not the template.
// CLAUDE.md holds the rules everybody gets; `docs/app.md` holds what was built
// on top of them, one entry per feature. It matters because a session is short
// and a project is not: the agent that adds the fifth feature was not there for
// the first four, and what it does not find written down, it invents again.
//
// So this asks the cheapest possible question — is everything that was built
// mentioned in the notes? — and it asks it by CONTENT, never by file dates. A
// fresh `git clone` writes today's timestamp onto every file, so an mtime
// comparison would announce that notes written months ago are out of date.
//
// A missing mention is a hint, not an error: somebody may be in the middle of
// building. The greeting says it once per session (scripts/dev/session-start.mjs)
// and CLAUDE.md → "Adding a feature" makes it step 9.
//
// ── Why more than pages ────────────────────────────────────────────────────
// This used to look at folders under `app/dashboard/` and nothing else, which
// meant the reminder covered the one artefact that is hardest to overlook — a
// page is visible, somebody clicks it. A scheduled job, a new table and a page
// area outside the dashboard are exactly the things a later session cannot see
// and therefore builds a second time. They cost one sync read each, so they are
// asked about too.

/** The notes file, or `null` when there is none yet. Never throws. */
export function readNotes(read) {
  try {
    return read("docs/app.md");
  } catch {
    return null;
  }
}

/** Regex-safe: a folder may be called `[id]` or `(marketing)`. */
function escape(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Is this name absent from the notes? The one matching rule, in one place. */
function missing(name, notes) {
  return !new RegExp(`(^|[^a-z0-9_-])${escape(name)}([^a-z0-9_-]|$)`, "i").test(notes);
}

/**
 * The items from `items` that `notes` does not mention.
 *
 * `items` are `{ kind, name }` — kind is what the greeting prints in brackets
 * ("page", "table", "job"), name is what is looked for in the notes. A table
 * called `submissions` and a page called `submissions` are one mention as far
 * as this is concerned, and that is right: the notes describe the feature, not
 * the file system.
 *
 * Matched on a word boundary, so a page `report` is not counted as covered by a
 * paragraph about `reports` — the near-miss is the case worth catching, because
 * it reads as covered to everybody skimming.
 */
export function unwrittenItems(items, notes) {
  if (items.length === 0) return [];
  if (notes === null) return [...items];
  return items.filter((item) => missing(item.name, notes));
}

/** How many get named before the line turns into a wall. */
const SHOWN = 4;

/**
 * The greeting's line, or `""` when there is nothing to say.
 *
 * Capped deliberately: the whole greeting is a dozen lines, and a project that
 * has just grown twelve tables would otherwise push everything else — including
 * the `[Setup: …]` state — out of sight. Four names and a count carry the same
 * message.
 */
export function describeUnwritten(items) {
  if (items.length === 0) return "";
  const shown = items.slice(0, SHOWN).map((item) => `${item.name} (${item.kind})`);
  const rest = items.length - shown.length;
  const list = shown.join(", ") + (rest > 0 ? ` — +${rest} more` : "");
  return (
    `[App notes: docs/app.md does not cover ${list}. ` +
    `Write the entry when the feature works — CLAUDE.md → Adding a feature, step 9.]`
  );
}
