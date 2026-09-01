// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The message catalogues as STATIC imports, keyed by locale.
//
// ── Why this file exists at all ────────────────────────────────────────────
// `i18n/catalogue.ts` already answers "the texts of one locale", and it is the
// one every request goes through. It loads them with a dynamic
// `import(\`../messages/${locale}.json\`)`, which is right there: the locale is
// a runtime value and only one catalogue is wanted per request.
//
// Two callers cannot use it, for two different reasons, and both need the
// catalogues as VALUES rather than as promises:
//
//   · `lib/ai/nav-labels.ts` builds the menu block of the assistant's system
//     prompt. That block lands in the CACHED half, so it has to be
//     byte-identical on every request of one build — a dynamic import would
//     make it async and put a `Promise` where a string belongs.
//   · `i18n/messages.test.ts` compares every locale against every other. An
//     `await import()` per locale works, but the catalogues are what the test IS
//     about, and reading them the way the app cannot read them is how a test
//     starts measuring its own plumbing.
//
// 🚨 **So this is the one list that has to be edited by hand when a language is
// added, and it is the one place that is true of.** Both callers used to carry
// their own `{ de, en }` literal — two lists, two things to forget, and the
// failure of the first one is a hole in a cached prompt with nothing red
// anywhere. `catalogueCoverage()` below is what turns forgetting into a test
// failure instead.
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import fr from "@/messages/fr.json";

import { LOCALES, type Locale } from "./config";

/** Every locale's core catalogue, before any module's texts are merged in. */
export const STATIC_MESSAGES: Record<string, Record<string, unknown>> = {
  de: de as unknown as Record<string, unknown>,
  en: en as unknown as Record<string, unknown>,
  es: es as unknown as Record<string, unknown>,
  fr: fr as unknown as Record<string, unknown>,
};

/**
 * Which locales this map covers and which it misses — the honest shape, so a
 * caller can report both directions.
 *
 * `extra` matters as much as `missing`: a catalogue left behind here after its
 * code came out of `LOCALES` is a file that still ships, still gets translated
 * by whoever tidies up, and belongs to a language the app no longer offers.
 */
export function catalogueCoverage(): { missing: Locale[]; extra: string[] } {
  const have = new Set(Object.keys(STATIC_MESSAGES));
  return {
    missing: LOCALES.filter((locale) => !have.has(locale)),
    extra: [...have].filter((code) => !(LOCALES as readonly string[]).includes(code)),
  };
}
