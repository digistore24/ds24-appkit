// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The little bit of Markdown a language model actually writes — and nothing else.
//
// ── Why this exists ────────────────────────────────────────────────────────
// Models write Markdown whether or not you ask them to. Told to answer with a
// numbered list, they answer with a numbered list *in Markdown*, and a chat
// window that renders plain text shows the customer `*Übersicht*`, asterisks
// and all. Telling her not to would work until the next model, so the window
// reads what she writes instead.
//
// ── Why not a Markdown library ─────────────────────────────────────────────
// This parses the five things that turn up in a support answer — bold, italic,
// inline code, bullet lists, numbered lists — and treats everything else as
// text. A full CommonMark parser would also give her links, images, raw HTML
// and tables: a much larger surface, rendered from text a customer can steer
// with their question, for formatting a two-sentence answer never uses. What
// this file cannot express, it shows literally, which is the safe direction.
//
// The output is DATA, not HTML. `components/answer-text.tsx` turns it into
// React elements, so there is no `dangerouslySetInnerHTML` anywhere in the
// chat and no sanitiser to keep up to date. Being pure is also why the parser
// lives in `lib/` — it is unit-tested, where the component could not be
// (vitest runs with `environment: "node"` and this repo has no DOM).
//
// ── The two exceptions to "no links", and what they have in common ─────────
// `[media:<path>|<label>]` is the chat's first model-steerable link surface,
// and the control on it is mechanical, not a prompt wish (AD-54): a marker is
// accepted only when the COMPLETE marker string occurs verbatim in the
// allowed-set the caller passes — and that set is derived from the loaded
// handbook (`markersIn()` over the docs' bodies). So the label is always the
// developer's, the path can only ever be one the handbook already points at,
// and a model-invented `[media:invented/file.mp4|Klick hier]` degrades to
// harmless plain text. An absent or empty set denies ALL markers — a mount
// that forgot to pass one fails safe.
//
// `[link:<path>|<label>]` is the second, and it is the SAME control with a
// different set. Its markers are composed on the server from content hits a
// registered source really returned for this viewer (`contentLinkMarker()` in
// lib/content-source/link-marker.ts), handed to the model inside a tool
// result, and whitelisted PER REQUEST rather than per handbook. Everything
// else is identical, deliberately: whole-string membership, absent-or-empty
// denies, a label that is never the model's, a refused marker degrading to
// visible bracket text. The one thing worth remembering about the difference
// is which set is static — `allowedMedia` is resolved once at mount,
// `allowedLinks` can only ever come with the answer it belongs to.
import { MEDIA_MARKER_PATTERN } from "@/lib/knowledge-media/rules.mjs";
import { CONTENT_LINK_PATTERN } from "@/lib/content-source/link-marker";

/** A run of text inside one line. */
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "code"; text: string }
  /**
   * A whitelisted Media Marker. `path` is the grammar-valid media path (the
   * renderer's target is `/api/knowledge-media/<path>`), `label` is the
   * developer-authored label — rendered as ONE text node, never inline-parsed:
   * parsing it would re-open the nesting surface this subset deliberately
   * lacks.
   */
  | { kind: "media"; path: string; label: string }
  /**
   * A whitelisted Content Link. `target` is a grammar-valid app-relative path
   * (`isLinkableAppPath`), rendered as an in-app anchor INSIDE the sentence —
   * not a card: "das Thema wird in Lektion 3 erklärt" only reads as a
   * sentence if the link is part of it. `label` is the hit's title, one text
   * node, never inline-parsed, for the same reason the media label is not.
   */
  | { kind: "link"; target: string; label: string };

/** What `parseAnswer` needs beyond the text. */
export interface ParseOptions {
  /**
   * The complete marker strings the handbook carries — `markersIn()` over the
   * loaded docs' bodies (`allowedMediaMarkers()` in `lib/ai/knowledge.ts`).
   * Membership is whole-string and verbatim; absent or empty denies all
   * markers (AD-54).
   */
  allowedMedia?: ReadonlySet<string>;
  /**
   * The complete `[link:…]` marker strings THIS answer may carry — every one
   * composed by the delivery layer from a hit a source returned during this
   * request (`lib/ai/content-links.ts`), or restored from the turn it was
   * stored with. Same membership rule as above, and the same fail-safe:
   * absent or empty denies every link.
   */
  allowedLinks?: ReadonlySet<string>;
}

/** A paragraph keeps its soft line breaks; `lines` is one entry per line. */
export type Block =
  | { kind: "paragraph"; lines: Inline[][] }
  | { kind: "list"; ordered: boolean; start: number; items: Inline[][] };

/**
 * One character inside `**…**` or `*…*` — anything but the start of a marker.
 *
 * Without the lookahead, `**Siehe [link:/dashboard/kurs/x|Lektion 3] dazu.**`
 * matched as ONE `strong` run whose text was the whole marker: the customer
 * read the bracket text spelled out while a properly whitelisted link silently
 * did not render. Emphasis begins earlier in the line than the marker does, so
 * it claimed the span first — and because alternation is resolved POSITION
 * first, no amount of reordering the alternatives below can change that (the
 * `INLINE` note says why at length).
 *
 * The persona is what makes this the likely shape rather than a curiosity: the
 * link rule asks her to put the marker INSIDE the sentence, where the media
 * rule asks for a line of its own — and models emphasise sentences.
 *
 * With the guard, emphasis simply cannot span a marker, so the marker is
 * matched on its own and the `**` around it stays a literal pair of asterisks.
 * That is the deliberate trade: a working link inside visible asterisks beats
 * bold text with a dead marker in it. `**siehe [1]**` and every other bracket
 * that is not a marker are untouched, because the lookahead names the two
 * marker prefixes rather than the `[`.
 */
const NOT_A_MARKER = "(?!\\[media:|\\[link:)";
const EMPHASIS_INNER = `(?:${NOT_A_MARKER}[^*\\n])`;
/**
 * The same guard on the two EDGE characters of an emphasis run.
 *
 * It has to be said twice, and forgetting the edges is the subtle half: the
 * flanking rule spells the run as `\S` … `\S`, so in `**[link:/a|L]**` the
 * leading `\S` swallowed the `[` before any lookahead on the middle could see
 * it, and the marker was inside a `strong` again. Guarding only the middle
 * fixes the marker in a sentence and leaves the tightly-wrapped one broken.
 */
const EMPHASIS_EDGE = `(?:${NOT_A_MARKER}\\S)`;

/**
 * The inline markers, tried in this order.
 *
 * Two deliberate omissions, both of which eat text somebody meant literally:
 *
 *  - **`_` is not a delimiter.** `ai_usage_rows` would lose its middle, and
 *    an answer naming a column, a file or an env var is exactly the answer
 *    where that happens.
 *  - **A marker must hug its text.** `*` followed by a space is arithmetic
 *    ("2 * 3 * 4"), not emphasis — hence `\S` on both ends. This is the same
 *    rule CommonMark calls flanking, written the short way.
 *
 * Nothing spans a line: the parser feeds one line at a time, so an unclosed
 * `**` stays literal instead of swallowing the rest of the answer. That is
 * also what makes the half-streamed state readable — mid-stream the closing
 * stars have not arrived yet. The Media Marker inherits the same property for
 * free: its pattern requires the closing `]`, so a half-streamed marker is
 * literal text until the bracket arrives — no buffering, no "pending" state.
 *
 * Both marker alternatives are COMPOSED from their grammar module's export,
 * never re-written — that is what makes "the parser and the composer accept
 * the same strings" true by construction (AD-56), and the agreement tests in
 * `markdown.test.ts` pin both. They sit AFTER the code span on purpose:
 * `` `[media:a/b.mp4|x]` `` is somebody quoting a marker, and the leading
 * backtick must keep winning. Built once at module level — this runs on every
 * streamed chunk.
 *
 * ⚠️ Capture groups are POSITIONAL: `parseInline` destructures
 * `[whole, code, strong, em, mediaPath, mediaLabel, linkTarget, linkLabel]`.
 * The two marker alternatives are LAST and in this order, so the media groups
 * stay at 4 and 5 (see `MEDIA_MARKER_PATTERN`) and the link groups take 6 and
 * 7 (see `CONTENT_LINK_PATTERN`) without shifting anything before them.
 * **A new alternative goes after both, or the destructure moves** — putting
 * one earlier silently reassigns `mediaPath`/`mediaLabel`, breaks the media
 * card, and typechecks perfectly.
 *
 * 🚨 **Reordering these alternatives is NOT how a marker beats emphasis** —
 * that is `EMPHASIS_INNER`'s job, and the difference is worth knowing before
 * somebody tries the other one. Alternation is resolved POSITION-first: the
 * engine walks left to right and only at one index does the alternative order
 * break a tie. A marker starts on `[` and emphasis on `*`, so the two can
 * never begin at the same index and their relative order decides nothing.
 * Moving the markers up therefore looks like a fix, changes no behaviour, and
 * shifts every capture group on the way past.
 */
const INLINE = new RegExp(
  [
    "`([^`\\n]+)`",
    `\\*\\*(${EMPHASIS_EDGE}|${EMPHASIS_EDGE}${EMPHASIS_INNER}*${EMPHASIS_EDGE})\\*\\*`,
    `\\*(${EMPHASIS_EDGE}|${EMPHASIS_EDGE}${EMPHASIS_INNER}*${EMPHASIS_EDGE})\\*`,
    MEDIA_MARKER_PATTERN,
    CONTENT_LINK_PATTERN,
  ].join("|"),
  "g",
);

const BULLET = /^ {0,3}[-*•] +(.*)$/;
const ORDERED = /^ {0,3}(\d{1,3})[.)] +(.*)$/;
const HEADING = /^ {0,3}#{1,6} +(.*)$/;

/**
 * One line of text, split into its marked-up runs. Exported for the tests.
 *
 * Takes the whole `ParseOptions` rather than a bare allow-set: there are two
 * sets now, and a second positional argument is how a caller ends up passing
 * the link set where the media set belongs — silently, since both are
 * `ReadonlySet<string>`.
 */
export function parseInline(line: string, options?: ParseOptions): Inline[] {
  const allowedMedia = options?.allowedMedia;
  const allowedLinks = options?.allowedLinks;
  const parts: Inline[] = [];
  let plain = 0;

  const flush = (upTo: number) => {
    if (upTo > plain) parts.push({ kind: "text", text: line.slice(plain, upTo) });
  };

  INLINE.lastIndex = 0;
  for (let match = INLINE.exec(line); match; match = INLINE.exec(line)) {
    const [whole, code, strong, em, mediaPath, mediaLabel, linkTarget, linkLabel] = match;
    if (mediaPath !== undefined) {
      // The whitelist is whole-string and verbatim: `whole` IS the complete
      // marker as it appeared in the answer, and only its exact occurrence in
      // the handbook-derived set makes it a card. A refused marker is not
      // flushed and `plain` does not move — the whole bracket text stays part
      // of the surrounding plain-text run, unparsed inside too, which is the
      // safe direction (AC 6). `?.has` makes the absent set the same refusal
      // as the empty one.
      if (allowedMedia?.has(whole)) {
        flush(match.index);
        parts.push({ kind: "media", path: mediaPath, label: mediaLabel });
        plain = match.index + whole.length;
      }
      continue;
    }
    if (linkTarget !== undefined) {
      // Identical control, different set — see the file header. The set here
      // is this ANSWER's: every marker in it was composed on the server from a
      // hit a registered source returned for this viewer, so a marker the
      // model wrote itself cannot be in it and stays visible bracket text in
      // front of the customer. Absent and empty deny alike.
      if (allowedLinks?.has(whole)) {
        flush(match.index);
        parts.push({ kind: "link", target: linkTarget, label: linkLabel });
        plain = match.index + whole.length;
      }
      continue;
    }
    flush(match.index);
    if (code !== undefined) parts.push({ kind: "code", text: code });
    else if (strong !== undefined) parts.push({ kind: "strong", text: strong });
    else parts.push({ kind: "em", text: em });
    plain = match.index + whole.length;
  }
  flush(line.length);

  return parts;
}

/**
 * One answer, split into blocks.
 *
 * Line-based on purpose: a blank line ends whatever was open, a list marker
 * opens a list, everything else is a paragraph line. Block structure is decided
 * before inline markers are read, which is why `* Übersicht` is a bullet and
 * `*Übersicht*` is emphasis — the difference is the space, and it is the one
 * ambiguity in this subset.
 */
export function parseAnswer(text: string, options?: ParseOptions): Block[] {
  const blocks: Block[] = [];
  let paragraph: Inline[][] = [];
  let list: { ordered: boolean; start: number; items: Inline[][] } | null = null;

  const closeParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", lines: paragraph });
    paragraph = [];
  };
  const closeList = () => {
    if (list) blocks.push({ kind: "list", ...list });
    list = null;
  };

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");

    if (line.trim() === "") {
      closeParagraph();
      closeList();
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);

    if (bullet || ordered) {
      closeParagraph();
      const wantsOrdered = Boolean(ordered);
      // A bullet list and a numbered list are two blocks even when they touch:
      // an <ul> whose items are numbered would number them twice.
      if (list && list.ordered !== wantsOrdered) closeList();
      const item = parseInline(bullet ? bullet[1] : ordered![2], options);
      if (!list) {
        list = {
          ordered: wantsOrdered,
          start: ordered ? Number(ordered[1]) : 1,
          items: [item],
        };
      } else {
        list.items.push(item);
      }
      continue;
    }

    closeList();
    const heading = HEADING.exec(line);
    // She is told to be brief, so a heading should not appear at all. If one
    // does, it becomes a bold line — the hashes must not reach the customer.
    paragraph.push(
      heading
        ? [{ kind: "strong", text: heading[1] }]
        : parseInline(line, options),
    );
  }

  closeParagraph();
  closeList();
  return blocks;
}
