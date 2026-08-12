// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Is a companion switched on? — **the one place that question is answered.**
//
// ── Why this is `.mjs`, and why it reads nothing ───────────────────────────
// Two separate places need the answer, and only one of them can import
// TypeScript:
//
//   ./disclosure.mjs — this module's Art. 50(1) surface and its `isOn()`, read
//                      by `node run.mjs legal-check` and by `node run.mjs
//                      ai-check` through `lib/ai/disclosure.mjs`. `legal-check`
//                      is given no `needs` deliberately and therefore cannot
//                      import a `.ts`.
//   the app          — whether to render a panel at all.
//
// Copies of one predicate over one file have a named failure mode, and it is
// quiet: the first rename of `config/ai-companion.json`, or the first app that
// writes `"enabled": "true"`, makes each copy answer differently — and the
// loudest symptom is `ai-check` telling every installed app it has no
// product-side call again, with no test anywhere going red.
//
// So the predicate lives here and the others import it. This is not a new
// arrangement: `lib/ai/task-rules.mjs` ↔ `lib/ai/tasks.ts` is the same split for
// the same reason, and its own comment gives it — *"so the app and the
// check-script use the SAME arithmetic, not two that agree today."*
//
// ⚠️ **The core imports this file through the disclosure registry, never by
// path.** `scripts/ai/check.mjs` used to name `lib/ai/companion-config.mjs`
// directly; moving the companion into `modules/` left that import dangling and
// killed `ai-check` outright, with nothing red anywhere. A core file that needs
// this answer asks `DISCLOSURE_SURFACES` for it — the seam this module already
// declares — and `scripts/imports.test.ts` catches the next one that does not.
//
// ⚠️ **Nothing is read in this file.** No `process.env`, no `readFileSync`, no
// `@/` alias — a file that `scripts/ai/check.mjs` imports has none of the three
// available. Everything arrives as an argument, which is also what makes the
// A12 test writable: the config an already-generated app carries is most often
// no file at all, i.e. `undefined`, and a reader that fetches for itself cannot
// be handed that.
//
// ⚠️ **A `.mjs` and a `.ts` never share a stem** (Retro-Action A3/A14). This is
// `companion-config.mjs`, so there is no `companion-config.ts` — the typed shell
// is `modules/companion/switch.ts`, and `switch` is the word AC 9 itself uses.

/**
 * The PRODUCT half of the switch, from whatever was on disk.
 *
 * Everything unreadable is **off**. That is the direction `isChatEnabled()`
 * fails in and the opposite of `billingMode()`, and the reason is the failure
 * mode rather than taste: a wrong billing mode hides a card, a wrong AI switch
 * spends money on an API for every visitor.
 *
 * | `raw` | result |
 * |---|---|
 * | `undefined` — no such file (an already-generated app; and every app during Story 13.1) | off |
 * | `null` — a parse failure the caller turned into `null` | off |
 * | not an object — an array, a string, a number | off |
 * | an object with no `enabled` key | off |
 * | `"true"`, `1`, `"yes"`, `[]` — anything that is not the boolean | off |
 * | `{ "enabled": true }` | **on** (the machine half is still asked separately) |
 */
export function companionConfigFrom(raw) {
  const enabled =
    raw !== null &&
    raw !== undefined &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    raw.enabled === true;

  return { enabled };
}

/**
 * Is a companion live? Both halves passed in, neither read here.
 *
 * `providerConfigured` arrives rather than being looked up, for exactly the
 * reason `task-rules.mjs` gives about `configuredProviders`: this file has no
 * `process.env` and no provider registry, and passing it in is what lets the app
 * and the check-script share one predicate instead of two that agree today.
 *
 * All three have to hold — the product wants it, the machine can do it, and the
 * registry is coherent — the same three-way answer `isChatEnabled()` documents.
 */
export function isCompanionEnabled(raw, providerConfigured, problems = []) {
  return (
    companionConfigFrom(raw).enabled && providerConfigured === true && problems.length === 0
  );
}
