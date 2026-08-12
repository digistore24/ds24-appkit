// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { auth } from "@/auth";
import { ACCESS_DENIED } from "@/lib/authz";
import { isUserBlocked } from "@/lib/users/blocked";
import { isEmailLoginEnabled } from "@/lib/email";
import { isDevLoginActive, demoLoginSuggestion } from "@/lib/auth/dev-login";
import { APP_NAME } from "@/lib/app";
import { googleSignInAction } from "./actions";
import { SignInForm } from "./ui";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ThemeToggle } from "@/components/theme-toggle";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";

/**
 * What Auth.js calls a rejected Credentials sign-in (`AuthError.type`).
 *
 * The dialog answers a wrong password itself now, on step 2 — so this arrives
 * only if Auth.js redirects here on its own (`pages.error` in auth.config.ts).
 * Kept because that path still exists and a rejected credential must not be
 * described as an expired link.
 */
const CREDENTIALS_FAILED = "CredentialsSignin";

export async function generateMetadata() {
  const t = await getTranslations("login");
  return { title: t("title") };
}

// Sign-in page. ONE dialog, two steps — the address first, then whatever that
// address actually needs to prove. The branch lives in
// lib/auth/sign-in-route.ts, the form in ui.tsx, the submits in actions.ts.
//
// There used to be two cards stacked here: a password form and, whenever the
// development login was active, a second form beside it. Both were correct on
// their own and nothing ever decided they were alternatives, so a demo
// installation showed the visitor two ways in and no way to tell them apart.
//
// `?error=…` comes from two sources, and neither of them is this page's own
// form any more (a wrong password is answered inside the dialog, on step 2,
// with the typed address still in place). What is left arrives from Auth.js
// when a sign-in link is rejected, and from requireActiveUser() (lib/authz.ts)
// when a blocked account opens a protected page.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const session = await auth();

  // Signed in? Then on to the dashboard — UNLESS the account is blocked.
  // Without that exception an endless loop would form: the dashboard sends
  // blocked users back here, and this line would send them straight back.
  // Instead they stay here and see the message below.
  if (session?.user && !(await isUserBlocked(session.user.id as string))) {
    redirect("/dashboard");
  }

  const t = await getTranslations("login");
  const tCommon = await getTranslations("common");
  const emailEnabled = isEmailLoginEnabled();
  // DEV only, and only as long as no mail transport is set up.
  const devLogin = isDevLoginActive();
  const demoEmail = await demoLoginSuggestion();
  const googleEnabled = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );

  return (
    <main className="flex min-h-screen flex-col">
      <div className="flex items-center justify-end gap-2 p-4">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>

      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6 pb-24">
        <div className="text-center">
          <BrandMark appName={APP_NAME} size="lg" className="mx-auto mb-5" />
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm text-balance">
            {t("subtitle")}
          </p>
        </div>

        {/* The message sits ABOVE the form: whoever lands here because their
            account is blocked should read why before trying again. It stays
            put (Callout, not a toast) — it is not an event passing by but a
            state. */}
        {error && (
          <Callout
            variant="danger"
            title={
              error === ACCESS_DENIED
                ? t("blockedTitle")
                : error === CREDENTIALS_FAILED
                  ? t("passwordFailedTitle")
                  : t("errorTitle")
            }
          >
            {error === ACCESS_DENIED
              ? t("blockedBody")
              : error === CREDENTIALS_FAILED
                ? t("passwordFailedBody")
                : t("errorBody")}
          </Callout>
        )}

        <SignInForm
          mailConfigured={emailEnabled}
          demoLogin={devLogin}
          demoEmail={demoEmail}
        />

        {emailEnabled && googleEnabled && (
          <div className="text-muted-foreground flex items-center gap-3 text-xs">
            <span className="bg-border h-px flex-1" />
            {tCommon("or")}
            <span className="bg-border h-px flex-1" />
          </div>
        )}

        {googleEnabled && (
          <form action={googleSignInAction}>
            <Button type="submit" variant="outline" className="w-full">
              {t("google")}
            </Button>
          </form>
        )}

        {!emailEnabled && !googleEnabled && !devLogin && (
          <Callout variant="danger" title={t("missingTitle")}>
            {t.rich("missingBody", {
              code: (chunks) => <code>{chunks}</code>,
            })}
          </Callout>
        )}

        <Button asChild variant="ghost" size="sm" className="mx-auto">
          <Link href="/">
            <ArrowLeft aria-hidden />
            {t("backHome")}
          </Link>
        </Button>
      </div>
    </main>
  );
}
