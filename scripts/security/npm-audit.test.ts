// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 How npm gets asked about this tree — one decision, and the rule that keeps
// there being one of it.
//
// `auditScope()` lives in `scripts/security/npm-audit.mjs` because TWO rungs
// need it: the npm rung runs `npm audit` itself, the OSV rung asks npm what it
// already reports so it can exclude it. It stood in both of them as a copied
// line, and the copies asked the wrong question:
//
//     const lockOnly = !existsSync(join(cwd, "node_modules"));
//
// "the folder is missing", where the comment above it said "nothing is
// installed here". The two differ exactly when `npm ci --dry-run` has run: it
// empties `node_modules` and leaves the folder behind (measured, see
// `rungs/posture.mjs`).
//
// ⚠️ What that difference does NOT do is produce a false clean — that chain was
// derived from reading and does not reproduce. The measurement, five tree states
// and ten answers, is written out in `npm-audit.mjs`; this file measures the
// decision and the sentence, not npm.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { blankComments } from "../lib/source-text.mjs";
import { auditScope } from "./npm-audit.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

describe("auditScope — is anything installed here", () => {
  let base = "";
  const treeAt = (name: string): string => {
    const dir = join(base, name);
    mkdirSync(dir, { recursive: true });
    return dir;
  };

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "ds24-audit-scope-"));
  });
  afterAll(() => {
    if (base) rmSync(base, { recursive: true, force: true });
  });

  it("no node_modules at all → the lockfile question", () => {
    const scope = auditScope(treeAt("absent"));
    expect(scope.lockOnly).toBe(true);
    expect(scope.flags).toEqual(["--package-lock-only"]);
    expect(scope.suffix).toBe(" --package-lock-only");
  });

  it("🚨 node_modules present but EMPTY → still the lockfile question", () => {
    // THE case the replaced condition got wrong: `existsSync` answers `true`
    // for a folder with nothing in it, so npm was asked to load a tree that is
    // not there. `npm ci --dry-run` produces exactly this state.
    const dir = treeAt("empty");
    mkdirSync(join(dir, "node_modules"));
    expect(auditScope(dir).lockOnly).toBe(true);
  });

  it("node_modules holding only npm's own bookkeeping → still the lockfile question", () => {
    // `.package-lock.json`, `.bin`, `.cache` — dot entries outlive the packages
    // beside them, and none of them is a package to audit.
    const dir = treeAt("dot-only");
    mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(dir, "node_modules", ".package-lock.json"), "{}\n");
    expect(auditScope(dir).lockOnly).toBe(true);
  });

  it("one real package → the installed tree is asked", () => {
    const dir = treeAt("installed");
    mkdirSync(join(dir, "node_modules", "minimist"), { recursive: true });
    writeFileSync(join(dir, "node_modules", ".package-lock.json"), "{}\n");
    const scope = auditScope(dir);
    expect(scope.lockOnly).toBe(false);
    expect(scope.flags).toEqual([]);
    expect(scope.suffix).toBe("");
  });

  it("a scoped package counts, dot-prefixed or not", () => {
    const dir = treeAt("scoped");
    mkdirSync(join(dir, "node_modules", "@scope", "thing"), { recursive: true });
    expect(auditScope(dir).lockOnly).toBe(false);
  });

  it("🚨 both notes name the lockfile, because both answers came off it", () => {
    // The evidence line is where an operator reads what was asked. It used to
    // speak up only in the lock-only case, which left `npm audit --json` to be
    // read as "the installed tree was checked" — while npm rated the versions
    // package-lock.json resolved either way (the measurement in npm-audit.mjs).
    const installed = treeAt("note-installed");
    mkdirSync(join(installed, "node_modules", "minimist"), { recursive: true });

    const lockOnlyNote = auditScope(treeAt("note-absent")).note;
    const installedNote = auditScope(installed).note;

    expect(lockOnlyNote).toContain("package-lock.json");
    expect(installedNote).toContain("package-lock.json");
    expect(lockOnlyNote).toContain("--package-lock-only");
    expect(installedNote).toContain("node_modules");
    // Different sentences, so the two states are told apart at a glance.
    expect(lockOnlyNote).not.toBe(installedNote);
  });

  it("an unreadable node_modules is not called empty", () => {
    // We could not look, so we do not claim; npm gets the ordinary question.
    // Asserted through the predicate's own guard rather than a chmod, which
    // does nothing as root and nothing at all on Windows.
    const dir = treeAt("unreadable");
    writeFileSync(join(dir, "node_modules"), "not a directory\n");
    expect(auditScope(dir).lockOnly).toBe(false);
  });
});

// ── the rule that keeps it one decision ─────────────────────────────────────

describe("🚨 nothing decides for itself how npm gets asked", () => {
  const SKIP_DIRS = new Set(["node_modules", ".next", ".dev", "dist"]);
  const SCANNED = ["scripts", "lib", "app", "db", "modules"];

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
      else if (/\.(ts|tsx|mjs)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) yield rel;
    }
  }

  const ALL = [...SCANNED.flatMap((dir) => [...sourceFiles(dir)])];

  /** The one file allowed to make the decision. */
  const HOME = join("scripts", "security", "npm-audit.mjs");

  /**
   * The two needles, and why they are these two.
   *
   * A second copy of the decision has to show one of them. Either it names the
   * FLAG — that is what the decision is for, and a rung building its own
   * `npm audit` argv cannot avoid writing it — or it passes the answer around
   * under the name the option once had, which is how the OSV rung carried it
   * (`auditIds({ cwd, lockOnly: … })`). The option no longer exists, so the
   * identifier surviving anywhere but here is a copy in the making.
   *
   * Tests are outside the walk: asserting the flag is reading this one
   * decision's output, not making a second one.
   */
  const NEEDLES = ["--package-lock-only", "lockOnly"];

  it("walked the tree", () => {
    // Non-vacuity, and the two files this rule exists because of.
    expect(ALL.length).toBeGreaterThan(100);
    const seen = ALL.map((f) => relative("", f));
    expect(seen).toContain(HOME);
    expect(seen).toContain(join("scripts", "security", "rungs", "advisories.mjs"));
    expect(seen).toContain(join("scripts", "security", "rungs", "osv.mjs"));
  });

  it("🚨 the needles can be found at all", () => {
    // A guard whose probe cannot fire reports success over every file in the
    // tree. Both needles are measured against the one file that has them —
    // after blanking, because the paragraphs above them are comments too.
    const home = blankComments(readFileSync(join(ROOT, HOME), "utf8"));
    for (const needle of NEEDLES) expect(home, `needle "${needle}"`).toContain(needle);
  });

  it("has no second decision anywhere", () => {
    const offenders: string[] = [];

    for (const file of ALL) {
      if (file === HOME) continue;
      // Comments blanked first: a file may DISCUSS the flag, and
      // `rungs/advisories.mjs` does — its header lists the four npm calls this
      // rung's shape was measured from.
      const source = blankComments(readFileSync(join(ROOT, file), "utf8"));
      if (NEEDLES.some((needle) => source.includes(needle))) {
        offenders.push(file.split(/[\\/]/).join("/"));
      }
    }

    expect(
      offenders,
      "these files decide for themselves how npm audit gets asked:\n" +
        offenders.map((f) => `  ${f}`).join("\n") +
        "\n\nCall `auditScope()` from scripts/security/npm-audit.mjs instead. It " +
        "stood in two rungs at once — the npm one and the OSV one — as a copied " +
        "`!existsSync(join(cwd, \"node_modules\"))`, which asks whether the FOLDER " +
        "is there where the intent is whether anything is INSTALLED.",
    ).toEqual([]);
  });
});
