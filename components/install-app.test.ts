// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `components/install-app.tsx` is a client component and this repo has no DOM
// test environment (vitest runs with `environment: "node"`), so its effect —
// the part that reads the browser — cannot be executed here. What it decides
// lives in `lib/pwa/rules.ts` and is tested there, against real user agents.
//
// What is left for this file is the wiring, and it is not nothing: the two
// mistakes that would ship silently are a component that renders something on
// the server (a hydration mismatch on the first page view of every customer)
// and a second key quietly appearing in the customer's device storage without
// `docs/compliance.md` learning about it.
//
// Same two-part shape as `components/app-shell.test.ts`: an SSR probe, then
// assertions on the source TEXT with comments blanked — this file explains its
// own rules in prose, and a regex that did not blank them would report the
// explanation as the violation.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

import { blankComments } from "@/scripts/lib/source-text.mjs";
import { findPaletteClasses } from "@/scripts/ux/rules.mjs";
import { appTimeZone } from "@/i18n/catalogue";
import de from "@/messages/de.json";

import { InstallHint } from "./install-app";

const SOURCE = fileURLToPath(new URL("./install-app.tsx", import.meta.url));
const COMPLIANCE = fileURLToPath(new URL("../docs/compliance.md", import.meta.url));

const code = blankComments(readFileSync(SOURCE, "utf8"));

describe("the install offer on the server", () => {
  it("renders nothing at all", () => {
    // 🚨 The server knows none of it — not the display mode, not a held
    // prompt, not whether this device already carries the icon. Rendering
    // anything here is a hydration mismatch, and it would be the loud kind:
    // a whole Callout against nothing.
    //
    // ⚠️ `useEffect` does NOT run in `renderToStaticMarkup`, so this proves the
    // FIRST render and nothing after it. Everything the effect does is proven
    // on a real phone — see docs/mobile.md.
    //
    // `timeZone` is not decoration: without it use-intl reports ENVIRONMENT_FALLBACK
    // ("markup mismatches caused by environment differences") on every run, which is
    // the one warning `appTimeZone()` exists to prevent — see its doc comment. The
    // app never renders this component without a zone (`i18n/request.ts`), so a
    // provider built here without one measures a configuration no request has.
    const markup = renderToStaticMarkup(
      createElement(NextIntlClientProvider, {
        locale: "de",
        timeZone: appTimeZone(),
        messages: de,
        children: createElement(InstallHint),
      }),
    );
    expect(markup).toBe("");
  });
});

describe("the install offer's source", () => {
  it("was read at all", () => {
    // Non-vacuity: a path that stopped resolving would make every assertion
    // below pass by examining an empty string.
    expect(code).toMatch(/export function InstallHint/);
    expect(code).toMatch(/export function InstallAppMenuItem/);
  });

  it("is a client component", () => {
    expect(code).toMatch(/^\s*"use client";/m);
  });

  it("holds the browser's own prompt instead of letting it go", () => {
    // Without `preventDefault()` Chrome shows its own mini-infobar, the event
    // is gone, and this notice competes with a bar it can no longer replace.
    const handler = code.slice(code.indexOf("beforeinstallprompt"));
    expect(handler).toMatch(/event\.preventDefault\(\)/);
  });

  it("takes back every listener it adds", () => {
    // The module-level wiring is deliberately permanent (one per document), so
    // what has to balance is the SUBSCRIBER set the components join.
    const joins = code.match(/subscribers\.add\(/g) ?? [];
    const leaves = code.match(/subscribers\.delete\(/g) ?? [];
    expect(joins.length).toBeGreaterThan(0);
    expect(leaves.length).toBe(joins.length);
  });

  it("never treats a rejected capability check as an answer", () => {
    // `getInstalledRelatedApps()` exists on Chrome/Android and nowhere else. A
    // rejection means "we do not know" — reading it as "installed" would
    // silence the offer in every other browser.
    expect(code).toMatch(/getInstalledRelatedApps\?\.\(\)/);
    expect(code).toMatch(/\.catch\(\(\)\s*=>\s*\{\}\)/);
  });

  it("writes exactly one entry to the customer's device", () => {
    // 🚨 The guard on the paragraph below. Two keys, or a renamed one, and the
    // inventory in docs/compliance.md quietly stops describing the app.
    const keys = new Set(code.match(/"ds24:[^"]+"/g) ?? []);
    expect(keys.size).toBe(2); // the stored decision, plus the per-tab marker
    const stored = code.match(/const STORAGE_KEY = "([^"]+)"/);
    expect(stored).not.toBeNull();
    const compliance = readFileSync(COMPLIANCE, "utf8");
    expect(
      compliance,
      `docs/compliance.md does not name "${stored?.[1]}".\n` +
        "Everything this app puts on a customer's device is listed there under\n" +
        "TDDDG § 25 — a fourth entry that is not in the list makes that document\n" +
        "wrong, and the privacy policy is written from it.",
    ).toContain(stored?.[1] ?? "");
  });

  it("survives a storage that refuses", () => {
    // Safari in private mode throws on `localStorage.setItem`. An offer that
    // took the whole dashboard down with it would be a poor trade for an icon.
    expect(code).toMatch(/try\s*\{[\s\S]*localStorage[\s\S]*?\}\s*catch/);
  });

  it("says nothing in its own words", () => {
    // Every sentence belongs in messages/de.json and messages/en.json.
    expect(code).toMatch(/useTranslations\("pwa"\)/);
  });

  it("uses the shipped Callout rather than a box of its own", () => {
    // CLAUDE.md → UI: three feedback mechanisms, never a fourth. A notice that
    // stays until the state changes is a Callout, and its colours are the ones
    // checked in both modes.
    expect(code).toMatch(/<Callout variant="info"/);
    expect(findPaletteClasses(code)).toEqual([]);
  });

  it("is not sticky", () => {
    // `AppShell`'s header is `sticky top-0 z-30`; a second sticky element on
    // the same edge is the collision components/impersonation-banner.tsx
    // spells out at length.
    expect(code).not.toMatch(/\bsticky\b/);
  });
});
