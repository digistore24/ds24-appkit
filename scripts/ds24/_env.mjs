// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The environment axis of the Digistore24 sync: dev / staging / prod.
//
// Every environment gets its OWN product set at Digistore24 (see
// docs/environments.md). This module is the one place the scripts decide
// WHICH environment a run belongs to and what follows from that — the
// internal name a product is found by again, the visible name suffix, the
// app URL the thank-you/IPN addresses are built from, and which .env key a
// per-environment value is stored under.
//
// STAGING IS OPTIONAL. Many apps go dev → prod and never run a staging sync;
// that is fine as long as they test. Nothing here creates staging products
// unless somebody explicitly asks for `--env staging`.
//
// `syncEnvFromAppEnv` is the `.mjs` twin of `appEnv()` in lib/env-guard.ts —
// the scripts are plain Node and do not import the app's TypeScript. Change
// one, change the other; `_env.test.ts` pins the two against each other
// (the same twin rule `_products.mjs` and `_public-url.mjs` carry).

/** Every environment a sync run can target. */
export const SYNC_ENVS = ["dev", "staging", "prod"];

/** name_intern must stay within Digistore24's 63-character limit. */
export const NAME_INTERN_MAX = 63;

/**
 * APP_ENV → sync environment. Twin of `appEnv()` (lib/env-guard.ts): unknown
 * values count as production — when in doubt the strictest environment.
 */
export function syncEnvFromAppEnv(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "" || v === "development" || v === "dev" || v === "local") return "dev";
  if (v === "staging" || v === "test") return "staging";
  return "prod";
}

/**
 * The environment of THIS run: `--env dev|staging|prod` when given, otherwise
 * derived from APP_ENV — so a sync run ON the deployed host does the right
 * thing with no flag at all.
 *
 * A typed flag outside the three values is a mistake, not a deployment, and is
 * refused ({ error }) rather than mapped to "the strictest one" the way a
 * misconfigured APP_ENV is: whoever types `--env produktion` meant something
 * specific and must not silently sync a different set.
 */
export function resolveSyncEnv(args, env = process.env) {
  const flag = args?.env;
  if (flag === undefined) return { env: syncEnvFromAppEnv(env.APP_ENV) };
  if (flag === true) {
    return { error: `--env needs a value: ${SYNC_ENVS.join(" | ")}` };
  }
  const v = String(flag).trim().toLowerCase();
  if (!SYNC_ENVS.includes(v)) {
    return { error: `Unknown --env "${flag}" — use ${SYNC_ENVS.join(" | ")}.` };
  }
  return { env: v };
}

/**
 * The internal name of ONE language product in ONE environment — the stable
 * handle the sync finds it by again, so a changed display name never orphans
 * it and a dev sync can never claim a prod product.
 *
 * It carries the language because `name_intern` has to be unique per product
 * and there is one product per key AND language (see sync-products.mjs). It
 * carries the environment for the same reason one level up: every environment
 * has its own product set, and the internal name is what keeps the sets
 * apart at Digistore24. Pre-env products (`key__lang`) are handled where they
 * belong — as a prod-only lookup fallback in findExisting, never as something
 * written.
 */
export function internalName(key, language, env) {
  return `${key}__${language}__${env}`;
}

/**
 * Registry keys whose internal name would not fit Digistore24's 63-character
 * `name_intern` — checked up front, because the API would otherwise truncate
 * or refuse mid-run. `__xx__staging` is the longest suffix (13 chars), so a
 * key of up to 50 characters always fits.
 */
export function overlongKeys(keys, languages = ["de"], envs = SYNC_ENVS) {
  const longestLang = languages.reduce((a, b) => (b.length > a.length ? b : a), "de");
  const longestEnv = envs.reduce((a, b) => (b.length > a.length ? b : a), "staging");
  return keys.filter(
    (key) => internalName(key, longestLang, longestEnv).length > NAME_INTERN_MAX,
  );
}

/**
 * The buyer-visible product name. Dev and staging products carry their
 * environment openly, because the name is the only marker that travels to the
 * CHECKOUT PAGE — which is where somebody notices they are about to test
 * against the wrong set. Prod stays clean: that name is the one real buyers see.
 *
 * ⚠️ This used to say "the DS24 API has no tag field, so the name is where a
 * human tells the sets apart". There is one now (`data[tag]`, `_own.mjs`) and
 * this app writes it — but it is a backend filter and is invisible at a
 * checkout, so it does not do this job. The reason changed; the decision did
 * not.
 */
export function displayName(name, env) {
  if (env === "prod") return name;
  return `${name} [${env.toUpperCase()}]`;
}

/**
 * The app URL a sync for `env` builds its thank-you/IPN addresses from.
 *
 *   dev      APP_URL, exactly as before (localhost travels through the public
 *            redirect for the thank-you page, and the IPN gets a tunnel).
 *   staging  APP_URL_STAGING — or APP_URL when this machine IS the staging
 *            host (APP_ENV says so) and APP_URL is already public https.
 *   prod     APP_URL_PROD — same host fallback.
 *
 * The dedicated keys exist so a LOCAL `ds24-sync --env prod` can know the
 * deployed domain while APP_URL itself stays local — a non-local APP_URL
 * switches off the development login (lib/auth/dev-login.ts) and the DEV
 * test-payment parameter, so it must never be edited just to run a sync.
 *
 * Missing URL for staging/prod is an { error } naming the key to set — a
 * half-configured environment sync must be loud, never a silent localhost
 * product set wearing a prod name.
 */
export function appUrlForEnv(env, e = process.env) {
  const trim = (u) => (u ? String(u).replace(/\/+$/, "") : null);
  if (env === "dev") return { url: trim(e.APP_URL) };

  const key = env === "prod" ? "APP_URL_PROD" : "APP_URL_STAGING";
  const dedicated = trim(e[key]);
  if (dedicated) {
    if (!/^https:\/\//.test(dedicated)) {
      return { error: `${key} has to be a public https URL (is: "${dedicated}").` };
    }
    return { url: dedicated };
  }
  // On the deployed host itself APP_URL IS that environment's address.
  const appUrl = trim(e.APP_URL);
  if (syncEnvFromAppEnv(e.APP_ENV) === env && appUrl && /^https:\/\//.test(appUrl)) {
    return { url: appUrl };
  }
  return {
    error:
      `No ${env} domain known. Set ${key}=https://your-${env}-domain in the .env ` +
      `(APP_URL stays local — a non-local value switches off the development login), ` +
      `then run the sync again.`,
  };
}

/**
 * The .env key a per-environment value lives under. The PLAIN key
 * (DIGISTORE_IPN_PASSPHRASE, DIGISTORE_IPN_DOMAIN_ID) always means "the
 * environment this machine runs as" — that is what the app reads at runtime,
 * and it is what a sync run on the deployed host keeps writing, unchanged.
 * A sync for ANOTHER environment stores under a suffixed key
 * (…_PROD / …_STAGING / …_DEV): a reference copy, so the run stays idempotent
 * and the value can be copied into the host's secret store.
 */
export function envScopedKey(base, env, machineEnv) {
  if (env === machineEnv) return base;
  return `${base}_${env.toUpperCase()}`;
}
