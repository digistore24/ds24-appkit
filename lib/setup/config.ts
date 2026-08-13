// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The switch in front of the setup surface, and the ONE place that reads it.
//
// 🚨 Read it through `isSetupEnabled()` and never by re-reading the JSON. The
// rule is the one `isApiEnabled()` and `isCommunityEnabled()` already follow,
// and the reason is sharper here than for either: the failure mode of this
// switch is an open write endpoint on a production database. So every doubt
// falls towards closed — an unreadable file, an unknown key, a wrong type and
// an out-of-range value all mean OFF.
//
// ⚠️ Note which direction that is. `installedModules()` deliberately THROWS on
// a malformed file rather than resolving to "nothing", because it answers "what
// is this app made of" and guessing empty hides tables the app still holds.
// This answers "should this run", and guessing no closes a door. Two questions,
// two directions, and neither is a mistake.
//
// There is no runtime toggle and no admin setting: switching this on is a
// DEPLOY. A switch that lives in the database is one that whoever reached the
// database can turn, and the deploy is the incident response.

import raw from "@/config/setup.json";

// 🚨 The READING of that file is `./config-shape.mjs`, and this file only ever
// applies it to the app's own JSON. It was two readings until 2026-08-13:
// `scripts/setup/check.mjs` could not import this one — a `.mjs` cannot import a
// `.ts` — so it carried a copy, and the copy had already drifted. Its own head
// carries the measurement.
export {
  DEFAULT_SETUP_CONFIG,
  setupConfigFrom,
  setupOffReasonFrom,
  setupProblemsFrom,
} from "./config-shape.mjs";

import {
  setupConfigFrom as configFrom,
  setupOffReasonFrom as offReasonFrom,
  setupProblemsFrom as problemsFrom,
} from "./config-shape.mjs";

export interface SetupConfig {
  enabled: boolean;
  /**
   * Tool names allowed to run despite declaring themselves destructive, in
   * STAGING and PROD. A list of names rather than a boolean, so switching one
   * on is a statement about one tool instead of a mood about the surface.
   */
  allowDestructive: string[];
}

/** Everything wrong with THIS app's file — empty when it is coherent. */
export function setupConfigProblems(): string[] {
  return problemsFrom(raw);
}

/**
 * The configured surface, or the closed default when anything is wrong.
 *
 * Note that this returns the DEFAULT wholesale on any problem rather than
 * repairing field by field. A file with one unknown key is a file somebody was
 * editing, and half-applying their intent is worse than not applying it.
 */
export function setupConfig(): SetupConfig {
  return configFrom(raw);
}

/** The one question every request in front of this surface asks first. */
export function isSetupEnabled(): boolean {
  return setupConfig().enabled;
}

/**
 * Why THIS app's surface is off — for the command line, and for nobody else.
 *
 * ⚠️ This must never reach a caller. While the surface is off it answers 404,
 * deliberately indistinguishable from a route that was never built; a body
 * explaining WHY would hand an outsider the difference for free. The operator
 * asks from the command line, where they are already authenticated by having a
 * shell.
 *
 * ⚠️ **It had no caller at all until 2026-08-13, and that was a finding
 * rather than a design.** `node run.mjs setup-check` — the command this exists
 * for — re-implemented the rule with its own `JSON.parse` and its own copy of
 * the known-key set, and that copy had already drifted: it printed
 * `allowDestructive` without ever checking its shape, so
 * `{"enabled": true, "allowDestructive": "media_upload"}` made the command say
 * `✓ enabled` about a file this reader throws away whole. Both now read
 * `./config-shape.mjs`, and `scripts/setup/check.mjs` calls this question by its
 * pure name.
 */
export function setupOffReason(): string | null {
  const reason = offReasonFrom(raw);
  return reason === null ? null : `config/setup.json: ${reason}`;
}
