// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 On a module's admin page, the enablement check comes BEFORE the session
// work. Off beats operator.
//
// Both module admin pages state this at length in their own comments, and
// `modules/courses/admin/page.tsx` explicitly defers to
// `modules/community/admin/page.tsx` for the argument rather than repeating it.
// That is the right shape for the PROSE — but nothing held the CODE to it, and
// the order is the whole decision:
//
//   * `notFound()` first means a switched-off module answers not-found for
//     everyone, the operator included. There is no admin preview of a module
//     that is off; switching it on is an edit to `config/<x>.json` plus a
//     deploy, never something this page could offer.
//   * `requireOwner()` first would make the answer depend on WHO asked — and
//     `requireOwner()` redirects rather than 404s, so a member and an operator
//     would get two different documents from a module that is switched off.
//     That is the same "off is distinguishable from never-built" leak
//     `lib/modules/gate.ts` exists to close, one layer up.
//
// ⚠️ The two pages deliberately DIFFER in which predicate they use — community
// refuses anything but on-and-coherent, courses lets the broken state through
// so an operator can read the diagnosis. So this is not a rule that could be a
// shared helper: flattening it would erase a decision. What is shared is the
// ORDER, and that is what is asserted.
//
// Reads source as TEXT, so comments are blanked first (CLAUDE.md → Rules): this
// header names both calls, and the pages themselves argue about them at length.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { availableModules } from "@/scripts/modules/registry.mjs";
import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Every module admin page in the tree — AVAILABLE, not installed. */
const PAGES = availableModules(ROOT)
  .map((id) => ({ id, rel: join("modules", id, "admin", "page.tsx") }))
  .filter(({ rel }) => existsSync(join(ROOT, rel)));

describe("a module's admin page refuses on the switch before it looks at the session", () => {
  it("found admin pages to check", () => {
    // The count guard. Zero pages is what "every module was renamed" looks
    // like, and it is not a clean tree.
    expect(PAGES.map((p) => p.id).sort(), "no module admin page found").not.toEqual([]);
  });

  for (const { id, rel } of PAGES) {
    it(`${id}: the enablement check precedes requireOwner()`, () => {
      const source = blankComments(readFileSync(join(ROOT, rel), "utf8"));

      const owner = source.indexOf("requireOwner()");
      expect(owner, `${rel} never calls requireOwner()`).toBeGreaterThan(0);

      // Whatever the module's predicate is called — the two differ on purpose —
      // it is the thing that leads to `notFound()`.
      const refusal = source.indexOf("notFound()");
      expect(refusal, `${rel} has no notFound() refusal`).toBeGreaterThan(0);

      expect(
        refusal,
        `${rel} calls requireOwner() before its notFound() refusal. Off beats ` +
          `operator: a switched-off module answers not-found for everyone, and ` +
          `requireOwner() REDIRECTS — so this order hands a member and an ` +
          `operator two different documents for the same off module.`,
      ).toBeLessThan(owner);
    });
  }
});
