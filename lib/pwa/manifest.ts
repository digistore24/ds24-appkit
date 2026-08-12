// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What a browser is told when somebody puts this app on a home screen.
//
// ── Why this is a pure function and app/manifest.ts is six lines ─────────────
// `app/manifest.ts` is a Next file convention: it runs as a route handler and
// there is no request context in vitest (`environment: "node"`), so calling it
// from a test throws before anything can be looked at. The CONTENT — which
// icons, which colours, which start_url — is exactly the part that has to be
// pinned, so it lives here, takes the origin as an argument, and is asserted in
// `lib/pwa/manifest.test.ts` like any other rule module in this app.
//
// ── Why the origin is an argument at all ────────────────────────────────────
// One field needs it: `related_applications[].url`. That entry is what makes
// `navigator.getInstalledRelatedApps()` work (Chrome on Android), and it is the
// ONLY way this app can find out that it is ALREADY installed — this template
// ships no service worker, so `beforeinstallprompt` never fires on its own and
// there is no second signal. Without it the hint would go on nagging somebody
// who installed the app weeks ago, which is the one thing it must not do.
//
// Everything else is deliberately RELATIVE, so the same file is correct on
// localhost, on staging and in production.
import type { MetadataRoute } from "next";

import { APP_NAME } from "@/lib/app";

type PwaIcon = NonNullable<MetadataRoute.Manifest["icons"]>[number];

/**
 * The icons, and the only place their sizes are written down.
 *
 * 🚨 The `sizes` string is not decoration — `manifest.test.ts` reads the PNG
 * header of every one of these files and fails when the pixels disagree. A
 * manifest that promises 512×512 and ships a 256×256 makes Chrome refuse to
 * install the app while saying nothing useful about why.
 *
 * ⚠️ **The maskable icon is a separate FILE, not a second purpose on the same
 * one.** Android crops it to whatever shape the launcher uses (circle,
 * squircle, teardrop), so its artwork needs about 20 % padding all round. The
 * same bitmap declared both ways is either a logo with a hole punched in it or
 * a postage stamp in the middle of a square.
 *
 * These are PLACEHOLDERS, exactly like `app/icon.png`. All five icon files are
 * replaced together — see `docs/design-system.md` §4 (*The brand assets*), and
 * the skill `design`.
 */
export const PWA_ICONS = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  {
    src: "/icons/icon-maskable-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
] as const satisfies readonly PwaIcon[];

/**
 * The splash screen's background, and the bar above the installed app.
 *
 * Both are `--background` from `app/globals.css` in its LIGHT value, and both
 * are deliberate:
 *
 *  · `background_color` paints the splash BEFORE a line of CSS has run. This
 *    app's own first paint is the light surface unless the device says
 *    otherwise, and a dark splash followed by a light app is a visible flash.
 *  · `theme_color` sits directly above `AppShell`'s header, which is
 *    `bg-background/80`. `--primary` here would put a petrol strip on top of a
 *    white bar — a seam, not a brand.
 *
 * A manifest holds ONE value for each; the dark answer is live and lives in
 * `app/layout.tsx` → `export const viewport`, which carries a
 * `prefers-color-scheme` pair. `manifest.test.ts` pins all three against the
 * tokens, so a recolour cannot leave the manifest behind.
 */
export const PWA_BACKGROUND_COLOR = "#ffffff";
export const PWA_THEME_COLOR = "#ffffff";

/** `--background` in `.dark`. Used by `app/layout.tsx` only. */
export const PWA_THEME_COLOR_DARK = "#110f0e";

// The share card (`app/opengraph-image.tsx`). Three more mirrors of the same
// tokens, and they live HERE rather than in that route for one reason:
// `app/pwa-metadata.test.ts` forbids a hex literal anywhere in `app/layout.tsx`
// below `export const viewport`, and the argument behind that rule — a colour
// typed into a page drifts away from a recolour in silence — reaches the share
// card just as hard. Nobody ever looks at their own link preview.
//
// `manifest.test.ts` pins all three against `app/globals.css`, so a recolour
// cannot leave the card behind. An `ImageResponse` cannot read a CSS variable:
// it renders outside the document, so the values have to be literals somewhere,
// and somewhere is one file with a test on it.
/** `--background` in `:root` — the card's surface. */
export const OG_BACKGROUND = "#ffffff";
/** `--foreground` in `:root` — the app's name on it. */
export const OG_FOREGROUND = "#161412";
/** `--primary` in `:root` — the one stroke of brand colour on the card. */
export const OG_ACCENT = "#076a7e";

/**
 * A name that survives a home screen: Android shows roughly twelve characters
 * under an icon and truncates the rest with an ellipsis.
 *
 * Pure and tested, because `APP_NAME` is whatever the operator put in
 * `NEXT_PUBLIC_APP_NAME`, and "Die Steuer-Werkstatt für Handwerker" is a name
 * somebody will use.
 */
export function shortAppName(name: string, max = 12): string {
  const trimmed = name.trim();
  if (trimmed.length <= max) return trimmed;
  // Cut on a word boundary when there is one inside the budget — "Mein grosses"
  // reads, "Mein grosses P" does not.
  const head = trimmed.slice(0, max + 1);
  const space = head.lastIndexOf(" ");
  return (space > 0 ? head.slice(0, space) : trimmed.slice(0, max)).trim();
}

/**
 * The origin this request arrived on, taken from its headers.
 *
 * Pure, so the proxy cases are testable. Deliberately NOT `APP_URL`: this value
 * is compared by the BROWSER against the origin of the page that calls
 * `getInstalledRelatedApps()`. A stale `APP_URL` would not produce a broken
 * link — it would produce a silent empty answer, i.e. an install hint that
 * never goes away, with nothing anywhere saying why. It is the same stance the
 * sign-in link takes (`trustHost: true`, no `AUTH_URL`); `APP_URL` is for
 * addresses that get mailed OUT.
 */
export function originFrom(headers: {
  host?: string | null;
  forwardedHost?: string | null;
  forwardedProto?: string | null;
}): string {
  const host = headers.forwardedHost ?? headers.host ?? "localhost:3000";
  // No proxy header (a plain `next start`, or the dev server): a local host is
  // http, anything else is https. Guessing http for a real domain would put an
  // insecure URL in the manifest of an app that is only installable over https
  // in the first place.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
  const proto = headers.forwardedProto ?? (local ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * The whole manifest.
 *
 * Five fields decide whether Chrome offers installation at all — `name` or
 * `short_name`, `icons` carrying 192 AND 512, `start_url`, `display`, and
 * `prefer_related_applications` not being `true` — and each is asserted by name
 * in `manifest.test.ts` rather than left to a reviewer's eye.
 */
export function buildManifest(origin: string): MetadataRoute.Manifest {
  return {
    // Identity, for the lifetime of every installation. Relative, so it
    // resolves against the origin the app is served from.
    // 🚨 Never change this line: a new id is a NEW app, and the old icon stays
    // on the customer's home screen pointing at nothing.
    id: "/",

    name: APP_NAME,
    short_name: shortAppName(APP_NAME),

    // ⚠️ No `description`, and that is a decision. It would have to be
    // translated, `getTranslations()` reads the locale cookie, and a manifest
    // that reads a cookie is rendered per request for a string Android shows in
    // one dialog. `APP_NAME` is a proper noun and is not translated either
    // (`lib/app.ts`), so this file stays free of i18n.

    // Everything under the origin belongs to the app. A narrower scope would
    // push `/`, `/plans` and `/login` out of the installed window and back into
    // the browser — a Digistore24 checkout leaves it either way, and comes back
    // through `/optin/[orderId]`.
    scope: "/",

    // Where the icon lands. NOT "/": the salespage is for strangers, and
    // somebody who put this app on their home screen is not one. A signed-out
    // visitor is sent to /login from here, inside the scope, which is the
    // honest answer.
    // ⚠️ On iOS the installed app has its own cookie store, so that sign-in
    // really is a second one — `docs/mobile.md` →
    // *On iPhone the installed app signs in separately*.
    start_url: "/dashboard",

    display: "standalone",

    background_color: PWA_BACKGROUND_COLOR,
    theme_color: PWA_THEME_COLOR,

    icons: [...PWA_ICONS],

    // Not a native app in a store — never suggest one. This is also the single
    // boolean that switches installability off completely, which is why it is
    // written out rather than left absent beside the entry below.
    prefer_related_applications: false,

    // 🚨 What `navigator.getInstalledRelatedApps()` matches against, and the
    // app's only way to know it is already installed. `platform` must be the
    // literal string "webapp", and `url` must be the ABSOLUTE address of this
    // very manifest on this very origin — otherwise the answer is a silent [].
    related_applications: [{ platform: "webapp", url: `${origin}/manifest.webmanifest` }],
  };
}
