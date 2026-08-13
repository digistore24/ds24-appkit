import { describe, expect, it } from "vitest";

import { parse, parseInline } from "./markdown";

describe("parseInline", () => {
  it("leaves plain text alone", () => {
    expect(parseInline("Verantwortlich ist die Beispiel GmbH.")).toEqual([
      { kind: "text", text: "Verantwortlich ist die Beispiel GmbH." },
    ]);
  });

  it("reads bold and italic", () => {
    expect(parseInline("**Art. 15** und *Art. 20*")).toEqual([
      { kind: "strong", text: "Art. 15" },
      { kind: "text", text: " und " },
      { kind: "em", text: "Art. 20" },
    ]);
  });

  it("reads a link", () => {
    expect(parseInline("[Aufsichtsbehörde](https://ldi.nrw.de)")).toEqual([
      { kind: "link", text: "Aufsichtsbehörde", href: "https://ldi.nrw.de" },
    ]);
  });

  it("allows the schemes a legal page actually needs", () => {
    for (const href of [
      "https://example.de",
      "http://example.de",
      "mailto:datenschutz@example.de",
      "tel:+4930123456",
      "/datenschutz",
    ]) {
      const [part] = parseInline(`[x](${href})`);
      expect(part.kind, href).toBe("link");
    }
  });

  it("keeps the TEXT of an unsafe link and drops only the link", () => {
    // Dropping the whole thing would silently remove a sentence from a legal
    // document — and a missing paragraph in a privacy policy is not something
    // anybody notices by reading the page.
    for (const href of ["javascript:alert", "data:text/html,<script>", "vbscript:x"]) {
      expect(parseInline(`[Klick mich](${href})`), href).toEqual([
        { kind: "text", text: "Klick mich" },
      ]);
    }
  });

  it("stops an href at the first closing paren", () => {
    // A known and accepted limit of the grammar. It matters twice: a hostile
    // `javascript:alert(1)` is truncated to `javascript:alert(1` and refused
    // either way, and a legitimate URL containing parens (a Wikipedia article,
    // say) would lose its tail — so link such a thing by naked URL rather than
    // in brackets. Not worth a nested-paren parser for a page of legal prose.
    expect(parseInline("[x](javascript:alert(1))")).toEqual([
      { kind: "text", text: "x" },
      { kind: "text", text: ")" },
    ]);
  });

  it("is not fooled by leading whitespace or case in the scheme", () => {
    expect(parseInline("[x](JavaScript:alert(1))")[0].kind).toBe("text");
  });
});

describe("parse", () => {
  it("reads headings at three levels", () => {
    const blocks = parse("# Eins\n## Zwei\n### Drei");
    expect(blocks).toEqual([
      { kind: "heading", level: 1, text: "Eins" },
      { kind: "heading", level: 2, text: "Zwei" },
      { kind: "heading", level: 3, text: "Drei" },
    ]);
  });

  it("groups consecutive lines into one paragraph and splits on a blank line", () => {
    const blocks = parse("Erste Zeile\nzweite Zeile\n\nNeuer Absatz");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: "paragraph" });
    expect((blocks[0] as { lines: unknown[] }).lines).toHaveLength(2);
    expect(blocks[1]).toMatchObject({ kind: "paragraph" });
  });

  it("reads a bullet list", () => {
    const blocks = parse("- Auskunft\n- Löschung\n* Berichtigung");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "list" });
    expect((blocks[0] as { items: unknown[] }).items).toHaveLength(3);
  });

  it("closes a paragraph when a list starts, and the other way round", () => {
    const blocks = parse("Deine Rechte:\n- Auskunft\nDanach mehr Text.");
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "list", "paragraph"]);
  });

  it("closes a list when a heading follows", () => {
    const blocks = parse("- Auskunft\n## Weiter");
    expect(blocks.map((b) => b.kind)).toEqual(["list", "heading"]);
  });

  it("ignores blank lines at the ends and handles CRLF", () => {
    expect(parse("\r\n\r\n# Impressum\r\n\r\n")).toEqual([
      { kind: "heading", level: 1, text: "Impressum" },
    ]);
  });

  it("returns nothing for an empty document", () => {
    expect(parse("")).toEqual([]);
    expect(parse("   \n  \n")).toEqual([]);
  });

  it("does not treat #### as a heading", () => {
    // The grammar stops at three levels on purpose — a legal page that needs a
    // fourth is a legal page nobody will read.
    expect(parse("#### Tief")[0].kind).toBe("paragraph");
  });
});

describe("emphasis begins and ends on a non-space", () => {
  // 🚨 Measured 2026-08-13: `Preis: 5 * 3 * 2 Euro` rendered as
  // `Preis: 5 3 2 Euro` with a silently italic " 3 ". There is no escape in this
  // subset and no code span to hide in, so the characters simply disappeared.
  // Harmless while this parser served only the legal pages; since 2026-08-12 it
  // also renders LESSON BODIES, where arithmetic and footnote asterisks occur.
  it("leaves an arithmetic asterisk alone", () => {
    expect(parseInline("Preis: 5 * 3 * 2 Euro")).toEqual([
      { kind: "text", text: "Preis: 5 * 3 * 2 Euro" },
    ]);
  });

  it("leaves a footnote asterisk alone", () => {
    expect(parseInline("Fussnote* und *noch")).toEqual([
      { kind: "text", text: "Fussnote* und *noch" },
    ]);
  });

  it("leaves a lone asterisk alone", () => {
    expect(parseInline("5 * 3")).toEqual([{ kind: "text", text: "5 * 3" }]);
  });

  // The counter-tests. A rule that stopped emphasis working would pass every
  // case above and be a worse defect than the one it replaced.
  it("still emphasises what somebody meant to emphasise", () => {
    expect(parseInline("*x*")).toEqual([{ kind: "em", text: "x" }]);
    expect(parseInline("*mehrere Woerter*")).toEqual([
      { kind: "em", text: "mehrere Woerter" },
    ]);
    expect(parseInline("**fett**")).toEqual([{ kind: "strong", text: "fett" }]);
  });

  it("still handles both in one line, in the right order", () => {
    expect(parseInline("**fett** und *kursiv*")).toEqual([
      { kind: "strong", text: "fett" },
      { kind: "text", text: " und " },
      { kind: "em", text: "kursiv" },
    ]);
  });

  it("leaves an unpaired marker as the characters it is", () => {
    expect(parseInline("**unpaarig")).toEqual([{ kind: "text", text: "**unpaarig" }]);
  });
});

describe("every line ending, not two of the three", () => {
  // ⚠️ `\r?\n` covers a browser's CRLF and a Unix `\n` and misses a lone `\r` —
  // what a paste out of an old Mac tool still carries. The whole text then
  // collapses into one line, which is the bug this parser was brought into the
  // course module to fix, one ending earlier.
  it.each([
    ["unix", "a\nb"],
    ["windows", "a\r\nb"],
    ["old mac", "a\rb"],
  ])("splits %s line endings the same way", (_case, text) => {
    expect(parse(text)).toEqual([
      { kind: "paragraph", lines: [[{ kind: "text", text: "a" }], [{ kind: "text", text: "b" }]] },
    ]);
  });

  it("still sees a blank line as a paragraph break in all three", () => {
    for (const text of ["a\n\nb", "a\r\n\r\nb", "a\r\rb"]) {
      expect(parse(text), text).toHaveLength(2);
    }
  });
});
