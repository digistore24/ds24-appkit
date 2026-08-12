// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// WHEN to offer "put this on your home screen", and WHICH instruction.
//
// Everything here is a pure function over facts handed IN. No `window`, no
// `navigator`, no `localStorage` — those are read once, in
// `components/install-app.tsx`, and passed down. That is not tidiness: vitest
// runs with `environment: "node"` and this repo has no DOM, so a decision that
// touched `navigator` would be a decision nothing can test. What is left around
// this file is then small enough to read in one sitting.
//
// ── The rule the whole file exists for ──────────────────────────────────────
// Never nag somebody who already installed it. That is harder than it sounds:
//
//   · running AS the installed app       — knowable everywhere
//   · installed, browsing in the tab     — knowable on Android only
//     (`getInstalledRelatedApps()`; on iOS there is no such thing, at all)
//
// So the notice gets ONE showing and then never returns, and the permanent home
// is a menu entry, which waits instead of asking. `canInstall()` guards the
// menu entry, `shouldNudge()` the notice — and a dismissal deliberately reaches
// only the second of the two.

/**
 * How this device installs a web app, if it does.
 *
 *   "prompt"  — the browser handed us `beforeinstallprompt`: one tap
 *   "android" — Chromium/Firefox on Android: browser menu → "App installieren"
 *   "ios"     — iOS/iPadOS: share sheet → "Zum Home-Bildschirm"
 *   "desktop" — a desktop Chromium that offered the prompt
 *   "webview" — a phone whose OS can do it, inside an app that cannot: the
 *               honest answer is "open this in your browser", not an
 *               instruction naming a menu entry that is not there
 *   "none"    — no route at all, and nothing worth saying
 */
export type InstallRoute = "prompt" | "android" | "ios" | "desktop" | "webview" | "none";

export interface InstallEnvironment {
  userAgent: string;
  /**
   * `navigator.maxTouchPoints`. Needed for one case, and it is not exotic: an
   * iPad on iPadOS 13+ sends a MACINTOSH user agent by default. Without this
   * number every iPad is a desktop and is told about a menu it does not have.
   */
  touchPoints: number;
  /** Already running as the installed app (display-mode / navigator.standalone). */
  standalone: boolean;
  /** `beforeinstallprompt` fired and the event is being held. */
  hasPrompt: boolean;
  /** `getInstalledRelatedApps()` found this very manifest. Android only. */
  relatedInstalled: boolean;
  /** `window.isSecureContext`. No https, no installation — and no notice either. */
  secureContext: boolean;
  /** The customer closed the notice. Reaches `shouldNudge` and nothing else. */
  dismissed: boolean;
  /** How often this device has opened the dashboard, this one included. */
  visits: number;
}

/**
 * The notice waits for the second visit.
 *
 * The first minutes after a purchase belong to the product — and the onboarding
 * checklist is already asking for that attention. Somebody who comes back is
 * somebody an icon is worth offering to.
 */
export const MIN_VISITS_BEFORE_NUDGE = 2;

/**
 * Embedded browsers: they have a share sheet, but no "add to home screen".
 *
 * ⚠️ A list of names is a list that ages, and it errs on the safe side by
 * construction — an app that is missing here gets an instruction it cannot
 * follow, never a wrong installation. For a product sold through social ads
 * these are a large minority of first visits, not an edge case.
 */
const IN_APP_WEBVIEW =
  /\b(FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|Snapchat|Pinterest|WhatsApp|LinkedInApp|BytedanceWebview|musical_ly)/i;

/**
 * The install route for a user agent.
 *
 * ⚠️ User-agent sniffing, in a file that says so. It is the wrong tool for
 * capabilities and the right one for INSTRUCTIONS: "Teilen → Zum
 * Home-Bildschirm" is a fact about an operating system's own interface, and no
 * feature detection reports it. Wherever a capability CAN be detected —
 * `beforeinstallprompt`, `display-mode`, `getInstalledRelatedApps` — the
 * detection wins, which is why `hasPrompt` is asked first in `installHint()`.
 */
export function installRoute(userAgent: string, touchPoints: number): InstallRoute {
  const ua = userAgent ?? "";
  // First, deliberately: the webview strings below also say "iPhone", and an
  // instruction about a share sheet that has no "Zum Home-Bildschirm" in it is
  // worse than no instruction. On a phone there is still something true to say;
  // in an embedded browser anywhere else there is not.
  if (IN_APP_WEBVIEW.test(ua)) {
    return /iPhone|iPad|iPod|Android/.test(ua) ? "webview" : "none";
  }

  const iPadOnDesktopUa = /Macintosh/.test(ua) && touchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOnDesktopUa) return "ios";

  if (/Android/.test(ua)) return "android";

  // Chromium on the desktop can install; Firefox and Safari there cannot, and
  // naming a menu entry that is not present is worse than saying nothing.
  if (/Chrome\/|Chromium\/|Edg\//.test(ua) && !/Mobile/.test(ua)) return "desktop";

  return "none";
}

/**
 * Is there anything to offer at all? The gate on the menu entry.
 *
 * Every `false` here is a case somebody would otherwise have reported as "your
 * app keeps asking me to install it".
 */
export function canInstall(env: InstallEnvironment): boolean {
  // Running inside the installed app. Nothing to install.
  if (env.standalone) return false;
  // The browser knows it is installed — the strongest signal available.
  if (env.relatedInstalled) return false;
  // No https, no installation. `localhost` is a secure context, so development
  // is unaffected.
  if (!env.secureContext) return false;

  const route = installRoute(env.userAgent, env.touchPoints);
  if (route === "none") return false;
  // On the desktop, only when the browser itself offered. An instruction about
  // a menu, on a machine that already has a screen full of windows, is noise;
  // a one-tap button is not.
  if (route === "desktop") return env.hasPrompt;
  return true;
}

/**
 * Should the one-time notice appear? Implies `canInstall()`.
 *
 * The two extra conditions are exactly what separates the notice from the menu
 * entry — see the file header for why a dismissal must not reach the menu.
 */
export function shouldNudge(env: InstallEnvironment): boolean {
  if (!canInstall(env)) return false;
  if (env.dismissed) return false;
  return env.visits >= MIN_VISITS_BEFORE_NUDGE;
}

/**
 * WHICH instruction, once there is something to offer.
 *
 * `null` means "render nothing", and it is returned by the same gate the menu
 * entry asks — so a caller cannot ask one question and render the answer to
 * another.
 */
export function installHint(env: InstallEnvironment): InstallRoute | null {
  if (!canInstall(env)) return null;
  // One tap beats three wherever the browser offered it.
  if (env.hasPrompt) return "prompt";
  return installRoute(env.userAgent, env.touchPoints);
}
