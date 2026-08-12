// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// The sign-in dialog — ONE form, two steps.
//
// Step 1 asks for the address. What step 2 then asks for depends on the address:
// a password field if it has a password, otherwise nothing at all, because the
// link is already in the post (or, in demo mode, the person is already in).
// The branch itself is `routeForSignIn` in lib/auth/sign-in-route.ts; this file
// only renders its outcome.
//
// ⚠️ THIS IS THE ENUMERATION ORACLE, and it is one on purpose. A password field
// appearing means "this address has a password", and anyone can type any
// address. What softens it — and what must stay true if this is ever
// rearranged — is that an UNKNOWN address takes the same branch as a known one
// with no password: both get a link. So the dialog answers "has a password",
// never "has an account". The rate limits behind the lookup are the other half
// of that decision (LOOKUP_LIMIT in lib/credentials/rules.ts).
//
// BOUNDARY: nothing server-side is imported here — not `@/auth`, not
// `@/lib/email`, not `@/lib/credentials/*`. This file ends up in the browser
// bundle, and `docs/auth-setup.md` records mail delivery being dragged into one
// exactly this way. Everything happens in actions.ts.

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";

import { signInAction } from "./actions";
import { INITIAL_SIGN_IN_STATE } from "./state";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SignInForm({
  mailConfigured,
  demoLogin,
  demoEmail,
}: {
  /** isEmailLoginEnabled() — decides whether a link can be offered at all. */
  mailConfigured: boolean;
  /** isDevLoginActive() — the DEV-only bypass. */
  demoLogin: boolean;
  /** The address suggested in demo mode, or null. Display only. */
  demoEmail: string | null;
}) {
  const t = useTranslations("login");
  const [state, formAction, pending] = useActionState(
    signInAction,
    INITIAL_SIGN_IN_STATE,
  );

  // Controlled, so the address survives every refusal without a round trip
  // through the URL — and so it is the NORMALISED one the server echoed back
  // that gets resubmitted on step 2.
  const [email, setEmail] = useState(demoEmail ?? "");

  // "Use a different address" is a purely local move — no server call, nothing
  // to look up. It is cleared whenever the server answers, so the next real
  // outcome always wins over it.
  const [restarted, setRestarted] = useState(false);

  // Adjusted DURING RENDER rather than in an effect, which is React's own
  // recipe for "reset some state when a prop changes" — an effect here would
  // render the stale address once, then again with the right one, and the lint
  // rule that flags it is right to. The state OBJECT's identity is the signal:
  // useActionState hands back a new one exactly when the server has answered.
  const [answered, setAnswered] = useState(state);
  if (answered !== state) {
    setAnswered(state);
    if (state.email) setEmail(state.email);
    setRestarted(false);
  }

  const step = restarted ? "email" : state.step;

  return (
    // The sign-in sits on a raised surface, and the elevation is the whole
    // mechanism — because on this page a surface is all there is.
    //
    // 🚨 In LIGHT mode `--background`, `--card` and `--popover` are the same
    // colour: `hsl(0 0% 100%)`, all three. A white card on a white page has a
    // contrast ratio of exactly 1.00 against it, so "put the form on a card"
    // buys nothing there — only in dark mode, where app/globals.css lifts
    // `--card` a shade above the page on purpose. The elevation dial is what
    // works in BOTH, so it carries this alone.
    //
    // `overlay` and not `raised`: `raised` is the step every <Input>, <Switch>
    // and <Checkbox> wears (`--shadow-xs`), tuned to be calm at that size, and
    // in light mode it is a 6 %-alpha hairline. On a page where the card IS the
    // page it reads as nothing. `overlay` is 18 % at 24 px in light, and in
    // dark it additionally carries the light rim that app/globals.css says is
    // the only construction a near-black page can actually show.
    //
    // 🚨 And it needs NO `!` — which is worth a paragraph, because it used to.
    // <Card> carries `shadow-sm` in its own class list, and tailwind-merge
    // 2.6.1 does not know Tailwind v4's `(--var)` shorthand: it kept both
    // classes instead of resolving them, and `.shadow-sm` is emitted last, so
    // this line rendered `raised` and looked applied. That was a silent no-op —
    // it compiled, it type-checked, the page answered 200 — and it is fixed at
    // the cause in `lib/utils.ts`, where `cn()` is now an `extendTailwindMerge`
    // that teaches the merger the shorthand. `lib/utils.test.ts` is the needle;
    // do not put the `!` back to "make sure". An `!important` here would beat
    // every later override too — a variant, a `shadow-none` from a caller — and
    // the trailing `!` is itself a form tailwind-merge 2.6.1 cannot parse, so
    // it would keep a dead `shadow-sm` in the DOM beside this one.
    //
    // The bracketed arbitrary form would resolve through tailwind-merge as
    // well, and is still the wrong answer: `node run.mjs ux-check` rejects it,
    // because an arbitrary shadow is a depth nobody chose.
    //
    // ⚠️ And that form is not written out anywhere above ON PURPOSE. Tailwind
    // v4 scans this file as RAW TEXT — it does not know what a comment is — so
    // a shadow utility with square brackets and an ellipsis inside them,
    // written here to explain why it is wrong, becomes a real class emitting
    // `var(…)`, which is not a custom-property name. The stylesheet then fails
    // to parse and EVERY page in the app answers 500. Measured on this tree,
    // by writing it: eight pages down, `node run.mjs smoke` naming
    // app/globals.css and a line number in generated CSS.
    <Card className="shadow-(--elevation-overlay)">
      <CardContent>
        <form action={formAction} className="flex flex-col gap-3">
          {/* Only ever ONE message here, and it is about what just happened —
              the `?error=` Callout above the card carries the other kind (an
              expired link, a blocked account) and belongs to the page. */}
          {state.error && (
            <Callout
              variant={
                state.error === "noWayIn" || state.error === "tooManyAttempts"
                  ? "warning"
                  : "danger"
              }
              title={t(`${state.error}Title`)}
            >
              {t(`${state.error}Body`)}
            </Callout>
          )}

          {/* Demo mode explains itself before anything is typed. Whoever lands
              here wants to look at the app, not configure a mail transport. */}
          {demoLogin && step === "email" && (
            <Callout variant="warning" title={t("devTitle")}>
              <p>{t("devReason")}</p>
              <p className="mt-2">
                {demoEmail ? t("devHint", { email: demoEmail }) : t("devHintAny")}
              </p>
            </Callout>
          )}

          <Label htmlFor="email">{t("emailLabel")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            autoFocus={step === "email"}
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            // On step 2 the address is settled: it is what the password is
            // about to be checked against. Changing it there would check the
            // password against an address nobody looked up — the way back is
            // the button below, which returns to step 1 honestly.
            readOnly={step === "password"}
            aria-readonly={step === "password"}
          />

          {step === "email" ? (
            <Button type="submit" name="intent" value="lookup" disabled={pending}>
              {t("continueSubmit")}
            </Button>
          ) : (
            <>
              <Label htmlFor="password">{t("passwordLabel")}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoFocus
                autoComplete="current-password"
              />

              <Button type="submit" name="intent" value="password" disabled={pending}>
                {t("submit")}
              </Button>

              {/* NOT a nice-to-have. There is no password reset in this app,
                  and the reason is that the magic link IS the recovery path —
                  so a step that routes an address with a password exclusively
                  to a password field would remove the only way back in for
                  somebody who has forgotten theirs. */}
              {mailConfigured && (
                <Button
                  type="submit"
                  name="intent"
                  value="link"
                  variant="outline"
                  disabled={pending}
                >
                  {t("linkInstead")}
                </Button>
              )}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRestarted(true)}
              >
                {t("changeEmail")}
              </Button>
            </>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
