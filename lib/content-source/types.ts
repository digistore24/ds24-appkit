// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The uniform interface app content answers AI agents through.
//
// One interface, one caller: the four standard content tools the in-app chat
// executes with the session's member (lib/ai/tools.ts). What varies per app is
// WHERE the content lives — repo files, code constants, database tables — and
// that variation is a `ContentSource` implementation, registered in
// `sources.ts`. The interface does not move when the storage does.
// The full guide is docs/content-source.md.

/**
 * Who is looking.
 *
 * The layer CARRIES the viewer so a source CAN scope what it returns — content
 * behind a plan (`hasPlan()`), a member's own uploads, an operator preview.
 * The template ships no authorization logic here, deliberately: which content
 * is visible to whom is an application decision, and a generic answer would be
 * wrong somewhere. A source that returns member-scoped content is responsible
 * for scoping it — docs/content-source.md → Visibility says how to decide.
 *
 * Structurally assignable to `lib/media/manage.ts`'s `Viewer`, on purpose:
 * `mayAccess(row, viewer)` is the model for media rows.
 *
 * The content tools pass `role: null`, deliberately — content only an
 * Operator may see should never flow into a chat transcript by default; a
 * source that wants role-aware visibility decides that inside the source.
 */
export interface ContentViewer {
  memberId: string | null;
  role: string | null;
}

export type ContentHitKind = "page" | "section" | "media";

export interface ContentHit {
  /** Which registered source answered. */
  sourceId: string;
  /** The source's stable handle — feed it back to `get()`. */
  ref: string;
  kind: ContentHitKind;
  title: string;
  snippet: string;
  /**
   * App-RELATIVE path of the page that renders this content
   * ("/dashboard/course/…"), or null when no page serves it (the handbook).
   *
   * NEVER a signed media URL: those expire and bypass `mayAccess()` — a hit's
   * url is the PAGE containing a medium, not the medium's bytes. Sources
   * return relative paths only; absolutizing (APP_URL) is the delivery
   * layer's job, and the registry test refuses anything else.
   */
  url: string | null;
  /** Fragment id (without `#`) the page renders on the matching block, or null. */
  anchor: string | null;
  /** For kind "media": what the medium IS — never where its bytes are. */
  media?: { path: string; kind: string; alt: string | null };
}

export interface ContentTocEntry {
  sourceId: string;
  ref: string;
  title: string;
  summary: string | null;
  url: string | null;
}

export interface ContentDocument {
  sourceId: string;
  ref: string;
  title: string;
  url: string | null;
  /** Markdown or plain text — read by a model, never rendered by the app. */
  body: string;
  /** The body's addressable headings, for follow-up deep links. */
  sections: { anchor: string; title: string }[];
  /** The media this document embeds — path and page anchor, never bytes. */
  media: { path: string; kind: string; alt: string | null; anchor: string | null }[];
}

export interface ContentSource {
  /** `[a-z0-9-]{1,40}`, unique across the registry — the companion-id grammar. */
  id: string;
  /** Model-facing one-liner: what lives in this source ("the app's handbook"). */
  label: string;
  search(query: string, viewer: ContentViewer, limit: number): Promise<ContentHit[]>;
  /**
   * One document by ref. `null` is deliberately BOTH "no such ref" and "not
   * visible to this viewer" — the same contract as a companion's `load()`:
   * an existence oracle for another member's content is a leak, so the two
   * answers are indistinguishable by design.
   */
  get(ref: string, viewer: ContentViewer): Promise<ContentDocument | null>;
  /** Optional table of contents — what exists, before searching. */
  list?(viewer: ContentViewer): Promise<ContentTocEntry[]>;
  /**
   * Optional media lookup. Hits are kind "media"; `url` is the page that
   * SHOWS the medium (plus anchor), never a file link.
   */
  findMedia?(query: string, viewer: ContentViewer, limit: number): Promise<ContentHit[]>;
}
