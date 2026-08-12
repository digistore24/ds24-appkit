// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Advisories this app has looked at and accepted — a SET, never a count.
//
// This is your file. Extend it when `node run.mjs security-check` reports
// something that does not ship and that you have decided to live with, and take
// an entry out when it stops mattering. Nothing here is maintained on your
// behalf; `node run.mjs update` carries guidance text and never touches code.
//
// ── Why a set of ids with prose, and not a number ──────────────────────────
//
// A check that simply allowed "the known findings" goes green on the day a new,
// real one appears — it lands inside the allowance and nobody sees it. So what
// is accepted is a set of advisory ids, each carrying the reason it was
// accepted, and anything OUTSIDE the set is reported however small it is.
//
// Two consequences, and both are the point:
//
//   * **An empty set is the normal state.** A fresh app accepts nothing, and a
//     set that shrinks to nothing is good news rather than a sign the check
//     stopped working.
//   * **An entry that matches nothing is not evidence of anything.** An id
//     staying here after the advisory has gone costs nothing and is easy to
//     miss, so an entry that is no longer reported says so in its own reason —
//     see the one below. Without that line, its mere presence reads as "this is
//     still being reported", which is the exact misreading this file is shaped
//     to prevent.
//
// ⚠️ **Nothing in this project may assert how many entries are in here.** Not a
// test, not a sentence, not a log line. The set is the truth; its size is a
// fact about today.
//
// ── The scope field ────────────────────────────────────────────────────────
//
// `scope: "dev"` says the advisory is reachable only through development
// dependencies, so nothing a customer loads runs it. That is the ONLY scope an
// entry may honestly carry here: the ship-facing question
// (`npm audit --omit=dev --audit-level=high`) is asked separately and **takes no
// allowance at all** — an accepted set is never consulted for it. Whatever
// reaches a visitor's browser gets fixed, not accepted.
//
// The template's own release gate keeps a second, separate set of exactly this
// shape, and it is never shipped: that one guards what the template publishes,
// this one is yours and describes your app. They are deliberately not the same
// file — a customer who accepts something must not be editing the template's
// gate, and the template must not be quietly accepting things on a customer's
// behalf.

/**
 * @typedef {object} AcceptedAdvisory
 * @property {"dev"} scope    where it is reachable — see the note above
 * @property {string} reason  why it is accepted, in prose. An id with no reason
 *                            reads as an arbitrary exemption to whoever finds
 *                            it next, and that is how a real finding survives.
 *
 * @type {Record<string, AcceptedAdvisory>}
 */
export const ACCEPTED_ADVISORIES = {
  "GHSA-mh99-v99m-4gvg": {
    scope: "dev",
    reason:
      "brace-expansion, unbounded expansion → out of memory. It reaches this project " +
      "only through eslint-config-next, so it is a linting dependency and never " +
      "shipped — `npm audit --omit=dev` is clean, and this check asks that question " +
      "separately with no allowance. The lockfile already pins the versions that " +
      "carry the expansion cap — 1.1.18 and 5.0.8, both MEASURED against a brace bomb " +
      "(scripts/deps.test.ts, section 2, which also names the bomb that tells 5.0.7 " +
      "and 5.0.8 apart, because the obvious one does not); the finding used to persist anyway " +
      "because the advisory range is written `<=5.0.7` across every major and so " +
      "swallows the 1.x backport that fixes it. The way out is upstream, not an " +
      "override here — the two obvious fixes are both refused and both measured: " +
      "`overrides.minimatch: ^10` makes the audit read clean and ships " +
      "`TypeError: minimatch is not a function` into the first app that enables a " +
      "matching lint rule (scripts/deps.test.ts fails on it), and eslint@10 leaves " +
      "the plugins' own chain exactly where it was while adding three ERESOLVE " +
      "conflicts. " +
      "⚠️ MEASURED 2026-08-10: this entry currently matches NOTHING — `npm audit` on " +
      "a fresh install of this template answers `found 0 vulnerabilities`. It is " +
      "kept because the judgement is the expensive part and the advisory has come " +
      "and gone with upstream range corrections before; do not read its presence " +
      "here as evidence that anything is still being reported.",
  },
};

/** The ids alone — what `partitionAccepted()` in ./rules.mjs is keyed on. */
export const acceptedIds = () => new Set(Object.keys(ACCEPTED_ADVISORIES));

/** The reason an id was accepted, or "" — never a thrown error over a lookup. */
export const acceptedReason = (id) => ACCEPTED_ADVISORIES[id]?.reason ?? "";
