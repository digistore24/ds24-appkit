// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT
//
// The two markers a legal file can carry, and the one thing each has to do:
// the placeholder fails `legal-check` and shows a box; the draft keeps the box
// "Entwurf zur Vorlage bei einer Rechtsberatung" on the page until the operator
// removes it after a lawyer has read the text. Whoever publishes this template
// gives no legal advice — so a drafted privacy policy that rendered like a
// finished one would be the defect, and it would be invisible: the page loads,
// smoke is green, the text reads well.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DRAFT_MARKER, PLACEHOLDER_MARKER, readMarkers } from "./markers.mjs";

const ROOT = join(__dirname, "..", "..");
const LEGAL = join(ROOT, "content", "legal");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

describe("readMarkers", () => {
  it("strips the draft marker AND its label paragraph, and hands the label back", () => {
    // The label is what the file says to a lawyer; on the page the box says it,
    // and a mail footer (`imprintFor`) must never open with it.
    const out = readMarkers(
      `${DRAFT_MARKER}\n**Entwurf zur Vorlage bei einer Rechtsberatung** — am 2026-10-20\nentworfen. Keine Rechtsberatung.\n\n# Datenschutz\n\nWir verarbeiten …`,
    );
    expect(out).toEqual({
      text: "# Datenschutz\n\nWir verarbeiten …",
      placeholder: false,
      draft: true,
      label: "**Entwurf zur Vorlage bei einer Rechtsberatung** — am 2026-10-20\nentworfen. Keine Rechtsberatung.",
    });
  });

  it("a draft that opens with a heading loses nothing", () => {
    const out = readMarkers(`${DRAFT_MARKER}\n# Impressum\n\nFirma`);
    expect(out).toEqual({ text: "# Impressum\n\nFirma", placeholder: false, draft: true, label: null });
  });

  it("works with CRLF line endings", () => {
    const out = readMarkers(`${DRAFT_MARKER}\r\n**Draft for legal review.**\r\n\r\n# Imprint\r\n`);
    expect(out.text).toBe("# Imprint\r\n");
    expect(out.label).toBe("**Draft for legal review.**");
  });

  it("strips the placeholder marker and says the text is the shipped one", () => {
    const out = readMarkers(`${PLACEHOLDER_MARKER}\nDiese Seite ist noch nicht ausgefüllt.`);
    expect(out).toEqual({
      text: "Diese Seite ist noch nicht ausgefüllt.",
      placeholder: true,
      draft: false,
      label: null,
    });
  });

  it("a text with no marker is neither", () => {
    expect(readMarkers("# Impressum\n\nFirma")).toEqual({
      text: "# Impressum\n\nFirma",
      placeholder: false,
      draft: false,
      label: null,
    });
  });
});

describe("the shipped placeholders", () => {
  for (const file of readdirSync(LEGAL).filter((f) => f.endsWith(".md"))) {
    it(`content/legal/${file} is a placeholder and not a draft`, () => {
      const out = readMarkers(readFileSync(join(LEGAL, file), "utf8"));
      expect(out.placeholder).toBe(true);
      expect(out.draft).toBe(false);
    });
  }
});

describe("one copy of the markers", () => {
  // The report and the page must agree about what a file is; a second literal
  // in either is the drift this file exists to refuse.
  it("scripts/legal/check.mjs imports them rather than spelling them", () => {
    const source = read("scripts/legal/check.mjs");
    expect(source).toMatch(/from "\.\.\/\.\.\/lib\/legal\/markers\.mjs"/);
    expect(source).not.toContain('"<!-- ds24-appkit:placeholder -->"');
    expect(source).not.toContain('"<!-- ds24-appkit:draft -->"');
  });

  it("lib/legal/pages.ts re-exports them", () => {
    const source = read("lib/legal/pages.ts");
    expect(source).toContain('from "@/lib/legal/markers.mjs"');
    expect(source).not.toContain('"<!-- ds24-appkit:placeholder -->"');
  });
});

describe("the page says it is a draft", () => {
  it("components/legal-page.tsx mounts the draft box on document.draft", () => {
    const source = read("components/legal-page.tsx");
    expect(source).toContain("document.draft &&");
    expect(source).toContain('t("draftTitle")');
    expect(source).toContain('t("draftBody")');
  });

  it("the German box reads 'Entwurf zur Vorlage bei einer Rechtsberatung'", () => {
    const de = JSON.parse(read("messages/de.json"));
    expect(de.legal.draftTitle).toBe("Entwurf zur Vorlage bei einer Rechtsberatung");
    expect(de.legal.draftBody).toMatch(/keine Rechtsberatung/);
  });

  it("legal-check reports a draft and names the marker", () => {
    const source = read("scripts/legal/check.mjs");
    expect(source).toContain("is a draft for legal review");
    expect(source).toContain("Entwurf zur Vorlage bei einer");
  });
});
