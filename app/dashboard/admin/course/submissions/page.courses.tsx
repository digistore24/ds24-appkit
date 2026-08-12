// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The route DECLARATION for `/dashboard/admin/course/submissions`. The page itself is in the module.
//
// Next scans `app/` and nothing else, so a module's routes live here
// physically. The `.courses.` in the name is not a convention, it is the
// switch: this file is a route exactly while `courses.tsx` is in
// `pageExtensions`, which is exactly while the module is installed. Without it
// Next builds no route here and the path answers a REAL 404 — no rewrite, no
// special case in `proxy.ts`.
//
// No manifest line and no gate line: `module.json` declares the SUBTREE
// `dashboard/admin/course`, and `coversSubtrees()` (`lib/modules/gate.ts`)
// matches every path under it. `scripts/modules/profiles.test.ts` asserts that.
//
// It delegates and holds no logic; `modules/boundary.test.ts` §1b enforces that.
export { default } from "@/modules/courses/pages/submissions/page";
export { generateMetadata } from "@/modules/courses/pages/submissions/page";
