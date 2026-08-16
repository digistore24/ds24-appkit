// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// This module's navigation — CLIENT-SAFE, it reaches the browser bundle.
//
// 🚨 Static data and an icon, nothing else. `components/app-shell.tsx` is a
// client component, so everything reachable from here lands in the browser; the
// database work belongs in `module.ts`, and the two must never meet in one
// import graph. `modules/boundary.test.ts` holds that line.
//
// The label lives in the `nav` namespace of this module's own message files —
// one of the two namespaces the CORE owns and every module merges INTO, so a key
// there has to start with the module id. `metricsAdmin` does.
import { TrendingUp } from "lucide-react";

import type { ModuleNav } from "@/lib/modules/nav";

const nav: ModuleNav = {
  id: "metrics",

  NAVIGATION: [
    // One entry, and it is the operator's. There is deliberately nothing for a
    // member: this module records what members do and shows it to whoever runs
    // the app. A member-facing page would be a second answer to "how am I
    // doing" that nothing in the product has asked for.
    //
    // ⚠️ The flag is the WIDE question (`isMetricsSwitchedOn()`, resolved in
    // `module.ts`), not `isMetricsEnabled()`. The page diagnoses a broken
    // config, so an entry that vanished in exactly that state would take away
    // the door to the only screen naming the bad value — `CLAUDE.md` → UI,
    // rule 3, and the fault `modules/community/gate.ts` carries the
    // post-mortem for.
    {
      href: "/dashboard/admin/metrics",
      labelKey: "metricsAdmin",
      icon: TrendingUp,
      ownerOnly: true,
      featureKey: "metricsAdmin",
      after: "/dashboard/admin/purchases",
    },
  ],

  features: ["metricsAdmin"],
};

export default nav;
