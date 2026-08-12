// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Rewriting three tokens in the REAL `app/globals.css` without disturbing it.
//
// Against the real file on purpose. A fixture would prove the regex works; only
// the real file proves it works on the file with the load-bearing comments, the
// `@theme inline` block that also contains `--…` lines, and the four Callout
// triples that must not move.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseTokens } from "@/scripts/ux/rules.mjs";
import { WRITABLE, replaceTokens } from "./write-tokens.mjs";

const GLOBALS = fileURLToPath(new URL("../../app/globals.css", import.meta.url));
const original = readFileSync(GLOBALS, "utf8");

const BLOCKS = {
  light: {
    primary: "hsl(152 56% 28%)",
    "primary-foreground": "hsl(152 20% 97%)",
    ring: "hsl(152 56% 28%)",
  },
  dark: {
    primary: "hsl(152 56% 42%)",
    "primary-foreground": "hsl(152 55% 13%)",
    ring: "hsl(152 56% 42%)",
  },
};

describe("what it may write", () => {
  it("🚨 cannot touch a surface token", () => {
    // `lib/pwa/manifest.test.ts` holds PWA_BACKGROUND_COLOR and the share
    // card's colours against `--background` / `--foreground`. A brand command
    // able to move those could turn a customer's suite red from a colour
    // choice, in a file they never opened.
    expect(WRITABLE).toEqual(["primary", "primary-foreground", "ring"]);
    for (const forbidden of ["background", "foreground", "card", "destructive"]) {
      expect(WRITABLE).not.toContain(forbidden);
      expect(replaceTokens(original, { light: { [forbidden]: "hsl(0 0% 0%)" } }).error).toMatch(
        /refusing to write/,
      );
    }
  });
});

describe("replaceTokens against the real stylesheet", () => {
  const result = replaceTokens(original, BLOCKS);

  it("succeeds and replaces exactly six values", () => {
    expect(result.error).toBeNull();
    expect(result.replaced).toHaveLength(6);
  });

  it("🚨 changes six LINES and nothing else", () => {
    const before = original.split("\n");
    const after = result.css!.split("\n");
    expect(after).toHaveLength(before.length);
    const changed = before.filter((line, i) => line !== after[i]);
    expect(changed).toHaveLength(6);
    for (const line of changed) expect(line).toMatch(/--(primary|primary-foreground|ring):/);
  });

  it("leaves every other token byte-identical, in both blocks", () => {
    const before = parseTokens(original);
    const after = parseTokens(result.css!);
    for (const mode of ["light", "dark"] as const) {
      expect(Object.keys(after[mode]).sort()).toEqual(Object.keys(before[mode]).sort());
      for (const [name, value] of Object.entries(after[mode])) {
        if (WRITABLE.includes(name)) continue;
        expect(value, `${mode}/--${name}`).toBe(before[mode][name]);
      }
    }
  });

  it("keeps the prose that makes the file worth reading", () => {
    expect(result.css).toContain("The app's accent. Turn this dial to recolor.");
    expect(result.css).toContain("@theme inline");
    expect(result.css).toContain("@custom-variant dark");
  });

  it("puts the new values where parseTokens finds them", () => {
    const after = parseTokens(result.css!);
    expect(after.light.primary).toBe(BLOCKS.light.primary);
    expect(after.dark.primary).toBe(BLOCKS.dark.primary);
    expect(after.dark.ring).toBe(BLOCKS.dark.ring);
  });

  it("is idempotent", () => {
    const twice = replaceTokens(result.css!, BLOCKS);
    expect(twice.error).toBeNull();
    expect(twice.css).toBe(result.css);
  });
});

describe("the refusals", () => {
  it("🚨 refuses rather than appending a second declaration", () => {
    // An app whose `:root` no longer declares `--primary` has been restructured
    // by somebody. A second declaration whose winner depends on source order is
    // worse than doing nothing.
    const stripped = original.replace(/^\s*--primary:.*$/m, "");
    const result = replaceTokens(stripped, { light: { primary: "hsl(0 0% 50%)" } });
    expect(result.css).toBeNull();
    expect(result.error).toMatch(/not declared|refusing to add/);
  });

  it("refuses a stylesheet with no :root at all", () => {
    expect(replaceTokens("body{}", { light: { primary: "hsl(0 0% 0%)" } }).error).toMatch(
      /no :root block/,
    );
  });
});

describe("line endings", () => {
  it("takes CRLF in and writes LF out", () => {
    // `.gitattributes` says the tree is LF and `portability.test.ts` fails on a
    // CRLF anywhere. Without this, a recolour on a Windows checkout would
    // rewrite every line of the file.
    const crlf = original.replace(/\n/g, "\r\n");
    const result = replaceTokens(crlf, BLOCKS);
    expect(result.error).toBeNull();
    expect(result.css).not.toContain("\r");
  });
});
