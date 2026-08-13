// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 Which paths a module's off-switch actually covers.
//
// `coversSubtrees()` runs in `proxy.ts`, in front of every matched request, and
// it decides whether a switched-off module's page is rewritten away. Getting it
// wrong is not a 500 — it is a request falling through to the page's own
// `notFound()`, which renders the dashboard layout around it and is therefore a
// DIFFERENT document from a route that was never built. That difference is what
// lets a probing member tell "switched off" from "not installed".
//
// The incident this function exists for is in its own header: the community's
// hand-written comparison covered `/dashboard/community` and missed
// `/dashboard/admin/community`, and that page's `notFound()` runs BEFORE its
// `requireOwner()` — so any signed-in member could read the difference.
//
// Both functions are pure and neither had a test. `lib/modules/` is twenty
// files of spine with one test file, and the reason is the usual one: with no
// module installed, `MODULE_GATES` is empty and nothing calls either of them.
//
// Measured, two needles, both invisible to the compiler:
//
//   · the boundary dropped (`path.startsWith(root)` instead of the `===` plus
//     `${root}/` pair) — typecheck clean, **1 of 37** red
//   · `api/` no longer filtered out of `guardableSubtrees()` — typecheck clean,
//     **3 of 37** red
//
// (`scripts/modules/gate.test.ts` is a different file and asks a different
// question — whether an installed module's hand-written subtree list matches
// its manifest. This one asks what the comparison itself does.)
import { describe, expect, it } from "vitest";

import { coversSubtrees, guardableSubtrees, stateFromOffReason } from "./gate";

describe("stateFromOffReason", () => {
  // The three rows of the table in `ModuleState`'s own doc comment. It was
  // written out by hand in two module gates before it lived here — identically,
  // down to the ternary — and the community's copy carries a post-mortem about
  // getting it wrong.
  it("a switch an operator turned off is `off` — the only state that is rewritten", () => {
    expect(stateFromOffReason("disabledInConfig")).toBe("off");
  });

  it("🚨 a config that does not parse is `broken`, NOT `off`", () => {
    // The whole point. `off` earns the proxy rewrite, which sends the request
    // to an unmatched path — taking the operator's own diagnosis page with it.
    // A boolean cannot carry this row, and collapsing it is a shipped bug:
    // `module list` says ON, every page 404s, and the page that names the
    // mistyped key is gone with the rest.
    expect(stateFromOffReason("brokenConfig")).toBe("broken");
  });

  it("no reason at all is `on`", () => {
    expect(stateFromOffReason(null)).toBe("on");
  });

  it("`disabledInConfig` wins over a broken file", () => {
    // Not decided here but upstream, in each module's `<x>OffReason()` — pinned
    // so that moving the precedence into this function later is a decision
    // rather than a silent change of behaviour.
    expect(stateFromOffReason("disabledInConfig")).not.toBe("broken");
  });
});

describe("coversSubtrees", () => {
  const covers = coversSubtrees(["dashboard/community", "dashboard/admin/community"]);

  it("covers the subtree root itself", () => {
    expect(covers("/dashboard/community")).toBe(true);
  });

  it("covers everything under it", () => {
    expect(covers("/dashboard/community/feed")).toBe(true);
    expect(covers("/dashboard/community/groups/42/posts")).toBe(true);
  });

  it("🚨 covers the ADMIN subtree too — the one that was missed", () => {
    expect(covers("/dashboard/admin/community")).toBe(true);
    expect(covers("/dashboard/admin/community/reports")).toBe(true);
  });

  it("accepts a subtree written with a leading slash as well as without", () => {
    // The manifest writes them without; a hand-written gate may not. Both have
    // to mean the same thing or the normalisation is a second place to be wrong.
    expect(coversSubtrees(["/dashboard/community"])("/dashboard/community/feed")).toBe(true);
  });

  it("🚨 does not cover a path that merely STARTS with the same letters", () => {
    // The boundary that makes the `/` in the prefix load-bearing. Without it a
    // module switching itself off would take an unrelated core page with it.
    expect(covers("/dashboard/communityx")).toBe(false);
    expect(covers("/dashboard/community-archive")).toBe(false);
  });

  it("does not cover the core's own pages", () => {
    expect(covers("/dashboard")).toBe(false);
    expect(covers("/dashboard/billing")).toBe(false);
    expect(covers("/dashboard/admin/purchases")).toBe(false);
  });

  it("covers nothing at all when a module declares no subtree", () => {
    const none = coversSubtrees([]);
    expect(none("/dashboard/community")).toBe(false);
    expect(none("/")).toBe(false);
  });
});

describe("guardableSubtrees", () => {
  it("keeps the dashboard subtrees a module declares", () => {
    expect(guardableSubtrees(["dashboard/community", "dashboard/admin/community"])).toEqual([
      "dashboard/community",
      "dashboard/admin/community",
    ]);
  });

  it("🚨 drops `api/` — the proxy never runs there, so a gate would be dead code", () => {
    // `proxy.ts`'s matcher is read out of the AST at build time and cannot be
    // computed, so an api subtree in a gate is not a weaker guarantee — it is a
    // guarantee that never runs while looking like one. Those handlers refuse
    // for themselves (`guard-presence.test.ts`).
    expect(guardableSubtrees(["dashboard/community", "api/v1/community"])).toEqual([
      "dashboard/community",
    ]);
  });

  it("drops anything outside `/dashboard`, not only `api/`", () => {
    // The matcher's other four entries are public pages. A module subtree there
    // would be in the same position as an api route: unreachable by the proxy.
    expect(guardableSubtrees(["plans", "optin/x", "dashboard/course"])).toEqual([
      "dashboard/course",
    ]);
  });

  it("answers with an empty list rather than throwing on a module with no routes", () => {
    expect(guardableSubtrees([])).toEqual([]);
  });

  it("the two functions agree — everything guardable is really covered", () => {
    // The seam between them, and the only claim that needs both: a gate is
    // built from `guardableSubtrees(manifest.app)`, so anything that survives
    // the filter must be something `coversSubtrees` then matches.
    const app = ["dashboard/course", "dashboard/admin/course", "api/v1/course"];
    const guardable = guardableSubtrees(app);
    const covers = coversSubtrees(guardable);

    expect(guardable.length).toBeGreaterThan(0);
    for (const subtree of guardable) {
      expect(covers(`/${subtree}`), `${subtree} survived the filter but is not covered`).toBe(true);
    }
    // And the dropped one is genuinely not covered — otherwise the filter would
    // be decoration.
    expect(covers("/api/v1/course")).toBe(false);
  });
});
