// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { getLocale, getTranslations } from "next-intl/server";
import { Check } from "lucide-react";

import {
  allProducts,
  formatPrice,
  intervalKey,
  type ProductDef,
} from "@/lib/digistore/products";
import { planSections, SECTION_TEXT } from "@/lib/digistore/plan-sections";
import {
  checkoutLinksFor,
  checkoutBlockersFor,
  blockerFor,
  type CheckoutBlocker,
} from "@/lib/digistore/checkout";
import { auth } from "@/auth";
import { startCheckoutAction } from "./actions";
import { PublicHeader } from "@/components/public-header";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { SiteFooter } from "@/components/site-footer";

// Public plans page — fed from config/digistore-products.json.
//
// This is scaffolding: the plans in there are examples. Change names, prices
// and features in the JSON, or delete this page if your app has no plans.
// There is deliberately no second price list in the code — the registry is the
// single source, so the display and Digistore24 never drift apart.
//
// On language: the UI is translated (buttons, "per month", notices). Product
// names, features and descriptions come from the registry and stay as
// entered — it is YOUR product copy, and Digistore24 carries exactly the same.
// Prices are only formatted per the language's conventions, never converted.
export async function generateMetadata() {
  const t = await getTranslations("plans");
  return { title: t("title") };
}

// Which command fixes this state. Only for setup blockers — "error" is the
// only one a real buyer can see on a live app, and they must never be shown a
// terminal command.
const SETUP_HINTS: Record<CheckoutBlocker, string | undefined> = {
  notSynced: "node run.mjs ds24-sync",
  notConnected: "node run.mjs ds24-connect",
  error: undefined,
};

// The section headings come from SECTION_TEXT (lib/digistore/plan-sections.ts),
// where a test holds every key against both language files — a missing key
// would render as the raw key with nothing in the log.

async function PlanCard({
  def,
  blocker,
  url,
  signedIn,
}: {
  def: ProductDef;
  blocker: CheckoutBlocker | null;
  url: string | null;
  signedIn: boolean;
}) {
  const t = await getTranslations("plans");
  const locale = await getLocale();

  const price = formatPrice(def, locale);
  const interval = intervalKey(def);

  return (
    <Card className={cn("flex flex-col", def.highlight && "border-primary")}>
      <CardContent className="flex flex-1 flex-col gap-4">
        {def.highlight && (
          <Badge className="self-start">{t("mostPopular")}</Badge>
        )}

        <div>
          <h3 className="text-lg font-medium">{def.name}</h3>
          {def.tagline && (
            <p className="text-muted-foreground text-sm">{def.tagline}</p>
          )}
        </div>

        <p className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold">
            {price ?? t("onRequest")}
          </span>
          <span className="text-muted-foreground text-sm">
            {interval ? t(interval) : def.billingInterval}
          </span>
        </p>

        {def.features?.length ? (
          <ul className="flex flex-col gap-2 text-sm">
            {def.features.map((feature) => (
              <li key={feature} className="flex gap-2">
                <Check aria-hidden className="text-primary mt-0.5 size-4 shrink-0" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {blocker ? (
          // No working checkout — say so honestly rather than building a dead
          // link. The setup hints are commands only YOU see: they only appear
          // as long as the app is not connected. A visitor to a live app can
          // only ever hit "error", which carries no command.
          <p className="text-muted-foreground mt-auto rounded-lg border border-dashed p-3 text-center text-sm">
            {t(`blocked_${blocker}`)}
            {SETUP_HINTS[blocker] && (
              <>
                <br />
                <code className="text-xs">{SETUP_HINTS[blocker]}</code>
              </>
            )}
          </p>
        ) : signedIn ? (
          // Signed in: the checkout is built on click, not on render, so it
          // can carry the identity that names this Member. `mt-auto`
          // sits on the form — it is what keeps the card footers aligned.
          <form action={startCheckoutAction} className="mt-auto flex flex-col gap-3">
            <input type="hidden" name="planKey" value={def.key} />
            {/* Only for packages, and only for a signed-in buyer. A
                subscription has no balance to keep topped up, and the
                signed-OUT path serves a SHARED cached link (AD-6/AD-7) which
                cannot carry one person's preference. */}
            {def.kind === "token" && (
              // A NATIVE checkbox, and the one place this template knowingly
              // steps outside `components/ui/` — recorded here rather than left
              // to look like an oversight.
              //
              // shadcn's Checkbox is a Radix button with no form value: it needs
              // `@radix-ui/react-checkbox` (NFR-12 forbids a new runtime
              // dependency) plus a hidden input to reach `FormData` at all. This
              // control has to work in a plain POST — it authorises a recurring
              // card charge, and the consent for that must not depend on
              // JavaScript having loaded.
              //
              // So: native input, but styled and labelled like the rest of the
              // system — colours from tokens, the focus ring the design system
              // gives every other control, and a real <Label> so the text is a
              // click target.
              <div className="flex items-start gap-2">
                <input
                  id={`auto-reload-${def.key}`}
                  type="checkbox"
                  name="autoReload"
                  className="accent-primary border-input focus-visible:ring-ring/50 mt-0.5 size-4 shrink-0 rounded-[4px] focus-visible:ring-[3px] focus-visible:outline-none"
                />
                <Label
                  htmlFor={`auto-reload-${def.key}`}
                  className="text-muted-foreground text-sm leading-snug font-normal"
                >
                  {t("autoReloadLabel")}
                </Label>
              </div>
            )}
            <Button type="submit" size="lg" className="w-full">
              {t("buy")}
            </Button>
          </form>
        ) : (
          // Signed out: nobody to name, so the shared cached link is used —
          // that is what keeps the public page free of Digistore24 calls.
          <Button asChild size="lg" className="mt-auto">
            <a href={url ?? "#"}>{t("buy")}</a>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const t = await getTranslations("plans");
  const locale = await getLocale();
  // Every kind the registry holds, grouped and ordered in ONE place
  // (lib/digistore/plan-sections.ts). Enumerating the kinds here is what once
  // left `one_time` off the page entirely.
  const sections = planSections(allProducts());

  // A signed-in visitor gets buttons instead of links; the URL is then built
  // on click (app/plans/actions.ts). auth() is safe here even though this page
  // is public — it returns null when nobody is signed in.
  const session = await auth();
  const signedIn = Boolean(session?.user);
  const checkoutFailed = (await searchParams).checkout === "error";

  // Flattened, so a blocker and a cached link are resolved for every product
  // that will be rendered — including the one-off purchase, which reached
  // neither before the grouping moved into one place.
  const defs = sections.flatMap((section) => section.defs);

  // Signed in: NOTHING is asked of Digistore24 while rendering — the checkout
  // URL is built on click (./actions.ts). Only the locally knowable blockers
  // are resolved, so a plan that is not set up still says so instead of
  // showing a button that leads nowhere.
  //
  // Signed out: the shared links as before. One pass for every plan, the API
  // key resolved once, URLs from the cache (buy_url_cache, 20h)
  // — so this is not one Digistore24 call per visitor either.
  //
  // The locale travels with the links: a Digistore24 product carries exactly
  // one language, and that language is the ORDER FORM's — so the visitor's
  // locale picks WHICH product this offering sends them to
  // (lib/digistore/products.ts → checkoutProductFor). Without it half the
  // visitors are asked for their card details in the other language.
  const blockers = signedIn ? await checkoutBlockersFor(defs) : null;
  const links = signedIn ? null : await checkoutLinksFor(defs, {}, locale);

  const cardFor = (def: ProductDef): { blocker: CheckoutBlocker | null; url: string | null } => {
    if (blockers) return { blocker: blockerFor(blockers, def.key), url: null };
    const link = links?.get(def.key) ?? { url: null, blocker: "error" as const };
    return { blocker: link.blocker ?? null, url: link.url };
  };

  return (
    <>
      <PublicHeader />

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-12 sm:px-6">
        <div className="text-center">
          <h1 className="text-3xl font-semibold sm:text-4xl">{t("title")}</h1>
          <p className="text-muted-foreground mx-auto mt-3 max-w-xl text-balance">
            {t("subtitle")}
          </p>
        </div>

        {checkoutFailed && (
          <Callout variant="danger" title={t("checkoutFailedTitle")}>
            {t("checkoutFailedBody")}
          </Callout>
        )}

        {sections.length === 0 && (
          <EmptyState
            title={t("emptyTitle")}
            description={t.rich("emptyBody", {
              code: (chunks) => <code>{chunks}</code>,
            })}
          />
        )}

        {sections.map((section) => (
          <section key={section.id} className="flex flex-col gap-4">
            <div>
              <h2 className="text-xl font-medium">
                {t(SECTION_TEXT[section.id].title)}
              </h2>
              <p className="text-muted-foreground text-sm">
                {t(SECTION_TEXT[section.id].body)}
              </p>
            </div>
            {/* Both class strings stand in the source, so Tailwind's scanner
                finds them — a computed `sm:grid-cols-${n}` would not exist in
                the built stylesheet. */}
            <div
              className={cn(
                "grid gap-4",
                section.columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
              )}
            >
              {section.defs.map((def) => (
                <PlanCard
                  key={def.key}
                  def={def}
                  {...cardFor(def)}
                  signedIn={signedIn}
                />
              ))}
            </div>
          </section>
        ))}
      </main>

      {/* The legal links. Public pages need them most: § 5 DDG asks for the
          Impressum to be reachable, and the person deciding whether to sign up
          is exactly the person who has to be able to read the privacy policy
          first. */}
      <SiteFooter />
    </>
  );
}
