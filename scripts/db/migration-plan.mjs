// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Which module chains a migration run consists of — and the one sentence it
// ends with, derived from that same list.
//
// ── The failure this closes ────────────────────────────────────────────────
// `db-migrate` announces one `>> Migrating module "<id>"` per chain and used to
// close with `(core + ${modules.length} module chain(s))`, which counts the
// modules INSTALLED rather than the chains RUN. A module carries a chain only
// when it declares `migrations`, and `scripts/modules/manifest.mjs` ties that
// key to `tables` — so a module that holds no tables of its own is announced
// nowhere and was counted anyway. Measured 2026-08-12 with all five installed:
// four chains ran, the line said five, and `companion` was the difference.
//
// 🚨 That line is the one somebody reads in a deploy log, in a hurry, without
// the repository in front of them — the same reader `migrate-report.mjs` is
// written for. A closing summary that contradicts the four lines above it is
// worse than no summary: it is the sentence that decides whether anybody looks
// at the rest.
//
// So the list is computed ONCE and both the loop and the sentence read it, the
// way `switch-state.mjs` owns the wording of a switch's position rather than
// leaving it to the call site. Nothing here touches the disk or the database:
// the count is a property of the manifests, which is what makes it answerable
// in a test without a Postgres.

/**
 * @typedef {import("../modules/registry.mjs").ModuleRecord} ModuleRecord
 */

/**
 * The installed modules that actually bring a migration chain, in order.
 *
 * A module with no `migrations` folder is not skipped by accident — it has no
 * tables, so there is nothing to apply and nothing to journal.
 *
 * @param {ModuleRecord[]} records
 * @returns {ModuleRecord[]}
 */
export function migrationChains(records) {
  return records.filter((record) => typeof record.manifest.migrations === "string");
}

/**
 * What the migrator says when it is done.
 *
 * ⚠️ `count` is the number of chains that RAN. Zero is an honest answer for an
 * app whose modules bring no tables, and it reads exactly like a core-only app's
 * line — because that is what happened: only the core chain was applied.
 *
 * @param {number} count
 * @returns {string}
 */
export function chainSummary(count) {
  return count > 0
    ? `✓ Database is up to date (core + ${count} module chain(s)).`
    : "✓ Database is up to date.";
}
