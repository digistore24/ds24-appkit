// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  accentFromCss,
  credentialBodies,
  imprintLines,
  renderMailHtml,
  renderMailText,
  DEFAULT_ACCENT,
  type CredentialTexts,
  type MailLayout,
} from "./email";

const TEXTS: CredentialTexts = {
  locale: "de",
  subject: "Sicherheitshinweis",
  heading: "Etwas hat sich an deiner Anmeldung geändert",
  what: "Das Kennwort deines Kontos wurde geändert.",
  when: "Zeitpunkt: 24. Juli 2026, 17:42 (UTC)",
  notYou: "Warst du das nicht? Melde dich beim Betreiber.",
};

describe("the credential-change notice", () => {
  // THE test of this file. The notice goes to somebody whose account may
  // already be in the wrong hands, and it is the one mail this app sends that
  // must be useless to forge. A link — any link — turns it into a phishing
  // template carrying our sender address, and "wasn't me, undo it" is exactly
  // the button an attacker would want us to have trained people to click.
  it("contains no link, in either body", () => {
    const { html, text } = credentialBodies(TEXTS);
    for (const [name, body] of [
      ["html", html],
      ["text", text],
    ] as const) {
      expect(body, `${name}: has an anchor`).not.toMatch(/<a[\s>]/i);
      expect(body, `${name}: has an href`).not.toMatch(/href\s*=/i);
      expect(body, `${name}: has a URL`).not.toMatch(/https?:\/\//i);
      expect(body, `${name}: has a mailto`).not.toMatch(/mailto:/i);
    }
  });

  it("says what changed, when, and what to do about it", () => {
    const { html, text } = credentialBodies(TEXTS);
    for (const body of [html, text]) {
      expect(body).toContain(TEXTS.what);
      expect(body).toContain(TEXTS.when);
      expect(body).toContain(TEXTS.notYou);
    }
  });

  it("escapes the texts rather than pasting them into the markup", () => {
    // The texts come from messages/*.json, so this is not an injection route
    // today. It is one the moment somebody interpolates a value into them —
    // an app name, an address — and the escaping has to already be there.
    const { html } = credentialBodies({
      ...TEXTS,
      what: `<script>alert("x")</script> & "quoted"`,
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
  });

  it("declares the language on the html element", () => {
    // Screen readers and mail clients pick the pronunciation from it, and the
    // notice is bilingual by design.
    expect(credentialBodies({ ...TEXTS, locale: "en" }).html).toContain(
      '<html lang="en">',
    );
  });

  it("stays link-free even fully branded", () => {
    // The branded layout is the same one the sign-in mail uses, and that one
    // carries legal links in its footer. The notice must not inherit them.
    const { html, text } = credentialBodies({
      ...TEXTS,
      app: "Fangfertig",
      salutation: "Hallo,",
    });
    for (const body of [html, text]) {
      expect(body).toContain("Fangfertig");
      expect(body).not.toMatch(/https?:\/\//i);
      expect(body).not.toMatch(/href\s*=/i);
    }
  });
});

// The layout every mail renders through. What matters here: the pieces the
// dogfooding run found missing — greeting, app name, legal links, a body that
// is not just a bare URL — actually appear, in both variants, escaped.
const LAYOUT: MailLayout = {
  locale: "de",
  app: "Fangfertig",
  salutation: "Hallo,",
  heading: "Anmelden bei Fangfertig",
  paragraphs: ["Klicke auf den Button, um dich anzumelden."],
  cta: {
    label: "Jetzt anmelden",
    url: "https://app.example/api/auth/callback?token=a&email=b%40c.de",
  },
  fallbackLabel: "Falls der Button nicht funktioniert, kopiere diesen Link:",
  textIntro: "Öffne diesen Link, um dich anzumelden:",
  note: "Du wolltest dich gar nicht anmelden? Dann ignoriere diese E-Mail.",
  footerLine: "Diese E-Mail wurde von Fangfertig gesendet.",
  footerLinks: [
    { label: "Impressum", url: "https://app.example/impressum" },
    { label: "Datenschutzerklärung", url: "https://app.example/datenschutz" },
  ],
  imprint: ["Impressum", "Fangfertig GmbH", "Seestraße 1, 12345 Plötzensee"],
  accent: "#123456",
};

describe("the mail layout", () => {
  it("carries greeting, app name, button and legal links in the html", () => {
    const html = renderMailHtml(LAYOUT);
    expect(html).toContain("Hallo,");
    expect(html).toContain("Fangfertig");
    expect(html).toContain("background:#123456");
    expect(html).toContain(">Jetzt anmelden</a>");
    expect(html).toContain('href="https://app.example/impressum"');
    expect(html).toContain('href="https://app.example/datenschutz"');
    expect(html).toContain(LAYOUT.footerLine as string);
  });

  it("escapes the url — it carries & and belongs inside an attribute", () => {
    const html = renderMailHtml(LAYOUT);
    expect(html).toContain("token=a&amp;email=b%40c.de");
    expect(html).not.toContain("token=a&email");
  });

  it("puts the same content into the text version, links as plain lines", () => {
    const text = renderMailText(LAYOUT);
    expect(text).toContain("Hallo,");
    expect(text).toContain("Öffne diesen Link, um dich anzumelden:");
    expect(text).toContain(LAYOUT.cta!.url);
    expect(text).toContain("Impressum: https://app.example/impressum");
    expect(text).toContain(LAYOUT.note as string);
  });

  it("prints the Impressum's content in both variants — a link is not enough", () => {
    // A mail sent in the course of business is a business letter; the
    // provider details belong in the mail itself, below the footer links.
    const html = renderMailHtml(LAYOUT);
    const text = renderMailText(LAYOUT);
    for (const body of [html, text]) {
      expect(body).toContain("Fangfertig GmbH");
      expect(body).toContain("Seestraße 1, 12345 Plötzensee");
    }
  });

  it("renders complete without app name, note or links", () => {
    const bare: MailLayout = {
      locale: "en",
      app: "",
      heading: "Sign in",
      paragraphs: ["Click the button."],
      footerLinks: [],
    };
    const html = renderMailHtml(bare);
    expect(html).toContain("Sign in");
    expect(html).not.toContain("undefined");
    expect(renderMailText(bare)).not.toContain("undefined");
  });
});

describe("the Impressum in the footer", () => {
  const IMPRESSUM = [
    "# Impressum",
    "",
    "**Fangfertig GmbH**",
    "Seestraße 1",
    "12345 Plötzensee",
    "",
    "- E-Mail: [kontakt@fangfertig.de](mailto:kontakt@fangfertig.de)",
    "- Registergericht: *Amtsgericht Plötzensee*, HRB 12345",
  ].join("\n");

  it("flattens the markdown to plain lines", () => {
    expect(imprintLines(IMPRESSUM)).toEqual([
      "Impressum",
      "Fangfertig GmbH",
      "Seestraße 1",
      "12345 Plötzensee",
      "E-Mail: kontakt@fangfertig.de",
      "Registergericht: Amtsgericht Plötzensee, HRB 12345",
    ]);
  });

  it("keeps a link's words and drops its target", () => {
    // In an address block the words are the content; clients auto-link
    // addresses on their own, and a raw URL in the footer is noise.
    const lines = imprintLines("Siehe [unsere Seite](https://example.com).");
    expect(lines).toEqual(["Siehe unsere Seite."]);
  });
});

describe("the accent colour", () => {
  it("takes a hex --primary as it is", () => {
    expect(accentFromCss(":root {\n  --primary: #4f46e5;\n}")).toBe("#4f46e5");
    expect(accentFromCss(":root { --primary: #ABC; }")).toBe("#aabbcc");
  });

  it("converts hsl() to hex — mail clients do not speak hsl", () => {
    expect(accentFromCss(":root { --primary: hsl(240 100% 50%); }")).toBe("#0000ff");
    expect(accentFromCss(":root { --primary: hsl(0, 0%, 100%); }")).toBe("#ffffff");
  });

  it("converts rgb() to hex", () => {
    expect(accentFromCss(":root { --primary: rgb(79, 70, 229); }")).toBe("#4f46e5");
  });

  it("gives null on a format it cannot read, so the sender falls back", () => {
    expect(accentFromCss(":root { --primary: oklch(0.6 0.2 270); }")).toBeNull();
    expect(accentFromCss(":root { --accent: #fff; }")).toBeNull();
    expect(DEFAULT_ACCENT).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("reads the shipped globals.css", async () => {
    // The value the template actually ships must be parseable — otherwise the
    // automatic "mails wear the app's colour" quietly degrades to the default.
    const { readFile } = await import("node:fs/promises");
    const css = await readFile("app/globals.css", "utf8");
    expect(accentFromCss(css)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("🚨 keeps DEFAULT_ACCENT equal to --primary in :root", async () => {
    // The comment above DEFAULT_ACCENT asks for exactly this and called the
    // alternative "a drift nothing reports" — and until 2026-09-07 nothing did:
    // the only assertion was the hex shape two tests up. `OG_ACCENT` in
    // `lib/pwa/manifest.ts` has had this test since it existed; this is its
    // sister, and the reason `node run.mjs brand colors --apply` now names both
    // copies in its closing lines. Measured in a customer's app: recoloured
    // through the command, every mail still carried the shipped petrol.
    const { readFile } = await import("node:fs/promises");
    const { parseTokens, tokenHex } = await import("@/scripts/ux/rules.mjs");
    const css = await readFile("app/globals.css", "utf8");
    expect(DEFAULT_ACCENT).toBe(tokenHex(parseTokens(css).light.primary));
    // And the two readers agree on what the file says — otherwise the fallback
    // could equal a value the sender never computes.
    expect(accentFromCss(css)).toBe(DEFAULT_ACCENT);
  });
});
