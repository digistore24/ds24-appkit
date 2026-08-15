// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Matching a registry row against what already exists at Digistore24 — and
// with it the one question `ds24-sync` has to answer BEFORE it writes
// anything: which of these rows would be CREATED?
//
// It lived inside `sync-products.mjs` as a closure over that file's `list` and
// `env`, which made it untestable: the file is top-level code with no exports,
// so the four legacy fallbacks below — the ones that decide whether a sync
// UPDATES a product carrying real sales or creates a duplicate next to it —
// had no test at all. Here they take their inputs as parameters and
// `_match.test.ts` covers them.
//
// 🚨 ONE classification, used by both the gate and the loop. A gate that
// computed its list of new products separately from the loop that then
// creates them would eventually disagree with it, and a gate that lies about
// what is coming is worse than no gate.
import { idOf } from "./_products.mjs";
import { internalName } from "./_env.mjs";

/** A `name_intern` that already belongs to an environment's set. */
export const ENV_SCOPED_INTERN = /__(dev|staging|prod)$/;

/** The language a pre-0.6.0 entry is assumed to be in when it names none. */
const FALLBACK_LANGUAGE = "de";

/**
 * Find a product this script (or a hand) created earlier: first via the stable
 * internal name, then via the display name — the latter catches products that
 * were already created by hand in DS24 before this convention existed.
 *
 * `claimed` stops one Digistore24 product answering for two registry rows: a
 * product already taken by an earlier row of this run is skipped, and the
 * later row is created instead. Two keys pointing at one product would make
 * every purchase of either unattributable — `productByDs24Id` answers `null`
 * on an ambiguous id rather than guessing.
 *
 * ⚠️ Measured 2026-08-15, correcting what this paragraph used to claim: it is
 * NOT `claimed` that keeps the two LANGUAGES of one offering apart. The
 * `language !== legacyLanguage` guard below returns before the display-name
 * fallback is reached, so an English row answers `null` with an empty
 * `claimed` too. Where `claimed` actually decides is two OFFERINGS sharing a
 * display name — both are legacy-language rows, both reach that fallback.
 * `_match.test.ts` pins both halves.
 *
 * The bare-key lookup is the same guard from the other side: it is the
 * pre-0.6.0 internal name, so it may only answer for the FIRST language, which
 * is the one that product was created as.
 *
 * EVERY fallback below the env-scoped internal name is prod-only. The
 * pre-environment products (bare `key__lang`, bare `key`, a hand-created
 * display name) are the ones that may carry real sales and approvals, and
 * prod is the set they belong to — a dev or staging row that is not found
 * under its own internal name gets CREATED, never adopted. That is the
 * guarantee that a dev sync cannot rename a live product into "[DEV]".
 */
export function findExisting({ key, def, language }, claimed, list, env) {
  const free = (p) => (p && !claimed.has(String(idOf(p))) ? p : null);
  const byInternal = list.find(
    (p) => p.name_intern === internalName(key, language, env),
  );
  if (byInternal) return free(byInternal);

  if (env !== "prod") return null;

  // Another environment's product is never a legacy candidate — it already
  // belongs to a set.
  const unscoped = (p) => !ENV_SCOPED_INTERN.test(String(p.name_intern ?? ""));

  // The pre-environment internal name (template < 0.14.0): one shared product
  // per key and language.
  const byPreEnv = list.find(
    (p) => unscoped(p) && p.name_intern === `${key}__${language}`,
  );
  if (byPreEnv) return free(byPreEnv);

  // Everything below is the pre-0.6.0 world, where an offering had ONE product
  // whose internal name was the bare key. Such a product is in exactly one
  // language — the one the old registry named in `language` — so only that row
  // may claim it. Anchoring on the legacy field rather than on "the first
  // language in the map" is what makes this independent of how the JSON
  // happens to be ordered: reorder `{en, de}` to `{de, en}` and an
  // order-based rule would hand the German product to the English row.
  const legacyLanguage = def.language || FALLBACK_LANGUAGE;
  if (language !== legacyLanguage) return null;

  const byLegacyKey = list.find((p) => unscoped(p) && p.name_intern === key);
  if (byLegacyKey) return free(byLegacyKey);
  const byName = list.find(
    (p) =>
      unscoped(p) &&
      (p.name === def.name || p.name_intern === def.name || p.product_name === def.name),
  );
  return free(byName);
}

/**
 * Every target row with the id it resolves to and what the sync would DO with
 * it — `"update"` when it already exists over there, `"create"` when it does
 * not.
 *
 * Resolution order is the sync's own: the id already recorded in the registry
 * first, then `findExisting`. `claimed` carries across rows exactly as it does
 * in the loop, so the second language of an offering cannot claim the first
 * one's product.
 *
 * WHY THIS MAY RUN AHEAD OF THE LOOP, which is the claim that makes the gate
 * honest: the loop adds every newly created id to `claimed` as it goes, and
 * that lookahead is provably irrelevant here. `list` is fetched ONCE, before
 * the loop starts (`sync-products.mjs`), so an id created during the run is
 * not in it and no later `findExisting` could have returned it anyway. The
 * only thing `claimed` has to carry is ids that were ALREADY over there, and
 * those are all present from the start. `_match.test.ts` asserts it.
 *
 * Typed in JSDoc rather than left to inference: the rows travel into
 * `sync-products.mjs`, and `action` is the field the gate branches on — an
 * `any` there would let a typo like `"created"` past `npm run typecheck`.
 *
 * @typedef {{ key: string, def: Record<string, any>, language: string,
 *             productId: string | null, label?: string }} Target
 * @param {Target[]} targets
 * @param {Array<Record<string, any>>} list what `listProducts` handed back
 * @param {string} env
 * @returns {Array<Target & { existingId: string | null,
 *                            action: "update" | "create" }>}
 */
export function classifyTargets(targets, list, env) {
  const claimed = new Set();
  return targets.map((target) => {
    const existingId =
      target.productId || idOf(findExisting(target, claimed, list, env) || {});
    if (existingId) claimed.add(String(existingId));
    return {
      ...target,
      existingId: existingId ? String(existingId) : null,
      action: existingId ? "update" : "create",
    };
  });
}
