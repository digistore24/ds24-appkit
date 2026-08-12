// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PlugZap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";

// Where Digistore24 sends the browser back after the operator has approved the
// API access — the `return_url` of `node run.mjs ds24-connect`
// (scripts/ds24/connect-api-key.mjs).
//
// It exists because the setup script used to open a second, short-lived web
// server for this one request, and that server was regularly gone by the time
// anybody finished clicking: the browser then said "this page cannot be loaded"
// while the approval had actually succeeded. The app's own server is running
// anyway and is still there minutes later, so the browser is sent here instead.
//
// This page carries NO part of the mechanism. It never sees the API key: that
// is fetched by the script itself, straight from Digistore24 (`retrieveApiKey`),
// and the script finds out about the approval by asking — not by being called.
// So there is nothing here to read out of the URL, nothing to store, and the
// setup completes even if this page is never loaded at all. It is a courtesy to
// whoever is looking at the browser, and that is the whole job.
//
// Public by design: it sits outside the `proxy.ts` matcher, and it has to. The
// person approving at Digistore24 is setting the app up — they routinely have
// no account in it yet.
export default async function Ds24ConnectedPage() {
  const t = await getTranslations("ds24Connected");

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
            <PlugZap className="size-6" />
          </span>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
        </div>

        {/* The card is NEW here, and it is deliberate rather than a pattern
            applied on the way past. This page and app/account/confirm-email
            carry exactly the same content — a Callout saying what happened and
            one button saying where to go next — and that page has shipped it
            inside a <Card> since it was written. So the card is this tree's own
            answer to this shape, not an invention; leaving it off is what would
            give the app two faces on one frame, which is the defect the story
            is about. What the page SAYS is untouched: the medallion and the
            heading stay above the surface, exactly as the mark does on
            /login. */}
        <Card className="shadow-(--elevation-overlay)">
          <CardContent className="flex flex-col gap-4">
            <Callout variant="success">{t("body")}</Callout>

            <Button asChild className="w-full">
              <Link href="/">{t("cta")}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
