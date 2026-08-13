// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Full Auth.js setup (Node runtime) — with the database adapter.
// Builds on the slim auth.config.ts and adds the Drizzle adapter (users,
// OAuth accounts, email verification tokens) plus the email magic-link
// provider (Postmark/SMTP), which may only run in the Node runtime.
import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import authConfig from "@/auth.config";
import { db } from "@/db";
import { users, accounts, sessions, verificationTokens } from "@/db/schema";
import { buildEmailProvider } from "@/lib/email";
import { buildDevLoginProvider } from "@/lib/auth/dev-login";
import { buildPasswordProvider } from "@/lib/auth/password-login";

const emailProvider = buildEmailProvider();
// Development login: local only, and only as long as NO mail transport is set
// up (the conditions live in lib/auth/dev-login.ts and are tested there).
const devLoginProvider = buildDevLoginProvider();
// Password sign-in: always available, in every environment. It authenticates
// nobody who has not set a password on themselves first, and an account
// without one simply never matches (lib/credentials/manage.ts).
const passwordProvider = buildPasswordProvider();

const providers = [
  ...authConfig.providers,
  ...(emailProvider ? [emailProvider] : []),
  passwordProvider,
  ...(devLoginProvider ? [devLoginProvider] : []),
];

const drizzleAdapter = DrizzleAdapter(db, {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
});

// The magic link and Google create their accounts through the adapter, not
// through a provider — this is the only place where the role of such an
// account can be set while it comes into being. Doing it here rather than
// afterwards is what makes it visible right away: the returned row flows
// straight into the jwt callback (auth.config.ts), so the very first session
// already carries "owner" and the admin area is in the navigation on the first
// page load.
//
// The development login inserts its row itself and asks the same function
// there (lib/auth/dev-login.ts). Both paths, one rule:
// lib/users/bootstrap.ts — first account on a fresh DEV installation, and
// nothing beyond that.
const adapter: typeof drizzleAdapter = {
  ...drizzleAdapter,
  async createUser(data) {
    const { roleForNewUser } = await import("@/lib/users/bootstrap");
    const role = await roleForNewUser();
    // `role` is our own column, not part of Auth.js's AdapterUser — hence the
    // cast. The adapter passes fields it does not know straight into the
    // INSERT and returns the written row, which is precisely what we need.
    return drizzleAdapter.createUser!({ ...data, role } as typeof data);
  },
};

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  ...authConfig,
  adapter,
  providers,
  callbacks: {
    ...authConfig.callbacks,
    // Signing in as a customer, and stepping back out.
    //
    // It lives HERE rather than in auth.config.ts for the same reason `signIn`
    // below does: it needs the database, and auth.config.ts sits in front of
    // every matched request and stays free of it.
    //
    // ⚠️ `trigger === "update"` means somebody POSTed to `/api/auth/session`,
    // and ANY signed-in user can do that. `session` is their request body.
    // Nothing in it is trusted — see the header of lib/impersonation/session.ts,
    // which is where the one line that authorises a rewrite lives. A change
    // here that starts believing the payload is an account-takeover bug, and it
    // will look perfectly ordinary in a diff.
    async jwt({ token, user, trigger, session }) {
      const base = authConfig.callbacks!.jwt!({ token, user }) as typeof token;
      if (trigger !== "update") return base;

      const { applyImpersonationUpdate } = await import(
        "@/lib/impersonation/session"
      );
      return applyImpersonationUpdate(base, session);
    },
    // Blocked accounts do not get in at all — no matter which provider. The
    // check lives here and not in auth.config.ts because it needs the database
    // and auth.config.ts stays free of the database (see there).
    //
    // It only closes the door for NEW sessions. Anyone already inside is
    // thrown out on the next page load (requireActiveUser in lib/authz.ts) —
    // the two together make up the block, see lib/users/blocked.ts.
    async signIn({ user, account, profile, email }) {
      const { signInVerdict, isEmailBlocked, maySignIn } = await import(
        "@/lib/users/blocked"
      );

      // An UNVERIFIED OAuth address is not identity, and Auth.js does not
      // check this for you — it says so in its own docs and leaves it to this
      // callback.
      //
      // Before purchases could be claimed, an unverified address bought an
      // empty account and nothing more. It now buys somebody else's purchase:
      // the claim in `events.signIn` below keys on `user.email`, and account
      // linking cannot save us here because the whole premise of the anonymous
      // checkout is that the buyer has NO account yet — so Auth.js creates one
      // straight from the profile and the claim hands over the order and its
      // tokens.
      if (account?.type === "oauth" || account?.type === "oidc") {
        const verified = (profile as { email_verified?: boolean } | undefined)
          ?.email_verified;
        if (verified !== true) return false;
      }

      // Magic link: when the link is requested the account is not yet fixed,
      // but the address is. Stop here already — otherwise mail goes out to
      // someone whose access is blocked.
      if (email?.verificationRequest) {
        return user.email ? !(await isEmailBlocked(user.email)) : true;
      }

      if (!user.id) return true;

      // An id that resolves to NO ROW means Auth.js is about to create this
      // account — it hands us a freshly minted id when it found nobody by
      // email. Judging that as "blocked" rejected every first-ever sign-in
      // with "account blocked", and only in STAGING/PROD: the development
      // login inserts the row itself before this callback runs, so the bug
      // could not be seen locally.
      const verdict = await signInVerdict(user.id);
      const emailBlocked = user.email
        ? await isEmailBlocked(user.email)
        : false;
      return maySignIn(verdict, emailBlocked);
    },
  },
  events: {
    // Claim purchases made before this person had an account. Runs AFTER the
    // row is persisted (unlike the signIn callback, which sees a throwaway id
    // for a not-yet-created user), on every provider.
    //
    // The try/catch is not padding. This event is awaited after the session
    // cookie is created but before it is returned, and after the magic-link
    // token has already been consumed. A throw here discards the cookie,
    // redirects to the error page and BURNS the link — the buyer would have to
    // request a new one and would get no session. A failed claim must degrade
    // to "not claimed yet, try next sign-in", never to "cannot sign in".
    async signIn({ user }) {
      if (!user?.id) return;
      try {
        const { claimOrdersFor } = await import("@/lib/digistore/claim");
        const r = await claimOrdersFor(user.id, user.email);
        // Money moved on this path and nothing else records that it did. Every
        // write here is fill-only and there is no audit row, so without a log
        // line "why does this account have 5000 tokens?" has no answer.
        if (r.attributed || r.credited || r.granted) {
          console.info(
            `[claim] member=${user.id} attributed=${r.attributed} credited=${r.credited} granted=${r.granted}`,
          );
        }
      } catch (error) {
        // A persistent failure here means a paying customer sees nothing,
        // forever: Digistore24 does not redeliver an acknowledged event and
        // AD-8 rules out a reconciliation job.
        console.error(
          `[claim] FAILED for member=${user.id} — they may have paid and received nothing:`,
          error,
        );
      }
    },
  },
});

declare module "next-auth" {
  interface Session {
    user: {
      /**
       * 🚨 `id` and `role` are REQUIRED, and saying so is not a widening of the
       * claim — it is the claim catching up with the code.
       *
       * Every branch of the `session()` callback in `auth.config.ts` sets both
       * before returning: the impersonating one, the just-ended one, and the
       * ordinary one. There is no path that leaves either open. While they were
       * declared optional the app compensated at the call sites instead —
       * **60 × `session.user.id as string` and 21 × `role as string`** across
       * `app/`, `lib/` and `modules/`, a quarter of every cast in the tree,
       * caused by two question marks.
       *
       * That cost is not only ours. A cast is the shape a customer copies into
       * the first page they write, and it is the shape that stops the compiler
       * saying anything the day a branch really does leave `id` unset.
       *
       * ⚠️ The one place a cast stays is the callback itself — `token.sub as
       * string` — and it belongs there: that is the boundary where an untyped
       * JWT claim becomes this app's own type, asserted once, in the file that
       * knows why.
       */
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: string;
      /**
       * Set while an Operator is signed in as this member — and only then.
       *
       * Its presence is the banner's whole condition, and it is why every page
       * in the app can show one without a database query: the two addresses and
       * the deadline all travel in the session token.
       *
       * ⚠️ `id`, `email` and `role` above describe the MEMBER while this is
       * set. That is deliberate (AD-23) and it is what makes `requireOwner()`
       * refuse everywhere without a single guard being modified. Code that
       * needs to know who is really at the keyboard reads this field.
       */
      impersonation?: {
        /** The record row — see SessionImpersonation in lib/impersonation/claim.ts. */
        id: string;
        operatorEmail: string | null;
        memberEmail: string | null;
        /** Epoch milliseconds. */
        expiresAt: number;
      } | null;
      /**
       * True on the first session read after the thirty minutes ran out, so
       * the app can say so once instead of silently changing who you are.
       */
      impersonationEnded?: boolean;
    };
  }
}
