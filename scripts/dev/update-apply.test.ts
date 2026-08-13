// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The half of `node run.mjs update` that WRITES.
//
// `update-plan.test.ts` covers the planning and `update-check.test.ts` the
// detection. Neither reaches this: the file that decides what lands on a
// customer's disk, over their `CLAUDE.md`, their `docs/` and their skills.
//
// It is a top-level script — it does its work on import, which is what a
// `run.mjs` command is — so what is asserted here is its ORDER, read from the
// source. That is the same shape `lib/privacy/export.test.ts` uses for "asks
// the modules BEFORE assembling the file", and for the same reason: the
// property is a sequence, and a sequence is exactly what source text can
// answer exactly.
//
// Four properties, and each one is a sentence the file already states about
// itself. What was missing is anything holding it to them.
//
// Comments are blanked first (CLAUDE.md → Rules) — this header names every call
// it looks for, and so does the script's own prose.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE = blankComments(readFileSync(join(ROOT, "scripts/dev/update.mjs"), "utf8"));

/** Where a call first appears. Fails loudly rather than answering -1. */
function at(needle: string): number {
  const index = SOURCE.indexOf(needle);
  expect(index, `\`${needle}\` is not in update.mjs — did the script change shape?`).toBeGreaterThan(
    0,
  );
  return index;
}

describe("update --apply writes nothing until everything is in hand", () => {
  it("has a script this test can actually read", () => {
    // The count guard: a file this parse no longer recognises would make every
    // `at()` below throw rather than pass, but an EMPTY read would not.
    expect(SOURCE.length, "update.mjs read as empty").toBeGreaterThan(2000);
  });

  it("🚨 fetches every file before it writes the first one", () => {
    // The script says why in its own words: "a half-applied update leaves the
    // guidance describing two different templates at once, and the half that is
    // missing is invisible." A customer would be left with a CLAUDE.md from one
    // release and a docs/ from another, with no error anywhere.
    expect(at("await contentOf(entry.path)")).toBeLessThan(at("writeFileSync(entry.path"));
  });

  it("🚨 verifies every hash before it writes the first file", () => {
    // The manifest and the files come from one commit of one repo, so a
    // mismatch is a truncated download or a proxy serving something else —
    // and this is the one command that overwrites a customer's guidance
    // wholesale. Checking after the first write would already have shipped it.
    expect(at("does not match its hash in the manifest")).toBeLessThan(
      at("writeFileSync(entry.path"),
    );
  });

  it("refuses `--confirm` with no terminal instead of guessing either way", () => {
    // Both guesses are wrong, which is why this is a refusal: applying would be
    // the "--apply on its own initiative" CLAUDE.md rules out, and declining
    // silently would report an update that never happened.
    const guard = at("!process.stdin.isTTY");
    expect(guard).toBeLessThan(at("writeFileSync(entry.path"));
    expect(SOURCE.slice(guard, guard + 400)).toContain("process.exit(2)");
  });

  it("🚨 moves the stamp on only for files it really wrote", () => {
    // A `keep` file — one the customer edited — keeps its OLD baseline, and
    // that is what makes it recognisable as edited on the next run too. Moving
    // the whole stamp forward would silently adopt the customer's edits as the
    // template's, and the next update would overwrite them without a word.
    const stampWrite = at("writeFileSync(STAMP");
    expect(stampWrite).toBeGreaterThan(at("writeFileSync(entry.path"));

    const block = SOURCE.slice(at("const files = { ...(stamp.files ?? {}) }"), stampWrite);
    expect(block).toContain('entry.action === "new"');
    expect(block).toContain('entry.action === "update"');
    expect(block).toContain('entry.action === "unchanged"');
    // The two that must NOT move it — a file the customer owns, and one whose
    // code this app does not have yet.
    expect(block).not.toContain('entry.action === "local-change"');
    expect(block).not.toContain('entry.action === "needs-code"');
  });

  it("writes with an explicit exit before it when there is nothing to do", () => {
    // Not a correctness property but a diagnostic one: "Nothing to write."
    // followed by an exit is what stops the stamp being rewritten on a run that
    // changed nothing, which would move its mtime and make `git status` dirty
    // after a no-op.
    expect(at('console.log("Nothing to write.")')).toBeLessThan(at("writeFileSync(entry.path"));
  });
});
