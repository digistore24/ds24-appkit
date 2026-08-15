// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The comment blanker, and the rule that keeps there being ONE of it.
//
// `scripts/lib/source-text.mjs` explains what it does and why it exists. This
// file measures the two things prose cannot: that the phantom-block bug is
// really gone, and that nobody has quietly written a seventeenth copy.
//
// The count is not rhetoric. Sixteen local definitions existed, in four
// behaviours, and the differences were invisible: every one of them "blanked the
// comments", and three of them could swallow arbitrary amounts of code while
// reporting success.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  blankComments,
  blankCommentsFor,
  blankEmittedCode,
  isQuotedMention,
} from "./source-text.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

describe("blankComments", () => {
  it("blanks a line comment and keeps the code beside it", () => {
    const source = "const a = 1; // and a note";
    const blanked = blankComments(source);
    expect(blanked).not.toContain("and a note");
    expect(blanked.trimEnd()).toBe("const a = 1;");
    // Same length, so a column offset into the line still points at the same
    // character. Asserted rather than counted by hand — the count was wrong once.
    expect(blanked).toHaveLength(source.length);
  });

  it("keeps every line, so a reported line number is still right", () => {
    // `ux-check` prints line numbers to a customer and `portability.test.ts`
    // names a file and line. Stripping would shift both.
    const source = "a\n// gone\nb\n/* also\n   gone */\nc";
    const blanked = blankComments(source);
    expect(blanked.split("\n")).toHaveLength(6);
    expect(blanked.split("\n")[0]).toBe("a");
    expect(blanked.split("\n")[2]).toBe("b");
    expect(blanked.split("\n")[5]).toBe("c");
    expect(blanked).not.toContain("gone");
  });

  it("does not mistake a URL for a comment", () => {
    // `https://…` inside a string is not a comment, and blanking from there
    // would eat the rest of a line that may hold the needle.
    const source = 'const u = "https://example.com/x"; const bad = 1;';
    expect(blankComments(source)).toContain("https://example.com/x");
    expect(blankComments(source)).toContain("const bad = 1;");
  });

  it("🚨 a line comment containing /* does not swallow the code after it", () => {
    // THE bug, and the reason this module exists. `messages/*.json` is a natural
    // thing to write in a comment — 39 files in this tree do — and with block
    // comments blanked FIRST it opens a phantom block that runs to the next real
    // `*/`, taking every line in between out of the checker's sight.
    //
    // Measured before the fix: a `sql<Date>` planted eighteen lines into
    // `lib/digistore/purchase-notice.ts` left `db/sql-cast.test.ts` PASSING.
    const source = [
      "// the texts live in `messages/*.json`",
      "const forbidden = sql<Date>`now()`;",
      "/** an ordinary doc comment */",
      "const after = 2;",
    ].join("\n");

    const blanked = blankComments(source);
    expect(blanked, "the line after the comment was swallowed").toContain("sql<Date>");
    expect(blanked, "the code after the doc comment was swallowed").toContain("const after = 2;");
    expect(blanked).not.toContain("messages/*.json");
    expect(blanked).not.toContain("an ordinary doc comment");
  });

  it("blanks a JSX comment's content", () => {
    const blanked = blankComments("<div>{/* a note */}</div>");
    expect(blanked).not.toContain("a note");
    // The braces stay. No checker here looks for a bare `{}` as a needle, and
    // blanking the contents is the whole job.
    expect(blanked).toContain("<div>{");
  });

  it("does not merge two block comments on one line", () => {
    const blanked = blankComments("a /* one */ KEEP /* two */ b");
    expect(blanked).toContain("KEEP");
  });

  it("🚨 does not eat a recursive glob — an empty block is not a comment here", () => {
    // Measured on 2026-08-15, and it had a victim. `**/` is how every
    // `outputFileTracingIncludes` entry, every vitest pattern and every
    // `tsconfig` include is written, and the block-comment regex read the `/`
    // before the stars as an opener: `"./content/knowledge-media/**/*"` came
    // back `"./content/knowledge-media    *"`, which turned the assertion that
    // the knowledge-media disk leg is traced into a standalone build RED on a
    // tree where it is traced.
    //
    // Same family as the phantom block in the header, one level down: there a
    // comment looked like data, here data looks like a comment.
    const glob = 'const t = { "/api/chat": ["./content/knowledge/**/*"] };';
    expect(blankComments(glob)).toBe(glob);
    expect(blankComments('"./a/**/b/**/c"')).toBe('"./a/**/b/**/c"');
    // …and a real comment on the same line is still blanked, so the lookahead
    // did not buy the glob by switching the rule off.
    expect(blankComments('["./x/**/*"] /* gone */')).not.toContain("gone");
    expect(blankComments('["./x/**/*"] /* gone */')).toContain("./x/**/*");
  });

  it("still blanks a JSDoc, which starts with the same two characters", () => {
    // The lookahead is `(?!\*\/)`, not `(?!\*)` — a one-character difference
    // that would have exempted every JSDoc in the tree and made the guard a
    // no-op on the files that explain themselves most.
    const doc = "/** the reason */\nconst a = 1;";
    expect(blankComments(doc)).not.toContain("the reason");
    expect(blankComments(doc)).toContain("const a = 1;");
  });
});

describe("blankCommentsFor", () => {
  // The SAME bytes through both answers, so the test is about the file name and
  // nothing else. A doc that spells a comment out to teach it — and this tree's
  // docs do — must come back whole; the source file must not.
  const BYTES = "keep\n// gone\nkeep";

  it("blanks a source file", () => {
    expect(blankCommentsFor("lib/env-guard.ts", BYTES)).not.toContain("gone");
    expect(blankCommentsFor("run.mjs", BYTES)).not.toContain("gone");
    expect(blankCommentsFor("components/app-shell.tsx", BYTES)).not.toContain("gone");
  });

  it("🚨 leaves markdown alone — in a doc the prose IS the subject", () => {
    // The half a blind wrapper would break. `scripts/docs-coverage.test.ts` and
    // `scripts/setup.test.ts` assert on sentences in these files; blanking one
    // does not make a guard noisy, it makes it read a doc that is not there.
    expect(blankCommentsFor("docs/DEPLOY.md", BYTES)).toBe(BYTES);
    expect(blankCommentsFor(".claude/skills/build-app/SKILL.md", BYTES)).toBe(BYTES);
    expect(blankCommentsFor("CLAUDE.md", BYTES)).toBe(BYTES);
  });

  it("leaves the data files a mixed corpus also carries", () => {
    // Read through the same `read()` as the source above: `setup.test.ts` reads
    // `.env.example` and `package.json`, `docs-coverage.test.ts` reads
    // `module.json` and `.template-version`.
    expect(blankCommentsFor("package.json", BYTES)).toBe(BYTES);
    expect(blankCommentsFor(".env.example", BYTES)).toBe(BYTES);
    expect(blankCommentsFor("config/cron.yaml", BYTES)).toBe(BYTES);
  });

  it("treats an unknown extension as code, and that is the safe direction", () => {
    // A code extension nobody added to the list would silently stop being
    // blanked — the exact hole this module closes. An unlisted DATA format gets
    // blanked instead, and a damaged assertion is visible where a silent guard
    // is not. `.template-version` has no extension at all and is JSON; it is
    // read for a version number, which no comment can contain.
    expect(blankCommentsFor("something.cjs", BYTES)).not.toContain("gone");
    expect(blankCommentsFor("no-extension-at-all", BYTES)).not.toContain("gone");
  });

  it("answers on the extension, not on the path around it", () => {
    // A directory called `docs/` holding a `.ts`, and a `.md` under `lib/`.
    expect(blankCommentsFor("docs/appliers/example.ts", BYTES)).not.toContain("gone");
    expect(blankCommentsFor("lib/media/README.md", BYTES)).toBe(BYTES);
    // Case, because a checker may be handed a name off a Windows disk.
    expect(blankCommentsFor("docs/DEPLOY.MD", BYTES)).toBe(BYTES);
  });
});

describe("blankEmittedCode", () => {
  it("blanks source a file EMITS, so a scanner does not read it as its own", () => {
    // `scripts/modules/generate.mjs` writes import statements as strings. A
    // scanner reading those as the file's own imports went looking for
    // `scripts/modules/types` and threw ENOENT.
    const source = [
      'const line = \'import type { X } from "./types";\';',
      'import { real } from "./registry.mjs";',
    ].join("\n");

    const blanked = blankEmittedCode(source);
    expect(blanked).not.toContain("./types");
    expect(blanked, "the file's OWN import must survive").toContain("./registry.mjs");
  });

  it("blanks a template literal's contents and keeps its lines", () => {
    const blanked = blankEmittedCode("const t = `line one\nline two`;\nconst after = 1;");
    expect(blanked).not.toContain("line one");
    expect(blanked.split("\n")).toHaveLength(3);
    expect(blanked).toContain("const after = 1;");
  });

  it("leaves double-quoted strings alone", () => {
    // Deliberate: import specifiers are double-quoted, which is what makes them
    // separable from the emitted code above.
    expect(blankEmittedCode('import x from "@/lib/y";')).toContain("@/lib/y");
  });
});

describe("isQuotedMention", () => {
  /** Where `needle` starts in `source` — the offset a `matchAll()` would hand over. */
  const at = (source: string, needle: string) => source.indexOf(needle);
  const NEEDLE = "process.env.OPENAI_API_KEY";

  it("says no for a real read", () => {
    const source = `const key = ${NEEDLE};`;
    expect(isQuotedMention(source, at(source, NEEDLE))).toBe(false);
  });

  it("🚨 says no for the BRACKET form, whose name is inside a string", () => {
    // The whole reason this is a position question rather than a `blankStrings()`.
    // `process.env["OPENAI_API_KEY"]` is a read; the match starts at `process`,
    // outside the quote. Blanking strings would have erased the name and left
    // the guard reporting success over a real leak.
    const source = 'const key = process.env["OPENAI_API_KEY"];';
    expect(isQuotedMention(source, at(source, "process.env["))).toBe(false);
  });

  it("says yes for a quoted mention in a message or a fixture", () => {
    // Both shapes exist in this tree today with other variables:
    // `scripts/lib/env.test.ts` writes one into an assertion message,
    // `scripts/security/rungs.test.ts` into a fixture.
    for (const source of [
      `throw new Error("set ${NEEDLE} in .env");`,
      `expect(namesIn('${NEEDLE}')).toEqual(["OPENAI_API_KEY"]);`,
    ]) {
      expect(isQuotedMention(source, at(source, NEEDLE))).toBe(true);
    }
  });

  it("🚨 reports rather than excuses when a quote never closes", () => {
    // A regex literal opens a quote that has no partner. Everything after it
    // would look like string content, so a real read on that line would vanish
    // — a silent guard, which is the failure this must not have.
    const source = `const q = /["']/; const key = ${NEEDLE};`;
    expect(isQuotedMention(source, at(source, NEEDLE))).toBe(false);
  });

  it("answers per line, so a previous line's string cannot reach", () => {
    const source = `const label = "a string";\nconst key = ${NEEDLE};`;
    expect(isQuotedMention(source, at(source, NEEDLE))).toBe(false);
  });

  it("is not fooled by an apostrophe inside a double-quoted string", () => {
    const source = `const t = "don't"; const key = ${NEEDLE};`;
    expect(isQuotedMention(source, at(source, NEEDLE))).toBe(false);
  });
});

// ── the rule that keeps it one copy ─────────────────────────────────────────

describe("🚨 nothing defines its own comment blanker", () => {
  const SKIP_DIRS = new Set(["node_modules", ".next", ".dev", "dist"]);
  const SCANNED = ["app", "lib", "components", "hooks", "db", "scripts", "i18n", "modules"];

  function* sourceFiles(dir: string): Generator<string> {
    let entries: string[];
    try {
      entries = readdirSync(join(ROOT, dir));
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const rel = join(dir, entry);
      if (statSync(join(ROOT, rel)).isDirectory()) yield* sourceFiles(rel);
      else if (/\.(ts|tsx|mjs)$/.test(entry)) yield rel;
    }
  }

  /**
   * The FLAT files at the app root as well — `proxy.test.ts`, `auth.config.ts`,
   * `instrumentation.ts`, `run.mjs`.
   *
   * ⚠️ Not decoration. `SCANNED` is a list of DIRECTORIES, and `proxy.test.ts`
   * lives beside them rather than in one — so it carried a copy of the blanker
   * this rule forbids and was outside the walk that would have said so. A list of
   * places to look is only as good as the place nobody thought to name.
   */
  const rootFiles = (): string[] =>
    readdirSync(ROOT).filter(
      (entry) =>
        /\.(ts|tsx|mjs)$/.test(entry) && !statSync(join(ROOT, entry)).isDirectory(),
    );

  const ALL = [...SCANNED.flatMap((dir) => [...sourceFiles(dir)]), ...rootFiles()];

  /** The one file allowed to contain the implementation. */
  const HOME = join("scripts", "lib", "source-text.mjs");

  // The needle: the lazy any-character run a block-comment regex is built from.
  //
  // ⚠️ Two properties, and it is the second that decides how it is written.
  //
  //  1. It has to occur in a real regex LITERAL. An unescaped opener does not —
  //     the literal escapes BOTH slashes, and a needle written as if it did not
  //     never lines up with one character of the tree.
  //  2. It has to SURVIVE `blankComments()`, which is applied first so a file may
  //     discuss the rule. The blanker used to read the escaped-slash-then-
  //     terminator at the END of such a regex as a line comment and blank from
  //     there, which erased any needle reaching that far; that is fixed (the `\\`
  //     in its own guard), but this needle deliberately stops before the closing
  //     delimiter anyway, so the rule does not depend on the fix holding.
  //
  // `it("the needle can be found at all")` measures both rather than trusting
  // this paragraph — and note that a JSDoc block cannot state it, because
  // spelling the regex out inside one closes the comment.
  const NEEDLE = "[\\s\\S]*?\\*";

  it("walked the tree", () => {
    // Non-vacuity, the same probe every walk in this repo carries.
    expect(ALL.length).toBeGreaterThan(200);
    expect(ALL.map((f) => relative("", f))).toContain(HOME);
    // …and the root, which is not one of `SCANNED`'s directories. `proxy.test.ts`
    // is the file that proved this needed asserting.
    expect(ALL).toContain("proxy.test.ts");
  });

  it("🚨 the needle can be found at all", () => {
    // 🚨 The assertion below is a `.includes()` over source text, so a needle that
    // no source text can contain makes it pass over every file in the tree — and
    // that is not hypothetical, it is what shipped: written as
    // `"/\\*[\\s\\S]*?\\*/"`, the needle was `/\*[\s\S]*?\*/`, and a real block
    // comment regex is written `/\/\*[\s\S]*?\*\//g` — the closing slash escaped,
    // so the two never line up. Sixteen copies were removed while the guard that
    // was supposed to keep them gone could not see a single one.
    //
    // So the needle is measured against the one file that legitimately has it.
    // A guard whose probe cannot fire is worse than no guard: it reports success.
    expect(blankComments(readFileSync(join(ROOT, HOME), "utf8"))).toContain(NEEDLE);
  });

  it("has no second implementation anywhere", () => {
    const offenders: string[] = [];

    for (const file of ALL) {
      if (file === HOME || file === join("scripts", "lib", "source-text.test.ts")) continue;
      const source = readFileSync(join(ROOT, file), "utf8");
      // Its own comments blanked first — a file may DISCUSS the regex, and this
      // one does. Which is the rule this whole module is about, applied to itself.
      if (blankComments(source).includes(NEEDLE)) {
        offenders.push(file.split(/[\\/]/).join("/"));
      }
    }

    expect(
      offenders,
      "these files carry their own comment-blanking regex:\n" +
        offenders.map((f) => `  ${f}`).join("\n") +
        "\n\nImport `blankComments` (or `blankEmittedCode`) from " +
        "scripts/lib/source-text.mjs instead. This was sixteen copies in four " +
        "behaviours, and the differences were invisible: three of them let a `//` " +
        "comment containing `/*` swallow every line down to the next `*/`, so the " +
        "checker passed while reading none of it.",
    ).toEqual([]);
  });
});
