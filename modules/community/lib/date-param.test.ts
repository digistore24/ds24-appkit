// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// This module's half of `db/sql-date-param.test.ts`: does any query THIS module
// builds hand postgres.js a `Date` object?
//
// 🚨 **It exists because the answer was no, and the module's whole moderation
// path was down.** `reporterFactsFor()` compared `grants.access_until` against a
// JS `Date` interpolated into a raw `sql` fragment. There is no column mapper on
// the value's side of a raw template, so the driver's bind step threw
//
//   TypeError: The "string" argument must be of type string or an instance of
//   Buffer or ArrayBuffer. Received an instance of Date
//
// and `reportContent()` rolled back — **no spam report could ever be filed**, in
// any app with this module, from the day it shipped. With that: no send-block,
// no post-hide, nothing in the moderation queue. `npm run typecheck` was clean
// and the suite was green, because every guard over this file reads it as TEXT
// and nothing ran the query.
//
// ⚠️ **Why nothing upstream could have caught it.** `db/sql-cast.test.ts` scans
// for `sql<Date>` — the READ side, and the cast here is an honest `sql<number>`.
// `db/sql-date-param.test.ts` was a list of three functions in
// `lib/setup/manage.ts`, and this one could not be added to it: a file under
// `db/` may not name a module (`modules/boundary.test.ts` §1). So the apparatus
// lives in `db/date-param-harness.ts` and each side asks in its own tree.
//
// 🚨 **And why `deploy-test` could not see it either.** `reporterFactsFor()`
// returns early on an empty id list, so the query runs only once at least one
// reporter exists — and a fresh app has none. The first report in an app's life
// was the first execution, and it threw. A profile that never reports is a
// profile in which this code does not run.
import { describe, expect, it, vi } from "vitest";

import { bound, dateParams, resetBound } from "@/db/date-param-harness";

vi.mock("@/db", async () => {
  const { recordingDb } = await import("@/db/date-param-harness");
  return { db: recordingDb() };
});

describe("no community query binds a Date object", () => {
  it("reporterFactsFor — the sweep behind every report, send-block and post-hide", async () => {
    resetBound();
    const { reporterFactsFor } = await import("./_blocks");

    // One id, because the function returns before building anything on none —
    // which is exactly the early return that kept this defect out of every
    // fresh-app profile.
    await reporterFactsFor(["11111111-1111-4111-8111-111111111111"]);

    // 🚨 A count guard, not decoration: if the mock ever stops being reached,
    // `dateParams()` is empty and this line goes green having measured nothing.
    expect(bound.length).toBeGreaterThan(0);
    expect(dateParams()).toEqual([]);
  });
});
