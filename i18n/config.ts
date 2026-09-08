// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The app's languages — one place for everything locale-related.
//
// To add a language <code>:
//   1. `messages/<code>.json` — copy `de.json` and translate every string. The
//      same for `modules/<id>/messages/<code>.json` in every installed module.
//   2. `<code>` in LOCALES and its name in LOCALE_LABELS, below.
//   3. The import and the entry in `i18n/static-messages.ts`.
//   4. `title.<code>` in every `modules/<id>/module.json`.
//   5. The language's word for a machine in `NAMES_A_MACHINE`,
//      `lib/ai/disclosure.mjs`.
//   6. `content/legal/<slug>.<code>.md` for every legal page in `content/legal/`.
//   7. `<code>` in `productIds` of every product in
//      `config/digistore-products.json`, then `node run.mjs ds24-sync` — one
//      Digistore24 product per language.
//   8. The language's currency in `CURRENCY_BY_LOCALE`, `lib/ai/pricing.mjs`.
// `npm run test` holds steps 1 to 4, 6 and 8; `node run.mjs legal-check` reads
// 5 and 6. The full list, with removing: `docs/locales.md`.
//
// Deliberately WITHOUT a locale prefix in the URL: /plans stays /plans. The
// locale lives in a cookie (the switcher) and is derived from the browser on
// the first visit. That keeps proxy.ts responsible for sign-in alone.

export const LOCALES = ["de", "en", "es", "fr"] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * The locale for a visitor whose browser asks for none of ours — English when
 * the app speaks it, otherwise the first language in LOCALES.
 *
 * Derived, never written: an app that drops English must not keep sending
 * strangers to it, and an app that never had it needs no edit here. The same
 * value is what a mail, a legal page or a checkout falls back to when the
 * locale it was given is not one of ours.
 */
export function fallbackLocaleFor<T extends string>(locales: readonly T[]): T {
  if (locales.length === 0) throw new Error("fallbackLocaleFor: the app speaks no language at all");
  return locales.find((code) => code === "en") ?? locales[0];
}

export const DEFAULT_LOCALE: Locale = fallbackLocaleFor(LOCALES);

/** Name of the cookie holding the user's choice. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Display name per locale — always in that language itself, never translated. */
export const LOCALE_LABELS: Record<Locale, string> = {
  de: "Deutsch",
  en: "English",
  es: "Español",
  fr: "Français",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks the best supported locale from an `Accept-Language` header.
 *
 * Deliberately plain: quality weights (`;q=`) are honored, regions ignored
 * (`de-AT` counts as `de`), and only a language the app speaks can win. If the
 * browser knows none of ours, DEFAULT_LOCALE applies — English, or the first
 * in LOCALES.
 */
export function matchLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const wanted = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="))
        ?.slice(2);
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q) : 1 };
    })
    .filter((entry) => entry.tag && !Number.isNaN(entry.q))
    .sort((a, b) => b.q - a.q);

  for (const { tag } of wanted) {
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
