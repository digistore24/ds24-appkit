// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// GENERATED — do not edit. Run `node run.mjs module sync`.
//
// What the app's own SERVER code may import from the installed modules.
// Its content is a function of config/modules.json and the manifests under
// modules/. `scripts/modules/generated.test.ts` fails the build when this
// file and those stop agreeing.
//
// A server action writes:
//   import { askCompanion } from "@/lib/modules/server-exports";
// never:
//   import { askCompanion } from "@/modules/companion/companion";
//
// The second is a core file naming a module, which `modules/boundary.test.ts`
// §1 refuses — in the CUSTOMER's app, about their own action.
//
// 🚨 SERVER ONLY. Nothing here may be a client component, and nothing that
// imports from here may be one: this graph reaches the AI layer, the database
// and the keys. The client-safe half is `component-registry.ts`.

export {};
