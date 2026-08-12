// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { CalendarClock, CreditCard } from "lucide-react";

import { auth } from "@/auth";
import { hasDigistoreApiKey } from "@/lib/digistore/settings";
import { nextPaymentForMember } from "@/lib/digistore/subscriptions";
import { purchaseNoticeFor } from "@/lib/digistore/member-billing";
import { entitlementsFor } from "@/lib/entitlements/manage";
import { getTokenAccount } from "@/lib/tokens/account";
import { findProduct } from "@/lib/digistore/products";
import { sellsPlans, sellsTokens } from "@/lib/billing-mode";
import {
  NEXT_PAYMENT_FORMAT,
  isUpcoming,
  todayInUtc,
  toUtcDate,
} from "@/lib/digistore/next-payment";
import { FlashToast } from "@/components/flash-toast";
import {
  OnboardingChecklist,
  type OnboardingStepView,
} from "@/components/onboarding-checklist";
import { PageHeader } from "@/components/page-header";
import { RoleBadge } from "@/components/role-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";

export async function generateMetadata() {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

// The starting point of your app after signing in. The sign-in check and the
// frame (sidebar, header) come from app/dashboard/layout.tsx.
//
// `?purchase=<ds24OrderId>` is where a buyer arrives from /optin/[orderId]
// after paying. Only the REFERENCE travels; what gets said is resolved here,
// from the database, scoped to the signed-in member — see §D2 of story 4.2 and
// the comment on <FlashToast>.
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ purchase?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const t = await getTranslations("dashboard");
  const format = await getFormatter();

  const { purchase } = await searchParams;
  // null for a foreign order, an unattributed one, and anything not `paid` —
  // the rule is in lib/digistore/purchase-notice.ts and is tested there.
  const notice = purchase
    ? await purchaseNoticeFor(session.user.id as string, purchase)
    : null;

  // The Digistore24 connection is a matter of the installation, not of the
  // user: it comes from .env (node run.mjs ds24-connect), not from a form.
  const connected = hasDigistoreApiKey();

  // When the Member is next charged — DISPLAY ONLY. It says nothing about what
  // they may use; that answer comes from lib/entitlements (AD-1, AD-2).
  //
  // `null` covers every case in which there is nothing honest to say: no
  // subscription, one that was never attributed to this account, one that has
  // been cancelled or refunded (§D3 NULLs the date then), and one whose date
  // has slipped into the past.
  //
  // Skipped entirely in a tokens-only app: there is no recurring charge to
  // announce, so the query is not asked either (lib/billing-mode.ts). Nothing
  // is hidden by that — the card only ever renders on an UPCOMING date, so a
  // legacy subscription would still be shown by flipping the mode back.
  const nextPaymentAt = sellsPlans()
    ? await nextPaymentForMember(session.user.id as string)
    : null;
  // The rule stated once more where it is rendered, so the card cannot advertise
  // a charge that will never come even if the query above is ever loosened.
  const showNextPayment = isUpcoming(nextPaymentAt, todayInUtc());

  // ── The first five minutes ────────────────────────────────────────────────
  //
  // THIS IS THE BLUEPRINT. Two steps ship, both derived from what the customer
  // really holds, and both are meant to be replaced by YOUR app's steps as soon
  // as it does something — "create your first project", "connect your calendar".
  // The list is where you say what a new customer should do; leave it as it is
  // and the app says "buy something" and nothing else.
  //
  // `done` is READ, never stored (lib/onboarding/rules.ts explains why): a
  // refund takes the plan away and the step opens again by itself, which no
  // stored tick would do.
  //
  // Both queries follow `billingMode` — a subscriptions-only app never asks
  // about a balance, so nobody pays for a step that could not appear anyway
  // (lib/billing-mode.ts).
  const owned = sellsPlans()
    ? await entitlementsFor(session.user.id as string)
    : [];
  const tokenBalance = sellsTokens()
    ? ((await getTokenAccount(session.user.id as string))?.balance ?? 0)
    : 0;

  // The plan is named, not counted. "1 plan active" is the answer to a
  // question nobody asked; the customer wants to read the name they paid for.
  // `findProduct` returns null for a key the registry no longer knows — then
  // the key itself is the honest fallback.
  //
  // 🚨 A Member holds TWO plans at once routinely, not exceptionally: a
  // Digistore24 plan switch delivers two events days apart, in either order, so
  // an upgrading Member briefly holds both keys (CLAUDE.md → Access). This
  // expression is therefore the ONE place the names are resolved, and both
  // readers below take the whole list from it. `owned[0]` would name one of the
  // two and would be right on every account anybody tests with.
  const ownedNames = owned.map(
    (e) => findProduct(e.productKey)?.name ?? e.productKey,
  );

  // ── What the member HAS — the card that leads the page ────────────────────
  //
  // Everything it says is already loaded above; it adds no query. In
  // particular `planStartedAt()` is NOT called: "member since" is tempting on a
  // card this size and it is a second aggregate over `grants`.
  //
  // ⚠️ Both halves are written the way lib/billing-mode.ts:30-37 requires — a
  // mode may hide an EMPTY thing, never a non-empty one:
  //
  //   · in a tokens-only app `owned` is `[]` because nothing ASKED, not because
  //     the member has nothing. So the plan half is absent there rather than
  //     saying "no plan", which would be the app answering a question it never
  //     put.
  //   · in a subscriptions-only app `tokenBalance` is `0` for the mirror-image
  //     reason, so the balance is hidden — but only while it is zero
  //     (`sellsTokens() || tokenBalance > 0`), never on the mode alone. A
  //     legacy balance somebody paid for stays visible after a mode flip.
  //
  // Adding either query "to be safe" is the one move that must not happen: it
  // buys a card that has nothing to say with a round trip on the busiest page
  // in the app.
  const showBalance = sellsTokens() || tokenBalance > 0;
  const holdsSomething = owned.length > 0 || tokenBalance > 0;

  // The empty state of that card, and it ABSORBS the plan card that used to
  // stand in this grid — two buttons to /plans is not a hierarchy. The
  // sentences are that card's own, so nothing was invented; in a tokens-only
  // app its plan wording would be false, so the token step's own words stand
  // there instead.
  const offer = sellsPlans()
    ? { title: t("planTitle"), body: t("planBody"), cta: t("planCta") }
    : {
        title: t("onboardingTokensTitle"),
        body: t("onboardingTokensBody"),
        cta: t("onboardingTokensCta"),
      };

  const onboardingSteps: OnboardingStepView[] = [];
  if (sellsPlans()) {
    onboardingSteps.push({
      id: "plan",
      done: owned.length > 0,
      title: t("onboardingPlanTitle"),
      description:
        owned.length > 0
          ? // Named, not counted — and the whole list, never the first of it.
            // The reasoning is on `ownedNames` above.
            t("onboardingPlanDone", { products: ownedNames.join(", ") })
          : t("onboardingPlanBody"),
      href: "/plans",
      cta: t("onboardingPlanCta"),
    });
  }
  if (sellsTokens()) {
    onboardingSteps.push({
      id: "tokens",
      done: tokenBalance > 0,
      title: t("onboardingTokensTitle"),
      description:
        tokenBalance > 0
          ? t("onboardingTokensDone", { balance: tokenBalance })
          : t("onboardingTokensBody"),
      href: "/plans",
      cta: t("onboardingTokensCta"),
    });
  }

  return (
    <>
      {notice && (
        <FlashToast
          message={
            notice.kind === "tokens"
              ? t("purchaseTokens", { credits: notice.credits })
              : notice.kind === "plan"
                ? t("purchasePlan", { product: notice.product })
                : t("purchaseGeneric")
          }
          clearParam="purchase"
        />
      )}

      <PageHeader
        title={t("welcome")}
        description={t("signedInAs", { email: session.user.email ?? "" })}
      >
        {/*
          The role, and nothing else. The address stood on this page TWICE —
          here in the description and again in a stat card of its own — and a
          page that says the same thing twice at the same size has no hierarchy
          left to read. The card went; the badge it carried, which is the one
          thing that was not already said, moved up here.
        */}
        <RoleBadge role={session.user.role} />
      </PageHeader>

      {/*
        Above the status cards, deliberately. A customer who has just paid opens
        this page to find out whether it worked; the cards answer questions they
        have not asked yet. It renders nothing once every step is done — that
        absence is the acknowledgement, and it survives a reload, which the
        toast above cannot (it clears its own parameter by design).
      */}
      <OnboardingChecklist steps={onboardingSteps} className="mb-6" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/*
          THE LEADING CARD. Four cards of one size used to stand here and none
          of them was what the member came for; the page was a row of equally
          important answers to questions nobody had asked.

          It leads by COMPOSITION and by nothing else — two of the three
          columns, two of the rows, a heading that is not the other cards'
          muted 14 px, and the figure at `text-2xl`. Deliberately no colour
          class and no shadow class: elevation is a DIAL with two values
          (app/globals.css), `<Card>` already wears the raised one, and
          `node run.mjs ux-check` counts a size class written here as a value
          past that dial. A card that is bigger and says more does not need to
          be louder as well.
        */}
        <Card className="sm:col-span-2 lg:row-span-2">
          <CardHeader>
            <CardTitle level="h2">{t("holdingTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {holdsSomething ? (
              <div className="space-y-6">
                {owned.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-muted-foreground text-sm font-medium">
                      {t("holdingPlanLabel")}
                    </p>
                    {/*
                      A LIST, one line per plan — the shipped checklist step
                      joins the same names with commas, which is right in a
                      sentence and wrong as a figure. Two plans at once is the
                      ordinary state during an upgrade, so this is the state
                      the layout is built for rather than the one it survives.
                    */}
                    <ul className="space-y-1">
                      {owned.map((entitlement, index) => (
                        <li
                          key={entitlement.productKey}
                          className="text-2xl leading-tight font-semibold text-pretty"
                        >
                          {ownedNames[index]}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {showBalance && (
                  <div className="space-y-1.5">
                    <p className="text-muted-foreground text-sm font-medium">
                      {t("holdingTokensLabel")}
                    </p>
                    {/*
                      `format.number`, never a bare `{balance}` and never
                      `toLocaleString`: the language comes from the request,
                      not from the server's environment (CLAUDE.md →
                      Languages). `tabular-nums` so a balance that changes does
                      not shift on the spot.
                    */}
                    <p className="text-2xl leading-tight font-semibold tabular-nums">
                      {format.number(tokenBalance)}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              /*
                Empty is a state, and it gets the kit's own component rather
                than a blank card (CLAUDE.md → UI, rule 3). It carries the call
                to action the plan card used to carry, which is why that card
                is gone rather than standing beside this one.
              */
              <EmptyState
                icon={CreditCard}
                title={offer.title}
                description={offer.body}
              >
                {/*
                  `variant="outline"`, exactly as the plan card's button was:
                  the checklist above is already driving this member towards
                  /plans with a filled button, and two filled buttons to one
                  route on one screen is not a hierarchy either.
                */}
                <Button asChild variant="outline" size="sm">
                  <Link href="/plans">{offer.cta}</Link>
                </Button>
              </EmptyState>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {t("statusTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={connected ? "default" : "secondary"}>
              {connected ? t("statusConnected") : t("statusDisconnected")}
            </Badge>
          </CardContent>
        </Card>

        {showNextPayment && (
          <Card>
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm font-medium">
                {t("nextPaymentTitle")}
              </CardTitle>
              <CardDescription>{t("nextPaymentBody")}</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-2">
              <CalendarClock
                aria-hidden
                className="text-muted-foreground size-4"
              />
              {/*
                next-intl's formatter, not toLocaleDateString: the language comes
                from the request (cookie / browser), not from the server's
                environment. NEXT_PAYMENT_FORMAT pins the zone back to UTC — see
                §D1, without it every viewer behind UTC reads the previous day.
              */}
              <time dateTime={nextPaymentAt!} className="text-sm font-medium">
                {format.dateTime(toUtcDate(nextPaymentAt!), NEXT_PAYMENT_FORMAT)}
              </time>
            </CardContent>
          </Card>
        )}
      </div>

      {!connected && (
        <Callout variant="warning" title={t("ds24Title")} className="mt-6">
          {t.rich("ds24Body", { code: (chunks) => <code>{chunks}</code> })}
          <pre className="bg-background mt-2 overflow-x-auto rounded-md border p-2 font-mono text-xs">
            node run.mjs ds24-connect
          </pre>
        </Callout>
      )}

      {/*
        A closing <Card> used to stand here whose CardHeader had a title and a
        description and whose body did not exist — the emptiest block on the
        page, and against this app's own rule that an area which can hold
        nothing gets an <EmptyState> and never a bare heading (CLAUDE.md → UI,
        rule 3). It had no next action to carry either: what it said was
        "replace this page", addressed to the developer and read by every
        paying customer. It was removed rather than filled, and its two message
        keys went with it — a key rendered nowhere is weight the next reader
        has to disprove.
      */}
    </>
  );
}
