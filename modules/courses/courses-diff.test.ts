// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 "It writes nothing" is a claim, and a claim in a header is not evidence.
//
// `courses-diff` is a PREVIEW. Everything about it — its name, its output, the
// sentence under its target-only list — tells an operator that running it is
// free. Nothing in this template can make that true by intention, so the three
// ways it could stop being true are asked of the file itself:
//
//   1. it cannot open a database, because no driver is in its import graph;
//   2. every setup tool it names carries `mutates: false` in the registry;
//   3. its own source performs no filesystem write.
//
// It READS the command; it never runs it. Running it would need a network, an
// environment and a key — and would test the target rather than the command.
//
// 🚨 Every regex below runs over `blankComments(source)`, never over the raw
// text. A checker that greps source punishes a file for explaining itself, and
// this command's header explains at length that it writes nothing.
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { resolveImport } from "@/scripts/lib/import-graph.mjs";
import { blankComments, blankEmittedCode } from "@/scripts/lib/source-text.mjs";
import { ALL_SETUP_TOOLS } from "@/lib/setup/registry";
import { SETUP_ERROR_CODES } from "@/lib/setup/rules";
import { callSetup } from "@/scripts/setup/client.mjs";

import moduleTools from "./setup/tools";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const COMMAND = join(HERE, "courses-diff.mjs");
const source = readFileSync(COMMAND, "utf8");
/** The file's own code: comments blanked, so a file may EXPLAIN a rule it keeps. */
const code = blankComments(source);

describe("AC5.1 — it opens no database, because it cannot", () => {
  /**
   * Static import specifiers of a `.mjs` file — `await import()` is not one.
   *
   * ⚠️ Two alternatives rather than one pattern with an optional `from` clause:
   * `[\s\S]*?\s+from\s+` crosses newlines, so a bare `import "./x.mjs"` reads the
   * NEXT line's `from` and reports the wrong specifier. The shape
   * `scripts/lib/env.test.ts` measured, borrowed rather than re-derived.
   */
  const staticImports = (text: string): string[] =>
    [...blankEmittedCode(text).matchAll(/from\s+"([^"]+)"|import\s+"([^"]+)"/g)].map(
      (m) => m[1] ?? m[2],
    );

  /** Everything reachable from a file by STATIC imports. */
  const closureOf = (entry: string): Map<string, string[]> => {
    const seen = new Map<string, string[]>();
    const queue = [resolve(entry)];
    while (queue.length > 0) {
      const file = queue.shift()!;
      if (seen.has(file)) continue;
      const specifiers = staticImports(readFileSync(file, "utf8"));
      seen.set(file, specifiers);
      for (const specifier of specifiers) {
        const target = resolveImport(file, specifier, { root: ROOT });
        if (target?.exists) queue.push(target.path);
      }
    }
    return seen;
  };

  it("reaches no npm package at all, transitively", () => {
    const closure = closureOf(COMMAND);

    // Non-vacuity: a closure of one file would pass this while walking nothing.
    expect(closure.size, "the import walk found only courses-diff.mjs").toBeGreaterThan(3);
    const walked = [...closure.keys()].map((f) => relative(ROOT, f).split(/[\\/]/).join("/"));
    expect(walked, "the comparison itself was not walked").toContain(
      "modules/courses/lib/diff.mjs",
    );
    expect(walked, "the applier's reader was not walked").toContain(
      "modules/courses/content/appliers/course.mjs",
    );

    const offenders: string[] = [];
    for (const [file, specifiers] of closure) {
      for (const specifier of specifiers) {
        if (specifier.startsWith(".")) continue;
        if (specifier.startsWith("node:")) continue;
        offenders.push(`${relative(ROOT, file)} imports "${specifier}"`);
      }
    }
    expect(
      offenders,
      "courses-diff's static import graph reaches an npm package:\n" +
        offenders.join("\n") +
        "\nThis command is a PREVIEW and must be unable to write. A driver in its " +
        "graph is a connection it could open, and `postgres` in particular would " +
        "also break the command on a freshly cloned tree — Node resolves the whole " +
        "graph before running a line.",
    ).toEqual([]);
  });

  it("names neither the driver nor the app's database handle", () => {
    // Said by name as well as by rule, because these two are the ones that would
    // come back — and the error a general rule gives is worse.
    const closure = closureOf(COMMAND);
    for (const [file, specifiers] of closure) {
      for (const forbidden of ["postgres", "@/db", "@/db/index", "../../db", "drizzle-orm"]) {
        expect(specifiers, `${relative(ROOT, file)} imports ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("🚨 the walk sees a planted import", () => {
    // The needle: prove the walk would REPORT one rather than that it found none.
    const planted = `import postgres from "postgres";\n${source}`;
    expect(staticImports(planted)).toContain("postgres");
  });
});

describe("AC5.2 — every setup tool it names is a read tool", () => {
  /**
   * The tool names this command posts.
   *
   * Read out of the `tool:` position of the body it sends, over blanked code —
   * the name is a literal at the call site precisely so this can be asked of the
   * thing itself rather than of a constant one indirection away.
   */
  const named = [...code.matchAll(/\btool:\s*"([^"]+)"/g)].map((m) => m[1]);

  /**
   * Every tool that exists in an app with this module installed.
   *
   * ⚠️ `ALL_SETUP_TOOLS` alone is not the right set to look in: the generated
   * module registry is EMPTY in the shipped template (`config/modules.json` has
   * no modules), so a lookup there would fail for `courses_outline` in exactly
   * the app this test ships in. The module's own `TOOLS` are what it contributes
   * once installed, and this test lives inside the module.
   */
  const byName = new Map(
    [...ALL_SETUP_TOOLS, ...moduleTools.TOOLS].map((tool) => [tool.name, tool]),
  );

  it("names at least one tool", () => {
    // Non-vacuity: a command that posts nothing would pass every assertion below.
    expect(named, "no `tool:` literal found in courses-diff.mjs").not.toEqual([]);
  });

  it("🚨 every one of them exists, and carries mutates: false", () => {
    for (const name of named) {
      const tool = byName.get(name);
      expect(tool, `courses-diff posts "${name}", which is not a setup tool at all`).toBeDefined();
      expect(
        tool!.mutates,
        `courses-diff posts "${name}", which MUTATES. This command is a preview: it ` +
          `reads the target and writes nothing, anywhere.`,
      ).toBe(false);
    }
  });

  it("sends no mode and no confirmation — a read tool needs neither", () => {
    // A `mode: "apply"` here would be the shape of a write even if today's tool
    // ignored it.
    expect(code).not.toMatch(/\bmode:\s*"apply"/);
    expect(code).not.toMatch(/\bconfirmation\b/);
    expect(code).not.toMatch(/applyThroughSetup/);
  });
});

describe("AC5.3 — its own source writes no file", () => {
  for (const call of ["writeFile", "writeFileSync", "mkdir", "rm", "rmSync", "unlink", "appendFile", "appendFileSync", "cp", "copyFile", "rename"]) {
    it(`does not call ${call}()`, () => {
      expect(code, `courses-diff.mjs calls ${call}() — it is a preview and writes nothing`).not.toMatch(
        new RegExp(`\\b${call}\\s*\\(`),
      );
    });
  }

  it("🚨 the check would see a planted write", () => {
    // Non-vacuity: the assertions above pass on an empty string too.
    expect(blankComments(`${source}\nwriteFileSync("x", "y");\n`)).toMatch(/\bwriteFileSync\s*\(/);
  });

  it("does not punish the file for EXPLAINING that it writes nothing", () => {
    // The comment blanking, measured rather than assumed: the header says the
    // word, the code does not.
    expect(source).toContain("no file in this repo");
    expect(blankComments("// writeFileSync is what this file never calls\n")).not.toMatch(
      /\bwriteFileSync\s*\(/,
    );
  });
});

describe("AC4 — five answers, and none of them is 'everything is new'", () => {
  it("🚨 has a branch for unknownTool, and says what it means", () => {
    // The fifth refusal, and the only one this command adds. Without it a target
    // WITHOUT the courses module answers zero lessons and the report reads
    // "all N lessons are new" — a publish proposed into an app whose database
    // has no courses_units table.
    expect(code, "the unknownTool branch is gone").toContain('answer.code === "unknownTool"');
    expect(source).toMatch(/courses module is NOT installed there/);
    expect(source).toMatch(/module add courses/);
  });

  it("`unknownTool` is the code the app really sends", () => {
    // Verified against `lib/setup/rules.ts`, not against a sentence in a story.
    expect(SETUP_ERROR_CODES).toContain("unknownTool");
  });

  it("and `callSetup` really hands that code back", async () => {
    // The premise of the branch above, produced rather than assumed: a 404 WITH
    // a JSON body is a refusal carrying the app's own code.
    const answer = await callSetup(
      "production",
      { tool: "courses_outline" },
      {
        env: { APP_URL_PROD: "https://app.example.com", SETUP_KEY_PROD: "ds24setup_x" },
        fetch: async () =>
          new Response(JSON.stringify({ error: "unknownTool" }), { status: 404 }),
      },
    );
    expect(answer.ok).toBe(false);
    expect((answer as { code?: string }).code).toBe("unknownTool");
  });

  it("prints no lists on any refusal — it exits first", () => {
    // Every refusal path ends in `process.exit`, before the first heading is
    // printed. Half a comparison is not a smaller comparison, it is a wrong one.
    const beforeFirstList = code.slice(0, code.indexOf("This repo against"));
    expect(beforeFirstList).toMatch(/process\.exit\(reportRefusal\(answer\)\)/);
    expect(beforeFirstList).toMatch(/process\.exit\(2\)/);
  });

  it("does not resolve the environment itself", () => {
    // The env table, the `--env` spellings and four of the five refusals belong
    // to `scripts/setup/client.mjs`. A second copy is how "unreachable", "the
    // surface is off there" and "refused" stop being three different answers.
    expect(code).toContain("resolveEnvName");
    expect(code).not.toMatch(/APP_URL_PROD|SETUP_KEY_PROD/);
  });
});

describe("Story 35.3 — the question is printed, and asked by nobody here", () => {
  it("🚨 asks nothing on stdin — the question belongs to the agent, in the conversation", () => {
    // ⛔ A command that prompted would be unusable from an agent session and
    // untestable in CI, and it would be a second decision surface beside the
    // skill. This is the assertion that keeps it that way.
    for (const way of ["readline", "process.stdin", "prompt(", "createInterface", "question("]) {
      expect(code, `courses-diff reaches for ${way} — it must ask nothing`).not.toContain(way);
    }
  });

  it("pairs come from the shared pure matcher, never from a second one here", () => {
    // `sameSubjectPairs()` lives beside `compareCourse()` so it can be tested
    // without a network — and so there is one definition of "the same subject"
    // rather than two that agree today.
    expect(code).toMatch(/import\s*\{[^}]*sameSubjectPairs[^}]*\}\s*from\s*"\.\/lib\/diff\.mjs"/);
    // …and the rule itself is NOT re-spelled in this file.
    expect(code).not.toContain("toLowerCase");
    expect(code).not.toContain("levenshtein");
    expect(code).not.toContain(".includes(");
  });

  it("prints the section only when there is at least one pair", () => {
    // An empty "same subject" heading on every run trains its reader to skip the
    // one run where it is not empty.
    expect(code).toMatch(/pairs\.length\s*>\s*0/);
  });

  it("names BOTH consequences, in the operator's terms", () => {
    // The update side promises progress survives — true because the state tables
    // key on slugs (`schema.ts`: `courses_completions.unit_slug`).
    expect(source).toContain("update that one");
    expect(source).toContain("progress is keyed by SLUG");
    // The second-one side names what is real in THIS app, including position.
    expect(source).toContain("a second one");
    expect(source).toContain("The existing rows are untouched");
    expect(source).toContain("decides where it appears");
  });

  it("🚨 says the third consequence rather than implying it — same course, same buyers", () => {
    // 🚨 **This claim INVERTED in Story 44.2 and the test inverted with it.** It
    // used to read "this app sells ONE course under ONE product key, so a second
    // set of blocks is visible to the same buyers" — a true sentence about a
    // capability that was absent. The capability is now present, so the same
    // sentence would be the opposite mistake: a reader would take "you cannot
    // sell this separately" as the answer and never look for the way to.
    //
    // What has to survive is the SHAPE of the warning, not its verdict: adding
    // blocks inside one course changes who sees them not at all, and the reader
    // is told what to do instead rather than left to infer it.
    expect(source).toContain("Inside ONE course");
    expect(source).toContain("the SAME buyers as the old one");
    expect(source).toContain("means a second course");
    expect(source).toContain("its own planKeys");
  });

  it("🚨 chooses the refusal line from `origin`, and tells 'not ours' from 'not sent' apart", () => {
    // NFR-60 inside one section: an app that never sent `origin` must not be
    // reported as one whose row the applier may write.
    expect(code).toMatch(/pair\.target\.origin === "content"/);
    expect(source).toContain("NOT POSSIBLE");
    expect(source).toContain("NOT KNOWN from here");
    // The refusal quotes the applier's own two ways out, as the list above does.
    expect(source).toContain("REFUSES the whole publish before applying anything");
  });

  it("says in words that the answer is a slug in a file, never a flag", () => {
    // NFR-59 in the output itself: the applier stays the only writer of those
    // rows, keyed by slug, from files in the repo (AD-82).
    expect(source).toContain("editing the slug in content/course/*.json");
    expect(source).toContain("never with a flag");
  });

  it("says why a matching slug is NOT in the list", () => {
    expect(source).toContain("Matching slugs are NOT in this list");
  });
});

describe("the command is a preview and not a gate", () => {
  it("exits 0 once the target was read, whatever the lists say", () => {
    // A `process.exit(1)` after the report would make a course that differs an
    // error — and a preview that fails the shell is one somebody stops running.
    const afterReport = code.slice(code.indexOf("This repo against"));
    expect(afterReport).not.toMatch(/process\.exit\(/);
  });

  it("proposes nothing — no --fix, no --write, no --apply", () => {
    for (const flag of ["--fix", "--write", "--apply"]) {
      expect(code, `courses-diff offers ${flag}`).not.toContain(flag);
    }
  });

  it("says in words that publishing deletes nothing", () => {
    expect(source).toContain("publishing will not delete anything — nothing here removes a row");
  });

  it("quotes the applier's own two ways out of a refusal", () => {
    expect(source).toContain("change the slug in the");
    expect(source).toContain("delete the operator-authored row");
  });

  it("loads the .env before anything else", () => {
    // `module remove` could never see the database because `cli.mjs` read
    // `process.env` without this. Asked here rather than assumed.
    const imports = [...code.matchAll(/from\s+"([^"]+)"|import\s+"([^"]+)"/g)].map(
      (m) => m[1] ?? m[2],
    );
    expect(imports[0]).toBe("../../scripts/lib/env.mjs");
  });
});
