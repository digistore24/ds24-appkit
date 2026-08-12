// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The root layout asks Dark Reader to leave the page alone.
//
// Dark Reader is a browser extension that forces a dark theme onto sites that
// have none. This app HAS one (next-themes, the toggle in the header), and what
// the extension does instead is write its own attributes into every SVG:
//
//   - data-darkreader-inline-stroke=""
//   - style={{--darkreader-inline-stroke:"currentColor"}}
//
// It does that BEFORE React hydrates. So the server-rendered markup and the
// markup the browser actually holds differ, and the very first page view opens
// with a hydration mismatch — a full-screen error in dev, listing icons in the
// header that are perfectly fine. It reads like a bug in this app and is none:
// the same profile shows it on Linux, macOS and Windows alike, and a browser
// without the extension never sees it.
//
// The fix is one meta tag, officially provided for by Dark Reader
// (darkreader/CONTRIBUTING.md → "Disabling Dark Reader on your site"), declared
// through Next's metadata API in `app/layout.tsx`.
//
// This test exists because that tag has no visible effect for anybody here. It
// is one line that looks like a leftover, in a file nobody has reason to
// revisit, and the failure it prevents only shows up on a machine with a
// particular extension installed — so nothing else in the project would ever
// notice it going missing.
//
// Two things it also pins down, both of which have been reached for instead:
//
//   - `suppressHydrationWarning` on <html> stays. next-themes needs it (it sets
//     the theme class before hydration), and it is NOT what handles the
//     extension: the attribute works one level deep, the SVGs sit far below.
//   - The tag goes through `metadata`, not a hand-written <head> in the layout.
//
// Asserted on the source text, the way `app/use-server-exports.test.ts`,
// `components/app-shell.test.ts` and `scripts/portability.test.ts` are:
// vitest runs with `environment: "node"`, so there is no DOM to render into,
// and `generateMetadata()` needs a request context it cannot have here.
//
// Failing here? Read CLAUDE.md → Never ship a broken page before removing it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";
import { blankComments as withoutComments } from "@/scripts/lib/source-text.mjs";

const LAYOUT = fileURLToPath(new URL("./layout.tsx", import.meta.url));

/**
 * The file with comments removed.
 *
 * Not a nicety: `layout.tsx` explains the lock in prose right above it, so a
 * plain `toContain("darkreader-lock")` on the raw source stays green after the
 * declaration itself is deleted. Copied from `app/use-server-exports.test.ts`,
 * which has the same problem for the same reason.
 */
describe("the root layout keeps browser extensions out of the markup", () => {
  const code = withoutComments(readFileSync(LAYOUT, "utf8"));

  it("was read at all", () => {
    // Non-vacuity. A path that stopped resolving, or a stripper that ate the
    // file, would make every assertion below pass by examining nothing — the
    // failure mode of a source-level test.
    expect(code).toMatch(/export default async function RootLayout/);
  });

  it("declares the Dark Reader lock, with a non-empty value", () => {
    // The value is deliberately part of the assertion. Dark Reader never reads
    // it — `meta[name="darkreader-lock"] != null` is its whole test — but Next
    // DROPS an `other` entry whose value is the empty string, and then no tag
    // reaches the browser at all. `""` is the obvious thing to write here,
    // it type-checks, every test stays green, and the fix silently does
    // nothing. Curl the page if you ever doubt this one.
    expect(
      code,
      'app/layout.tsx no longer declares `other: { "darkreader-lock": "…" }`\n' +
        "with a non-empty value. Without it every visitor running the Dark\n" +
        "Reader extension meets a hydration mismatch on the first page view —\n" +
        "see the note at the top of this file, and docs/troubleshooting.md →\n" +
        "A hydration mismatch is not always yours.",
    ).toMatch(/other:\s*\{\s*"darkreader-lock":\s*"[^"]+"\s*\}/);
  });

  it("declares it as metadata, not as a hand-written <head>", () => {
    expect(
      code,
      "the App Router builds <head> from `metadata` — a <head> element written\n" +
        "into the layout by hand is not the way to add a tag here.",
    ).not.toMatch(/<head[\s>]/);
  });

  it("still suppresses the hydration warning on <html> for next-themes", () => {
    expect(
      code,
      "next-themes sets the theme class on <html> before React hydrates, so\n" +
        "that one element mismatches by design. This is unrelated to the Dark\n" +
        "Reader lock and cannot replace it: the attribute works one level deep.",
    ).toMatch(/<html[\s\S]*?suppressHydrationWarning/);
  });
});
