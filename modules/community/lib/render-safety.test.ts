// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The guard that keeps member-written text from becoming markup.
//
// The community is the first thing this template ships that STORES text one
// person wrote and shows it to another. Everywhere else, what ends up on a
// page is either the operator's own copy or a name that went through a
// validator; here it is prose from a stranger, and it is the module's named
// risk.
//
// The defence is three-layered, and the two layers a test can hold are held
// here and in `rules.test.ts`:
//
//   1. React escapes text children by construction — nothing to enforce.
//   2. `postSegments()` whitelists the schemes that may become an `href`
//      (`rules.test.ts` proves `javascript:` and `data:` stay text).
//   3. **Nothing in the community tree may reach for
//      `dangerouslySetInnerHTML`.** That is this file.
//
// Layer 3 is aimed at the future rather than at today. Nobody writes an XSS on
// purpose; what happens is that six months from now somebody adds markdown
// "just for bold", reaches for a renderer that returns HTML, and every review
// nods it through because the diff is small and the feature is nice. Then the
// build has to be the one saying no.
//
// Same shape as `lib/ai/providers/leak-guard.test.ts` (a rule nobody can
// remember, enforced by something that reads the tree) and the same
// non-vacuity stance: a walk that finds no files must FAIL, because a broken
// path would otherwise be indistinguishable from a clean tree.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { blankComments as withoutComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** The trees that render member-written text. */
const SCANNED = [
  join("modules", "community", "components"),
  join("modules", "community", "pages"),
  // The OPERATOR's tree renders group names and descriptions. Operator copy is
  // not the stored-XSS surface member posts are — but this file's stated
  // purpose is aimed at the future rather than at today, and the admin tree is
  // exactly where somebody adds a rich-text description editor first. Leaving
  // it out meant the guard passed on the eight files it did see and said
  // nothing about the three it did not.
  join("modules", "community", "admin"),
];

/**
 * The forbidden call, built from halves.
 *
 * Spelled in one piece, this file would match itself and every run would fail
 * on its own source. The `scripts/knowledge-boundary.test.ts` trick, for the
 * same reason.
 */
const NEEDLE = "dangerously" + "SetInnerHTML";

/**
 * Files allowed to carry it. **Empty, and it is meant to stay empty.**
 *
 * An entry here is a decision that some part of the community renders HTML
 * somebody else wrote. If that ever becomes the right answer, the sanitiser,
 * its allow-list and its own tests come first, and the reasoning goes in this
 * comment — not in a commit message nobody will find.
 */
const ALLOWED: string[] = [];

/**
 * The file with its comments blanked out, line numbers preserved.
 *
 * Necessary rather than tidy: `post-body.tsx`'s header NAMES the forbidden
 * call in order to explain why it is forbidden, and a scan that flagged that
 * would push the next person to delete the explanation instead of keeping the
 * rule. Blanking rather than removing keeps `:line` in the message honest.
 *
 * Line comments FIRST — the reverse order breaks on a `//` comment containing
 * a `/*`, which opens a phantom block that swallows every line down to the
 * next close. Measured in `scripts/core/purity.test.ts`; same order here.
 */
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

describe("member-written text never becomes markup", () => {
  const files = SCANNED.flatMap((dir) => [...sourceFiles(dir)]);

  it("finds the community's rendering tree at all", () => {
    // Non-vacuity. A renamed directory would otherwise make this whole file
    // pass by scanning nothing, which is the failure mode of every
    // grep-the-tree test.
    expect(
      files.length,
      `no source files under ${SCANNED.join(", ")} — did the tree move? ` +
        `This test passes vacuously if it scans nothing, so fix the paths.`,
    ).toBeGreaterThan(3);
    expect(
      files.some((file) => file.endsWith(join("components", "post-body.tsx"))),
      "post-body.tsx is the one renderer of member text and was not found",
    ).toBe(true);
  });

  it("carries no dangerous HTML injection anywhere", () => {
    const offenders: string[] = [];

    for (const file of files) {
      if (ALLOWED.includes(file)) continue;
      const source = withoutComments(readFileSync(join(ROOT, file), "utf8"));
      source.split(/\r?\n/).forEach((line, index) => {
        if (line.includes(NEEDLE)) offenders.push(`${file}:${index + 1}`);
      });
    }

    expect(
      offenders,
      `member-written text is rendered in this tree, so raw HTML must not be. ` +
        `The renderer is modules/community/components/post-body.tsx and it renders ` +
        `React text nodes plus scheme-whitelisted links — read its header ` +
        `before changing this.`,
    ).toEqual([]);
  });

  it("keeps the whole tree pointed at the one renderer", () => {
    // A second answer to "how is a post drawn" is how the three layers above
    // stop being three layers. Anything rendering `content` outside
    // `post-body.tsx` has to go through `postSegments()` — this pins the
    // cheaper half: nobody re-implements the segmenting.
    const reimplementers = files.filter(
      (file) =>
        !file.endsWith(join("components", "post-body.tsx")) &&
        withoutComments(readFileSync(join(ROOT, file), "utf8")).includes(
          "postSegments(",
        ),
    );

    expect(
      reimplementers,
      "postSegments() has exactly one consumer, modules/community/components/post-body.tsx. " +
        "A second one is a second rendering policy.",
    ).toEqual([]);
  });
});
