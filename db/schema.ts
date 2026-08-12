// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The app's schema — everything the core defines, plus every installed module's
// tables. This is what `db/index.ts` hands to Drizzle, so `db.query.<table>`
// works for a module's tables exactly as it does for the core's.
//
// ── Why this is a barrel and `db/schema-core.ts` is the file ───────────────
// `drizzle.config.ts` points at `schema-core.ts`, NOT here, and that split is
// the whole reason this file exists: a module carries its own migration chain
// with its own journal, so the CORE chain must not create the module's tables.
// A core config pointing at this barrel would generate them into both chains,
// and the second one to run would fail on a table that already exists.
//
// The module half is GENERATED from `config/modules.json` and the manifests
// (`node run.mjs module sync`); with no module installed it exports nothing.
//
// ⚠️ A module's schema imports core tables from `./schema-core`, never from
// here — importing the barrel would close a cycle (barrel → module → barrel).
export * from "./schema-core";
export * from "./schema-modules";
