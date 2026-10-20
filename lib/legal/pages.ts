// The legal pages: which ones exist, and where their text lives.
//
// ── Why the text is a file and not a translation key ──────────────────────
// A privacy policy is three thousand words of prose that changes as a unit. In
// `messages/de.json` it would be one enormous string with escaped newlines,
// diffed as a single line, and `i18n/messages.test.ts` would demand a
// word-perfect English twin before the build went green — which is exactly the
// pressure that produces a machine-translated privacy policy.
//
// So the pattern is `content/knowledge/`, which this template already uses for
// the assistant's handbook: markdown on disk, one file per language, edited by
// whoever writes the text.
//
// ── The slugs are German, and stay German ─────────────────────────────────
// `/impressum` is what a German user, a competitor and a Landesdatenschutz-
// behörde all look for, and § 5 DDG asks for the notice to be *easily
// recognisable*. An `/imprint` that only English speakers find is a worse
// answer to that than a German word in an English page's footer.
//
// ── What ships, and what does not ─────────────────────────────────────────
// Impressum and Datenschutzerklärung ship as PLACEHOLDERS, because every app
// needs both, always — text in `content/legal/`, route in `app/impressum/` and
// `app/datenschutz/`.
//
// AGB and Widerrufsbelehrung ship as NEITHER. Whether you need them depends on
// whether Digistore24 resells for you (`docs/compliance.md` §0), and a terms
// page in an app whose terms are somebody else's is worse than no page at all.
// `compliance-check` creates both halves when the answer says so: the markdown
// **and** a three-line `app/<slug>/page.tsx` beside the two that exist. Their
// slugs are already in the list below so the footer picks them up, and
// `node run.mjs legal-check` knows not to complain about their absence.
import { readFile } from "node:fs/promises";
import path from "node:path";

import { LOCALES, DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { PLACEHOLDER_MARKER, DRAFT_MARKER, readMarkers } from "@/lib/legal/markers.mjs";

/** Every page this app is willing to serve under a legal slug. */
export const LEGAL_SLUGS = ["impressum", "datenschutz", "agb", "widerruf"] as const;

export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export function isLegalSlug(value: string): value is LegalSlug {
  return (LEGAL_SLUGS as readonly string[]).includes(value);
}

/** Where the files live. */
export const LEGAL_DIR = path.join(process.cwd(), "content", "legal");

function fileFor(slug: LegalSlug, locale: string): string {
  return path.join(LEGAL_DIR, `${slug}.${locale}.md`);
}

export interface LegalDocument {
  slug: LegalSlug;
  /** The markdown, as written. */
  text: string;
  /** Which language file actually answered — may not be the one asked for. */
  locale: string;
  /**
   * True when this is still the shipped placeholder.
   *
   * Marked in the file itself with the line below, so the check does not depend
   * on guessing from the length or on a filename convention that an operator
   * would have no reason to preserve. `node run.mjs legal-check` reports it and
   * `go-live` asks before the app meets a customer — a live Impressum reading
   * "not filled in yet" is a § 5 DDG problem and a first impression.
   */
  placeholder: boolean;
  /**
   * True while the text is the draft `compliance-check` wrote and no lawyer has
   * reviewed it — marked with `DRAFT_MARKER`. The page says so in a box above
   * the text ("Entwurf zur Vorlage bei einer Rechtsberatung"), because the
   * people who publish this template neither give legal advice nor may, and
   * `legal-check` reports it. The operator removes the marker after the review.
   */
  draft: boolean;
}

// The markers live in `markers.mjs`, shared with `scripts/legal/check.mjs`.
export { PLACEHOLDER_MARKER, DRAFT_MARKER };

/**
 * One legal document, or `null` when the app does not have that page.
 *
 * **Falls back to the default locale rather than 404ing.** A German operator
 * who wrote only `datenschutz.de.md` should not show an English visitor a
 * missing page: a privacy policy in the wrong language is readable, and a
 * missing one is a violation. The page says which language it is showing.
 */
export async function legalDocument(
  slug: LegalSlug,
  locale: Locale,
): Promise<LegalDocument | null> {
  const tried = [locale, DEFAULT_LOCALE, ...LOCALES];

  for (const candidate of [...new Set(tried)]) {
    try {
      const raw = await readFile(fileFor(slug, candidate), "utf8");
      const { text, placeholder, draft } = readMarkers(raw);
      return { slug, text, locale: candidate, placeholder, draft };
    } catch {
      // Not there in this language. Try the next.
    }
  }

  return null;
}

/**
 * Which legal pages this app actually has, for the footer.
 *
 * Read at request time rather than hard-coded: an operator who has not written
 * their AGB yet should not have a footer link to a 404, and one who wrote them
 * this morning should not have to find a list to register them in.
 */
export async function availableLegalPages(locale: Locale): Promise<LegalSlug[]> {
  const found = await Promise.all(
    LEGAL_SLUGS.map(async (slug) => ((await legalDocument(slug, locale)) ? slug : null)),
  );
  return found.filter((slug): slug is LegalSlug => slug !== null);
}
