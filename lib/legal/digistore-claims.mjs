// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Two Digistore24 platform rules, as code rather than as prose.
//
// Both are RESELLER rules, not law, and that is what makes them dangerous to
// leave in a document: breaking them does not produce an error, a failing test
// or an unhappy customer. It produces a product that is refused at approval, or
// an account that is closed after it has been selling for months. Nothing in
// the app can feel that.
//
//   1. **No promise of unlimited access.** Digistore24's product criteria
//      forbid promising a members' area "lebenslangen" access and name ten
//      words to avoid, while allowing access to be limited to at most two
//      years. Their reason is the one that costs money: an offer that is gone
//      after 24 months can oblige the vendor to refund the full price.
//   2. **The thank-you page says who charged.** Digistore24 GmbH is the
//      reseller and the party on the buyer's statement, so the page they land
//      on after paying has to say so — otherwise the line on the bank
//      statement belongs to a company the buyer has never heard of, and that
//      is a chargeback with a support ticket attached.
//
// ⚠️ These criteria bind whoever sells through **Digistore24 GmbH**. Check your
// own contract before treating the two years as universal —
// `docs/courses.md` → *Shape 1* carries the same caveat.
//
// It is `.mjs` with zero imports for the reason `lib/email-from.mjs` is:
// `node run.mjs legal-check` is deliberately given no way to import TypeScript
// (`lib/ai/disclosure.mjs` explains why), and a rule with two copies drifts.

/**
 * The ten words Digistore24's product criteria name, as stems.
 *
 * 🚨 Stems, not the words as the criteria spell them. Their list is written in
 * one declension — *lebenslanger, dauerhafter, unbegrenzter* — and German
 * inflects: the sentence that started this file was **"Einmal kaufen,
 * dauerhaft nutzen"**, which contains none of the ten as written and every one
 * of them as meant. A checker that matched the list literally would have
 * passed it.
 *
 * `en` is OURS rather than theirs: the criteria are written in German plus
 * "lifetime", and this template ships bilingual. A promise is a promise in the
 * language it is read in.
 */
export const DURATION_TERMS = [
  // The ten, in the order docs/courses.md quotes them.
  { stem: "lifetime", source: "ds24" },
  { stem: "lebenslang", source: "ds24" },
  { stem: "unlimitiert", source: "ds24" },
  { stem: "dauerhaft", source: "ds24" },
  { stem: "unbegrenzt", source: "ds24" },
  { stem: "unbefristet", source: "ds24" },
  { stem: "unbeschränkt", source: "ds24" },
  { stem: "unbeschraenkt", source: "ds24" },
  { stem: "permanent", source: "ds24" },
  { stem: "auf unbestimmte zeit", source: "ds24" },
  { stem: "für immer", source: "ds24" },
  { stem: "fuer immer", source: "ds24" },
  // The same promise in English, which their list does not cover.
  { stem: "forever", source: "en" },
  { stem: "for life", source: "en" },
  { stem: "unlimited", source: "en" },
  { stem: "indefinite", source: "en" },
  { stem: "no time limit", source: "en" },
  { stem: "no expiry", source: "en" },
];

/**
 * Words that turn one of the above into a claim about ACCESS.
 *
 * 🚨 This half is what keeps the check usable. "Unbegrenzt viele Notizen" is a
 * feature and perfectly allowed; "unbegrenzt nutzen" is the refused promise,
 * and the difference is the noun, not the adjective. A bare word list would
 * open with a wall of findings on every app that offers something generously —
 * and a check that opens with a wall is one somebody switches off, taking the
 * intent with it.
 *
 * Deliberately short. The cost of a word missing here is a claim reported as a
 * WARNING instead of a finding, not a claim reported as nothing:
 * `durationClaims()` returns both and the caller decides.
 */
export const ACCESS_WORDS = [
  "zugang",
  "zugriff",
  // The stem, not the two forms: `nutzen`, `Nutzung`, `nutzbar`, `benutzen`.
  "nutz",
  "verfügbar",
  "verfuegbar",
  "abrufen",
  "mitgliederbereich",
  "mitglied",
  "kursbereich",
  "teilnehmen",
  "access",
  // Bare, and that is a decision with a measurement behind it: the shipped
  // example products said **"Unlimited use"** on the plans page of every app
  // ever generated from this template, and `use it`/`using` did not catch it.
  // On its own "use" is a common word — but it only ever counts inside a
  // sentence that already carries one of the ten, and there it is the noun the
  // promise attaches to.
  "use",
  "available",
  "member area",
  "membership",
  "keep it",
  "yours",
];

/**
 * Sentences, in the loose sense a marketing text needs: a full stop ends one,
 * and so does a line break, a bullet and a heading. "Einmal kaufen, dauerhaft
 * nutzen" is one sentence with a comma in it and must stay one, or the two
 * halves of the claim fall into different buckets and the check misses it.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function sentencesOf(text) {
  return String(text)
    .split(/(?<=[.!?])\s+|\n+|\s*[•·]\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * @typedef {object} DurationClaim
 * @property {string} term      the stem that matched
 * @property {"ds24" | "en"} source
 * @property {string} sentence  what it was found in, for a person to judge
 * @property {boolean} aboutAccess  true when the sentence also names access
 */

/**
 * Every forbidden duration word in a piece of customer-facing text.
 *
 * Returns both kinds and marks which is which — `aboutAccess: true` is the
 * refused promise, `false` is a word worth a second look that the caller may
 * report as a warning. Judging is not this function's job; it does not know
 * whether it was handed a sales page or a release note.
 *
 * @param {string} text
 * @returns {DurationClaim[]}
 */
export function durationClaims(text) {
  const found = [];
  for (const sentence of sentencesOf(text)) {
    const haystack = sentence.toLowerCase();
    const aboutAccess = ACCESS_WORDS.some((word) => haystack.includes(word));
    for (const { stem, source } of DURATION_TERMS) {
      // Word-start rather than whole-word: German compounds and declensions are
      // the whole point (`dauerhaft` in `dauerhaften`), while a match INSIDE a
      // word would find "permanent" in nothing useful and "for life" in
      // "before lifetimes". A leading boundary is the honest middle.
      const at = haystack.indexOf(stem);
      if (at < 0) continue;
      const before = at === 0 ? "" : haystack[at - 1];
      if (before && /[\p{L}\p{N}]/u.test(before)) continue;
      found.push({ term: stem, source, sentence, aboutAccess });
    }
  }
  return found;
}

/**
 * @typedef {object} ResellerSurface
 * @property {string} label      what it is, for a report a person reads
 * @property {string} key        the message key, as `namespace.key`
 * @property {string} rendersIn  the file that must mount it, from the app root
 * @property {string} mount      what the mount looks like in that file
 */

/**
 * Every place a buyer has to be told who charged them.
 *
 * 🚨 **Two surfaces, not one, and the second is the one that is easy to miss.**
 * The thank-you page is what Digistore24 is pointed at (`thankyou_url`), so it
 * is the surface the platform rule is about — but a buyer who was already
 * SIGNED IN never sees it: `app/optin/[orderId]/page.tsx` redirects them
 * straight to the dashboard with `?purchase=…`, which is right, because that is
 * where the thing they paid for is. A notice on the thank-you page alone
 * therefore reaches only the buyers who had no account yet, which is not the
 * half that gets confused by a bank statement.
 *
 * 🚨 **And each surface has two halves.** A key nobody mounts is a sentence in
 * a JSON file; a mount with no key renders the key itself at a customer. Same
 * shape as the Art. 50 disclosure (`lib/ai/disclosure.mjs`), which grew its
 * `nothingRendersIt` code after exactly that.
 *
 * @type {ResellerSurface[]}
 */
export const RESELLER_SURFACES = [
  {
    label: "the thank-you page",
    key: "optin.reseller",
    rendersIn: "app/optin/[orderId]/page.tsx",
    mount: 't("reseller")',
  },
  {
    label: "the purchase confirmation on the dashboard",
    key: "dashboard.purchaseReseller",
    rendersIn: "app/dashboard/page.tsx",
    mount: 't("purchaseReseller")',
  },
];

/**
 * Does this sentence name the party that charged?
 *
 * Deliberately only the NAME. Any wording is fine — the sentence has one job,
 * and prescribing it would be a translation nobody here can write for every app.
 *
 * @param {unknown} line
 * @returns {boolean}
 */
export function namesReseller(line) {
  return /digistore\s*24/i.test(String(line ?? ""));
}
