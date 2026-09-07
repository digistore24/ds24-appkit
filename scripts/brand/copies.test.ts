// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

import { parseTokens, tokenHex } from "@/scripts/ux/rules.mjs";
import { ACCENT_COPIES, accentCopies, literalOf, staleCopies } from "./copies.mjs";
import { readFileSync } from "node:fs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("the literal copies of the accent", () => {
  it("are found in the shipped files, and match the shipped token", () => {
    // Against the real tree: the list names files and constants, and a list
    // pointing at a constant that moved would report "could not read" about a
    // copy that is perfectly fine — or, the other way round, never notice one.
    const copies = accentCopies(ROOT);
    expect(copies).toHaveLength(ACCENT_COPIES.length);
    for (const copy of copies) expect(copy.value, `${copy.file} → ${copy.name}`).toMatch(/^#[0-9a-f]{6}$/);
    const css = readFileSync(`${ROOT}/app/globals.css`, "utf8");
    expect(staleCopies(copies, tokenHex(parseTokens(css).light.primary))).toEqual([]);
  });

  it("reads the literal and nothing that merely mentions the name", () => {
    expect(literalOf('export const OG_ACCENT = "#076A7E";', "OG_ACCENT")).toBe("#076a7e");
    expect(literalOf('// OG_ACCENT = "#000000" is explained here\nexport const OG_ACCENT = "#076a7e";', "OG_ACCENT")).toBe("#076a7e");
    expect(literalOf("export const OG_ACCENT = accent();", "OG_ACCENT")).toBeNull();
    expect(literalOf("", "OG_ACCENT")).toBeNull();
  });

  it("🚨 names the copy a recolour left behind, and counts an unreadable one as left behind", () => {
    const read = (file: string) => {
      if (file === "lib/email.ts") return 'export const DEFAULT_ACCENT = "#076a7e";';
      if (file === "lib/pwa/manifest.ts") return 'export const OG_ACCENT = "#1f6f4a";';
      throw new Error("ENOENT");
    };
    const copies = accentCopies("/nowhere", read);
    expect(staleCopies(copies, "#1F6F4A").map((c) => c.name)).toEqual(["DEFAULT_ACCENT"]);
    expect(staleCopies(copies, "#076a7e").map((c) => c.name)).toEqual(["OG_ACCENT"]);
    // A file that is not there is not a match.
    const gone = accentCopies("/nowhere", () => { throw new Error("ENOENT"); });
    expect(staleCopies(gone, "#1f6f4a")).toHaveLength(ACCENT_COPIES.length);
  });
});
