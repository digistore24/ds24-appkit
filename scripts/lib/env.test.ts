// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 Who has to load the `.env`, asked of every script rather than of the ones
// somebody remembered.
//
// A script under `scripts/` reaches the database through
// `process.env.DATABASE_URL`, and nothing populates that by itself: the value
// lives in `.env`, which is gitignored and read by `scripts/lib/env.mjs`. Every
// script that needs it therefore opens with `import "../lib/env.mjs"` — and it is
// an import for the SIDE EFFECT, so nothing about the file's own code shows
// whether it was remembered.
//
// ── The failure this exists for, measured ──────────────────────────────────
// `scripts/modules/cli.mjs` did not have it. Two of its commands read
// `DATABASE_URL`, and the consequences were invisible in opposite ways:
//
//   · `node run.mjs module remove <id>` always took the "I could not look" path
//     and refused. For every module with tables, empty or not. Three of the four
//     paths `docs/modules.md` documents were unreachable in every app — and the
//     one that worked was a refusal, which is why nobody noticed.
//   · `node run.mjs module check`'s database half is written
//     `if (process.env.DATABASE_URL) { … }`, so it did not refuse. It SKIPPED,
//     and said nothing. That half is the orphan-table backstop —
//     `docs/modules.md` calls it "an alarm rather than a silence" — and it was
//     the silence, in every app, since it was written.
//
// Found by `make deploy-test-modules` (the factory), which is the first thing
// that ever ran `module remove` against a real database. Twelve other scripts
// had it right; this is the shape of a rule that holds everywhere somebody looked.
//
// ── Why the walk is transitive ─────────────────────────────────────────────
// `scripts/users/smoke-account.mjs` reads `DATABASE_URL` and does NOT import
// `lib/env.mjs` — it imports `./_db.mjs`, which does. That is correct, and a
// direct-import check would have called it a bug and been argued with until
// somebody weakened it. So the closure is walked, not the file.
//
// ── Why the walk is the whole TREE, not `scripts/` ─────────────────────────
// It was `scripts/` and nothing else, while `CLAUDE.md` said this file asks the
// question "of every script in the tree". That sentence was the interesting
// part and it was not true: **every module command lives outside `scripts/`** —
// `modules/courses/check.mjs`, `modules/courses/courses-diff.mjs`,
// `modules/api/check.mjs`, `modules/community/scripts/prune.mjs` — and a module
// command is exactly the kind of file this rule exists for. It is a `node
// run.mjs <command>` entry point, it reaches the database, and it was written by
// whoever built the module rather than by whoever remembered the convention.
//
// The narrower run was also self-defeating: the failure that created this rule
// was `scripts/modules/cli.mjs`, the file that INSTALLS modules — so the rule was
// derived from the module system and then pointed away from it.
//
// Measured when the walk was widened (2026-08-12): 142 `.mjs` under `scripts/`,
// 38 outside it, and **zero** new offenders — all four module commands already
// load the `.env`, three of them directly and `modules/api/check.mjs` through
// `scripts/users/_db.mjs`. So this widening bought a guard rather than a fix,
// and the honest way to say that is with the numbers rather than with silence.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { blankEmittedCode } from "./source-text.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPTS = join(ROOT, "scripts");
const ENV_MODULE = join(SCRIPTS, "lib", "env.mjs");

/**
 * Directories the walk never enters.
 *
 * `node_modules` and `.next` are somebody else's code and build output;
 * `.dev`, `.data` and `.git` are machine-local. Everything else in the tree is
 * this app's, and a `.mjs` in it that reaches the database is in scope by
 * definition — there is no folder where forgetting the `.env` is fine.
 */
const SKIP = new Set(["node_modules", ".next", ".git", ".dev", ".data"]);

function* mjsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* mjsFiles(full);
    else if (entry.endsWith(".mjs")) yield full;
  }
}

/**
 * The file's own code — comments blanked, single-quoted and template strings
 * emptied.
 *
 * Comments, so a file may EXPLAIN this rule without being bound by it. Strings,
 * because `scripts/modules/generate.mjs` GENERATES source and emits `import …`
 * lines of its own; reading those as this file's imports sends the walk after
 * files that do not exist. Import specifiers here are double-quoted and the
 * emitted code is wrapped in the other two kinds, so this separates them.
 * `scripts/modules/data-gate.test.ts` carries the measured version of that.
 *
 * ⚠️ `blankEmittedCode()`, not a fourth local copy of it — that is the whole
 * point of `source-text.mjs` and the rule its own test enforces. This file was
 * one of the two that reintroduced a private one.
 */
const codeOnly = blankEmittedCode;

/**
 * Static import specifiers. `await import()` is not one — it runs later, by choice.
 *
 * ⚠️ Two alternatives, not one pattern with an optional `from` clause. Written
 * that way this test found its own bug: `[\s\S]*?\s+from\s+` is happy to cross a
 * newline, so a side-effect import read the NEXT line's `from` and reported
 * `import "../lib/env.mjs"` as an import of drizzle — which made
 * `db/migrate.mjs`, the file this rule was modelled on, look like an offender.
 * This is the shape `modules/boundary.test.ts` already uses.
 */
const staticImports = (source: string): string[] =>
  [...codeOnly(source).matchAll(/from\s+"([^"]+)"|import\s+"([^"]+)"/g)].map(
    (match) => match[1] ?? match[2],
  );

/** Does this file, or anything it statically imports, load the `.env`? */
function loadsEnv(entry: string, seen = new Set<string>()): boolean {
  const full = resolve(entry);
  if (full === ENV_MODULE) return true;
  if (seen.has(full) || !existsSync(full)) return false;
  seen.add(full);

  for (const specifier of staticImports(readFileSync(full, "utf8"))) {
    if (!specifier.startsWith(".")) continue;
    if (loadsEnv(resolve(dirname(full), specifier), seen)) return true;
  }
  return false;
}

const ALL = [...mjsFiles(ROOT)];
const rel = (file: string) => relative(ROOT, file).split(sep).join("/");

/**
 * The module commands, by path — the files the narrow walk could not see.
 *
 * Named literally rather than derived from the manifests, and that is the point:
 * a derived list would go quiet the day a manifest key is renamed, which is the
 * same silence `scripts/deploy-test.mjs`'s hand-kept command list had. These four
 * are `node run.mjs <command>` entry points today; if one moves, this test says
 * so instead of shrinking.
 */
const MODULE_COMMANDS = [
  "modules/api/check.mjs",
  "modules/community/scripts/prune.mjs",
  "modules/courses/check.mjs",
  "modules/courses/courses-diff.mjs",
];

describe("every script that needs the database loads the .env", () => {
  it("found scripts to check", () => {
    // Non-vacuity: an empty walk would make the assertion below pass loudly, and
    // this rule's whole history is a check that was never asked of one file.
    expect(ALL.length).toBeGreaterThan(40);
    expect(ALL.map(rel)).toContain("scripts/db/migrate.mjs");
  });

  it("🚨 reaches OUTSIDE scripts/ — every module command is in the walk", () => {
    // The count guard for the widening itself. `scripts/` alone was the run for
    // as long as this file existed, and a walk that quietly went back to it
    // would pass every assertion below while asking nothing of the four files
    // the rule was most likely to be forgotten in.
    const outside = ALL.map(rel).filter((f) => !f.startsWith("scripts/"));
    expect(outside.length, "no .mjs outside scripts/ — the walk narrowed again").toBeGreaterThan(
      10,
    );
    for (const command of MODULE_COMMANDS) {
      expect(ALL.map(rel), `${command} is a module command and must be walked`).toContain(command);
    }
  });

  it("recognises a script that does load it", () => {
    // The probe. `loadsEnv()` returning false for everything would turn the
    // assertion below into a list of every script in the tree, which somebody
    // would then "fix" by relaxing it.
    expect(loadsEnv(join(SCRIPTS, "db", "migrate.mjs")), "db/migrate.mjs").toBe(true);
    expect(
      loadsEnv(join(SCRIPTS, "users", "smoke-account.mjs")),
      "users/smoke-account.mjs loads it through ./_db.mjs — the walk must be transitive",
    ).toBe(true);
  });

  it("🚨 leaves no reader of DATABASE_URL without it", () => {
    const offenders: string[] = [];

    for (const file of ALL) {
      const source = codeOnly(readFileSync(file, "utf8"));
      if (!source.includes("process.env.DATABASE_URL")) continue;

      // A script that reads the file itself is answering the question its own
      // way, which is fine and is what `db/up.mjs`, `db/local.mjs` and
      // `dev/doctor.mjs` do — they run BEFORE there is necessarily an `.env` to
      // load, so loading one is not available to them, and each falls back to
      // `readEnvValue(".env", "DATABASE_URL")` explicitly.
      if (source.includes("readEnvValue")) continue;
      // …and one that only writes the name into generated output never reads a
      // value at all (`db/generate-module.mjs` emits a drizzle config).
      if (/dbCredentials/.test(source)) continue;

      if (!loadsEnv(file)) offenders.push(rel(file));
    }

    expect(
      offenders,
      "these scripts read process.env.DATABASE_URL and nothing puts the .env there:\n" +
        offenders.map((f) => `  ${f}`).join("\n") +
        "\n\nAdd `import \"../lib/env.mjs\";` — for the side effect, the way every other\n" +
        "database-touching script does. The failure mode is not an error: a command\n" +
        "that guards its database work with `if (process.env.DATABASE_URL)` SKIPS it\n" +
        "and says nothing, and one that refuses without it refuses always. Both look\n" +
        "like working software.",
    ).toEqual([]);
  });
});
