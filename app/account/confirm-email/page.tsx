// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight, CircleCheck, TriangleAlert } from "lucide-react";

import { confirmEmailChange } from "@/lib/email-change/manage";
import { EmailChangeError } from "@/lib/email-change/rules";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent } from "@/components/ui/card";
import { APP_NAME } from "@/lib/app";
import { ThemeToggle } from "@/components/theme-toggle";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";

export async function generateMetadata() {
  const t = await getTranslations("confirmEmail");
  return { title: t("title") };
}

// PUBLIC BY DESIGN — and this is the one deliberate decision on the page.
//
// `proxy.ts` guards `/dashboard/:path*`; this route sits outside it, so no
// session is required. That is not an oversight to be tightened later: the mail
// lands in the NEW mailbox, which is routinely open on a different device from
// the one the request was made on — a phone, a work machine, somebody's laptop.
// Demanding a session here would strand exactly the person the feature exists
// for. The token IS the authentication, it is single-use, it expires, and it
// was sent to the address it moves the account to.
//
// A GET that changes something, which normally deserves a hard look. Here it is
// right: a mail scanner that follows the link completes a change the Member
// themselves asked for, to a mailbox they demonstrably control. Nothing is lost
// by it happening a minute early, and the alternative — an extra button —
// would cost every honest user a click to defend against nothing.
export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const t = await getTranslations("confirmEmail");
  const tErrors = await getTranslations("errors");

  let heading = t("successTitle");
  let body = "";
  let ok = true;

  if (!token) {
    ok = false;
    heading = t("failedTitle");
    body = tErrors("changeNotFound");
  } else {
    try {
      const result = await confirmEmailChange(token);

      if (result.applied) {
        body = t("successBody", { email: result.newEmail });

        // Purchases made under the new address, before this person had an
        // account there. Proving control of an address is proving control of
        // it — the same claim that runs at first sign-in (auth.ts), for the
        // same reason.
        //
        // Wrapped, and the failure is swallowed on purpose: the address HAS
        // moved by now. A throw here would show a red page for a change that
        // succeeded, and the claim retries by itself at the Member's next
        // sign-in.
        try {
          const { claimOrdersFor } = await import("@/lib/digistore/claim");
          const claim = await claimOrdersFor(result.memberId, result.newEmail);
          if (claim.attributed || claim.credited || claim.granted) {
            console.info(
              `[email-change] member=${result.memberId} claimed on confirm — attributed=${claim.attributed} credited=${claim.credited} granted=${claim.granted}`,
            );
          }
        } catch (error) {
          console.error(
            `[email-change] claim FAILED for member=${result.memberId} — they may have paid under ${result.newEmail} and received nothing:`,
            error,
          );
        }

        // The warning to the address the account just LEFT. If this move was
        // not the owner's doing, this mail is the only way they will ever find
        // out — and the only reason they can still reach the Operator in time.
        // It must never be able to undo the change that has already happened.
        try {
          const { sendCredentialChangeEmail, isEmailLoginEnabled } =
            await import("@/lib/email");
          if (result.oldEmail && isEmailLoginEnabled()) {
            await sendCredentialChangeEmail(
              result.oldEmail,
              "emailChanged",
              new Date(),
              result.newEmail,
            );
          }
        } catch (error) {
          console.error(
            `[email-change] notice to the old address could not be sent:`,
            error,
          );
        }
      } else {
        // Followed twice, or a scanner got there first. Nothing to do, and
        // nothing that deserves a red page.
        body = t("alreadyBody", { email: result.newEmail });
      }
    } catch (error) {
      ok = false;
      heading = t("failedTitle");
      body =
        error instanceof EmailChangeError
          ? tErrors(error.code)
          : tErrors("unknown");
      if (!(error instanceof EmailChangeError)) {
        console.error("[email-change] unexpected error on confirm:", error);
      }
    }
  }

  return (
    <main className="flex min-h-screen flex-col">
      <div className="flex items-center justify-end gap-2 p-4">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 p-6 pb-24">
        <div className="text-center">
          <BrandMark appName={APP_NAME} size="lg" className="mx-auto mb-5" />
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
        </div>

        {/* The same raised surface the sign-in wears, and — since `cn()` learnt
            the shorthand in lib/utils.ts — with no `!` on it; app/login/ui.tsx
            carries the whole argument above its own <Card>. The four pages on
            this frame get ONE face; two of them would otherwise differ only
            because one happened to be edited. */}
        <Card className="shadow-(--elevation-overlay)">
          <CardContent className="flex flex-col gap-4">
            <Callout variant={ok ? "success" : "danger"} title={heading}>
              {body}
            </Callout>

            {!ok && (
              <p className="text-muted-foreground text-sm">{t("failedHint")}</p>
            )}

            <Button asChild className="w-full">
              <Link href={ok ? "/dashboard/account" : "/login"}>
                {ok ? (
                  <CircleCheck aria-hidden />
                ) : (
                  <TriangleAlert aria-hidden />
                )}
                {ok ? t("ctaAccount") : t("ctaLogin")}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
