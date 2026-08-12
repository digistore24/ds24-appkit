// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The posture rung's four decisions, minus the disk.
//
// ⚠️ **This file is pure on purpose, and that is a rule rather than a taste.**
// `vitest.config.ts` includes `**/*.test.ts`, so anything placed beside the code
// runs inside every `npm run test` — and `security-check` must never become a
// gate (CLAUDE.md, and check.mjs's own header). Nothing below reads a file,
// spawns a process or touches the network. What the rung does against this
// project's own tree is proven by running the command; what lives here is what it
// DECIDES about text and objects it has been handed.
//
// 🚨 Every one of these functions can return an empty array, and a rung that has
// quietly started returning nothing for everything passes a suite written around
// emptiness in full. So each question below has a NEEDLE: a planted `.npmrc`
// without the flag, a planted out-of-sync lockfile, a planted undocumented
// override — each one has to come back NAMED, and each one's opposite has to come
// back empty.
//
// Nothing here asserts how many overrides this app has, how many packages run
// install scripts, or how many findings a real run produces. Those are facts
// about today; the shapes are the truth.
import { describe, expect, it } from "vitest";

import {
  ciRefusalFindings,
  gitignoresLockfile,
  ignoresScripts,
  installScriptPackages,
  lockfileCommittedFindings,
  lockfileDisagreements,
  lockfileSyncFindings,
  mentions,
  npmrcFindings,
  overrideNames,
  overrideReasonFindings,
  posture,
  readCiDryRun,
  whereList,
} from "./posture.mjs";

/** Every field the renderer prints — a finding missing one renders as a blank line. */
const RENDERED = ["title", "where", "why", "fix", "evidence", "source"] as const;

const complete = (finding: Record<string, unknown>) => {
  for (const field of RENDERED) expect(String(finding?.[field] ?? ""), field).not.toBe("");
  // An accepted set is keyed on `id`, and nothing this rung reports is acceptable
  // by exemption — there is no database with an id for "you did not write a reason".
  expect(finding?.id).toBeUndefined();
};

// ── .npmrc ──────────────────────────────────────────────────────────────────

describe("install scripts", () => {
  it("recognises the flag, in the spellings npm recognises", () => {
    expect(ignoresScripts("ignore-scripts=true")).toBe(true);
    expect(ignoresScripts("  ignore-scripts = true  ")).toBe(true);
    expect(ignoresScripts("ignore-scripts=1")).toBe(true);
    expect(ignoresScripts('ignore-scripts="true"')).toBe(true);
  });

  it("does not read a comment, a false, or a later line that turns it off", () => {
    expect(ignoresScripts("# ignore-scripts=true")).toBe(false);
    expect(ignoresScripts("; ignore-scripts=true")).toBe(false);
    expect(ignoresScripts("ignore-scripts=false")).toBe(false);
    expect(ignoresScripts("ignore-scripts=yes")).toBe(false);
    // The last line wins, which is what npm does with a repeated key.
    expect(ignoresScripts("ignore-scripts=true\nignore-scripts=false")).toBe(false);
    expect(ignoresScripts(null)).toBe(false);
  });

  it("reads a file written on Windows", () => {
    expect(ignoresScripts("audit=false\r\nignore-scripts=true\r\n")).toBe(true);
  });

  it("🚨 NEEDLE — an absent .npmrc is reported, and never above ℹ️ LOW", () => {
    const findings = npmrcFindings(null, ["esbuild", "sharp"]);
    expect(findings).toHaveLength(1);
    complete(findings[0] as unknown as Record<string, unknown>);
    // The rating is the design: a fresh app opening red on a default nobody
    // chose is a check its reader learns to skip.
    expect(findings[0].severity).toBe("low");
    // The Fix names the MEASUREMENT rather than promising the change is free.
    expect(findings[0].fix).toContain("esbuild");
    expect(findings[0].fix).toContain("MEASURE");
    expect(findings[0].evidence).toContain("no .npmrc");
  });

  it("…and the flag being set really silences it", () => {
    expect(npmrcFindings("ignore-scripts=true", ["esbuild"])).toEqual([]);
  });

  it("names the install-script packages out of the lockfile, never a written-down list", () => {
    expect(
      installScriptPackages({
        packages: {
          "": { name: "app" },
          "node_modules/esbuild": { version: "0.25.0", hasInstallScript: true },
          "node_modules/next-intl/node_modules/@swc/core": { version: "1.0.0", hasInstallScript: true },
          "node_modules/react": { version: "19.0.0" },
        },
      }),
    ).toEqual(["@swc/core", "esbuild"]);
    expect(installScriptPackages(null)).toEqual([]);
  });
});

// ── the lockfile in the repository ──────────────────────────────────────────

describe("the lockfile being committed", () => {
  it("matches the patterns git matches", () => {
    expect(gitignoresLockfile("package-lock.json")).toBe(true);
    expect(gitignoresLockfile("/package-lock.json")).toBe(true);
    expect(gitignoresLockfile("*.json")).toBe(true);
    expect(gitignoresLockfile("package-lock*")).toBe(true);
    expect(gitignoresLockfile("node_modules/\n.next/\n.dev/\n*.log")).toBe(false);
    expect(gitignoresLockfile(null)).toBe(false);
  });

  it("honours a negation, because git does", () => {
    expect(gitignoresLockfile("*.json\n!package-lock.json")).toBe(false);
  });

  it("does not mistake a directory pattern for a file", () => {
    expect(gitignoresLockfile("package-lock.json/")).toBe(false);
  });

  it("🚨 NEEDLE — an absent lockfile is ❌ HIGH and says why the rest of the ladder rests on it", () => {
    const findings = lockfileCommittedFindings(false, "node_modules/");
    expect(findings).toHaveLength(1);
    complete(findings[0] as unknown as Record<string, unknown>);
    expect(findings[0].severity).toBe("high");
    expect(findings[0].where).toBe("package-lock.json");
  });

  it("🚨 NEEDLE — a lockfile that exists but is gitignored is the same severity, a different sentence", () => {
    const findings = lockfileCommittedFindings(true, "*.json");
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
    expect(findings[0].where).toBe(".gitignore");
    expect(findings[0].title).toContain(".gitignore");
  });

  it("…and a committed lockfile really passes", () => {
    expect(lockfileCommittedFindings(true, "node_modules/\n.env")).toEqual([]);
  });
});

// ── the lockfile describing this package.json ───────────────────────────────

const PKG = {
  dependencies: { next: "^16.2.11", react: "19.0.0" },
  devDependencies: { vitest: "^4.1.10" },
};

const LOCK = {
  lockfileVersion: 3,
  packages: {
    "": {
      name: "app",
      dependencies: { next: "^16.2.11", react: "19.0.0" },
      devDependencies: { vitest: "^4.1.10" },
    },
  },
};

describe("the lockfile describing this package.json", () => {
  it("is quiet when the two agree", () => {
    expect(lockfileDisagreements(PKG, LOCK)).toEqual([]);
    expect(lockfileSyncFindings(PKG, LOCK)).toEqual([]);
  });

  it("🚨 NEEDLE — a range that was edited in package.json and never installed is ❌ HIGH, and NAMED", () => {
    const edited = { ...PKG, dependencies: { ...PKG.dependencies, next: "^17.0.0" } };
    const findings = lockfileSyncFindings(edited, LOCK);
    expect(findings).toHaveLength(1);
    complete(findings[0] as unknown as Record<string, unknown>);
    expect(findings[0].severity).toBe("high");
    expect(findings[0].where).toContain("next");
    expect(findings[0].evidence).toContain("^17.0.0");
    expect(findings[0].evidence).toContain("^16.2.11");
  });

  it("🚨 NEEDLE — a dependency added to package.json and absent from the lockfile is named too", () => {
    const added = { ...PKG, dependencies: { ...PKG.dependencies, zod: "^4.0.0" } };
    expect(lockfileSyncFindings(added, LOCK)[0].where).toContain("zod");
  });

  it("🚨 NEEDLE — and one the lockfile still records after package.json dropped it", () => {
    const dropped = { ...PKG, devDependencies: {} };
    expect(lockfileSyncFindings(dropped, LOCK)[0].evidence).toContain("vitest");
  });

  it("says nothing at all when there is no lockfile to compare — that is the other finding's job", () => {
    expect(lockfileSyncFindings(PKG, null)).toEqual([]);
    expect(lockfileSyncFindings(PKG, { packages: {} })).toEqual([]);
  });
});

// ── an override with a written reason ───────────────────────────────────────

describe("the overrides", () => {
  it("reads npm's three spellings of an override key", () => {
    expect(overrideNames({ postcss: "^8", "nanoid@3": "3.3.17" })).toEqual(["nanoid", "postcss"]);
    expect(overrideNames({ "@scope/pkg@1.0.0": "2.0.0" })).toEqual(["@scope/pkg"]);
    // A nested block names the packages overridden UNDER the outer one; `.` is
    // the outer package's own version and names nothing new.
    expect(overrideNames({ foo: { ".": "1.0.0", bar: "2.0.0" } })).toEqual(["bar", "foo"]);
    expect(overrideNames(undefined)).toEqual([]);
  });

  it("will not accept a substring as a mention", () => {
    // The failure this guards: an override on `os` counted as documented by the
    // word "cost".
    expect(mentions("that would cost too much", "os")).toBe(false);
    expect(mentions("// os is pinned because …", "os")).toBe(true);
    expect(mentions("we override `@scope/pkg` because …", "@scope/pkg")).toBe(true);
  });

  it("🚨 NEEDLE — an override named nowhere in the reasons file is ⚠️ MEDIUM, and NAMED", () => {
    const pkg = { overrides: { esbuild: ">=0.25.12", mystery: "^1.0.0" } };
    const reasons = "// The esbuild override is a FLOOR, not a pin.";
    const findings = overrideReasonFindings(pkg, reasons);

    expect(findings).toHaveLength(1);
    complete(findings[0] as unknown as Record<string, unknown>);
    expect(findings[0].severity).toBe("medium");
    expect(findings[0].where).toContain("mystery");
    // The documented one must NOT be dragged in with it — that is the half that
    // makes the needle a needle rather than a blanket.
    expect(findings[0].where).not.toContain("esbuild");
    expect(findings[0].evidence).toContain("mystery");
  });

  it("…and writing the reason really silences it", () => {
    const pkg = { overrides: { mystery: "^1.0.0" } };
    expect(overrideReasonFindings(pkg, "// mystery is here because upstream …")).toEqual([]);
  });

  it("🚨 the reasons ARE comments — this is the one checker that must not blank them", () => {
    // If this file's reader is ever routed through `blankComments()`, every
    // override in every app becomes undocumented for ever. This asserts the
    // property rather than the call: a comment-only mention counts.
    const pkg = { overrides: { onlyInAComment: "^1" } };
    expect(overrideReasonFindings(pkg, "// onlyInAComment: kept because …")).toEqual([]);
  });

  it("says nothing when there are no overrides at all", () => {
    expect(overrideReasonFindings({}, "")).toEqual([]);
  });
});

// ── npm ci --dry-run, which is evidence and never a state ───────────────────

describe("npm ci --dry-run", () => {
  it("reads agreement", () => {
    expect(readCiDryRun({ code: 0, stdout: "added 665 packages in 411ms", stderr: "" })).toEqual({
      agreed: true,
      refused: false,
      said: "",
    });
  });

  it("🚨 NEEDLE — recognises npm's own sync refusal, and quotes its sentence", () => {
    const answer = readCiDryRun({
      code: 1,
      stdout: "",
      stderr:
        "npm error code EUSAGE\n" +
        "npm error `npm ci` can only install packages when your package.json and package-lock.json are in sync.\n",
    });
    expect(answer.refused).toBe(true);
    const findings = ciRefusalFindings(answer.said);
    complete(findings[0] as unknown as Record<string, unknown>);
    expect(findings[0].severity).toBe("high");
    expect(findings[0].evidence).toContain("in sync");
    // `npm error ` is stripped: the evidence line quotes npm, it does not quote
    // npm's prefix.
    expect(findings[0].evidence).not.toContain("npm error");
  });

  it("🚨 quotes the ERROR, not the wall of warnings npm prints above it", () => {
    // Measured on this tree, 2026-08-10: a `npm ci --dry-run` that fails prints
    // ~30 lines of `npm WARN ERESOLVE overriding peer dependency` BEFORE its
    // error. "the first non-empty line" quoted one of those as if it were the
    // reason npm could not answer, which is a sentence nobody can act on.
    const answer = readCiDryRun({
      code: 1,
      stdout: "",
      stderr:
        "npm WARN ERESOLVE overriding peer dependency\n" +
        "npm WARN While resolving: digistore-saas-app@0.23.0\n" +
        "npm WARN Found: next@16.2.11\n" +
        "npm ERR! code E404\n" +
        "npm ERR! 404 Not Found - GET https://registry.npmjs.org/brand-new-thing - Not found\n",
    });
    expect(answer.refused).toBe(false);
    expect(answer.said).not.toContain("ERESOLVE");
    expect(answer.said).toContain("404");
  });

  it("🚨 an npm that could not be asked is NOT a refusal — the other three answers stand", () => {
    // 127 is what `capture()` answers for a binary that is not on the PATH.
    const missing = readCiDryRun({ code: 127, stdout: "", stderr: "spawn npm ENOENT" });
    expect(missing.agreed).toBe(false);
    expect(missing.refused).toBe(false);
    expect(missing.said).toContain("ENOENT");

    const offline = readCiDryRun({
      code: 1,
      stdout: "",
      stderr: "npm error code ENOTFOUND\nnpm error request to https://registry.npmjs.org/ failed",
    });
    expect(offline.refused).toBe(false);
  });
});

// ── the shared shapes ───────────────────────────────────────────────────────

describe("a Where: line stays one line", () => {
  it("names a few and counts the rest", () => {
    expect(whereList(["b", "a"])).toBe("a, b");
    expect(whereList(["a", "b", "c", "d", "e", "f"])).toBe("a, b, c, d and 2 more");
    expect(whereList(["a", "a", "b"])).toBe("a, b");
    expect(whereList([])).toBe("");
  });
});

// ── the rung's own declaration ──────────────────────────────────────────────

describe("the rung declares itself the way the aggregator reads it", () => {
  it("is tier 1 and carries all five fields", () => {
    expect(posture.id).toBe("posture");
    expect(posture.tier).toBe(1);
    expect(String(posture.label).length).toBeGreaterThan(0);
    expect(typeof posture.run).toBe("function");
  });

  it("says what it would have covered, in words, not by repeating its name", () => {
    expect(posture.covers.length).toBeGreaterThan(20);
    expect(posture.covers).not.toBe(posture.label);
    expect(posture.covers).not.toBe(posture.id);
  });
});
