// Copyright (c) 2026 Digistore24 Inc, SPDX-License-Identifier: MIT

// The route DECLARATION for `/dashboard/course/[course]` — one course's own
// outline. The page itself is in the module.
//
// Next scans `app/` and nothing else, so a module's routes live here
// physically. The `.courses.` in the name is not a convention, it is the switch:
// this file is a route exactly while `courses.tsx` is in `pageExtensions`, which
// is exactly while the module is installed. Without it Next builds no route here
// and the path answers a REAL 404 — no rewrite, no special case in `proxy.ts`.
//
// ⚠️ `node run.mjs smoke` skips `[param]` routes, so nothing sweeps this one —
// open a real course slug by hand after changing it. The course LIST one level
// up is the page smoke does reach.
//
// It delegates and holds no logic; `modules/boundary.test.ts` §1b enforces that.
export { default } from "@/modules/courses/pages/course-page";
export { generateMetadata } from "@/modules/courses/pages/course-page";
