// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The route DECLARATION for `/api/v1/courses/units/{slug}/submission`. The handler is in the module.
//
// Next scans `app/` and nothing else, so a module's routes live here
// physically. The `.courses.` in the name is the switch: this file is a route
// exactly while `courses.ts` is in `pageExtensions`, which is exactly while the
// module is installed. Uninstalled, Next builds no route here and the path
// answers a REAL 404 — the same answer the API's own switch gives when it is
// off, and the two are indistinguishable from outside on purpose.
//
// It delegates and holds no logic; `modules/boundary.test.ts` §1b enforces that.
export { POST } from "@/modules/courses/routes/submission";
