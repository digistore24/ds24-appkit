// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Password sign-in — the optional second door.
//
// Unlike the development login next to it (lib/auth/dev-login.ts), this is NOT
// a bypass and is not restricted to any environment. It authenticates a real
// secret that the account's owner set on themselves, and it exists in DEV,
// STAGING and PROD alike.
//
// Three things it deliberately does NOT do:
//
//   1. It never creates an account. The magic link and OAuth do that (via the
//      adapter in auth.ts); a sign-in path that creates users from a password
//      would let anyone mint accounts at any address they can spell.
//   2. It never says why it refused. Wrong password, no password set, no such
//      account and blocked are one answer — see verifyPasswordLogin().
//   3. It never bypasses the block. The check runs here AND in the signIn
//      callback in auth.ts, on purpose.
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";

import { clientAddress } from "@/lib/setup/rules";

/**
 * Where an attempt came from, for the origin-keyed rate limit.
 *
 * 🚨 **The reading itself is NOT here any more.** It used to be, and it said the
 * app "runs behind a proxy that OVERWRITES it (Railway, Render, Fly all do)" —
 * which was never measured and is false for all three. Checked against the
 * vendors' own words on 2026-09-10; the evidence and the two dials that replace
 * the claim are written out at `clientAddress()` in `lib/setup/rules.ts`, and
 * `docs/DEPLOY.md` carries the per-host table. There were three copies of this
 * reading in the tree, two of them called `callerKey`, and they did not agree
 * with each other — which is how they came to disagree with reality too.
 *
 * What stays true and is the reason this is a MEDIUM and not worse: no decision
 * downstream grants anything. It only withholds. A forgeable key makes the
 * brake useless; it never makes it a way in.
 *
 * This wrapper survives because its two callers hand it different things — an
 * Auth.js request here, a `Headers` object in `app/login/actions.ts` — and
 * because both want `null` rather than the `"unknown"` bucket `callerKey()`
 * falls back to.
 */
export function originOf(request: unknown): string | null {
  const headers = (request as { headers?: Headers } | undefined)?.headers;
  return clientAddress(headers);
}

export function buildPasswordProvider(): Provider {
  return Credentials({
    id: "password",
    name: "Password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials, request) {
      const email = String(credentials?.email ?? "");
      const password = String(credentials?.password ?? "");
      if (!email || !password) return null;

      // Loaded at runtime, as the development login does — keeps the database
      // out of any bundle that only needs the provider's shape.
      const { verifyPasswordLogin } = await import("@/lib/credentials/manage");

      const result = await verifyPasswordLogin(
        email,
        password,
        originOf(request),
      );
      if (!result.ok) {
        // Both "wrong" and "too many attempts" return null. Auth.js turns that
        // into one error on /login, and the message there covers both cases in
        // one sentence rather than telling a stranger which one they hit.
        return null;
      }
      return result.user;
    },
  });
}
