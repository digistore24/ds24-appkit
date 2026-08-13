// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The in-app assistant — is she there, what is she called, what does she cost.
//
// Two switches, and they are deliberately of different kinds, because they
// answer different questions:
//
//   config/ai-chat.json   — a property of the PRODUCT. Does this app have an
//                           assistant at all, what is her name, which plan (if
//                           any) does she belong to? The same answer in DEV,
//                           STAGING and PROD, and it travels with the repo.
//   the provider's key    — a property of the MACHINE. WHICH key depends on
//                           which provider the `chat` task is bound to
//                           (`config/ai-models.json`), so this file asks the
//                           task rather than naming a company. The key lives in
//                           `.env` (in STAGING/PROD in the hoster's secret
//                           management) and there is deliberately no UI to type
//                           it into — same reasoning as
//                           `lib/digistore/settings.ts`.
//
// Both have to hold for the chat to run. `isChatEnabled()` is the one answer.
//
// ── Where it may be read ───────────────────────────────────────────────────
// Server components, server actions and route handlers. NOT in a client
// component: this module imports the product registry (prices, Digistore24
// product ids) to validate `requiresPlan`, and that JSON has no business in a
// browser bundle — the same treatment `lib/billing-mode.ts` gets. Resolve it on
// the server and pass `name`/`avatar` down as props.
//
// ── The direction it fails in ──────────────────────────────────────────────
// A malformed value switches the chat OFF, and that is the opposite of
// `billingMode()`, which falls back to showing everything. The reason is the
// failure mode, not a difference in taste: a wrong billing mode hides a card,
// a wrong chat config spends money on an API for every visitor. Off is
// recoverable and visible — the page names this file and says what is wrong.
import raw from "@/config/ai-chat.json";
import { allProducts } from "@/lib/digistore/products";
import { bindingFor } from "./tasks";
import { envVarFor, isConfigured } from "./providers/registry";
import { pushEnabledProblem } from "@/lib/config-problems";

export interface ChatConfig {
  enabled: boolean;
  /** Her name. A proper noun — NOT translated, like `APP_NAME`. */
  name: string;
  /** Public path of her picture, served from `public/`. */
  avatar: string;
  /** Product key the chat belongs to, or null for "every signed-in member". */
  requiresPlan: string | null;
  /** Turns of history sent along. Older ones are dropped, oldest first. */
  maxHistoryTurns: number;
  /** Messages one member may send in ten minutes. */
  maxMessagesPer10Min: number;
}

export const DEFAULT_CHAT_CONFIG: ChatConfig = {
  // Off. A config this module could not read is a config nobody meant, and the
  // wrong guess here is billable.
  enabled: false,
  name: "Lia",
  avatar: "/share/chat.png",
  requiresPlan: null,
  maxHistoryTurns: 12,
  maxMessagesPer10Min: 20,
};

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

/**
 * A positive whole number, or the fallback.
 *
 * Bounded at the top as well: a `maxHistoryTurns` of 10000 is not a
 * configuration, it is a way to send the entire conversation on every request
 * until the context window ends the feature with an API error.
 */
function count(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  if (value < 1 || value > max) return fallback;
  return value;
}

/** The configured assistant, with every unreadable field replaced by its default. */
export function chatConfig(): ChatConfig {
  const file = raw as Record<string, unknown>;
  const requiresPlan = file.requiresPlan;

  return {
    enabled: file.enabled === true,
    name: str(file.name, DEFAULT_CHAT_CONFIG.name),
    avatar: str(file.avatar, DEFAULT_CHAT_CONFIG.avatar),
    requiresPlan:
      typeof requiresPlan === "string" && requiresPlan.trim() !== ""
        ? requiresPlan.trim()
        : null,
    maxHistoryTurns: count(file.maxHistoryTurns, DEFAULT_CHAT_CONFIG.maxHistoryTurns, 100),
    maxMessagesPer10Min: count(
      file.maxMessagesPer10Min,
      DEFAULT_CHAT_CONFIG.maxMessagesPer10Min,
      1000,
    ),
  };
}

/**
 * Is the provider that runs the `chat` task configured on this machine?
 *
 * ⚠️ This used to ask about `ANTHROPIC_API_KEY` specifically, and that was
 * right when the assistant could only talk to one company. It is now WRONG: the
 * `chat` task may be bound to any of the five, and an app whose assistant runs
 * on Gemini would have been declared "not connected" for want of a key it never
 * needed. The question is about the task's provider, and only the task knows
 * which that is.
 *
 * Found by `lib/ai/providers/leak-guard.test.ts` during the migration rather
 * than by a customer, which is the entire argument for that test existing.
 */
export function hasChatProviderKey(): boolean {
  return isConfigured(bindingFor("chat").provider);
}

/** Which key is missing, for the notice on the page. Never the key itself. */
export function chatProviderEnvVar(): string {
  return envVarFor(bindingFor("chat").provider);
}

/**
 * WHICH company her task is bound to, for the notice on the page.
 *
 * The env var above says what is missing; this says why that one. An Operator
 * who put a key in `.env` and got no assistant is holding a correct key for the
 * wrong company — `config/ai-models.json` binds `chat` to somebody else — and
 * "MISTRAL_API_KEY is set, ANTHROPIC_API_KEY is missing" is a sentence they can
 * act on where "add ANTHROPIC_API_KEY" alone reads as a contradiction of what
 * they just did.
 */
export function chatProviderId(): string {
  return bindingFor("chat").provider;
}

/**
 * Everything wrong with the shipped config — empty when it is coherent.
 *
 * The same job `contradictingProducts()` does for the billing mode: a second
 * source of truth is only safe while something checks it against the first.
 * `lib/ai/chat-config.test.ts` fails the build on a non-empty result, so a
 * `requiresPlan` naming a product that does not exist is caught here and not by
 * `hasPlan()` throwing "unknown product key" on the customer's first message.
 */
export function chatConfigProblems(): string[] {
  const config = chatConfig();
  const problems: string[] = [];
  const file = raw as Record<string, unknown>;

  pushEnabledProblem(problems, file);
  // Two leftovers from before the provider layer, and both are worth naming
  // rather than ignoring: an Operator who edited either field is holding a
  // belief about how their assistant runs, and neither is true any more. A
  // setting that silently does nothing is worse than one that is absent — the
  // person went looking for it, found it, changed it, and was not corrected.
  for (const [field, moved] of [
    ["model", "config/ai-models.json → tasks.chat.model"],
    ["cacheTtl", "config/ai-models.json → tasks.chat.providerOptions.cacheTtl"],
  ] as const) {
    if (file[field] !== undefined) {
      problems.push(
        `"${field}" no longer belongs here — it moved to ${moved}. ` +
          "Set it there and delete this line; leaving it does nothing.",
      );
    }
  }

  if (config.requiresPlan !== null) {
    // A token package can never satisfy this: `hasPlan()` answers false for one
    // for ever, so gating the chat on it would lock out the very customers who
    // paid. Refuse the config rather than the customer.
    const plan = allProducts().find((p) => p.key === config.requiresPlan);
    if (!plan) {
      problems.push(
        `"requiresPlan": no product "${config.requiresPlan}" in config/digistore-products.json`,
      );
    } else if (plan.kind === "token") {
      problems.push(
        `"requiresPlan": "${config.requiresPlan}" is a token package — a balance is not an entitlement, so hasPlan() answers false for it for ever`,
      );
    }
  }

  return problems;
}

/**
 * Is the chat live on this installation?
 *
 * All three have to hold, and the page says which one does not:
 *   1. the product wants it   (`config/ai-chat.json` → `enabled`)
 *   2. the machine can do it  (a key for the provider her task resolves to —
 *                              any one of the five while it is on `"auto"`)
 *   3. the config is coherent (`chatConfigProblems()`)
 *
 * This answers "is the feature there", NOT "may this person use it". The second
 * question is `requiresPlan` plus `hasPlan(memberId, productKey)` from
 * `lib/entitlements/manage.ts`, and it is asked per member — see
 * `app/api/chat/route.ts`.
 */
export function isChatEnabled(): boolean {
  return chatConfig().enabled && hasChatProviderKey() && chatConfigProblems().length === 0;
}

/**
 * Why the chat is off — for the notice on the page. `null` when it is on.
 *
 * Deliberately a code, not a sentence: this module has no language (AD-10). The
 * page translates it through the `chat` namespace.
 */
export type ChatOffReason = "disabledInConfig" | "noApiKey" | "brokenConfig";

export function chatOffReason(): ChatOffReason | null {
  if (!chatConfig().enabled) return "disabledInConfig";
  if (chatConfigProblems().length > 0) return "brokenConfig";
  if (!hasChatProviderKey()) return "noApiKey";
  return null;
}
