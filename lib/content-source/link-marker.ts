// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What counts as a link the assistant may put in front of a customer.
//
// ── What this is for ────────────────────────────────────────────────────────
// A `ContentHit` carries the app-relative page that shows it (`url`) plus the
// fragment on that page (`anchor`). This module turns that pair into ONE
// string — `[link:<path>|<label>]` — that the delivery layer hands to the
// model inside a tool result, the model copies verbatim into its sentence,
// and `components/answer-text.tsx` renders as an in-app anchor. So an answer
// can say "das Thema wird in Lektion 3 erklärt" with "Lektion 3" clickable.
//
// ── The two properties, and which mechanism provides which ──────────────────
// The requirement is that she cannot link to anything except a page of this
// app, and cannot link to content that does not exist. Those are two different
// questions and they have two different answers:
//
//  - **A foreign destination is unspeakable** — this file. The target grammar
//    below cannot express a scheme, a host, a query string or a traversal, so
//    there is no such thing as a well-formed marker pointing off-site.
//  - **An invented destination is untrue** — NOT this file. That is the
//    per-request whitelist (`lib/ai/content-links.ts` composes it, the
//    markdown parser enforces it): a marker only renders when its COMPLETE
//    string is one this layer composed from a hit a registered source really
//    returned for this viewer in this turn.
//
// ── Why there is no URL map ─────────────────────────────────────────────────
// The obvious design — a table of content type ⇒ "/dashboard/kurs/{id}" — was
// considered and rejected. It answers "how do I spell a path", never "does
// that content exist and may this person open it": `/dashboard/kurs/lektion-42`
// is perfectly well-formed for a lesson nobody wrote, so a map would make a
// hallucinated link LOOK right, which is worse than no feature. The
// `ContentSource` already owns its url, next to the visibility gate that
// decided whether the viewer sees the hit at all; a second place composing the
// same path is the two-arithmetics failure `lib/knowledge-media/rules.mjs` was
// written to prevent (AD-56).
//
// ── The rejected alternative that would quietly weaken this ─────────────────
// **The label is the SERVER's — the hit's title — and it must stay that way.**
// It is tempting to let the model write the link text ("klicke hier"): one
// word, reads naturally. It is also the whole control. The whitelist can be a
// WHOLE-STRING match only because every part of the marker is ours; the moment
// the label is the model's, the check degrades to "the destination is
// whitelisted, the pretext is free" — a misleading sentence over a real link,
// and every test in this repo would still be green. If somebody ever wants
// that, it is a decision to take deliberately, not a wording improvement.
import { MEDIA_LABEL_PATTERN, MEDIA_SEGMENT_PATTERN } from "@/lib/knowledge-media/rules.mjs";

/**
 * The ceiling on a target, in characters.
 *
 * Enforced INSIDE `LINK_TARGET_PATTERN` (see the lookahead there) rather than
 * beside it, so "the pattern and `isLinkableAppPath` agree" needs no caveat
 * about length.
 *
 * It bounds the TARGET and nothing else — `MAX_LINK_LABEL_CHARS` is what
 * bounds the other half, and between them they bound the NDJSON line.
 */
export const MAX_LINK_TARGET_CHARS = 200;

/**
 * The ceiling on a label, in characters.
 *
 * The label is a hit's title, and a title comes from a source the CUSTOMER
 * registered — in an app whose content is member-authored it is a string
 * somebody typed. Without a bound here the target's 200 characters bounded
 * nothing that matters: a 50 000-character title composed a 50 012-character
 * marker that went into the tool result, onto the wire as one NDJSON line, and
 * into `chat_messages.links` for ever. It is also the point where the feature
 * silently stops working, because the model has to copy the whole thing back
 * character for character.
 *
 * A refusal rather than a truncation, for the same reason `contentLinkMarker`
 * refuses everything else: a truncated title is a label that misdescribes what
 * it points at, and `null` already means "name it in prose instead".
 */
export const MAX_LINK_LABEL_CHARS = 120;

/**
 * Characters a label may not contain, beyond what the grammar already refuses.
 *
 * C0/C1 controls, the zero-width family, the bidi overrides and the line/para
 * separators. `trim()` does not remove them and JS `\s` does not match them,
 * so `MEDIA_LABEL_PATTERN` accepts them all: a title of `"​"` composed a
 * well-formed marker that rendered as a link with no visible text and no
 * accessible name, and a `"Lektion ‮3"` rendered link text reading
 * differently from the string that was stored and matched. Neither is a
 * scripting hole — React escapes, and the target grammar is unchanged — but an
 * invisible or misdescribed link is exactly the pretext this module refuses to
 * let a model have, and here a member-authored title could hand it over.
 *
 * The same argument the community renderer makes about bidi in a URL
 * (`components/community/post-body.tsx`), applied to a link's text.
 */
const LABEL_FORBIDDEN_RE =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u2064\u206A-\u206F\uFEFF]/u;

/**
 * One path segment.
 *
 * Deliberately NOT `MEDIA_SEGMENT_PATTERN`: a route segment is a slug the app
 * chose, and Next.js route folders are routinely mixed-case or
 * underscore-joined. What matters is the refusal set, and this charset refuses
 * everything that carries a link out of the app or off the page:
 *
 *  - no `.` at all — `..` traversal becomes unrepresentable, and no route in
 *    this app needs a dot. An umlaut in a slug is `slugifyAnchor()`'s job.
 *  - no `?`, `&`, `%`, `\`, whitespace, quotes or angle brackets — refused by
 *    construction rather than by a blacklist somebody has to keep current. A
 *    query parameter is an INSTRUCTION to a page (this app already routes
 *    flash messages by id that way); a deep link is a path plus a fragment.
 *  - no `:` — so `javascript:` and `data:` cannot begin one.
 */
const PATH_SEGMENT = "[A-Za-z0-9_-]+";

/**
 * A whole target: an app-relative path, optionally with one fragment.
 *
 * 🚨 **The single most important character in this file is the second one.**
 * The path starts with exactly one `/` and the next character is a segment
 * character, never another slash — `//evil.com/x` is a PROTOCOL-RELATIVE URL:
 * perfectly valid in an `href`, and it leaves the site. `startsWith("/")` says
 * yes to it, which is why the registry test no longer asks that question.
 *
 * The fragment is `MEDIA_SEGMENT_PATTERN` — the project's one slug grammar,
 * the same one `slugifyAnchor()` emits — so both ends of a deep link agree by
 * construction rather than by care (see `anchors.ts`).
 *
 * The leading lookahead is the length bound: "there are not
 * MAX_LINK_TARGET_CHARS + 1 characters ahead that could all be part of a
 * target". `|` and `]` end a target in the marker grammar and cannot occur
 * inside one, so the same assertion is exact both inside a marker and against
 * a bare, anchored target — which is what lets `isLinkableAppPath` compose
 * from this string instead of re-deciding anything.
 *
 * Exported as a regex SOURCE, never a RegExp: `CONTENT_LINK_PATTERN` and
 * `lib/ai/markdown.ts` both compose from it.
 */
export const LINK_TARGET_PATTERN =
  `(?![^|\\]]{${MAX_LINK_TARGET_CHARS + 1}})` +
  `/${PATH_SEGMENT}(?:/${PATH_SEGMENT})*(?:#${MEDIA_SEGMENT_PATTERN})?`;

/**
 * The whole marker: `[link:<target>|<label>]`.
 *
 * Capture group 1 is the target, group 2 the label — the same shape and the
 * same contract as `MEDIA_MARKER_PATTERN`. Exported as a SOURCE so
 * `lib/ai/markdown.ts` composes its inline alternative from this exact string,
 * which is what makes "the parser and this composer accept the same strings"
 * true by construction (AD-56's rule, applied to a second marker).
 */
export const CONTENT_LINK_PATTERN = `\\[link:(${LINK_TARGET_PATTERN})\\|(${MEDIA_LABEL_PATTERN})\\]`;

const TARGET_RE = new RegExp(`^${LINK_TARGET_PATTERN}$`);
const LABEL_RE = new RegExp(`^${MEDIA_LABEL_PATTERN}$`);
const MARKER_RE = new RegExp(`^${CONTENT_LINK_PATTERN}$`);

/**
 * May this string be an `href` in an answer?
 *
 * The same grammar as the marker's target sub-pattern, anchored — not a second
 * opinion about it. `link-marker.test.ts` walks a corpus of good and bad
 * targets and asserts this function and `CONTENT_LINK_PATTERN` never disagree.
 *
 * Also the registry's check on `ContentHit.url` (`sources.test.ts`), which is
 * where it earns its keep: a source returning `"//evil.com/x"` used to pass
 * `startsWith("/")`.
 */
export function isLinkableAppPath(target: string): boolean {
  if (typeof target !== "string" || target === "") return false;
  return TARGET_RE.test(target);
}

/**
 * The complete marker for a hit's page, or `null`.
 *
 * `null` is always "no link" and never "a link that might work": a hit with no
 * page (`url: null` — every handbook hit), a target the grammar refuses, or a
 * label that cannot be expressed (a lesson titled `Knoten | Basics`) simply
 * gets no marker, and the answer names it in prose instead. There is no
 * partial or best-effort return.
 *
 * The url handed in MUST be the app-relative one, BEFORE the delivery layer
 * absolutizes it with `APP_URL` — an absolute marker would put a deployment
 * domain into an `href` and into the stored transcript for ever.
 */
export function contentLinkMarker(
  url: string | null,
  anchor: string | null,
  label: string,
): string | null {
  if (typeof url !== "string" || url === "") return null;

  const fragment = typeof anchor === "string" ? anchor.trim() : "";
  const target = fragment === "" ? url : `${url}#${fragment}`;
  if (!isLinkableAppPath(target)) return null;

  // Trimmed first: a source's title routinely carries stray whitespace, and
  // the label grammar refuses whitespace at either edge. Trimming is the
  // developer-friendly reading of "no padding around the delimiter"; anything
  // the trim cannot fix is a real refusal.
  const text = typeof label === "string" ? label.trim() : "";
  if (!LABEL_RE.test(text)) return null;
  if (text.length > MAX_LINK_LABEL_CHARS) return null;
  if (LABEL_FORBIDDEN_RE.test(text)) return null;

  return `[link:${target}|${text}]`;
}

/**
 * The inverse — the target and label of a well-formed marker, or `null`.
 *
 * For the renderer and for the round-trip test. It says nothing about whether
 * the marker is ALLOWED: that is the per-request whitelist's question, asked
 * in `lib/ai/markdown.ts` with a whole-string set membership.
 */
export function parseContentLinkMarker(
  marker: string,
): { target: string; label: string } | null {
  const match = typeof marker === "string" ? MARKER_RE.exec(marker) : null;
  return match ? { target: match[1], label: match[2] } : null;
}
