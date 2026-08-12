// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The one import in this tree the bundler must be told to leave alone.
//
// `applierPresence()` imports each applier by a path computed at runtime. That
// is fine in bare Node and impossible for a bundler to follow — and this code
// runs inside the Next bundle, because the check is a setup TOOL rather than a
// script. Without the ignore comments, webpack/Turbopack answer
// "Cannot find module as expression is too dynamic", the CORE's presence report
// becomes `unanswered`, and `presenceProblems()` counts that as a failure.
//
// Measured, in a real deployed app with five modules installed:
// `node run.mjs content-check` was RED in every app, naming a fault that had
// nothing to do with content — while every module answered correctly beside it.
// Nothing caught it because `deploy-test-modules` has no setup key and never
// runs the command, and vitest does not bundle.
//
// ⚠️ **This is the one text scan in the tree that must NOT blank comments**, and
// the exception is not an oversight: here the comment IS the mechanism. Running
// it through `blankComments()` would delete exactly what it is checking for.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE = readFileSync(join(ROOT, "lib", "content", "applier-presence.ts"), "utf8");

describe("the applier import survives bundling", () => {
  it("found the file it is guarding", () => {
    expect(SOURCE).toContain("applierSources");
    expect(SOURCE).toMatch(/await import\(/);
  });

  it("🚨 tells webpack and Turbopack to leave the dynamic specifier alone", () => {
    // Both, because Next builds with either depending on the flag, and the
    // failure is invisible in the one you are not using.
    for (const spell of ["webpackIgnore: true", "turbopackIgnore: true"]) {
      expect(
        SOURCE,
        `applier-presence.ts imports an applier by a runtime path without ${spell}. ` +
          "The bundler answers \"Cannot find module as expression is too dynamic\", " +
          "the core's presence report becomes unanswered, and content-check is red " +
          "in every app for a reason that has nothing to do with content.",
      ).toContain(spell);
    }
  });

  it("imports a file URL, not a bare absolute path", () => {
    // A native dynamic import of an absolute path is deprecated on POSIX and
    // fails outright on Windows — and this template ships to three systems.
    expect(SOURCE).toContain("pathToFileURL(file).href");
  });
});
