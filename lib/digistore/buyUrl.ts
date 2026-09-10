// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Building checkout URLs through Digistore24 `createBuyUrl` with a custom
// payment plan and caching. Reference: docs/digistore-createbuyurl.md.
//
// Core idea: price, currency and interval are sent at runtime as a complete
// payment_plan[...] — not maintained inside Digistore. The result is a
// short-lived (24h) signed checkout URL. It is cached per offering; if the
// offering changes, a new URL is created.
//
// ============================================================================
// WHAT THIS FILE RETURNS IS NOT FINISHED — read this before building your own
// checkout on it.
//
// Every URL from here is UNDECORATED. In DEV a checkout link additionally
// carries the Digistore24 test-payment parameter, which is what lets a
// developer buy through the real checkout by clicking "buy" — no cookie, and it
// works on a product the marketplace has not approved yet. That parameter is
// appended by withTestpayParam() (lib/digistore/testpay.ts), and this file
// deliberately does not call it.
//
// The normal route needs nothing from you: checkoutLinkFor() and
// checkoutLinksFor() (lib/digistore/checkout.ts) wrap this layer and already
// decorate. Reach for a registry product and you are done. If you genuinely
// build your own path on createBuyUrl/getOrCreateBuyUrl, the LAST step is
// yours:
//
//   const url = await getOrCreateBuyUrl({ … });
//   return await withTestpayParam(url);   // no-op outside DEV, never throws
//
// Two rules on it, and both are load-bearing:
//
//   1. DEV AND LOCALHOST ONLY — never anywhere a customer can reach. The
//      parameter takes TEST payments: whoever opens such a link gets the
//      product without paying, and the IPN grants real entitlements. The gate
//      is isTestpayActive(), an allowlist of independent conditions, and
//      withTestpayParam() re-checks it itself. Never re-implement that gate at
//      a call site, never loosen it, and never append the raw parameter by
//      hand — the key is account-level and works on live checkout URLs too.
//   2. AFTER the cache, never before. getOrCreateBuyUrl writes its result into
//      buy_url_cache, which is keyed per offering with no member dimension — a
//      decorated URL written there is served to every later visitor. That is
//      why the decoration sits in checkout.ts and not in this file, and
//      checkout.test.ts fails the build if it moves here.
// ============================================================================
import crypto from "crypto";
import { ds24Post } from "./client";
import { identifiesMember } from "./custom";
import { db } from "@/db";
import { buyUrlCache } from "@/db/schema";
import { eq } from "drizzle-orm";

export interface Offer {
  /** Stable key of the offering (e.g. "gold"). The cache key. */
  key: string;
  /** Digistore product ID of the underlying base product. */
  productId: string;
  /** Price in cents. */
  priceCents: number;
  /** Currency, default "EUR". */
  currency?: string;
  /** e.g. "1_month" | "12_month". Omit for a one-off payment. */
  billingInterval?: string;
  /**
   * The Digistore24 PAYMENT PLAN this offer is sold through, when one exists —
   * `scripts/ds24/sync-products.mjs` wrote it from the same registry entry
   * that filled the fields above. Absent means: price it here, inline.
   *
   * Which of the two happens is `sellsThroughStoredPlan()` below, and the
   * fields above are NOT dead weight in the stored case: they are what the
   * cache key hashes, what the page prints, and what the checkout falls back
   * to the moment the stored plan turns out to be gone.
   */
  payplanId?: string;
  /** Which way to pay this is (`lib/digistore/products.ts`). For the cache key. */
  optionKey?: string;
  /** 0 = subscription (open-ended), 1 = one-off. Default: 0 when an interval is set, else 1. */
  numberOfInstallments?: number;
  /** Display title on the checkout page (sent as `placeholders[TITLE]`). */
  title?: string;
  /** Display description (placeholder {DESCRIPTION}). */
  description?: string;
  /** Lifetime of the buy URL, default "24h". */
  validUntil?: string;
  /**
   * settings[force_rebilling]=Y — forces stored payment details, even for
   * one-off purchases. A prerequisite for later charging against this purchase
   * via createBillingOnDemand (token repurchase / auto top-up). For real
   * subscriptions (billingInterval) it is not needed, but does no harm.
   */
  forceRebilling?: boolean;
}

export interface BuyerContext {
  buyer?: { email: string; firstName?: string; lastName?: string };
  affiliate?: string;
  campaignKey?: string;
  trackingKey?: string;
  upgradeOrderId?: string;
  upgradeType?: "upgrade" | "downgrade";
  /** Free-form context that arrives in the IPN under tracking[custom]. */
  customTracking?: string;
}

function euros(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * WHICH of the two ways this checkout is priced — and the answer is "the
 * stored plan" whenever there is one and nothing needs a price the stored plan
 * cannot express.
 *
 * ── Why the stored plan is the normal case ────────────────────────────────
 * A Digistore24 product does not only sell through the links we build. It has
 * an order form of its own, an affiliate can link straight to it, and the
 * buyer can switch their billing interval from inside their own purchase
 * (`switch_pay_interval_url`, which arrives on every IPN). None of those paths
 * carries an inline price, so all of them charge whatever plans hang on the
 * product. Selling through the same plans our page shows makes those paths
 * agree with us by construction — instead of agreeing only where we remembered
 * to send a price.
 *
 * ── Why an upgrade cannot ─────────────────────────────────────────────────
 * `payment_plan[upgrade_order_id]` prices ONE purchase against another one the
 * buyer already holds. That price exists for this buyer and this moment; it is
 * not a plan on a product, and there is nothing to store it in. Same for a
 * free trial (`test_interval`), if this app ever grows one. Those go inline,
 * with the registry price — which is what every checkout here did before
 * stored plans existed, so the path is not new, it is the old one, kept for
 * the cases that need it.
 *
 * ── And the third case, which is the one that protects the customer ───────
 * `checkoutTargetFor()` hands back NO plan when the stored one no longer
 * matches what the registry says the option costs. So a price edited and not
 * synced lands here too, inline, at the price the vendor actually wrote. The
 * buyer is never charged a number nobody refreshed.
 */
export function sellsThroughStoredPlan(
  offer: Offer,
  ctx: BuyerContext = {},
): boolean {
  return Boolean(offer.payplanId) && !ctx.upgradeOrderId;
}

/** Builds the x-www-form-urlencoded body for createBuyUrl (pure, testable). */
export function buildBuyUrlBody(
  offer: Offer,
  ctx: BuyerContext = {},
  thankyouUrl?: string,
): URLSearchParams {
  const body = new URLSearchParams();
  body.set("product_id", offer.productId);
  body.set("valid_until", offer.validUntil ?? "24h");

  if (sellsThroughStoredPlan(offer, ctx)) {
    const plan = String(offer.payplanId);
    // `settings[plan]` is what SELECTS one of the product's stored plans on
    // the order form, and `hide_plans` stops the buyer being offered the
    // others — they already chose on our page.
    body.set("settings[plan]", plan);
    body.set("settings[hide_plans]", "Y");
    // And `payment_plan[template]` is sent for one reason only: it is
    // VALIDATED. createBuyUrl.php:427-430 refuses a plan that does not belong
    // to this product (`payment_plan_not_found`), so a stale id fails loudly
    // here instead of quietly selling the product's default plan at whatever
    // price that is. Because no `first_amount` accompanies it, the resolved
    // template values are then dropped again
    // (createBuyUrl.php:438-451) — which is exactly what we want: the stored
    // plan prices the sale, not a copy of it we sent along.
    body.set("payment_plan[template]", plan);
  } else {
    const price = euros(offer.priceCents);
    body.set("payment_plan[first_amount]", price);
    body.set("payment_plan[other_amounts]", price);
    body.set("payment_plan[currency]", offer.currency ?? "EUR");
    const installments =
      offer.numberOfInstallments ?? (offer.billingInterval ? 0 : 1);
    body.set("payment_plan[number_of_installments]", String(installments));
    if (offer.billingInterval) {
      body.set("payment_plan[first_billing_interval]", offer.billingInterval);
      body.set("payment_plan[other_billing_intervals]", offer.billingInterval);
    }
  }

  if (ctx.upgradeOrderId) {
    body.set("payment_plan[upgrade_order_id]", ctx.upgradeOrderId);
    body.set("payment_plan[upgrade_type]", ctx.upgradeType ?? "upgrade");
    body.set("settings[hide_double_buy_info]", "Y");
  }

  if (offer.forceRebilling) body.set("settings[force_rebilling]", "Y");

  if (offer.title) body.set("placeholders[TITLE]", offer.title);
  if (offer.description) body.set("placeholders[DESCRIPTION]", offer.description);
  if (thankyouUrl) body.set("urls[thankyou_url]", thankyouUrl);
  if (ctx.customTracking) body.set("tracking[custom]", ctx.customTracking);

  if (ctx.buyer) {
    body.set("buyer[email]", ctx.buyer.email);
    body.set("buyer[readonly_keys]", "email");
    if (ctx.buyer.firstName) body.set("buyer[first_name]", ctx.buyer.firstName);
    if (ctx.buyer.lastName) body.set("buyer[last_name]", ctx.buyer.lastName);
  }

  if (ctx.affiliate) body.set("tracking[affiliate]", ctx.affiliate);
  if (ctx.campaignKey) {
    body.set(
      ctx.affiliate ? "tracking[campaignkey]" : "tracking[trackingkey]",
      ctx.campaignKey,
    );
  } else if (ctx.trackingKey) {
    body.set("tracking[trackingkey]", ctx.trackingKey);
  }

  return body;
}

/**
 * Does this error look like "the affiliate does not exist"?
 *
 * Digistore24 rejects an unknown affiliate with DS_ERR_NOT_FOUND and puts the
 * name we sent into the message (createBuyUrl.php → `_validate_affiliate`).
 * There is no machine-readable marker beyond that, so this is deliberately a
 * heuristic: the name we sent has to appear in the message.
 *
 * Narrow on purpose. Retrying on *any* error would swallow a network failure,
 * an invalid key or an unknown product and report the second attempt's error
 * instead of the real cause.
 */
export function isUnknownAffiliateError(err: unknown, affiliate: string): boolean {
  if (!affiliate) return false;
  const message = err instanceof Error ? err.message : String(err);
  return message.toLowerCase().includes(affiliate.toLowerCase());
}

/**
 * Does this error say "that payment plan is not this product's"?
 *
 * 🚨 **It is a heuristic, and it has to be one.** The API source raises this as
 * `payment_plan_not_found`, which reads like a machine-readable marker — but
 * that is an internal message KEY, translated before it leaves the server.
 * Measured against a live account on 2026-09-09, what actually comes back is
 *
 *   HTTP 404 … "Ungültige Bezahlplan-ID: 999999999 - Bezahlplan nicht
 *   vorhanden oder nicht für das gewählte Produkt.", code 4
 *
 * — German prose, because the account is German. Matching the marker matched
 * nothing, so the retry below never fired and a stale plan id would have taken
 * every buy button of the offering off the page. Exactly the failure the retry
 * exists for, defeated by the one thing a unit test cannot see.
 *
 * So: **the plan id we sent has to appear in the message.** Digistore24 echoes
 * it in every language, and it is unique to this call. That is the same shape
 * `isUnknownAffiliateError` uses one door down, for the same reason and with
 * the same limits — and it is why this takes the id rather than reading it off
 * the error.
 *
 * The literal marker is still accepted: an account whose language surfaces it
 * costs nothing to allow.
 */
export function isStalePaymentPlanError(
  err: unknown,
  payplanId: string | undefined,
): boolean {
  if (!payplanId) return false;
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes(payplanId) ||
    message.toLowerCase().includes("payment_plan_not_found")
  );
}

/**
 * Calls createBuyUrl and returns the buy URL. Throws on error (no mock
 * fallback) — including when the answer contains a URL that is not `https:`,
 * because the buyer is REDIRECTED to this value and never gets to look at it.
 * If — and only if — the affiliate is unknown, it retries once
 * without the affiliate so a typo in a partner link does not block the purchase
 * entirely. If that retry fails too, the ORIGINAL error is thrown: it names the
 * actual cause, the retry only says that a link without an affiliate failed as
 * well.
 *
 * The URL comes back UNDECORATED. In DEV a checkout link has to end in
 * `withTestpayParam(url)` or there is no way to make a test purchase locally;
 * outside DEV that call is a no-op and appending the parameter by hand would
 * hand the product out for free. See the file header — and prefer
 * `checkoutLinkFor()`, which does all of it already.
 */
export async function createBuyUrl(
  apiKey: string,
  offer: Offer,
  ctx: BuyerContext = {},
  thankyouUrl?: string,
): Promise<string> {
  const params = Object.fromEntries(
    buildBuyUrlBody(offer, ctx, thankyouUrl).entries(),
  );
  let url: string;
  try {
    const data = await ds24Post("createBuyUrl", apiKey, params);
    const returned = (data.data as { url?: string } | undefined)?.url;
    if (!returned) throw new Error("Digistore24 returned no buy URL.");
    url = returned;
  } catch (err) {
    // 🚨 A stored plan that Digistore24 no longer recognises would otherwise
    // take out EVERY buy button of this offering at once — one deleted plan,
    // and the whole page has no way to buy anything. So the sale goes through
    // at the registry price, inline, and the mismatch is logged rather than
    // shown to a customer. It is the vendor's problem to fix (`ds24-sync`),
    // not the buyer's to run into.
    if (isStalePaymentPlanError(err, offer.payplanId)) {
      console.error(
        `[digistore] payment plan ${offer.payplanId} is not known for product ${offer.productId} — selling "${offer.key}" at the registry price instead. Run 'node run.mjs ds24-sync'.`,
      );
      return await createBuyUrl(
        apiKey,
        { ...offer, payplanId: undefined },
        ctx,
        thankyouUrl,
      );
    }
    if (!ctx.affiliate || !isUnknownAffiliateError(err, ctx.affiliate)) throw err;
    try {
      return await createBuyUrl(
        apiKey,
        offer,
        { ...ctx, affiliate: undefined },
        thankyouUrl,
      );
    } catch {
      throw err;
    }
  }

  // 🚨 **The one check between a foreign system's answer and the buyer's
  // browser.** Until here the only question asked of `data.data.url` was
  // whether it EXISTS — a cast and a truthiness test. The value then travels
  // untouched through `withTestpayParam()` (a no-op outside DEV) into
  // `app/plans/actions.ts`, where it becomes `redirect(url)`: a `Location`
  // header the buyer's browser follows with no click and no chance to read
  // where it goes. Of the three sinks in this class it is the strongest — an
  // `href` at least needs a click.
  //
  // A checkout is always `https:`. Anything else is not a checkout URL no
  // matter who sent it, and the failure the refusal prevents is a buyer landing
  // on a convincing fake payment form with the vendor's product name on it.
  //
  // ⚠️ **Deliberately outside the `try`**, not next to the existence check.
  // Inside it, this error would fall into the catch above, and
  // `isUnknownAffiliateError()` asks whether the affiliate's name occurs
  // anywhere in the message — a short affiliate id and a URL echoed into the
  // text is enough for a match, and the answer would be a silent retry against
  // the same hostile response instead of a refusal. Out here it can only
  // propagate. The retries themselves return through recursive calls, so each
  // one has already passed this check at its own level.
  //
  // 🚨 **Throw, do not return a fallback.** `app/plans/actions.ts` catches and
  // sends the buyer to `/plans?checkout=error`, and the comment there says why
  // that is the right reaction: a failed checkout must never look like a
  // successful one. This is the whole file's rule — errors throw, there is no
  // silent mock fallback — applied to the content of the answer rather than to
  // the transport.
  if (!/^https:\/\//i.test(url)) {
    throw new Error(
      `Digistore24 returned a non-https buy URL: ${url.slice(0, 40)}`,
    );
  }
  return url;
}

/**
 * sha256 over the DS24-relevant offer fields (detects offer changes).
 *
 * `customTracking` belongs in here even though it lives on the context. A URL
 * only reaches this function when the value is one of the CACHEABLE forms —
 * an intent reference makes the URL user-specific and bypasses the cache
 * entirely (see isUserSpecific). What is left are the token markers, and they
 * must still be told apart: were `customTracking` left out of the hash, two
 * offerings sharing an offerKey but differing in their marker
 * ("tokens:<key>") would serve each other's cached URL and credit the wrong
 * package.
 */
export function offerHash(
  offer: Offer,
  thankyouUrl?: string,
  customTracking?: string,
): string {
  const stable = JSON.stringify({
    productId: offer.productId,
    priceCents: offer.priceCents,
    currency: offer.currency ?? "EUR",
    billingInterval: offer.billingInterval ?? null,
    installments: offer.numberOfInstallments ?? null,
    // Two ways to pay for one offering are two different checkout URLs, and
    // the plan id is what makes them different at Digistore24 — a shared hash
    // would let the monthly and the yearly link serve each other out of the
    // cache, which is the same failure the language axis already guards
    // against one line down in `checkout.ts`.
    payplanId: offer.payplanId ?? null,
    optionKey: offer.optionKey ?? null,
    title: offer.title ?? null,
    description: offer.description ?? null,
    validUntil: offer.validUntil ?? "24h",
    forceRebilling: offer.forceRebilling ?? false,
    thankyouUrl: thankyouUrl ?? null,
    customTracking: customTracking ?? null,
  });
  return crypto.createHash("sha256").update(stable).digest("hex");
}

/**
 * Is this URL for one particular person, and therefore unshareable?
 *
 * `customTracking` is tested by CONTENT, not by presence — that distinction is
 * load-bearing. Token packages set `customTracking` on every offering
 * ("tokens:<key>", see checkout.ts), so asking merely whether the field is set
 * would make every token card a live Digistore24 call on every page render,
 * which is exactly what the cache exists to prevent. Only a buyer identity
 * ("m:<memberId>;t:<token>") names a Member.
 *
 * Exported so the distinction can be tested directly: getting it wrong is
 * invisible until either the cache stops working or one buyer's checkout link
 * is served to another.
 */
export function isUserSpecific(ctx: BuyerContext): boolean {
  return Boolean(
    ctx.buyer ||
      ctx.affiliate ||
      ctx.campaignKey ||
      ctx.trackingKey ||
      ctx.upgradeOrderId ||
      identifiesMember(ctx.customTracking),
  );
}

export interface GetOrCreateArgs {
  apiKey: string;
  offer: Offer;
  ctx?: BuyerContext;
  thankyouUrl?: string;
  /** Cache TTL in hours. Default 20 (safety margin below DS24's 24h). */
  ttlHours?: number;
  /** Injectable for tests; default: the real createBuyUrl. */
  creator?: (
    apiKey: string,
    offer: Offer,
    ctx: BuyerContext,
    thankyouUrl?: string,
  ) => Promise<string>;
  /** Injectable for tests. */
  now?: Date;
}

/**
 * Returns a cached buy URL or creates a new one.
 * - User-specific URLs are never cached: buyer/affiliate/campaign/tracking/
 *   upgrade, and any URL carrying a buyer identity. The cache row
 *   is keyed per offering with no member dimension, so a personal URL written
 *   there would be handed to every later visitor.
 * - If the offering changes (offerHash) or the TTL has expired, a new one is
 *   created and the cache updated.
 *
 * Like `createBuyUrl`, it returns an UNDECORATED URL, and here the ordering is
 * the point: the row written to `buy_url_cache` must stay clean, because it is
 * handed to every later visitor. So a DEV path appends the test-payment
 * parameter to the RETURN VALUE — `await withTestpayParam(url)` — and never
 * before this function. See the file header for the environment rule.
 */
export async function getOrCreateBuyUrl(args: GetOrCreateArgs): Promise<string> {
  const ctx = args.ctx ?? {};
  const create = args.creator ?? createBuyUrl;

  if (isUserSpecific(ctx)) {
    return create(args.apiKey, args.offer, ctx, args.thankyouUrl);
  }

  const now = args.now ?? new Date();
  const hash = offerHash(args.offer, args.thankyouUrl, ctx.customTracking);

  const existing = await db.query.buyUrlCache.findFirst({
    where: eq(buyUrlCache.offerKey, args.offer.key),
  });
  if (existing && existing.offerHash === hash && existing.expiresAt > now) {
    return existing.url;
  }

  const url = await create(args.apiKey, args.offer, ctx, args.thankyouUrl);
  const expiresAt = new Date(now.getTime() + (args.ttlHours ?? 20) * 3_600_000);
  await db
    .insert(buyUrlCache)
    .values({
      offerKey: args.offer.key,
      offerHash: hash,
      url,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: buyUrlCache.offerKey,
      set: { offerHash: hash, url, expiresAt, updatedAt: now },
    });
  return url;
}
