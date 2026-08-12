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

export interface SetupConfig {
  enabled: boolean;
  /**
   * Tool names allowed to run despite declaring themselves destructive, in
   * STAGING and PROD. A list of names rather than a boolean, so switching one
   * on is a statement about one tool instead of a mood about the surface.
   */
  allowDestructive: string[];
}

export const DEFAULT_SETUP_CONFIG: SetupConfig = {
  enabled: false,
  allowDestructive: [],
};

/**
 * Keys the file may carry. Anything else switches the surface off.
 *
 * Keys beginning with an underscore are comments and are ignored — the
 * convention `config/modules.json` and the module manifests already use
 * (`scripts/modules/manifest.mjs` filters them the same way), so a file can
 * explain itself without that explanation being a syntax error.
 */
const KNOWN_KEYS = new Set(["enabled", "allowDestructive"]);

function fileProblems(file: Record<string, unknown>): string[] {
  const problems: string[] = [];

  for (const key of Object.keys(file)) {
    if (key.startsWith("_") || KNOWN_KEYS.has(key)) continue;
    problems.push(
      `unknown key "${key}" — the surface is off until it is removed, because a ` +
        `misspelt key is more likely a rule somebody meant to write than one they meant to drop`,
    );
  }

  if (file.enabled !== undefined && typeof file.enabled !== "boolean") {
    problems.push('"enabled" must be true or false');
  }

  const allow = file.allowDestructive;
  if (allow !== undefined) {
    if (!Array.isArray(allow) || allow.some((v) => typeof v !== "string" || v.trim() === "")) {
      problems.push('"allowDestructive" must be a list of tool names');
    }
  }

  return problems;
}

/** Everything wrong with the shipped file — empty when it is coherent. */
export function setupConfigProblems(): string[] {
  return fileProblems(raw as Record<string, unknown>);
}

/**
 * The configured surface, or the closed default when anything is wrong.
 *
 * Note that this returns the DEFAULT wholesale on any problem rather than
 * repairing field by field. A file with one unknown key is a file somebody was
 * editing, and half-applying their intent is worse than not applying it.
 */
export function setupConfig(): SetupConfig {
  const file = raw as Record<string, unknown>;
  if (fileProblems(file).length > 0) return DEFAULT_SETUP_CONFIG;

  return {
    enabled: file.enabled === true,
    allowDestructive: Array.isArray(file.allowDestructive)
      ? (file.allowDestructive as string[]).map((v) => v.trim())
      : [],
  };
}

/** The one question every request in front of this surface asks first. */
export function isSetupEnabled(): boolean {
  return setupConfig().enabled;
}

/**
 * Why it is off, for `node run.mjs setup-check` — and for nobody else.
 *
 * ⚠️ This must never reach a caller. While the surface is off it answers 404,
 * deliberately indistinguishable from a route that was never built; a body
 * explaining WHY would hand an outsider the difference for free. The operator
 * asks from the command line, where they are already authenticated by having a
 * shell.
 */
export function setupOffReason(): string | null {
  const problems = setupConfigProblems();
  if (problems.length > 0) return problems[0];
  return isSetupEnabled() ? null : '"enabled" is false in config/setup.json';
}
