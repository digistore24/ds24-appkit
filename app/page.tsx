// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";

import { APP_NAME } from "@/lib/app";
import { hasDigistoreApiKey } from "@/lib/digistore/settings";
import { PublicHeader } from "@/components/public-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Callout } from "@/components/ui/callout";
import { SiteFooter } from "@/components/site-footer";

// Public home page — the TEMPLATE'S placeholder, not a salespage. It describes
// the template to a developer, and its structure does NOT carry for a real
// product: swapping the texts below leaves a page with no proof and no offer.
// The skill `salespage` (reference: docs/salespage.md) replaces this page once
// the app has products and prices.
export default async function Home() {
  const t = await getTranslations("home");

  // ⚠️ These keys are load-bearing beyond the page. `findPlaceholderHome()` in
  // `scripts/ux/rules.mjs` recognises the shipped placeholder by the string
  // "features.authTitle", and three shipped skills read the same signal —
  // `salespage` (step 0), `coach` (its routing table) and `go-live` (its
  // pre-flight). It is what tells a customer this is still the template's
  // page. Renaming them silences all four at once; the icons that used to sit
  // beside them were the second marker and are gone, so this string is not one
  // of two markers any more — it is the ONLY one left.
  const included = [
    { term: "features.authTitle", body: "features.authBody" },
    { term: "features.billingTitle", body: "features.billingBody" },
    { term: "features.readyTitle", body: "features.readyBody" },
  ] as const;

  return (
    <>
      <PublicHeader />

      <main>
        {/* ── The hero: what this is, and what it looks like ───────────────
            Two sections rather than one column, and each one sets the measure
            on its OWN inner wrapper. ⚠️ `mx-auto w-full max-w-5xl px-4 sm:px-6`
            is copied from `PublicHeader` character for character, and it has to
            be: the header's brand mark and this page's <h1> share a left edge,
            and a page one breakpoint narrower than its own header puts them
            ~130 px apart. ⚠️ Hanging the padding on the <section> and leaving
            the wrapper bare is the version of this that looks right: the page
            is still composed, the sections still line up with EACH OTHER, and
            only the header disagrees. Measured on this tree by writing it, at
            1280 px: the <h1> lands at 120.5 and the brand mark at 144.5, 24 px
            out (16 below `sm`, where the padding step is `px-4`). That is small
            enough to survive a look and large enough to see once somebody puts
            a ruler on it — which is why the construction is copied rather than
            re-derived. The MEASURE of the text is set per element below instead
            — the column is wide, the text inside it is not. */}
        <section className="py-20 sm:py-28">
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
            <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-10">
              {/* Left-aligned, not centred. A centred hero over three icon
                  cards is the silhouette every generated app has; the content
                  is the same and the shape is not. */}
              <div className="max-w-3xl">
                <Badge variant="secondary" className="mb-5">
                  {t("badge")}
                </Badge>
                <h1 className="text-4xl font-semibold text-balance sm:text-5xl">
                  {t("title", { app: APP_NAME })}
                </h1>
                <p className="text-muted-foreground mt-5 max-w-xl text-lg text-pretty">
                  {t("subtitle")}
                </p>

                <div className="mt-8 flex flex-wrap gap-3">
                  <Button asChild size="lg">
                    <Link href="/login">
                      {t("signIn")}
                      <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="outline">
                    <Link href="/plans">{t("plans")}</Link>
                  </Button>
                </div>
              </div>

              {/* ── The visual: the app's own shape, drawn from its own tokens ──
                  The header bar, the rail and the card surfaces of
                  `components/app-shell.tsx`, at miniature — the same
                  construction, the same tokens, so a rebrand moves this picture
                  with the app instead of leaving it behind.

                  It claims NOTHING. No number, no name, no chart, no
                  testimonial — a frame with empty surfaces is honest, a frame
                  with figures in it is a screenshot of an app that does not
                  exist, and docs/salespage.md's honesty rules exist for exactly
                  that instinct.

                  Nothing here is a file, deliberately. app/opengraph-image.tsx
                  makes the argument in full for the share card: a static
                  placeholder would say "Your App" on every customer's link
                  preview for ever, and what is drawn from tokens is never
                  stale. Same conclusion here, which is why public/ gains no
                  asset and this is not an inline <svg> either —
                  components/brand-mark.tsx spends 25 lines on why SVG is
                  dangerous in this app, and no test would fire on one written
                  into a page.

                  ⚠️ WHAT REPLACES IT. The skill `salespage` (reference:
                  docs/salespage.md) replaces this WHOLE page for a real
                  product — this block is not a thing to carry into the new one.
                  Its successor is a <Figure> (components/ui/figure.tsx, which
                  makes alternative text a compile error rather than a finding)
                  holding a real screenshot of the app somebody actually built.
                  There is no <Figure> here because there is nothing yet to put
                  in one: an app with no pages of its own has no screenshot.

                  `aria-hidden`, and absent below `sm`. It is decoration — the
                  headline and the <dl> below are where the information is, and
                  a screen reader gets those. A 380 px column has no room for a
                  frame drawn in miniature (the rail alone would be a sliver),
                  so the hero there is the headline and the two buttons, as
                  before. */}
              <div aria-hidden className="hidden sm:block">
                {/* 🚨 `overlay` is deliberate and measured, and it carries no
                    `!`; app/login/ui.tsx carries the reasoning in full above
                    its own <Card> and this does not restate it. Short version:
                    `raised` is the step <Card> already wears, so it cannot make
                    this frame read as a thing lying ON the page; and the base
                    shadow used to win here because tailwind-merge 2.6.1 does
                    not know Tailwind v4's parenthesised custom-property
                    shorthand — which `cn()` now teaches it in lib/utils.ts, so
                    the `!` this line used to need is gone rather than merely
                    redundant. The dial is a VALUE either way — never a size
                    word out of Tailwind's vocabulary, which
                    `node run.mjs ux-check` counts.

                    `bg-background` on the frame, `bg-card` on the surfaces
                    inside it: that is the app's real construction, not a
                    decoration choice. In dark mode app/globals.css lifts
                    `--card` a shade above the page on purpose, so the surfaces
                    separate; in light both are white and the borders do the
                    work — which is exactly what the app itself looks like. */}
                <Card className="bg-background gap-0 overflow-hidden p-0 shadow-(--elevation-overlay)">
                  {/* The header bar: the mark's tile, a label, and the one
                      place the accent lands on an action. */}
                  <div className="flex h-9 items-center gap-2 border-b px-3">
                    <span className="bg-foreground size-4 rounded-md" />
                    <span className="bg-muted-foreground/25 h-2 w-20 rounded-full" />
                    <span className="bg-primary ml-auto h-4 w-14 rounded-md" />
                  </div>

                  <div className="flex">
                    {/* The rail — `bg-card` and a right border, as
                        components/app-shell.tsx has it. It has no breakpoint of
                        its own on purpose: the real sidebar folds away below
                        `lg` because the VIEWPORT is narrow, and this frame is a
                        picture rather than a viewport. Measured at 768 px with
                        the rail folded, the frame stops reading as an app at
                        all — a bar over two boxes. Whenever the frame is shown
                        it shows the whole shape; below `sm` it is absent
                        instead. */}
                    <div className="bg-card flex w-24 shrink-0 flex-col gap-2 border-r p-3">
                      <span className="bg-primary h-2 w-full rounded-full" />
                      <span className="bg-muted-foreground/25 h-2 w-4/5 rounded-full" />
                      <span className="bg-muted-foreground/25 h-2 w-3/5 rounded-full" />
                      <span className="bg-muted-foreground/25 h-2 w-3/4 rounded-full" />
                    </div>

                    {/* The content surfaces. Empty on purpose. */}
                    <div className="grid flex-1 grid-cols-2 gap-3 p-3">
                      <div className="bg-card col-span-2 space-y-2 rounded-lg border p-3">
                        <span className="bg-muted-foreground/25 block h-2 w-1/3 rounded-full" />
                        <span className="bg-muted-foreground/25 block h-2 w-1/2 rounded-full" />
                      </div>
                      <div className="bg-card h-14 rounded-lg border" />
                      <div className="bg-card h-14 rounded-lg border" />
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        </section>

        {/* ── What is already wired in ─────────────────────────────────────
            A section of its own, separated by a rule rather than by nothing —
            and its inner wrapper repeats the header's measure exactly, for the
            reason written above the hero. */}
        <section className="border-t py-16 sm:py-20">
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
            {/* One card holding a spec sheet, rather than three cards holding
                one sentence each. A <dl> is what this content actually is — a
                list of terms and what they mean — and it survives being read on
                a phone, where three columns become three stacked cards of
                mostly padding. */}
            <Card className="max-w-3xl">
              <CardContent>
                <h2 className="mb-4 text-sm font-medium">
                  {t("includedTitle")}
                </h2>
                <dl className="divide-border divide-y">
                  {included.map(({ term, body }) => (
                    <div
                      key={term}
                      className="grid gap-1 py-4 first:pt-0 last:pb-0 sm:grid-cols-[11rem_1fr] sm:gap-6"
                    >
                      <dt className="font-medium">{t(term)}</dt>
                      <dd className="text-muted-foreground text-sm text-pretty">
                        {t(body)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>

            {/* Only while billing is not set up yet — after that the notice
                disappears from the public page on its own. */}
            {!hasDigistoreApiKey() && (
              <Callout variant="info" className="mt-10 max-w-3xl">
                {t.rich("setupHint", {
                  code: (chunks) => <code>{chunks}</code>,
                })}
              </Callout>
            )}
          </div>
        </section>
      </main>

      {/* The legal links. Public pages need them most: § 5 DDG asks for the
          Impressum to be reachable, and the person deciding whether to sign up
          is exactly the person who has to be able to read the privacy policy
          first. */}
      <SiteFooter />
    </>
  );
}
