// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The commit gate — the parts of it that can be checked without making a commit.
//
// What the gate DOES (run typecheck, run the tests, refuse on red) is one `for`
// loop over `runNpm`, and testing it would mean mocking npm to assert that npm
// was called. What is worth pinning is the shape around it, because every one
// of these has a quiet failure mode:
//
//   • the shim staying a shim — logic in a shell file is logic that works on
//     one of the three systems and is discovered on the other two by a customer,
//   • the wiring not overruling a developer who has their own hooks path,
//   • the wiring being reached at all: `setup` and `start` both, because a gate
//     somebody has to remember to install is not a gate,
//   • the hook naming `--no-verify`, because CLAUDE.md tells people to commit
//     unfinished work and this is what keeps that possible.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { capture } from "./lib/proc.mjs";
import { blankComments } from "./lib/source-text.mjs";
import { HOOKS_PATH, hookAction, isRepoRoot } from "./dev/hooks.mjs";

const ROOT = path.join(import.meta.dirname, "..");

// Blanked at the reader, so the rule covers whatever gets pinned here next. The
// three files below are read as TEXT for needles they also TALK about: the runner
// explains its own no-install rule and its way past the gate in a header comment,
// so `toContain("--no-verify")` and `existsSync("node_modules")` could both be
// answered by the paragraph ABOUT the code rather than by the code — and the
// `.not.toMatch()` beside them could fire on a comment warning against the very
// thing it forbids. Everything read here is code (`run.mjs`, a `.mjs`, and the
// `sh` shim, which has no extension but is not prose either).
// (CLAUDE.md → a checker that reads source as TEXT goes through `blankComments()`.)
const read = (relative: string) => blankComments(readFileSync(path.join(ROOT, relative), "utf8"));

describe("the hook file", () => {
  const hook = read(".githooks/pre-commit");

  it("is a shim and stays one", () => {
    const code = hook
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));

    // One executable line. Anything else means logic has started to grow in a
    // shell file — and this project's rule is that logic is Node, on all three
    // systems (CLAUDE.md → Three systems).
    expect(code).toEqual(["exec node scripts/dev/pre-commit.mjs"]);
    expect(hook.startsWith("#!/bin/sh")).toBe(true);
  });

  it("is checked in as executable", async () => {
    // THE silent failure of this whole feature: git does not complain about a
    // hook it may not execute, it just skips it. Everything would look wired,
    // `core.hooksPath` would be set, and every commit would sail through green
    // or red. The mode lives in the index (Windows has no such bit on disk), so
    // that is where it gets read.
    const { code, stdout } = await capture("git", ["ls-files", "-s", ".githooks/pre-commit"]);
    if (code !== 0 || stdout.trim() === "") return; // no git, or not a checkout
    expect(stdout.startsWith("100755"), `git has the hook as ${stdout.slice(0, 6)}, not 100755`).toBe(
      true,
    );
  });
});

describe("what the gate says when it refuses", () => {
  const runner = read("scripts/dev/pre-commit.mjs");

  it("names the way past it", () => {
    // Without this sentence the advice "commit unfinished work rather than
    // leaving it lying around" becomes unfollowable, and somebody starts
    // weakening tests to get a commit through — which is the failure this gate
    // is supposed to prevent, arriving by the back door.
    expect(runner).toContain("--no-verify");
  });

  it("refuses instead of installing when node_modules is missing", () => {
    expect(runner).toContain('existsSync("node_modules")');
    // A commit that silently turns into an npm install is a commit that looks
    // hung. Whatever else changes here, it must not start installing.
    expect(runner).not.toMatch(/runNpm\(\s*\[\s*"install"/);
  });

  it("checks types and tests, in that order", () => {
    const checks = runner.match(/const CHECKS = \[([^\]]*)\]/);
    expect(checks, "const CHECKS = […] not found").not.toBeNull();
    expect([...checks![1].matchAll(/"([^"]+)"/g)].map((x) => x[1])).toEqual(["typecheck", "test"]);
  });
});

describe("wiring it into a clone", () => {
  it("sets the path when nothing is configured", () => {
    expect(hookAction(true, "")).toBe("set");
    expect(hookAction(true, undefined)).toBe("set");
  });

  it("is quiet when it is already wired, in either spelling", () => {
    expect(hookAction(true, HOOKS_PATH)).toBe("already");
    expect(hookAction(true, `./${HOOKS_PATH}\n`)).toBe("already");
  });

  it("leaves a foreign hooks path alone", () => {
    // Somebody with their own hooks folder has decided something. A setup step
    // that overrules that would take their pre-push hook away without a word.
    expect(hookAction(true, ".my-hooks")).toBe("foreign");
  });

  it("does nothing outside a git work tree", () => {
    // A deploy folder, a tarball, a machine without git: none of that is a
    // reason to fail the command this runs in front of.
    expect(hookAction(false, "")).toBe("no-repo");
  });

  it("only calls this folder the root when git says exactly that", () => {
    // The nested case is the dangerous one: an app inside somebody else's
    // repository would get `core.hooksPath` written into THAT repository, which
    // has no .githooks — and git then runs no hooks at all there, switching off
    // whatever its owner had, without a word.
    expect(isRepoRoot("/home/me/app", "/home/me/app")).toBe(true);
    expect(isRepoRoot("/home/me/app\n", "/home/me/app/")).toBe(true);
    expect(isRepoRoot("/home/me", "/home/me/app")).toBe(false);
    expect(isRepoRoot("", "/home/me/app")).toBe(false);
  });
});

describe("the gate is reached without anybody asking for it", () => {
  const runMjs = read("run.mjs");

  /** The `needs: […]` of one task in run.mjs, read as text. */
  function needs(task: string): string[] {
    const body = runMjs.match(new RegExp(`\\n  ${task}: \\{([\\s\\S]*?)\\n  \\},`));
    expect(body, `task ${task} not found in run.mjs`).not.toBeNull();
    const list = body![1].match(/needs: \[([^\]]*)\]/);
    return list ? [...list[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
  }

  it.each(["setup", "start"])("%s wires it", (task) => {
    // Both, deliberately: plenty of people only ever type `start`.
    expect(needs(task)).toContain("hooks");
  });

  it("keeps it out of the command list", () => {
    // It is a property of a prepared clone, not a command anybody should have
    // to know — and `scripts/docs-coverage.test.ts` would rightly demand a line
    // of documentation for a command that exists.
    const body = runMjs.match(/\n {2}hooks: \{([\s\S]*?)\n {2}\},/);
    expect(body, "task hooks not found in run.mjs").not.toBeNull();
    expect(body![1]).toContain("hidden: true");
  });
});
