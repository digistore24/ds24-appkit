// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { and, or } from "drizzle-orm";

/**
 * Turn a page number from a query string into an OFFSET Postgres will accept.
 *
 * ⚠️ **`Math.floor` and the finite check are the load-bearing parts.** The
 * callers clamp with `Math.max(1, Number(x) || 1)`, which filters NaN and
 * negatives but NOT fractions or infinities — so `?page=1.1` produced an offset
 * of `5.000000000000004` and `?page=1e999` produced `Infinity`, and Postgres
 * refuses both (`argument of OFFSET must be type bigint`). An out-of-range page
 * is meant to be an empty page, not a 500 on a signed-in member's screen.
 *
 * `Number.MAX_SAFE_INTEGER` as the ceiling rather than a business limit: this
 * function's job is to hand the driver something it can serialise, and "how far
 * may somebody page" is the caller's question.
 */
export function pageOffset(page: number, perPage: number): number {
  if (!Number.isFinite(page)) return 0;
  const whole = Math.max(1, Math.floor(page));
  return Math.min(Math.max(0, whole - 1) * perPage, Number.MAX_SAFE_INTEGER);
}
