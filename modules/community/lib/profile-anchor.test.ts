// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The hint that sends a nameless member somewhere, and the box it means.
//
// A member who has not named themselves cannot write, and the community says
// so where they tried to: a Callout with one link out. That link used to point
// at `/dashboard/account` and nothing more precise — but with the module
// installed that page carries the balance, what was bought, the sign-in card,
// the consent card, this module's profile card and the two data-protection
// cards. A link to the top of it is a link to a PAGE plus an instruction to go
// looking, which is exactly the work the hint exists to save.
//
// So the link carries an anchor, and the card wears the matching `id`. The two
// sides sit in different files and neither can be derived from the other by
// reading it — `pages/ui.tsx` writes the `href`, `components/profile-ui.tsx`
// writes the `id` — so one constant spells both and this file is what keeps
// that true. It is the clamp every deep link in this template needs: the
// target renders the `id` in the SAME commit that starts pointing at it, or
// the link scrolls nowhere, silently, and looks like a link that simply did
// not work.
//
// A source test rather than a rendered one, for the reason the whole repo is:
// there is no DOM environment here and no component tests, so what can be held
// is the shape of the source. Non-vacuous by construction — an unreadable file
// throws rather than passing.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { blankComments } from "@/scripts/lib/source-text.mjs";

import {
  COMMUNITY_PROFILE_ANCHOR,
  COMMUNITY_PROFILE_HREF,
} from "./rules";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** The file's code, with every comment blanked — a comment quoting the old
 *  link must not read as the file still using it. */
function code(...segments: string[]): string {
  const source = readFileSync(join(ROOT, ...segments), "utf8");
  expect(source.length).toBeGreaterThan(0);
  return blankComments(source);
}

describe("the community profile anchor", () => {
  it("is slug-shaped, so it survives a URL untouched", () => {
    expect(COMMUNITY_PROFILE_ANCHOR).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });

  it("spells the href itself — the two can never disagree", () => {
    expect(COMMUNITY_PROFILE_HREF).toBe(
      `/dashboard/account#${COMMUNITY_PROFILE_ANCHOR}`,
    );
  });

  it("is what the hint links to, and not a hand-written path", () => {
    const source = code("modules", "community", "pages", "ui.tsx");

    expect(source).toContain("COMMUNITY_PROFILE_HREF");
    // The bare path is the regression: it is what was there before, it still
    // reaches the right page, and nothing else in the app would notice that
    // the anchor had been dropped again.
    expect(source).not.toMatch(/["']\/dashboard\/account["']/);
  });

  it("is the id the profile card actually wears", () => {
    const source = code(
      "modules",
      "community",
      "components",
      "profile-ui.tsx",
    );

    expect(source).toContain("id={COMMUNITY_PROFILE_ANCHOR}");
    // Without this the card lands under the sticky header (`h-14` in
    // `components/app-shell.tsx`) and the member arrives at a heading they
    // cannot see.
    expect(source).toMatch(/scroll-mt-\d/);
  });
});
