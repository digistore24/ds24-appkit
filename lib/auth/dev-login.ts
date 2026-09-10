// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Development login — signs in without a magic link and without a password.
//
// ============================================================================
// WARNING: this is a deliberate auth bypass. It exists ONLY so you can try out
// your own app before email delivery is set up. If it were active in
// production, anyone could sign in as any user — including as an admin.
//
// It applies exclusively in the DEV environment. That is an allowlist, not a
// blocklist: anything not clearly recognized as development counts as
// production and is refused (see appEnv() in lib/env-guard.ts — a typo in
// APP_ENV lands on "production" there, not on "development").
//
// FOUR independent conditions, all of which must hold:
//   1. APP_ENV resolves to "development" (STAGING and PROD are ruled out)
//   2. NODE_ENV is not "production"  — gone under `next build`/`next start`
//   3. APP_URL points at localhost   — a real deployment is never open
//   4. NO mail transport is configured — as soon as Postmark or SMTP is set
//      up, the bypass disappears automatically
//
// In STAGING/PROD mail sending is mandatory; without it the app does not even
// start (instrumentation.ts → checkEnvironment).
//
// You can always turn it off hard: DEV_LOGIN=off in .env.
// ============================================================================
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";
import { isEmailLoginEnabled } from "@/lib/email";
import { appEnv, isLocalUrl, serverEnv } from "@/lib/env-guard";

export interface DevLoginEnv {
  NODE_ENV?: string;
  APP_ENV?: string;
  APP_URL?: string;
  DEV_LOGIN?: string;
  emailConfigured: boolean;
}

// `isLocalUrl` moved to lib/env-guard.ts — cookie-names.ts had a second copy of
// it and could not import this file (it is loaded edge-side). Re-exported here
// so the three callers that already say `from "@/lib/auth/dev-login"` keep
// working, and so there is exactly one implementation to change.
export { isLocalUrl };

/**
 * The one place that decides whether the development login exists at all.
 * Deliberately a pure function — it is security-critical and is tested on its
 * own in lib/auth/dev-login.test.ts.
 */
export function isDevLoginAllowed(env: DevLoginEnv): boolean {
  if (env.DEV_LOGIN === "off") return false;
  // 🚨 Unset is not DEV. `appEnv(undefined)` says "development" — right for a
  // laptop, wrong for a host that lost its environment, and this is the bypass
  // it would have opened.
  if (!serverEnv(env.APP_ENV)) return false;
  // Allowlist: ONLY the DEV environment. appEnv() classifies anything unknown
  // as "production" — so a typo does not open the bypass.
  if (appEnv(env.APP_ENV) !== "development") return false;
  // Allowlist here too, and it used to be `=== "production"`. Anything that is
  // not literally a development build — an unset NODE_ENV, "prod", "staging" —
  // is now a refusal rather than a pass.
  if (env.NODE_ENV !== "development") return false;
  if (env.emailConfigured) return false;
  if (!isLocalUrl(env.APP_URL)) return false;
  return true;
}

/** Reads the conditions from the actual environment. */
export function isDevLoginActive(): boolean {
  return isDevLoginAllowed({
    NODE_ENV: process.env.NODE_ENV,
    APP_ENV: process.env.APP_ENV,
    APP_URL: process.env.APP_URL,
    DEV_LOGIN: process.env.DEV_LOGIN,
    emailConfigured: isEmailLoginEnabled(),
  });
}

/**
 * The address offered as a suggestion on the sign-in page: preferably the
 * oldest admin, otherwise the oldest user. Returns null while the app has no
 * users — then any address may be used to sign in.
 *
 * For display in demo mode only. No rights depend on it; whoever signs in gets
 * the account's role from the database.
 */
export async function demoLoginSuggestion(): Promise<string | null> {
  if (!isDevLoginActive()) return null;
  try {
    const { db } = await import("@/db");
    const { users } = await import("@/db/schema");
    const { asc, sql } = await import("drizzle-orm");

    const [match] = await db
      .select({ email: users.email })
      .from(users)
      // Admins first, then by age — as a rule that is the account the operator
      // created for themselves with `node run.mjs user-create`.
      .orderBy(sql`case when ${users.role} = 'owner' then 0 else 1 end`, asc(users.createdAt))
      .limit(1);
    return match?.email ?? null;
  } catch {
    // No database reachable (e.g. the container has not started yet) — the
    // sign-in page should not break because of that.
    return null;
  }
}

/**
 * Builds the provider — or null if it is not allowed.
 *
 * The user only enters an email address. If it exists, that account is used
 * (role included); otherwise a new account is created — exactly as with the
 * magic-link sign-in, and with the same role: "member", unless it is the very
 * first account in the app (see lib/users/bootstrap.ts).
 */
export function buildDevLoginProvider(): Provider | null {
  if (!isDevLoginActive()) return null;

  console.warn(
    "\n⚠️  DEVELOPMENT LOGIN ACTIVE — sign-in without password and without magic link.\n" +
      "   Reason: no mail transport configured. Set one up with: node run.mjs mail-setup\n",
  );

  return Credentials({
    id: "dev-login",
    name: "Development login",
    credentials: { email: { label: "Email", type: "email" } },
    async authorize(credentials) {
      // Second check at runtime: if the provider is still called despite a
      // changed environment, this is where it stops.
      if (!isDevLoginActive()) return null;

      const email = String(credentials?.email ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;

      // Load only at runtime — keeps the database out of the edge/client bundle.
      const { db } = await import("@/db");
      const { users } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");

      const [existing] = await db
        .select({ id: users.id, email: users.email, name: users.name, role: users.role })
        .from(users)
        .where(eq(users.email, email));
      if (existing) return existing;

      // The first account on a fresh installation becomes the owner —
      // otherwise whoever creates the app could not reach their own admin
      // area. The rule and its limits live in lib/users/bootstrap.ts.
      const { roleForNewUser } = await import("@/lib/users/bootstrap");

      const [created] = await db
        .insert(users)
        .values({ email, emailVerified: new Date(), role: await roleForNewUser() })
        .returning({ id: users.id, email: users.email, name: users.name, role: users.role });
      return created;
    },
  });
}
