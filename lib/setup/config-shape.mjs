// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What `config/setup.json` MEANS — one reading of it, for the app and for the
// command line.
//
// ── Why this is `.mjs`, and why it does not read the file ──────────────────
// Two places answer "is the setup surface on, and is this file coherent", and
// only one of them can import TypeScript:
//
//   lib/setup/config.ts       — the app, on every request in front of the surface
//   scripts/setup/check.mjs   — `node run.mjs setup-check`, the diagnosis
//
// It was two readings until 2026-08-13, and they had already diverged. The
// script carried its own `known` set, its own unknown-key filter and its own
// `enabled` predicate — and printed `allowDestructive` without ever checking its
// SHAPE. Measured against both readers:
//
//     { "enabled": true, "allowDestructive": "media_upload" }
//
// made `setup-check` say `✓ enabled` about a file the app throws away whole. The
// one command whose entire job is to tell an operator where the surface stands
// told them the opposite, on the question the surface exists for.
//
// That is the failure `modules/companion/config.mjs` describes in its own head
// and `lib/setup/key.mjs` closed for the key arithmetic one commit earlier: two
// answers that agree today. Same split, same reason.
//
// ⚠️ **The stem is `config-shape`, not `config`.** A `config.mjs` beside
// `config.ts` is a shared stem, and `lib/setup/guard.ts` imports `"./config"`
// with no extension — Node would resolve that to the `.mjs` at runtime while the
// compiler read the `.ts`. `template/docs/conventions.md` → *A `.mjs` beside a
// `.ts`* names the two shapes where a shared stem is allowed; this is not one of
// them, because the `.ts` here is more than a re-export.
//
// ⚠️ Nothing is read in this file. No `process.env`, no `readFileSync`, no `@/`
// alias — a file `scripts/` imports has none of the three available. Everything
// arrives as an argument, which is also what makes the fixtures writable.

/**
 * @typedef {object} SetupConfig
 * @property {boolean} enabled
 * @property {string[]} allowDestructive  tool names allowed to run despite
 *   declaring themselves destructive, in STAGING and PROD. A list of names
 *   rather than a boolean, so switching one on is a statement about one tool
 *   instead of a mood about the surface.
 */

/** @type {SetupConfig} */
export const DEFAULT_SETUP_CONFIG = {
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

/**
 * Everything wrong with a setup config — from whatever was on disk.
 *
 * ⚠️ **It takes its input rather than fetching it, and that is what makes it
 * testable.** The assertion *"this ships OFF"* is a claim about the TEMPLATE,
 * but the test carrying it runs in the CUSTOMER's app, where switching the
 * surface on is a documented step. A reader that opens the file for itself
 * cannot be handed a fixture, so the only way to write that test was against the
 * real file — and then a customer who followed the instructions had a red suite
 * and a `.githooks/pre-commit` that refused every commit. The shipped position
 * itself is asserted in the source repo, where the template is pristine by
 * construction.
 *
 * The `undefined` / `null` contract is `switchStateFrom()`'s and
 * `companionConfigFrom()`'s, deliberately: `undefined` is "no such file",
 * `null` is "the caller could not parse it". Both are a problem, and therefore
 * off — never an ordinary `false`.
 *
 * @param {unknown} raw
 * @returns {string[]}
 */
export function setupProblemsFrom(raw) {
  // ⚠️ These three name no FILE, deliberately. This function takes whatever it
  // is handed, so a sentence naming `config/setup.json` would be wrong for every
  // other input — and the caller that knows the file is where it is named.
  // `switchStateFrom()` draws the same line for the same reason.
  if (raw === undefined) return ["no such file"];
  if (raw === null) return ["unreadable"];
  if (typeof raw !== "object" || Array.isArray(raw)) return ["not an object"];

  const file = /** @type {Record<string, unknown>} */ (raw);
  const problems = [];

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

/**
 * The configured surface, or the closed default when anything is wrong.
 *
 * Note that this returns the DEFAULT wholesale on any problem rather than
 * repairing field by field. A file with one unknown key is a file somebody was
 * editing, and half-applying their intent is worse than not applying it.
 *
 * @param {unknown} raw
 * @returns {SetupConfig}
 */
export function setupConfigFrom(raw) {
  // ⚠️ A COPY of the default, never the constant itself. `SetupConfig` carries a
  // mutable array, so handing out the shared object lets one caller's
  // `allowDestructive.push(…)` poison the closed default for the rest of the
  // process — and every later broken file would then read as that mutation.
  // Cheap insurance at the one boundary where the wrong answer is an open write
  // endpoint.
  if (setupProblemsFrom(raw).length > 0) {
    return { enabled: DEFAULT_SETUP_CONFIG.enabled, allowDestructive: [] };
  }

  const file = /** @type {Record<string, unknown>} */ (raw);
  return {
    enabled: file.enabled === true,
    allowDestructive: Array.isArray(file.allowDestructive)
      ? file.allowDestructive.map((v) => String(v).trim())
      : [],
  };
}

/**
 * Why a surface is off, from whatever was on disk — `null` when it is on.
 *
 * The sentence itself is testable because the answer depends on the POSITION of
 * a switch, which in a customer's app is theirs to set.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
export function setupOffReasonFrom(raw) {
  const problems = setupProblemsFrom(raw);
  if (problems.length > 0) return problems[0];
  if (setupConfigFrom(raw).enabled) return null;
  // ⚠️ A missing key is not a `false` one. `"enabled" is false` about a file
  // that never held the word sends somebody looking for a line to change, and
  // the honest instruction is to add it. `switchStateFrom()` draws the same
  // distinction (`no "enabled" key`) and this one used to flatten it.
  return Object.prototype.hasOwnProperty.call(raw, "enabled")
    ? '"enabled" is false'
    : 'there is no "enabled" key';
}
