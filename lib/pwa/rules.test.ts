// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Every user agent below is a real one, and every gate gets its own test that
// flips exactly one field — because the failure this file exists to prevent has
// a sentence attached to it: "your app keeps asking me to install it, and it IS
// installed."

import { describe, expect, it } from "vitest";

import {
  canInstall,
  installHint,
  installRoute,
  shouldNudge,
  type InstallEnvironment,
} from "./rules";

const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/125.0 Mobile/15E148 Safari/605.1.15",
  // iPadOS 13+ answers with a MACINTOSH user agent by default. The only thing
  // separating it from a real Mac is that no Mac reports touch points.
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  samsung:
    "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0",
  facebookIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone15,2;FBMD/iPhone]",
  instagramIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 322.0.0.0 (iPhone15,2; iOS 17_4_1)",
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
};

/** A phone that can install, has not, and has been here before. */
function env(over: Partial<InstallEnvironment> = {}): InstallEnvironment {
  return {
    userAgent: UA.android,
    touchPoints: 5,
    standalone: false,
    hasPrompt: false,
    relatedInstalled: false,
    secureContext: true,
    dismissed: false,
    visits: 2,
    ...over,
  };
}

describe("installRoute", () => {
  it("names the share sheet on anything running iOS", () => {
    expect(installRoute(UA.iphone, 5)).toBe("ios");
    // Since iOS 16.4 the other browsers can do it too — the sheet is elsewhere,
    // which is why the instruction names WHAT to look for, not only where.
    expect(installRoute(UA.iphoneFirefox, 5)).toBe("ios");
  });

  it("recognises an iPad behind its Macintosh user agent", () => {
    expect(installRoute(UA.ipad, 5)).toBe("ios");
    // The same string with no touch points is a real Mac.
    expect(installRoute(UA.ipad, 0)).toBe("none");
  });

  it("names the browser menu on Android, whichever browser it is", () => {
    expect(installRoute(UA.android, 5)).toBe("android");
    expect(installRoute(UA.samsung, 5)).toBe("android");
    expect(installRoute(UA.androidFirefox, 5)).toBe("android");
  });

  it("sends an in-app browser to the real one instead of naming a missing menu", () => {
    // 🚨 Not an edge case for a Digistore product: a good part of the traffic
    // arrives from a social ad, and "Teilen → Zum Home-Bildschirm" is not in
    // that share sheet. The ORDER of the checks is the claim — both of these
    // also say "iPhone", and would otherwise be told to do the impossible.
    expect(installRoute(UA.facebookIos, 5)).toBe("webview");
    expect(installRoute(UA.instagramIos, 5)).toBe("webview");
  });

  it("says nothing in an embedded browser that is not on a phone", () => {
    // "Open this in your browser" is only true where the operating system can
    // actually put an icon on a home screen.
    expect(installRoute(`${UA.chromeWindows} [FBAN/FBW]`, 0)).toBe("none");
  });

  it("separates a desktop Chromium from a desktop Safari", () => {
    expect(installRoute(UA.chromeWindows, 0)).toBe("desktop");
    expect(installRoute(UA.chromeMac, 0)).toBe("desktop");
    // Telling somebody to look for a menu entry their browser does not have is
    // worse than saying nothing.
    expect(installRoute(UA.safariMac, 0)).toBe("none");
  });
});

describe("canInstall", () => {
  it("says yes on a phone that has not installed the app", () => {
    expect(canInstall(env())).toBe(true);
    expect(canInstall(env({ userAgent: UA.iphone }))).toBe(true);
  });

  it("says no while running as the installed app", () => {
    expect(canInstall(env({ standalone: true }))).toBe(false);
  });

  it("says no when the browser reports the app as already installed", () => {
    // The strongest signal there is, and the only one available on Android.
    expect(canInstall(env({ relatedInstalled: true }))).toBe(false);
  });

  it("says no without a secure context — no https, no installation", () => {
    expect(canInstall(env({ secureContext: false }))).toBe(false);
  });

  it("says no where there is nothing true to say", () => {
    expect(canInstall(env({ userAgent: UA.safariMac, touchPoints: 0 }))).toBe(false);
  });

  it("still speaks up in an in-app browser, because there IS an answer there", () => {
    // Not "can install here" but "can install on this phone" — the text that
    // follows is the one sentence that gets somebody out of the webview.
    expect(canInstall(env({ userAgent: UA.instagramIos }))).toBe(true);
    expect(installHint(env({ userAgent: UA.instagramIos }))).toBe("webview");
  });

  it("stays quiet on the desktop unless the browser itself offered", () => {
    const desktop = env({ userAgent: UA.chromeWindows, touchPoints: 0 });
    expect(canInstall(desktop)).toBe(false);
    expect(canInstall({ ...desktop, hasPrompt: true })).toBe(true);
  });

  it("is NOT switched off by a dismissal", () => {
    // 🚨 The whole point of the split. Dismissing the notice must not take the
    // menu entry away — the menu is where somebody who changed their mind, or
    // changed their phone, goes to find it again.
    expect(canInstall(env({ dismissed: true }))).toBe(true);
  });
});

describe("shouldNudge", () => {
  it("holds the notice back on the very first visit", () => {
    // The first minute after a purchase belongs to the product, not to icons —
    // and the onboarding checklist is already asking for that attention.
    expect(shouldNudge(env({ visits: 1 }))).toBe(false);
    expect(shouldNudge(env({ visits: 2 }))).toBe(true);
  });

  it("never comes back once it was dismissed", () => {
    // On iOS there is no way to find out that somebody installed the app, so a
    // notice that could return would return to people who already have it.
    expect(shouldNudge(env({ dismissed: true }))).toBe(false);
  });

  it("says nothing wherever the menu entry says nothing", () => {
    for (const over of [
      { standalone: true },
      { relatedInstalled: true },
      { secureContext: false },
      { userAgent: UA.safariMac, touchPoints: 0 },
    ]) {
      const state = env(over);
      expect(canInstall(state), JSON.stringify(over)).toBe(false);
      expect(shouldNudge(state), JSON.stringify(over)).toBe(false);
    }
  });
});

describe("installHint", () => {
  it("prefers the browser's own prompt over any instruction", () => {
    // One tap beats three, and the browser has just told us it can do it.
    expect(installHint(env({ hasPrompt: true }))).toBe("prompt");
    expect(installHint(env({ userAgent: UA.iphone, hasPrompt: true }))).toBe("prompt");
  });

  it("falls back to the platform's own route", () => {
    expect(installHint(env())).toBe("android");
    expect(installHint(env({ userAgent: UA.iphone }))).toBe("ios");
  });

  it("is null exactly where canInstall is false", () => {
    for (const userAgent of Object.values(UA)) {
      for (const standalone of [false, true]) {
        const state = env({ userAgent, standalone, touchPoints: 5 });
        expect(installHint(state) === null, `${userAgent} standalone=${standalone}`).toBe(
          !canInstall(state),
        );
      }
    }
  });
});
