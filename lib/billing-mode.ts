// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What this app sells — subscriptions, prepaid tokens, or both.
//
// Set it ONCE, in `config/digistore-products.json`:
//
//   { "billingMode": "subscriptions" | "tokens" | "both", "products": { … } }
//
// Not an environment variable, deliberately: the mode is a property of the
// PRODUCT, not of the machine it runs on. An env var would let STAGING and PROD
// disagree about what the same app sells, and a typo in a hoster's secret
// manager would hide a paid-for feature from every customer at once.
//
// ── What it is for ─────────────────────────────────────────────────────────
// A token-only app has no "next payment" to show; a subscription-only app has
// no balance. Without the flag both surfaces render anyway — a balance card
// stuck at 0 forever, an empty payment card — and the vendor has to hunt them
// down page by page. This is the switch that turns the machinery around one
// billing model off in one place.
//
// ── ⛔ It is COSMETIC. It never decides access. ─────────────────────────────
// `hasPlan()`, `entitlementsFor()`, `consumeTokens()` and the IPN handler
// behave EXACTLY the same in every mode. That is not an oversight to tidy up:
// the mode is a display setting somebody flips while a customer holds a paid
// balance, and a display setting that revokes what was paid for is a refund
// request, not a layout change. The one exception is the balance CORRECTION,
// which mints tokens — see `adjustTokensAction`.
//
// ── The rule that makes a wrong setting harmless ────────────────────────────
// **A mode may hide an empty thing, never a non-empty one.** Every caller here
// is written as `!sellsTokens() && balance === 0`, never as `!sellsTokens()`
// alone. So an app switched from tokens to subscriptions still shows the
// customers who bought tokens what they still hold — and the vendor who sets
// the flag wrong loses nothing but a card they did not want anyway. Keep new
// call sites written that way; it is the difference between a display setting
// and a support incident.
//
// ── Where it may be read ───────────────────────────────────────────────────
// Server components and server actions. NOT in a client component: this module
// imports the product registry, and that JSON carries prices and Digistore24
// product ids that have no business in a browser bundle. Resolve it on the
// server and pass the boolean down as a prop — the same treatment
// `grantableProducts()` gets in `app/dashboard/admin/users/[id]/page.tsx`.
import registry from "@/config/digistore-products.json";
import { sellableProducts } from "@/lib/digistore/products";

export const BILLING_MODES = ["subscriptions", "tokens", "both"] as const;

export type BillingMode = (typeof BILLING_MODES)[number];

/** The default for a registry that does not name a mode: show everything. */
export const DEFAULT_BILLING_MODE: BillingMode = "both";

export function isBillingMode(value: unknown): value is BillingMode {
  return (BILLING_MODES as readonly unknown[]).includes(value);
}

/**
 * The configured mode.
 *
 * An unknown or missing value falls back to `"both"` rather than throwing. A
 * typo in the config must not take the app down — and "both" is the harmless
 * direction to fail in: it shows one card too many, where guessing "tokens"
 * would hide a subscription somebody is paying for.
 */
export function billingMode(): BillingMode {
  const raw = (registry as { billingMode?: unknown }).billingMode;
  return isBillingMode(raw) ? raw : DEFAULT_BILLING_MODE;
}

/**
 * Does this mode sell plans — subscriptions or one-off purchases that unlock
 * access?
 *
 * `one_time` counts as a plan, not as a token: it is an entitlement, so
 * `hasPlan()` answers for it and `grantableProducts()` hands it out. The
 * dividing line here is the same one those two draw.
 *
 * Pure, so the three modes are covered by a test rather than by whichever one
 * the shipped config happens to hold.
 */
export function modeSellsPlans(mode: BillingMode): boolean {
  return mode !== "tokens";
}

/** Does this mode sell prepaid tokens? Pure — see `modeSellsPlans`. */
export function modeSellsTokens(mode: BillingMode): boolean {
  return mode !== "subscriptions";
}

/**
 * Does this app sell plans? Governs the subscription surfaces (next payment,
 * the entitlement list).
 */
export function sellsPlans(): boolean {
  return modeSellsPlans(billingMode());
}

/**
 * Does this app sell prepaid tokens? Governs the balance card, the ledger and
 * the manual balance correction.
 */
export function sellsTokens(): boolean {
  return modeSellsTokens(billingMode());
}

/**
 * The kinds the configured mode contradicts — empty when the registry and the
 * mode agree.
 *
 * A second source of truth is only safe as long as something checks it against
 * the first, and this is that check: `lib/billing-mode.test.ts` fails the build
 * when a token package is declared in a `"subscriptions"` app, because such a
 * product is synced to Digistore24 and buyable while the app it belongs to
 * renders none of the machinery that credits it. That is a silent money hole,
 * and it is exactly the kind a `--dry-run` never shows.
 *
 * Deliberately one-directional: an enabled mode with no products yet is FINE.
 * That is the normal intermediate state — `build-app` sets the mode, and
 * `billing-modes` declares the products afterwards.
 *
 * It reads `sellableProducts()` and not `allProducts()`, because every word of
 * the paragraph above is about a product that gets SYNCED and is BUYABLE. A
 * parked entry is neither. That is also what makes parking useful here: an app
 * switching to `"subscriptions"` used to have to DELETE its token packages to
 * get past this check — now it can set `"sell": false` and keep them as a
 * shape to come back to.
 */
export function contradictingProducts(): string[] {
  return sellableProducts()
    .filter((p) =>
      p.kind === "token" ? !sellsTokens() : !sellsPlans(),
    )
    .map((p) => p.key);
}
