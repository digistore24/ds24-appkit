// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The switch in front of operator mail, and the ONE place that reads it.
//
// The shape is `lib/setup/config.ts`'s, down to the underscore-comment rule and
// the whole-file fallback: a static import, a closed set of known keys, and any
// problem at all dropping the file back to the DEFAULT as a unit rather than
// repairing it field by field. A file with one unknown key is a file somebody was
// editing, and half-applying their intent is worse than not applying it.
//
// ── 🚨 The one place this template's house style is departed from ─────────
// `DEFAULT_NOTIFY_CONFIG.enabled` is `false` and the SHIPPED file says `true`.
// That is not a contradiction; it is two different questions with two honest
// answers:
//
//   · *What does a freshly shipped product do?* Be allowed to write to its
//     owner. Every sender that will ever use this channel is itself a scheduled
//     job carrying `enabledByDefault: false` (`modules/community/cron.ts` is the
//     shipped precedent). Two off states in series make a channel nobody ever
//     finds — and the first of them is only findable by reading a config file
//     you do not know exists. The recipient here is the OWNER of the app rather
//     than a customer, so the unwanted-contact risk that makes
//     `config/community.json` and `config/setup.json` ship off does not apply.
//   · *What does an unreadable file mean?* Off. Every doubt falls closed, as
//     everywhere else here.
//
// The price is a shipped JSON that says something other than the code default,
// which is why the file's own `_comment` explains it rather than only this
// header: whoever edits the JSON is not reading this file.

import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";

import raw from "@/config/notifications.json";

export interface NotifyConfig {
  enabled: boolean;
  /**
   * The language operator mail is written in.
   *
   * It is configuration rather than a property of the recipient because there
   * is nowhere else for it: `users` has no locale column (`db/schema-core.ts`),
   * and the app's only other language source is the `NEXT_LOCALE` cookie —
   * which a job, by definition, does not have.
   */
  locale: Locale;
}

/** What the channel is when the file cannot be trusted. Closed, like every other. */
export const DEFAULT_NOTIFY_CONFIG: NotifyConfig = {
  enabled: false,
  locale: DEFAULT_LOCALE,
};

/**
 * Keys the file may carry. Anything else switches the channel off.
 *
 * Keys beginning with an underscore are comments and are ignored — the
 * convention `config/modules.json`, the module manifests and `config/setup.json`
 * already use, so a file can explain itself without that explanation being a
 * syntax error.
 */
const KNOWN_KEYS = new Set(["enabled", "locale"]);

function fileProblems(file: Record<string, unknown>): string[] {
  const problems: string[] = [];

  for (const key of Object.keys(file)) {
    if (key.startsWith("_") || KNOWN_KEYS.has(key)) continue;
    problems.push(
      `unknown key "${key}" — operator mail is off until it is removed, because a ` +
        `misspelt key is more likely a setting somebody meant to write than one they meant to drop`,
    );
  }

  if (file.enabled !== undefined && typeof file.enabled !== "boolean") {
    problems.push('"enabled" must be true or false');
  }

  if (file.locale !== undefined && !isLocale(file.locale)) {
    problems.push(
      '"locale" must be one of the languages in i18n/config.ts (LOCALES) — a code ' +
        "this app has no messages file for would render every sentence as its own key",
    );
  }

  return problems;
}

/** Everything wrong with the shipped file — empty when it is coherent. */
export function notifyConfigProblems(): string[] {
  return fileProblems(raw as Record<string, unknown>);
}

/** The configured channel, or the closed default when anything is wrong. */
export function notifyConfig(): NotifyConfig {
  const file = raw as Record<string, unknown>;
  if (fileProblems(file).length > 0) return DEFAULT_NOTIFY_CONFIG;

  return {
    enabled: file.enabled === true,
    locale: isLocale(file.locale) ? file.locale : DEFAULT_LOCALE,
  };
}

/** The one question `notifyOperators()` asks before anything else. */
export function isOperatorNotifyEnabled(): boolean {
  return notifyConfig().enabled;
}

/** The language operator mail is written in. */
export function operatorLocale(): Locale {
  return notifyConfig().locale;
}

/**
 * Why the channel is silent, for a command line and for a log — never for a
 * caller who is not the operator.
 *
 * The channel writes to the owner of the app, so unlike `setupOffReason()` there
 * is no outsider to keep the difference from; the restraint here is a different
 * one — this string may name a config problem but never a recipient, because it
 * is the sort of line that ends up in `cron_runs`.
 */
export function notifyOffReason(): string | null {
  const problems = notifyConfigProblems();
  if (problems.length > 0) return problems[0];
  return isOperatorNotifyEnabled() ? null : '"enabled" is false in config/notifications.json';
}
