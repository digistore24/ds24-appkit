// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The companion switch, with types on and the two things the `.mjs` cannot see.
//
// ── Why this file is called `companion-switch` and not `companion-config` ──
// **A `.mjs` and a `.ts` never share a stem** (Retro-Action A3/A14). The
// predicate lives in `modules/companion/config.mjs`, because `scripts/ai/check.mjs`
// and `lib/ai/disclosure.mjs` have to reach it and neither can import
// TypeScript — so a `companion-config.ts` beside it would make
// `import … from "@/lib/ai/companion-config"` resolve to the `.mjs` at runtime while the
// compiler read the `.ts`. That is a green typecheck and a
// `… is not a function` in the browser, and it is a bug this project has already
// had once.
//
// `switch` is AC 9's own word: *"when the switch is read"*, *"a malformed value
// counts as off"*. Do not rename this back.
//
// ── Two switches, and they are different kinds of thing ────────────────────
//   config/ai-companion.json — a property of the PRODUCT. Does this app work
//                              alongside its customer at all? Travels with the
//                              repo, same answer in DEV, STAGING and PROD.
//   the provider's key       — a property of the MACHINE. WHICH key depends on
//                              what the `companion` task is bound to, so this
//                              file asks the task rather than naming a company.
//
// Exactly the arrangement `lib/ai/chat-config.ts` documents for the assistant.
//
// ── Where it may be read ───────────────────────────────────────────────────
// Server components, server actions, route handlers. NOT a client component:
// it imports the product registry to validate `requiresPlan`, and that JSON has
// no business in a browser bundle.
import raw from "@/config/ai-companion.json";
import { allProducts } from "@/lib/digistore/products";
import { companionConfigFrom, isCompanionEnabled as enabledFrom } from "./config.mjs";
import {
  MAX_COMPANION_HISTORY_TURNS,
  MAX_COMPANION_INPUT_CHARS,
  companionHistoryTurns,
  companionInputChars,
} from "./rules";
import { MAX_TOKEN_AMOUNT } from "@/lib/tokens/rules";
import { COMPANIONS } from "./companions";
import { bindingFor } from "@/lib/ai/tasks";
import { envVarFor, isConfigured } from "@/lib/ai/providers/registry";

export interface CompanionConfig {
  enabled: boolean;
}

/** The product half, with every unreadable value read as off. */
export function companionConfig(): CompanionConfig {
  return companionConfigFrom(raw);
}

/** Is there a key for whichever company the `companion` task resolves to? */
function hasCompanionProviderKey(): boolean {
  return isConfigured(bindingFor("companion").provider);
}

/** The environment variable this installation needs, for the notice on the page. */
export function companionEnvVar(): string {
  return envVarFor(bindingFor("companion").provider);
}

/**
 * What is wrong with the registry — the same job `chatConfigProblems()` does.
 *
 * A second source of truth is only safe while something checks it against the
 * first, and `companion-config.test.ts` fails the build on a non-empty result
 * against the shipped registry. So a `requiresPlan` naming a product that does
 * not exist is caught here rather than by `hasPlan()` throwing *"unknown product
 * key"* at the customer's first message.
 */
export function companionProblems(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const products = allProducts();

  for (const companion of COMPANIONS) {
    // The id is half the conversation key, and `conversationIdFor()` splits on
    // the first colon. An id carrying one would let two different companions
    // resolve to one conversation — and two customers' turns into one history.
    if (!/^[a-z0-9-]{1,40}$/.test(companion.id)) {
      problems.push(
        `companion "${companion.id}": id must match /^[a-z0-9-]{1,40}$/ — it is half the conversation key`,
      );
    }
    if (seen.has(companion.id)) {
      problems.push(`companion "${companion.id}": duplicate id — two entries would share one conversation`);
    }
    seen.add(companion.id);

    // 🚨 The price, and it was missing from the first draft of this function.
    // `costsTokens` is only ever compared with `> 0`, so a negative or a NaN
    // makes the companion **silently free**; and a fraction or a number above
    // the ceiling passes both `> 0` and `hasSufficientBalance`, lets the model
    // call run and be paid for, and only then makes `spendTokens` throw a plain
    // `Error` — which is deliberately not a `TokenError` and therefore not
    // translatable. Refuse the config, exactly as the `requiresPlan` rules below
    // do, rather than the customer at their first click.
    if (
      typeof companion.costsTokens !== "number" ||
      !Number.isInteger(companion.costsTokens) ||
      companion.costsTokens < 0 ||
      companion.costsTokens > MAX_TOKEN_AMOUNT
    ) {
      problems.push(
        `companion "${companion.id}": "costsTokens" must be a whole number between 0 and ${MAX_TOKEN_AMOUNT} (0 = not metered)`,
      );
    }

    // Both ceilings are clamped rather than refused at read time, so a wrong
    // number does not break the feature — but a wrong number is still somebody
    // believing something about their app that is not true, and a setting that
    // silently does nothing is worse than one that is absent.
    if (companion.maxInputChars !== undefined && companionInputChars(companion.maxInputChars) !== companion.maxInputChars) {
      problems.push(
        `companion "${companion.id}": "maxInputChars" must be a whole number between 1 and ${MAX_COMPANION_INPUT_CHARS} — ${String(companion.maxInputChars)} is ignored`,
      );
    }
    if (companion.maxHistoryTurns !== undefined && companionHistoryTurns(companion.maxHistoryTurns) !== companion.maxHistoryTurns) {
      problems.push(
        `companion "${companion.id}": "maxHistoryTurns" must be a whole number between 1 and ${MAX_COMPANION_HISTORY_TURNS} — ${String(companion.maxHistoryTurns)} is ignored`,
      );
    }

    if (companion.instruction.trim() === "") {
      problems.push(`companion "${companion.id}": "instruction" is empty — it is the cacheable block, and an empty one is a companion with no character`);
    }

    if (companion.requiresPlan !== null) {
      const plan = products.find((product) => product.key === companion.requiresPlan);
      if (!plan) {
        problems.push(
          `companion "${companion.id}": "requiresPlan" names no product "${companion.requiresPlan}" in config/digistore-products.json`,
        );
      } else if (plan.kind === "token") {
        // `hasPlan()` answers false for a balance for ever, so gating on one
        // locks out exactly the customers who paid. Refuse the config, not the
        // customer.
        problems.push(
          `companion "${companion.id}": "requiresPlan": "${companion.requiresPlan}" is a token package — a balance is not an entitlement, so hasPlan() answers false for it for ever`,
        );
      }
    }
  }

  return problems;
}

/**
 * Is a companion live on this installation?
 *
 * All three have to hold — the product wants it, the machine can do it, and the
 * registry is coherent. This answers *"is the feature there"*, never *"may this
 * person use it"*: that second question is the entry's `requiresPlan` plus
 * `hasPlan(memberId, productKey)`, asked per member in
 * `modules/companion/actions.ts`.
 */
export function isCompanionEnabled(): boolean {
  return enabledFrom(raw, hasCompanionProviderKey(), companionProblems());
}

/** Why it is off, as a code and never a sentence (AD-10). `null` when it is on. */
export type CompanionOffReason = "disabledInConfig" | "noApiKey" | "brokenConfig";

export function companionOffReason(): CompanionOffReason | null {
  if (!companionConfig().enabled) return "disabledInConfig";
  if (companionProblems().length > 0) return "brokenConfig";
  if (!hasCompanionProviderKey()) return "noApiKey";
  return null;
}
