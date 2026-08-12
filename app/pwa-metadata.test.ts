// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The three declarations that turn this app into something a phone can install.
//
// Two of them are one-liners in `app/layout.tsx` with no visible effect on any
// machine anybody here develops on:
//
//   - `export const viewport` → the colour of the browser's own bar around the
//     page, the one thing about this app CSS cannot reach. Wrong or missing, it
//     is a white strip above a black page — visible only on a phone.
//   - `appleWebApp` → the label under the icon and whether iOS gives the
//     installed app a window of its own instead of Safari's chrome.
//
// The third is `app/manifest.ts` existing at all, and being the six-line
// wrapper around the tested function rather than a second, untested copy of the
// same decisions.
//
// Asserted on the source text, for the same reasons `app/darkreader-lock.test.ts`
// gives at length: vitest runs with `environment: "node"`, and both
// `generateMetadata()` and the manifest route need a request context they
// cannot have here. What the manifest SAYS is `lib/pwa/manifest.test.ts`; this
// file only proves it is wired up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";
import { blankComments as withoutComments } from "@/scripts/lib/source-text.mjs";

const LAYOUT = fileURLToPath(new URL("./layout.tsx", import.meta.url));
const MANIFEST_ROUTE = fileURLToPath(new URL("./manifest.ts", import.meta.url));

describe("the root layout declares what an installed app needs", () => {
  const code = withoutComments(readFileSync(LAYOUT, "utf8"));

  it("was read at all", () => {
    // Non-vacuity — the failure mode of every source-level test.
    expect(code).toMatch(/export default async function RootLayout/);
  });

  it("exports a viewport with a theme colour for both modes", () => {
    expect(
      code,
      "app/layout.tsx no longer exports `viewport` with a themeColor.\n" +
        "That is the colour of the browser's own bar around the page — on an\n" +
        "installed app it is the strip above the header, and without it the\n" +
        "system picks one that matches neither mode.",
    ).toMatch(/export const viewport\s*:\s*Viewport/);
    expect(
      code,
      "themeColor must carry BOTH prefers-color-scheme entries. One value is a\n" +
        "light bar above a black page for every customer in dark mode, which is\n" +
        "the most visible thing on a phone.",
    ).toMatch(/prefers-color-scheme:\s*light[\s\S]*prefers-color-scheme:\s*dark/);
  });

  it("takes its colours from lib/pwa/manifest, not from a second copy", () => {
    // A hex literal typed in here is a hex literal the manifest's own colour
    // test cannot see — and `app/globals.css` would drift away from it silently.
    expect(code).toMatch(/PWA_THEME_COLOR\b/);
    expect(code).toMatch(/PWA_THEME_COLOR_DARK\b/);
    expect(
      code.slice(code.indexOf("export const viewport")),
      "a colour written into app/layout.tsx by hand is outside every check that\n" +
        "holds the manifest and app/globals.css together.",
    ).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("declares itself web-app capable for iOS", () => {
    expect(
      code,
      "iOS reads the manifest since 16.4, but the label under the icon and the\n" +
        "standalone window still come from `appleWebApp`.",
    ).toMatch(/appleWebApp:\s*\{[^}]*capable:\s*true/);
    expect(code).toMatch(/appleWebApp:\s*\{[^}]*title:/);
  });

  it("does not ask for a translucent status bar", () => {
    // "black-translucent" draws the page UNDER the notch, and then every page
    // of this app would need `viewport-fit=cover` plus safe-area padding it
    // does not have. The symptom is a heading behind the clock.
    expect(code).not.toMatch(/black-translucent/);
  });

  it("still declares the Dark Reader lock", () => {
    // Pinned a second time on purpose: adding metadata is exactly the moment
    // somebody rewrites this object and loses the line that has no visible
    // effect. `app/darkreader-lock.test.ts` says why it matters.
    expect(code).toMatch(/other:\s*\{\s*"darkreader-lock":\s*"[^"]+"\s*\}/);
  });

  it("still adds nothing by hand-writing a <head>", () => {
    expect(
      code,
      "Next inserts <link rel=\"manifest\"> by itself once app/manifest.ts\n" +
        "exists — a hand-written <head> is never the way to add a tag here.",
    ).not.toMatch(/<head[\s>]/);
  });
});

describe("the manifest route", () => {
  const code = withoutComments(readFileSync(MANIFEST_ROUTE, "utf8"));

  it("was read at all", () => {
    expect(code).toMatch(/export default async function manifest/);
  });

  it("returns the function lib/pwa/manifest.test.ts asserts", () => {
    // The whole point of the split. A route that built its own object would be
    // a second set of the same decisions, and the tested one would be dead code.
    expect(code).toMatch(/import\s*\{[^}]*buildManifest[^}]*\}\s*from\s*"@\/lib\/pwa\/manifest"/);
    expect(code).toMatch(/return\s+buildManifest\(/);
  });

  it("reads the request's own host rather than a configured address", () => {
    // `related_applications` has to name THIS origin or
    // `getInstalledRelatedApps()` answers a silent [] — and then the install
    // hint never goes away, with nothing saying why. A stale APP_URL is exactly
    // how that happens.
    expect(code).toMatch(/x-forwarded-host/);
    expect(code).not.toMatch(/APP_URL/);
  });
});
