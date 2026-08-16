// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use server";

// Server actions of the sign-in dialog.
//
// ONE action for all three submits — step 1's lookup, step 2's password, and
// step 2's "mail me a link instead" — chosen by the `intent` field on the button
// that was pressed. One action means one `useActionState` in ui.tsx, which is
// what keeps the typed address alive across a wrong password without ever
// putting it in the URL.
//
// NOTHING HERE IS PROTECTED, and it cannot be: this is the page people reach
// before they have a session. Every guard therefore has to be a rate limit or a
// deliberate silence, never a `requireActiveUser()`.
//
// ⚠️ A "use server" module may export ONLY async functions. The state shape and
// its initial value therefore live in ./state.ts — see the note there; putting
// them here compiles and typechecks and then serves a 500.
import { headers } from "next/headers";

import { AuthError } from "next-auth";

import { signIn } from "@/auth";
import { routeForSignIn } from "@/lib/auth/sign-in-route";
import { originOf } from "@/lib/auth/password-login";
import { isDevLoginActive } from "@/lib/auth/dev-login";
import { isEmailLoginEnabled } from "@/lib/email";
import { addressHasPassword, mayMailSignInLink } from "@/lib/credentials/manage";
import { normaliseEmail } from "@/lib/credentials/rules";
import type { SignInFormState } from "./state";

/** `x-forwarded-for` as the password provider reads it — one reading, not two. */
async function currentOrigin(): Promise<string | null> {
  return originOf({ headers: await headers() });
}

export async function signInAction(
  _previous: SignInFormState,
  formData: FormData,
): Promise<SignInFormState> {
  const email = normaliseEmail(String(formData.get("email") ?? ""));
  const intent = String(formData.get("intent") ?? "lookup");

  if (intent === "password") return submitPassword(email, formData);
  if (intent === "link") return sendLink(email);
  return lookUp(email);
}

/**
 * Step 1. Decides what to ask for next — and the decision itself is the visible
 * thing, so it is metered (see LOOKUP_LIMIT in lib/credentials/rules.ts).
 */
async function lookUp(email: string): Promise<SignInFormState> {
  const lookup = await addressHasPassword(email, await currentOrigin());
  if (!lookup.ok) return { step: "email", email, error: "tooManyAttempts" };

  const route = routeForSignIn({
    hasPassword: lookup.hasPassword,
    demoLogin: isDevLoginActive(),
    mailConfigured: isEmailLoginEnabled(),
  });

  switch (route) {
    case "password":
      return { step: "password", email, error: null };
    case "demo":
      // The bypass. Signing in IS the answer here — there is nothing to prove.
      return handOver(email, () =>
        signIn("dev-login", { email, redirectTo: "/dashboard" }),
      );
    case "link":
      return sendLink(email);
    case "none":
      // No password on this address, no transport to mail a link with, no demo
      // bypass. Saying so is the whole point of having this branch: the form it
      // replaced simply submitted into nothing.
      return { step: "email", email, error: "noWayIn" };
  }
}

/**
 * Step 2's "mail me a link instead" — and step 1's fall-through to it.
 *
 * 🚨 **Metered, and this is the door that used to be open.** `lookUp()` pays
 * LOOKUP_LIMIT for the ANSWER it gives; this path gives no answer, so for a
 * while it paid nothing — and `intent === "link"` reaches it from the form
 * directly, without step 1. Posting that submit in a loop mailed anybody, as
 * often as anybody liked, from the operator's own sending domain. The counter
 * belongs HERE rather than one level down in `signIn`, because both ways in
 * pass through this function and neither reaches the other.
 */
async function sendLink(email: string): Promise<SignInFormState> {
  if (!(await mayMailSignInLink(email, await currentOrigin()))) {
    return { step: "email", email, error: "tooManyLinks" };
  }
  // Auth.js sends the mail and then redirects to its own verify-request page —
  // the same call, and the same outcome, as before this dialog had two steps.
  return handOver(email, () => signIn("email", { email, redirectTo: "/dashboard" }));
}

/**
 * Runs a `signIn` that is expected to REDIRECT, and turns the one thing that
 * can go wrong into a message instead of a stack trace.
 *
 * A successful signIn throws NEXT_REDIRECT — not an AuthError, so it falls
 * through to the rethrow and reaches Next untouched. Only genuine refusals stop
 * here: an unreachable mail transport, or the dev-login provider declining an
 * address it will not accept. Both used to surface as a bare error page.
 */
async function handOver(
  email: string,
  attempt: () => Promise<unknown>,
): Promise<SignInFormState> {
  try {
    await attempt();
  } catch (error) {
    if (error instanceof AuthError) {
      return { step: "email", email, error: "signInFailed" };
    }
    throw error;
  }
  return { step: "email", email, error: null }; // unreachable: signIn redirects
}

async function submitPassword(
  email: string,
  formData: FormData,
): Promise<SignInFormState> {
  const password = String(formData.get("password") ?? "");
  try {
    await signIn("password", { email, password, redirectTo: "/dashboard" });
  } catch (error) {
    // A SUCCESSFUL signIn throws NEXT_REDIRECT, which is not an AuthError and
    // must reach Next untouched. Catching it as a failure is the classic bug
    // on this path.
    if (error instanceof AuthError) {
      // Stays on step 2 WITH the address. The old page redirected to
      // /login?error=… here, which threw the person back to step 1 and made
      // them retype it.
      return { step: "password", email, error: "passwordFailed" };
    }
    throw error;
  }
  return { step: "password", email, error: null }; // unreachable: signIn redirects
}

/** Google is one button and one provider — no steps, no address to look up. */
export async function googleSignInAction(): Promise<void> {
  await signIn("google", { redirectTo: "/dashboard" });
}
