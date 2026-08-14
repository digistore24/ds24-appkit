// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The typed face of the merge rule. **The rule itself, and every word of the
// reasoning behind it, is in `messages-merge.mjs` next to this file** — this is
// a re-export and nothing else.
//
// Why the split: `node run.mjs legal-check` (`scripts/legal/check.mjs`) needs
// the same merge and is deliberately given no way to import TypeScript, so the
// implementation has to be plain `.mjs`. Everything in the app keeps importing
// `@/lib/modules/messages-merge` and is untouched by that.
//
// 🚨 Do not reimplement anything here. A second copy of this rule is exactly
// what the `.mjs` file exists to prevent.
import {
  SHARED_NAMESPACES as SHARED,
  mergeModuleMessages as merge,
} from "./messages-merge.mjs";

/** @see messages-merge.mjs — the namespaces a module may add keys to. */
export const SHARED_NAMESPACES = SHARED as readonly ["errors", "nav"];

type Catalogue = Record<string, unknown>;

/**
 * The core catalogue plus every installed module's, for one locale.
 *
 * @param core the app's own `messages/<locale>.json`
 * @param modules that locale's entry from the generated `MODULE_MESSAGES`
 */
export const mergeModuleMessages: (
  core: Catalogue,
  modules: Catalogue,
) => Catalogue = merge;
