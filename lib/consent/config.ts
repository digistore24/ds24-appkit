// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Which purposes this app asks consent for.
//
// Read it through `consentPurposes()`, never by re-reading the JSON — the same
// rule `lib/ai/chat-config.ts`, `lib/api/config.ts` and `lib/billing-mode.ts`
// follow. One reader means one place where a malformed file is handled, and
// one place to change when the shape grows.
//
// ── It ships empty, and that is the correct state ──────────────────────────
// `{"purposes": []}`. This app collects no consent because it needs none: a
// purchase runs on Art. 6(1)(b), and the three cookies it sets are strictly
// necessary or set by the user's own click. **Do not add a purpose to make the
// app look thorough.** A dialog asking permission you neither need nor use
// teaches people to click past the one that will later matter, and under
// § 25 TDDDG a banner where no device access happens is a defect rather than
// caution. `docs/compliance.md` §2 spells this out.
//
// A purpose is declared here when the app grows something that genuinely needs
// one — an analytics tag, a marketing mail, a transfer beyond what the product
// requires.
//
// ── A broken file means NO purposes ────────────────────────────────────────
// Fail-closed, and note which direction that is: unreadable config resolves to
// "we have no consent for anything", so features gated on one stay off. The
// opposite default would have an app processing on a consent it cannot show.
// This is the same direction `config/ai-chat.json` fails and the opposite of
// `billingMode()`, where the risk being managed is a bill rather than a basis.
//
// ── Where it may be read ───────────────────────────────────────────────────
// Server components, Server Actions, route handlers. The purposes themselves
// carry no secret, so a client component receiving them as props is fine — but
// it receives them, it does not import this file.
import raw from "@/config/consent.json";
import {
  isValidPurposeKey,
  isValidTextVersion,
  type ConsentPurpose,
} from "./rules";

/**
 * The declared purposes, in file order, with the unusable ones dropped.
 *
 * Dropped rather than repaired: a purpose whose key does not survive a database
 * column, a translation key and a JSON file is not a purpose, and guessing what
 * was meant would attach real consents to an invented id.
 */
export function consentPurposes(): ConsentPurpose[] {
  const file = raw as Record<string, unknown>;
  const declared = Array.isArray(file.purposes) ? file.purposes : [];

  const seen = new Set<string>();
  const purposes: ConsentPurpose[] = [];

  for (const entry of declared) {
    if (typeof entry !== "object" || entry === null) continue;
    const { key, textVersion } = entry as Record<string, unknown>;
    if (!isValidPurposeKey(key)) continue;
    if (!isValidTextVersion(textVersion)) continue;
    // A duplicate key would make `currentConsent` answer for whichever copy the
    // loop reached last — silently, and differently after a reorder.
    if (seen.has(key)) continue;
    seen.add(key);
    purposes.push({ key, textVersion: textVersion.trim() });
  }

  return purposes;
}

/** One declared purpose by key, or `null`. */
export function consentPurpose(key: string): ConsentPurpose | null {
  return consentPurposes().find((purpose) => purpose.key === key) ?? null;
}

/** Does this app ask for consent at all? */
export function hasConsentPurposes(): boolean {
  return consentPurposes().length > 0;
}

/**
 * Everything wrong with the shipped config — empty when it is coherent.
 *
 * `lib/consent/config.test.ts` fails the build on a non-empty result, and
 * `node run.mjs legal-check` reports it. The point is that a purpose with no
 * wording behind it is caught here rather than by a dialog rendering the
 * literal string "consent.marketing_email.title" at a customer.
 *
 * The message-file half of that check cannot live here — this module must not
 * import `messages/*.json` (they are large and they belong to i18n). It is in
 * `i18n/messages.test.ts`, walking the declared purposes the same way it walks
 * the error-code unions.
 */
export function consentConfigProblems(): string[] {
  const file = raw as Record<string, unknown>;
  const problems: string[] = [];

  if (file.purposes !== undefined && !Array.isArray(file.purposes)) {
    problems.push('"purposes" must be an array');
    return problems;
  }

  const declared = Array.isArray(file.purposes) ? file.purposes : [];
  const seen = new Set<string>();

  declared.forEach((entry, index) => {
    const at = `purposes[${index}]`;

    if (typeof entry !== "object" || entry === null) {
      problems.push(`${at}: must be an object with "key" and "textVersion"`);
      return;
    }

    const { key, textVersion } = entry as Record<string, unknown>;

    if (!isValidPurposeKey(key)) {
      problems.push(
        `${at}: "key" must be lowercase letters, digits and underscores ` +
          `(it becomes a database value AND a translation key)`,
      );
    } else if (seen.has(key)) {
      problems.push(`${at}: duplicate key "${key}"`);
    } else {
      seen.add(key);
    }

    if (!isValidTextVersion(textVersion)) {
      problems.push(
        `${at}: "textVersion" is required — bump it whenever you edit the ` +
          `wording, or consents given to the old sentence will be counted as ` +
          `covering the new one`,
      );
    }
  });

  return problems;
}
