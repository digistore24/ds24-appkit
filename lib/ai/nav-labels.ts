// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What the menu on the left is actually called — for the assistant.
//
// ── Why the model has to be told ───────────────────────────────────────────
// The handbook in `content/knowledge/` is written by the operator, in one
// language, and it is where somebody naturally writes "open *Account* from the
// menu". The app's menu is `messages/de.json` / `messages/en.json`, it is
// bilingual, and it gets renamed. So a label written into the handbook is a
// copy that goes stale in one language on the day it is written and in both on
// the first rename — and Lia has no way of noticing: she repeats what she was
// given, in a language the handbook may not even be in.
//
// The shipped handbook said *Account*, the sidebar says "Mein Konto" and "My
// account", and she sent German customers to a menu entry that does not exist.
//
// So the labels travel with the prompt, from the message files, in every
// language the app speaks — one source of truth, and a rename fixes her too.
// `nav-labels.test.ts` pins the list against `NAVIGATION` in
// `components/app-shell.tsx`, so a sidebar entry added, renamed or reordered
// fails the build rather than quietly teaching her yesterday's menu.
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/config";
import { MODULE_NAV } from "@/lib/modules/nav-registry";
import { MODULE_GATES } from "@/lib/modules/gate-registry";
import { MODULE_MESSAGES } from "@/lib/modules/messages";
import { mergeModuleMessages } from "@/lib/modules/messages-merge";
import de from "@/messages/de.json";
import en from "@/messages/en.json";

/**
 * The entries a MEMBER sees, in sidebar order.
 *
 * Owner-only entries are deliberately absent. She answers customers, and
 * sending one to "Admin" is a dead end for them and a support ticket for the
 * operator. `/dashboard/chat` stays in: an operator who switched her off has
 * no assistant to be asked about it.
 */
export const MEMBER_NAV_KEYS = [
  "overview",
  "account",
  "billing",
  "chat",
  "plans",
] as const;

export type MemberNavKey = (typeof MEMBER_NAV_KEYS)[number];

/**
 * The member-facing labels the installed modules add, in menu order.
 *
 * ⚠️ **A module's entry is named only while its module is switched ON**, and
 * the reasoning is the community's, generalised: the "chat" argument does NOT
 * transfer. Switching the assistant off removes HER; switching a module off
 * leaves her running — and she must not name a menu entry the sidebar hides and
 * whose route answers not-found. She would be sending a customer to a door that
 * does not exist.
 *
 * `ownerOnly` entries are skipped for the same reason the core's are: she
 * answers customers, and sending one to an admin page is a dead end for them
 * and a support ticket for the operator.
 *
 * Static config only — no request, no database — because this lands in the
 * CACHED half of the system prompt.
 */
function moduleMemberNavKeys(): string[] {
  // 🚨 `"on"` exactly — not "anything but off". A module whose config is
  // switched on but malformed still hides its menu entries and still answers
  // not-found on its routes; only the operator's diagnosis page stays
  // reachable, and she is not talking to the operator. `ModuleState` in
  // `lib/modules/gate.ts` is where the three states are argued.
  const on = new Set(
    MODULE_GATES.filter((gate) => gate.state() === "on").map((gate) => gate.id),
  );
  return MODULE_NAV.filter((mod) => on.has(mod.id))
    .flatMap((mod) => mod.NAVIGATION)
    .filter((item) => !item.ownerOnly)
    .map((item) => item.labelKey);
}

/**
 * The entries THIS build actually shows a member.
 *
 * A feature-keyed entry whose feature is off answers not-found on its route —
 * naming it would send a customer to a door that does not exist. The filter
 * reads static config only, so the result is byte-identical on every request
 * of one build — the cacheability rule `navMenus()` lives under.
 */
export function visibleMemberNavKeys(): readonly string[] {
  return [...MEMBER_NAV_KEYS, ...moduleMemberNavKeys()];
}

/** The message files, by locale. A new language is added here as well. */
// ⚠️ MERGED, not `{ de, en }`. A module's nav label lives in ITS message file
// and reaches the app through `mergeModuleMessages` — reading the core files
// alone would resolve every module entry to `undefined` and put a hole in the
// cached prompt.
const MESSAGES = Object.fromEntries(
  LOCALES.map((locale) => [
    locale,
    mergeModuleMessages(
      { de, en }[locale] as unknown as Record<string, unknown>,
      MODULE_MESSAGES[locale] ?? {},
    ),
  ]),
) as Record<Locale, { nav: Record<string, string> }>;

export interface NavMenu {
  locale: Locale;
  /** How the model should name this language — "Deutsch", "English". */
  languageLabel: string;
  /** The menu entries, in the order they appear on screen. */
  labels: readonly string[];
}

/**
 * The menu, per language.
 *
 * ⚠️ This lands in the CACHED half of the system prompt, so it must be
 * byte-identical on every request from every user of this installation — it is
 * read from static imports and an explicit key order for exactly that reason.
 * See the header of `lib/ai/prompt.ts` for what a varying byte costs.
 */
export function navMenus(): NavMenu[] {
  return LOCALES.map((locale) => ({
    locale,
    languageLabel: LOCALE_LABELS[locale],
    labels: visibleMemberNavKeys().map((key) => MESSAGES[locale].nav[key]),
  }));
}
