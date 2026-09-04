// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT
//
// The shipped legal placeholders are rendered by `lib/legal/markdown.ts`, whose
// inline subset is a link, `**strong**` and `*em*` — deliberately no code span
// (its own comment says why: there is no escape and nothing to hide a stray
// character in). A placeholder that writes `` `compliance-check` `` therefore
// shows the backticks to whoever opens `/impressum` before the skill has run —
// measured 2026-09-03 on a field-test app, three per file, in all eight files.
// The subset is right; the placeholders have to be written in it.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(__dirname, "..", "..", "content", "legal");

describe("the shipped legal placeholders are written in the renderer's subset", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".md"));

  it("finds the placeholders at all", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  for (const file of files) {
    it(`content/legal/${file} carries no backtick`, () => {
      const text = readFileSync(join(DIR, file), "utf8");
      const lines = text.split(/\r?\n/).map((l, i) => (l.includes("`") ? `${i + 1}: ${l.trim()}` : null)).filter(Boolean);
      expect(lines, "a code span the legal renderer cannot show — write it **bold** instead").toEqual([]);
    });
  }
});
