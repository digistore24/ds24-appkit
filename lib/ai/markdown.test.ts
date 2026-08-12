// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";

import { markersIn } from "@/lib/knowledge-media/rules.mjs";
import { contentLinkMarker } from "@/lib/content-source/link-marker";
import { parseAnswer, parseInline } from "./markdown";

/** The inline parts of a one-line answer — the common shape in these tests. */
function inlineOf(text: string) {
  const blocks = parseAnswer(text);
  expect(blocks).toHaveLength(1);
  const block = blocks[0];
  if (block.kind !== "paragraph") throw new Error(`expected a paragraph, got ${block.kind}`);
  expect(block.lines).toHaveLength(1);
  return block.lines[0];
}

describe("emphasis", () => {
  it("reads *one star* as emphasis", () => {
    expect(parseInline("*Übersicht*")).toEqual([{ kind: "em", text: "Übersicht" }]);
  });

  it("reads **two stars** as strong, not as emphasis around a star", () => {
    expect(parseInline("**Mein Konto**")).toEqual([{ kind: "strong", text: "Mein Konto" }]);
  });

  it("keeps the text around it", () => {
    expect(parseInline("Öffne *Mein Konto* im Menü")).toEqual([
      { kind: "text", text: "Öffne " },
      { kind: "em", text: "Mein Konto" },
      { kind: "text", text: " im Menü" },
    ]);
  });

  it("reads `backticks` as code", () => {
    expect(parseInline("Im Terminal: `node run.mjs start`")).toEqual([
      { kind: "text", text: "Im Terminal: " },
      { kind: "code", text: "node run.mjs start" },
    ]);
  });

  it("leaves a single character emphasised", () => {
    expect(parseInline("*a*")).toEqual([{ kind: "em", text: "a" }]);
  });
});

describe("what must NOT become emphasis", () => {
  // Every case here is a way a naive parser eats text somebody meant literally.
  // The answer is shown to a customer, so a swallowed word is worse than a
  // visible asterisk.

  it("leaves an underscore alone — snake_case is not italic", () => {
    // The reason `_` is not a delimiter at all in this parser. An answer
    // naming `ai_usage_rows` would otherwise lose the middle of the word.
    expect(parseInline("die Tabelle ai_usage_rows")).toEqual([
      { kind: "text", text: "die Tabelle ai_usage_rows" },
    ]);
  });

  it("leaves a star with a space behind it alone — 2 * 3 is arithmetic", () => {
    expect(parseInline("2 * 3 * 4")).toEqual([{ kind: "text", text: "2 * 3 * 4" }]);
  });

  it("leaves an unclosed marker literal — the half-streamed case", () => {
    // Mid-stream the closing stars have not arrived yet. Showing "**Mein"
    // for a moment is honest; swallowing it and popping it back is a flicker.
    expect(parseInline("Öffne **Mein")).toEqual([{ kind: "text", text: "Öffne **Mein" }]);
  });

  it("does not run emphasis across a line", () => {
    const block = parseAnswer("*eins\nzwei*")[0];
    if (block.kind !== "paragraph") throw new Error("expected a paragraph");
    expect(block.lines).toEqual([
      [{ kind: "text", text: "*eins" }],
      [{ kind: "text", text: "zwei*" }],
    ]);
  });
});

describe("blocks", () => {
  it("keeps a plain sentence as one paragraph", () => {
    expect(inlineOf("Guten Tag.")).toEqual([{ kind: "text", text: "Guten Tag." }]);
  });

  it("splits paragraphs on a blank line", () => {
    const blocks = parseAnswer("Eins.\n\nZwei.");
    expect(blocks).toHaveLength(2);
    expect(blocks.every((block) => block.kind === "paragraph")).toBe(true);
  });

  it("keeps a single newline as a line break inside one paragraph", () => {
    const block = parseAnswer("Eins.\nZwei.")[0];
    if (block.kind !== "paragraph") throw new Error("expected a paragraph");
    expect(block.lines).toHaveLength(2);
  });

  it("reads a dash list", () => {
    expect(parseAnswer("- Übersicht\n- Mein Konto")).toEqual([
      {
        kind: "list",
        ordered: false,
        start: 1,
        items: [
          [{ kind: "text", text: "Übersicht" }],
          [{ kind: "text", text: "Mein Konto" }],
        ],
      },
    ]);
  });

  it("reads a star list as a list, not as emphasis", () => {
    const block = parseAnswer("* Übersicht\n* Mein Konto")[0];
    expect(block.kind).toBe("list");
  });

  it("reads a numbered list and remembers where it starts", () => {
    const block = parseAnswer("3. Öffne Mein Konto\n4. Klicke auf Passwort")[0];
    if (block.kind !== "list") throw new Error("expected a list");
    expect(block.ordered).toBe(true);
    expect(block.start).toBe(3);
    expect(block.items).toHaveLength(2);
  });

  it("does not merge a numbered list into a bullet list", () => {
    const blocks = parseAnswer("- eins\n1. zwei");
    expect(blocks).toHaveLength(2);
  });

  it("ends a list at a blank line", () => {
    const blocks = parseAnswer("- eins\n\nDanach.");
    expect(blocks.map((block) => block.kind)).toEqual(["list", "paragraph"]);
  });

  it("starts a list straight after a paragraph without a blank line", () => {
    const blocks = parseAnswer("So geht es:\n1. Öffne Mein Konto");
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "list"]);
  });

  it("renders a heading as a strong line rather than dropping the hashes", () => {
    // A model told to be brief should not emit one at all. If it does, the
    // hashes must not reach the customer.
    const block = parseAnswer("## Erste Schritte")[0];
    if (block.kind !== "paragraph") throw new Error("expected a paragraph");
    expect(block.lines[0]).toEqual([{ kind: "strong", text: "Erste Schritte" }]);
  });

  it("has nothing to say about an empty answer", () => {
    expect(parseAnswer("")).toEqual([]);
    expect(parseAnswer("\n\n  \n")).toEqual([]);
  });

  it("survives the whole answer that started this", () => {
    const blocks = parseAnswer(
      "Die ersten Schritte findest du im Menü links:\n\n" +
        "- **Übersicht**\n- **Mein Konto**\n\n" +
        "So setzt du ein Passwort:\n\n" +
        "1. Öffne *Mein Konto*\n2. Klicke auf `Passwort setzen`",
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "list",
      "paragraph",
      "list",
    ]);
  });
});

describe("the Media Marker", () => {
  // AD-54's control is mechanical: a marker becomes a card only when the
  // COMPLETE marker string occurs verbatim in the allowed-set derived from
  // the loaded handbook. Everything else in this block is a way an answer —
  // or a prompt injection riding in one — fails that check and degrades to
  // plain text.

  const MARKER = "[media:erste-schritte/rundgang.mp4|Der Rundgang]";
  const ALLOWED = new Set([MARKER]);

  it("accepts a whitelisted marker as a media run", () => {
    expect(parseInline(MARKER, { allowedMedia: ALLOWED })).toEqual([
      {
        kind: "media",
        path: "erste-schritte/rundgang.mp4",
        label: "Der Rundgang",
      },
    ]);
  });

  it("keeps the text around an accepted marker", () => {
    expect(parseInline(`Schau hier: ${MARKER} — zwei Minuten.`, { allowedMedia: ALLOWED })).toEqual([
      { kind: "text", text: "Schau hier: " },
      {
        kind: "media",
        path: "erste-schritte/rundgang.mp4",
        label: "Der Rundgang",
      },
      { kind: "text", text: " — zwei Minuten." },
    ]);
  });

  it("agrees with markersIn() on exactly which strings are markers", () => {
    // THE agreement test (AD-56): the parser's inline alternative and
    // `markersIn()` are composed from the same `MEDIA_MARKER_PATTERN` export,
    // and this pins that they accept identical strings — each candidate is
    // parsed against the set `markersIn()` itself extracted, so the media
    // runs the parser finds must be exactly the extractor's findings.
    const candidates = [
      MARKER,
      "[media:a/b.mp4|x]",
      "[media:topic/clip.webm|Zwei Wörter hier]",
      "[media:a-b/c-1.pdf|Preisliste (PDF)]",
      // padded pipe — refused, no padding around `|`
      "[media:a/b.mp4 |x]",
      "[media:a/b.mp4| x]",
      // uppercase path — refused by the segment grammar
      "[media:Topic/b.mp4|x]",
      // missing label
      "[media:a/b.mp4|]",
      "[media:a/b.mp4]",
      // nested `]` in the label
      "[media:a/b.mp4|a]b]",
      // depth 3 and depth 1 — the path is exactly two segments
      "[media:a/b/c.mp4|x]",
      "[media:b.mp4|x]",
      // extension not in the allow-map — refused by the grammar itself
      "[media:a/b.exe|x]",
      // no marker at all
      "ein ganz normaler Satz [mit Klammern]",
      // Quoted in a code span — the parser's code alternative wins, and
      // `markersIn` blanks code before extracting, so BOTH sides read this as
      // prose about the syntax rather than an offer. Without that, a handbook
      // page explaining the marker would feed its own example into the
      // whitelist and kb-check would demand a file behind documentation.
      "Schreib es als `[media:a/b.mp4|x]`.",
      // Documentation and use in one line: the quoted occurrence stays code,
      // the loose one becomes the card. Whole-string membership makes the two
      // occurrences of the same string behave differently by CONTEXT, which is
      // exactly what "extractor and parser read context identically" means.
      "Als `[media:a/b.mp4|x]` schreiben — hier live: [media:a/b.mp4|x]",
    ];
    for (const candidate of candidates) {
      const extracted = markersIn(candidate);
      const runs = parseInline(candidate, { allowedMedia: new Set(extracted) });
      const media = runs.filter((run) => run.kind === "media");
      expect(media, candidate).toHaveLength(extracted.length);
    }
  });

  it("renders a marker quoted in a fenced block as text, not as a card", () => {
    // The whole pipeline, composed the way the app composes it: the whitelist
    // is `markersIn()` over the handbook page, and the answer is parsed
    // against that set. A marker that only ever appears fenced is never in the
    // set, so it can never become a card — the safe direction, and the reason
    // documentation about the syntax is free to quote it.
    const page = [
      "So sieht ein Marker aus:",
      "",
      "```",
      "[media:erste-schritte/beispiel.mp4|Beispiel]",
      "```",
      "",
      `Und hier einer, den es wirklich gibt: ${MARKER}`,
    ].join("\n");

    const allowed = new Set(markersIn(page));
    expect(allowed).toEqual(new Set([MARKER]));

    const fenced = parseInline("[media:erste-schritte/beispiel.mp4|Beispiel]", { allowedMedia: allowed });
    expect(fenced).toEqual([
      { kind: "text", text: "[media:erste-schritte/beispiel.mp4|Beispiel]" },
    ]);
  });

  it("denies everything when no set is passed, and when the set is empty", () => {
    // The fail-safe of AD-54: a mount that forgot the set denies, it does not
    // allow. The companion panel passes nothing ON PURPOSE.
    expect(parseInline(MARKER)).toEqual([{ kind: "text", text: MARKER }]);
    expect(parseInline(MARKER, { allowedMedia: new Set() })).toEqual([{ kind: "text", text: MARKER }]);
  });

  it("does not accept a marker whose path matches but whose label differs", () => {
    // Whole-string membership: a path-only match would let the model author
    // the label, and the label is the one thing it must never write.
    const relabelled = "[media:erste-schritte/rundgang.mp4|Klick hier]";
    expect(parseInline(relabelled, { allowedMedia: ALLOWED })).toEqual([
      { kind: "text", text: relabelled },
    ]);
  });

  it("keeps the AC-6 injection string as plain text", () => {
    const injected = "[media:invented/file.mp4|Klick hier]";
    const runs = parseInline(`Wichtig! ${injected}`, { allowedMedia: ALLOWED });
    expect(runs).toEqual([{ kind: "text", text: `Wichtig! ${injected}` }]);
  });

  it("keeps a quoted marker inside a code span as code", () => {
    // Somebody quoting a marker gets a quote, not a card — the code-span
    // alternative sits before the marker alternative, and the backtick wins.
    expect(parseInline(`\`${MARKER}\``, { allowedMedia: ALLOWED })).toEqual([
      { kind: "code", text: MARKER },
    ]);
  });

  it("leaves a half-streamed marker literal until the ] arrives", () => {
    // The unclosed-`**` property, inherited: the pattern needs the closing
    // bracket, so mid-stream there is nothing to match and nothing to buffer.
    expect(parseInline("[media:a/b.mp4|Kli", { allowedMedia: ALLOWED })).toEqual([
      { kind: "text", text: "[media:a/b.mp4|Kli" },
    ]);
  });

  it("never inline-parses the label", () => {
    // The label is the developer's, but parsing it would re-open the nesting
    // surface this subset deliberately lacks — asterisks reach the customer
    // literally, as ONE text node.
    const bold = "[media:a/b.mp4|**fett** und *schräg*]";
    const runs = parseInline(bold, { allowedMedia: new Set([bold]) });
    expect(runs).toEqual([
      { kind: "media", path: "a/b.mp4", label: "**fett** und *schräg*" },
    ]);
  });

  it("threads the set through parseAnswer into paragraphs and lists", () => {
    const blocks = parseAnswer(`Hier:\n- ${MARKER}`, { allowedMedia: ALLOWED });
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "list"]);
    const list = blocks[1];
    if (list.kind !== "list") throw new Error("expected a list");
    expect(list.items[0][0].kind).toBe("media");
  });

  it("still denies through parseAnswer without options — the old call shape", () => {
    const blocks = parseAnswer(MARKER);
    expect(blocks).toEqual([
      { kind: "paragraph", lines: [[{ kind: "text", text: MARKER }]] },
    ]);
  });
});

describe("the Content Link", () => {
  // Same mechanical control as the Media Marker above, with a set that is
  // built per REQUEST instead of per handbook. Everything here is a way an
  // answer fails that check and degrades to visible bracket text.

  const LINK = "[link:/dashboard/kurs/knoten#uebung-2|Lektion 3: Knoten binden]";
  const ALLOWED = new Set([LINK]);

  it("accepts a whitelisted marker as a link run", () => {
    expect(parseInline(LINK, { allowedLinks: ALLOWED })).toEqual([
      {
        kind: "link",
        target: "/dashboard/kurs/knoten#uebung-2",
        label: "Lektion 3: Knoten binden",
      },
    ]);
  });

  it("keeps the sentence around it — the whole point of an inline link", () => {
    expect(
      parseInline(`Das Thema wird in ${LINK} erklärt.`, { allowedLinks: ALLOWED }),
    ).toEqual([
      { kind: "text", text: "Das Thema wird in " },
      {
        kind: "link",
        target: "/dashboard/kurs/knoten#uebung-2",
        label: "Lektion 3: Knoten binden",
      },
      { kind: "text", text: " erklärt." },
    ]);
  });

  it("denies when no set is passed, and when the set is empty", () => {
    // The fail-safe: the companion panel passes nothing, and an answer whose
    // lookups produced no linkable hit has an empty set.
    expect(parseInline(LINK)).toEqual([{ kind: "text", text: LINK }]);
    expect(parseInline(LINK, { allowedLinks: new Set() })).toEqual([
      { kind: "text", text: LINK },
    ]);
  });

  it("refuses a marker the model invented, however plausible", () => {
    // THE case the whole epic exists to make impossible: a well-formed path
    // to a lesson nobody wrote. The grammar cannot catch this one — only the
    // per-request set can, because only it knows what a source returned.
    const invented = "[link:/dashboard/kurs/lektion-42|Lektion 42]";
    expect(parseInline(`Siehe ${invented}`, { allowedLinks: ALLOWED })).toEqual([
      { kind: "text", text: `Siehe ${invented}` },
    ]);
  });

  it("refuses a marker whose target matches but whose label was rewritten", () => {
    // Whole-string membership. A target-only match would let the model author
    // the link text — a misleading sentence over a real destination.
    const relabelled = "[link:/dashboard/kurs/knoten#uebung-2|klicke hier]";
    expect(parseInline(relabelled, { allowedLinks: ALLOWED })).toEqual([
      { kind: "text", text: relabelled },
    ]);
  });

  it("cannot express an off-site target at all", () => {
    // Belt and braces: even with the string in the allow-set, the grammar
    // never matched it, so there is nothing to whitelist.
    for (const hostile of [
      "[link://evil.com/x|Lektion 3]",
      "[link:https://evil.com|Lektion 3]",
      "[link:javascript:alert(1)|Lektion 3]",
      "[link:/dashboard/../admin|Lektion 3]",
      "[link:/dashboard?next=//evil.com|Lektion 3]",
    ]) {
      expect(parseInline(hostile, { allowedLinks: new Set([hostile]) }), hostile).toEqual([
        { kind: "text", text: hostile },
      ]);
    }
  });

  it("keeps a quoted marker inside a code span as code", () => {
    expect(parseInline(`\`${LINK}\``, { allowedLinks: ALLOWED })).toEqual([
      { kind: "code", text: LINK },
    ]);
  });

  it("leaves a half-streamed marker literal until the ] arrives", () => {
    expect(parseInline("[link:/dashboard/kurs|Lekt", { allowedLinks: ALLOWED })).toEqual([
      { kind: "text", text: "[link:/dashboard/kurs|Lekt" },
    ]);
  });

  it("never inline-parses the label", () => {
    const bold = "[link:/dashboard/kurs|**fett** und *schräg*]";
    expect(parseInline(bold, { allowedLinks: new Set([bold]) })).toEqual([
      { kind: "link", target: "/dashboard/kurs", label: "**fett** und *schräg*" },
    ]);
  });

  // 🚨 The marker must beat `**` and `*`, or a bolded sentence swallows it.
  // Emphasis used to accept `[`, `|` and `]` inside, so this whole line matched
  // as ONE `strong` run carrying the raw marker as text: the customer read
  // `[link:…|Lektion 3]` spelled out and the whitelisted link never rendered.
  // `EMPHASIS_INNER`'s lookahead is what fixes it — NOT the order of the
  // alternatives, which cannot: emphasis and a marker never start at the same
  // index, and alternation only breaks ties at one index. The persona makes
  // this the LIKELY shape (marker inside the sentence, and models bold
  // sentences), and the `**` degrading to literal asterisks is the deliberate,
  // cheaper loss.
  it("renders a whitelisted marker wrapped in bold, and lets the ** stay literal", () => {
    const line = `**Siehe ${LINK} dazu.**`;
    expect(parseInline(line, { allowedLinks: ALLOWED })).toEqual([
      { kind: "text", text: "**Siehe " },
      {
        kind: "link",
        target: "/dashboard/kurs/knoten#uebung-2",
        label: "Lektion 3: Knoten binden",
      },
      { kind: "text", text: " dazu.**" },
    ]);
  });

  it("renders a whitelisted marker wrapped tightly in bold or italic", () => {
    for (const wrapped of [`**${LINK}**`, `*${LINK}*`]) {
      const runs = parseInline(wrapped, { allowedLinks: ALLOWED });
      expect(runs, wrapped).toContainEqual({
        kind: "link",
        target: "/dashboard/kurs/knoten#uebung-2",
        label: "Lektion 3: Knoten binden",
      });
    }
  });

  // The same swallow, on the media marker — it has always been possible, and
  // only the media rule's "on a line of its own" kept it rare.
  it("renders a whitelisted media marker wrapped in bold", () => {
    const media = "[media:erste-schritte/rundgang.mp4|Der Rundgang]";
    const runs = parseInline(`**${media}**`, { allowedMedia: new Set([media]) });
    expect(runs).toContainEqual({
      kind: "media",
      path: "erste-schritte/rundgang.mp4",
      label: "Der Rundgang",
    });
  });

  // ⚠️ THE regression test for the positional capture groups. The link
  // alternative had to go LAST in `INLINE`; anywhere earlier reassigns the
  // media groups, breaks the card, and typechecks perfectly.
  it("parses bold, a media marker and a link marker on one line", () => {
    const media = "[media:erste-schritte/rundgang.mp4|Der Rundgang]";
    const line = `**Kurz:** ${media} und ${LINK}`;
    expect(
      parseInline(line, { allowedMedia: new Set([media]), allowedLinks: ALLOWED }),
    ).toEqual([
      { kind: "strong", text: "Kurz:" },
      { kind: "text", text: " " },
      { kind: "media", path: "erste-schritte/rundgang.mp4", label: "Der Rundgang" },
      { kind: "text", text: " und " },
      {
        kind: "link",
        target: "/dashboard/kurs/knoten#uebung-2",
        label: "Lektion 3: Knoten binden",
      },
    ]);
  });

  // The by-construction pin: whatever the composer emits, the parser accepts.
  // Both are built from `CONTENT_LINK_PATTERN`, and this is what keeps that
  // true rather than merely intended.
  it("accepts exactly what contentLinkMarker composes", () => {
    const cases: [string, string | null, string][] = [
      ["/dashboard/kurs/knoten", "uebung-2", "Lektion 3: Knoten binden"],
      ["/dashboard/kurs", null, "Der Kurs"],
      ["/dashboard/kurs/x", "media-koeder-knoten-mp4", "Das Video (2 Min.)"],
      ["/dashboard/Kurs/Lektion_3", null, "Lektion 3 – Teil 1"],
    ];
    for (const [url, anchor, label] of cases) {
      const marker = contentLinkMarker(url, anchor, label);
      expect(marker, `${url}#${anchor}`).not.toBeNull();
      const runs = parseInline(marker!, { allowedLinks: new Set([marker!]) });
      expect(runs, marker!).toEqual([
        { kind: "link", target: anchor ? `${url}#${anchor}` : url, label },
      ]);
    }
  });

  it("threads the set through parseAnswer into paragraphs and lists", () => {
    const blocks = parseAnswer(`Dazu gibt es:\n- ${LINK}`, { allowedLinks: ALLOWED });
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "list"]);
    const list = blocks[1];
    if (list.kind !== "list") throw new Error("expected a list");
    expect(list.items[0][0].kind).toBe("link");
  });
});
