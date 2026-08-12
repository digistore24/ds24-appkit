// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Who may read this app's own error window, and what everybody else gets.
//
// 🚨 **Every refusal is a 404 with an empty body — all of them, the same one.**
// No `Authorization` header, a malformed one, a wrong secret, no
// `DIAGNOSTICS_SECRET` configured at all, or a caller the meter has had enough
// of: one answer, byte-identical to `setupError("setupDisabled")` and identical
// to what a route that was never built answers. No 401, no 503, no
// `WWW-Authenticate`, no body saying a diagnostics surface exists here.
//
// The shipped state is ABSENT: `.env.example` carries the variable commented
// out, so a fresh app has no secret and this endpoint is indistinguishable from
// one that does not exist.
//
// ⚠️ `app/api/cron/route.ts` answers **503** when its secret is unset, so an
// operator can tell "never configured" from "wrong secret". That is right
// there and wrong here: this surface's whole claim is that a stranger cannot
// learn it exists. The operator gets the distinction from the COMMAND, on their
// own machine, where they are already authenticated by having a shell — the
// same trade `setupOffReason()` makes in `lib/setup/config.ts`.
//
// ── It reaches no database, and that is a requirement, not a happy accident ──
//
// An unreachable Postgres is one of the failures this endpoint exists to
// report (`ECONNREFUSED|ENOTFOUND` is a `HINTS` entry in
// `lib/diagnostics/parse.mjs`). A credential looked up in a table — the way
// `guardSetup()` authenticates — would make the read unavailable at exactly the
// moment it is wanted. So: an environment variable, compared in constant time,
// and `app/api/diagnostics/no-db.test.ts` walks this file's transitive static
// import closure and fails the build on `@/db`, `drizzle-orm` or any driver.
//
// `lib/setup/rules.ts` imports `node:crypto` and two `import type`s;
// `lib/rate-limit.ts` imports nothing at all. Measured, not assumed — and the
// no-db test is what keeps it measured.

import { timingSafeEqual } from "node:crypto";

import { bearerFrom, callerKey } from "@/lib/setup/rules";
import { isLimited, record } from "@/lib/rate-limit";

/**
 * The same numbers `lib/setup/guard.ts` uses for its auth-failure meter: a
 * credential surface deserves a narrower door than a read.
 */
const AUTH_FAIL_LIMIT = { max: 20, windowMs: 15 * 60_000 };
const AUTH_BUCKET = "diagnostics:authfail";

/** One refusal, for every reason. */
function refuse(): Response {
  return new Response(null, { status: 404 });
}

/**
 * `null` means proceed; a `Response` is the refusal.
 *
 * The ORDER is the control, not tidiness — the same argument
 * `surfaceOffResponse()` makes in `lib/setup/dispatch.ts`. The unset-secret
 * branch is first, before a header is parsed, so a stranger cannot get a
 * different answer out of a malformed request than out of a well-formed one.
 */
export function guardDiagnostics(request: Request): Response | null {
  const secret = process.env.DIAGNOSTICS_SECRET;
  if (!secret) return refuse();

  const caller = callerKey(request);
  // A rate-limited caller gets the 404 too. A 429 would say out loud that there
  // is something here worth metering.
  if (isLimited(AUTH_BUCKET, caller, AUTH_FAIL_LIMIT)) return refuse();

  const offered = bearerFrom(request.headers.get("authorization"));
  if (!offered) {
    record(AUTH_BUCKET, caller, AUTH_FAIL_LIMIT);
    return refuse();
  }

  // Constant-time compare, with the length guard in front — `timingSafeEqual`
  // THROWS on mismatched lengths rather than returning false.
  const a = Buffer.from(offered);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    record(AUTH_BUCKET, caller, AUTH_FAIL_LIMIT);
    return refuse();
  }

  return null;
}
