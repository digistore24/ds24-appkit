// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// "Did these two instants fall on the same calendar day?" — asked in a NAMED
// zone, because that is the only way the question has an answer.
//
// The surface that needed it first is the private inbox: a message from this
// morning gets a time and one from March gets a date, which is how every inbox
// worth scanning behaves and what a row of five identical "16.08.2026"s cannot
// do. Anything else that wants "today" rather than a date belongs here too
// rather than beside its own page — the mistake this file exists to prevent is
// a second implementation comparing `getDate()`, which reads the SERVER's zone
// and disagrees with the app's for two hours every night.
//
// Pure: no config read, no clock of its own. The caller passes both instants
// and the zone (`appTimeZone()` from `i18n/catalogue.ts`, which is what
// `i18n/request.ts` hands the formatter).

/**
 * Same year, month and day in `timeZone`?
 *
 * 🚨 **Via `Intl`, never via `getDate()`/`getMonth()`.** Those read the zone
 * the process happens to run in — UTC on every host this template deploys to
 * — so a member in Berlin would see "yesterday" for anything written between
 * midnight and 02:00 local, and a member in Auckland for half the day. `Intl`
 * is the only zone conversion in the platform that is right about the rules,
 * including the ones that change.
 *
 * `en-CA` is not a language choice: it is the locale whose numeric date format
 * is `YYYY-MM-DD`, so the comparison is a plain string equality on values that
 * cannot be ambiguous between `01/02` and `02/01`. Nothing here is shown to
 * anybody — the visible date is formatted by the caller, in the reader's
 * language.
 *
 * An invalid date compares false rather than throwing: `Intl` renders one as
 * "Invalid Date", and two of those would otherwise be "the same day".
 */
export function isSameDay(a: Date, b: Date, timeZone: string): boolean {
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;

  const asDay = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return asDay.format(a) === asDay.format(b);
}
