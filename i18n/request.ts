// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { getRequestConfig } from "next-intl/server";
import { getUserLocale } from "./locale";
import { appTimeZone, messagesFor, onIntlError } from "./catalogue";

// next-intl's entry point: runs on every request and fixes the locale plus the
// texts for server AND client components. The file is wired up in
// next.config.ts (createNextIntlPlugin).
//
// Everything below the locale lives in `./catalogue.ts` — the merge, the
// time-zone pin and the error handler are the same three answers whether or not
// there is a request, and a scheduled job needs them with no request at all
// (`i18n/translator.ts`). This file is what turns a REQUEST into a locale, and
// nothing else.
export default getRequestConfig(async () => {
  const locale = await getUserLocale();
  return {
    locale,
    timeZone: appTimeZone(),
    messages: await messagesFor(locale),
    onError: onIntlError,
  };
});
