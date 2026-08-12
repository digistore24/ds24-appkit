// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What counts as a Knowledge Media reference — the grammar, exactly once (AD-56).
//
// ── Why one module ──────────────────────────────────────────────────────────
// Three readers judge the same strings: the media route (which resolves a path
// to bytes), the chat markdown parser (which turns a marker into a card) and
// the check scripts (`kb-check`, `kb-media-sync`). Two implementations of
// "is this a valid reference" is how a marker passes the check and 404s in the
// chat — the exact two-arithmetics failure the `.mjs` stem convention exists
// for, one level up. So the path grammar, the marker grammar and the media
// allow-map live here once, and nothing re-implements any of them. In
// particular, `config/media.json`'s MIME lists are NEVER consulted for
// knowledge media — the allow-map below is the only authority, and that
// non-reuse is the decision (AD-56 rule 3).
//
// ── Why .mjs ────────────────────────────────────────────────────────────────
// The app's TypeScript and the bare-Node check scripts both have to agree on
// this grammar, and the scripts in this repo deliberately do not import the
// app's TypeScript (CLAUDE.md → Three systems). So the rules live once, in the
// one language both can read, and the TypeScript side puts types back on at
// the boundary. It carries its own stem in its own directory because a `.mjs`
// may never share a stem with a `.ts` — and `lib/ai/` already holds a
// `rules.ts`, which is precisely why this module does not live there.
//
// Keep it dependency-free and keep it pure: no `node:fs`, no `process.env`,
// no fetch. It is imported by a Next.js server bundle and by a bare
// `node scripts/…` on Windows alike, and it only ever answers questions about
// strings.

/**
 * One path segment: lowercase, `a–z 0–9 -`, hyphens only between runs.
 *
 * This is FR-169's naming standard, and it is strict on purpose: no spaces,
 * umlauts, dots or other characters that can break URLs, file systems, object
 * keys or deploys across the three supported OSes. Exported as a regex SOURCE
 * (not a RegExp) so larger patterns can compose from it.
 */
export const MEDIA_SEGMENT_PATTERN = "[a-z0-9]+(?:-[a-z0-9]+)*";

const SEGMENT_RE = new RegExp(`^${MEDIA_SEGMENT_PATTERN}$`);

/**
 * Extension → what the file is and how it is served.
 *
 * The ONLY authority on which extensions a Knowledge Media reference may
 * carry. The route answers `content-type` from `contentType`; the renderer
 * picks its element from `kind`; `kb-media-sync` uploads with `contentType`.
 * An extension not in this map makes the whole path invalid — there is no
 * "unknown but tolerated" state, because a tolerated unknown is a file the
 * route cannot honestly describe to a browser.
 */
export const KNOWLEDGE_MEDIA_TYPES = {
  mp4: { contentType: "video/mp4", kind: "video" },
  webm: { contentType: "video/webm", kind: "video" },
  mp3: { contentType: "audio/mpeg", kind: "audio" },
  ogg: { contentType: "audio/ogg", kind: "audio" },
  wav: { contentType: "audio/wav", kind: "audio" },
  jpg: { contentType: "image/jpeg", kind: "image" },
  jpeg: { contentType: "image/jpeg", kind: "image" },
  png: { contentType: "image/png", kind: "image" },
  webp: { contentType: "image/webp", kind: "image" },
  pdf: { contentType: "application/pdf", kind: "document" },
};

// Longest first, so `jpeg` can never half-match as `jpg` inside an
// alternation and leave a stray `eg` behind.
const EXTENSION_ALTERNATION = Object.keys(KNOWLEDGE_MEDIA_TYPES)
  .sort((a, b) => b.length - a.length)
  .join("|");

/**
 * A whole Knowledge Media path: `<topic-slug>/<file>.<ext>` — exactly two
 * segments, exactly one extension dot, extension from the allow-map.
 *
 * Exactly two, not "up to two": AD-56's "max depth 2" is a ceiling on nesting,
 * not an invitation to depth 1. AD-52's whole namespace is topic-sliced —
 * corpus folders, the `.data/` mirror, bucket keys — and a topicless
 * `file.mp4` would be the one object in the system with no topic coordinate.
 * So depth 1 is refused, beside depth 3 (decided during story prep,
 * 2026-08-03).
 *
 * Exported as a regex source so the marker pattern (and, in Story 18.3, the
 * markdown parser) can compose from it. `isValidMediaPath` is the same grammar
 * as a procedural answer; the vitest beside this file holds the two together.
 */
export const MEDIA_PATH_PATTERN = `${MEDIA_SEGMENT_PATTERN}/${MEDIA_SEGMENT_PATTERN}\\.(?:${EXTENSION_ALTERNATION})`;

/**
 * Accept or refuse one whole path.
 *
 * This is the route's second guard (AD-53), so the refusal set is security
 * surface: `.` and `..` fail the segment pattern (a dot is only legal as the
 * single extension dot), empty segments (`a//b`, leading or trailing `/`) fail
 * it too, and a backslash is not a separator here — it is a refused character,
 * which is why this splits on `/` only. URL-decoding is the route's problem;
 * this function judges the decoded string it is given.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isValidMediaPath(path) {
  if (typeof path !== "string" || path === "") return false;

  const segments = path.split("/");
  if (segments.length !== 2) return false;

  const [topic, file] = segments;
  if (!SEGMENT_RE.test(topic)) return false;

  // Exactly one extension dot, in this final segment only.
  const parts = file.split(".");
  if (parts.length !== 2) return false;

  const [stem, extension] = parts;
  if (!SEGMENT_RE.test(stem)) return false;
  return Object.hasOwn(KNOWLEDGE_MEDIA_TYPES, extension);
}

/**
 * A marker's label.
 *
 * A label edge may not be whitespace — that is the "no padding around |" rule,
 * applied symmetrically at the closing bracket. The middle may carry spaces
 * but never `|`, `]` or a line break: `|` and `]` are the marker's own
 * delimiters, and a marker that spans lines is prose, not a reference.
 *
 * Exported because a SECOND marker composes from it —
 * `lib/content-source/link-marker.ts`'s `[link:<path>|<label>]`. Both markers
 * having one label grammar is what stops them drifting apart about trailing
 * spaces; a second copy would be the two-arithmetics failure this module
 * exists to prevent, in miniature.
 */
export const MEDIA_LABEL_PATTERN = "[^|\\]\\s](?:[^|\\]\\n\\r]*[^|\\]\\s])?";

/**
 * The whole marker: `[media:<path>|<label>]`.
 *
 * Exported as a regex SOURCE, not a RegExp: `lib/ai/markdown.ts` composes its
 * inline alternative from this exact string in Story 18.3, which is what makes
 * "the parser and the extractor accept the same strings" true by construction
 * rather than by convention. Capture group 1 is the path, group 2 the label.
 *
 * The path part is the full path grammar including the allow-map extensions —
 * so a marker around an invalid path is not a marker at all, and `markersIn`
 * needs no second validation pass that could disagree with the pattern.
 */
export const MEDIA_MARKER_PATTERN = `\\[media:(${MEDIA_PATH_PATTERN})\\|(${MEDIA_LABEL_PATTERN})\\]`;

/**
 * A fenced code block — three or more backticks or tildes on their own line,
 * up to the matching closing run. An UNCLOSED fence is deliberately not
 * matched: without a closing run there is no way to tell where the code was
 * meant to stop, and guessing "to the end of the document" would silently
 * swallow every real marker after a stray backtick.
 */
const FENCED_CODE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm;

/** An inline code span: `` `…` ``, never spanning a line. */
const INLINE_CODE = /`[^`\n]+`/g;

/**
 * Every well-formed marker in a text, as whole marker strings, in order —
 * **outside code**.
 *
 * Whole strings on purpose: AD-54 whitelists COMPLETE marker strings — the
 * allowed-set is `markersIn()` over the handbook, and the parser asks "is this
 * exact string in that set". Malformed markers are simply not matched, so they
 * are skipped rather than reported: to the chat they are ordinary text.
 *
 * ── Why code is stripped first ──────────────────────────────────────────────
 * `lib/ai/markdown.ts` composes its inline alternative from
 * `MEDIA_MARKER_PATTERN` and puts it AFTER the code span on purpose, so
 * `` `[media:a/b.mp4|x]` `` renders as quoted code and never as a card. An
 * extractor that read the same string as a marker would disagree with the
 * parser about the one thing they exist to agree on — and the disagreement has
 * a cost: a handbook page EXPLAINING the marker syntax would feed its own
 * example into the whitelist, and `kb-check` would then demand a real file
 * behind a line of documentation. So both readings blank code out first, and
 * "extractor and parser read context identically" stays true by construction
 * rather than by care. `markdown.test.ts` pins the agreement, quoted case
 * included.
 *
 * Blanked to a newline, never to the empty string: removing
 * `` `y` `` from `[media:a/b.mp4|x`y`]` would GLUE the remainder into a marker
 * nobody wrote. A line break cannot occur inside the marker grammar, so it is
 * the one replacement that can never create one.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function markersIn(text) {
  if (typeof text !== "string" || text === "") return [];
  const prose = text.replace(FENCED_CODE, "\n").replace(INLINE_CODE, "\n");
  return Array.from(
    prose.matchAll(new RegExp(MEDIA_MARKER_PATTERN, "g")),
    (match) => match[0],
  );
}

/**
 * Where large Knowledge Media live in the app's object store: every bucket key
 * is `"knowledge/" + <path>`. Read by AD-53's signed-URL leg in the route
 * (Story 18.2) and by `kb-media-sync` when it uploads (Story 18.4). A constant
 * by decision, not config — the prefix is part of the grammar, and a
 * configurable prefix would be a second place two readers could disagree.
 */
export const KNOWLEDGE_MEDIA_BUCKET_PREFIX = "knowledge/";

/**
 * How long a signed media URL stays valid: six hours — longer than any lesson,
 * short enough that a leaked link dies the same day. Read by AD-53's
 * `store.signedUrl(…, { expiresSeconds })` in the route (Story 18.2). A named
 * constant by decision, not config (Epic 18 intro): the feature ships with no
 * new config file and no `process.env` read.
 */
export const KNOWLEDGE_MEDIA_TTL_SECONDS = 21600;

/**
 * Past this, a file does not belong in the app tree — it belongs in the
 * bucket. Read by AD-55's `kb-check` size flag (Story 18.4), which names the
 * file and says where it goes instead. The same constant-not-config decision
 * as the TTL above.
 */
export const KNOWLEDGE_MEDIA_SHIPPED_MAX_BYTES = 10 * 1024 * 1024;
