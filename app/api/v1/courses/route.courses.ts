// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The route DECLARATION for `/api/v1/courses`. The handler is in the module.
//
// Next scans `app/` and nothing else, so a module's routes live here
// physically. The `.courses.` in the name is the switch: this file is a route
// exactly while `courses.ts` is in `pageExtensions`, which is exactly while the
// module is installed. Uninstalled, Next builds no route here and the path
// answers a REAL 404 — the same answer the API's own switch gives when it is
// off, and the two are indistinguishable from outside on purpose.
//
// It delegates and holds no logic; `modules/boundary.test.ts` §1b enforces that.
// 🚨 RESTATED as literals, never re-exported. Next reads these without running
// the module, so `export { runtime } from …` is invisible to it and the route
// simply does not carry the value — which is what `modules/boundary.test.ts`
// §segment-config refused when this file first tried the re-export.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export { GET } from "@/modules/courses/routes/courses";
