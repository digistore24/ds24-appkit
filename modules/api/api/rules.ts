// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The HTTP API's decisions, as pure values and one response builder.
//
// LANGUAGE: the API's caller is a PROGRAM — the customer's mobile app — so its
// error codes are English and stable, the opposite of every member-facing
// rules layer. They are deliberately NOT
// registered in `i18n/messages.test.ts`: that registry is for codes a person
// reads on a page; these travel in a JSON body a client switches on.
//
// ── The envelope ────────────────────────────────────────────────────────────
// Every error is `{ "error": "<code>", "detail": "<sentence>" }` — the code is
// the contract (a client matches on it), the sentence is a courtesy for the
// developer reading a network tab and may change wording at any time. Success
// bodies are plain JSON with no wrapper. See `docs/api.md`.
import type { Limit } from "@/lib/rate-limit";

// ── Error codes ─────────────────────────────────────────────────────────────

/** The stable vocabulary a client may match on. Append, never rename. */
export const API_ERROR_CODES = [
  "apiDisabled",
  "badRequest",
  "forbidden",
  "internal",
  "notFound",
  "originForbidden",
  "planRequired",
  "rateLimited",
  "scopeReadOnly",
  "unauthorized",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

const STATUS_FOR: Record<ApiErrorCode, number> = {
  apiDisabled: 404,
  badRequest: 400,
  forbidden: 403,
  internal: 500,
  notFound: 404,
  originForbidden: 403,
  planRequired: 403,
  rateLimited: 429,
  scopeReadOnly: 403,
  unauthorized: 401,
};

/**
 * The one way an error leaves a v1 handler.
 *
 * The status is derived from the code rather than passed beside it — two
 * handlers answering the same code with different statuses would be two
 * contracts wearing one name. `headers` exists for the two cases that need
 * one: `retry-after` on 429 and `www-authenticate` on 401.
 */
export function apiError(
  code: ApiErrorCode,
  detail?: string,
  headers: Record<string, string> = {},
): Response {
  return Response.json(
    detail ? { error: code, detail } : { error: code },
    {
      status: STATUS_FOR[code],
      headers: { "cache-control": "no-store", ...headers },
    },
  );
}

/** Success helper — plain JSON, no wrapper, never cached. */
export function apiJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

// ── Rate limits ─────────────────────────────────────────────────────────────
//
// ⚠️ `lib/rate-limit.ts` counts in process memory: behind a load balancer
// every limit below multiplies by the number of instances. Documented and
// accepted — the same trade the sign-in limits already make.

/** Bucket for successful calls, keyed by member id. */
export const API_RATE_BUCKET = "api";

/**
 * Calls one member may make in a minute, across all their keys.
 *
 * Keyed by MEMBER and not by key, on purpose: metering per key would let
 * somebody multiply their own ceiling by creating more of them. A mobile app
 * loads a screen with a handful of requests, so this is well above a human's
 * pace — a runaway brake, not a pricing lever.
 */
export const API_CALL_LIMIT: Limit = { max: 120, windowMs: 60_000 };

/**
 * Failed authentications tolerated from one origin in a quarter hour.
 *
 * Keyed by origin rather than by key: a wrong key has no member to meter
 * against, and the thing worth stopping is somebody trying many keys, which
 * the per-key view cannot see. Same shape as the password sprint limit in
 * `lib/credentials/rules.ts`.
 */
export const API_AUTH_FAIL_BUCKET = "api-auth";
export const API_AUTH_FAIL_LIMIT: Limit = { max: 30, windowMs: 15 * 60_000 };

/**
 * Sign-in→token mints tolerated from one origin in a quarter hour.
 *
 * On top of the per-address sign-in limits inside `verifyPasswordLogin()`:
 * those meter guesses against ONE account, this bounds the minting endpoint
 * itself — a credential factory deserves a narrower door than a read.
 */
export const TOKEN_MINT_BUCKET = "api-token-mint";
export const TOKEN_MINT_LIMIT: Limit = { max: 10, windowMs: 15 * 60_000 };
