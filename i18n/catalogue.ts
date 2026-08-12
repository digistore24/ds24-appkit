// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The app's texts, and the two settings that go with them — WITHOUT a request.
//
// This file holds what `i18n/request.ts` used to hold inline: the merge of the
// core catalogue with every installed module's, the time-zone pin, and what to
// do when a text or a format fails. None of the three has anything to do with an
// incoming request; they were simply written where the only caller was.
//
// The second caller is why they moved. A scheduled job has no request — no
// cookie, no `Accept-Language`, no `headers()` — so it cannot go through
// `getRequestConfig`, and the alternative to this file is a second, hand-copied
// catalogue that agrees with the first until somebody installs a module. See
// `i18n/translator.ts` for the way in, and `lib/notify/operators.ts` for the
// caller that needed it.
//
// `i18n/request.ts` now calls all three of these, so there is one merge in the
// tree rather than two.

import { IntlErrorCode, type IntlError } from "next-intl";

import { MODULE_MESSAGES } from "@/lib/modules/messages";
import { mergeModuleMessages } from "@/lib/modules/messages-merge";

import type { Locale } from "./config";

/**
 * One locale's whole catalogue: the core's, plus whatever the modules bring.
 *
 * 🚨 NOT a plain spread, and the first version of this WAS one. A module owns
 * whole namespaces named after itself — those replace, and cannot collide. But
 * `errors` and `nav` belong to the CORE and are looked up by a COMPUTED key
 * (`t(`errors.${code}`)`, `t(item.labelKey)`), so a module that returns error
 * codes has to add to them. A spread would have replaced the core's whole
 * `errors` object with a module's two keys, and every refusal in the app would
 * have rendered as its raw key — in every language, on every page, from the
 * first module onwards.
 *
 * `lib/modules/messages-merge.ts` carries the merge and the measurement.
 */
export async function messagesFor(locale: Locale): Promise<Record<string, unknown>> {
  return mergeModuleMessages(
    (await import(`../messages/${locale}.json`)).default,
    MODULE_MESSAGES[locale] ?? {},
  );
}

/**
 * The zone every formatted time in this app is rendered in.
 *
 * Pinned, because a component that renders a CLOCK time is SSR'd in the
 * server's zone and hydrated in the viewer's — use-intl warns about exactly
 * this ("markup mismatches caused by environment differences"). Every
 * format.dateTime in the app was dateStyle-only until the Operator's member
 * page; that is why it never surfaced before.
 *
 * A mail has no hydration step, but it has the same requirement for a different
 * reason: two mails about the same thing must not disagree about what time it
 * happened because one of them was rendered on a host in another zone.
 */
export function appTimeZone(): string {
  return process.env.APP_TIME_ZONE ?? "Europe/Berlin";
}

/**
 * What next-intl does when a text or a format fails.
 *
 * It does NOT throw. It reports here and renders a fallback instead — for
 * `format.dateTime()` that fallback is `String(value)`, so a bad date puts the
 * raw value into the page and the request still answers 200. Nothing about the
 * status code, the build or the test suite notices; only this.
 *
 * Which is why the error is logged rather than swallowed, and why
 * FORMATTING_ERROR gets a sentence with it. The stack trace points at the
 * `format.dateTime()` call, and that line is almost never the bug — the bug is
 * wherever the value was made. Without the sentence the obvious "fix" is
 * `new Date(value)` at the call site, which papers over a string that carries no
 * time zone and shifts the date by the host's offset.
 *
 * The error object is passed on its own so that Next can still resolve it to a
 * file, a line and a code frame; a wrapped message would lose that. Somewhere to
 * send these (Sentry and the like) belongs here too.
 */
export function onIntlError(error: IntlError): void {
  console.error(error);

  if (error.code === IntlErrorCode.FORMATTING_ERROR) {
    console.error(
      "[intl] The value handed to a formatter is not what its type claims.\n" +
        "       A raw sql`` expression and anything that travelled through JSON\n" +
        "       both give you a string, however convincingly it is typed as Date.\n" +
        "       Fix it where the value is produced — see docs/troubleshooting.md,\n" +
        "       'Dates and raw SQL'.",
    );
  }
}
