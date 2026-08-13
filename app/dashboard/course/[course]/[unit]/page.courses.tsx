// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The route DECLARATION for `/dashboard/course/[course]/[unit]`. The page is
// in the module.
//
// ⚠️ `node run.mjs smoke` skips `[param]` routes, so nothing sweeps this one —
// open a real unit slug by hand after changing it. `docs/courses.md` step 7 says
// so, and it is the gap that makes a green smoke run not a green lesson page.
export { default } from "@/modules/courses/pages/unit/page";
export { generateMetadata } from "@/modules/courses/pages/unit/page";
