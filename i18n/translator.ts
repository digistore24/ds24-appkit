// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Texts and formats for code that has NO request behind it — a scheduled job,
// a script, anything the app does on its own clock.
//
// ── Why not the documented way, `getTranslations({ locale })` ──────────────
// The signature exists (`next-intl/dist/types/server/react-server/
// getTranslations.d.ts`) and next-intl really does pass the value on as
// `params.locale`. It lands in OUR `getRequestConfig` handler all the same
// (`getConfig(localeOverride)` in next-intl's `server/react-server/
// getConfig.js`), and that handler resolves the locale from the request:
// `i18n/request.ts` calls `getUserLocale()`, which opens the cookie jar
// (`i18n/locale.ts`) outside the `try` that guards the header read.
//
// The result is not merely "does not work" — it is two different wrong answers
// for the same job, which is the whole argument for this file:
//
//   · the in-process scheduler (`lib/cron/scheduler.ts`, from
//     `instrumentation.ts`): no request at all, so the cookie read THROWS.
//   · `POST /api/cron` (`node run.mjs cron --job …`): a real request, just one
//     with no language cookie — so it does NOT throw and quietly renders in
//     DEFAULT_LOCALE, whatever the operator configured.
//
// Two triggers, two outcomes, the same job. That is worse than an error.
//
// So this goes through `createTranslator` / `createFormatter` instead — the
// synchronous core of next-intl (re-exported from `use-intl/core`): no React
// `cache()`, no `next-intl/config` alias that only the Next plugin sets, and
// therefore runnable under vitest, which is what lets the mail path be measured
// end to end rather than asserted.
//
// The locale is a PARAMETER here and always will be. Whoever calls this decides
// the language from something they hold — for operator mail that is
// `config/notifications.json`, because `users` has no locale column and the only
// language source in the tree is a cookie a job does not have.

import { createFormatter, createTranslator, type IntlError } from "next-intl";

import { appTimeZone, messagesFor, onIntlError } from "./catalogue";
import type { Locale } from "./config";

/**
 * What a caller gets: look a key up, interpolate its placeholders.
 *
 * Deliberately narrower than next-intl's own `Translator`. That type is
 * generic over the whole catalogue's shape and resolves its keys from it; our
 * catalogue is assembled at runtime out of a JSON import and the installed
 * modules' texts, so the shape is `Record<string, unknown>` and the clever type
 * has nothing to be clever about. `rich()` and `markup()` are left out for a
 * second reason: they return React nodes, and the callers of this file render
 * mail.
 */
export type Translate = (
  key: string,
  values?: Record<string, string | number | Date>,
) => string;

/**
 * `createTranslator`, seen through the one shape we use.
 *
 * The library's own signature infers the key union from the messages object,
 * which needs a literal catalogue at compile time. Ours is loaded at runtime, so
 * the inference collapses and the call stops accepting a plain `string` key.
 * This is the one cast, made here rather than at every call site.
 */
const createLooseTranslator = createTranslator as unknown as (opts: {
  locale: string;
  messages: Record<string, unknown>;
  namespace?: string;
  timeZone?: string;
  onError?: (error: IntlError) => void;
}) => Translate;

/** The texts of one locale, with no request in sight. */
export async function translatorFor(
  locale: Locale,
  namespace?: string,
): Promise<Translate> {
  return createLooseTranslator({
    locale,
    messages: await messagesFor(locale),
    namespace,
    timeZone: appTimeZone(),
    onError: onIntlError,
  });
}

/** Dates, numbers and lists of one locale, in the app's pinned time zone. */
export function formatterFor(locale: Locale): ReturnType<typeof createFormatter> {
  return createFormatter({
    locale,
    timeZone: appTimeZone(),
    onError: onIntlError,
  });
}
