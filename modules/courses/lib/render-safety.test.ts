// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The guard that keeps text a member typed from becoming markup — this
// module's own.
//
// Shape 3 makes the course the second thing this template ships that STORES
// text one person wrote and shows it to another: a hand-in is prose from a
// stranger, and the person it is shown to is the one account that may do
// everything.
//
// 🚨 **The community's guard does not cover this tree, and `CLAUDE.md` says it
// does.** `modules/community/lib/render-safety.test.ts` names three
// `modules/community/…` paths in its `SCANNED` list — "fails the build on
// `dangerouslySetInnerHTML` anywhere in the tree" is true of the tree it knows.
// An app with `courses` and without `community` does not even HAVE that file. So
// the course brings its own, of the same build. A scanner shared by both trees
// is the right end state and is not this story's; until it exists, each module
// says it about its own tree.
//
// Same non-vacuity stance as the original: a walk that finds no files must FAIL,
// because a broken path is otherwise indistinguishable from a clean tree.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { blankComments as withoutComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * The trees that render text somebody typed.
 *
 * `components/` holds the one renderer. `pages/` is the member's lesson page
 * and the operator's answering surface. `admin/` renders the operator's own
 * titles and prompts — operator copy is not the stored-XSS surface a hand-in is,
 * and it is included for the same reason the community includes its own admin
 * tree: this guard is aimed at the future, and an admin tree is exactly where
 * somebody adds a rich-text editor first.
 */
const SCANNED = [
  join("modules", "courses", "components"),
  join("modules", "courses", "pages"),
  join("modules", "courses", "admin"),
];

/**
 * The forbidden call, built from halves.
 *
 * Spelled in one piece, this file would match itself and every run would fail on
 * its own source. The `scripts/knowledge-boundary.test.ts` trick, for the same
 * reason.
 */
const NEEDLE = "dangerously" + "SetInnerHTML";

/**
 * Files allowed to carry it. **Empty, and it is meant to stay empty.**
 *
 * An entry here is a decision that some part of the course renders HTML somebody
 * else wrote. If that ever becomes the right answer, the sanitiser, its
 * allow-list and its own tests come first, and the reasoning goes in this
 * comment — not in a commit message nobody will find.
 */
const ALLOWED: string[] = [];

/** Every source file under a scanned directory, at any depth. */
function* sourceFiles(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return;
  }
  for (const entry of entries) {
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) {
      yield* sourceFiles(rel);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      yield rel;
    }
  }
}

describe("member-written text never becomes markup in the course", () => {
  const files = SCANNED.flatMap((dir) => [...sourceFiles(dir)]);

  it("finds the course's rendering tree at all", () => {
    // Non-vacuity. A renamed directory would otherwise make this whole file
    // pass by scanning nothing, which is the failure mode of every
    // grep-the-tree test.
    expect(
      files.length,
      `no source files under ${SCANNED.join(", ")} — did the tree move? ` +
        `This test passes vacuously if it scans nothing, so fix the paths.`,
    ).toBeGreaterThan(3);
    expect(
      files.some((file) => file.endsWith(join("components", "member-text.tsx"))),
      "member-text.tsx is the one renderer of member text and was not found",
    ).toBe(true);
  });

  it("carries no dangerous HTML injection anywhere", () => {
    const offenders: string[] = [];

    for (const file of files) {
      if (ALLOWED.includes(file)) continue;
      // 🚨 Through `blankComments()`, never a raw grep: `member-text.tsx`'s
      // header NAMES the forbidden call in order to say it is never used, and a
      // scan that flagged that would push the next person to delete the
      // explanation instead of keeping the rule. Blanking rather than removing
      // keeps `:line` honest.
      const source = withoutComments(readFileSync(join(ROOT, file), "utf8"));
      source.split(/\r?\n/).forEach((line, index) => {
        if (line.includes(NEEDLE)) offenders.push(`${file}:${index + 1}`);
      });
    }

    expect(
      offenders,
      `text a member typed is rendered in this tree, so raw HTML must not be. ` +
        `The renderer is modules/courses/components/member-text.tsx and it renders ` +
        `React text nodes and nothing else — read its header before changing this.`,
    ).toEqual([]);
  });

  it("keeps the whole tree pointed at the one renderer", () => {
    // A second answer to "how is a hand-in drawn" is how the defence stops
    // being one thing. The paragraph split carries a measured bug fix (`\r?\n`,
    // because a browser submits a textarea with CRLF), and the copy that would
    // have missed it is the one nobody edits.
    const reimplementers = files.filter(
      (file) =>
        !file.endsWith(join("components", "member-text.tsx")) &&
        /\(\?:\\r\?\\n\)\{2,\}/.test(withoutComments(readFileSync(join(ROOT, file), "utf8"))),
    );

    expect(
      reimplementers,
      "the paragraph split has exactly one home, modules/courses/components/member-text.tsx. " +
        "A second copy is a second rendering policy.",
    ).toEqual([]);
  });
});
