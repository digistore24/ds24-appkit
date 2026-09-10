// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { getLocale, getTranslations } from "next-intl/server";
import { Check } from "lucide-react";

import {
  sellableProducts,
  formatPrice,
  intervalKey,
  paymentOptionsOf,
  type PaymentOption,
  type ProductDef,
} from "@/lib/digistore/products";
import { planSections, SECTION_TEXT } from "@/lib/digistore/plan-sections";
import {
  checkoutLinksFor,
  checkoutBlockersFor,
  blockerFor,
  offerRef,
  type CheckoutBlocker,
} from "@/lib/digistore/checkout";
import {
  isPlansPreviewActive,
  wantsPlansPreview,
  plansRenderMode,
  PLANS_PREVIEW_PARAM,
  PLANS_PREVIEW_VALUE,
} from "@/lib/digistore/preview";
import { auth } from "@/auth";
import { startCheckoutAction } from "./actions";
import { PublicHeader } from "@/components/public-header";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { neededProduct, PLANS_NEEDS_PARAM } from "./needs";
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

/**
 * What a buy button says when an offering has more than one way to pay.
 *
 * The price IS the label there: two buttons both reading "Buy now" would ask
 * the visitor to guess which one charges what. Composed from the same two
 * pieces the headline uses, so no message key exists that only this reads —
 * "19,00 € pro Monat", "190.00 € per year".
 */
function buyLabel(
  option: PaymentOption,
  locale: string,
  t: (key: string) => string,
): string {
  const price = formatPrice(option, locale);
  const key = option.billingInterval === "12_month" ? "perYear" : option.billingInterval === "1_month" ? "perMonth" : "oneTime";
  return price ? `${price} ${t(key)}` : t("buy");
}

async function PlanCard({
  def,
  buys,
  asForm,
}: {
  def: ProductDef;
  /** One entry per WAY TO PAY — monthly, yearly. Usually exactly one. */
  buys: Array<{
    option: PaymentOption;
    blocker: CheckoutBlocker | null;
    url: string | null;
  }>;
  /** Click-time form instead of the shared link — signed in, or previewing. */
  asForm: boolean;
}) {
  const t = await getTranslations("plans");
  const locale = await getLocale();

  // 🚨 ONE CARD PER OFFERING, one button per way to pay — not one card per
  // price. Monthly and yearly are the same product, the same Product Key and
  // the same entitlement; two cards would say they are two things to buy, and
  // that is exactly the misreading the old registry taught (and that made
  // every access gate have to name both).
  //
  // No client-side toggle, deliberately. The buy control has to work in a
  // plain POST — the same reason the auto-top-up consent below is a native
  // checkbox — and a switcher that needs JavaScript would decide the price of
  // a purchase.
  const several = buys.length > 1;
  // ⚠️ The headline names the CHEAPEST way to pay, prefixed "from" — never the
  // recommended one. A card whose big number was the yearly price while its
  // first button said the monthly one asks the reader to reconcile two prices
  // for the same thing; `highlight` decides which BUTTON leads, and nothing
  // else. Where there is only one way to pay, the prefix is absent and this
  // reads exactly as it always did.
  const lead = several
    ? buys.reduce((a, b) =>
        (b.option.priceCents ?? Infinity) < (a.option.priceCents ?? Infinity)
          ? b
          : a,
      ).option
    : buys[0]?.option;
  const price = lead ? formatPrice(lead, locale) : null;
  const interval = lead ? intervalKey(def, lead) : null;
  // Whether a product exists and whether there is an API key are questions
  // about the OFFERING, so every way to pay carries the same answer.
  const blocker = buys[0]?.blocker ?? null;

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
          {several && price && (
            <span className="text-muted-foreground text-sm">{t("from")}</span>
          )}
          <span className="text-3xl font-semibold">
            {price ?? t("onRequest")}
          </span>
          <span className="text-muted-foreground text-sm">
            {interval ? t(interval) : (lead?.billingInterval ?? "")}
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
        ) : (
          <div className="mt-auto flex flex-col gap-3">
            {buys.map(({ option, url }) =>
              asForm ? (
          // Signed in: the checkout is built on click, not on render, so it
          // can carry the identity that names this Member.
          <form
            key={option.key}
            action={startCheckoutAction}
            className="flex flex-col gap-3"
          >
            <input type="hidden" name="planKey" value={def.key} />
            {/* WHICH way to pay. A field of its own rather than a suffix on
                planKey, so everything that reads a Product Key out of a form
                keeps reading a Product Key. The server refuses a value the
                offering does not have — this is an HTTP endpoint, and a
                tampered option must not resolve to a cheaper price. */}
            <input type="hidden" name="optionKey" value={option.key} />
            {/* Only for packages, and only for a signed-in buyer. A
                subscription has no balance to keep topped up, and the
                signed-OUT path serves a SHARED cached link (AD-6/AD-7) which
                cannot carry one person's preference. */}
            {def.kind === "token" && (
              // A NATIVE checkbox, and the one place this template knowingly
              // steps outside `components/ui/` — recorded here rather than left
              // to look like an oversight.
              //
              // shadcn's Checkbox is a Radix button with no form value: it reaches
              // `FormData` only through a hidden input beside it. (It used to say
              // the dependency was forbidden as well — `radix-ui` has shipped
              // since, and `components/ui/checkbox.tsx` is in the kit. The
              // dependency is not the reason; the plain POST is.) This
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
                {/* ⚠️ The LABEL is the consent phrase, and the rest is helper
                    text beside it. It was one ~210-character paragraph of two
                    sentences until 2026-08-13 — the whole thing a click target,
                    and the whole thing read out as the checkbox's name. A label
                    is what somebody agrees to; the mechanics belong next to it,
                    not inside it. */}
                <div className="grid gap-1">
                  <Label
                    htmlFor={`auto-reload-${def.key}`}
                    className="text-sm leading-snug font-normal"
                  >
                    {t("autoReloadLabel")}
                  </Label>
                  <p className="text-muted-foreground text-xs leading-snug">
                    {t("autoReloadHint")}
                  </p>
                </div>
              </div>
            )}
            <Button
              type="submit"
              size="lg"
              variant={several && !option.highlight ? "outline" : "default"}
              className="w-full"
            >
              {several ? buyLabel(option, locale, t) : t("buy")}
            </Button>
          </form>
              ) : (
          // Signed out: nobody to name, so the shared cached link is used —
          // that is what keeps the public page free of Digistore24 calls.
          <Button
            key={option.key}
            asChild
            size="lg"
            variant={several && !option.highlight ? "outline" : "default"}
          >
            <a href={url ?? "#"}>
              {several ? buyLabel(option, locale, t) : t("buy")}
            </a>
          </Button>
              ),
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{
    checkout?: string;
    preview?: string | string[];
    [PLANS_NEEDS_PARAM]?: string | string[];
  }>;
}) {
  const t = await getTranslations("plans");
  const locale = await getLocale();
  // Every kind the registry holds, grouped and ordered in ONE place
  // (lib/digistore/plan-sections.ts). Enumerating the kinds here is what once
  // left `one_time` off the page entirely.
  //
  // `sellableProducts()`, never `allProducts()`: this page IS the offer, so a
  // parked entry (`"sell": false`) belongs off it. The rest of the app keeps
  // the full list — somebody who bought a plan that has since been taken off
  // sale still has it (lib/digistore/products.ts → sellableProducts).
  const sections = planSections(sellableProducts());

  // A signed-in visitor gets buttons instead of links; the URL is then built
  // on click (app/plans/actions.ts). auth() is safe here even though this page
  // is public — it returns null when nobody is signed in.
  const session = await auth();
  const signedIn = Boolean(session?.user);
  const sp = await searchParams;
  const checkoutFailed = sp.checkout === "error";
  // A gated page sent the member here — `redirect("/plans?needs=<key>")`.
  // Named before anything else on the page, or the page reads as a price list
  // rather than as the answer to the click they just made (./needs.ts).
  const needed = neededProduct(sp[PLANS_NEEDS_PARAM]);

  // The DEV fixture (lib/digistore/preview.ts): `?preview=checkout` renders the
  // buy forms of an app that has no Digistore24 products yet, so they can be
  // looked at without putting dummy ids into config/digistore-products.json —
  // a file git tracks — and a dummy key into `.env`. Two independent questions,
  // asked separately: did somebody ask for it, and may it exist on this
  // machine at all. It asks Digistore24 nothing and produces no URL.
  const previewing =
    wantsPlansPreview(sp[PLANS_PREVIEW_PARAM]) && isPlansPreviewActive();
  const mode = plansRenderMode({ signedIn, previewing });
  // Only worth offering while there is nothing to see anyway, and only where
  // the fixture would actually work.
  const previewOffered = !previewing && isPlansPreviewActive();

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
  const blockers = mode.askBlockers ? await checkoutBlockersFor(defs) : null;
  const links = mode.askDigistore
    ? await checkoutLinksFor(defs, {}, locale)
    : null;

  // One row per WAY TO PAY. `offerRef` keeps a single-option offering on its
  // bare Product Key, so nothing about the common case changed.
  const buysFor = (def: ProductDef) =>
    paymentOptionsOf(def).map((option) => {
      const ref = offerRef(def.key, option.key);
      // The preview shows the form and NEVER a URL — an invented address is
      // the dead link this page exists to refuse.
      if (mode.ignoreBlockers) return { option, blocker: null, url: null };
      if (blockers)
        return { option, blocker: blockerFor(blockers, ref), url: null };
      const link = links?.get(ref) ?? { url: null, blocker: "error" as const };
      return { option, blocker: link.blocker ?? null, url: link.url };
    });

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

        {needed && (
          <Callout variant="info" title={t("needsTitle", { product: needed.name })}>
            {t("needsBody")}
          </Callout>
        )}
        {checkoutFailed && (
          <Callout variant="danger" title={t("checkoutFailedTitle")}>
            {t("checkoutFailedBody")}
          </Callout>
        )}

        {/* Both of these exist only on a local development machine
            (isPlansPreviewActive), so no visitor of a deployed app ever sees
            them. They are addressed at whoever is building the app. */}
        {previewing && (
          <Callout variant="warning" title={t("previewTitle")}>
            {t("previewBody")}
          </Callout>
        )}
        {previewOffered && (
          <p className="text-muted-foreground text-center text-sm">
            {t("previewOffer")}{" "}
            <a
              className="underline underline-offset-4"
              href={`?${PLANS_PREVIEW_PARAM}=${PLANS_PREVIEW_VALUE}`}
            >
              {t("previewOfferLink")}
            </a>
          </p>
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
                  buys={buysFor(def)}
                  asForm={mode.asForm}
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
