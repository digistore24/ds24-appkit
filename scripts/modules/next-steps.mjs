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
 * @param {Manifest} manifest
 * @returns {({ kind: "migrate", tables: number } | { kind: "switch", file: string, why: string, whileOff: string })[]}
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

  return steps;
}
