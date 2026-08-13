// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 `node run.mjs kb-check` — the release gate for the assistant's handbook,
// and the last of this tree's four weighty scripts that no test named.
//
// `CLAUDE.md` gives it a job with a consequence: *"`node run.mjs kb-check`
// verifies every media reference before a release"*, and the knowledge block
// says the chat *"can LINK only to what she really looked up, enforced
// mechanically rather than by a prompt wish"*. This file is that mechanism.
//
// It is a top-level script with internal functions — the same shape as
// `scripts/dev/update.mjs` — so what is asserted is what source text can answer
// exactly: **that every way this command can find something wrong ends the
// process non-zero.** A gate that prints `✗` and exits 0 is not a gate, and it
// is the one defect in a release check that no run of the check can reveal:
// the output looks identical.
//
// ⚠️ What this does NOT claim: that the rules it applies are the right ones, or
// that they catch a real broken reference. That is the script's own subject and
// it needs a knowledge tree to run against. Saying otherwise would be exactly
// the "green because it checked" / "green because it skipped" confusion this
// repo refuses.
//
// Comments are blanked first (CLAUDE.md → Rules) — this header quotes the very
// calls it looks for.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";

/**
 * The body of the `if (…) { … }` that starts at `head`, brace-matched.
 *
 * ⚠️ A fixed lookahead window is NOT good enough here, and that is measured:
 * `if (chars > KNOWLEDGE_MAX_CHARS)[\s\S]{0,600}process.exit(1)` was the first
 * shape of the budget assertion, and it stayed green with that branch's exit
 * deleted — because the window reached the NEXT `process.exit(1)`, twelve lines
 * further down. A needle aimed at a rule the assertion cannot actually see
 * reports the test as protecting something it does not.
 */
function blockAfter(head: string): string {
  const at = SOURCE.indexOf(head);
  expect(at, `\`${head}\` is not in kb-check.mjs`).toBeGreaterThan(0);
  const open = SOURCE.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < SOURCE.length; i += 1) {
    if (SOURCE[i] === "{") depth += 1;
    else if (SOURCE[i] === "}") {
      depth -= 1;
      if (depth === 0) return SOURCE.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces after ${head}`);
}

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE = blankComments(readFileSync(join(ROOT, "scripts/ai/kb-check.mjs"), "utf8"));

/** Every `console.error(` in the file, with the text that follows it. */
const complaints = [...SOURCE.matchAll(/console\.error\(/g)].map((m) => m.index ?? 0);

describe("kb-check ends non-zero on every finding it can print", () => {
  it("was read, and really contains complaints", () => {
    // Two count guards. A file this parse no longer recognises, or one that
    // stopped complaining at all, would make the assertion below vacuous —
    // which is the shape of "I did not measure" this whole command is about.
    expect(SOURCE.length, "kb-check.mjs read as empty").toBeGreaterThan(5000);
    expect(complaints.length, "no console.error found — did the shape change?").toBeGreaterThan(3);
  });

  it("🚨 has no `✗` branch that leaves the process at 0", () => {
    // The defect a run of the command cannot reveal: the operator sees the same
    // ✗ either way, and the deploy carries on. Every complaint that opens with
    // ✗ must reach a `process.exit(1)` — either its own, or the shared one at
    // the foot that fires on a non-empty `problems`.
    const failing: string[] = [];

    for (const at of complaints) {
      const block = SOURCE.slice(at, at + 700);
      // Only the ones that declare a FAILURE. A `console.error` used for a
      // heading or an indented detail line is not a verdict.
      if (!block.includes("✗")) continue;
      const collects = /problems\.push|problem\.problem/.test(SOURCE.slice(Math.max(0, at - 900), at + 700));
      if (block.includes("process.exit(1)") || collects) continue;
      failing.push(SOURCE.slice(at, at + 90).replace(/\s+/g, " "));
    }

    expect(
      failing,
      "a ✗ branch in kb-check.mjs does not end the process non-zero — the " +
        "release gate prints a failure and the deploy carries on",
    ).toEqual([]);
  });

  it("🚨 refuses a handbook over the budget the APP itself refuses at", () => {
    // Its own comment records why this branch exists: the ceiling was enforced
    // in `readKnowledgeFrom` and nowhere in this command, so the check an
    // operator is TOLD to run before shipping stayed silent about the one size
    // that fails the build.
    expect(
      SOURCE.indexOf("KNOWLEDGE_MAX_CHARS"),
      "kb-check no longer knows the app's own ceiling",
    ).toBeGreaterThan(0);
    // The branch's OWN body, brace-matched — see `blockAfter`.
    expect(blockAfter("if (chars > KNOWLEDGE_MAX_CHARS)")).toContain("process.exit(1)");
  });

  it("refuses an empty corpus rather than passing it", () => {
    // "No usable document" is the state that most looks like success from the
    // outside: nothing is broken, because nothing is there. A handbook with no
    // documents means an assistant who answers "I do not know" to everything.
    expect(blockAfter("if (docs.length === 0)")).toContain("process.exit(1)");
    expect(blockAfter("if (!exists)")).toContain("process.exit(1)");
  });

  it("prints its success line only after every exit path", () => {
    // The closing `✓` has to be unreachable from any failure above it. If it
    // moved up, a run with problems would print both a ✗ and a ✓, and the last
    // line is the one a person reads.
    const success = SOURCE.lastIndexOf("The handbook is in order");
    expect(success).toBeGreaterThan(0);
    for (const at of [...SOURCE.matchAll(/process\.exit\(1\)/g)].map((m) => m.index ?? 0)) {
      expect(at, "an exit(1) sits after the success line").toBeLessThan(success);
    }
  });
});
