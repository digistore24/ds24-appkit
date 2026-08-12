// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// This module's navigation — CLIENT-SAFE, it reaches the browser bundle.
//
// 🚨 Static data and an icon, nothing else. `components/app-shell.tsx` is a
// client component, so everything reachable from here lands in the browser; the
// database work belongs in `module.ts`, and the two must never meet in one
// import graph. `modules/boundary.test.ts` holds that line.
//
// The labels live in the `nav` namespace of this module's own message files —
// one of the two namespaces the CORE owns and every module merges INTO
// (`lib/modules/messages-merge.ts`), so a key there has to start with the
// module id. `courses` and `coursesAdmin` do.
import { GraduationCap, ListTree } from "lucide-react";

import type { ModuleNav } from "@/lib/modules/nav";

const nav: ModuleNav = {
  id: "courses",

  NAVIGATION: [
    // First in the member's menu, deliberately: in an app that sells a course,
    // the course IS the product, and `after: "/dashboard"` puts it directly
    // under the overview rather than below whatever was added last.
    {
      href: "/dashboard/course",
      labelKey: "courses",
      icon: GraduationCap,
      featureKey: "courses",
      after: "/dashboard",
    },
    // ⚠️ **Its own key, and NOT `courses`.** The member entry's flag is
    // `isCourseEnabled()`, which is FALSE while the config is switched on but
    // does not hold — so sharing it would take this entry away in exactly the
    // state it exists for. The admin page diagnoses that state rather than
    // refusing in it (`CLAUDE.md` → UI, rule 3), so its flag is the plain "was
    // the course switched on" answer, `isCourseSwitchedOn()`.
    //
    // `after` puts it in the operator's block, which begins at
    // `/dashboard/admin` — the anchor a member-facing `after: "/dashboard"`
    // would miss by the whole menu. `ownerOnly` because a moderator looks
    // after people, not after the course's structure; `requireOwner()` on the
    // page is what actually refuses them, this only keeps the menu honest.
    {
      href: "/dashboard/admin/course",
      labelKey: "coursesAdmin",
      icon: ListTree,
      ownerOnly: true,
      featureKey: "coursesAdmin",
      after: "/dashboard/admin/purchases",
    },
  ],

  features: ["courses", "coursesAdmin"],
};

export default nav;
