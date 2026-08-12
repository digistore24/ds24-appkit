// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The HTTP API — is it there at all, and who may reach it.
//
// The same shape as `lib/ai/chat-config.ts`, for the same reason: one switch,
// a property of the PRODUCT. The API calls nothing outward, so there is no
// machine-level prerequisite and nothing to configure per environment — the
// only question is whether this app offers `/api/v1` to its members' own
// programs (typically a mobile app). See `docs/api.md`.
//
// ── It ships OFF ───────────────────────────────────────────────────────────
// An API nobody decided to offer is attack surface, not convenience. Turning
// it on is the moment somebody has decided their app HAS an external client —
// which is what the `mobile-companion` skill walks through. An unreadable
// config resolves to OFF: the failure mode of this file is an open endpoint,
// so every parse problem falls towards "closed".
//
// ── Where it may be read ───────────────────────────────────────────────────
// Server components, Server Actions, route handlers. NOT a client component:
// it imports the product registry to validate `requiresPlan`, and prices and
// Digistore24 product ids have no business in a browser bundle — the same rule
// `lib/billing-mode.ts` and `lib/ai/chat-config.ts` follow.
import raw from "@/config/api.json";
import { allProducts } from "@/lib/digistore/products";

export interface ApiConfig {
  enabled: boolean;
  /** Product key the API belongs to, or null for every member. */
  requiresPlan: string | null;
}

export const DEFAULT_API_CONFIG: ApiConfig = {
  // Off. See the note at the top of this file — an unreadable config must not
  // resolve to an open endpoint.
  enabled: false,
  requiresPlan: null,
};

/** The configured API, with every unreadable field replaced by its default. */
export function apiConfig(): ApiConfig {
  const file = raw as Record<string, unknown>;
  const requiresPlan = file.requiresPlan;

  return {
    enabled: file.enabled === true,
    requiresPlan:
      typeof requiresPlan === "string" && requiresPlan.trim() !== ""
        ? requiresPlan.trim()
        : null,
  };
}

/**
 * Everything wrong with the shipped config — empty when it is coherent.
 *
 * `modules/api/api/config.test.ts` fails the build on a non-empty result. The point is
 * that a `requiresPlan` naming a product that does not exist is caught here,
 * at build time, and not by `hasPlan()` throwing "unknown product key" against
 * a customer's first request — where the error reaches their app, not a person.
 */
export function apiConfigProblems(): string[] {
  const config = apiConfig();
  const problems: string[] = [];
  const file = raw as Record<string, unknown>;

  if (file.enabled !== undefined && typeof file.enabled !== "boolean") {
    problems.push('"enabled" must be true or false');
  }

  if (config.requiresPlan !== null) {
    const plan = allProducts().find((p) => p.key === config.requiresPlan);
    if (!plan) {
      problems.push(
        `"requiresPlan": no product "${config.requiresPlan}" in config/digistore-products.json`,
      );
    } else if (plan.kind === "token") {
      // The same refusal the chat's `requiresPlan` gets, and for the same
      // reason: a balance is not an entitlement, so `hasPlan()` answers false
      // for a token package for ever. Gating on one locks out the customers
      // who paid.
      problems.push(
        `"requiresPlan": "${config.requiresPlan}" is a token package — a balance is not an entitlement, so hasPlan() answers false for it for ever`,
      );
    }
  }

  return problems;
}

/**
 * Is the HTTP API live on this installation?
 *
 * This answers "is the feature there", NOT "may this person use it". The second
 * question is `requiresPlan` plus `hasPlan(memberId, productKey)` from
 * `lib/entitlements/manage.ts`, asked per member on every request — see
 * `modules/api/api/guard.ts`.
 */
export function isApiEnabled(): boolean {
  return apiConfig().enabled && apiConfigProblems().length === 0;
}

/** Why it is off — for the notice on the account page. `null` when it is on. */
export type ApiOffReason = "disabledInConfig" | "brokenConfig";

export function apiOffReason(): ApiOffReason | null {
  if (!apiConfig().enabled) return "disabledInConfig";
  if (apiConfigProblems().length > 0) return "brokenConfig";
  return null;
}
