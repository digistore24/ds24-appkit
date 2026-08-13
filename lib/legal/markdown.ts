// Markdown for the legal pages.
//
// ── Why this is not `lib/ai/markdown.ts` ───────────────────────────────────
// It looks like the same job and it is not, and the difference is who wrote the
// text.
//
// That parser renders what a LANGUAGE MODEL produced, on every streamed chunk.
// It deliberately supports **no links at all** — a model writing about a
// question a customer typed is an untrusted author, and a clickable link it
// produced is a phishing vector with the operator's domain around it. It also
// flattens headings to bold, because a support answer has no document outline.
//
// This one renders what the OPERATOR wrote, once per page load, and a legal
// document is exactly the thing that needs a real outline and real links: a
// privacy policy names the supervisory authority, an Impressum names the
// register, and both are read as a structured document rather than as prose.
//
// So: two parsers, two grammars, two trust levels. Merging them would mean
// either putting links into the chat or taking them out of the law.
//
// ── The security story is the same, and it is structural ──────────────────
// This returns DATA, never HTML. There is no `dangerouslySetInnerHTML`
// anywhere downstream and therefore no sanitiser to keep current
// (`app/(legal)/[slug]/render.tsx`). A link's href is the one thing that could
// still carry something, so it is checked here rather than at the call site.

/** A piece of a line. */
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "link"; text: string; href: string };

/** A block of the document. */
export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; lines: Inline[][] }
  | { kind: "list"; items: Inline[][] };

/**
 * Schemes a link may use.
 *
 * `javascript:` and `data:` are the two that turn a document into code. An
 * operator is a trusted author, but these files are edited by an agent acting
 * on their behalf and pasted from generators — "trusted" is about intent, not
 * about every character that ends up in the file.
 */
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/)/i;

/**
 * `[text](href)`, `**strong**`, `*em*` — in that order of precedence.
 *
 * 🚨 **An emphasis run begins and ends on a NON-SPACE, and that is not
 * pedantry.** Without it `* … *` matches across ordinary prose and takes the
 * asterisks with it: measured 2026-08-13, `Preis: 5 * 3 * 2 Euro` rendered as
 * `Preis: 5 3 2 Euro` with a silently italic " 3 ". There is no escape in this
 * subset and no code span to hide in, so the characters simply disappear.
 *
 * It mattered little while this parser served only the legal pages, where a
 * stray asterisk is rare. Since 2026-08-12 it also renders LESSON BODIES — the
 * freest prose surface in the app, and the one where arithmetic and footnote
 * asterisks actually occur.
 *
 * ⚠️ The rule is CommonMark's left/right-flanking, in its short form, and it is
 * the one `lib/ai/markdown.ts` already spells out as `EMPHASIS_EDGE`. Not
 * imported from there: that file guards its own `[media:…]` markers inside the
 * same expression and this one has none, so a shared constant would carry a
 * rule about a syntax the legal subset does not have.
 */
const INLINE =
  /\[([^\]]+)\]\(([^)\s]+)\)|\*\*(?=\S)([^*]+?)(?<=\S)\*\*|\*(?=\S)([^*]+?)(?<=\S)\*/g;

export function parseInline(line: string): Inline[] {
  const parts: Inline[] = [];
  let plain = 0;

  for (const match of line.matchAll(INLINE)) {
    const at = match.index;
    if (at > plain) parts.push({ kind: "text", text: line.slice(plain, at) });

    const [, linkText, href, strong, em] = match;

    if (href !== undefined) {
      // An unsafe scheme keeps its TEXT and loses its link. Dropping the whole
      // thing would silently delete a sentence from a legal document, which is
      // the worse failure — a missing paragraph in a privacy policy is not
      // something anybody notices by reading the page.
      parts.push(
        SAFE_HREF.test(href)
          ? { kind: "link", text: linkText, href }
          : { kind: "text", text: linkText },
      );
    } else if (strong !== undefined) {
      parts.push({ kind: "strong", text: strong });
    } else {
      parts.push({ kind: "em", text: em });
    }

    plain = at + match[0].length;
  }

  if (plain < line.length) parts.push({ kind: "text", text: line.slice(plain) });
  return parts;
}

/**
 * A legal document as blocks.
 *
 * Deliberately small: headings, paragraphs, bullet lists. No tables, no images,
 * no code fences, no block quotes. Anything a privacy policy genuinely needs is
 * here, and every construct that is not here is one more thing that can render
 * wrongly on the page nobody proof-reads.
 */
export function parse(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: Inline[][] = [];
  let list: Inline[][] | null = null;

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", lines: paragraph });
      paragraph = [];
    }
    if (list) {
      blocks.push({ kind: "list", items: list });
      list = null;
    }
  };

  // ⚠️ All three endings, not two. `\r?\n` covers a browser's CRLF and a Unix
  // `\n`, and misses a lone `\r` — which is what a paste out of an old Mac
  // tool, or a file converted by one, still carries. The whole text then
  // collapses into one line, which is exactly the bug this parser was brought
  // in to fix one ending earlier.
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();

    if (line === "") {
      flush();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        // Plain text: a link inside a heading is a navigation surprise, and
        // bold inside one is invisible against a heading's own weight.
        text: heading[2],
      });
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (paragraph.length > 0) {
        blocks.push({ kind: "paragraph", lines: paragraph });
        paragraph = [];
      }
      list ??= [];
      list.push(parseInline(bullet[1]));
      continue;
    }

    if (list) {
      blocks.push({ kind: "list", items: list });
      list = null;
    }
    paragraph.push(parseInline(line));
  }

  flush();
  return blocks;
}
