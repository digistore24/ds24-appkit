// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// This module's navigation — CLIENT-SAFE, it reaches the browser bundle.
//
// 🚨 Static data and an icon, nothing else. `components/app-shell.tsx` is a
// client component, so everything reachable from here lands in the browser;
// the database work belongs in `module.ts`, and the two must never meet in one
// import graph. `modules/boundary.test.ts` holds that line.
//
// The labels live in the `nav` namespace of this module's own message files —
// `nav` is one of the two namespaces the CORE owns and every module merges
// INTO (`lib/modules/messages-merge.ts`), and a key there has to start with the
// module id so two modules cannot overwrite each other. `community` and
// `communityAdmin` do.
import { MessagesSquare } from "lucide-react";

import type { ModuleNav } from "@/lib/modules/nav";

const nav: ModuleNav = {
  id: "community",

  NAVIGATION: [
    // The rooms. `after` puts it under the assistant rather than at the end of
    // the menu, which is below the operator's admin section.
    {
      href: "/dashboard/community",
      labelKey: "community",
      icon: MessagesSquare,
      featureKey: "community",
      after: "/dashboard/chat",
    },
    // ⚠️ **Its own key, and NOT `community`.** The member-facing entry's flag is
    // `communityNavVisible()`, which deliberately stays TRUE for the operator
    // while the module is on-but-broken, so the diagnosis page keeps a way in.
    // This page is not that diagnosis surface and refuses in exactly that
    // state, so sharing the flag would put a menu entry in front of the one
    // person who would then get a 404 from it. `communityAdmin` is the plain
    // "is the module running" answer.
    //
    // BOTH flags: `ownerOnly` because moderators look after rooms rather than
    // create them.
    {
      href: "/dashboard/admin/community",
      labelKey: "communityAdmin",
      icon: MessagesSquare,
      ownerOnly: true,
      featureKey: "communityAdmin",
      after: "/dashboard/admin/purchases",
    },
  ],

  features: ["community", "communityAdmin"],
};

export default nav;
