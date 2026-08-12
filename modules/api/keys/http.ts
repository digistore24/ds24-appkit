// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The HTTP-shaped checks every bearer-authenticated endpoint starts with.
//
// Used by `modules/api/api/guard.ts` — the same three questions in front of every
// bearer surface, so a fix lands once. Pure functions of a request (plus
// `APP_URL`), no database, no side effects.

/**
 * Where a browser is allowed to call a bearer endpoint from.
 *
 * The attack this stops is DNS rebinding: a page on the open internet
 * resolving a name to 127.0.0.1 and then talking to a server on the visitor's
 * own machine. A real native client — typically a mobile app — sends no
 * `Origin` at all, so an absent header is fine; a PRESENT and foreign one is
 * what gets refused. This is deliberately NOT CORS: no
 * `Access-Control-Allow-Origin` is ever emitted, so a browser on another
 * origin cannot read these endpoints — the browser has the cookie surface.
 */
export function originAllowed(origin: string | null): boolean {
  if (!origin) return true;

  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }

  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;

  const configured = process.env.APP_URL?.trim();
  if (!configured) return false;
  try {
    return new URL(configured).hostname === host;
  } catch {
    return false;
  }
}

/** The caller's origin for a failed-auth counter. Behind a proxy, the real one. */
export function callerKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  // The left-most entry is the client; everything after it was added by a hop.
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

/** The bearer value out of an `Authorization` header, or null. */
export function bearerFrom(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme.toLowerCase() !== "bearer") return null;
  const value = rest.join("");
  return value === "" ? null : value;
}
