// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The two markers a file under `content/legal/` can carry, and what each means.
//
// Both are HTML comments on the first lines of the markdown, so the file says
// what it is without the check having to guess from its length or from a
// filename convention an operator has no reason to preserve:
//
//   1. **The placeholder** — the shipped text. Nobody has written anything yet;
//      the page shows a warning box and `node run.mjs legal-check` fails.
//   2. **The draft** — the text `compliance-check` wrote. It was produced by
//      software from the data inventory of this app and is a DRAFT FOR LEGAL
//      REVIEW ("Entwurf zur Vorlage bei einer Rechtsberatung"): nobody who
//      publishes this template gives legal advice, may give it or wants to, and
//      a privacy policy that reads like a finished one creates exactly that
//      impression. So the page says so, in a box above the text, in the
//      reader's language, and `legal-check` reports it — until the operator
//      removes the marker after a lawyer has reviewed the text. Removing it is
//      the operator's act, never the skill's.
//
// `.mjs` with zero imports, like `lib/ai/disclosure.mjs`: `scripts/legal/check.mjs`
// is plain Node and cannot import TypeScript, and a marker that exists twice
// drifts. `lib/legal/pages.ts` re-exports from here.

/** The marker a shipped placeholder carries. Removing it is part of filling it in. */
export const PLACEHOLDER_MARKER = "<!-- ds24-appkit:placeholder -->";

/**
 * The marker a drafted legal text carries until a lawyer has reviewed it.
 * `compliance-check` writes it on the first line of every text it drafts.
 */
export const DRAFT_MARKER = "<!-- ds24-appkit:draft -->";

/**
 * A legal file's text without its markers, and what the markers said.
 *
 * **A draft's label line goes with the marker.** The file `compliance-check`
 * writes opens with the marker and then ONE bold paragraph — *Entwurf zur
 * Vorlage bei einer Rechtsberatung …* — so that the file itself says what it
 * is to whoever opens it outside the app, a lawyer included. On the page that
 * sentence is the warning box in the reader's language, and in a mail footer
 * (`lib/email.ts`, `imprintFor`) it would be the first line of the provider
 * details — so it is treated as part of the marker and taken out of `text`,
 * handed back as `label` instead. Only a bold paragraph directly after the
 * marker counts; a draft that opens with a heading loses nothing.
 *
 * @param {string} raw the file as written
 * @returns {{ text: string, placeholder: boolean, draft: boolean, label: string | null }}
 */
export function readMarkers(raw) {
  const source = String(raw ?? "");
  const draft = source.includes(DRAFT_MARKER);
  let text = source.replace(PLACEHOLDER_MARKER, "").replace(DRAFT_MARKER, "").trimStart();
  let label = null;
  if (draft) {
    // The first paragraph, if it is the bold label: up to the first blank line
    // (any line ending — CLAUDE.md, "Three systems").
    const match = /^(\*\*[^\n\r]*(?:\r\n|\r|\n)?(?:[^\n\r]+(?:\r\n|\r|\n)?)*?)(?:\r\n|\r|\n)\s*(?:\r\n|\r|\n)/.exec(text + "\n\n");
    if (match) {
      label = match[1].trim();
      text = text.slice(match[0].length).trimStart();
    }
  }
  return { text, placeholder: source.includes(PLACEHOLDER_MARKER), draft, label };
}
