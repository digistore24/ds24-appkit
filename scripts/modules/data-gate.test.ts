// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The gate between uninstalling a module and losing the ability to answer
// for its data.
//
// The module system can make a FEATURE absent. It cannot make the ROWS absent:
// a module that ran for a year leaves its tables behind with everything members
// wrote in them, and an app that no longer knows about them cannot name them in
// a subject access request — a worse position than the hand-edited arrangement
// this whole system replaces.
//
// There is no code-level fix, only a product decision — *a module is chosen
// before the first row is written, never after* — and these are the assertions
// that keep it a decision rather than a footnote.
//
// The four paths were also exercised end to end against a real database before
// this file existed: no DATABASE_URL → refused; empty → removed; one row →
// refused with the count; `--drop-data` → dropped, recorded, table gone.
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { resolveImport } from "@/scripts/lib/import-graph.mjs";
import { blankEmittedCode } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const cli = read("scripts/modules/cli.mjs");
const gate = read("scripts/modules/data-gate.mjs");

describe("🚨 remove looks in the database before it does anything", () => {
  it("refuses when it cannot look at all", () => {
    // "I could not look" and "there is nothing there" are the same colour and
    // must never be the same answer.
    expect(cli).toContain("DATABASE_URL is not set, so there is no way to see whether");
    const noUrl = cli.slice(cli.indexOf("const url = process.env.DATABASE_URL"));
    expect(noUrl.slice(0, 800)).toMatch(/return 1;/);
  });

  it("refuses when the database cannot be reached", () => {
    expect(cli).toContain("Empty cannot be proven without looking");
  });

  it("refuses a module that still holds rows, and prints the counts", () => {
    expect(cli).toMatch(/still holds \$\{counted\.total\} row\(s\)/);
    expect(cli).toContain("counted.counts");
  });

  it("names both lawful ways forward", () => {
    // A refusal that does not say what to do instead gets worked around.
    expect(cli).toContain("Keep it installed and switch it OFF");
    expect(cli).toContain("--drop-data");
    expect(cli).toContain("irreversible");
  });

  it("treats --drop-data as erasure, and WRITES the record", () => {
    // 🚨 This used to assert that the command PRINTS "write this down in
    // docs/app.md". It does not any more, and the reason is the first real use
    // of the flag: the person who built it dropped a row and recorded nothing,
    // because a printed instruction is a thing a person has to do next. An
    // erasure that leaves no trace is the one thing this branch must not be.
    expect(cli).toMatch(/writeRemovalRecord\(id, counted\)/);
    expect(cli).toContain("docs/reports");
    expect(cli).toMatch(/appendFileSync/);
  });

  it("records numbers only", () => {
    // The same rule `cron_runs` follows: what was deleted, how much, and when —
    // never what was in it. Measured on the writer, which is where the shape of
    // the line is decided.
    const writer = cli.slice(cli.indexOf("function writeRemovalRecord"));
    const body = writer.slice(0, writer.indexOf("\nasync function"));
    expect(body).toContain("counted.counts");
    // The only interpolations in the appended line are the date, the module id
    // and the per-table counts. An address, a name or anything somebody typed
    // would be a person's data in a file kept for an audit.
    expect(body).not.toMatch(/email|memberId|\bnote\b|content/i);
  });

  it("appends rather than rewrites", () => {
    // A history, not a state. Rewriting would mean the second removal erased
    // the record of the first — which is the failure this file guards against,
    // aimed at itself.
    const writer = cli.slice(cli.indexOf("function writeRemovalRecord"));
    const body = writer.slice(0, writer.indexOf("\nasync function"));
    expect(body).toContain("appendFileSync");
    expect(body, "the record is being overwritten").not.toMatch(
      /writeFileSync\(path,\s*`- /,
    );
  });
});

describe("dropping takes the journal with it", () => {
  it("drops the module's migration journal, not only its tables", () => {
    // 🚨 Without this a module re-installed later has its own `0000` considered
    // "already applied", and its tables never come back — silently, which is
    // the failure mode this whole design is built around.
    expect(gate).toMatch(/drop table if exists drizzle\.\$\{tx\(journal\)\}/);
  });

  it("🚨 takes the module's own TYPES with it", () => {
    // Found by the first module with an enum column. A `CREATE TYPE` is not
    // undone by dropping the table that used it, so the type survived an
    // uninstall — and the next `module add` + `db-migrate` failed on
    // `CREATE TYPE ... AS ENUM`, with a Postgres error and nothing pointing at
    // the uninstall that had left it behind.
    expect(gate).toMatch(/drop type if exists \$\{tx\(type\)\}/);
    // NOT `cascade`: a plain `drop type` refuses while a column still uses it,
    // so a type something else adopted makes the uninstall fail loudly instead
    // of quietly taking that column with it.
    expect(gate).not.toMatch(/drop type if exists \$\{tx\(type\)\} cascade/);
  });

  it("reads the types out of the module's SQL, not out of its manifest", () => {
    // A manifest field would be a second place to keep in step, and the one a
    // human maintains is the one that goes stale. The chain is generated from
    // the schema, so this reads the same truth the database was built from.
    expect(gate).toMatch(/export function moduleTypes/);
    expect(gate).toMatch(/CREATE TYPE "public"/);
  });

  it("drops in one transaction", () => {
    // Half-dropped is a state nobody can reason about.
    expect(gate).toMatch(/sql\.begin\(async \(tx\)/);
  });
});

describe("counting is honest about a table that is not there", () => {
  it("treats a missing table as zero rows rather than an error", () => {
    // A module installed but never migrated has no tables, and that is zero
    // rows — not a reason to refuse.
    expect(gate).toContain("information_schema.tables");
    expect(gate).toMatch(/if \(!exists\)/);
  });
});

describe("the orphan alarm", () => {
  it("reports tables of a module that is NOT installed", () => {
    // The backstop the gate cannot cover: somebody edited config/modules.json
    // by hand, or restored an old copy. Those rows are data the app holds and
    // can no longer answer for.
    expect(cli).toContain("belonging to a module that is not");
    expect(cli).toContain("subject access request");
  });

  it("says so when it could not look, instead of passing quietly", () => {
    expect(cli).toContain("DATABASE_URL is not set, so tables of uninstalled modules were not");
  });
});

describe("add and remove keep the app coherent", () => {
  it("validates a module BEFORE putting it in the list", () => {
    // A broken manifest that reached config/modules.json would make every
    // command that reads the arrangement fail — including the one that explains
    // what is wrong.
    const add = cli.slice(cli.indexOf("async function add()"));
    const validate = add.indexOf("readModule(id)");
    const write = add.indexOf("writeInstalled(");
    expect(validate).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(validate);
  });

  it("regenerates the registries in the same breath", () => {
    // The half-landed install the plan warns about: a tree whose routes exist
    // and whose schema barrel, texts and navigation do not.
    //
    // Sliced to the END of each function rather than a fixed window — a
    // character count that happens to fit today is a test that breaks on the
    // next edit for no reason anybody can read.
    const bodyOf = (fn: string) => {
      const start = cli.indexOf(fn);
      expect(start, `${fn} is gone`).toBeGreaterThan(-1);
      const rest = cli.slice(start + fn.length);
      const end = rest.search(/\n(?:async )?function |\nconst COMMANDS/);
      return rest.slice(0, end === -1 ? undefined : end);
    };
    for (const fn of ["async function add()", "async function remove()"]) {
      expect(bodyOf(fn), fn).toContain("writeGenerated()");
    }
  });

  it("keeps the prose in config/modules.json", () => {
    // The file is 80% comment by design. A rewrite that dropped it would take
    // the reasoning with it.
    expect(cli).toMatch(/JSON\.parse\(readFileSync\(path, "utf8"\)\)/);
    expect(cli).toMatch(/file\.installed = ids/);
  });

  it("tells the user their tables are not there yet", () => {
    expect(cli).toContain("db-migrate");
  });
});

describe("🚨 the module commands run on a tree with no node_modules", () => {
  // The failure this closes, measured rather than imagined: `cli.mjs` imported
  // `data-gate.mjs` at the top, `data-gate.mjs` imports `postgres`, and Node
  // resolves a static import graph before it runs a line. So `module add`,
  // `module list` and `module sync` — none of which touches a database — all died
  // on a fresh clone with
  //
  //     Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'postgres'
  //
  // `module list` is the command `CLAUDE.md` calls the only answer to "what is
  // this app made of", and it was unusable until something else had installed the
  // dependencies first. Found by `make deploy-test-modules`, which installs
  // modules BEFORE `start` because that is the order the migrations force.
  //
  // Same shape as the rule `modules/boundary.test.ts` holds a gate to, one layer
  // out: what may not be in the import graph is decided by what the graph is in
  // front of. Here it is in front of every module command.
  const CLI = join(ROOT, "scripts", "modules", "cli.mjs");

  /**
   * The file's own code — comments blanked, and single-quoted and template
   * strings emptied.
   *
   * 🚨 The strings are not paranoia. `scripts/modules/generate.mjs` GENERATES
   * source: it emits lines like `'import type { ModuleEntry } from "./types";'`
   * and `` `import ${alias} from "@/${dir}/${file}";` ``. A scanner that reads
   * those as this file's own imports goes looking for
   * `scripts/modules/types` (it threw exactly that, `ENOENT`) and reports
   * `@/${record.dir}/…` as an npm package. Import specifiers are double-quoted
   * here, and the emitted code is wrapped in the other two kinds — so blanking
   * those two leaves real imports and removes the quoted ones.
   *
   * It is the same rule as blanking comments, one step further: a text scanner
   * must not punish a file for CONTAINING code any more than for explaining
   * itself. (Nested backticks inside `${…}` would defeat the second pattern;
   * nothing in `scripts/` has one, and the closure below would throw rather than
   * pass quietly if that changed.)
   *
   * ⚠️ It lives in `scripts/lib/source-text.mjs` as `blankEmittedCode()` and is
   * imported, not re-typed. A private copy is how sixteen comment blankers came
   * to exist in four behaviours, and this file was one of the two that started
   * the seventeenth.
   */
  const codeOnly = blankEmittedCode;

  /**
   * Static import specifiers of a `.mjs` file — `await import()` is not one.
   *
   * ⚠️ Two alternatives rather than one pattern with an optional `from` clause:
   * `[\s\S]*?\s+from\s+` crosses newlines, so a bare `import "./x.mjs"` reads the
   * NEXT line's `from` and reports the wrong specifier. Written the other way
   * once, and `scripts/lib/env.test.ts` carries the measurement. Same shape as
   * `modules/boundary.test.ts`.
   */
  const staticImports = (source: string): string[] =>
    [...codeOnly(source).matchAll(/from\s+"([^"]+)"|import\s+"([^"]+)"/g)].map(
      (m) => m[1] ?? m[2],
    );

  /**
   * Everything reachable from a file by STATIC imports, keyed by absolute path.
   *
   * Follows `../` as well as `./` — a closure that stopped at the folder boundary
   * would have missed exactly the import this file now requires
   * (`cli.mjs` → `../lib/env.mjs`) and anything that file might reach.
   *
   * ⚠️ **And it follows `@/` too**, through `resolveImport()` from
   * `scripts/lib/import-graph.mjs`, which is the same swap this file already made
   * for `blankEmittedCode` above and for the same reason. It used to read
   * `if (!specifier.startsWith(".")) continue;` — so an alias ENDED the walk, and
   * the defect this whole describe block exists for could come back through one
   * unseen. Nothing under `scripts/` carries an `@/` import today (it would not
   * resolve at Node's ESM runtime, so it fails loudly at the first invocation),
   * which is why the walk did not grow: prophylaxis, measured rather than assumed.
   *
   * 🚨 The second half is not cosmetic either: `readFileSync` below used to be
   * handed whatever `resolve()` produced, with no existence check — so ONE
   * unresolvable specifier ended the entire test with an `ENOENT` instead of
   * reporting a finding. `exists: false` is now a skip, and it is a different
   * answer from `null` (not our path at all) by construction.
   */
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

  it("does not import the data gate statically", () => {
    // Named on its own, before the general rule below, because this is the one
    // that came back — and the error message a general rule gives is worse.
    expect(
      staticImports(cli),
      "cli.mjs imports data-gate.mjs statically, which pulls `postgres` into the " +
        "import graph of `module add`, `list` and `sync`. Load it with " +
        "`await dataGate()` inside `check` and `remove`, where the database is " +
        "actually needed.",
    ).not.toContain("./data-gate.mjs");
    expect(cli, "the lazy loader is gone").toMatch(/const dataGate = \(\) => import\("\.\/data-gate\.mjs"\)/);
  });

  it("reaches no npm package at all, transitively", () => {
    const closure = closureOf(CLI);

    // Non-vacuity: a closure of one file would pass this while walking nothing.
    expect(closure.size, "the import walk found only cli.mjs").toBeGreaterThan(2);
    expect([...closure.keys()].map((f) => relative(ROOT, f))).toContain(
      join("scripts", "modules", "registry.mjs"),
    );

    const offenders: string[] = [];
    for (const [file, specifiers] of closure) {
      for (const specifier of specifiers) {
        // Relative is ours; `node:` is the runtime and always there. Anything
        // else is a package out of node_modules.
        if (specifier.startsWith(".")) continue;
        if (specifier.startsWith("node:")) continue;
        offenders.push(`${relative(ROOT, file)} imports "${specifier}"`);
      }
    }
    expect(
      offenders,
      "a module command's static import graph reaches an npm package:\n" +
        offenders.join("\n") +
        "\nThese commands must work on a freshly cloned tree, before anything has " +
        "been installed — Node resolves the whole graph before running a line, so " +
        "one such import breaks `module list` with a stack trace about a package " +
        "the command never uses. Load it lazily where it is needed.",
    ).toEqual([]);
  });
});
