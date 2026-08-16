// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What the App-keys card on `/dashboard/account` shows, as one pure function.
//
// Three separate questions decide it and they are deliberately not one switch:
// is there an API at all (`enabled`), may THIS member use it (`requiresPlan`),
// and may a member mint a key for themselves (`selfService`). An app can want
// any combination — an API for one companion with no card in front of anybody
// is the common one — so the card cannot be derived from `enabled` alone.
//
// ⚠️ **A switch may hide an empty thing, never a non-empty one.** That sentence
// stood in `components/account-card.tsx` while one layer below it was false:
// `keys-ui.tsx` returned early on `offReason` and rendered no table, so a member
// who held keys when the API was switched off could see the card and had no way
// to revoke from it. `readOnly` is that missing third state — the reason this is
// a mode rather than a boolean.
//
// It lives here rather than in `rules.ts` because that file is this module's
// `coreExport` (`module.json`) and travels into every companion repo somebody
// exports. A decision about a web card has no business in a React Native app.
import type { ApiOffReason } from "../api/config";

/** What the account page renders. */
export type KeysCardMode =
  /** Nothing at all — the member has no keys and could not make one. */
  | "hidden"
  /** The list and its revoke buttons, with a notice and no way to create. */
  | "readOnly"
  /** Everything: the endpoint, the counter, create and revoke. */
  | "manage";

/** Why creating is refused. `null` only ever accompanies `manage`. */
export type KeysCardReason = ApiOffReason | "selfServiceOff" | "planRequired" | null;

export interface KeysCardInput {
  /** `apiOffReason()` — null when the API is live. */
  apiOff: ApiOffReason | null;
  /** `apiConfig().selfService`. */
  selfService: boolean;
  /** `requiresPlan === null`, or `hasPlan(member, requiresPlan)`. */
  entitled: boolean;
  /** How many keys of this audience the member holds, revoked ones included. */
  keyCount: number;
}

/**
 * The card's state for one member.
 *
 * The reason is ordered from the widest refusal to the narrowest, because it
 * becomes one sentence and the widest one is the true one: an app whose API is
 * off owes nobody an explanation about plans, and an app that has switched
 * self-service off would otherwise send a member to buy a plan that still gets
 * them no card.
 */
export function keysCardMode(input: KeysCardInput): {
  mode: KeysCardMode;
  reason: KeysCardReason;
} {
  const { apiOff, selfService, entitled, keyCount } = input;

  if (apiOff === null && selfService && entitled) {
    return { mode: "manage", reason: null };
  }

  const reason: KeysCardReason = apiOff ?? (!selfService ? "selfServiceOff" : "planRequired");

  return { mode: keyCount > 0 ? "readOnly" : "hidden", reason };
}
