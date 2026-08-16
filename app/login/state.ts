// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The shape passed between the sign-in dialog and its server actions.
//
// It lives in a file of its own for a reason that costs an hour to rediscover:
// **a `"use server"` module may export nothing but async functions.** Putting
// the initial state next to the action that consumes it compiles, typechecks
// and passes every test in this repo — and then answers /login with a 500 on
// the first request:
//
//   Error: A "use server" file can only export async functions, found object.
//
// So the constant lives here, actions.ts imports it, and ui.tsx imports it
// without pulling a server module into the browser bundle for a default value.

/** Which half of the dialog is on screen, plus what to say about it. */
export interface SignInFormState {
  step: "email" | "password";
  /**
   * What was typed, normalised. Kept in the STATE rather than in the URL: the
   * obvious alternative — redirect to `/login?email=…` and read it back from
   * searchParams — works, and writes an address into browser history, the
   * Referer header and every access log in front of the app.
   */
  email: string;
  /**
   * A key under `login.*`, or null. Translated in ui.tsx, never in an action.
   *
   * ⚠️ `tooManyAttempts` and `tooManyLinks` are two codes on purpose, not one
   * tidied into the other. The first is about ADDRESSES being checked and its
   * sentence says "wait a few minutes"; the second is about MAIL and its window
   * is an hour. Collapsing them would tell somebody to wait five minutes for a
   * counter that will not move for sixty.
   */
  error:
    | "passwordFailed"
    | "noWayIn"
    | "tooManyAttempts"
    | "tooManyLinks"
    | "signInFailed"
    | null;
}

export const INITIAL_SIGN_IN_STATE: SignInFormState = {
  step: "email",
  email: "",
  error: null,
};
