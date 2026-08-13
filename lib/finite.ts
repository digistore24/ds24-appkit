// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// A number that came from outside, made safe to add up.
//
// Five files held this line verbatim, under two names — `count()` in
// `lib/cron/security-record.ts` and `lib/ops/watchdog.ts`, `num()` in all three
// AI providers. Two names for one idea is the small smell; the reason it is
// worth one home is the paragraph below, which stood in none of the five.
//
// 🚨 **Why `0` and not `NaN`, and why that is a decision rather than a
// convenience.** Every caller feeds a number that a REMOTE service or a stored
// row supplied, into something an operator then reads:
//
//   · the AI providers turn a vendor's `usage` object into the row written to
//     `ai_usage`. A `NaN` there does not throw — it is written, and then every
//     SUM over that table is `NaN` for ever. The cost report simply stops
//     having an answer, and nothing says when it stopped.
//   · `lib/cron/security-record.ts` and `lib/ops/watchdog.ts` build the single
//     line a job returns and the mail an operator gets. `NaN` renders as the
//     word "NaN" in front of a person at seven in the morning.
//
// So a missing or malformed figure counts as nothing, which is the honest
// reading: the vendor did not tell us, and zero is what we know. What this must
// NOT become is a silent repair of a number that IS there — it only replaces
// values that are not finite numbers at all.

/**
 * `value` when it is a finite number, `0` otherwise.
 *
 * `Number.isFinite` rather than `typeof === "number"` alone: `NaN` and the two
 * infinities are all typed `number`, and all three are exactly what this
 * guards against.
 */
export function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
