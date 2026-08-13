// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `node run.mjs errors` is only worth having if it is trusted, and trust here
// breaks in two directions. Miss a real error and the agent ships a broken page
// believing the log was clean; flag the dev-login banner and the command cries
// wolf on every fresh project until nobody reads it any more.
//
// So both directions are tested, against log text captured from a real run:
// the fixture below is the actual output of a Next 16 dev server that rendered
// `format.dateTime()` on a string — the bug this command was written for.
import { describe, expect, it } from "vitest";
import { parseErrors } from "./parse.mjs";

/**
 * A real log excerpt. Note the shapes that a naive parser gets wrong:
 *   - request lines are indented by one space, error blocks start at column 0
 *   - the code frame puts `>` and `}` at column 0 *inside* the block
 *   - the same error repeats once per row of the table
 *   - the dev-login banner is loud, carries a ⚠️, and is not a problem
 */
const REAL_LOG = `   ▲ Next.js 16.2.11 (Turbopack)
   - Local:        http://localhost:3000
 ✓ Ready in 1.4s
 GET /dashboard/admin/challenges 200 in 624ms (next.js: 518ms, proxy.ts: 10ms)
 GET /plans 200 in 41ms (next.js: 1443µs, application-code: 40ms)

⚠️  DEVELOPMENT LOGIN ACTIVE — sign-in without password and without magic link.
   Reason: no mail transport configured. Set one up with: node run.mjs mail-setup

Error: FORMATTING_ERROR: Invalid time value
    at <unknown> (app/dashboard/admin/challenges/[id]/page.tsx:174:35)
    at Array.map (<anonymous>)
    at AdminChallengePage (app/dashboard/admin/challenges/[id]/page.tsx:161:35)
  172 |                         </TableCell>
  173 |                         <TableCell className="text-muted-foreground">
> 174 |                           {format.dateTime(person.since, { dateStyle: "medium" })}
      |                                   ^
  175 |                         </TableCell>
  176 |                       </TableRow>
  177 |                     ))} {
  code: 'FORMATTING_ERROR',
  originalMessage: 'Invalid time value'
}
Error: FORMATTING_ERROR: Invalid time value
    at <unknown> (app/dashboard/admin/challenges/[id]/page.tsx:174:35)
    at AdminChallengePage (app/dashboard/admin/challenges/[id]/page.tsx:161:35)
 GET /dashboard/admin/challenges/30118aea 200 in 139ms (next.js: 63ms)
`;

describe("reading the dev log", () => {
  it("finds the formatting error a 200 hides, with the line that caused it", () => {
    const found = parseErrors(REAL_LOG);

    expect(found).toHaveLength(1);
    // The named code, not the bare "Error:" — that is what the reader searches for.
    expect(found[0].message).toBe("FORMATTING_ERROR: Invalid time value");
    // The app's own file, not the frame inside react that sits above it.
    expect(found[0].location).toBe("app/dashboard/admin/challenges/[id]/page.tsx:174");
    // The expression itself, lifted out of the code frame.
    expect(found[0].frame).toBe('{format.dateTime(person.since, { dateStyle: "medium" })}');
    // One finding, both occurrences counted: a table with 40 rows must not
    // produce 40 findings.
    expect(found[0].count).toBe(2);
  });

  it("stays quiet about a healthy log", () => {
    // Everything here is normal dev-server chatter, and the dev-login banner is
    // the one that would be easiest to mistake for a problem.
    const healthy = REAL_LOG.slice(0, REAL_LOG.indexOf("Error:"));
    expect(parseErrors(healthy)).toEqual([]);
  });

  it("does not read a request line as an error just because a URL has a colon", () => {
    expect(parseErrors(" GET /dashboard/admin/users/1:2:3 200 in 12ms\n")).toEqual([]);
  });

  it("finds an unhandled rejection and a hydration mismatch", () => {
    const log = `Error: Hydration failed because the server rendered text didn't match
    at throwOnHydrationMismatch (app/dashboard/page.tsx:22:9)
unhandledRejection: TypeError: Cannot read properties of null
    at spend (lib/tokens/spend.ts:88:3)
`;
    const messages = parseErrors(log).map((finding) => finding.message);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatch(/Hydration failed/);
    expect(messages[1]).toMatch(/unhandledRejection/);
  });

  it("finds an error the BROWSER reported, not only the server's own", () => {
    // Next forwards a browser error into the dev log with a `[browser]` prefix.
    // For as long as the patterns only matched lines beginning with `Error`,
    // this command answered "✓ No errors in the log." while the log held this.
    // Captured verbatim from the failure that produced story 4.3.
    const log = ` GET /login 200 in 454ms (next.js: 402ms, application-code: 52ms)
[browser] Uncaught Error: An unexpected response was received from the server.
    at LoginPage (app/login/page.tsx:121:9)
  119 |         )}
  120 |
> 121 |         <SignInForm
      |         ^
  122 |           mailConfigured={emailEnabled}
`;
    const found = parseErrors(log);

    expect(found).toHaveLength(1);
    // `[browser]` names where it was raised and is stripped like `[intl]`;
    // everything the browser actually said is kept.
    expect(found[0].message).toBe(
      "Uncaught Error: An unexpected response was received from the server.",
    );
    expect(found[0].location).toBe("app/login/page.tsx:121");
  });

  it("finds a browser promise rejection — the async half of the same class", () => {
    // `Uncaught (in promise) …` is how the browser reports a rejection nobody
    // caught; Next forwards it under the same `[browser]` prefix. For as long
    // as the pattern required `Error` right after `Uncaught`, this variant —
    // the common one in fetch-heavy client code — stayed invisible.
    const log = `[browser] Uncaught (in promise) TypeError: Failed to fetch
    at loadReport (app/dashboard/report/ui.tsx:41:11)
`;
    const found = parseErrors(log);

    expect(found).toHaveLength(1);
    expect(found[0].message).toBe("Uncaught (in promise) TypeError: Failed to fetch");
    expect(found[0].location).toBe("app/dashboard/report/ui.tsx:41");
  });

  // ── A scheduled job that fell over ──────────────────────────────────────
  //
  // 🚨 The class this command missed entirely, and the one it can least afford
  // to: a page that breaks still answers 200, so a status code at least
  // EXISTS to be checked. A job has none. Its log line is its only signal, and
  // every one of these came back with 0 findings while the app was visibly
  // broken.
  //
  // All three blocks below are verbatim from a run of this template with a
  // throw planted in `prune-ipn-log` — not written by hand from the format
  // string, because what the parser sees is what `console.error` MADE of it.
  describe("a scheduled job that failed", () => {
    it("finds the job that threw, and names the line in jobs.ts", () => {
      const log = ` GET / 200 in 833ms (next.js: 91ms, proxy.ts: 106ms)
[cron] prune-ipn-log FAILED after 0ms: Error: A81 planted failure: the retention sweep could not run
    at Object.run (lib/cron/jobs.ts:140:13)
    at runOne (lib/cron/run.ts:113:30)
    at async handle (app/api/cron/route.ts:66:20)
  138 |     async run({ now, settings }) {
  139 |       const retentionDays = days(settings, IPN_LOG_RETENTION_DAYS);
> 140 |       throw new Error("A81 planted failure: the retention sweep could not run");
`;
      const found = parseErrors(log);

      expect(found).toHaveLength(1);
      // The prefix STAYS. `[intl]` and `[browser]` say where an error was
      // raised and are stripped; `[cron]` says which subsystem is broken, and
      // the job id after it is the first thing the operator needs.
      expect(found[0].message).toContain("[cron] prune-ipn-log FAILED");
      expect(found[0].location).toBe("lib/cron/jobs.ts:140");
    });

    it("finds the scheduler's own tick, which never reaches a job at all", () => {
      const log = `[cron] tick failed: Error: A81 planted: the tick itself fell over
    at Timeout.tick [as _onTimeout] (lib/cron/scheduler.ts:47:7)
`;
      const found = parseErrors(log);

      expect(found).toHaveLength(1);
      expect(found[0].message).toContain("[cron] tick failed");
      expect(found[0].location).toBe("lib/cron/scheduler.ts:47");
    });

    it("finds the bookkeeping failing, which leaves the lock behind", () => {
      const log = `[cron] could not record the outcome of prune-ipn-log: Error: A81 planted: the bookkeeping UPDATE failed
    at finish (lib/cron/run.ts:80:11)
`;
      expect(parseErrors(log)[0]?.location).toBe("lib/cron/run.ts:80");
    });

    it("stays quiet about a job that WORKED, however loudly it says so", () => {
      // 🚨 The counter-probe that decides whether the widening was worth having.
      // `console.log` and `console.error` wear the same prefix once both are in
      // one stream, so "it begins with [cron]" can never be the test — and a
      // parser that flagged these would flag nine lines on every healthy app.
      const healthy = `[cron] prune-ai-usage ok in 2ms — 0 row(s) older than 12 month(s) deleted
[cron] check-advisories ok in 2825ms — 2 of 10 rung(s) answered — 0 critical, 0 high
[cron] ops-watchdog ok in 6ms — nothing open — 4 check(s) ran, 0 could not be checked
[api] rejected a key from 10.0.0.1: unknown key
`;
      expect(parseErrors(healthy)).toEqual([]);
    });

    it("counts a job failing every minute as ONE finding, not one per run", () => {
      // Measured on a real one-minute schedule: three failures, three findings,
      // identical but for the milliseconds. The window holds 500 lines, so a job
      // broken overnight is a page of them — the wall this parser must not open
      // with, arriving through the fix rather than in spite of it.
      const log = `[cron] prune-ipn-log FAILED after 3ms: Error: the retention sweep could not run
    at Object.run (lib/cron/jobs.ts:141:13)
[cron] prune-ipn-log FAILED after 5ms: Error: the retention sweep could not run
    at Object.run (lib/cron/jobs.ts:141:13)
[cron] prune-ipn-log FAILED after 4ms: Error: the retention sweep could not run
    at Object.run (lib/cron/jobs.ts:141:13)
`;
      const found = parseErrors(log);

      expect(found).toHaveLength(1);
      expect(found[0].count).toBe(3);
      // The one shown is the first, verbatim — no invented "Nms" in the output.
      expect(found[0].message).toContain("FAILED after 3ms");
    });

    it("keeps two errors at two lines of one file apart", () => {
      // The other half of the rule above: numbers stop distinguishing the
      // MESSAGE, and the LOCATION still distinguishes everything.
      const log = `[media] could not derive the 320px variant: Error: sharp failed
    at variants (lib/media/variants.ts:88:5)
[media] could not derive the 640px variant: Error: sharp failed
    at variants (lib/media/variants.ts:104:5)
`;
      expect(parseErrors(log)).toHaveLength(2);
    });

    it("is not a cron rule — every prefix in the tree goes the same way", () => {
      // 🚨 28 prefixes exist in this tree and the parser knew two of them, both
      // foreign. Fixing `[cron]` alone would be the same defect a year later
      // with a different prefix, so the pattern takes any prefix and requires
      // the ERROR SHAPE instead.
      const log = `[ipn] could not arm auto top-up: TypeError: Cannot read properties of null
    at arm (lib/digistore/payment-event.ts:210:7)
[chat] the model call failed: Error: 429 rate limited
    at call (lib/ai/chat-endpoint.ts:88:9)
[ops] the job table could not be read: Error: connection terminated
    at read (lib/ops/watchdog.ts:41:3)
`;
      expect(parseErrors(log).map((f) => f.location)).toEqual([
        "lib/digistore/payment-event.ts:210",
        "lib/ai/chat-endpoint.ts:88",
        "lib/ops/watchdog.ts:41",
      ]);
    });
  });

  it("keeps two different errors in the same file apart", () => {
    const log = `Error: MISSING_MESSAGE: Could not resolve \`admin.title\`
    at AdminPage (app/dashboard/admin/page.tsx:10:5)
Error: FORMATTING_ERROR: Invalid time value
    at AdminPage (app/dashboard/admin/page.tsx:41:9)
`;
    expect(parseErrors(log).map((finding) => finding.message)).toEqual([
      "MISSING_MESSAGE: Could not resolve `admin.title`",
      "FORMATTING_ERROR: Invalid time value",
    ]);
  });
});
