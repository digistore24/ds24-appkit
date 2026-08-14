// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Slim auth configuration (NO database import, NO nodemailer!).
// Used by proxy.ts (route protection) AND by the full auth.ts.
//
// Since Next 16 the proxy runs in the Node runtime, so this file no longer
// HAS to be edge-safe — it stays that way anyway: it sits in front of every
// matched request, and a database or mail dependency has no business there.
// Only such providers live here. The email magic-link provider
// (Postmark/SMTP) is added in auth.ts (Node runtime) — see lib/email.ts.
//   - email token sign-in (default) → Postmark OR SMTP (setup: docs/auth-setup.md)
//   - Google OAuth (optional)       → GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { devCookies } from "@/lib/auth/cookie-names";
// Pure, database-free, and free of auth.ts — see lib/impersonation/claim.ts.
// It only reads a value out of the signed token, which is exactly what this
// file is allowed to do.
import { impersonationState } from "@/lib/impersonation/claim";
// Pure, zero imports (lib/auth/auth-url.mjs) — edge-safe by construction.
import { applyAuthUrl } from "@/lib/auth/auth-url.mjs";

// 🚨 BEFORE anything else in this file, and before `NextAuth()` anywhere sees
// this config: the origin of every link Auth.js MAILS OUT or redirects to comes
// from `APP_URL`, not from the request.
//
// `trustHost` below stays on and is a different question. This is the one that
// decides what a customer finds in their sign-in mail — behind a PaaS router
// the container's own view of itself is `localhost:8080`, and that is what used
// to be in the mail. The whole reasoning, and why the PWA manifest deliberately
// does the opposite, is in lib/auth/auth-url.mjs.
//
// It sets `AUTH_URL` (the only lever Auth.js offers) and leaves an operator's
// own value alone; `lib/env-guard.ts` refuses to start in STAGING/PROD when
// that value and `APP_URL` disagree.
applyAuthUrl(process.env);

const providers: NextAuthConfig["providers"] = [];

// Custom cookie names locally, so two apps on localhost do not overwrite each
// other's session (see lib/auth/cookie-names.ts).
// Outside of DEV: undefined — then the Auth.js defaults apply.
const cookies = devCookies({
  APP_ENV: process.env.APP_ENV,
  APP_URL: process.env.APP_URL,
  AUTH_SECRET: process.env.AUTH_SECRET,
});

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  );
}

export default {
  providers,
  // Locally the fingerprinted names, elsewhere `undefined` — then Auth.js
  // keeps its own defaults. This line is the whole point of the exercise: as
  // long as it was missing, the names above were computed and thrown away.
  cookies,
  // `error: "/login"` redirects the built-in Auth.js error page to our own
  // sign-in page. Without it, a rejected sign-in (e.g. blocked account →
  // AccessDenied) lands on /api/auth/error — a bare, single-language page with
  // no way back. This way the error arrives as `?error=…` and is shown where
  // you can try again.
  pages: { signIn: "/login", error: "/login" },
  // Sessions as JWTs → the proxy can check without touching the database.
  session: { strategy: "jwt" },
  callbacks: {
    // Route protection (works together with the matcher in proxy.ts).
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      if (path.startsWith("/dashboard")) return Boolean(auth?.user);
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role ?? "member";
      }
      return token;
    },
    // Who the app is talking to — which, while an Operator is signed in as one
    // of their customers, is NOT whoever signed in.
    //
    // Three states, and the expiry is resolved on every read rather than by
    // rewriting the token when the clock passes: Next.js forbids setting a
    // cookie during a server-component render, so there is no moment in a page
    // load at which a rewrite could happen. A stale token is harmless as long as
    // every reader honours the expiry — and every reader goes through here.
    //
    // This stays free of the database, like the rest of this file:
    // `impersonationState()` only reads a value out of the signed token.
    session({ session, token }) {
      if (!session.user) return session;

      const state = impersonationState(token);

      if (state.kind === "running") {
        // The member, with the member's role. Every requireOwner() in the app
        // therefore refuses, with no guard modified to make that true (AD-23).
        session.user.id = token.sub as string;
        session.user.role = (token.role as string) ?? "member";
        session.user.impersonation = {
          id: state.claim.id,
          operatorEmail: state.claim.operatorEmail,
          memberEmail: state.claim.memberEmail ?? (session.user.email ?? null),
          expiresAt: state.claim.expiresAt,
        };
        return session;
      }

      if (state.kind === "expired") {
        // The thirty minutes are up. The Operator is themselves again — from
        // the claim, which is inside a token we signed — and is told once that
        // it ended, because silently swapping the identity under somebody
        // mid-task is the drift the banner exists to prevent, in reverse.
        session.user.id = state.claim.operatorId;
        session.user.role = state.claim.operatorRole;
        // An account without an address is possible here (created by CLI), and
        // showing the member's address next to the Operator's own id would be
        // the one wrong answer — keep whatever was there rather than inventing.
        session.user.email = state.claim.operatorEmail ?? session.user.email;
        session.user.impersonation = null;
        session.user.impersonationEnded = true;
        return session;
      }

      session.user.id = token.sub as string;
      session.user.role = (token.role as string) ?? "member";
      return session;
    },
  },
  // PaaS platforms set the Host header dynamically — prevents the
  // "untrusted host" error.
  //
  // ⚠️ It says which Host values are ACCEPTED, never which one outgoing links
  // carry — that is `AUTH_URL`, set from `APP_URL` at the top of this file. The
  // two were read as one thing once, and the result was a sign-in mail pointing
  // at `localhost:8080` on a perfectly healthy deployment.
  trustHost: true,
} satisfies NextAuthConfig;
