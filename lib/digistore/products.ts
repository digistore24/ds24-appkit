// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Central product registry: one offering (subscription plan or token package)
// per key, and **one Digistore24 product per key AND language**. The source of
// truth is the config file `config/digistore-products.json`.
//
// Flow (see docs/digistore-billing-modes.md):
//   1. Declare the products in the JSON — including price and interval.
//   2. `scripts/ds24/sync-products.mjs` creates them via createProduct or
//      updates them via updateProduct and writes the ids back into
//      `productIds.<env>`.
//   3. Checkout runs through createBuyUrl: price, currency and interval travel
//      WITH the call as a payment_plan (lib/digistore/checkout.ts →
//      lib/digistore/buyUrl.ts). Nothing about the price is maintained a second
//      time inside Digistore24.
//
// EVERY ENVIRONMENT HAS ITS OWN PRODUCT SET (dev / staging / prod).
// `node run.mjs ds24-sync --env <env>` maintains one set at a time; at runtime
// APP_ENV decides which set this instance sells (`runtimeSyncEnv`). Two rules
// keep existing apps selling:
//   - An environment whose own set is empty falls back to the PROD set —
//     that is exactly the pre-split behaviour ("all environments use the same
//     live products"), so an app that never ran an env sync keeps working.
//   - The reverse lookup (`productByDs24Id`) matches across ALL environments:
//     whichever set a purchase came in on, it is the same offering.
// Staging is optional — most apps go dev → prod, which is fine as long as
// they test.
//
// ============================================================================
// WHY ONE OFFERING CAN NEED SEVERAL DIGISTORE24 PRODUCTS
//
// **A Digistore24 product carries exactly ONE language, and that language is
// the language of the ORDER FORM.** `data[language]` on createProduct decides
// what the buyer reads on the checkout page — the field labels, the buttons,
// the payment-method names, the terms-and-cancellation text. It is a property
// of the product, and `createBuyUrl` has no language parameter to override it
// with (checked against the API's own `expectedArgs`: `buyer`, `payment_plan`,
// `tracking`, `urls`, `placeholders`, `settings`, `addons` — no language
// anywhere).
//
// So an app whose UI speaks German and English cannot send both audiences to
// one product: one of the two lands on a form in the other's language, right at
// the moment they are asked for their card details. **Two products, one per
// language, is the only way** — hence the per-language maps in `productIds`,
// and hence the per-language loop in `scripts/ds24/sync-products.mjs`.
//
// What does NOT follow from this: translated product copy. `name`,
// `description`, `tagline` and `features` stay single-language on purpose (it
// is the vendor's own copy — see CLAUDE.md → Languages), and the same
// text is sent to every one of the language products.
// ============================================================================
import productsFile from "@/config/digistore-products.json";
import { DEFAULT_LOCALE } from "@/i18n/config";

/**
 * The language a registry entry is in when it carries a single `productId`
 * and names none. Registries from before per-language products were German —
 * a fact about those files, not about the app, which is why this is not
 * DEFAULT_LOCALE (English, or the first in LOCALES). Twin: FALLBACK_LANGUAGE in
 * `scripts/ds24/_products.mjs`.
 */
const LEGACY_PRODUCT_LANGUAGE = "de";

/**
 * The environment axis of the product sets — the TS side of
 * `scripts/ds24/_env.mjs` (the scripts are plain `.mjs` and cannot import
 * this file; `_env.test.ts` pins the two against each other).
 *
 * This file is part of the exported core (config/core-export.json) and stays
 * PURE — it never reads APP_ENV itself. The env-sensitive functions below
 * take the environment as a parameter, **defaulting to "prod"**: the right
 * answer for an exported companion, which always talks to the live backend.
 * Callers inside the app pass `runtimeSyncEnv()` from
 * `lib/digistore/runtime-env.ts` (deliberately outside the core).
 */
export const SYNC_ENVS = ["dev", "staging", "prod"] as const;
export type SyncEnv = (typeof SYNC_ENVS)[number];

/**
 * Every kind the registry may declare. The union below is DERIVED from this
 * list so the two cannot drift — and it is exported because two guards
 * enumerate it at runtime: the loader's own check right under `allProducts()`,
 * and `plan-sections.test.ts`, which proves every kind reaches a section on
 * the sales page.
 */
export const PRODUCT_KINDS = ["subscription", "token", "one_time"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

/**
 * The key of the single payment option an offering has when it declares none —
 * the shape every registry written before payment options existed has. It never
 * reaches Digistore24 and never reaches a Member; it exists so that nothing
 * below `paymentOptionsOf()` has to ask which of the two shapes it is holding.
 */
export const DEFAULT_OPTION_KEY = "default";

/**
 * Option keys travel: into the buy-URL cache key, and into `tracking[custom]`
 * as `o:<key>` (`lib/digistore/custom.ts`). Same alphabet as a Product Key
 * there, and for the same reason — a `;` or a `:` inside one would split a pair
 * and the IPN would read the rest of the value as something else.
 */
const OPTION_KEY_RE = /^[A-Za-z0-9_-]+$/;

/** ONE WAY TO PAY for an offering, as the registry declares it. */
export interface PaymentOptionDef {
  /** Price in cents — THE authoritative price for this way to pay. */
  priceCents?: number;
  /** Defaults to the offering's own `currency`. */
  currency?: string;
  /** e.g. "1_month" | "12_month". Absent = a one-off payment. */
  billingInterval?: string;
  /** The recommended way to pay; at most one per offering. */
  highlight?: boolean;
}

/**
 * A payment option after normalisation — what every reader sees, whichever of
 * the two registry shapes was written. See `paymentOptionsOf`.
 */
export interface PaymentOption extends PaymentOptionDef {
  /** Stable key inside the offering, or `DEFAULT_OPTION_KEY`. */
  key: string;
  /** Declaration order — the order the page renders and the sync writes. */
  position: number;
}

/**
 * A Digistore24 payment plan this app created, as the registry records it: the
 * id, **and what the plan was written with**.
 *
 * The second half is not bookkeeping. Once the checkout sells through the
 * STORED plan (see `lib/digistore/buyUrl.ts`), Digistore24s copy of the price
 * is what the buyer is charged — so a price edited here and not synced would
 * show one number on `/plans` and take another off the card, silently and for
 * ever. Recording what was written makes that drift a thing the code can SEE:
 * `payplanMatches()` compares, and a mismatch sends the checkout back to the
 * inline plan, where the registry price wins. The customer is never charged a
 * stale price; the vendor is told to run `ds24-sync`.
 *
 * A bare string is accepted as shorthand for "id only, nothing recorded" —
 * that is what a hand-written registry produces, and it means the drift check
 * cannot run rather than that it passed.
 */
export interface PayplanRef {
  id: string;
  priceCents?: number;
  currency?: string;
  billingInterval?: string;
}

export interface ProductDef {
  /** Stable key (e.g. "starter"). */
  key: string;
  /** DS24 product name (also used as name_intern for matching). */
  name: string;
  description?: string;
  kind: ProductKind;
  /** Subscription interval, e.g. "1_month" | "12_month". Sent at checkout. */
  billingInterval?: string;
  /** Token credit per purchase (kind="token" only). */
  credits?: number;
  /**
   * Price in cents — THE authoritative price. Passed along at checkout as
   * payment_plan (lib/digistore/buyUrl.ts); no price is set on the DS24
   * product itself, since `data[amount]` there is deprecated and ignored.
   */
  priceCents?: number;
  currency?: string;
  /** Short addition under the name on the plans page. */
  tagline?: string;
  /** Bullet points on the plans page. */
  features?: string[];
  /** Highlights the plan on the page ("most popular"). */
  highlight?: boolean;
  /** Product image for Digistore24 (publicly reachable URL). */
  imageUrl?: string | null;
  /**
   * Is this offering on sale? **Absent means yes** — only a literal `false`
   * parks it.
   *
   * A parked entry stays in the registry as a template: `ds24-sync` creates
   * no Digistore24 product for it, `/plans` does not show it, and the
   * checkout Action refuses it. That is the difference from DELETING the
   * entry, and it is why the field exists — the shipped example plans are
   * worth keeping as a shape to copy from.
   *
   * 🚨 **Parked is about SELLING, never about ACCESS.** Somebody who bought
   * this offering keeps it: `hasPlan()`, `entitlementsFor()`,
   * `productByDs24Id()` (the IPN's reverse lookup) and the IPN scope all read
   * the FULL list and know nothing about this field. Parking a plan does not
   * end a single subscription, and refunds for it keep arriving. The seam is
   * `sellableProducts()` below, and which reader needs which list is spelled
   * out there.
   *
   * ⚠️ It also does not unpublish the product at Digistore24, and that is the
   * difference from taking the entry OUT. One that was synced before stays
   * buyable over there through an old checkout link — `ds24-sync` says so when
   * it meets one. Removing the entry entirely is what makes the product an
   * orphan `node run.mjs ds24-sync --prune` can delete (or, if it ever sold,
   * deactivate).
   */
  sell?: boolean;
  /**
   * THE WAYS TO PAY for this one offering — monthly and yearly are two of
   * these, not two offerings.
   *
   * Absent means the offering has exactly one way to pay, the one described by
   * `priceCents` / `billingInterval` above. `paymentOptionsOf()` normalises
   * both shapes into a list and nothing downstream branches on which was
   * written. Declaring BOTH is refused when this module loads: two prices in
   * one entry is exactly the drift the registry exists to prevent.
   *
   *   "paymentOptions": {
   *     "monthly": { "priceCents": 1900,  "billingInterval": "1_month" },
   *     "yearly":  { "priceCents": 19000, "billingInterval": "12_month" }
   *   }
   *
   * 🚨 **An option is a PRICE, never an entitlement.** The monthly and the
   * yearly buyer of this offering hold the SAME Product Key, so `hasPlan()`
   * asks one question and a `planKeys` list names one key. That is the whole
   * point of the shape: the older registry made every gate name both
   * intervals, and a gate that named one silently refused half the buyers —
   * with a page that rendered and a file that was not there.
   */
  paymentOptions?: Record<string, PaymentOptionDef>;
  /**
   * The Digistore24 PAYMENT PLAN ids — `productIds` with one axis more, and
   * the same contract: written back by `scripts/ds24/sync-products.mjs`,
   * committed, never edited by hand.
   *
   *   "payplanIds": { "prod": { "de": { "monthly": "991", "yearly": "992" } } }
   *
   * ⚠️ A stale id here is not cosmetic. `createBuyUrl` refuses a
   * `payment_plan[template]` that does not belong to the product it was called
   * for (`payment_plan_not_found`), which would take out EVERY buy button of
   * the offering at once. `lib/digistore/buyUrl.ts` retries once without it
   * and logs the mismatch rather than letting the page go dark.
   */
  payplanIds?: Partial<
    Record<SyncEnv, Record<string, Record<string, PayplanRef | string | null>>>
  >;
  /**
   * **One product set per ENVIRONMENT, one Digistore24 product per language
   * inside each set** — the id, keyed by env and by the language its order
   * form is in. `null` = declared but not created yet;
   * `sync-products.mjs --env <env>` writes the ids back here.
   *
   *   "productIds": {
   *     "dev":  { "de": "412345", "en": "412346" },
   *     "prod": { "de": null, "en": null }
   *   }
   *
   * The language keys are the languages this offering is SOLD in, and they
   * should cover the app's `LOCALES` (`i18n/config.ts`) — a locale with no
   * entry falls back to another product, and its buyers get a form in the
   * wrong language (see `checkoutProductFor`). `node run.mjs ds24-sync` warns
   * about the gap. Declaring a language in ANY environment declares it for
   * all of them (the sync reads the union).
   *
   * The language also decides **which Digistore24 marketplace the approval is
   * requested from**: German → Digistore24 Germany (siteowner 1), everything
   * else → USA (2). Approval is requested for the PROD set only — a "[DEV]"
   * product has no business on a marketplace.
   * See `scripts/ds24/request-approval.mjs` and `scripts/ds24/_resellers.mjs`.
   */
  productIds?: Partial<Record<SyncEnv, Record<string, string | null>>>;
  /**
   * LEGACY, read but never written: the shared per-language map from before
   * the environment split (template < 0.14.0), when every environment used
   * the same products. Reads as the PROD set — those products may carry real
   * sales and approvals; the first `ds24-sync --env prod` adopts them into
   * `productIds.prod`. Do not add this to a new registry.
   */
  productIdByLanguage?: Record<string, string | null>;
  /**
   * LEGACY, read but never written: the single-product shape from before
   * template 0.6.0, where an offering had one `productId` and `language` said
   * which language it was in. Reads as one PROD entry (see `productIdsOf`);
   * `ds24-sync --env prod` rewrites it. Do not add these to a new registry.
   */
  productId?: string | null;
  /** LEGACY, see `productId`. The language of that single product. */
  language?: string;
}

/**
 * The DS24 product ids of an offering FOR ONE ENVIRONMENT, by language — only
 * the ones that exist, so an entry declared as `null` (not synced yet) is
 * absent rather than empty.
 *
 * The ONE place the legacy shapes are understood; every reader goes through
 * here so there is exactly one translation and no call site has to know that
 * the old shapes existed. Both legacy shapes — the shared
 * `productIdByLanguage` map and the pre-0.6.0 `productId`/`language` pair —
 * read as PROD and only as prod: they predate the environment split, and the
 * products they name are the live ones. Each only fills a language the env
 * map does not already name — a registry mid-migration has both, and the env
 * map is the one `ds24-sync` maintains.
 */
export function productIdsOf(
  def: ProductDef,
  env: SyncEnv = "prod",
): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const [lang, id] of Object.entries(def.productIds?.[env] ?? {})) {
    if (id) ids[lang] = String(id);
  }
  if (env !== "prod") return ids;
  for (const [lang, id] of Object.entries(def.productIdByLanguage ?? {})) {
    if (id && !ids[lang]) ids[lang] = String(id);
  }
  const legacyLang = def.language || LEGACY_PRODUCT_LANGUAGE;
  if (def.productId && !ids[legacyLang]) ids[legacyLang] = String(def.productId);
  return ids;
}

/**
 * The ways to pay for this offering, normalised — the ONE place the two
 * registry shapes are understood, and the twin of `productIdsOf` for the price
 * axis.
 *
 * An entry with no `paymentOptions` yields exactly one option, keyed
 * `DEFAULT_OPTION_KEY` and carrying the entry's own price and interval. So
 * every reader below this line sees a list, a registry written before options
 * existed keeps working untouched, and an offering with a single way to pay
 * stays the normal case rather than a special one.
 *
 * The order is the DECLARATION order, and it is load-bearing twice: it is the
 * order the plans page renders in, and it is the `position` the sync writes
 * onto the Digistore24 payment plans — so the order form lists them the way
 * the registry does rather than however Digistore24 happens to sort.
 */
export function paymentOptionsOf(def: ProductDef): PaymentOption[] {
  const declared = Object.entries(def.paymentOptions ?? {});
  if (declared.length === 0) {
    return [
      {
        key: DEFAULT_OPTION_KEY,
        position: 0,
        priceCents: def.priceCents,
        currency: def.currency,
        billingInterval: def.billingInterval,
        highlight: def.highlight,
      },
    ];
  }
  return declared.map(([key, option], position) => ({
    key,
    position,
    priceCents: option.priceCents,
    currency: option.currency ?? def.currency,
    billingInterval: option.billingInterval,
    highlight: option.highlight,
  }));
}

/**
 * One way to pay, by key — `null` for a key this offering does not declare.
 *
 * Deliberately not forgiving: an unknown option is not a near-miss the way an
 * unknown LANGUAGE is, it is a caller naming a price that does not exist, and
 * answering with a different one would charge the buyer for the wrong thing.
 */
export function findPaymentOption(
  def: ProductDef,
  optionKey: string,
): PaymentOption | null {
  return paymentOptionsOf(def).find((o) => o.key === optionKey) ?? null;
}

/**
 * The ids this instance actually SELLS in `env`: the environment's own set —
 * or the PROD set when that is empty and `env` is not prod. The fallback is
 * the pre-split behaviour, and it is what keeps an app selling that updated
 * the template but never ran `ds24-sync --env dev`: its dev checkout keeps
 * using the live products, exactly as before. An app that HAS a dev set is
 * isolated — its dev checkout never touches prod.
 */
function sellableIdsOf(def: ProductDef, env: SyncEnv): Record<string, string> {
  const own = productIdsOf(def, env);
  if (Object.keys(own).length > 0 || env === "prod") return own;
  return productIdsOf(def, "prod");
}

/** Every language this offering has a live Digistore24 product for. */
export function productLanguages(
  def: ProductDef,
  env: SyncEnv = "prod",
): string[] {
  return Object.keys(sellableIdsOf(def, env));
}

/**
 * The Digistore24 product to send a buyer reading `locale` to — the one whose
 * ORDER FORM is in their language — or `null` when the offering is not synced
 * at all.
 *
 * **The fallback chain is deliberate, and it prefers a sale in the wrong
 * language over no sale**: exact locale, then the app's default locale, then
 * whichever product exists. An offering sold in German only stays buyable by an
 * English visitor; they simply get the German form. Refusing instead would turn
 * a missing translation into a lost customer, and the gap is already reported
 * where it can be fixed — `node run.mjs ds24-sync` warns when a registry
 * language set does not cover the app's `LOCALES`.
 *
 * Returns the language it actually resolved to, not just the id: the caller
 * needs it for the buy-URL cache key (two languages of one offering are two
 * different checkout URLs — see `lib/digistore/checkout.ts`).
 */
export function checkoutProductFor(
  def: ProductDef,
  locale: string,
  env: SyncEnv = "prod",
): { productId: string; language: string } | null {
  const ids = sellableIdsOf(def, env);
  const language =
    (ids[locale] && locale) ||
    (ids[DEFAULT_LOCALE] && DEFAULT_LOCALE) ||
    Object.keys(ids)[0];
  return language ? { productId: ids[language], language } : null;
}

/**
 * WHICH environment's product set `env` actually sells from — `env` itself, or
 * PROD when this offering has no set of its own there. The env twin of the
 * language fallback in `checkoutProductFor`, and it exists because a payment
 * plan belongs to ONE product: reading dev plan ids for a product that came out
 * of the PROD set hands `createBuyUrl` a plan that is not its own, and it
 * answers `payment_plan_not_found` for every buyer.
 */
function effectiveEnv(def: ProductDef, env: SyncEnv): SyncEnv {
  if (env === "prod") return "prod";
  return Object.keys(productIdsOf(def, env)).length > 0 ? env : "prod";
}

/**
 * The Digistore24 payment plans of an offering, for one environment and one
 * language, by option key — only the ones that exist, exactly as
 * `productIdsOf` drops the products nobody has created yet.
 *
 * There is no legacy shape to read: payment plans postdate all three of them.
 * And a missing plan is not an error — it means the checkout falls back to
 * sending its own inline payment plan, which is what every checkout in this
 * template did before payment plans existed at all.
 */
export function payplansOf(
  def: ProductDef,
  language: string,
  env: SyncEnv = "prod",
): Record<string, PayplanRef> {
  const plans: Record<string, PayplanRef> = {};
  for (const [option, ref] of Object.entries(
    def.payplanIds?.[env]?.[language] ?? {},
  )) {
    if (!ref) continue;
    if (typeof ref === "string" || typeof ref === "number") {
      plans[option] = { id: String(ref) };
    } else if (ref.id) {
      plans[option] = { ...ref, id: String(ref.id) };
    }
  }
  return plans;
}

/**
 * Does the stored plan still describe what the registry says this option
 * costs? A plan that recorded nothing answers `true` — "not checkable" is not
 * "wrong", and refusing there would push every hand-written registry onto the
 * inline path for no reason.
 *
 * 🚨 Currency and interval count as much as the amount. A plan written as
 * `12_month` and edited to `1_month` in the registry charges the yearly price
 * every month; nothing about that is a rounding difference.
 */
export function payplanMatches(
  plan: PayplanRef,
  option: PaymentOption,
): boolean {
  if (
    plan.priceCents === undefined &&
    plan.currency === undefined &&
    plan.billingInterval === undefined
  ) {
    return true;
  }
  return (
    plan.priceCents === option.priceCents &&
    (plan.currency ?? "EUR") === (option.currency ?? "EUR") &&
    (plan.billingInterval ?? null) === (option.billingInterval ?? null)
  );
}

/**
 * Everything one buy button needs: which Digistore24 product the buyer is sent
 * to, which stored payment plan describes what they are about to pay, and which
 * of the offering's ways to pay this is.
 *
 * The language axis is `checkoutProductFor`'s, unchanged — including its
 * deliberate preference for a sale in the wrong language over no sale. The
 * option axis has no fallback at all, for the reason `findPaymentOption` gives.
 */
export function checkoutTargetFor(
  def: ProductDef,
  optionKey: string,
  locale: string,
  env: SyncEnv = "prod",
): {
  productId: string;
  /** The stored plan to sell through, or `null` — then the checkout prices it itself. */
  payplan: PayplanRef | null;
  /** The stored plan exists but no longer matches the registry. `ds24-sync` is due. */
  payplanStale: boolean;
  language: string;
  option: PaymentOption;
} | null {
  const option = findPaymentOption(def, optionKey);
  if (!option) return null;
  const resolved = checkoutProductFor(def, locale, env);
  if (!resolved) return null;
  const from = effectiveEnv(def, env);
  const stored = payplansOf(def, resolved.language, from)[optionKey] ?? null;
  const stale = stored !== null && !payplanMatches(stored, option);
  return {
    productId: resolved.productId,
    // A stale plan is handed back as "no plan": the caller must price the
    // checkout itself rather than sell through a number nobody refreshed.
    payplan: stale ? null : stored,
    payplanStale: stale,
    language: resolved.language,
    option,
  };
}

/**
 * Price formatted per the language's conventions: "19,00 €" (de), "€19.00"
 * (en). `null` when no price is set — the UI then writes "on request"
 * (`plans.onRequest`).
 *
 * The currency stays the product's; only the formatting is localized.
 * Converting prices would be wrong — what gets billed is what Digistore24
 * holds.
 */
export function formatPrice(
  def: Pick<ProductDef, "priceCents" | "currency">,
  locale: string,
): string | null {
  if (def.priceCents == null) return null;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: def.currency ?? "EUR",
  }).format(def.priceCents / 100);
}

/** Translatable label for the billing interval. */
export type IntervalKey = "perMonth" | "perYear" | "oneTime";

/**
 * The interval as a key into `messages/*.json` (namespace `plans`) — not as
 * finished text, so the plans page can render it in the visitor's language.
 * `null` for an interval we do not know; the UI then shows the raw value.
 */
export function intervalKey(
  def: Pick<ProductDef, "kind" | "billingInterval">,
  option?: Pick<PaymentOption, "billingInterval">,
): IntervalKey | null {
  if (def.kind !== "subscription") return "oneTime";
  const interval = option ? option.billingInterval : def.billingInterval;
  if (interval === "1_month") return "perMonth";
  if (interval === "12_month") return "perYear";
  return null;
}

interface ProductsFile {
  products: Record<string, Omit<ProductDef, "key">>;
}

const raw = productsFile as unknown as ProductsFile;

/** All declared products (with the key resolved). */
export function allProducts(): ProductDef[] {
  return Object.entries(raw.products).map(([key, def]) => ({ key, ...def }));
}

/**
 * Is this offering on sale? Absent `sell` means yes — see `ProductDef.sell`.
 *
 * Written as `!== false` rather than a truthiness test on purpose: every
 * registry that exists today has no `sell` field at all, and the answer for
 * those must be "sold". A default of "parked" would take every product of
 * every running app off `/plans` and out of the sync the moment they update.
 */
export function isSold(def: Pick<ProductDef, "sell">): boolean {
  return def.sell !== false;
}

/**
 * The offerings this app is currently SELLING — `allProducts()` minus the
 * parked ones.
 *
 * 🚨 **The seam of the whole `sell` field, and the direction matters.**
 * `allProducts()` is deliberately NOT filtered, because most of its readers
 * answer questions about a purchase that already happened, and a filter there
 * would reach them through a default argument nobody sees at the call site.
 * The dividing line: **a new purchase decision may be refused, an existing
 * payment relationship never is.**
 *
 * Four readers want this list — the plans page, `contradictingProducts()`
 * (which is about what gets synced and is buyable), the ops probe counting
 * whether this app sells anything, and the token packages on offer. Plus
 * `productTargets()` on the script side, which is the sync and the
 * marketplace approval in one.
 *
 * Everything else keeps the full list, and three of them would cost real
 * money otherwise: `productByDs24Id()` (the IPN could no longer tell which
 * offering a payment, refund or chargeback belongs to — and
 * `orders.productKey` is never reconstructed), `syncedProductIds()` in
 * `scripts/ds24/_products.mjs` (a parked id dropping out of the IPN scope
 * stops its buyers' refunds and cancellations arriving at all), and
 * `getTokenPackage()` (an automatic top-up runs on a mandate somebody already
 * armed). `getProduct()`/`findProduct()` read the raw registry directly and
 * are unaffected by construction, which is what keeps `hasPlan()` honest.
 */
export function sellableProducts(): ProductDef[] {
  return allProducts().filter(isSold);
}

/**
 * The registry entries whose `kind` is not one this app knows — as messages,
 * one per offending entry. Pure and takes the list, so the typo case is
 * asserted by tests rather than trusted (the shipped registry is always
 * clean, which is exactly why a check reading it directly would prove
 * nothing).
 */
export function unknownKindProblems(
  products: ReadonlyArray<{ key: string; kind: unknown }>,
): string[] {
  return products
    .filter((p) => !(PRODUCT_KINDS as readonly unknown[]).includes(p.kind))
    .map(
      (p) =>
        `"${p.key}": unbekannte Produktart ${JSON.stringify(p.kind)} — erlaubt: ${PRODUCT_KINDS.join(", ")}`,
    );
}

/**
 * The registry entries whose `sell` is neither a boolean nor absent — the
 * twin of `unknownKindProblems()`, and pure for the same reason.
 *
 * 🚨 **Refused rather than ignored, and the trade is the same one the `kind`
 * block below spells out: there is no harmless direction.** `"sell": "false"`
 * — the string, which is what a hand-edited JSON file produces most easily —
 * is truthy, so `isSold()` would answer "sold" and the sync would go and
 * create the product at Digistore24. That is precisely the damage this field
 * was added to prevent, and it cannot be undone from here.
 */
export function sellFieldProblems(
  products: ReadonlyArray<{ key: string; sell?: unknown }>,
): string[] {
  return products
    .filter((p) => p.sell !== undefined && typeof p.sell !== "boolean")
    .map(
      (p) =>
        `"${p.key}": "sell" muss true oder false sein (oder ganz fehlen) — steht auf ${JSON.stringify(p.sell)}`,
    );
}

/**
 * The registry entries whose payment options the sync could not describe —
 * the third pure, list-taking check beside `unknownKindProblems` and
 * `sellFieldProblems`, refused at module load for the same reason: there is no
 * harmless direction here either.
 *
 * 🚨 The sharp one is the last: a product with NO payment plan of ours does
 * not have none — it has Digistore24's own default (about 27 €), its order
 * form charges it, and on a subscription such an order grants access for ever
 * (`docs/digistore-integration.md`). An option the sync refuses to write is
 * therefore not a missing card on a page; it is a price nobody set, collecting
 * money.
 */
export function paymentOptionProblems(
  products: ReadonlyArray<{
    key: string;
    kind?: unknown;
    priceCents?: unknown;
    billingInterval?: unknown;
    paymentOptions?: unknown;
  }>,
): string[] {
  const problems: string[] = [];
  for (const p of products) {
    const declared = p.paymentOptions;
    if (declared === undefined) continue;
    if (
      typeof declared !== "object" ||
      declared === null ||
      Array.isArray(declared)
    ) {
      problems.push(
        `"${p.key}": "paymentOptions" muss ein Objekt sein — steht auf ${JSON.stringify(declared)}`,
      );
      continue;
    }
    const entries = Object.entries(declared as Record<string, unknown>);
    if (entries.length === 0) {
      problems.push(
        `"${p.key}": "paymentOptions" ist leer — entweder Bezahlweisen deklarieren oder das Feld weglassen`,
      );
      continue;
    }
    if (p.priceCents !== undefined || p.billingInterval !== undefined) {
      problems.push(
        `"${p.key}": "paymentOptions" und "priceCents"/"billingInterval" zugleich — der Preis staende an zwei Stellen, die Bezahlweisen sind die eine`,
      );
    }
    if (p.kind === "token" && entries.length > 1) {
      problems.push(
        `"${p.key}": ein Token-Paket hat genau eine Bezahlweise — mehrere Paketgroessen sind mehrere Angebote`,
      );
    }
    let highlighted = 0;
    for (const [optionKey, option] of entries) {
      if (!OPTION_KEY_RE.test(optionKey)) {
        problems.push(
          `"${p.key}": Bezahlweise ${JSON.stringify(optionKey)} — erlaubt sind Buchstaben, Ziffern, _ und -`,
        );
      }
      if (
        typeof option !== "object" ||
        option === null ||
        Array.isArray(option)
      ) {
        problems.push(
          `"${p.key}.${optionKey}": muss ein Objekt sein — steht auf ${JSON.stringify(option)}`,
        );
        continue;
      }
      const o = option as PaymentOptionDef;
      if (o.priceCents !== undefined && typeof o.priceCents !== "number") {
        problems.push(
          `"${p.key}.${optionKey}": "priceCents" muss eine Zahl sein — steht auf ${JSON.stringify(o.priceCents)}`,
        );
      }
      if (o.highlight === true) highlighted += 1;
    }
    if (highlighted > 1) {
      problems.push(
        `"${p.key}": ${highlighted} Bezahlweisen mit "highlight" — genau eine kann die empfohlene sein`,
      );
    }
  }
  return problems;
}

// The cast above (`as unknown as ProductsFile`) is a claim, and the registry
// is a JSON file the vendor edits by hand — so the claim is checked here,
// once, when the module loads, and a `"kind": "one-time"` (hyphen typo)
// refuses to start instead of doing what it used to do: silently vanish from
// the sales page while STAYING BUYABLE via a direct POST, where the buyer
// pays and the IPN's strict `kind === "token"` credits nothing.
//
// Loud on purpose, and the opposite trade from `billingMode()`, which falls
// back to `"both"` on a typo: there, one direction is harmless (a card too
// many). Here there is no harmless direction — dropping the product IS the
// damage — so this follows `getProduct()` and `hasPlan()` instead: an
// unchecked value does not mean "not shown", it takes the app down at the
// first `node run.mjs start`, which is the cheapest moment anybody can learn
// about it.
//
// `sell` is checked in the same breath and for the same reason, one step
// sharper: a `kind` typo drops the product from the page, a `sell` typo puts
// a product the vendor did not want on sale INTO their Digistore24 account,
// and that cannot be undone from here.
{
  const problems = [
    ...unknownKindProblems(allProducts()),
    ...sellFieldProblems(allProducts()),
    ...paymentOptionProblems(allProducts()),
  ];
  if (problems.length > 0) {
    throw new Error(`config/digistore-products.json: ${problems.join("; ")}`);
  }
}

/**
 * Product definition, or `null` for a key the registry does not hold.
 *
 * The forgiving twin of `getProduct()`, for the callers that must survive a key
 * going missing. That is not a theoretical case: the registry is a file the
 * app-builder edits, so a key recorded on an old order can be renamed or
 * deleted afterwards — and `orders.productKey` is deliberately never
 * reconstructed. A purchase confirmation must not throw over that.
 */
export function findProduct(key: string): ProductDef | null {
  // Object.hasOwn, not a bare index: the registry is a plain JSON object,

  // so "constructor", "__proto__", "toString" and "valueOf" all resolve

  // through Object.prototype and would be treated as real products —

  // including by hasPlan(), which would then answer true for them.

  const def = Object.hasOwn(raw.products, key) ? raw.products[key] : undefined;
  return def ? { key, ...def } : null;
}

/** Product definition, or throws on an unknown key. */
export function getProduct(key: string): ProductDef {
  const def = findProduct(key);
  if (!def) throw new Error(`Unbekanntes Produkt: ${key}`);
  return def;
}

/** Products of one kind (e.g. all token packages). */
export function productsByKind(kind: ProductKind): ProductDef[] {
  return allProducts().filter((p) => p.kind === kind);
}

/**
 * WHAT was bought, from the Digistore24 product id on a payload — the reverse
 * lookup, and the ONE safe way to do it.
 *
 * PURE, and takes the product list as an argument, so the guard below is
 * asserted by tests rather than trusted (products.test.ts). It governs which
 * plan a payment unlocks; nothing in this repo can test a DB-bound function.
 *
 * **It searches EVERY language product of an offering, in EVERY environment.**
 * A German buyer and an English one arrive on two different Digistore24
 * products, and the IPN names whichever one was actually bought — so matching
 * only the first id would leave every English purchase unattributed, and
 * `orders.productKey` is never reconstructed later. The environments widen the
 * same rule: a dev test purchase arrives on a dev product id, and it is still
 * this offering — which set it came in on is not this function's question
 * (the per-environment IPN connections keep the instances apart).
 *
 * THE GUARD IS BOTH SIDES BEING NON-EMPTY. The ids are null for every offering
 * until `node run.mjs ds24-sync` has run, and an IPN payload may arrive with
 * no product id at all. A naive `p.productId === id` with two empty values
 * matches the FIRST UNSYNCED PRODUCT — which for an entitlement means granting
 * a plan the buyer never bought. `productIdsOf` drops the empty ones, so an
 * unsynced entry simply does not match and the answer is `null` — *unknown*,
 * never *wrong*. That is the distinction the warning on `orders.productKey`
 * (schema-digistore.ts:58-64) was protecting, and it survives intact.
 *
 * Ambiguity resolves to `null` as well: two offerings sharing one Digistore24
 * product id cannot be told apart, and guessing would grant the wrong one. Two
 * LANGUAGES — or two ENVIRONMENTS — of the SAME offering are not ambiguous;
 * they are one answer.
 */
export function productByDs24Id(
  id: string | null | undefined,
  products: ProductDef[] = allProducts(),
): ProductDef | null {
  if (!id) return null;
  const matches = products.filter((p) =>
    SYNC_ENVS.some((env) =>
      Object.values(productIdsOf(p, env)).includes(String(id)),
    ),
  );
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Live product ID of an offering, for one language. Throws when that offering
 * is not synced at all (run `node run.mjs ds24-sync`).
 *
 * Falls back exactly as `checkoutProductFor` does, so a language nobody has
 * created a product for yet answers with another one rather than throwing —
 * "not synced" and "not sold in this language" are different states, and only
 * the first is an error.
 */
export function productId(
  key: string,
  locale: string = DEFAULT_LOCALE,
  env: SyncEnv = "prod",
): string {
  const resolved = checkoutProductFor(getProduct(key), locale, env);
  if (!resolved) {
    throw new Error(
      `Produkt "${key}" hat noch keine productId. Erst 'node run.mjs ds24-sync' ausfuehren.`,
    );
  }
  return resolved.productId;
}

/** Does this offering have at least one live Digistore24 product? */
export function hasProductId(key: string, env: SyncEnv = "prod"): boolean {
  return productLanguages(getProduct(key), env).length > 0;
}

// Checkout links are NOT built here. A plain product link
// (`…/product/<id>`) would force the price to be maintained inside
// Digistore24 as a payment plan, and would give up free trials, upgrades,
// vouchers and per-link affiliate commissions. See lib/digistore/checkout.ts.
