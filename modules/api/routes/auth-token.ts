// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Sign in → API key. The one door a mobile app walks through to get its
// credential; every other v1 endpoint expects the key this one hands out.
//
// ── It guards itself, and differently from the rest ────────────────────────
// `proxy.ts` matches `/dashboard` only, so this route is public until it
// protects itself — but it cannot start with `guardApi()`: its caller has no
// key yet, a key is what it is here to get. Its protection is the password
// check itself, wrapped in three meters:
//
//   right origin?  →  feature on?  →  under the mint limit?
//                  →  password verifies?  →  mint a key
//
// `verifyPasswordLogin()` brings the real sign-in defences with it — the
// per-address sprint limit, the per-origin limit, the timing-equalised
// unknown-address path and the double block check. This route adds only the
// mint meter on top: a credential factory deserves a narrower door than a
// read (`TOKEN_MINT_LIMIT`).
//
// ── One answer to every failure ────────────────────────────────────────────
// Wrong password, unknown address and blocked account all produce the SAME
// 401. This endpoint is a password oracle by construction; the one answer is
// what keeps it from being a useful one. Only "you are rate limited" is
// distinguishable (429) — that mirrors `SignInResult`, whose reasoning is in
// `lib/credentials/manage.ts`.
//
// ── Who cannot use it, and what they do instead ────────────────────────────
// A member without a password (magic-link only) fails here like a wrong
// password. That is documented, not accidental: they mint a key on
// `/dashboard/account` and paste it, or set a password first — both flows the
// app already has. A device-code flow was considered and rejected for v1
// (docs/api.md names the trade).
import { bearerFrom, callerKey, originAllowed } from "@/modules/api/keys/http";
import { createKey } from "@/modules/api/keys/keys";
import {
  ApiKeyError,
  checkKeyName,
  isLifetime,
  isScope,
  type LifetimeDays,
  type Scope,
} from "@/modules/api/keys/rules";
import { isApiEnabled } from "@/modules/api/api/config";
import { TOKEN_MINT_BUCKET, TOKEN_MINT_LIMIT, apiError, apiJson } from "@/modules/api/api/rules";
import { verifyPasswordLogin } from "@/lib/credentials/manage";
import { isLimited, record } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  // 1. DNS-rebinding guard — same first line as every bearer surface.
  if (!originAllowed(request.headers.get("origin"))) {
    return apiError("originForbidden", "Origin not allowed.");
  }

  // 2. Is the feature on? 404, the shipped state — see modules/api/api/guard.ts.
  if (!isApiEnabled()) {
    return apiError("apiDisabled", "This app does not offer an HTTP API.");
  }

  // 3. The mint meter, per origin, counted on EVERY attempt — successful ones
  //    included. Ten fresh credentials a quarter hour is a person setting up
  //    devices; more is a script.
  const caller = callerKey(request);
  if (isLimited(TOKEN_MINT_BUCKET, caller, TOKEN_MINT_LIMIT)) {
    return apiError("rateLimited", "Too many token requests. Try again later.", {
      "retry-after": "900",
    });
  }
  record(TOKEN_MINT_BUCKET, caller, TOKEN_MINT_LIMIT);

  // A bearer on the sign-in route is a client confused about which door this
  // is — refuse loudly rather than silently ignoring a credential.
  if (bearerFrom(request)) {
    return apiError("badRequest", "This endpoint takes email and password, not a bearer key.");
  }

  // 4. The body. Hand predicates, no schema library — the repo's idiom.
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return apiError("badRequest", "Body must be a JSON object.");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return apiError("badRequest", "Body is not valid JSON.");
  }

  const { email, password } = body;
  if (typeof email !== "string" || email.trim() === "" || typeof password !== "string") {
    return apiError("badRequest", '"email" and "password" are required.');
  }

  // Optional fields: absent gets a safe default, PRESENT-but-wrong gets a 400.
  // The caller is a program; a program that sent "scope": "admin" has a bug,
  // and a silent fallback would hide it (the opposite trade from the account
  // page's <select>, whose values a person cannot mistype).
  let scope: Scope = "read";
  if (body.scope !== undefined) {
    if (!isScope(body.scope)) return apiError("badRequest", '"scope" must be "read" or "write".');
    scope = body.scope;
  }

  let lifetimeDays: LifetimeDays = 90;
  if (body.lifetimeDays !== undefined) {
    // `null` is a valid value — "no end date" — and distinct from absent.
    if (!isLifetime(body.lifetimeDays)) {
      return apiError("badRequest", '"lifetimeDays" must be 30, 90, 365 or null.');
    }
    lifetimeDays = body.lifetimeDays;
  }

  let name = `API token ${new Date().toISOString().slice(0, 10)}`;
  if (body.name !== undefined) {
    const checked = checkKeyName(body.name);
    if (!checked.ok) {
      return apiError("badRequest", '"name" must be a non-empty string of at most 60 characters.');
    }
    name = checked.name;
  }

  // 5. The password check — the real authentication, with the real limits.
  const result = await verifyPasswordLogin(email, password, caller);
  if (!result.ok) {
    if (result.rateLimited) {
      return apiError("rateLimited", "Too many attempts. Try again later.", {
        "retry-after": "900",
      });
    }
    // ONE answer — see the header. No www-authenticate: there is no bearer
    // scheme to point at, and naming one would send clients in a circle.
    return apiError("unauthorized", "Sign-in failed.");
  }

  // 6. Mint. The member id comes from the verified sign-in and from nowhere
  //    else — this endpoint takes no member id and never will.
  try {
    const created = await createKey({
      memberId: result.user.id,
      name,
      scope,
      lifetimeDays,
      audience: "api",
    });

    // The secret's only appearance, like the dialog on the account page. A
    // client stores it; there is no way to read it back.
    return apiJson(
      {
        id: created.id,
        name: created.name,
        scope: created.scope,
        expiresAt: created.expiresAt ? created.expiresAt.toISOString() : null,
        secret: created.secret,
      },
      201,
    );
  } catch (error) {
    if (error instanceof ApiKeyError && error.code === "apiTooManyKeys") {
      return apiError(
        "badRequest",
        "This account already holds the maximum number of live API keys. Revoke one in the app under Account.",
      );
    }
    throw error;
  }
}
