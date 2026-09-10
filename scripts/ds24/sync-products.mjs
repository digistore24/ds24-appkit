#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Synchronize the Digistore24 products from the registry (idempotent).
//
// Reads config/digistore-products.json, creates each product via createProduct
// or updates it via updateProduct, and writes the resulting id back into the
// config. That way the config is the source of truth and the checkout
// (product link …/product/<id>) has stable IDs.
//
// ONE PRODUCT SET **PER ENVIRONMENT** (dev / staging / prod, see _env.mjs and
// docs/environments.md). `--env prod` syncs the live set against the deployed
// domain (APP_URL_PROD), `--env dev` — the default on a local machine — the
// development set against APP_URL. Each set has its own ids in the registry
// (`productIds.<env>`), its own internal names (`key__lang__env`) and, for
// dev/staging, a visible name suffix (" [DEV]"), so the sets never claim each
// other's products. Staging is optional — most apps go dev → prod, which is
// fine as long as they test.
//
// ONE PRODUCT PER OFFERING **AND LANGUAGE**, not one per offering. A
// Digistore24 product carries exactly one `data[language]`, and that language
// is the language of the ORDER FORM the buyer fills in — createBuyUrl has no
// parameter to override it. So an app selling in German and English needs two
// products per plan, and this script creates one for every language declared
// in `productIds`. The full reasoning is in lib/digistore/products.ts.
//
// ONE PRODUCT GROUP PER APPLICATION (all environments together): the group is a
// FOLDER in the vendor backend, and that is what keeps this app's products
// findable next to everything else the account sells. ⚠️ This used to read "the
// DS24 API has no tag field, so the group is what…". There is a tag field now
// (`data[tag]`, `_own.mjs`), and this app writes one — but a tag is a filter
// somebody has to type and a folder is a place they can open, so the group is
// not made redundant by it. The reason was wrong; the decision was not. Its id is persisted in the registry (`productGroupId`) like the
// product ids, and every create/update sends it — so a group deleted at DS24
// is recreated and re-collects the products on the next sync by itself.
//
// ONE PRODUCT GROUP PER APPLICATION, and separately: ONE OWNERSHIP STAMP PER
// PRODUCT. The group is a folder the vendor can see; the stamp is what this
// script reads before it deletes anything. It lives in `data[note]`, the
// product's internal note, and `scripts/ds24/_own.mjs` is the whole of it.
// (This file used to say the API has no tag field. It has one — `note` is in
// createProduct AND updateProduct — and the sentence was load-bearing for the
// wrong conclusion: that nothing here could ever be cleaned up again.)
//
// IMPORTANT — where the price lives:
// The DS24 API rejects `data[amount]` ("is deprecated - create a payment plan
// instead"), so no price is ever set on the PRODUCT. It is set on the
// product's PAYMENT PLANS, one per way to pay, written from the same registry
// entry as everything else here — see `_plans.mjs`, which also says why the
// plans have to exist even though our own checkout could price itself.
// The registry stays the one place a price is authored.
//
// This script manages the product master data: name, internal name,
// description, product image, thank-you URL, quantities — and the productId.
//
// Matching/idempotency: 1) the id already in the config, otherwise
// 2) name_intern/name in listProducts → no duplicates. `name_intern` is the
// stable registry key plus the language plus the environment, so that a
// changed display name does not break finding the product again — and a dev
// sync cannot claim a prod product (findExisting).
//
// Usage:
//   node scripts/ds24/sync-products.mjs                 # dry run (all, env from APP_ENV)
//   node scripts/ds24/sync-products.mjs --apply         # create/update
//   node scripts/ds24/sync-products.mjs --env prod --apply   # the LIVE set (needs APP_URL_PROD)
//   node scripts/ds24/sync-products.mjs --key starter --apply
//   node scripts/ds24/sync-products.mjs --dry-run       # never writes, beats --apply
//   [--thankyou "https://app.example.de/optin/[ORDER_ID]"]  # otherwise from the env's app URL
// Env: DIGISTORE_API_KEY (writable); APP_URL (dev), APP_URL_PROD / APP_URL_STAGING
// for a locally-run prod/staging sync.
//
// `node run.mjs ds24-sync` adds --apply by itself — the preview there is
// `node run.mjs ds24-sync --dry-run`.
import { readFileSync } from "node:fs";
import { ds24Call, requireApiKey, parseArgs } from "./_client.mjs";
import { readProducts, writeProducts, extractProducts, idOf, contradictingProducts, sellFieldProblems, parkedTargets, adoptLegacyAsProd, appLanguages, languagesOf, productTargets, paymentOptionsOf, setProductId, setPayplan, ensureSyncId } from "./_products.mjs";
import {
  stampFor,
  noteOf,
  noteWith,
  tagOf,
  tagWith,
  canClassify,
  orphanProducts,
} from "./_own.mjs";
import { planRows, applyPlanRows } from "./_plans.mjs";
import {
  resolveSyncEnv,
  internalName,
  displayName,
  appUrlForEnv,
  overlongKeys,
  NAME_INTERN_MAX,
} from "./_env.mjs";
import { classifyTargets } from "./_match.mjs";
import { isKnownLanguage } from "./_resellers.mjs";
import { publicUrlFor } from "./_public-url.mjs";
import { DIGISTORE_REDIR_URL } from "../../lib/digistore/config.mjs";

const args = parseArgs(process.argv.slice(2));
// --dry-run wins over --apply: run.mjs hands --apply in by default, and
// asking for a preview has to be able to override that.
const apply = Boolean(args.apply) && !args["dry-run"];
const onlyKey = args.key ? String(args.key) : null;

// Which environment's product set this run maintains: --env, else APP_ENV —
// so a sync run on the deployed host targets prod with no flag at all.
const resolvedEnv = resolveSyncEnv(args);
if (resolvedEnv.error) {
  console.error(`ERROR: ${resolvedEnv.error}`);
  process.exit(2);
}
const env = resolvedEnv.env;
console.log(
  `• Environment: ${env.toUpperCase()}` +
    (env === "prod"
      ? " — the LIVE product set (ids → productIds.prod)"
      : ` — product names carry the [${env.toUpperCase()}] suffix (ids → productIds.${env})`),
);

// The thank-you page. Digistore24 stores public https URLs only, so a local app
// travels as a redirect address (scripts/ds24/_public-url.mjs) — without it the
// whole sync fails on "Please only use secure URLs with https://".
// For staging/prod the URL comes from APP_URL_STAGING / APP_URL_PROD, and a
// missing one is a refusal: prod products pointing at localhost help nobody.
let thankyouTarget = args.thankyou ? String(args.thankyou) : null;
if (!thankyouTarget) {
  const resolved = appUrlForEnv(env);
  if (resolved.error) {
    console.error(`ERROR: ${resolved.error}`);
    process.exit(2);
  }
  if (resolved.url) thankyouTarget = `${resolved.url}/optin/[ORDER_ID]`;
}
const appUrl = publicUrlFor(thankyouTarget);

// Does THIS account's API know `data[tag]` yet?
//
// The field is documented — Digistore24's own OpenAPI spec carries it for
// `createProduct` and `updateProduct` as of 2026-09-10 (`_own.mjs` quotes it,
// including the `maxLength: 127` this app respects itself). On 2026-09-09 it
// did not exist at all, and `data` is validated against a strict allowlist, so
// an unknown key is a hard ERROR rather than something ignored
// ("ungültiger Array-Schlüssel bei 1. Parameter 'data' (angegeben: tag …)").
//
// Exercised against a live account on 2026-09-10 (`_own.mjs` has the numbers):
// both calls accept the key, and `listProducts` hands it back as a string.
//
// ⚠️ **The fallback stays anyway, and one account is the reason.** What it
// guards is no longer an unshipped field but a rollback, or an account the
// change has not reached. It costs one retry on the first product of a run; a
// sync without it trades every product creation the customer makes for a
// marker that decides nothing.
//
// So: send it, and if the call comes back refused, drop it and try the same
// call again — ONCE, and then not for the rest of the run. That is the shape
// `createBuyUrl` already uses twice (the unknown affiliate, the stale payment
// plan), including its safeguard: the retry is the call we would have made
// anyway, so if the real problem was something else the retry fails too and
// the ORIGINAL error is what surfaces. No message matching, in any language.
let tagsAccepted = true;

/**
 * Runs `call()`; on a failure while the tag was in the payload, says so once,
 * marks the field unsupported for this run and runs `retry()`.
 */
async function withoutTag(data, call, retry) {
  try {
    return await call();
  } catch (err) {
    if (!tagsAccepted || !("data[tag]" in data)) throw err;
    tagsAccepted = false;
    // 🚨 Says what HAPPENED, not why. The sentence used to read "does not know
    // data[tag] yet", which was the only possible cause while the field did not
    // exist — and became a guess the day it shipped. A refusal now has more
    // than one explanation (an account on an older release, a value this app
    // failed to keep inside the documented limit), and the line must not pick
    // one of them for the reader.
    console.log(`  · Digistore24 refused data[tag] — continuing without it`);
    delete data["data[tag]"];
    try {
      return await retry();
    } catch {
      throw err;
    }
  }
}

// data[...] for create/update from a registry definition (without a price —
// that is on the payment plans, see _plans.mjs).
//
// `existing` is the product as listProducts handed it back, or null on a
// create. It is here for one field: the note. We only ever REPLACE our own
// stamp line inside it and keep everything else the vendor wrote — and where
// listProducts does not return the note at all, we write none, because
// writing one would mean overwriting text we never read.
function productData(key, def, language, existing = null) {
  const data = {
    // Buyers see the environment: dev/staging names carry a suffix, prod
    // stays clean (_env.mjs → displayName).
    "data[name]": displayName(def.name, env),
    // Stable internal name = registry key + language + environment (see
    // _env.mjs → internalName). The display name may therefore change at any
    // time without breaking the ability to find the product.
    "data[name_intern]": internalName(key, language, env),
    "data[description]": def.description || def.name,
    "data[currency]": def.currency || "EUR",
    // THE FIELD THIS WHOLE PER-LANGUAGE LOOP EXISTS FOR. It is the language of
    // the ORDER FORM — labels, buttons, payment methods, cancellation terms —
    // and it is the only place that language can be set: createBuyUrl has no
    // parameter for it. Left unset, Digistore24 falls back to the language of
    // the API session, which is nobody's deliberate choice and was how a
    // German app came to show English forms (and the reverse).
    "data[language]": language,
  };
  // The ownership stamp. On a create there is nothing to preserve; on an
  // update we only touch our own line, and only when the note came back with
  // the product at all (see the note above `productData`).
  // 🚨 `noteWith` answers `null` for "the vendor wrote something here" — the
  // field keeps 47 characters, so there is no merging it, and a sync that ate
  // somebody's note to plant a marker would be trading their data for our
  // convenience. Not writing means that product stays unstamped and therefore
  // un-prunable, which is the direction every doubt in `_own.mjs` falls.
  const note = noteWith(
    existing ? noteOf(existing) : null,
    stampFor({ syncId, env }),
  );
  if (note !== null) data["data[note]"] = note;
  // The coarse marker, appended to whatever tags the product already has —
  // `tagWith` answers null when ours is in there already, and never drops one
  // the vendor put there (`_own.mjs`). `tagsAccepted` is what keeps a run from
  // sending it once per product while the field does not exist yet.
  if (tagsAccepted) {
    const tag = tagWith(existing ? tagOf(existing) : null);
    if (tag !== null) data["data[tag]"] = tag;
  }
  if (appUrl) data["data[thankyou_url]"] = appUrl;
  // The app's own product group — sent on create AND update, so a product
  // that predates the group (or a group recreated after deletion) is pulled
  // in on its next sync without anybody doing anything.
  if (groupId) data["data[product_group_id]"] = String(groupId);
  // Product image: a publicly reachable URL, otherwise DS24 rejects it.
  if (def.imageUrl) data["data[image_url]"] = def.imageUrl;
  // Token packages are quantity products: exactly 1 package per purchase,
  // otherwise the credits no longer match the purchase.
  if (def.kind === "token") {
    data["data[default_quantity]"] = "1";
    data["data[max_quantity]"] = "1";
  }
  return data;
}

// The languages the app itself speaks. Resolved once — every entry is checked
// against the same list.
const speaks = appLanguages();

// Warns about registry entries that would only show up later, at checkout.
function checkDefinition(key, def) {
  const warn = [];
  // Per WAY TO PAY, not per offering: with `paymentOptions` the price and the
  // interval live on the option, and reading them off the entry warned every
  // correctly written registry that it had no price. Measured against a real
  // account, which is the only place it showed.
  //
  // `paymentOptionsOf` normalises both registry shapes, so an entry that
  // declares no options is checked exactly as before — one option carrying the
  // entry's own fields, and the message keeps its old wording.
  const options = paymentOptionsOf(def);
  const single = options.length === 1;
  for (const option of options) {
    const where = single ? "" : ` (${option.key})`;
    if (option.priceCents == null)
      warn.push(`no priceCents${where} — the checkout cannot set a price`);
    if (def.kind === "subscription" && !option.billingInterval)
      warn.push(
        `kind=subscription without billingInterval${where} (e.g. 1_month)`,
      );
  }
  if (def.kind === "token" && !def.credits)
    warn.push("kind=token without credits — no balance would be credited");
  if (def.imageUrl && !/^https:\/\//.test(def.imageUrl))
    warn.push("imageUrl is not an https URL — DS24 rejects it");

  // The language gap. It costs no sale — a visitor with no product in their
  // language is sent to another one (lib/digistore/products.ts →
  // checkoutProductFor) — but they fill in an order form in a language they
  // did not choose, at the moment they are asked for their card. Nothing else
  // ever reports it: the app renders fine, the checkout opens, the purchase
  // completes. So it is said here, where the fix is one line away.
  const languages = languagesOf(def);
  const missing = speaks.filter((lang) => !languages.includes(lang));
  if (missing.length > 0) {
    warn.push(
      `no Digistore24 product for ${missing.join(", ")} — the app speaks ` +
        `${speaks.join(", ")}, so those buyers get an order form in ` +
        `"${languages[0]}". Add them to "productIds" (value null) and sync again`,
    );
  }
  for (const lang of languages) {
    if (!isKnownLanguage(lang))
      warn.push(`"${lang}" is not a Digistore24 language code (de, en, fr, es, nl, it, pt, pl, sl)`);
  }

  for (const w of warn) console.warn(`  ! ${key}: ${w}`);
  return warn.length;
}

// Say it out loud — otherwise the address at Digistore24 looks wrong to anyone
// who checks it in the UI.
if (appUrl && appUrl.startsWith(DIGISTORE_REDIR_URL)) {
  console.log(`• Thank-you page runs through the redirect: ${appUrl}`);
  console.log("  Digistore24 stores no localhost URL; the redirect leads back to your app.");
}

// The config is read and checked BEFORE the API key is demanded: a
// contradiction in the registry is a mistake in a file that is right here, and
// answering "no API key" to somebody whose actual problem is a product they
// have to delete sends them off to fix the wrong thing.
const config = readProducts();
let changed = false;

// A prod sync adopts the pre-environment fields as the prod set first: those
// products may carry real sales and approvals and must be updated, never
// recreated (see adoptLegacyAsProd in _products.mjs).
if (env === "prod" && adoptLegacyAsProd(config)) {
  changed = true;
  console.log("• Adopted the pre-environment product ids as the PROD set (productIds.prod).");
}

// Refuse keys whose internal name would not fit before anything is created —
// half a synced registry is worse than a named refusal.
const allLanguages = [
  ...new Set(Object.values(config.products).flatMap((def) => languagesOf(def))),
];
const tooLong = overlongKeys(Object.keys(config.products), allLanguages);
if (tooLong.length > 0) {
  console.error(
    `These product keys are too long for Digistore24's ${NAME_INTERN_MAX}-character ` +
      `internal name (key__language__environment):\n` +
      tooLong.map((key) => `  - ${key}`).join("\n") +
      `\nShorten them in config/digistore-products.json (before the first live sale).`,
  );
  process.exit(2);
}

// Before anything is created: does the registry contradict what this app says
// it sells? A token package in a "subscriptions" app would be published here
// and buyable at Digistore24, while the app renders nothing that credits the
// buyer. Refused rather than warned — a dry run does not show it either,
// because the mismatch is not in the diff, it is in the app.
const contradicting = contradictingProducts(config);
if (contradicting.length > 0) {
  console.error(
    `"billingMode": "${config.billingMode}" in config/digistore-products.json does not match these products:\n` +
      contradicting.map((key) => `  - ${key}`).join("\n") +
      `\n\nEither set "billingMode" to "both", or delete those products from the config.` +
      `\n(If one of them already exists at Digistore24, take the entry OUT of the registry and run --prune — parking it here does not unpublish it.)`,
  );
  process.exit(2);
}

// A `sell` that is neither true nor false nor absent. Refused here rather
// than shrugged at, because the string "false" — the shape a hand-edited JSON
// produces most easily — is TRUTHY, so the entry would count as on sale and
// the product would be created at Digistore24. Same refusal the app makes
// when it loads the registry (lib/digistore/products.ts).
const sellProblems = sellFieldProblems(config);
if (sellProblems.length > 0) {
  console.error(
    `config/digistore-products.json:\n` +
      sellProblems.map((line) => `  - ${line}`).join("\n"),
  );
  process.exit(2);
}

const apiKey = requireApiKey();
// ONE ROW PER DIGISTORE24 PRODUCT — per offering AND language. That is what
// exists over there, and it is what this loop creates. Parked offerings
// ("sell": false) are not in here at all — productTargets leaves them out.
const targets = productTargets(config.products, env).filter(
  ({ key }) => !onlyKey || key === onlyKey,
);
// 🚨 `--prune` is the ONE thing that still has work to do with an empty list.
// Measured against a live account: taking the last entry out of the registry
// left its product in the vendor's account with no way to remove it, because
// this refusal fires before anything looks at Digistore24 at all. "Nothing to
// sync" and "nothing to clean up" are different questions.
if (targets.length === 0 && !args.prune) {
  // Three different states, three different sentences. "No product X" for a
  // key that IS in the file but parked used to send the vendor looking for a
  // typo in a line that is spelled perfectly.
  if (onlyKey && config.products[onlyKey]) {
    console.error(
      `"${onlyKey}" is marked "sell": false in config/digistore-products.json — nothing was synced.\n` +
        `Set "sell": true there if you want to sell it.`,
    );
  } else if (onlyKey) {
    console.error(`No product "${onlyKey}" in the config.`);
  } else if (Object.keys(config.products).length > 0) {
    // The IPN hookup is bundled behind this exit (run.mjs runs ipn-setup.mjs
    // only after a clean sync), and a fully parked app still NEEDS it: the
    // parked ids stay in the IPN scope because their buyers' refunds and
    // cancellations keep arriving. So the way to maintain that connection
    // without a sellable product is named here, or it is unreachable.
    console.error(
      `Every product in config/digistore-products.json is marked "sell": false — nothing to sync.\n` +
        `The IPN hookup for already-synced products can still be maintained on its own:\n` +
        `    node run.mjs ds24-ipn --auto --apply`,
    );
  } else {
    console.error("No products in the config.");
  }
  process.exit(2);
}

// Parked, but already over there. Said out loud once, because "sell": false
// reads like "not for sale any more" and is not: the Digistore24 product
// lives on, and an old checkout link in a mail or on an affiliate page keeps
// working until somebody deactivates it in the vendor backend, by hand.
const parked = parkedTargets(config.products, env);
if (parked.length > 0) {
  console.warn(
    `! ${parked.length} product(s) are marked "sell": false but already exist at Digistore24 (${env.toUpperCase()}):\n` +
      parked
        .map((r) => `    ${r.key} (${r.language})   product_id=${r.productId}`)
        .join("\n") +
      `\n  They are no longer offered on /plans and this sync leaves them alone — but they are` +
      `\n  STILL BUYABLE at Digistore24. Deactivate them THERE if that is what you meant;` +
      `\n  removing them here does not unpublish them. Existing buyers keep their access` +
      `\n  either way, and their refunds and cancellations keep arriving.`,
  );
}

// Load the product list once (for matching by name).
// This app's own identity inside the account — created on first run, then
// committed and never regenerated. Everything `--prune` is allowed to touch is
// identified by it (`_own.mjs`).
const [syncId, syncIdIsNew] = ensureSyncId(config);
if (syncIdIsNew) {
  changed = true;
  console.log(
    `→ this app's Digistore24 sync id is ${syncId} (written to config/digistore-products.json).`,
  );
}

const list = extractProducts(
  await ds24Call("listProducts", apiKey).catch((e) => {
    console.error("Could not load the product list:", e.message);
    process.exit(1);
  }),
);

// ONE classification for the whole run — the gate below and the loop at the
// foot read the same rows, so the gate cannot promise something the loop then
// does differently (scripts/ds24/_match.mjs).
const rows = classifyTargets(targets, list, env);
const creations = rows.filter((r) => r.action === "create");

// Products in this account that carry OUR stamp for THIS environment and that
// the registry no longer asks for. `keepIds` deliberately includes the parked
// entries: `"sell": false` takes an offering off the page, never out of the
// account, and a parked product's id still has to reach the IPN connection so
// its buyers' refunds keep arriving.
const byId = new Map(
  list.map((p) => [String(idOf(p) ?? ""), p]).filter(([id]) => id),
);
const keepIds = new Set(
  [
    ...rows.map((r) => r.existingId),
    ...parkedTargets(config.products, env).map((r) => r.productId),
  ].filter(Boolean).map(String),
);
const classifiable = canClassify(list);
const orphans = classifiable
  ? orphanProducts(list, { syncId, env, keepIds })
  : [];

if (!classifiable && args.prune) {
  // 🚨 Zero orphans out of a comparison that could not run is not "nothing to
  // clean up" — it is no answer at all, and acting on it would be acting on
  // silence. Proving the walk ran is not proving the comparison did.
  console.error(
    `\n--prune cannot run: Digistore24 did not return the products' notes, so\n` +
      `ownership cannot be established. Nothing was deleted and nothing was\n` +
      `deactivated. This is not a finding about your account.\n`,
  );
  process.exit(2);
}

if (orphans.length > 0 && !args.prune) {
  console.log(
    `\n${orphans.length} product(s) belong to this app and are no longer in the registry:\n` +
      orphans
        .map((o) => `  ${o.productId}  ${o.nameIntern || o.name}`)
        .join("\n") +
      `\n\n  They are still buyable at Digistore24 through any link that exists.\n` +
      `  To remove them: node run.mjs ds24-sync --env ${env} --prune\n`,
  );
}

// 🚨 THE GATE. Creating a Digistore24 product is not free to undo, and the
// registry ships with example plans — so the first sync of a fresh app would
// otherwise put every one of them into the vendor's account before anybody
// looked at the list.
//
// `--prune` softened this: a product this app created CAN be removed again.
// But only cleanly while it has never sold — one with sales is deactivated
// instead, because its buyers' refunds and cancellations still arrive as IPNs
// naming its id. So the gate stays, with the honest reason.
//
// It hangs on `apply`, so `--dry-run` is untouched: that run prints exactly
// the "would create" lines this refusal sends the reader to. And it only
// fires while something would be CREATED, which is what keeps it from
// becoming a flag people type without reading — once an offering is synced it
// carries an id, and every later run passes straight through. Updates are
// reversible and are never gated.
//
// Placed BEFORE resolveProductGroup(): a refusal must not leave a product
// group behind. "Half a synced registry is worse than a named refusal" is the
// same argument the two refusals above make.
if (apply && creations.length > 0 && !args["create-new"]) {
  const updates = rows.length - creations.length;
  // The re-run is spelled WITH the refused run's scope. A bare
  // `ds24-sync --create-new` after an `--env prod` refusal would run against
  // APP_ENV's default set — confirming the wrong environment — and after a
  // `--key`-scoped refusal it would create EVERY new product instead of the
  // one that was asked about.
  const rerun = `node run.mjs ds24-sync --env ${env}${onlyKey ? ` --key ${onlyKey}` : ""} --create-new`;
  console.error(
    `\nSTOP — ${creations.length} NEW product(s) would be created at Digistore24 (${env.toUpperCase()}).\n\n` +
      creations
        .map(
          (r) =>
            `  ${r.key} (${r.language})   "${displayName(r.def.name, env)}"`,
        )
        .join("\n") +
      `\n\n  (${updates} product(s) already exist and would only be updated.)\n\n` +
      `Creating them cannot be undone from here for free: taking an entry out of\n` +
      `config/digistore-products.json afterwards makes the product an orphan that\n` +
      `--prune can delete — but only while it never sold. One that took money is\n` +
      `deactivated instead, and stays in the account.\n\n` +
      `Two ways on:\n\n` +
      `  1. This IS what you sell — run it again with:\n` +
      `         ${rerun}\n\n` +
      `  2. Some of it is not — on a fresh app the list above is the example\n` +
      `     plans this template ships with. Open config/digistore-products.json\n` +
      `     and set "sell": false on every entry you do not sell — the entry\n` +
      `     stays in the file as a template, no product is created, and it does\n` +
      `     not show up on /plans. Then run the command again (with --create-new\n` +
      `     if anything NEW is left on the list).\n\n` +
      `Nothing was created. Nothing was changed.\n`,
  );
  process.exit(2);
}

// --- The product group: ONE per application, every environment together. ----
// Identified by the stored id first (the registry is the source of truth,
// like the product ids), by name second (recovers a lost id), created last.
// The name is the app's own (APP_NAME / package.json), capped at the API's 31
// characters.
function packageName() {
  try {
    return JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ).name;
  } catch {
    return null;
  }
}
const groupName = String(process.env.APP_NAME || packageName() || "app").slice(0, 31);

function extractGroups(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.product_groups)) return data.product_groups;
  if (data && Array.isArray(data.groups)) return data.groups;
  return [];
}

async function resolveProductGroup() {
  const stored = config.productGroupId ? String(config.productGroupId) : null;
  if (stored) {
    // Verify it still exists — a group deleted in the DS24 backend must not
    // leave every product pointing at a dead folder for ever.
    const found = await ds24Call("getProductGroup", apiKey, {
      product_group_id: stored,
    }).catch(() => null);
    if (found) return stored;
    console.log(`• Product group ${stored} no longer exists at Digistore24 — recovering.`);
  }
  const groups = extractGroups(
    await ds24Call("listProductGroups", apiKey).catch(() => []),
  );
  const byName = groups.find(
    (g) => String(g?.name ?? "") === groupName && (g?.product_group_id ?? g?.id),
  );
  if (byName) return String(byName.product_group_id ?? byName.id);
  if (!apply) return null;
  const created = await ds24Call("createProductGroup", apiKey, {
    "data[name]": groupName,
  });
  const id = created?.product_group_id ?? created?.id ?? null;
  if (!id) {
    console.error("✗ createProductGroup returned no product_group_id.");
    process.exit(1);
  }
  console.log(`✓ product group created: "${groupName}" (product_group_id=${id})`);
  return String(id);
}

const groupId = await resolveProductGroup();
if (groupId && String(config.productGroupId ?? "") !== groupId) {
  config.productGroupId = groupId;
  changed = true;
}
if (!groupId && !apply) {
  console.log(
    `DRY-RUN — would create the product group "${groupName}" and put every product of this app in it.`,
  );
}

let warnings = 0;
const seenKeys = new Set();
for (const target of rows) {
  const { key, def, language, label, existingId } = target;
  // Once per offering, not once per language: the price, the interval and the
  // credits are shared, and saying it twice reads as two separate problems.
  if (!seenKeys.has(key)) {
    warnings += checkDefinition(key, def);
    seenKeys.add(key);
  }

  const data = productData(
    key,
    def,
    language,
    existingId ? (byId.get(String(existingId)) ?? null) : null,
  );

  // The ways to pay of this product, applied right after the product itself.
  // Together, not in a second pass: a product that exists without its plans
  // has Digistore24s ~27 EUR default plan and an order form that charges it,
  // and the window in which that is true should be one API call wide.
  const syncPlans = async (productIdForPlans) => {
    const rowsForPlans = planRows(target.options, target.payplans);
    if (rowsForPlans.length === 0) return;
    if (!apply) {
      for (const r of rowsForPlans) {
        console.log(`   DRY-RUN — would ${r.action} payment plan "${r.option.key}"`);
      }
      return;
    }
    const summary = await applyPlanRows(rowsForPlans, productIdForPlans, {
      call: (fn, params) => ds24Call(fn, apiKey, params),
      record: (option, id) => {
        setPayplan(config, key, language, option, id, env);
        changed = true;
      },
      log: (line) => console.log(line),
    });
    if (summary.skipped > 0) warnings += summary.skipped;
  };

  if (existingId) {
    if (!apply) {
      console.log(`DRY-RUN — would update: "${label}" (product_id=${existingId}, language=${language})`);
    } else {
      await withoutTag(
        data,
        () => ds24Call("updateProduct", apiKey, { product_id: String(existingId), ...data }),
        () => ds24Call("updateProduct", apiKey, { product_id: String(existingId), ...data }),
      );
      console.log(`✓ updated: "${label}" (product_id=${existingId}, language=${language})`);
    }
    if (target.productId !== String(existingId)) {
      setProductId(config, key, language, existingId, env);
      changed = true;
    }
    await syncPlans(existingId);
    continue;
  }

  if (!apply) {
    console.log(
      `DRY-RUN — would create: "${label}" ("${displayName(def.name, env)}", language=${language})`,
    );
    await syncPlans(null);
    continue;
  }
  const created = await withoutTag(
    data,
    () => ds24Call("createProduct", apiKey, data),
    () => ds24Call("createProduct", apiKey, data),
  );
  const newId = idOf(created);
  if (!newId) {
    console.error(`✗ createProduct returned no product_id for "${label}".`);
    process.exit(1);
  }
  setProductId(config, key, language, newId, env);
  changed = true;
  console.log(`✓ created: "${label}" (product_id=${newId}, language=${language})`);
  await syncPlans(newId);
}

// --- --prune: the products that are ours and are no longer wanted ----------
//
// Only ever reached with the flag, and only for rows `_own.mjs` graded
// "certain". Two steps, in this order and not the other:
//
//   1. Ask whether the product has SALES. One that does is never deleted, no
//      matter what the API would allow — its buyers still have refunds,
//      chargebacks and cancellations coming, and every one of those arrives as
//      an IPN naming this product id.
//   2. Delete what has none; deactivate what has some, or what the delete
//      refused. `deleteProduct` is documented as permanent and it can fail for
//      reasons this script cannot enumerate — so the fallback is not an
//      afterthought, it is the expected path for anything that ever sold.
if (apply && args.prune && orphans.length > 0) {
  console.log(`\nRemoving ${orphans.length} product(s) that belong to this app:`);
  for (const orphan of orphans) {
    let sold = null;
    try {
      const purchases = await ds24Call("listPurchases", apiKey, {
        product_id: orphan.productId,
      });
      const rowsOfPurchases = Array.isArray(purchases)
        ? purchases
        : (purchases?.purchases ?? []);
      sold = rowsOfPurchases.length > 0;
    } catch (e) {
      // Could not ask — then we do not know, and "do not know" is treated as
      // "has sales". The cheap mistake is an inactive product too many.
      console.log(`  · ${orphan.productId}: could not check for sales (${e.message})`);
      sold = true;
    }

    if (sold === false) {
      try {
        await ds24Call("deleteProduct", apiKey, { product_id: orphan.productId });
        console.log(`  ✓ deleted ${orphan.productId} ("${orphan.nameIntern || orphan.name}")`);
        continue;
      } catch (e) {
        console.log(`  · delete refused for ${orphan.productId} (${e.message}) — deactivating instead`);
      }
    }

    try {
      await ds24Call("updateProduct", apiKey, {
        product_id: orphan.productId,
        "data[is_active]": "N",
      });
      console.log(
        `  ✓ deactivated ${orphan.productId} ("${orphan.nameIntern || orphan.name}")` +
          (sold ? " — it has sales, so it was never a candidate for deletion" : ""),
      );
      if (sold) {
        console.log(
          `      Keep its entry in config/digistore-products.json as "sell": false —\n` +
            `      without it the id leaves the IPN connection and this product's\n` +
            `      refunds and cancellations stop arriving.`,
        );
      }
    } catch (e) {
      console.error(`  ✗ ${orphan.productId}: neither deleted nor deactivated — ${e.message}`);
      warnings += 1;
    }
  }
} else if (!apply && args.prune && orphans.length > 0) {
  for (const orphan of orphans) {
    console.log(`DRY-RUN — would delete or deactivate ${orphan.productId} ("${orphan.nameIntern || orphan.name}")`);
  }
}

if (apply && changed) {
  writeProducts(config);
  console.log(
    `→ written to config/digistore-products.json (productIds.${env} + productGroupId).`,
  );
} else if (!apply) {
  console.log("\nNothing was changed. To execute: node run.mjs ds24-sync");
}

if (warnings > 0) {
  console.log(
    `\nCheck the ${warnings} note(s) above — otherwise they only surface at checkout.`,
  );
}

console.log(
  "\nPrices are authored in the registry and written onto each product's PAYMENT\n" +
    "PLANS, one per way to pay — so the product's own order form, an affiliate\n" +
    "link and the buyer's own interval switch all charge what /plans shows.\n" +
    "Do not edit those plans in the Digistore24 interface: the next sync\n" +
    "overwrites them from config/digistore-products.json.",
);
