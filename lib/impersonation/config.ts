// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// May an Operator sign in as one of their customers at all?
//
// One switch, a property of the PRODUCT — the same answer in DEV, STAGING and
// PROD, and it travels with the repo. The same shape as `isChatEnabled()`
// (lib/ai/chat-config.ts) and `isApiEnabled()` (lib/api/config.ts): read it
// through the function, never by re-reading the JSON at a call site.
//
// ── It ships ON ────────────────────────────────────────────────────────────
// The opposite of `config/api.json`, and for a reason worth stating. An
// enabled API is attack surface an Operator never decided on, so off is its
// safe shipped state. This feature exposes nothing until an Operator clicks
// it, the Operator is a single trusted person on their own app, and the
// alternative to having it is the email-swap workaround — which is worse in
// every way. A capability
// nobody discovers protects nobody.
//
// An installation that must not have it sets `"enabled": false` and the
// capability is gone: the menu entry disappears AND the server action refuses
// (FR-75). The menu is cosmetics; a Server Action is an HTTP endpoint of its
// own.
//
// ── The direction it fails in ──────────────────────────────────────────────
// A malformed value counts as OFF. The same direction as the assistant and for
// a sharper reason: the failure mode here is an auth bypass. `enabled === true`
// is an exact comparison, so `"true"`, `1`, `"yes"` and a missing file all
// leave the feature switched off rather than guessing what somebody meant.
import raw from "@/config/impersonation.json";
import { pushEnabledProblem } from "@/lib/config-problems";

export interface ImpersonationConfig {
  enabled: boolean;
}

export const DEFAULT_IMPERSONATION_CONFIG: ImpersonationConfig = {
  // Off. A config this module could not read is a config nobody meant, and the
  // wrong guess here lets somebody into a customer's account.
  enabled: false,
};

/** Everything wrong with the shipped config — empty when it is coherent. */
export function impersonationConfigProblems(): string[] {
  const file = raw as Record<string, unknown>;
  const problems: string[] = [];
  pushEnabledProblem(problems, file);
  return problems;
}

/**
 * Is signing in as a user available on this installation?
 *
 * This answers "does the feature exist here", NOT "may this person use it".
 * The second question is `canImpersonate()` in lib/users/rules.ts, and it is
 * asked per Operator and per target.
 */
export function isImpersonationEnabled(): boolean {
  const file = raw as Record<string, unknown>;
  if (impersonationConfigProblems().length > 0) {
    return DEFAULT_IMPERSONATION_CONFIG.enabled;
  }
  return file.enabled === true;
}
