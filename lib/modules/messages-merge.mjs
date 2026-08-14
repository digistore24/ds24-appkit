// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// How a module's texts join the core's — and the one place a shallow spread
// would have destroyed them.
//
// A module owns whole top-level namespaces, named after itself, and those are
// merged by replacement: `loadModules()` refuses two modules claiming one, and
// the manifest refuses a namespace that does not start with the module's id, so
// no collision is possible.
//
// ── 🚨 Two namespaces are SHARED, and they are not optional ────────────────
// A refusal reaches a member as `t(`errors.${code}`)` and a menu entry as
// `t(labelKey)` under `nav` — both look in a namespace that belongs to the
// CORE. A module that returns error codes has to put them there; there is no
// other place the delivery layer looks.
//
// A shallow spread would therefore replace the core's whole `errors` object
// with the module's two or three keys, and every refusal in the app — token
// balances, sign-in, media uploads — would render as its raw key. Measured
// before this file existed:
//
//     {...{errors:{a,b}}, ...{errors:{activityFoo}}}  ->  {errors:{activityFoo}}
//
// So the shared ones are merged one level deep, and `scripts/modules/
// messages.test.ts` insists every key a module adds inside them starts with the
// module's id — the same collision rule the owned namespaces get from their
// name.
//
// ── Why this is `.mjs` with the `.ts` next to it re-exporting ──────────────
// Two callers with nothing in common need the same rule. The app reaches it as
// TypeScript through `i18n/catalogue.ts`; `node run.mjs legal-check` reaches it
// from `scripts/legal/check.mjs`, which is given NO `needs` on purpose
// (`lib/ai/disclosure.mjs` explains why) and so cannot import TypeScript at all.
// While that was impossible, `legal-check` read `messages/<locale>.json` and
// nothing else — and reported an Art. 50 violation in every app with the
// `companion` module installed, because a module's disclosure notice lives in
// its own catalogue. A second merge written in `.mjs` would have been two
// copies of this rule; this is one, imported twice.

/**
 * Namespaces a module may add keys to rather than own.
 *
 * Deliberately short and deliberately closed. Each entry is a namespace the
 * DELIVERY layer looks in by a computed key, which is what makes it impossible
 * for a module to use a namespace of its own:
 *
 * - `errors` — `t(`errors.${code}`)` in every action that returns a code
 * - `nav`    — `t(item.labelKey)` in the app shell
 *
 * Adding a third is a decision about the core, not about a module: it means
 * some other part of the app looks up a key it computes, and that is worth
 * knowing before a module is allowed to write into it.
 *
 * @type {readonly string[]}
 */
export const SHARED_NAMESPACES = ["errors", "nav"];

/**
 * The core catalogue plus every installed module's, for one locale.
 *
 * @param {Record<string, unknown>} core     the app's own `messages/<locale>.json`
 * @param {Record<string, unknown>} modules  that locale's module catalogue
 * @returns {Record<string, unknown>}
 */
export function mergeModuleMessages(core, modules) {
  const merged = { ...core };

  for (const [namespace, value] of Object.entries(modules)) {
    if (!SHARED_NAMESPACES.includes(namespace)) {
      // An owned namespace. Nothing of the core's can be under this name — the
      // manifest saw to that — so replacing is the whole operation.
      merged[namespace] = value;
      continue;
    }

    // A shared one. Merge INTO the core's object rather than over it.
    const before = merged[namespace];
    merged[namespace] =
      before && typeof before === "object" && !Array.isArray(before)
        ? { ...before, ...value }
        : value;
  }

  return merged;
}
