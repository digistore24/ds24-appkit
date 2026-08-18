// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// From a registry entry to a working checkout link.
//
// This is the bridge between config/digistore-products.json (what you sell)
// and lib/digistore/buyUrl.ts (how Digistore24 is asked for a checkout URL).
//
// The path is createBuyUrl: price, currency and interval travel WITH the
// checkout call as a payment_plan. The registry stays the single source of
// truth for prices — nothing has to be maintained a second time inside
// Digistore24. That also buys free trials, upgrades, vouchers and per-link
// affiliate commissions, none of which a plain product link can express.
// See docs/digistore-createbuyurl.md.
import { getOrCreateBuyUrl, type BuyerContext, type Offer } from "./buyUrl";
import { checkoutProductFor, type ProductDef, type SyncEnv } from "./products";
import { runtimeSyncEnv } from "./runtime-env";
import { publicUrlFor } from "./public-url";
import { ds24ApiKey, hasDigistoreApiKey } from "./settings";
import { withTestpayParam } from "./testpay";
import { tokenCustomMarker } from "@/lib/tokens/packages";
import { DEFAULT_LOCALE } from "@/i18n/config";

/** Why there is no checkout link (never a broken or faked one). */
export type CheckoutBlocker =
  /** Product not created at DS24 yet → node run.mjs ds24-sync */
  | "notSynced"
  /** No API key in the environment → node run.mjs ds24-connect */
  | "notConnected"
  /** DS24 refused or was unreachable — the only one a live visitor can hit. */
  | "error";

export type CheckoutLink =
  | { url: string; blocker?: never }
  | { url: null; blocker: CheckoutBlocker };

/**
 * Registry entry + the buyer's language → DS24 offer.
 *
 * **`locale` picks WHICH Digistore24 product**, and with it the language of the
 * order form — a DS24 product carries exactly one, and `createBuyUrl` has no
 * parameter to override it (the reasoning is in `lib/digistore/products.ts`).
 * A locale the offering has no product for falls back rather than throwing;
 * `checkoutProductFor` documents the chain.
 *
 * Three details that are easy to get wrong:
 *  - **`key` carries the language, and it has to.** It is the buy-URL cache
 *    key (`buy_url_cache.offerKey`, one row per key), so `starter` for both
 *    languages would let the German and the English checkout URL evict each
 *    other on every page view — and, in the window between, serve the German
 *    form to an English buyer out of the cache. `offerHash` alone does not
 *    save it: the hash detects the change, it does not give the two a row each.
 *  - `billingInterval` only counts for subscriptions. On a token package it
 *    would turn a one-off purchase into a subscription (buyUrl.ts derives
 *    number_of_installments from it).
 *  - Token packages set `forceRebilling`, i.e. settings[force_rebilling]=Y.
 *    That stores the payment details, and WITHOUT it there is no chargeable
 *    ORDER later — auto top-up via createBillingOnDemand, which charges against
 *    exactly such an order, then cannot work at all (see lib/tokens/account.ts,
 *    docs/digistore-billing-modes.md).
 */
export function offerFor(
  def: ProductDef,
  locale: string = DEFAULT_LOCALE,
  env: SyncEnv = runtimeSyncEnv(),
): Offer {
  const resolved = checkoutProductFor(def, locale, env);
  if (!resolved) {
    throw new Error(
      `Product "${def.key}" has no productId yet. Run: node run.mjs ds24-sync`,
    );
  }
  return {
    key: `${def.key}:${resolved.language}`,
    productId: resolved.productId,
    priceCents: def.priceCents ?? 0,
    currency: def.currency,
    billingInterval:
      def.kind === "subscription" ? def.billingInterval : undefined,
    title: def.name,
    description: def.description,
    forceRebilling: def.kind === "token",
  };
}

/**
 * The marker the IPN handler matches a payment to a credit with
 * (app/api/ipn/route.ts → parseTokenCustomMarker). Without it a paid token
 * package would never be booked to a balance.
 */
export function customTrackingFor(def: ProductDef): string | undefined {
  return def.kind === "token" ? tokenCustomMarker(def.key) : undefined;
}

/**
 * Where the buyer lands after the purchase. `[ORDER_ID]` is a Digistore24
 * placeholder and is substituted by DS24 — it must stay literal here.
 * Without APP_URL there is no absolute URL, and DS24 then uses the default
 * thank-you page.
 *
 * Locally the app sits on http://localhost:3000, which DS24 refuses to store at
 * all. `publicUrlFor` turns such an address into the public redirect that leads
 * back to it — otherwise there would be no /optin page in development.
 */
export function optinThankyouUrl(
  appUrl: string | undefined = process.env.APP_URL,
): string | undefined {
  const base = appUrl?.trim().replace(/\/+$/, "");
  return base ? publicUrlFor(`${base}/optin/[ORDER_ID]`) : undefined;
}

/**
 * Checkout links for a list of offerings, keyed by product key.
 *
 * The API key is resolved ONCE for the whole list, not per card.
 *
 * On a DS24 error this returns `{ url: null, blocker: "error" }` instead of
 * throwing. That is deliberate and NOT a mock fallback in the sense of
 * `guardrails`: nothing is faked as successful — the page states that no
 * checkout is available. The alternative would be a public sales page
 * answering every visitor with a 500 because one plan is broken.
 */
export async function checkoutLinksFor(
  defs: ProductDef[],
  ctx: BuyerContext = {},
  locale: string = DEFAULT_LOCALE,
): Promise<Map<string, CheckoutLink>> {
  const links = new Map<string, CheckoutLink>();
  if (defs.length === 0) return links;

  const connected = hasDigistoreApiKey();

  await Promise.all(
    defs.map(async (def) => {
      links.set(def.key, await resolveOne(def, connected, ctx, locale));
    }),
  );
  return links;
}

/**
 * The blockers that can be known WITHOUT asking Digistore24 anything.
 *
 * For a signed-in Member the checkout URL is built on click, so the page must
 * render without requesting a single URL — otherwise the whole point of the
 * click-time path is lost. A plan that is not set up must still say so, and
 * those reasons are all knowable locally: no product id, no API key.
 *
 * The remaining blocker, "error", cannot be known here — it means Digistore24
 * refused. It surfaces at click time instead (app/plans/actions.ts).
 */
export async function checkoutBlockersFor(
  defs: ProductDef[],
): Promise<Map<string, CheckoutBlocker | null>> {
  const blockers = new Map<string, CheckoutBlocker | null>();
  if (defs.length === 0) return blockers;

  const connected = hasDigistoreApiKey();

  for (const def of defs) {
    // "Not synced" means no Digistore24 product in ANY language. An offering
    // that exists in German but not yet in English is not blocked — the buyer
    // gets the German form and can still buy (checkoutProductFor). Saying
    // "checkout unavailable" there would refuse money over a missing
    // translation; `node run.mjs ds24-sync` is where that gap is reported.
    if (!checkoutProductFor(def, DEFAULT_LOCALE, runtimeSyncEnv()))
      blockers.set(def.key, "notSynced");
    else if (!connected) blockers.set(def.key, "notConnected");
    else blockers.set(def.key, null);
  }
  return blockers;
}

/**
 * One plan's blocker out of the map `checkoutBlockersFor` returned.
 *
 * The distinction this exists for: in that map `null` means "nothing is
 * blocking this plan" and has to stay that way, while a key that is genuinely
 * absent is a real fault. `??` cannot tell the two apart — `null ?? "error"`
 * is `"error"`, and that once put "the checkout is unavailable" onto every
 * card of every signed-in visitor while signed-out visitors saw a perfectly
 * good page. Use `has()`, and never `??`, on a map whose values may be null.
 */
export function blockerFor(
  blockers: Map<string, CheckoutBlocker | null>,
  key: string,
): CheckoutBlocker | null {
  return blockers.has(key) ? (blockers.get(key) ?? null) : "error";
}

/**
 * Checkout link for ONE offering — the click-time path.
 *
 * `checkoutLinksFor` above is for rendering the whole page at once; this is
 * for a single buyer who has just pressed a button. It resolves the API key
 * per call, which is the right trade when there is exactly one offering and
 * the URL is personal anyway (see lib/digistore/buyUrl.ts → isUserSpecific: a
 * URL carrying a buyer identity is never cached).
 */
export async function checkoutLinkFor(
  def: ProductDef,
  ctx: BuyerContext = {},
  locale: string = DEFAULT_LOCALE,
): Promise<CheckoutLink> {
  const connected = hasDigistoreApiKey();
  return resolveOne(def, connected, ctx, locale);
}

async function resolveOne(
  def: ProductDef,
  connected: boolean,
  ctx: BuyerContext,
  locale: string,
): Promise<CheckoutLink> {
  if (!checkoutProductFor(def, locale, runtimeSyncEnv()))
    return { url: null, blocker: "notSynced" };
  if (!connected) return { url: null, blocker: "notConnected" };

  try {
    const url = await getOrCreateBuyUrl({
      apiKey: ds24ApiKey(),
      offer: offerFor(def, locale),
      ctx: { ...ctx, customTracking: ctx.customTracking ?? customTrackingFor(def) },
      thankyouUrl: optinThankyouUrl(),
    });
    // DEV only: append the Digistore24 test-payment parameter, so a developer
    // can buy through the real checkout without setting the cookie by hand.
    // Strictly AFTER getOrCreateBuyUrl — a decorated URL must never enter the
    // shared buy_url_cache (a cached row is served to every visitor). Do not
    // move this "closer to the URL creation" in buyUrl.ts for that reason.
    // Outside DEV, and on any failure, this is a no-op (lib/digistore/testpay.ts).
    return { url: await withTestpayParam(url) };
  } catch (err) {
    // Visible in `node run.mjs logs` — the page itself must not show a stack trace.
    console.error(`[checkout] createBuyUrl failed for "${def.key}":`, err);
    return { url: null, blocker: "error" };
  }
}
