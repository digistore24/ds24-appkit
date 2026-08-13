// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What a Server Action hands back to the form it came from.
//
// Six `actions.ts` files declared this type verbatim and twelve components
// declared the same empty value beside it. Not a large saving in lines — the
// reason it is worth one file is that this shape is what a customer copies when
// they write their first action, and eighteen declarations teach eighteen
// chances to write a seventh field nobody else knows about.
//
// 🚨 **Nothing is imported here, and that is a rule rather than an accident.**
// Two thirds of the call sites are CLIENT components (`ui.tsx`, `report-button
// .tsx`, `media-slots.tsx`) — they hold `EMPTY_ACTION_STATE` as the initial
// value for `useActionState`. Anything this file imported would be bundled for
// the browser, and the obvious next addition — a shared `toState()` — needs
// `getTranslations` from `next-intl/server`. That is why the tail of `toState`
// is deliberately NOT here; see the note at the foot.

/**
 * The result of a Server Action, as `useActionState` reads it.
 *
 * Exactly one of the two is set at a time. `error` is a finished sentence in
 * the user's language — the ACTION translates a domain code into it, never the
 * layer that threw (`CLAUDE.md` → *Languages*).
 */
export type ActionState = {
  error: string | null;
  ok: string | null;
};

/**
 * The state before anything has been submitted.
 *
 * Handed to `useActionState` as its initial value. It is a shared frozen-by-
 * convention constant rather than an inline literal so that a component cannot
 * accidentally start in a state that already says something.
 */
export const EMPTY_ACTION_STATE: ActionState = { error: null, ok: null };

// ── Why `toState()` is not here ─────────────────────────────────────────────
//
// Fifteen files have one, and their TAILS are identical: `unstable_rethrow`,
// translate, log, return `t("unknown")`. Two things keep it out of this file
// and neither is laziness:
//
//   1. It needs `next-intl/server`, and this module is imported by client
//      components. One module cannot serve both sides.
//   2. The bodies genuinely diverge in the middle — `modules/community/pages/
//      actions.ts` translates `CommunityError` with its cap interpolated and
//      `MediaError` on its own code, because those are member mistakes rather
//      than faults. A base function with an extension point would be a second
//      mechanism to learn for three lines of saving.
//
// What matters about those fifteen is the FIRST line, not the last:
// `unstable_rethrow(error)` before anything else, or a `redirect()` is
// swallowed into "something went wrong". That is a rule, and rules of that kind
// live in `CLAUDE.md` and are held by a test — not by a helper somebody can
// forget to call.
