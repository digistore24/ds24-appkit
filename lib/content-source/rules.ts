// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Keyword search over app content — the pure half every source shares.
//
// Deliberately simple: lowercase term matching, a title bonus, a capped
// body-frequency score. No stemming, no IDF, no embeddings, no database
// features — a source that outgrows this swaps its own internals (tsvector,
// a search service) without moving the `ContentSource` interface, because
// ranking is source-internal by design
// (docs/content-source.md → *Writing a source*).
//
// Everything here operates on `SearchableRecord`, a neutral shape any source
// can produce — a knowledge doc, a course row out of the database, a code
// constant. That is what keeps the file case and the database case on ONE
// scoring arithmetic instead of two that agree today.

/** The neutral shape a source feeds into ranking. */
export interface SearchableRecord {
  /** The source's stable handle for this record — a slug or a doc path. */
  ref: string;
  title: string;
  body: string;
}

/** Terms are capped so a pasted paragraph cannot turn into a 200-clause scan. */
export const MAX_SEARCH_TERMS = 8;

/**
 * A query, reduced to the terms worth matching.
 *
 * Lowercased, split on anything that is not a letter or digit (unicode-aware,
 * so umlauts survive), terms under two characters dropped (they match
 * everything and rank nothing), deduplicated, capped at MAX_SEARCH_TERMS.
 */
export function searchTerms(query: string): string[] {
  if (typeof query !== "string") return [];
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 2);
  return [...new Set(terms)].slice(0, MAX_SEARCH_TERMS);
}

/** A title hit outranks any amount of body hits for one term. */
const TITLE_SCORE = 10;
/** Per body occurrence, capped — frequency is a signal, not the verdict. */
const BODY_OCCURRENCE_CAP = 5;

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1 && count < BODY_OCCURRENCE_CAP) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * How well one record answers the terms. 0 means "no term matched at all" —
 * the caller drops those rather than presenting noise as a weak hit.
 */
export function scoreRecord(record: SearchableRecord, terms: string[]): number {
  if (terms.length === 0) return 0;
  const title = record.title.toLowerCase();
  const body = record.body.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += TITLE_SCORE;
    score += occurrences(body, term);
  }
  return score;
}

/**
 * The records worth returning, best first.
 *
 * Only records with a score above zero; ties keep the input order, so a source
 * that feeds records in its own canonical order (course position, handbook
 * path order) gets that order back as the tie-break — deterministic on every
 * machine, no locale-sensitive sort anywhere.
 */
export function rankRecords(
  records: readonly SearchableRecord[],
  query: string,
  limit: number,
): SearchableRecord[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  return records
    .map((record, index) => ({ record, index, score: scoreRecord(record, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.record);
}

/** Snippets stay short enough that a hit list of ten reads as a list. */
export const SNIPPET_MAX_CHARS = 240;

/**
 * The passage a hit shows — a window around the first matching term.
 *
 * Whitespace (including newlines) collapses to single spaces first, so a
 * snippet out of a Markdown body does not arrive as three half-lines. The
 * window is cut on word boundaries with an ellipsis on each trimmed edge;
 * when no term occurs (a title-only hit), the head of the body stands in.
 */
export function snippetFor(
  body: string,
  terms: string[],
  maxChars: number = SNIPPET_MAX_CHARS,
): string {
  const text = body.replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;

  const lower = text.toLowerCase();
  let hit = -1;
  for (const term of terms) {
    const index = lower.indexOf(term);
    if (index !== -1 && (hit === -1 || index < hit)) hit = index;
  }

  if (hit === -1) return `${cutAtWord(text, 0, maxChars)}…`;

  // Center the window on the first hit, clamped to the text.
  let start = Math.max(0, hit - Math.floor(maxChars / 2));
  if (start + maxChars > text.length) start = Math.max(0, text.length - maxChars);

  const prefix = start > 0 ? "…" : "";
  const suffix = start + maxChars < text.length ? "…" : "";
  const window =
    start > 0 ? cutFromWord(text, start, maxChars) : cutAtWord(text, start, maxChars);
  return `${prefix}${window}${suffix}`;
}

/** A slice ending on a word boundary where one exists inside the window. */
function cutAtWord(text: string, start: number, maxChars: number): string {
  const slice = text.slice(start, start + maxChars);
  if (start + maxChars >= text.length) return slice;
  const lastSpace = slice.lastIndexOf(" ");
  return lastSpace > maxChars / 2 ? slice.slice(0, lastSpace) : slice;
}

/** A slice that also starts on a word boundary — for windows cut mid-text. */
function cutFromWord(text: string, start: number, maxChars: number): string {
  const slice = text.slice(start, start + maxChars);
  const firstSpace = slice.indexOf(" ");
  const trimmed =
    firstSpace !== -1 && firstSpace < maxChars / 4 ? slice.slice(firstSpace + 1) : slice;
  return cutAtWord(trimmed, 0, maxChars);
}
