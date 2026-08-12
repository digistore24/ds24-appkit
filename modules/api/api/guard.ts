// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The one self-guarding entrance every `/api/v1` handler walks through.
//
// ⚠️ `proxy.ts` matches `/dashboard` and nothing else, so everything under
// `app/api/` is PUBLIC until it protects itself. For the v1 surface that
// protection is THIS function, called as the first line of every handler —
// `modules/api/routes/guard-presence.test.ts` fails the build on a handler that
// forgot. The order of the checks is not cosmetic; each is cheaper than the
// one after it, and the ones that touch the database come after the ones that
// do not:
//
//   right origin?  →  feature on?  →  under the failed-auth limit?
//                  →  valid key of the API audience?  →  under the call limit?
//                  →  plan held?  →  scope allows it?  →  run the handler
//
// Every "no key" answers ONE identical 401 — unknown, expired, revoked and
// blocked are distinguished in the server log only. Telling the caller which
// would turn the endpoint into an oracle for whether a key exists.
import { APP_NAME } from "@/lib/app";
import { bearerFrom, callerKey, originAllowed } from "@/modules/api/keys/http";
import { authenticate } from "@/modules/api/keys/keys";
import { mayRun, type Scope } from "@/modules/api/keys/rules";
import { apiConfig, isApiEnabled } from "@/modules/api/api/config";
import {
  API_AUTH_FAIL_BUCKET,
  API_AUTH_FAIL_LIMIT,
  API_CALL_LIMIT,
  API_RATE_BUCKET,
  apiError,
} from "@/modules/api/api/rules";
import { hasPlan } from "@/lib/entitlements/manage";
import { isLimited, record } from "@/lib/rate-limit";

/** What a handler gets: the caller, proven — or the response to return. */
export type Guarded =
  | { ok: true; memberId: string; keyId: string; scope: Scope; role: string }
  | { ok: false; response: Response };

function unauthorized(): Response {
  return apiError("unauthorized", "A valid API key is required.", {
    "www-authenticate": `Bearer realm="${APP_NAME} API", error="invalid_token"`,
  });
}

/**
 * Authenticates one request against the v1 surface.
 *
 * `opts.scope: "write"` marks a handler that CHANGES something — it refuses a
 * read-only key. The refusal lives here, in the call path, for the same
 * reason `runTool` checks scope on the call and not in the tool listing
 * (lib/ai/run-tool.ts): hiding an endpoint is cosmetics, the refusal has to
 * be in the call.
 *
 * The member id in the result is bound to the key by `authenticate()` — no
 * handler ever reads one from a query string or body, which is what makes an
 * IDOR impossible here rather than merely unlikely (the same guarantee
 * `spendTokens` gives a Server Action).
 */
export async function guardApi(
  request: Request,
  opts: { scope?: "write" } = {},
): Promise<Guarded> {
  // 1. DNS-rebinding guard. First because it is a string comparison and
  //    because a request from the wrong place should not reach the key lookup.
  if (!originAllowed(request.headers.get("origin"))) {
    return { ok: false, response: apiError("originForbidden", "Origin not allowed.") };
  }

  // 2. Is the feature on at all? 404, because OFF is the shipped state — an
  //    app that never decided to offer an API answers as if the path did not
  //    exist.
  if (!isApiEnabled()) {
    return { ok: false, response: apiError("apiDisabled", "This app does not offer an HTTP API.") };
  }

  // 3. Who is asking. Metered by origin BEFORE the lookup, so a script trying
  //    keys costs itself rather than the database.
  const caller = callerKey(request);
  if (isLimited(API_AUTH_FAIL_BUCKET, caller, API_AUTH_FAIL_LIMIT)) {
    return { ok: false, response: unauthorized() };
  }

  const bearer = bearerFrom(request);
  if (!bearer) {
    record(API_AUTH_FAIL_BUCKET, caller, API_AUTH_FAIL_LIMIT);
    return { ok: false, response: unauthorized() };
  }

  const auth = await authenticate(bearer, "api");
  if (!auth.ok) {
    record(API_AUTH_FAIL_BUCKET, caller, API_AUTH_FAIL_LIMIT);
    // Precise in the log, vague to the caller — see the header.
    console.warn(`[api] rejected a key from ${caller}: ${auth.reason}`);
    return { ok: false, response: unauthorized() };
  }

  // 4. The runaway brake, per member across all their keys.
  if (isLimited(API_RATE_BUCKET, auth.memberId, API_CALL_LIMIT)) {
    return {
      ok: false,
      response: apiError("rateLimited", "Too many requests. Try again in a minute.", {
        "retry-after": "60",
      }),
    };
  }
  record(API_RATE_BUCKET, auth.memberId, API_CALL_LIMIT);

  // 5. May THIS member use the API at all? `hasPlan` reads `grants` — never a
  //    billing table. `requiresPlan: null` means every member may.
  const config = apiConfig();
  if (config.requiresPlan && !(await hasPlan(auth.memberId, config.requiresPlan))) {
    return {
      ok: false,
      response: apiError("planRequired", "This account's plan does not include the API."),
    };
  }

  // 6. THE scope check for writing handlers.
  if (!mayRun(auth.scope, opts.scope !== "write")) {
    return {
      ok: false,
      response: apiError(
        "scopeReadOnly",
        "This API key is read-only, and this endpoint changes data. " +
          "Create a key with write access in the app under Account if this is intended.",
      ),
    };
  }

  return {
    ok: true,
    memberId: auth.memberId,
    keyId: auth.keyId,
    scope: auth.scope,
    role: auth.role,
  };
}
