// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The measuring apparatus behind `sql-date-param.test.ts`, on its own so a
// MODULE can use it too.
//
// 🚨 **Why it had to move out of that test file.** The defect it measures — a
// JS `Date` interpolated into a raw `sql` template, which the driver's bind
// step throws on — has now happened twice: once in `lib/setup/manage.ts`
// (A71, the whole story is in `sql-date-param.test.ts`'s header) and once in
// `modules/community/lib/_blocks.ts`, where it took out **every spam report in
// the module**, with `npm run typecheck` clean and the whole suite green. The
// guard existed for the first one and could not see the second: it is a list of
// three named functions, and `modules/boundary.test.ts` forbids a file under
// `db/` from naming a module at all, so the community case could never have been
// added to it. A harness both sides import is the only shape in which one
// question gets one answer.
//
// ⚠️ **It is not a scanner and must not become one.** What is dangerous is the
// TYPE of an interpolated value, and no text rule can see a type — the measured
// attempt is written up in `sql-date-param.test.ts` and had nine findings that
// were all correct code. So each caller BUILDS its real query through its real
// function and reads what would have gone on the wire. That means each new call
// site is a deliberate line somebody writes, and the count guard below is what
// stops a line that has stopped measuring from staying green.
//
// It needs no database. The client records instead of connecting, which is why
// this can live in `make check` rather than behind one.
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "./schema";

/** Every parameter array drizzle handed the driver since the last reset. */
export const bound: { query: string; params: unknown[] }[] = [];

/** Forget what was recorded — every test case opens with this. */
export function resetBound(): void {
  bound.length = 0;
}

/**
 * A postgres.js stand-in that answers nothing and remembers everything.
 *
 * `unsafe(query, params)` is the ONE method drizzle's postgres-js session calls
 * (`node_modules/drizzle-orm/postgres-js/session.cjs`), in two shapes: awaited
 * directly, and with `.values()` when the query selects fields. Both are here,
 * and both return no rows — this harness is about what goes OUT.
 */
export function recordingClient() {
  const unsafe = (query: string, params: unknown[] = []) => {
    bound.push({ query, params });
    return Object.assign(Promise.resolve([] as unknown[]), {
      values: () => Promise.resolve([] as unknown[]),
    });
  };
  // `options.parsers` / `options.serializers` are not decoration: `drizzle()`
  // WRITES into them (`postgres-js/driver.js` → `construct`), replacing the
  // handler of every date/time OID with `(val) => val`. That single line is the
  // whole of A71 — it is why a `Date` bound by a raw template is handed to
  // `Buffer.byteLength()` as an object instead of being serialised, and why a
  // `types:` mapping on the client in `db/index.ts` could not save it. There is
  // no such mapping there any more, for exactly that reason (story A74);
  // `db/timestamp-utc.test.ts` holds the measurement.
  return Object.assign(() => {}, {
    unsafe,
    options: { parsers: {}, serializers: {} },
  });
}

/** The handle a `vi.mock("@/db", …)` factory hands back. */
export function recordingDb() {
  return drizzle(recordingClient() as never, { schema });
}

/** A `Date` reaching the driver is the defect; anything else is not this test. */
export function dateParams(): string[] {
  return bound.flatMap(({ query, params }) =>
    params.flatMap((param, index) =>
      param instanceof Date
        ? [`$${index + 1} of \`${query}\` is a Date (${param.toISOString()})`]
        : [],
    ),
  );
}
