// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What still has to happen after `node run.mjs module add <id>` — read off the
// module's own manifest, so a fifth module is covered the day it lands.
//
// ── Why this is a file of its own ──────────────────────────────────────────
// 🚨 The step people leave out is the SWITCH, and the reason is where the
// sentence used to live. `module list` printed it — but only inside its example
// for a module that is still DORMANT ("here is a command you could run"), so the
// one moment somebody needs it, right after they ran `module add`, is the one
// moment it is gone from the screen. `add` itself said only "Next: db-migrate"
// and "then commit both", and stopped.
//
// Measured, on a real app with all four modules installed: `module list` printed
// no switch step at all — there was no dormant module left to write the example
// about — and the operator was left looking at a menu with nothing in it,
// concluding the module system was broken. It was not: `config/community.json`
// said `"enabled": false`, which is what it ships as.
//
// So both call sites ask this file instead, and the knowledge sits in one place
// that a test can reach. `cli.mjs` runs its command on import and is therefore
// not importable from a test — that is the whole reason these few lines are not
// in it.
//
// ── The switch is NAMED, never READ ───────────────────────────────────────
// ⚠️ Same rule as `pointers()` in `cli.mjs`: three modules keep an `enabled` key,
// so peeking at it here would look easy and would be a second implementation of
// a question `isCommunityEnabled()` already owns — and that function also
// answers false for a file that is merely incoherent. Two answers that disagree
// on the day somebody typos a key is exactly the confusion this text exists to
// end. This says where the switch is and what leaving it alone costs; it never
// says which way it currently points.

/** @typedef {Record<string, unknown>} Manifest */

/**
 * The invariant half of the switch step — true of every module, and therefore
 * not something a manifest can say.
 *
 * Kept beside the module-specific half rather than typed out at each call site,
 * because the two call sites have different room: `module list` prints this in
 * a command column where a second clause does not fit, and `module add` prints
 * it with `whileOff()` after it. One idea, two lengths, one place to change it.
 */
export const INSTALLING_IS_NOT_SWITCHING_ON = "installing does not switch a module on";

/**
 * What an installed module that is switched OFF does — its own manifest's
 * answer, as one sentence fragment.
 *
 * The base clause is always true and is the sentence `module list` already ends
 * on: an installed module that is off does NOTHING. What follows it are the two
 * shapes that absence actually takes, and each is claimed only by a module that
 * declares the field it comes from — `companion` has neither routes nor a menu
 * entry, and promising it a 404 would be describing another module.
 *
 * @param {Manifest} manifest
 * @returns {string}
 */
export function whileOff(manifest) {
  const shapes = [];
  if (Array.isArray(manifest.app) && manifest.app.length > 0) {
    shapes.push("its routes answer the same 404 a route that never existed answers");
  }
  if (typeof manifest.nav === "string") shapes.push("its menu entries stay hidden");

  if (shapes.length === 0) return "it does nothing";
  return `it does nothing — ${shapes.join(", and ")}`;
}

/**
 * The steps between `module add <id>` and the module actually doing something,
 * in the order they have to happen.
 *
 * Order is load-bearing rather than cosmetic: migrating after switching on means
 * the first request reaches a page whose tables are not there, which is a 500
 * where the honest answer was a 404.
 *
 * The switch step carries BOTH halves — `why` is the invariant and fits a
 * column, `whileOff` is this module's own consequence and needs a wrapped line.
 * A caller renders whichever its layout has room for; neither has to know the
 * wording.
 *
 * 🚨 The third step is the one nobody could have guessed from the other two.
 * A module that brings COMPONENTS and no route of its own is installed,
 * migrated, switched on — and still shows nothing, because the thing it
 * contributes is a panel that one of YOUR pages has to render. Reported
 * 2026-08-12 by somebody who did every printed step for `companion` and
 * reasonably concluded the module system was broken: the closing line said
 * *"set `enabled`: true, then restart"*, as though something would appear.
 * (`activity` was worse: no `config` at all, so it printed no switch step
 * either — two numbered steps, both done, nothing on screen.)
 *
 * ⚠️ Derived, never declared. `manifest.components` with neither `app` nor
 * `nav` is exactly the shape — measured across all five modules on the day it
 * was written: `api`, `courses` and `community` bring routes and no
 * components, `activity` and `companion` the reverse. A free-text field in the
 * manifest would have been the obvious answer and is the one this repo already
 * refused: `guidance` was removed on 2026-08-08 as "a promise with no
 * executor", and `manifest.mjs` rejects an unknown key rather than ignoring it.
 *
 * @param {Manifest} manifest
 * @returns {({ kind: "migrate", tables: number } | { kind: "switch", file: string, why: string, whileOff: string } | { kind: "render", components: string[], docs: string | null })[]}
 */
export function afterInstall(manifest) {
  const steps = [];

  const tables = Array.isArray(manifest.tables) ? manifest.tables.length : 0;
  if (tables > 0) steps.push({ kind: "migrate", tables });

  if (typeof manifest.config === "string") {
    steps.push({
      kind: "switch",
      file: manifest.config,
      why: INSTALLING_IS_NOT_SWITCHING_ON,
      whileOff: whileOff(manifest),
    });
  }

  // ⚠️ Capitalised names only. `manifest.components` is the module's whole
  // component seam and `activity` puts a HOOK in it (`useActivity`) — a step
  // that said "render <useActivity>" would be telling somebody to write
  // something that is not an element. React's own convention is the filter, and
  // it is the right one here because this step is about rendering.
  const components = Object.keys(manifest.components ?? {}).filter((name) => /^[A-Z]/.test(name));
  const routes = Array.isArray(manifest.app) && manifest.app.length > 0;
  const menu = typeof manifest.nav === "string";
  // ⚠️ `slots` too: a slot component is mounted by the CORE, so a module that
  // fills one is visible without anybody writing a line. No module has both
  // today — `api` and `community` declare slots and no components, `activity`
  // and `companion` the reverse — but the exclusion belongs in the derivation
  // rather than in the luck of the current tree.
  const slotted = manifest.slots !== undefined && manifest.slots !== null;
  if (components.length > 0 && !routes && !menu && !slotted) {
    steps.push({
      kind: "render",
      components,
      docs: typeof manifest.docs === "string" ? manifest.docs : null,
    });
  }

  return steps;
}
