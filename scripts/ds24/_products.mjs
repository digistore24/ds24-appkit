// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Shared helpers for the product registry (config/digistore-products.json).
// Reading/writing the config, so that sync-products & request-approval use the
// same source as the app (lib/digistore/products.ts).
import { randomBytes } from "crypto";
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";

const CONFIG_URL = new URL(
  "../../config/digistore-products.json",
  import.meta.url,
);
export const CONFIG_PATH = fileURLToPath(CONFIG_URL);

const MESSAGES_DIR = fileURLToPath(new URL("../../messages", import.meta.url));

/**
 * The language a registry entry is assumed to be in when it carries a single
 * `productId` and names none. Registries from before per-language products
 * were German — a fact about those files, not about the app, so this is NOT
 * the app's DEFAULT_LOCALE (English, or the first in LOCALES). Twin:
 * LEGACY_PRODUCT_LANGUAGE in `lib/digistore/products.ts`.
 */
export const FALLBACK_LANGUAGE = "de";

/**
 * Is this offering on sale? Absent `sell` means yes — the twin of `isSold()`
 * in `lib/digistore/products.ts`, where the field is documented in full.
 *
 * `!== false` and not a truthiness test: every registry written before this
 * field existed has no `sell` at all, and those products must keep selling.
 */
export function isSold(def) {
  return def?.sell !== false;
}

/**
 * The registry entries whose `sell` is neither a boolean nor absent — the
 * twin of `sellFieldProblems()` in `lib/digistore/products.ts`.
 *
 * 🚨 The string `"false"` is truthy, so without this check `isSold()` would
 * answer "sold" for it and the sync would create the product at Digistore24 —
 * the one outcome this field exists to prevent, and the one that cannot be
 * undone from here.
 */
export function sellFieldProblems(json) {
  return Object.entries(json.products ?? {})
    .filter(([, def]) => def?.sell !== undefined && typeof def.sell !== "boolean")
    .map(
      ([key, def]) =>
        `"${key}": "sell" must be true or false (or absent) — it is ${JSON.stringify(def.sell)}`,
    );
}

/**
 * The languages the APP speaks, read off `messages/<code>.json`.
 *
 * The truth is `LOCALES` in `i18n/config.ts`, and these scripts are plain
 * `.mjs` that do not import the app's TypeScript (same twin rule as
 * `_public-url.mjs`). The message files are the next-best signal and cannot
 * drift from it: `i18n/messages.test.ts` fails the build when a locale has no
 * file, and a file with no locale would fail on the first render.
 *
 * Used only to WARN — a registry that does not cover a locale still sells.
 */
export function appLanguages() {
  try {
    return readdirSync(MESSAGES_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length))
      .sort();
  } catch {
    return [];
  }
}

/** Every environment a product set can exist for (see _env.mjs). */
const ENVS = ["dev", "staging", "prod"];

/**
 * The Digistore24 product ids of one registry entry FOR ONE ENVIRONMENT, by
 * language — the `.mjs` twin of `productIdsOf()` in
 * `lib/digistore/products.ts`. Change one, change the other;
 * `_products.test.ts` pins the shape.
 *
 * Includes languages declared but not created yet (value `null`), because the
 * sync's whole job is to fill exactly those in. Readers that want only the
 * live ones filter for a truthy value.
 *
 * Two legacy shapes read as PROD and only as prod — they predate the
 * environment split, and the products they name are the ones that may carry
 * real sales and approvals (see adoptLegacyAsProd):
 *   - `productIdByLanguage` (template < 0.14.0, one shared set for every env)
 *   - the `productId`/`language` pair (template < 0.6.0, one product total)
 */
export function productIdsOf(def, env) {
  const ids = { ...(def.productIds?.[env] ?? {}) };
  if (env !== "prod") return ids;
  for (const [lang, id] of Object.entries(def.productIdByLanguage ?? {})) {
    if (ids[lang] == null) ids[lang] = id == null ? id : String(id);
  }
  const legacyLang = def.language || FALLBACK_LANGUAGE;
  if (def.productId && !ids[legacyLang]) ids[legacyLang] = String(def.productId);
  return ids;
}

/**
 * The languages one offering is sold in — declared, not necessarily created,
 * and declared ONCE for every environment: the union across all env maps and
 * the legacy fields. A language listed in the dev set is a language the
 * offering speaks, so a later prod sync creates it there too.
 */
export function languagesOf(def) {
  const languages = new Set();
  for (const env of ENVS) {
    for (const lang of Object.keys(def.productIds?.[env] ?? {})) languages.add(lang);
  }
  for (const lang of Object.keys(def.productIdByLanguage ?? {})) languages.add(lang);
  if (def.productId) languages.add(def.language || FALLBACK_LANGUAGE);
  return languages.size > 0 ? [...languages] : [FALLBACK_LANGUAGE];
}

/**
 * The key of the single payment option an entry has when it declares none —
 * the twin of DEFAULT_OPTION_KEY in `lib/digistore/products.ts`.
 */
export const DEFAULT_OPTION_KEY = "default";

/** Twin of OPTION_KEY_RE in `lib/digistore/products.ts`. */
const OPTION_KEY_RE = /^[A-Za-z0-9_-]+$/;

/**
 * The ways to pay for one offering, normalised — the `.mjs` twin of
 * `paymentOptionsOf()` in `lib/digistore/products.ts`. Change one, change the
 * other; `_products.test.ts` pins the two against each other.
 *
 * An entry with no `paymentOptions` yields exactly one option carrying the
 * entry's own price and interval, so every registry written before payment
 * options existed keeps syncing unchanged — and so the sync has one shape to
 * write plans from rather than two.
 *
 * `position` is the declaration order and travels to Digistore24 as the
 * payment plan's own `position`, so the order form lists the ways to pay the
 * way the registry does.
 */
export function paymentOptionsOf(def) {
  const declared = Object.entries(def?.paymentOptions ?? {});
  if (declared.length === 0) {
    return [
      {
        key: DEFAULT_OPTION_KEY,
        position: 0,
        priceCents: def?.priceCents,
        currency: def?.currency,
        billingInterval: def?.billingInterval,
        highlight: def?.highlight,
      },
    ];
  }
  return declared.map(([key, option], position) => ({
    key,
    position,
    priceCents: option?.priceCents,
    currency: option?.currency ?? def?.currency,
    billingInterval: option?.billingInterval,
    highlight: option?.highlight,
  }));
}

/**
 * The Digistore24 payment plans of one entry, for one environment and one
 * language, by option key. Twin of `payplansOf()` in
 * `lib/digistore/products.ts` — same normalisation, same shorthand: a bare
 * string is an id with nothing recorded beside it.
 *
 * What IS recorded beside it is the price the plan was written with, and that
 * is the point: once the checkout sells through the stored plan, Digistore24s
 * copy of the price is what the buyer pays. Recording what we wrote is what
 * lets the app notice that somebody edited the registry and never synced.
 *
 * No legacy shape to read: payment plans postdate all three of them.
 */
export function payplansOf(def, language, env) {
  const plans = {};
  for (const [option, ref] of Object.entries(
    def?.payplanIds?.[env]?.[language] ?? {},
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
 * Does a stored plan still describe what the registry says the option costs?
 * Twin of `payplanMatches()` in `lib/digistore/products.ts`; a plan that
 * recorded nothing answers true, because "not checkable" is not "wrong".
 */
export function payplanMatches(plan, option) {
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
 * The registry entries whose payment options the sync could not write — the
 * twin of `paymentOptionProblems()` in `lib/digistore/products.ts`.
 *
 * 🚨 The reason it refuses rather than skips: a product with no payment plan
 * of ours does not have none, it has Digistore24s own default (about 27 EUR),
 * and its order form charges that. On a subscription such an order grants
 * access for ever. An option the sync cannot describe is therefore a price
 * nobody set, collecting money — not a missing card on a page.
 */
export function paymentOptionProblems(json) {
  const problems = [];
  for (const [key, def] of Object.entries(json.products ?? {})) {
    const declared = def?.paymentOptions;
    if (declared === undefined) continue;
    if (typeof declared !== "object" || declared === null || Array.isArray(declared)) {
      problems.push(
        `"${key}": "paymentOptions" must be an object — it is ${JSON.stringify(declared)}`,
      );
      continue;
    }
    const entries = Object.entries(declared);
    if (entries.length === 0) {
      problems.push(
        `"${key}": "paymentOptions" is empty — declare the ways to pay, or leave the field out`,
      );
      continue;
    }
    if (def.priceCents !== undefined || def.billingInterval !== undefined) {
      problems.push(
        `"${key}": "paymentOptions" AND "priceCents"/"billingInterval" — the price would live in two places; the payment options are the one`,
      );
    }
    if (def.kind === "token" && entries.length > 1) {
      problems.push(
        `"${key}": a token package has exactly one way to pay — several package sizes are several offerings`,
      );
    }
    let highlighted = 0;
    for (const [optionKey, option] of entries) {
      if (!OPTION_KEY_RE.test(optionKey)) {
        problems.push(
          `"${key}": payment option ${JSON.stringify(optionKey)} — letters, digits, _ and - only`,
        );
      }
      if (typeof option !== "object" || option === null || Array.isArray(option)) {
        problems.push(
          `"${key}.${optionKey}": must be an object — it is ${JSON.stringify(option)}`,
        );
        continue;
      }
      if (option.priceCents !== undefined && typeof option.priceCents !== "number") {
        problems.push(
          `"${key}.${optionKey}": "priceCents" must be a number — it is ${JSON.stringify(option.priceCents)}`,
        );
      }
      if (option.highlight === true) highlighted += 1;
    }
    if (highlighted > 1) {
      problems.push(
        `"${key}": ${highlighted} payment options carry "highlight" — exactly one can be the recommended one`,
      );
    }
  }
  return problems;
}

/**
 * This app's own identity inside the vendor's Digistore24 account, written
 * once and committed — the thing that makes "did WE create this product?"
 * answerable at all.
 *
 * It is not derived from anything: not from the app name (vendors rename), not
 * from the product group (a folder can be deleted or shared), not from
 * `name_intern` (which a vendor may edit in the backoffice, and which two apps
 * built from this template would collide on, because both would call their
 * first plan `basic_monthly__de__prod`). A random id has none of those
 * failure modes, and it is the value the ownership stamp in `data[note]`
 * carries — see `scripts/ds24/_own.mjs`.
 *
 * 🚨 Never regenerate it. Every product this app has ever created carries the
 * old value, and a new one would make all of them invisible to `--prune` —
 * and, worse, would make them look like somebody else's.
 */
export function syncIdOf(config) {
  const id = config?.syncId;
  return typeof id === "string" && /^[a-z0-9]{8,}$/.test(id) ? id : null;
}

/**
 * The app's sync id, creating it on first use. Returns `[id, created]` so the
 * caller can report a first run and write the file — this function does not
 * write anything itself.
 */
export function ensureSyncId(config) {
  const existing = syncIdOf(config);
  if (existing) return [existing, false];
  config.syncId = randomBytes(6).toString("hex");
  return [config.syncId, true];
}

/**
 * The registry flattened to ONE ENTRY PER DIGISTORE24 PRODUCT — which is one
 * per offering and language, not one per offering.
 *
 * Every command that talks to Digistore24 about products works on this list,
 * because that is what actually exists over there: `sync-products` creates one
 * product per row, and `request-approval` submits each row to the marketplace
 * its own language belongs to.
 *
 * `label` is what the terminal prints. It stays the bare key while an offering
 * has one language, so a single-language app's output is unchanged, and only
 * grows the ` (en)` suffix where there is genuinely more than one thing to
 * tell apart. The environment is deliberately NOT in the label — it is the
 * same for every row of a run and belongs in the run's banner, once.
 */
export function productTargets(products, env) {
  const targets = [];
  for (const [key, def] of Object.entries(products)) {
    // Parked offerings are not on offer, so nothing is created for them and
    // nothing is submitted for approval — this one filter covers the sync AND
    // the marketplace request, because both build their work list here.
    if (!isSold(def)) continue;
    const ids = productIdsOf(def, env);
    const languages = languagesOf(def);
    for (const language of languages) {
      targets.push({
        key,
        def,
        language,
        productId: ids[language] ? String(ids[language]) : null,
        // The ways to pay travel WITH the row, so the payment-plan sync reads
        // the same flattening as the product sync and cannot drift from it.
        options: paymentOptionsOf(def),
        payplans: payplansOf(def, language, env),
        label: languages.length > 1 ? `${key} (${language})` : key,
      });
    }
  }
  return targets;
}

/**
 * The rows `productTargets` just left out that ALREADY EXIST at Digistore24 —
 * parked offerings carrying a live id for this environment.
 *
 * They are what the sync warns about, and the warning is not a formality: a
 * vendor who writes `"sell": false` believes the thing is no longer for sale.
 * It is — the Digistore24 product lives on, and an old checkout link in a
 * mail, on an affiliate page or in a search result keeps working until it is
 * removed with `ds24-sync --prune`, which is the difference. Removing the entry from this
 * file does not do it either.
 *
 * A parked offering with no id was never created and is not mentioned: there
 * is nothing over there to deactivate.
 */
export function parkedTargets(products, env) {
  const rows = [];
  for (const [key, def] of Object.entries(products)) {
    if (isSold(def)) continue;
    const ids = productIdsOf(def, env);
    for (const [language, id] of Object.entries(ids)) {
      if (id) rows.push({ key, language, productId: String(id) });
    }
  }
  return rows;
}

/**
 * Records a created/found product id back into the registry object, always in
 * the current shape: `productIds.<env>.<language>`.
 *
 * Legacy fields are NOT touched here — retiring them is `adoptLegacyAsProd`'s
 * job, and it only runs on a prod sync, because prod is the set they belong
 * to. A dev sync that deleted them would unsync the live checkout.
 */
export function setProductId(config, key, language, id, env) {
  const def = config.products[key];
  def.productIds = { ...(def.productIds ?? {}) };
  def.productIds[env] = { ...(def.productIds[env] ?? {}) };
  def.productIds[env][language] = String(id);
}

/**
 * Records a created payment plan id back into the registry object, in the one
 * shape there is: `payplanIds.<env>.<language>.<option>`.
 *
 * The twin of `setProductId`, one axis deeper, and with the same contract: the
 * caller writes the file once at the end of the run, never per plan.
 */
export function setPayplan(config, key, language, option, id, env) {
  const def = config.products[key];
  def.payplanIds = { ...(def.payplanIds ?? {}) };
  def.payplanIds[env] = { ...(def.payplanIds[env] ?? {}) };
  def.payplanIds[env][language] = { ...(def.payplanIds[env][language] ?? {}) };
  def.payplanIds[env][language][option.key] =
    id == null
      ? null
      : {
          id: String(id),
          // Written together with the id, never separately: the whole value of
          // this record is that it says what THIS id was created with.
          priceCents: option.priceCents,
          currency: option.currency ?? "EUR",
          billingInterval: option.billingInterval ?? null,
        };
}

/**
 * Folds the pre-environment fields into `productIds.prod` and deletes them —
 * run by a PROD sync only, before anything else looks at the registry.
 *
 * Why prod and not dev: those products predate the split, and they are the
 * ones that may carry real sales, subscriptions and marketplace approvals —
 * things that hang off the Digistore24 product_id and must not be recreated.
 * The dev/staging sets start fresh instead (see findExisting in
 * sync-products.mjs, which refuses every legacy fallback for them).
 *
 * Fill-only: a language the prod map already answers for keeps its answer —
 * the env map is the one the sync maintains. Returns whether anything moved,
 * so the caller knows the registry file has to be written back.
 */
export function adoptLegacyAsProd(config) {
  let changed = false;
  for (const def of Object.values(config.products ?? {})) {
    const hasMap = def.productIdByLanguage !== undefined;
    const hasPair = def.productId !== undefined || def.language !== undefined;
    if (!hasMap && !hasPair) continue;
    const prod = { ...(def.productIds?.prod ?? {}) };
    for (const [lang, id] of Object.entries(def.productIdByLanguage ?? {})) {
      if (prod[lang] == null) prod[lang] = id == null ? id : String(id);
    }
    const legacyLang = def.language || FALLBACK_LANGUAGE;
    if (def.productId && !prod[legacyLang]) prod[legacyLang] = String(def.productId);
    def.productIds = { ...(def.productIds ?? {}), prod };
    delete def.productIdByLanguage;
    delete def.productId;
    delete def.language;
    changed = true;
  }
  return changed;
}

/**
 * Every live product id of ONE environment, across the whole registry — what
 * the IPN connection for that environment is scoped to (ipn-setup.mjs).
 * Live ids only: a `null` declaration is a product that does not exist yet
 * and cannot be named in `product_ids`.
 *
 * 🚨 **`sell` is deliberately NOT read here, and this is the one place in the
 * file where that looks like an oversight.** It is not. Taking a plan off
 * sale says nothing about the people who already bought it: their rebills,
 * refunds, chargebacks and missed payments all arrive as IPNs naming that
 * product id, and an id missing from this list is an IPN the app never hears.
 * The consequence is silent — access that should have ended does not end, and
 * a refunded customer keeps their plan. Whoever "tidies up" by filtering this
 * list breaks the money path for exactly the customers who are still owed
 * something. `lib/digistore/sell-seam.test.ts` and `_products.test.ts` pin it.
 */
export function syncedProductIds(config, env) {
  const ids = [];
  for (const def of Object.values(config.products ?? {})) {
    for (const id of Object.values(productIdsOf(def, env))) {
      if (id) ids.push(String(id));
    }
  }
  return ids;
}

export function readProducts() {
  const json = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  if (!json || typeof json.products !== "object") {
    throw new Error("Invalid config/digistore-products.json (no products object).");
  }
  return json;
}

/**
 * Products whose kind the configured `billingMode` switched off — the check
 * `lib/billing-mode.test.ts` makes, repeated at the moment it actually costs
 * money.
 *
 * The test only runs on `node run.mjs test`; THIS runs on the command that
 * publishes. Creating a token package for an app whose mode is
 * "subscriptions" puts a product on sale at Digistore24 that the app renders
 * nothing for — the buyer pays and is credited nothing. So the sync refuses
 * instead of asking.
 *
 * A duplicate of the logic in lib/billing-mode.ts on purpose: the scripts are
 * plain `.mjs` and do not import the app's TypeScript. Change one, change the
 * other — the same twin rule `_public-url.mjs` carries.
 */
export function contradictingProducts(json) {
  const mode = json.billingMode;
  // Unknown or missing behaves like "both" — the app's fallback, and the
  // harmless direction: a typo must not block a sync.
  if (mode !== "subscriptions" && mode !== "tokens") return [];
  return Object.entries(json.products)
    // A parked offering is neither synced nor buyable, so it cannot be the
    // money hole this check is about — and parking is the gentler answer the
    // refusal message itself now offers, next to deleting the entry.
    .filter(([, p]) => isSold(p))
    .filter(([, p]) =>
      p.kind === "token" ? mode === "subscriptions" : mode === "tokens",
    )
    .map(([key]) => key);
}

/** Writes the config back, formatted (2 spaces, trailing newline). */
export function writeProducts(json) {
  writeFileSync(CONFIG_PATH, JSON.stringify(json, null, 2) + "\n");
}

/** listProducts (readonly) → normalized list. */
export function extractProducts(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.products)) return data.products;
  return [];
}

export function idOf(p) {
  return p.product_id ?? p.id ?? null;
}
