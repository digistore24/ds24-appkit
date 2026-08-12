// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The off-state gate — what `proxy.ts` runs in front of every matched request.
//
// 🚨 EDGE-CLEAN. Everything reachable from here runs before every matched
// request, so this file's whole import closure stays free of the database, of
// `react` and of `node:` builtins. `modules/boundary.test.ts` holds that line;
// `lib/config.ts` is a JSON read and the pure `rules.ts`, and nothing else.
//
// 🚨 The list below is written by hand and has to be: this runs in front of every
// request, so it cannot read `module.json`. What holds the copy to the manifest
// is `scripts/modules/profiles.test.ts`, which reads the `app` list through
// `guardableSubtrees()` and fails on any dashboard/ subtree missing here.
import type { ModuleGate } from "@/lib/modules/gate";
import { coversSubtrees } from "@/lib/modules/gate";

import { courseOffReason } from "./lib/config";

const gate: ModuleGate = {
  id: "courses",
  // Read per request, never cached: a cached answer would survive the deploy
  // that was meant to be the incident response.
  //
  // 🚨 Only `"off"` earns the rewrite. `courseOffReason()` already computes the
  // trichotomy, and the broken state deliberately falls through to the pages —
  // `pages/page.tsx` renders the diagnosis for an owner and `notFound()`s
  // everybody else. A gate that reported `isCourseEnabled()` here would rewrite
  // that door away with the kill switch, which is exactly the fault
  // `modules/community/gate.ts` carries the post-mortem for.
  state: () => {
    const reason = courseOffReason();
    if (reason === "disabledInConfig") return "off";
    return reason === "brokenConfig" ? "broken" : "on";
  },
  covers: coversSubtrees(["dashboard/course", "dashboard/admin/course"]),
};

export default gate;
