// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { GeistMono } from "geist/font/mono";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { APP_NAME } from "@/lib/app";
import { PWA_THEME_COLOR, PWA_THEME_COLOR_DARK } from "@/lib/pwa/manifest";

// The app's BODY typeface — Figtree, one variable file covering every weight.
// The HEADING face is the second call below; both are role variables, and
// app/globals.css turns them into `--font-sans` and `--font-heading`.
//
// 🚨 `next/font/local`, NOT `next/font/google`, and that is the whole point of
// this block. `next/font/google` downloads the files from fonts.gstatic.com at
// BUILD time, and `next build` runs on the customer's host inside their deploy.
// A new outbound request in a release chain is a failure mode this template
// does not have today and must not acquire: `@fontsource-variable/figtree`
// ships the woff2 in the package, exactly as `geist` does for the mono below
// and `@fontsource-variable/source-serif-4` does for the headings.
// Runtime is identical either way — the file is served from this app's own
// origin, so the no-consent stance in docs/compliance.md is untouched.
//
// Changing a typeface is the skill `design`, and the rule this block defends
// does not move with the choice: a face arrives as a package whose files are
// already on disk and is loaded through `next/font/local`. Never
// `next/font/google` — that puts a fetch to fonts.gstatic.com into the
// customer's release chain, and it is the one property of this arrangement
// that is invisible until it fails, on somebody else's deploy host. Which is
// also why the variables are named after their ROLE rather than after the
// fonts currently sitting on them — see docs/design-system.md → Typography.
const appSans = localFont({
  src: "../node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2",
  variable: "--font-app-sans",
  display: "swap",
  weight: "300 900",
  // The shipped locales (de, en) live inside `latin`; `latin-ext` is a second
  // file and buys nothing until i18n/config.ts grows a locale that needs it.
  fallback: ["system-ui", "-apple-system", "sans-serif"],
});

// The app's HEADING typeface — Source Serif 4, and it ships FILLED.
//
// A second role variable holding Figtree would be a slot standing open: the
// mechanism would be there, the default look would be exactly as generic as
// before, and "there is a heading dial" would be a sentence rather than
// something anybody can see. So the shipped default is a real second voice —
// a serif beside the sans, which is the one pairing that reads as a decision
// rather than as a second sans.
//
// 🚨 The filename is NOT Figtree's shape, and that is a property of the family
// rather than a typo to tidy. Source Serif 4 has TWO variable axes (`wght`
// 200–900 and `opsz` 8–60), so `@fontsource-variable/source-serif-4` ships
// three latin cuts: `-standard-` and `-opsz-` carry both axes at 122,360 bytes,
// `-wght-` carries the weight axis alone at 50,824 bytes with `opsz` pinned at
// its default of 14. This app takes the `wght` file. The optical-size axis
// would buy finer hairlines above ~30 px and costs 71,536 bytes on every page
// for it — the app's headings run 24 px to 48 px, which is the sturdy end of
// that axis anyway, and a 2.4× file for a refinement nobody asked for is the
// wrong trade in a template. Read the directory before changing this line;
// the names differ per family and a wrong one is a build error at best.
//
// The reach of this face is ONE rule in app/globals.css and it is `h1` alone.
// The argument lives there, next to the rule.
const appHeading = localFont({
  src: "../node_modules/@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2",
  variable: "--font-app-heading",
  display: "swap",
  weight: "200 900",
  // Same `latin`-only reasoning as the sans above. The fallback is a SERIF
  // chain rather than the sans one: this variable exists to be a different
  // voice, so the stand-in while the file loads should be too. Falling back
  // onto the body sans is a different question and a different mechanism —
  // app/globals.css's `var(--font-app-heading, var(--font-app-sans))`, which
  // fires when this call is deleted rather than when the file is slow.
  fallback: ["Georgia", "Times New Roman", "serif"],
});

// The colour of the browser's own bar around the page — the one part of this
// app CSS cannot reach, and the one that shows up hardest on a phone, where the
// bar sits directly above `AppShell`'s header.
//
// Two entries rather than one, because the app has two modes and a white strip
// above a black page is the most visible thing on a small screen.
//
// ⚠️ **This follows the OPERATING SYSTEM, not the toggle in the header.**
// next-themes switches by a CLASS on <html> (`app/globals.css` says so in its
// first block), and `prefers-color-scheme` cannot see a class. So somebody who
// forced "dark" on a light phone keeps a light bar. Fixing that would mean a
// client effect rewriting a <meta> after hydration — one more DOM write on
// every page load, before React settles, in the app whose hydration story is
// already documented at length in `app/darkreader-lock.test.ts`. Not worth a
// one-pixel strip; written down so the next reader does not think it was
// overlooked.
//
// The values come from `lib/pwa/manifest.ts`, where a test holds them against
// the tokens in `app/globals.css` — a hex typed in here would drift away from a
// recolour in silence.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: PWA_THEME_COLOR },
    { media: "(prefers-color-scheme: dark)", color: PWA_THEME_COLOR_DARK },
  ],
};

/**
 * The origin share-card addresses are resolved against.
 *
 * Same read and same validity check as `lib/email.ts` — an `APP_URL` that is
 * not an http(s) address is worse than none, because `new URL()` throws and
 * takes every page down with it. `undefined` costs a build warning and a
 * relative `og:image`, which is a bad share card rather than a dead app.
 */
function metadataBase(): URL | undefined {
  const base = process.env.APP_URL?.trim();
  if (!base || !/^https?:\/\//i.test(base)) return undefined;
  try {
    return new URL(base);
  } catch {
    return undefined;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home");
  return {
    // `template` appends the app name to every page title: "Plans · Your App".
    title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
    description: t("subtitle"),
    // Without a base, Next resolves the share card's address relative to
    // nothing and warns on every build; a crawler needs it absolute anyway.
    // `APP_URL` is the same variable `lib/email.ts` builds its links from.
    metadataBase: metadataBase(),
    // What a pasted link shows in WhatsApp, Slack, LinkedIn and X. The picture
    // is `app/opengraph-image.tsx` and needs no entry here — Next finds it by
    // file name and fills in `images` itself, which is also why no size or
    // path is repeated in this file.
    //
    // ⚠️ These two are SIBLINGS of `other` below, never members of it.
    // `app/pwa-metadata.test.ts` and `app/darkreader-lock.test.ts` both pin
    // `other` as an object with exactly one key, so folding anything in there
    // fails two tests at once — and the reason `other` is pinned that tightly
    // is that Dark Reader's lock is the app's whole answer to a hydration
    // mismatch nobody can reproduce.
    openGraph: {
      type: "website",
      siteName: APP_NAME,
      title: APP_NAME,
      description: t("subtitle"),
    },
    twitter: {
      card: "summary_large_image",
      title: APP_NAME,
      description: t("subtitle"),
    },
    // What iOS needs beyond the manifest. Safari has read the manifest since
    // 16.4, but the label under the home-screen icon and the standalone window
    // still come from here.
    //
    // `statusBarStyle: "default"` and NOT "black-translucent": the translucent
    // one draws the page UNDER the notch, and then every page in this app would
    // need `viewport-fit=cover` plus safe-area padding it does not have. The
    // symptom is a heading sitting behind the clock.
    //
    // Measured, so nobody goes looking for it: `capable: true` reaches the page
    // as `<meta name="mobile-web-app-capable">` — Next emits the standardised
    // name, not the old `apple-mobile-web-app-capable`. On iOS 16.4 and later
    // the standalone window comes from the manifest's `display` anyway, and
    // that is the version from which Safari reads a manifest at all.
    appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
    // Asks the Dark Reader browser extension to leave this page alone — it has
    // a dark mode of its own (next-themes, the toggle in the header). Without
    // it the extension writes `data-darkreader-*` into every SVG BEFORE React
    // hydrates, and the first page view reports a hydration mismatch that is
    // not in this app's code at all. Officially provided for
    // (darkreader/CONTRIBUTING.md → "Disabling Dark Reader on your site").
    // Dark Reader only checks that the tag is THERE — its own test reads
    // `document.querySelector('meta[name="darkreader-lock"]') != null`, so the
    // content is never looked at. It says `"true"` because Next silently drops
    // an `other` entry whose value is the empty string, and then nothing ships.
    // A browser without the extension ignores an unknown meta name.
    // See `docs/troubleshooting.md` → A hydration mismatch is not always yours.
    other: { "darkreader-lock": "true" },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();

  return (
    // suppressHydrationWarning: next-themes sets the theme class on <html>
    // before React hydrates — the mismatch is intended and affects only this
    // one element.
    //
    // It is worth knowing what this does NOT cover: the attribute works one
    // level deep only. It says nothing about anything inside <body>, so it is
    // no answer to a browser extension rewriting the markup — that is what the
    // `darkreader-lock` above is for. Reaching for a second
    // suppressHydrationWarning further down the tree is the mistake this note
    // exists to prevent; it would silence the report without changing the DOM.
    //
    // All three faces ship as files in npm packages (no fetch from Google Fonts
    // at build time — see the `appSans` block above) and hang off <html> as CSS
    // variables; app/globals.css wires them up via --font-sans, --font-heading
    // and --font-mono. A variable that is not on this element is a variable
    // nothing on the page can read, which is why adding a font is two edits and
    // not one.
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${appSans.variable} ${appHeading.variable} ${GeistMono.variable}`}
    >
      <body>
        {/* Passes locale and texts down to all client components —
            `useTranslations()` only works inside this provider. */}
        <NextIntlClientProvider>
          <ThemeProvider>
            <TooltipProvider delayDuration={300}>
              {/* "You are signed in as somebody else." Renders nothing at all
                  unless an Operator is inside a customer's account — but it is
                  HERE, above every page including the public ones, because the
                  moment it is missing from one is the moment somebody forgets.
                  It reads the session token only; no query. See the component. */}
              <ImpersonationBanner />
              {children}
              {/* Short messages after an action ("saved", "deleted"). Sits
                  here once for the whole app — in pages just call
                  `toast.success(...)` from `sonner`, or use the
                  `useActionToast` hook. */}
              <Toaster position="bottom-right" richColors />
            </TooltipProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
