#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Show and request the Digistore24 product approval (go-live step).
//
// Without --apply this is the STATUS VIEW: it reads the current approval per
// product from listProducts (approval_status_list) and prints it. With --apply
// it sets the status per product via updateProduct:
//   data[approval_status][<siteowner_id>] = pending
//
// Background (updateProduct.expectedArgs): approval_status is "by_siteowner" —
// the approval is requested per siteowner and only takes effect for siteowners
// the seller has been accepted for. The siteowner is the Digistore24 reseller
// (marketplace).
//
// **Which marketplace a product goes to follows the PRODUCT's language**, not
// the app's: a German product is submitted to Digistore24 Germany (id 1), an
// English one to Digistore24 USA (id 2). The languages are the keys of the
// per-language maps in `productIds` (config/digistore-products.json), and
// there is one Digistore24 product per key — so an offering sold in both is
// submitted to both marketplaces, each in the right one. See _resellers.mjs.
// Only the PROD set is ever submitted — approval is a go-live step, and
// dev/staging products exist for test purchases, which need none.
//
// That per-language split is not a feature of this command; it is what the
// registry already is, because a Digistore24 product carries exactly one
// language and that language is the buyer's order form (lib/digistore/products.ts).
//
// --lang / --reseller / --siteowner override that for EVERY product in the run
// and take precedence over DIGISTORE_SITEOWNER_ID in the .env.
//
// Usage:
//   node scripts/ds24/request-approval.mjs                     # status view (dry run)
//   node scripts/ds24/request-approval.mjs --apply             # request, per product language
//   node scripts/ds24/request-approval.mjs --lang en --apply   # force USA reseller (2)
//   node scripts/ds24/request-approval.mjs --reseller US --apply
//   node scripts/ds24/request-approval.mjs --siteowner <id> --apply  # any marketplace
//   [--key starter] [--force]
// Env: DIGISTORE_API_KEY (writable), optionally APP_LANG,
//      DIGISTORE_SITEOWNER_ID, DIGISTORE_APPROVAL_CHECK.
import {
  dropApprovalCache,
  hasApprovalList,
  isMarketplaceActive,
  resellerEntry,
  statusesFrom,
  writeApprovalCache,
} from "./_approval.mjs";
import { ds24Call, requireApiKey, parseArgs } from "./_client.mjs";
import {
  extractProducts,
  isSold,
  productTargets,
  readProducts,
  sellFieldProblems,
} from "./_products.mjs";
import { isKnownLanguage, isReseller, resolveReseller } from "./_resellers.mjs";

const args = parseArgs(process.argv.slice(2));
const apply = Boolean(args.apply);
const force = Boolean(args.force);

/**
 * `parseArgs` yields the boolean `true` for a flag whose value is missing or is
 * itself a flag. Left unchecked, `--siteowner --apply` posted
 * `data[approval_status][true]=pending` to the live API, and `--lang --apply`
 * routed every product — German ones included — to the USA while announcing
 * "(via --lang)". A value-taking flag with no value is a typo, not an intent.
 */
function flagValue(name) {
  const value = args[name];
  if (value === undefined) return undefined;
  if (value === true) {
    console.error(`ERROR: --${name} needs a value (e.g. --${name} <value>).`);
    process.exit(2);
  }
  return String(value);
}

const onlyKey = flagValue("key") ?? null;
const appLang = process.env.APP_LANG || "de";

// **Only "pending" is ever a legitimate thing to write here.** `new` un-requests
// a product that is already in the queue; `approved` and `rejected` are the
// reseller's verdicts, and a vendor writing "approved" onto their own product
// marks it sellable to every reader of this data — the greeting goes quiet,
// doctor turns green and --apply skips it for ever, for a product no reseller
// ever looked at. An earlier round restricted the flag to the four values the
// READER can parse; readability was the wrong criterion.
const status = flagValue("status") ?? "pending";
if (status !== "pending" && !force) {
  console.error(
    `ERROR: --status "${status}" is not something to write here. Only "pending" requests an\n` +
      `       approval; "approved"/"rejected" are the reseller's verdicts and "new" withdraws\n` +
      `       a request. Pass --force if you really mean to write it.`,
  );
  process.exit(2);
}

// An explicit flag applies to the whole run; without one, each product is
// resolved from its own language further down. DIGISTORE_SITEOWNER_ID is the
// fallback, NOT an override — it used to be read into the same slot as
// --siteowner and win, so `--reseller US --apply` on a machine with the
// variable set silently wrote somewhere else and reported "given explicitly"
// about a value nobody had given.
const flagged = args.siteowner !== undefined || args.reseller !== undefined || args.lang !== undefined;
const envSiteowner = flagged ? undefined : process.env.DIGISTORE_SITEOWNER_ID;

let forced = null;
if (flagged || envSiteowner) {
  try {
    forced = resolveReseller({
      siteowner: flagValue("siteowner") ?? envSiteowner,
      reseller: flagValue("reseller"),
      lang: flagValue("lang"),
    });
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(2);
  }
  // **Only the four RESELLERS have a product approval.** Any other siteowner is
  // a Direct Seller: the vendor sells on their own account and there is nobody
  // to submit a product to, so there is no approval to request, no status to
  // read back and nothing this command can usefully do. Writing the field
  // anyway would put a value nobody acts on onto a live product — and an
  // earlier version of this script did exactly that, having mistaken "the
  // marketplace is not in the response" for "a private marketplace we cannot
  // see".
  if (!isReseller(forced.id)) {
    console.log(
      `Siteowner ${forced.id} is a Direct Seller, not one of the Digistore24 resellers\n` +
        `(1 Germany, 2 USA, 3 UK, 4 Ireland). Direct Sellers have no product approval —\n` +
        `there is nothing to request here, and nothing you need to do before selling.`,
    );
    process.exit(0);
  }
  const label = forced.reseller ? `${forced.reseller.name} [id=${forced.id}]` : `siteowner ID ${forced.id}`;
  const why = flagged
    ? { siteowner: "via --siteowner", reseller: "via --reseller", lang: "via --lang" }[forced.source]
    : "from DIGISTORE_SITEOWNER_ID in the .env";
  console.log(`Marketplace for every product: ${label} (${why})`);
} else {
  console.log(`Marketplace: per product, from its language (fallback APP_LANG="${appLang}")`);
}

const apiKey = requireApiKey();
const config = readProducts();

// The same refusal `ds24-sync` and the app's own registry loader make, for
// the same reason: `"sell": "false"` — the string — is truthy, so without
// this the entry would count as sold HERE and be submitted for marketplace
// approval while every other surface refuses the registry.
const sellProblems = sellFieldProblems(config);
if (sellProblems.length > 0) {
  console.error(
    `config/digistore-products.json:\n` +
      sellProblems.map((line) => `  - ${line}`).join("\n"),
  );
  process.exit(2);
}
// ONE ROW PER DIGISTORE24 PRODUCT — per offering AND language. An offering
// sold in German and English is two products, and they belong to two different
// marketplaces; approving one says nothing about the other.
//
// Always the PROD set: approval is a go-live step, and a "[DEV]" product has
// no business on a marketplace. Real sales run on the prod products only —
// dev/staging are for test purchases, which need no approval.
const targets = productTargets(config.products, "prod").filter(
  ({ key }) => !onlyKey || key === onlyKey,
);

// Read before writing. listProducts carries the current status per reseller
// (approval_status_list — probed, not documented; see _approval.mjs). The dry
// run is that view, and --apply needs it to refuse a step backwards.
//
// `statusRead` means "I got a list I can use", not "the call resolved":
// extractProducts answers [] for any response shape it does not recognise, and
// treating that as a successful read let --apply past its own gate and then
// persist an all-unknown answer into the shared cache.
let statusRead = false;
let list = [];
try {
  list = extractProducts(await ds24Call("listProducts", apiKey));
  statusRead = list.length > 0;
  if (!statusRead) {
    console.error("WARN: Digistore24 returned no product list — the status below cannot be shown.");
  }
} catch (err) {
  console.error(`WARN: could not read the current approval status (${err.message}).`);
}
const byId = new Map(
  list.filter((p) => p && typeof p === "object").map((p) => [String(p.product_id ?? p.id), p]),
);

// Writing blind is the one thing this script must not do. `updateProduct` with
// approval_status=pending on a product the reseller has already APPROVED is a
// step whose effect Digistore24 does not document, and the guard against it is
// the status we just failed to read. The sibling script refuses on the same
// failure (sync-products.mjs), and so does this one.
if (apply && !statusRead && !force) {
  console.error(
    "ERROR: refusing to request approval without knowing the current status —\n" +
      "       a product that is already approved must not be set back to pending.\n" +
      "       Try again, or pass --force to request anyway.",
  );
  process.exit(1);
}

let synced = false;
let applied = false;
let attempted = false;
let refused = 0;

try {
  for (const { label, language, productId } of targets) {
    if (!productId) {
      console.log(`· skipped: "${label}" (not created at Digistore24 yet — run sync-products first).`);
      continue;
    }
    synced = true;

    // Per product, unless a flag forced one marketplace for the whole run.
    if (!forced && language && !isKnownLanguage(language)) {
      console.error(
        `WARN: "${label}" has language "${language}", which is not a Digistore24 language code — ` +
          `it will be treated as non-German. Use "de", "en", … if that is not what you meant.`,
      );
    }
    const target = forced ?? resolveReseller({ lang: language || appLang });
    const siteowner = target.id;
    const where = target.reseller ? target.reseller.name : `siteowner ${siteowner}`;

    const product = byId.get(String(productId)) ?? null;
    const entry = resellerEntry(product, siteowner);
    const current = entry ? String(entry.approval_status ?? "").trim().toLowerCase() : null;
    // The target is always one of the four resellers by now (checked above and
    // guaranteed by the language rule), so a missing entry means the list could
    // not be read for this product — not that the marketplace is exotic. An
    // earlier version treated the two as one and sent requests into the void.
    const currentNote = entry ? `currently "${current}"` : "status unknown";
    if (statusRead && !hasApprovalList(product)) {
      console.error(`WARN: "${label}" carries no approval list in the response — status unknown.`);
    }

    // Already approved for THIS marketplace is the end state. Deliberately not
    // the aggregated status: a product approved in Germany may still have a
    // legitimate request to make in the USA.
    if (current === "approved") {
      console.log(`✓ "${label}" (product_id=${productId}) is already approved at ${where} — skipped.`);
      continue;
    }

    if (!apply) {
      console.log(
        `DRY-RUN — would request "${status}": "${label}" (product_id=${productId}) ` +
          `at ${where} [id=${siteowner}] — ${currentNote}`,
      );
      continue;
    }

    // A marketplace the account is not active for cannot act on the request.
    // Writing there reports success, changes nothing anybody will look at, and
    // the read side filters the entry out — so the product keeps being reported
    // as never submitted, for ever, and repeating the command never helps.
    if (entry && !isMarketplaceActive(entry) && !force) {
      console.error(
        `· REFUSED: "${label}" — your account is not active at ${where}, so a request there ` +
          `would never be looked at. Pass --force to send it anyway.`,
      );
      refused++;
      continue;
    }

    if (!entry && !force) {
      console.error(
        `· REFUSED: "${label}" (product_id=${productId}) — its status at ${where} could not be ` +
          `read, so an existing approval cannot be ruled out. Pass --force to request anyway.`,
      );
      refused++;
      continue;
    }

    attempted = true;
    await ds24Call("updateProduct", apiKey, {
      product_id: String(productId),
      [`data[approval_status][${siteowner}]`]: status,
    });
    applied = true;
    console.log(`✓ Approval "${status}" requested: "${label}" at ${where} [id=${siteowner}] (was ${currentNote})`);
  }
} finally {
  // In a `finally` because a throw halfway through the loop still leaves the
  // requests that already went out — and a cache describing the state before
  // them, which the greeting would then report for the rest of the day.
  //
  // `attempted`, not `applied`: a call whose response was lost still reached
  // Digistore24, and caching the pre-write state with a fresh timestamp would
  // report "not submitted" about a product that was.
  if (attempted) {
    dropApprovalCache();
  } else if (
    statusRead &&
    !onlyKey &&
    refused === 0 &&
    String(process.env.DIGISTORE_APPROVAL_CHECK ?? "").toLowerCase() !== "off"
  ) {
    // Nothing was written, but we just read the live truth. Handing it to the
    // cache is what stops the greeting saying "pending" for the rest of the day
    // about products the reseller approved an hour ago.
    //
    // Not when the kill switch is on — this command would otherwise re-create
    // the very file the switch exists to remove, and doctor would start talking
    // again until the next session start deleted it.
    // Keyed by LABEL, not by registry key: an offering sold in two languages
    // is two products at two marketplaces, and one of them being approved says
    // nothing about the other. Collapsing them onto one key would let an
    // approved German product silence the reminder about its English twin —
    // and that twin is the one nobody remembers to submit.
    const syncedEntries = targets
      .filter(({ productId }) => productId)
      .map(({ label, productId }) => [label, { productId }]);
    if (syncedEntries.length > 0) {
      writeApprovalCache({ checkedAt: Date.now(), statuses: statusesFrom(syncedEntries, list) });
    }
  }
}

if (!synced) {
  // Three states, three sentences — the sync's own convention. A parked key
  // used to get "No synchronized products found" with the advice to sync,
  // which cannot help: `productTargets` skips parked rows for BOTH commands.
  // And the way to sync is `node run.mjs ds24-sync`, never the raw script —
  // that one skips the IPN hookup.
  if (onlyKey && config.products[onlyKey] && !isSold(config.products[onlyKey])) {
    console.error(
      `"${onlyKey}" is marked "sell": false in config/digistore-products.json — a parked\n` +
        `offering is neither synced nor submitted for approval. Set "sell": true there first.`,
    );
  } else if (!onlyKey && targets.length === 0 && Object.keys(config.products).length > 0) {
    console.error(
      `Every product in config/digistore-products.json is marked "sell": false — nothing to approve.`,
    );
  } else {
    console.error("No synchronized products found. Run 'node run.mjs ds24-sync' first.");
  }
  process.exit(1);
}
if (!apply) console.log("\nTo execute, call again with --apply.");
if (refused > 0) process.exit(1);
