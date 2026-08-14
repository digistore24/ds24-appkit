// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The route DECLARATION for `/api/v1/entitlements`. The handler is in the module.
//
// Next scans `app/` and nothing else — there is no runtime route registration —
// so a module's routes have to live here physically. The `.api.` in the name
// is not a convention, it is the switch: this file is a route exactly while
// `api.ts` is in `pageExtensions`, which is exactly while the module is
// installed (`scripts/modules/page-extensions.mjs`). Uninstalled, Next sees no
// route in this folder and the path answers a REAL 404.
//
// It delegates and holds no logic, and `modules/boundary.test.ts` §1b enforces
// that: a handler written here would be the module's code living in the core's
// tree, uncovered by the module's own tests and left behind by `module remove`.
export { GET } from "@/modules/api/routes/entitlements";

// Restated as literals rather than re-exported: Next reads route segment
// config WITHOUT running the module, so a re-export is not seen and the route
// would not have them. Measured, and held by modules/boundary.test.ts §1b.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
