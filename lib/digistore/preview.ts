// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The DEV fixture for /plans — looking at the buy forms without selling anything.
//
// ============================================================================
// WHAT IT IS FOR
//
// A fresh app has five example plans and no Digistore24 products: every
// `productIds.<env>` in `config/digistore-products.json` is `null`. So every
// card on /plans renders the `notSynced` notice and NOT ONE BUY FORM EXISTS —
// there is nothing to look at, judge in dark mode, or check at 380px.
//
// The way that used to be worked around was to put dummy product ids into
// `config/digistore-products.json` and a dummy `DIGISTORE_API_KEY` into `.env`,
// look, and then undo both. That is a verification step somebody eventually
// forgets to undo — and the registry is a file GIT TRACKS, so the leftover
// does not sit in a gitignored `.env`, it gets committed. A committed dummy id
// then makes `node run.mjs ds24-sync` call `updateProduct` on a Digistore24
// product that does not exist.
//
// So the fixture holds NO state at all: it is a query parameter, it is gone
// when you close the tab, and there is nothing to restore.
//
//   http://localhost:3000/plans?preview=checkout
//
// ============================================================================
// WHAT IT IS NOT — and this is the whole design
//
// It is NOT a mock checkout, and it must never become one. `guardrails` and
// CLAUDE.md forbid a demo fallback on Digistore24 errors, and the reason is
// that a faked success hides a real outage. Three properties keep this fixture
// on the right side of that line:
//
//   1. **It never produces a URL.** It renders the buy FORM (the button, the
//      auto-reload checkbox, the layout) — never an `<a href>` to a checkout
//      that does not exist. Signed out, the normal page shows a shared cached
//      link, and that link can only come from a real `createBuyUrl` call; the
//      preview therefore shows the form for everybody rather than inventing an
//      address. A dead link is exactly what `checkoutLinksFor` was built to
//      refuse (`lib/digistore/checkout.ts`).
//   2. **It never suppresses a real failure.** It does not touch the `error`
//      blocker and it makes no Digistore24 call to fail in the first place —
//      `plansRenderMode()` below answers `askDigistore: false` for it. A
//      preview cannot be green because the API answered; nothing asked.
//   3. **Pressing Buy still fails honestly.** `startCheckoutAction` resolves
//      the REAL registry, finds no product id, and lands on
//      `/plans?checkout=error`. The preview changes what is rendered, never
//      what happens.
//
// ============================================================================
// WHERE IT EXISTS
//
// The same allowlist as `lib/digistore/testpay.ts` and `lib/auth/dev-login.ts`,
// for the same reason: anything not clearly recognisable as development counts
// as production and is refused. `appEnv()` puts a typo in `APP_ENV` on
// "production", never on "development".
//
// It READS `APP_URL` and never writes it. Setting `APP_URL` to something
// non-local switches off the development login and locks you out of your own
// app (CLAUDE.md → *Plans & Digistore products*) — a fixture that needed that
// would be worse than the problem.
// ============================================================================
import { isLocalUrl } from "@/lib/auth/dev-login";
import { appEnv } from "@/lib/env-guard";

/** The query parameter, in one place — the page and the docs both name it. */
export const PLANS_PREVIEW_PARAM = "preview";
/** Its one accepted value. Anything else is not a preview. */
export const PLANS_PREVIEW_VALUE = "checkout";

export interface PlansPreviewEnv {
  NODE_ENV?: string;
  APP_ENV?: string;
  APP_URL?: string;
  /** Hard off, like `DS24_TESTPAY=off` — for a local machine that wants none. */
  DS24_PLANS_PREVIEW?: string;
}

/**
 * The one place that decides whether the preview exists at all.
 *
 * Deliberately pure and tested on its own (`preview.test.ts`), the same shape
 * as `isTestpayAllowed()` — it decides what a PUBLIC route renders, so it is
 * an allowlist and every doubt falls towards "no".
 */
export function isPlansPreviewAllowed(env: PlansPreviewEnv): boolean {
  if (env.DS24_PLANS_PREVIEW === "off") return false;
  if (appEnv(env.APP_ENV) !== "development") return false;
  if (env.NODE_ENV === "production") return false;
  if (!isLocalUrl(env.APP_URL)) return false;
  return true;
}

/** Reads the conditions from the actual environment. */
export function isPlansPreviewActive(): boolean {
  return isPlansPreviewAllowed({
    NODE_ENV: process.env.NODE_ENV,
    APP_ENV: process.env.APP_ENV,
    APP_URL: process.env.APP_URL,
    DS24_PLANS_PREVIEW: process.env.DS24_PLANS_PREVIEW,
  });
}

/**
 * Did the visitor ask for the preview? Pure — the gate is a separate question
 * and is asked separately, so a test can exercise the two independently and
 * neither can be mistaken for the other.
 *
 * Next hands a repeated query parameter over as an array; that is not a
 * request for the preview, it is somebody fiddling. Only the exact string.
 */
export function wantsPlansPreview(value: string | string[] | undefined): boolean {
  return value === PLANS_PREVIEW_VALUE;
}

/**
 * What the plans page does for one visitor — the whole decision, as a pure
 * function, so the property that matters can be ASSERTED rather than read out
 * of a server component nothing can render in a unit test:
 *
 *   **previewing ⇒ askDigistore === false.**
 *
 * `askDigistore` is the expensive, network-touching branch
 * (`checkoutLinksFor` → `createBuyUrl`); `askBlockers` is the local one
 * (`checkoutBlockersFor`, no call at all). `asForm` picks the click-time form
 * over the shared anchor.
 */
export interface PlansRenderMode {
  /** Resolve shared checkout URLs — the only branch that talks to Digistore24. */
  askDigistore: boolean;
  /** Resolve the locally knowable blockers (no network). */
  askBlockers: boolean;
  /** Render the click-time buy form instead of a shared link. */
  asForm: boolean;
  /** Show the cards as if nothing were blocking. Only ever true in a preview. */
  ignoreBlockers: boolean;
}

export function plansRenderMode(opts: {
  signedIn: boolean;
  previewing: boolean;
}): PlansRenderMode {
  // The preview wins over both other states, and it is the only one that asks
  // Digistore24 nothing while still showing a button. Checked first so that
  // "signed out" cannot reach the URL branch underneath it.
  if (opts.previewing) {
    return {
      askDigistore: false,
      askBlockers: false,
      asForm: true,
      ignoreBlockers: true,
    };
  }
  if (opts.signedIn) {
    return {
      askDigistore: false,
      askBlockers: true,
      asForm: true,
      ignoreBlockers: false,
    };
  }
  return {
    askDigistore: true,
    askBlockers: false,
    asForm: false,
    ignoreBlockers: false,
  };
}
