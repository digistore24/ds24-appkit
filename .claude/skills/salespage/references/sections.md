<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Section recipes — kit only, tokens only

Worked TSX for the sections in `docs/salespage.md`. Every snippet composes the
existing kit — nothing here needs a new component, and nothing may use a
hand-picked colour class. All copy goes through `t(…)` from the `home`
namespace, in **both** language files.

The page stays a **server component** (like the shipped one): the checkout
link and the translations are resolved while rendering, and there is nothing
interactive on it that the accordion does not bring itself.

## The frame

```tsx
import { getLocale, getTranslations } from "next-intl/server";

import { auth } from "@/auth";
import { PublicHeader } from "@/components/public-header";
import { SiteFooter } from "@/components/site-footer";

export default async function Home() {
  const t = await getTranslations("home");

  return (
    <>
      <PublicHeader />
      <main className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6">
        {/* sections, in the agreed order */}
      </main>
      {/* § 5 DDG — the legal links, most needed on the public page */}
      <SiteFooter />
    </>
  );
}
```

## 1 · Hero — headline, subline, CTA, a real visual

```tsx
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Figure } from "@/components/ui/figure";

<section className="grid items-center gap-10 sm:grid-cols-2">
  <div>
    <Badge variant="secondary" className="mb-5">{t("hero.badge")}</Badge>
    <h1 className="text-4xl font-semibold text-balance sm:text-5xl">
      {t("hero.title")}
    </h1>
    <p className="text-muted-foreground mt-4 text-lg text-balance">
      {t("hero.subtitle")}
    </p>
    <div className="mt-8 flex flex-wrap gap-3">
      <Button asChild size="lg">
        {/* to the offer block — a stranger has nothing to sign in to */}
        <a href="#offer">
          {t("hero.cta")}
          <ArrowRight aria-hidden />
        </a>
      </Button>
      <Button asChild size="lg" variant="outline">
        <a href="#inside">{t("hero.secondary")}</a>
      </Button>
    </div>
  </div>
  <Figure
    src="/hero.png"
    width={1200}
    height={900}
    alt={t("hero.imageAlt")}
    className="rounded-xl border"
  />
</section>
```

The image file: an app screenshot or owned product image into `public/`
(`/hero.png`); a generated one arrives as a `media` row instead — the
`visuals` skill owns that path. `alt` is a sentence about what the picture
shows, never the marketing headline again.

## 2 · Problem → promise

```tsx
<section className="mx-auto mt-24 max-w-2xl text-center">
  <h2 className="text-2xl font-semibold sm:text-3xl">{t("problem.title")}</h2>
  <p className="text-muted-foreground mt-4 text-lg">{t("problem.pain")}</p>
  <p className="mt-4 text-lg font-medium">{t("problem.promise")}</p>
</section>
```

## 3 · Benefits — outcomes, matching icons or none

```tsx
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const benefits = ["pace", "coach", "onceOnly"] as const; // this app's own

<section className="mt-24">
  <h2 className="text-center text-2xl font-semibold sm:text-3xl">
    {t("benefits.title")}
  </h2>
  <div className="mt-10 grid gap-4 sm:grid-cols-3">
    {benefits.map((key) => (
      <Card key={key}>
        <CardHeader>
          <CardTitle>{t(`benefits.${key}.title`)}</CardTitle>
          <CardDescription>{t(`benefits.${key}.body`)}</CardDescription>
        </CardHeader>
      </Card>
    ))}
  </div>
</section>
```

If icons are wanted, pick one **per benefit** so it means what it sits next to
— never keep the shipped key/cart/sparkles trio beside new copy. Course covers
or screenshots per card beat icons where they exist.

## 4 · What's inside (`id="inside"`)

Numbered cards from the app's real structure; lesson/block cover images via
`<Figure>` where the app has them. Same `Card` grid as section 3 — with a
number or cover instead of an icon, and one line of deliverable per block
("Block 3 — your first rig, with the checklist as PDF").

## 5 · Social proof — only what is real

```tsx
<section className="mx-auto mt-24 max-w-2xl">
  <Card>
    <CardContent className="pt-6">
      <blockquote className="text-lg">“{t("proof.quote")}”</blockquote>
      <p className="text-muted-foreground mt-3 text-sm">{t("proof.name")}</p>
    </CardContent>
  </Card>
</section>
```

The founder-story variant is the same card with a portrait `<Figure>` and two
sentences of who built this and why. The rule above every variant is in
`docs/salespage.md` § 5: nothing invented, placeholders never go live.

## 6 · Offer block (`id="offer"` — keep an existing anchor like `#preis` working)

One featured product, the shared checkout link for the signed-out visitor, the
click-time action for the signed-in one — the same split `/plans` uses.

```tsx
import { Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { allProducts, formatPrice } from "@/lib/digistore/products";
import { checkoutLinksFor } from "@/lib/digistore/checkout";
import { startCheckoutAction } from "./plans/actions";

// while rendering, before the JSX:
const locale = await getLocale();
const signedIn = Boolean((await auth())?.user);
const def = allProducts().find((d) => d.highlight) ?? allProducts()[0];
const link =
  def && !signedIn
    ? ((await checkoutLinksFor([def], {}, locale)).get(def.key) ?? null)
    : null;

<section id="offer" className="mx-auto mt-24 max-w-md scroll-mt-24">
  <Card className="border-primary">
    <CardContent className="flex flex-col gap-4 pt-6">
      <h2 className="text-2xl font-semibold">{def.name}</h2>
      <p className="flex items-baseline gap-2">
        <span className="text-4xl font-semibold">{formatPrice(def, locale)}</span>
        <span className="text-muted-foreground text-sm">{t("offer.interval")}</span>
      </p>
      <ul className="flex flex-col gap-2 text-sm">
        {(["stack1", "stack2", "stack3", "stack4"] as const).map((key) => (
          <li key={key} className="flex gap-2">
            <Check aria-hidden className="text-primary mt-0.5 size-4 shrink-0" />
            <span>{t(`offer.${key}`)}</span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-sm">{t("offer.guarantee")}</p>
      {signedIn ? (
        <form action={startCheckoutAction}>
          <input type="hidden" name="planKey" value={def.key} />
          <Button type="submit" size="lg" className="w-full">{t("offer.buy")}</Button>
        </form>
      ) : link?.url ? (
        <Button asChild size="lg" className="w-full">
          <a href={link.url}>{t("offer.buy")}</a>
        </Button>
      ) : (
        // no working checkout — say so, never a dead link
        // (the honest wording and setup hints: app/plans/page.tsx)
        <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-center text-sm">
          {t("offer.unavailable")}
        </p>
      )}
    </CardContent>
  </Card>
</section>
```

The **value stack** lines are page copy (i18n), written under the promise —
not the registry's `features[]` pasted through. The price is never anywhere
else on the page as text. With several products, one quiet
`<Link href="/plans">{t("offer.compare")}</Link>` under the card.

## 7 · FAQ

```bash
npx shadcn@latest add accordion
```

```tsx
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";

<section className="mx-auto mt-24 max-w-2xl">
  <h2 className="text-center text-2xl font-semibold">{t("faq.title")}</h2>
  <Accordion type="single" collapsible className="mt-8">
    {(["beginners", "access", "refund", "time"] as const).map((key) => (
      <AccordionItem key={key} value={key}>
        <AccordionTrigger>{t(`faq.${key}.q`)}</AccordionTrigger>
        <AccordionContent>{t(`faq.${key}.a`)}</AccordionContent>
      </AccordionItem>
    ))}
  </Accordion>
</section>
```

## 8 · Final CTA band

```tsx
<section className="bg-primary/5 mt-24 rounded-xl px-6 py-12 text-center">
  <h2 className="text-2xl font-semibold">{t("finalCta.title")}</h2>
  <Button asChild size="lg" className="mt-6">
    <a href="#offer">{t("finalCta.button")}</a>
  </Button>
</section>
```

## After assembly

The `setupHint` callout from the shipped page (`!hasDigistoreApiKey()` →
`Callout`) is worth keeping near the offer block while the app is not
connected — it disappears from the live page by itself. Then step 5 of the
skill: `ux-check`, `smoke`, `errors`, both themes, 380 px, and the buy button
clicked once.
