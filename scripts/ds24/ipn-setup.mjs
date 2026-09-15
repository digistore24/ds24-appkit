#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Set up/update the Digistore24 IPN connection (idempotent).
//
// Idempotency rests on a STABLE domain_id and on DELETE-THEN-CREATE: any
// existing connection for this domain is removed first (ipnDelete), then a
// fresh one is created (ipnSetup). Same domain in → exactly one connection out,
// pointing at the current URL — no stale duplicate left behind whose old tunnel
// address no longer resolves. The domain_id is kept in the .env
// (DIGISTORE_IPN_DOMAIN_ID) so it stays the same across runs — crucial, because
// the public URL can change (e.g. a new one with every `node run.mjs ds24-tunnel`)
// while the connection is meant to stay the one for this app. The passphrase is
// reused across the delete, so signature verification is unaffected.
//
// The other half of that: the domain_id has to be UNIQUE per app, and a name
// like "local-app" is not. Digistore24 finds a connection by (merchant, API
// key, domain_id) and UPDATES the row it finds — so two of the vendor's own
// projects that derive the same id do not get two connections, they take turns
// overwriting one. The second sync silently re-points the first project's IPN
// at its own address, and the first project's purchases then arrive nowhere,
// with no error visible on either side. That is why a DERIVED id gets a random
// tail (see below); an id passed with --domain is the caller's own business.
//
// WHICH products the connection covers is `product_ids`, and it is the second
// thing that goes wrong in a real account. Digistore24's own default is `all`;
// this script instead sends the ids actually in the registry
// (config/digistore-products.json), because a vendor's account normally holds
// more than this app's products — an older funnel, a second app, somebody
// else's launch. Naming the ids keeps every connection to its own products, so
// two apps of the same vendor can be connected at the same time. Several ids
// travel comma-separated: product_ids=111,222,333.
//
// `all` stays legitimate and is the fallback when nothing is synced yet
// (--products all forces it): this app's IPN handler records an order for a
// product the registry does not know and grants nothing for it
// (resolveProduct() in lib/digistore/payment-event.ts returns null), so foreign
// purchases are ignored rather than mis-granted. What you lose with `all` is
// the separation, not the safety.
//
// Return value of ipnSetup: { created, updated, deleted, sha_passphrase, ipn_id }.
// The defaults (set by DS24) match this template's IPN handler:
// transactions = payment/refund/chargeback/payment_missed/last_paid_day,
// timing = before_thankyou, categories = orders.
//
// Passphrase: an existing DIGISTORE_IPN_PASSPHRASE is reused (true idempotency
// — the app's signature verification stays valid). If it is missing, DS24
// generates one ("random") and this script writes it into the .env.
//
// Important: DS24 checks the ipn_url during setup with a GET for HTTP 200 — so
// the URL has to be publicly reachable over https (localhost won't do). This
// template's IPN route answers GET with "OK".
//
// And this is the ONE Digistore24 URL that the public redirect
// (scripts/ds24/_public-url.mjs) cannot rescue: the redirect works because a
// BROWSER on your machine follows it. Here it is the Digistore24 server calling,
// and "localhost" is its own machine, not yours. So no rewriting happens below —
// locally the IPN is skipped and explained instead.
//
// Usage:
//   node scripts/ds24/ipn-setup.mjs --auto --apply
//        # URL from APP_URL, domain_id from .env or derived+saved
//   node scripts/ds24/ipn-setup.mjs --auto --env prod --apply
//        # the PROD connection: URL from APP_URL_PROD, keys suffixed _PROD when
//        # run away from the prod host (see _env.mjs — one connection per env)
//   node scripts/ds24/ipn-setup.mjs --url "https://app.example.de/api/ipn" \
//        --domain "app.example.de" --apply
//   node scripts/ds24/ipn-setup.mjs --auto --products 111,222,333 --apply
//        # only these products; --products all covers the whole account
//   Dry run is the default; --apply executes, --dry-run beats --apply.
//   Via make: `node run.mjs ds24-sync` applies, `node run.mjs ds24-sync --dry-run` previews.
import { randomBytes } from "node:crypto";

import { ds24Call, requireApiKey, parseArgs, isYes } from "./_client.mjs";
import { readProducts, syncedProductIds } from "./_products.mjs";
import { resolveSyncEnv, syncEnvFromAppEnv, appUrlForEnv, envScopedKey } from "./_env.mjs";
import { setEnvValue } from "../lib/env-write.mjs";
import {
  CLOUDFLARED_MISSING,
  activeTunnelUrl,
  appPort,
  openTunnel,
  waitReachable,
} from "./_tunnel.mjs";

const ENV_FILE = ".env";
const args = parseArgs(process.argv.slice(2));
// --dry-run wins over --apply: run.mjs hands --apply in by default, and
// asking for a preview has to be able to override that.
const apply = Boolean(args.apply) && !args["dry-run"];
const auto = Boolean(args.auto);

// ONE IPN CONNECTION PER ENVIRONMENT — each env's products report to the app
// instance that sells them. `env` is which environment this run wires up;
// `machineEnv` is which one this machine runs as (APP_ENV). When they differ —
// a locally-run `--env prod` — the connection's values are stored under
// suffixed .env keys (…_PROD) as reference copies, and the deployed host has
// to receive them as its own unsuffixed secrets (see the closing message).
const resolvedEnv = resolveSyncEnv(args);
if (resolvedEnv.error) {
  console.error(`ERROR: ${resolvedEnv.error}`);
  process.exit(2);
}
const env = resolvedEnv.env;
const machineEnv = syncEnvFromAppEnv(process.env.APP_ENV);
const passphraseKey = envScopedKey("DIGISTORE_IPN_PASSPHRASE", env, machineEnv);
const domainIdKey = envScopedKey("DIGISTORE_IPN_DOMAIN_ID", env, machineEnv);

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// The random tail on a derived domain_id (see the header). Ten characters of
// [a-z0-9] out of node:crypto — enough that two projects never meet, short
// enough that the readable part still reads: "local-my-app-diw2hvnz73".
const TAIL_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
function withRandomTail(base) {
  let tail = "";
  for (const byte of randomBytes(10)) tail += TAIL_ALPHABET[byte % TAIL_ALPHABET.length];
  return `${base}-${tail}`;
}

// --- IPN URL: explicitly via --url, in --auto mode derived. ------------------
// Order matters. APP_URL comes first whenever it is genuinely public: that is
// the app's real address, and in STAGING/PROD it is the only right answer.
//
// Only when it is not (locally it is http://localhost on purpose — a public
// value there switches off the development login) does a running tunnel get its
// turn. That is what makes `node run.mjs ds24-tunnel` && `node run.mjs ds24-sync` work in either
// order: the sync no longer skips the IPN, it simply finds the open address.
//
// And when there is no tunnel either, this opens one. `node run.mjs ds24-sync` is the
// command whose job includes the IPN hookup, so finishing that job rather than
// printing a hint is the point. Two guards keep it honest:
//   - never on a dry run (a preview must not publish your machine), and
//   - never with --no-tunnel, for anyone who wants the old behaviour.
// A public APP_URL never gets this far, so STAGING/PROD are untouched.
let url = args.url;
let viaTunnel = false;
let openedTunnel = false;
// A tunnel is a DEV answer: it points at the app on THIS machine, which is
// never where staging/prod purchases should report to.
const mayOpenTunnel = env === "dev" && apply && !args["no-tunnel"];

if (!url && auto && env !== "dev") {
  // staging/prod: the deployed domain (APP_URL_STAGING / APP_URL_PROD — or
  // APP_URL on the deployed host itself). Missing is a loud refusal, not a
  // skip: the products of this environment are synced by now, and an IPN
  // pointing nowhere means paid purchases that never arrive in the app.
  const resolved = appUrlForEnv(env);
  if (resolved.error) {
    console.error(`ERROR: ${resolved.error}`);
    console.error(
      `The ${env} products are synced, but the IPN connection is NOT set up yet — ` +
        `set the URL and run \`node run.mjs ds24-sync --env ${env}\` again.`,
    );
    process.exit(2);
  }
  url = `${resolved.url}/api/ipn`;
}

if (!url && auto) {
  const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
  if (/^https:\/\//.test(appUrl)) {
    url = `${appUrl}/api/ipn`;
  } else {
    let tunnel = activeTunnelUrl();
    if (!tunnel && mayOpenTunnel) {
      // Say it before doing it: this makes the machine reachable from the
      // internet, and nobody should discover that from a log line afterwards.
      console.log("• No public address yet — opening a Cloudflare Quick Tunnel for the IPN.");
      console.log("  What that means: while it runs, this app's IPN route has a temporary public");
      console.log("  address, so Digistore24 can send test purchases to it. Only /api/ipn passes");
      console.log("  through — every other path is refused on this machine before it reaches the");
      console.log("  app. `node run.mjs stop` closes it, `node run.mjs status` shows whether it is open.");
      const opened = await openTunnel({ port: appPort(), log: (m) => console.log(`  ${m}`) });
      if (opened.ok) {
        tunnel = opened.url;
        openedTunnel = true;
        console.log(`  ${opened.url}`);
        await waitReachable(opened.url);
      } else {
        // Not being able to open one is not a failure of the sync — the
        // products are done, and the skip message below explains the rest.
        console.log(`  … could not open one: ${tunnelExcuse(opened.reason)}`);
      }
    }
    if (tunnel) {
      url = `${tunnel}/api/ipn`;
      viaTunnel = true;
    } else if (appUrl) {
      url = `${appUrl}/api/ipn`;
    }
  }
}

function tunnelExcuse(reason) {
  if (reason === "no-app") return "the app is not running (node run.mjs start).";
  if (reason === "no-cloudflared") return `cloudflared is not installed.\n${CLOUDFLARED_MISSING}`;
  if (reason === "no-gate") return "the IPN gate did not come up (see .dev/tunnel.log).";
  if (reason === "stuck") return "an earlier tunnel process will not end (node run.mjs stop).";
  return "cloudflared reported no address (see .dev/tunnel.log).";
}

// Without a public https URL there is no way to set up an IPN. In --auto mode
// (part of `node run.mjs ds24-sync`) that is not an error but the normal case in local
// development: skip and explain, instead of letting the whole sync run fail.
if (!url || !/^https:\/\//.test(url)) {
  if (auto) {
    console.log("• IPN skipped — no public https URL available.");
    console.log("  Digistore24 verifies the IPN address by calling it; localhost won't do,");
    console.log("  and the redirect the other URLs use does not help — that one needs a browser.");
    console.log(
      mayOpenTunnel
        ? "  Fix what the message above named, then run `node run.mjs ds24-sync` again — it opens\n" +
            "  the tunnel by itself. Live instead: point APP_URL at your domain."
        : "  Local: `node run.mjs ds24-tunnel` opens a public address and registers the IPN on it.\n" +
            "  Live:  point APP_URL at the domain, then `node run.mjs ds24-sync`.",
    );
    console.log("  The products are unaffected by this and have already been synchronized.");
    process.exit(0);
  }
  console.error(
    url
      ? "ERROR: The IPN URL has to be HTTPS."
      : "ERROR: --url <IPN endpoint URL> required (or --auto with APP_URL set).",
  );
  process.exit(2);
}

if (viaTunnel) {
  console.log(
    openedTunnel
      ? "• Registering the tunnel just opened as the IPN address (APP_URL stays local)."
      : "• Using the running local tunnel as the IPN address (APP_URL stays local).",
  );
}

// --- domain_id: --domain > .env (DIGISTORE_IPN_DOMAIN_ID) > derived default.
// It has to be STABLE, otherwise ipnSetup creates a new connection for every
// changed URL. That is why a newly derived value is written into the .env.
//
// The default hangs off the environment, not off the host name: in development
// the public URL is ephemeral (every `node run.mjs ds24-tunnel` yields a new one) — here the
// project name is what counts as a stable identifier. In staging/production the
// domain itself is stable and meaningful.
//
// Whatever it is derived from, a derived id ends in a random tail. The readable
// part says which app it is; the tail is what keeps it from being the SAME id
// as somebody's other project — "local-app" is a name two projects arrive at
// by themselves, and the loser of that collision loses its IPN silently (see
// the header). Only a value we derive gets one: --domain and an id already in
// the .env are taken exactly as they are.
let domainId = args.domain || null;
let domainIdIsNew = false;
if (!domainId) domainId = process.env[domainIdKey] || null;
if (!domainId) {
  const project = process.env.APP_NAME || process.cwd().split("/").filter(Boolean).pop() || "app";
  domainId = withRandomTail(
    env === "dev"
      ? slug(`local-${project}`)
      : slug(`${new URL(url).hostname}-${env}`),
  );
  domainIdIsNew = true;
}

const name = args.name || domainId;
const hasPassphrase = Boolean(args.passphrase || process.env[passphraseKey]);
const passphrase = args.passphrase || process.env[passphraseKey] || "random";
const vendorId = args.vendor ? String(args.vendor) : undefined;

// --- product_ids: --products > the registry's synced ids > "all". ------------
// See the header for why naming them beats "all" — and with one product set
// per environment it carries a second job: the ids are THIS environment's, so
// a dev purchase reports to the dev app and never to prod. A product with no
// id has not been synced yet and cannot be named — `ds24-sync` creates the
// products BEFORE it gets here, so by the time this runs they normally all
// have one.
function registryProductIds() {
  try {
    return syncedProductIds(readProducts(), env);
  } catch {
    // A missing or broken registry is not this script's error to raise — the
    // sync would already have said so. Fall back to the safe, wide setting.
    return [];
  }
}

if (args.products === true) {
  console.error(
    'ERROR: --products needs a value — a comma-separated list of Digistore24 product ids (111,222,333) or "all".',
  );
  process.exit(2);
}
const requestedProducts =
  typeof args.products === "string" ? args.products.replace(/\s+/g, "") : null;
const registryIds = requestedProducts ? [] : registryProductIds();
const productIds = requestedProducts || (registryIds.length ? registryIds.join(",") : "all");

function ipnSetupParams() {
  const p = {
    ipn_url: url,
    name,
    domain_id: domainId,
    product_ids: productIds,
    sha_passphrase: passphrase,
  };
  if (vendorId) p.vendor_id = vendorId;
  return p;
}

const apiKey = requireApiKey();

if (!apply) {
  const infoParams = { domain_id: domainId };
  if (vendorId) infoParams.vendor_id = vendorId;
  const info = await ds24Call("ipnInfo", apiKey, infoParams).catch(() => null);
  // have_settings arrives as the STRING "Y"/"N", never as a boolean (base.php →
  // bool()). `=== true` is therefore false even when the connection exists, and
  // the dry run announced a "new" connection on every single run. Same trap that
  // once made ipnSetup claim "created" every time — see isYes() in _client.mjs.
  const exists = isYes(info?.have_settings);
  console.log(
    exists
      ? `DRY-RUN — existing IPN connection for domain "${domainId}" would be deleted and recreated:`
      : `DRY-RUN — new IPN connection for domain "${domainId}" would be set up:`,
  );
  const preview = ipnSetupParams();
  if (preview.sha_passphrase === "random")
    preview.sha_passphrase = "<random — DS24 generates & returns it>";
  console.log(JSON.stringify(preview, null, 2));
  console.log("\nNothing was changed. To execute: node run.mjs ds24-sync");
  process.exit(0);
}

// Pin down the stable domain_id before the call goes out — then the next run is
// idempotent, even if the URL has changed in the meantime.
if (domainIdIsNew) {
  setEnvValue(ENV_FILE, domainIdKey, domainId);
  console.log(`→ ${domainIdKey}="${domainId}" saved in ${ENV_FILE}.`);
}

// Delete-then-create: remove any existing connection for this exact domain_id
// first, so what remains afterwards is exactly the one we create now. ipnDelete
// is scoped to this API key and this domain_id server-side (see the DS24 API),
// so it cannot touch another app's connections. A missing connection deletes
// nothing — harmless. The passphrase is unchanged, so the app keeps verifying
// signatures against the same secret after the recreate.
const deleteParams = { domain_id: domainId };
if (vendorId) deleteParams.vendor_id = vendorId;
const del = await ds24Call("ipnDelete", apiKey, deleteParams).catch(() => null);
if (del && isYes(del.modified)) {
  console.log(`• Removed the existing IPN connection for domain "${domainId}" before recreating it.`);
}

const res = await ds24Call("ipnSetup", apiKey, ipnSetupParams());
// created/updated/deleted arrive as "Y"/"N" — never as booleans. isYes() is the
// reason this no longer claims "created" on every single run.
const action = isYes(res.created)
  ? "created"
  : isYes(res.updated)
    ? "updated"
    : "unchanged";
console.log(`✓ IPN connection ${action}: domain "${domainId}" → ${url}`);
if (isYes(res.deleted)) console.log("  (duplicate connections removed)");
console.log(`  ipn_id=${res.ipn_id ?? "?"}`);
console.log(
  productIds === "all"
    ? "  Products: ALL of this account. Purchases of products outside the registry\n" +
        "    are recorded but grant nothing. Narrow it with --products <ids> once the\n" +
        "    products are synced, if the account sells anything besides this app."
    : `  Products: ${productIds}`,
);

if (hasPassphrase) {
  console.log("  SHA512 passphrase: taken over from the .env, unchanged.");
} else if (res.sha_passphrase) {
  // DS24 generated one — save it right away, from now on the run is idempotent.
  setEnvValue(ENV_FILE, passphraseKey, res.sha_passphrase);
  console.log(`  ✓ SHA512 passphrase generated and saved as ${passphraseKey} in ${ENV_FILE}.`);
} else {
  console.log("  (No passphrase returned — please check manually.)");
}

// A sync for another machine's environment leaves that machine one step to do:
// the deployed app reads the UNSUFFIXED keys from its own secrets, and until
// the passphrase is there it rejects every IPN signature.
if (env !== machineEnv && (env === "prod" || env === "staging")) {
  console.log(
    `\n→ This wired up the ${env.toUpperCase()} environment from this machine. ` +
      `The values here are reference copies —\n` +
      `  set them as secrets at your ${env} host and redeploy:\n` +
      `    DIGISTORE_IPN_PASSPHRASE = <value of ${passphraseKey} in ${ENV_FILE}>\n` +
      `    DIGISTORE_IPN_DOMAIN_ID  = <value of ${domainIdKey} in ${ENV_FILE}>\n` +
      `  Until then the ${env} app rejects every IPN signature ("paid, but nothing happened").`,
  );
}
