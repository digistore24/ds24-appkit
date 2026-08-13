// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The off-state gate — what `proxy.ts` runs in front of every matched request.
//
// 🚨 EDGE-CLEAN. Everything reachable from here runs before every request that
// the proxy matches, so this file's whole import closure must stay free of the
// database, of `react`, and of `node:` builtins. `modules/boundary.test.ts`
// holds that line; `lib/community/config.ts` is a JSON read and nothing else,
// which is why it is the one community file this may import.
//
// ⚠️ This REPLACED a hand-written block in `proxy.ts`, and the replacement is
// the point rather than the tidying. That block listed the covered paths by
// hand — and it covered `/dashboard/community` while missing
// `/dashboard/admin/community`, so the operator's tree fell through to its own
// in-page `notFound()`: a layout-wrapped, distinguishable document, one that
// any signed-in member could tell apart from a real 404.
//
// 🚨 The list below is STILL written by hand, and it has to be: this file runs in
// front of every matched request, so it cannot read `module.json`. What changed is
// that the copy is now MEASURED against the manifest instead of being trusted —
// `scripts/modules/profiles.test.ts` imports this gate, reads the manifest's
// `app` list through `guardableSubtrees()` and fails on any dashboard/ subtree
// missing here. So the set that is BUILT and the set that is GUARDED have one
// source in the sense that matters: they cannot drift without something going
// red. (`api/community` is deliberately absent — `proxy.ts`'s matcher never runs
// for it, and that handler refuses for itself. `guardableSubtrees()` says why.)
import type { ModuleGate } from "@/lib/modules/gate";
import { coversSubtrees, stateFromOffReason } from "@/lib/modules/gate";

import { communityOffReason } from "./lib/config";

const gate: ModuleGate = {
  id: "community",
  // Read per request, never cached: a cached answer would survive the deploy
  // that was meant to be the incident response.
  //
  // 🚨 This used to be `isCommunityEnabled()`, and the difference is a door.
  // That function is `enabled && no problems`, so it is false in the BROKEN
  // state too — and the proxy rewrites what this reports as off into an
  // unmatched path. `proxy.ts` states that the broken-but-wanted state is
  // deliberately NOT rewritten ("an operator's diagnosis page must stay
  // reachable") and `docs/community.md` promises that page by name; a boolean
  // could not carry the third state, so the gate rewrote away the one door
  // both were written about. What an operator with a typo in
  // `config/community.json` actually got: `module list` reporting the switch
  // as ON, every community page answering 404, and the page that exists to
  // name the bad key gone with them.
  //
  // `communityOffReason()` already computed the trichotomy — it just had
  // nowhere to put it. Now it maps straight across, and the broken state falls
  // through to the pages, which make the fork themselves: `pages/page.tsx`
  // renders the diagnosis for an owner and `notFound()`s everybody else, while
  // every other page and action refuses on `isCommunityEnabled()`.
  state: () => stateFromOffReason(communityOffReason()),
  covers: coversSubtrees(["dashboard/community", "dashboard/admin/community"]),
};

export default gate;
