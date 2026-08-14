// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { PartyPopper } from "lucide-react";

import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { OrderProcessing } from "./order-processing";

// Public thank-you page (the thankyou_url target after a purchase) — and a
// ROUTER, not a destination. It polls until the IPN has created the order and
// then sends the buyer where they can actually use what they paid for. No
// sign-in, and — by product decision — no consent prompt.
//
// Three ways out, once the order exists:
//
//   signed in, the order is theirs   → /dashboard, with the confirmation toast
//   signed in, it is somebody else's → stay, offer a link to the dashboard
//   not signed in                    → stay, offer the way in (see below)
//
// The last one is not an oversight to be redirected away: /plans is public and
// buying without an account is a supported path (story 1.6). Such an order
// carries member_id = NULL and is attached at the buyer's first sign-in
// (lib/digistore/claim.ts) — so this page is the only place that can tell them
// what to do next, and it has to name WHICH address to sign in with.
export default async function OptinPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const t = await getTranslations("optin");
  const order = await db.query.orders.findFirst({
    where: eq(orders.ds24OrderId, orderId),
  });

  // Public route (outside the proxy.ts matcher), so this only reads the JWT —
  // it never forces a sign-in.
  const session = await auth();
  const memberId = session?.user?.id;
  const isOwnPurchase =
    order != null && memberId != null && order.memberId === memberId;

  // Outside any try/catch on purpose: redirect() works by throwing, and a
  // catch that swallowed it would leave the buyer on this page for good.
  // The reference travels, never the message — the dashboard looks the order up
  // itself, scoped to the signed-in member (lib/digistore/member-billing.ts).
  if (isOwnPurchase) {
    redirect(`/dashboard?purchase=${encodeURIComponent(orderId)}`);
  }

  const signedIn = Boolean(session?.user);

  return (
    <main className="flex min-h-screen flex-col">
      <div className="flex items-center justify-end gap-2 p-4">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 p-6 pb-24">
        <div className="text-center">
          <span
            aria-hidden
            className="bg-success text-success-foreground mx-auto mb-4 grid size-12 place-items-center rounded-full"
          >
            <PartyPopper className="size-6" />
          </span>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
        </div>

        {/* 🚨 The card wraps the CONDITIONAL, not one of its branches. This
            page waits: it polls while the IPN is still on its way and swaps a
            spinner for the result underneath the same heading. A surface that
            appeared only once the order arrived would make the page change
            shape while somebody is watching it — and this is the page a buyer
            lands on straight out of a payment, which is the worst possible
            moment for the app to look uncertain.

            Adding a card here at all is a decision, not a pattern: this page
            has no <BrandMark> and no card today, it opens with a celebration.
            The celebration is untouched — the medallion and the heading stay
            ABOVE the surface. What changes is that its message now sits on the
            same plate as the sign-in's form, which is the point: a buyer meets
            /optin and /login minutes apart. app/ds24-connected/page.tsx carries
            the argument for the shape at length. */}
        <Card className="shadow-(--elevation-overlay)">
          <CardContent className="flex flex-col gap-4">
            {!order ? (
              <OrderProcessing />
            ) : (
              <>
                <Callout variant="success">
                  {t("received")}
                  {/* Two sentences, two keys — never stitched together in code:
                      word order is not the same in every language. */}
                  {!signedIn && (
                    <span className="mt-2 block">{t("signInBody")}</span>
                  )}
                </Callout>
                <Button asChild className="w-full">
                  <Link href={signedIn ? "/dashboard" : "/login"}>
                    {signedIn ? t("dashboardCta") : t("signInCta")}
                  </Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* 🚨 Who took the money — outside the conditional, on purpose.
            Digistore24 GmbH is the RESELLER: it is their name on the buyer's
            bank statement, not the vendor's. A buyer who does not recognise a
            line on their statement does not write a support mail, they call
            their bank — and a chargeback costs the vendor the sale, the fee
            and a mark on their Digistore24 account. It is also a platform
            requirement of the reseller this whole template bills through.

            It therefore may not wait for the IPN: the buyer is standing here
            straight out of a payment page, which is the one moment the
            question "who just charged me" is actually being asked. The order
            arriving is irrelevant to it, so it sits outside the branch that
            waits for one, quietly, under the card.

            `node run.mjs legal-check` refuses an app whose thank-you page has
            lost this (`lib/legal/digistore-claims.mjs` → RESELLER_NOTICE) —
            both halves, the key AND this mount, because either alone is a
            check that passes while the buyer reads nothing. */}
        <p className="text-muted-foreground text-center text-xs">
          {t("reseller")}
        </p>
      </div>
    </main>
  );
}
