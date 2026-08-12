// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// GENERATED — do not edit. Run `node run.mjs module sync`.
//
// What the app's own pages may import from the installed modules.
// Its content is a function of config/modules.json and the manifests under
// modules/. `scripts/modules/generated.test.ts` fails the build when this
// file and those stop agreeing.
//
// A page writes:
//   import { ActivityPanel } from "@/lib/modules/component-registry";
// never:
//   import { ActivityPanel } from "@/modules/activity/components/activity-panel";
//
// The second is a core file naming a module, which `modules/boundary.test.ts`
// §1 refuses — in the CUSTOMER's app, about their own page. That refusal is
// why this file exists: without it the instruction in `docs/learning.md` was
// one no app could follow.

export {};
