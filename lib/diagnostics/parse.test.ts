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
