// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseHsl, parseTokens } from "@/scripts/ux/rules.mjs";

import {
  buildManifest,
  originFrom,
  shortAppName,
  PWA_BACKGROUND_COLOR,
  PWA_ICONS,
  PWA_THEME_COLOR,
  PWA_THEME_COLOR_DARK,
  OG_BACKGROUND,
  OG_FOREGROUND,
  OG_ACCENT,
} from "./manifest";

const PUBLIC_DIR = fileURLToPath(new URL("../../public", import.meta.url));
const GLOBALS_CSS = fileURLToPath(new URL("../../app/globals.css", import.meta.url));

const ORIGIN = "https://app.example.test";
const manifest = buildManifest(ORIGIN);

/**
 * A PNG's real pixel size, read out of its own header.
 *
 * A PNG is an 8-byte signature followed by chunks, and the first chunk is
 * always IHDR whose first eight payload bytes are width and height, big-endian.
 * That is twenty bytes of specification, which is why this test needs no image
 * library — `lib/media/sniff.ts` reads the same signature for the same reason.
 *
 * It THROWS rather than returning null: a file that is not a PNG has to fail
 * the test that is checking PNGs, not be quietly skipped by it.
 */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const [index, byte] of signature.entries()) {
    if (bytes[index] !== byte) throw new Error(`${file} is not a PNG`);
  }
  if (bytes.toString("latin1", 12, 16) !== "IHDR") throw new Error(`${file}: no IHDR chunk`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** `hsl(190 90% 26%)` from a token, as the `#rrggbb` a manifest can carry. */
function tokenHex(value: string): string {
  const rgb = parseHsl(value);
  if (!rgb) throw new Error(`not an hsl() token: ${value}`);
  return `#${rgb.map((c: number) => c.toString(16).padStart(2, "0")).join("")}`;
}

const tokens = parseTokens(readFileSync(GLOBALS_CSS, "utf8"));

describe("the web app manifest", () => {
  it("declares icons at all", () => {
    // Non-vacuity: an empty list would make every loop below pass by saying
    // nothing, and an app with no icons is exactly the app this file exists for.
    expect(PWA_ICONS.length).toBeGreaterThan(0);
    expect(manifest.icons).toHaveLength(PWA_ICONS.length);
  });

  it("ships every icon file it promises, at the pixel size it promises", () => {
    // 🚨 The one check nothing else in this repo can make. A manifest that
    // declares 512x512 and ships a 256x256 makes Chrome refuse to install the
    // app while saying nothing useful about why — and `npm run build` is green,
    // the page renders, and the only symptom is on somebody's phone.
    for (const icon of PWA_ICONS) {
      const file = `${PUBLIC_DIR}${icon.src}`;
      const [width, height] = icon.sizes.split("x").map(Number);
      expect(pngSize(file), `${icon.src} promises ${icon.sizes}`).toEqual({ width, height });
    }
  });

  it("carries the two sizes Chrome requires", () => {
    const any = PWA_ICONS.filter((icon) => icon.purpose === "any").map((icon) => icon.sizes);
    // Without BOTH of these Chrome does not offer installation at all.
    expect(any).toContain("192x192");
    expect(any).toContain("512x512");
  });

  it("keeps the maskable icon in a file of its own", () => {
    const maskable = PWA_ICONS.filter((icon) => icon.purpose === "maskable");
    expect(maskable).toHaveLength(1);
    // ⚠️ The same bitmap declared both ways is either a logo with a hole
    // punched in it or a postage stamp in the middle of a square: Android crops
    // a maskable icon to the launcher's shape, so it needs ~20 % padding that
    // an `any` icon must not have.
    const any = PWA_ICONS.filter((icon) => icon.purpose === "any").map((icon) => icon.src);
    expect(any).not.toContain(maskable[0].src);
  });

  it("names the fields installation depends on", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.id).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBeTruthy();
  });

  it("never prefers a related application", () => {
    // The one boolean that switches installability off completely — and it sits
    // next to `related_applications`, where `true` looks like the matching value.
    expect(manifest.prefer_related_applications).not.toBe(true);
  });

  it("points `related_applications` at this very manifest on this very origin", () => {
    // This is the whole basis of `navigator.getInstalledRelatedApps()`, which is
    // the app's ONLY way to learn it is already installed. A wrong origin is not
    // a broken link — it is a silent `[]`, i.e. a hint that never goes away.
    expect(manifest.related_applications).toEqual([
      { platform: "webapp", url: `${ORIGIN}/manifest.webmanifest` },
    ]);
  });

  it("starts inside its own scope", () => {
    // A start_url outside the scope opens the installed app in a browser tab —
    // the thing somebody installed it to get away from.
    expect(typeof manifest.start_url).toBe("string");
    expect(typeof manifest.scope).toBe("string");
    expect(String(manifest.start_url).startsWith(String(manifest.scope))).toBe(true);
  });

  it("carries the colours the app actually uses", () => {
    // CLAUDE.md promises that recolouring the app is `--primary` and friends in
    // `app/globals.css`. The moment a manifest carries colours of its own, that
    // promise is only true while something holds the two together.
    expect(PWA_BACKGROUND_COLOR).toBe(tokenHex(tokens.light.background));
    expect(PWA_THEME_COLOR).toBe(tokenHex(tokens.light.background));
    expect(PWA_THEME_COLOR_DARK).toBe(tokenHex(tokens.dark.background));
    expect(manifest.background_color).toBe(PWA_BACKGROUND_COLOR);
    expect(manifest.theme_color).toBe(PWA_THEME_COLOR);
  });

  it("carries the share card's colours too", () => {
    // Same argument as above, one step further out. The link preview is the one
    // surface of this app nobody ever looks at, so a colour left behind by a
    // recolour would sit there wrong indefinitely.
    expect(OG_BACKGROUND).toBe(tokenHex(tokens.light.background));
    expect(OG_FOREGROUND).toBe(tokenHex(tokens.light.foreground));
    expect(OG_ACCENT).toBe(tokenHex(tokens.light.primary));
  });
});

describe("shortAppName", () => {
  it("leaves a name that fits alone", () => {
    expect(shortAppName("Your App")).toBe("Your App");
  });

  it("cuts a long name on a word boundary", () => {
    // Android shows roughly twelve characters under an icon and truncates the
    // rest with an ellipsis. "Die Steuer" reads; "Die Steuer-W" does not.
    expect(shortAppName("Die Steuer-Werkstatt")).toBe("Die");
    expect(shortAppName("Mein grosses Programm")).toBe("Mein grosses");
  });

  it("cuts a single long word hard, because there is no boundary to use", () => {
    expect(shortAppName("Steuerwerkstatt")).toBe("Steuerwerkst");
  });

  it("trims what the operator typed", () => {
    expect(shortAppName("  Your App  ")).toBe("Your App");
  });
});

describe("originFrom", () => {
  it("prefers the proxy's headers over the host it was forwarded to", () => {
    expect(
      originFrom({
        host: "internal:3000",
        forwardedHost: "app.example.de",
        forwardedProto: "https",
      }),
    ).toBe("https://app.example.de");
  });

  it("assumes https for a real domain with no proxy header", () => {
    // Guessing http for a real domain would put an insecure URL in the manifest
    // of an app that is only installable over https in the first place.
    expect(originFrom({ host: "app.example.de" })).toBe("https://app.example.de");
  });

  it("assumes http on localhost, so development works", () => {
    expect(originFrom({ host: "localhost:3000" })).toBe("http://localhost:3000");
    expect(originFrom({ host: "127.0.0.1:3005" })).toBe("http://127.0.0.1:3005");
  });

  it("falls back to the dev server rather than producing an empty origin", () => {
    expect(originFrom({})).toBe("http://localhost:3000");
  });
});
