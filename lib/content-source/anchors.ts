// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Stable anchors for content deep links — the one slug arithmetic both sides
// of a deep link share.
//
// A `ContentHit` may carry `url` plus `anchor`, and the page renders the same
// anchor as an `id` (with `scroll-mt-20`, the pattern `app/page.tsx` uses for
// `#inhalt` / `#preis`). Both sides MUST derive the anchor from the same
// string with the same function, or the link scrolls nowhere — that is the
// whole reason this file exists rather than each page slugifying by hand.
//
// The output grammar is deliberately the project's one slug grammar
// (`MEDIA_SEGMENT_PATTERN` in lib/knowledge-media/rules.mjs) — anchors, media
// paths and course slugs all read the same; `anchors.test.ts` pins the
// agreement against the imported pattern rather than a re-typed copy.

/**
 * A heading or slug, as a fragment id.
 *
 * Lowercase; German umlauts transliterated (ä→ae ö→oe ü→ue ß→ss) so
 * "Köder & Führung" and a hand-written `koeder-fuehrung` meet; every other
 * non-alphanumeric run becomes a single hyphen; edges trimmed. Returns "" for
 * input with no usable characters — the caller treats that as "no anchor",
 * never as an empty id.
 */
export function slugifyAnchor(text: string): string {
  if (typeof text !== "string") return "";
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The anchor for a medium on a page, from its path or slug.
 *
 * Prefixed `media-` so a video `koeder/knoten.mp4` and a heading "Koeder
 * Knoten MP4" can never collide on one page. Slashes and the extension dot
 * fold into the slug: `mediaAnchor("koeder/knoten.mp4")` →
 * `"media-koeder-knoten-mp4"`. Deterministic — the page wraps its player in
 * `<figure id={mediaAnchor(path)}>` and a source computes the identical
 * string without ever seeing the page.
 */
export function mediaAnchor(pathOrSlug: string): string {
  const slug = slugifyAnchor(pathOrSlug);
  return slug === "" ? "" : `media-${slug}`;
}

export interface HeadingAnchor {
  anchor: string;
  title: string;
}

export interface HeadingSection {
  anchor: string;
  title: string;
  /** 2–4 — the heading's `#` count. */
  level: number;
  /** The text from this heading (exclusive) to the next heading of the same
   *  or a higher level (exclusive). */
  body: string;
}

// Same shape as lib/knowledge-media/rules.mjs FENCED_CODE — an unclosed fence
// is deliberately not matched (guessing "to the end" would swallow real
// headings after a stray backtick line).
const FENCED_CODE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm;

// Levels 2–4 only: handbook bodies must not use `# ` (frontmatter.mjs rule —
// the title lives in the frontmatter), and below #### an outline stops being
// navigation.
const HEADING = /^ {0,3}(#{2,4}) +(.+?)\s*#*\s*$/;

/**
 * Every addressable section of a Markdown body, in document order — the
 * heading AND the text it governs, sliced in one pass so anchor names and
 * section boundaries cannot disagree.
 *
 * Heading detection runs on a copy with fenced code blanked (to newlines, so
 * line positions survive — a `## fake` inside a code fence is not a heading),
 * but the returned bodies are sliced from the ORIGINAL text, code included: a
 * section's content is its content. Duplicate anchors get `-2`, `-3`…
 * suffixes — two "Übung" sections stay two distinct targets. Headings that
 * slugify to nothing are skipped.
 */
export function headingSections(markdown: string): HeadingSection[] {
  if (typeof markdown !== "string" || markdown === "") return [];
  const prose = markdown.replace(FENCED_CODE, (block) =>
    block.replace(/[^\n]/g, ""),
  );

  const lines = markdown.split("\n");
  const proseLines = prose.split("\n");

  interface Found {
    anchor: string;
    title: string;
    level: number;
    line: number;
  }
  const seen = new Map<string, number>();
  const found: Found[] = [];
  for (let i = 0; i < proseLines.length; i += 1) {
    const match = HEADING.exec(proseLines[i]);
    if (!match) continue;
    const title = match[2].trim();
    const base = slugifyAnchor(title);
    if (base === "") continue;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    found.push({
      anchor: count === 1 ? base : `${base}-${count}`,
      title,
      level: match[1].length,
      line: i,
    });
  }

  return found.map((heading, index) => {
    let end = lines.length;
    for (let i = index + 1; i < found.length; i += 1) {
      if (found[i].level <= heading.level) {
        end = found[i].line;
        break;
      }
    }
    return {
      anchor: heading.anchor,
      title: heading.title,
      level: heading.level,
      body: lines.slice(heading.line + 1, end).join("\n").trim(),
    };
  });
}

/** The headings alone — what a `ContentDocument.sections` list carries. */
export function headingAnchors(markdown: string): HeadingAnchor[] {
  return headingSections(markdown).map(({ anchor, title }) => ({ anchor, title }));
}
