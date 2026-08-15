// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The knowledge-media route's guard order, asserted on the source text.
//
// There is no jsdom and no route-handler harness in this repo — route
// guarantees live in `lib/` (here: the grammar suite beside
// `lib/knowledge-media/rules.mjs`), and pages are checked by loading them.
// What CAN be pinned cheaply is the structure a refactor would silently
// break: the session guard running before the grammar, the grammar before
// any I/O, the constants imported instead of re-declared, and the two
// headers this route deliberately does not send. Asserted the way
// `app/use-server-exports.test.ts` asserts its rule: by reading the file.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { isValidMediaPath } from "@/lib/knowledge-media/rules.mjs";
import { blankComments } from "@/scripts/lib/source-text.mjs";

// 🚨 Blanked, and this file needs it more than most: the order assertion below
// compares `indexOf` POSITIONS, so a comment naming `readFile(` or `signedUrl(`
// above the real call does not merely add a match — it reorders the guards this
// test exists to pin, and the route would pass while its checks ran backwards.
const route = blankComments(
  readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8"),
);

describe("the route's shape (AD-53)", () => {
  it("runs on nodejs and is never statically rendered", () => {
    expect(route).toContain('export const runtime = "nodejs"');
    expect(route).toContain('export const dynamic = "force-dynamic"');
  });

  it("guards in order: session, then grammar, then the disk leg, then the store", () => {
    const positions = [
      "currentActiveUser(",
      "isValidMediaPath(",
      "readFile(",
      "mediaStoreProblems(",
      "signedUrl(",
      "getBytes(",
    ].map((marker) => route.indexOf(marker));
    expect(positions.every((index) => index >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("imports the grammar and the constants — never re-declares them (AD-56)", () => {
    expect(route).toContain("@/lib/knowledge-media/rules.mjs");
    // The prefix and the TTL travel as the module's exports; a literal here
    // would be the second copy two readers could disagree about.
    expect(route).toContain("KNOWLEDGE_MEDIA_BUCKET_PREFIX");
    expect(route).toContain("KNOWLEDGE_MEDIA_TTL_SECONDS");
    expect(route).not.toMatch(/["'`]knowledge\/["'`]/);
    expect(route).not.toContain("21600");
  });

  it("has no feature switch, no visibility model, no download param", () => {
    expect(route).not.toContain("isMediaEnabled");
    expect(route).not.toContain("mayAccess");
    expect(route).not.toContain("content-disposition");
  });

  it("never rethrows a disk-leg fs error — a member cannot select a 500", () => {
    // The refusal promise in this route's header is that every "no" looks like
    // absence. An fs error rethrown out of the disk leg becomes a 500, and the
    // codes that get there are all reachable from a grammar-valid URL
    // (ENAMETOOLONG on a very long segment, ELOOP, EACCES) — so a 500 would be
    // a way to tell real paths from imaginary ones. The leg falls through to
    // the bucket instead, and logs what it did not expect.
    const leg = route.slice(
      route.indexOf("try {"),
      route.indexOf("mediaStoreProblems("),
    );
    expect(leg).not.toMatch(/\bthrow\b/);
    expect(leg).toContain("console.error");
  });

  it("never advertises ranges and never lets a response be cached", () => {
    expect(route.toLowerCase()).not.toContain('"accept-ranges"');
    expect(route).toContain("no-store, private");
  });
});

describe("what carries the disk leg into a standalone build (AC 5)", () => {
  it("next.config.ts traces content/knowledge-media for this route", () => {
    // Blanked too: the tracing entry is what makes the disk leg survive a
    // standalone build, and `toContain` over raw text would be satisfied by a
    // comment that merely names the glob it no longer traces.
    const config = blankComments(
      readFileSync(
        fileURLToPath(new URL("../../../../next.config.ts", import.meta.url)),
        "utf8",
      ),
    );
    expect(config).toContain("./content/knowledge-media/**/*");
  });
});

describe("the committed root's README is unservable by construction", () => {
  it("exists, and its name violates the grammar twice over", () => {
    const readme = readFileSync(
      fileURLToPath(
        new URL("../../../../content/knowledge-media/README.md", import.meta.url),
      ),
      "utf8",
    );
    expect(readme.length).toBeGreaterThan(0);
    // Uppercase fails the segment pattern, `.md` is not in the allow-map, and
    // depth 1 is refused anyway — three independent refusals.
    expect(isValidMediaPath("README.md")).toBe(false);
    expect(isValidMediaPath("readme.md")).toBe(false);
    expect(isValidMediaPath("topic/readme.md")).toBe(false);
  });
});
