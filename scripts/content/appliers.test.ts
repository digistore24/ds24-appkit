// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 Which appliers exist — the one answer `content-apply`
// must never disagree about.
//
// `apply` runs them and `check` counts their rows. A file one sees and the
// other does not is an app reporting its content as present after a run that
// never touched it, which is the silence `docs/content.md` exists to prevent.
// They had a private copy of the walk each, both hard-coded to
// `scripts/content/appliers` — so a MODULE could declare content it had no way
// to get into an environment, and `docs/courses.md` calls that applier
// absolute.
//
// ⚠️ The module half is dead code in a shipped app (a fresh app has no
// modules), so it is exercised against a FIXTURE tree rather than asserted over
// an empty list — the same reason `loadModules()` takes an `ids` argument.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";

import { CORE_TRACING_INCLUDES } from "@/next.config";
import { blankComments } from "@/scripts/lib/source-text.mjs";
import {
  SETUP_TRACING_ROUTE,
  mergeTracingIncludes,
  moduleTracingIncludes,
} from "../modules/inventory.mjs";
import { withRequires } from "@/scripts/modules/registry.mjs";
import { applierSources } from "./_appliers.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * A throwaway tree with one core applier and one module that brings two.
 *
 * Built rather than mocked: the thing under test is a walk over directories,
 * and a mocked `readdirSync` would prove the test's own idea of the layout.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ds24-appliers-"));
  const write = (rel: string, body: string) => {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  };

  write("config/modules.json", JSON.stringify({ installed: ["fix"] }));
  write(
    "modules/fix/module.json",
    JSON.stringify({
      id: "fix",
      version: "1.0.0",
      title: { de: "Fixture", en: "Fixture" },
      summary: "a fixture module that exists to prove the applier walk reaches a module",
      docs: "docs/content.md",
      appliers: "content/appliers",
    }),
  );
  write("scripts/content/appliers/core-one.mjs", "export const apply = () => 0;\n");
  write("scripts/content/appliers/_helper.mjs", "export const shared = 1;\n");
  write("modules/fix/content/appliers/b-second.mjs", "export const apply = () => 0;\n");
  write("modules/fix/content/appliers/a-first.mjs", "export const apply = () => 0;\n");
  write("modules/fix/content/appliers/notes.md", "not an applier\n");

  return root;
}

const FIXTURE = fixture();
afterAll(() => rmSync(FIXTURE, { recursive: true, force: true }));

describe("applierSources", () => {
  const found = applierSources(FIXTURE);

  it("finds the core's own appliers", () => {
    expect(found.some((s) => s.label === "core-one.mjs" && s.module === null)).toBe(true);
  });

  it("🚨 finds a MODULE's appliers — the half that did not exist", () => {
    expect(found.filter((s) => s.module === "fix").map((s) => s.label)).toEqual([
      "fix:a-first.mjs",
      "fix:b-second.mjs",
    ]);
  });

  it("runs the core's first, then the module's", () => {
    // An app's own tables are what a module's content may point at, never the
    // other way round — a module cannot know about the app.
    expect(found.map((s) => s.label)).toEqual([
      "core-one.mjs",
      "fix:a-first.mjs",
      "fix:b-second.mjs",
    ]);
  });

  it("ignores `_`-prefixed helpers and anything that is not .mjs", () => {
    expect(found.map((s) => s.label)).not.toContain("_helper.mjs");
    expect(found.some((s) => s.label.includes("notes.md"))).toBe(false);
  });

  it("names files that really exist, with an absolute path", () => {
    // The bug this catches: `record.dir` is RELATIVE to the root, written for
    // import specifiers. Joined without the root it resolves against the
    // process's working directory — right wherever the command is normally run
    // from, wrong everywhere else.
    for (const source of found) {
      expect(source.file.startsWith(FIXTURE), source.file).toBe(true);
      expect(() => readFileSync(source.file, "utf8")).not.toThrow();
    }
  });

  /**
   * A tree with the core's applier folder in place and one module declaring
   * `appliers: <declared>`. `contents` is what really goes into the module's
   * folder — `null` means the folder is not created at all.
   */
  function moduleTree(prefix: string, declared: string, contents: Record<string, string> | null) {
    const root = mkdtempSync(join(tmpdir(), prefix));
    mkdirSync(join(root, "config"), { recursive: true });
    writeFileSync(join(root, "config/modules.json"), JSON.stringify({ installed: ["fix"] }));
    mkdirSync(join(root, "modules/fix"), { recursive: true });
    // The core's own folder exists in every app (its `_README.md` holds it
    // open), so a fixture without it would measure the core's refusal here
    // instead of the module's.
    mkdirSync(join(root, "scripts/content/appliers"), { recursive: true });
    writeFileSync(
      join(root, "modules/fix/module.json"),
      JSON.stringify({
        id: "fix",
        version: "1.0.0",
        title: { de: "Fixture", en: "Fixture" },
        summary: "a fixture module whose applier directory is the thing under test",
        docs: "docs/content.md",
        appliers: declared,
      }),
    );
    if (contents) {
      const dir = join(root, "modules/fix", declared);
      mkdirSync(dir, { recursive: true });
      for (const [name, body] of Object.entries(contents)) writeFileSync(join(dir, name), body);
    }
    return root;
  }

  it("🚨 refuses a declared directory that is not there at all", () => {
    // The silent path this seam exists to close: a typo in `appliers`, or a
    // folder that never got committed, would make `content-apply` find nothing
    // to run and the caller call that a clean pass — while the module goes
    // on claiming its content reaches PROD.
    //
    // ⚠️ Since `filesIn()` refuses, this case is caught one line EARLIER than it
    // used to be — inside the enumerator rather than by `names.length === 0`.
    // So it asserts the module's ID as well as the path: the message quality
    // `_appliers.mjs`'s own throw gives it must survive the move.
    const root = moduleTree("ds24-appliers-typo-", "content/appliars", null);

    expect(() => applierSources(root)).toThrow(/content\/appliars/);
    expect(() => applierSources(root)).toThrow(/"fix"/);
    rmSync(root, { recursive: true, force: true });
  });

  it("🚨 refuses a declared directory that EXISTS and holds no .mjs", () => {
    // The other half, and the one `names.length === 0` still covers on its own:
    // the folder is readable, so nothing threw — it simply has nothing runnable
    // in it. That is the committed-empty-folder case, and it stays a refusal.
    const root = moduleTree("ds24-appliers-empty-", "content/appliers", {
      "notes.md": "not an applier\n",
    });

    expect(() => applierSources(root)).toThrow(/no \.mjs/);
    expect(() => applierSources(root)).toThrow(/"fix"/);
    rmSync(root, { recursive: true, force: true });
  });

  it("is empty in the SHIPPED state — the core's folder is there and holds nothing", () => {
    // Every fresh app looks exactly like this: `scripts/content/appliers/`
    // exists (its `_README.md` holds it open) and has no applier in it. That is
    // the state `apply.mjs`'s friendly no-op branch is written for.
    const bare = mkdtempSync(join(tmpdir(), "ds24-appliers-bare-"));
    mkdirSync(join(bare, "config"), { recursive: true });
    writeFileSync(join(bare, "config/modules.json"), JSON.stringify({ installed: [] }));
    mkdirSync(join(bare, "scripts/content/appliers"), { recursive: true });
    writeFileSync(join(bare, "scripts/content/appliers/_README.md"), "the convention\n");
    expect(applierSources(bare)).toEqual([]);
    rmSync(bare, { recursive: true, force: true });
  });

  it("🚨 refuses when the core's applier directory is ABSENT — FR-302", () => {
    // The case that used to be a silent `[]`: an app whose own applier folder
    // is gone, or that was never carried into a built output. "I could not
    // look" and "there is nothing there" must not be the same answer, and the
    // module half of this same file has made that ruling all along.
    const gone = mkdtempSync(join(tmpdir(), "ds24-appliers-gone-"));
    mkdirSync(join(gone, "config"), { recursive: true });
    writeFileSync(join(gone, "config/modules.json"), JSON.stringify({ installed: [] }));

    expect(() => applierSources(gone)).toThrow(/scripts.content.appliers/);
    // The ABSOLUTE path it tried, not a repo-relative one: the two callers
    // resolve the root differently (`import.meta.url` vs `process.cwd()`), and
    // which root was walked is the whole diagnosis.
    expect(() => applierSources(gone)).toThrow(new RegExp(escapeForRegExp(gone)));
    // …and it never reads as a bare ENOENT.
    expect(() => applierSources(gone)).toThrow(/docs\/content\.md/);
    rmSync(gone, { recursive: true, force: true });
  });

  it("🚨 refuses when the core's applier directory is a FILE", () => {
    // The second cause, and the cheapest one to pin: ENOTDIR rather than
    // ENOENT. The refusal must not be written against one error code — the
    // standalone-image case IS ENOENT, so exempting it would delete the check.
    const notADir = mkdtempSync(join(tmpdir(), "ds24-appliers-file-"));
    mkdirSync(join(notADir, "config"), { recursive: true });
    writeFileSync(join(notADir, "config/modules.json"), JSON.stringify({ installed: [] }));
    mkdirSync(join(notADir, "scripts/content"), { recursive: true });
    writeFileSync(join(notADir, "scripts/content/appliers"), "");

    expect(() => applierSources(notADir)).toThrow(/scripts.content.appliers/);
    expect(() => applierSources(notADir)).toThrow(/docs\/content\.md/);
    rmSync(notADir, { recursive: true, force: true });
  });

  it("🚨 the SHIPPED tree really carries the core's applier directory", () => {
    // The assertion that fails if somebody deletes the placeholder holding the
    // folder open. Without it every fresh app would refuse on its first
    // `content-apply` — git tracks files, not directories.
    const dir = join(ROOT, "scripts", "content", "appliers");
    expect(existsSync(dir), dir).toBe(true);
    expect(() => applierSources(ROOT)).not.toThrow();
    // …and the placeholder is invisible to the walk: not `.mjs`, `_`-prefixed.
    expect(applierSources(ROOT).map((s) => s.label)).not.toContain("_README.md");
  });
});

/** Escapes a path so it can be matched literally inside a `RegExp`. */
function escapeForRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("the content command asks through the shared enumeration", () => {
  // ⚠️ This used to compare TWO commands — `apply.mjs` and `check.mjs` — because
  // each had a private `applierFiles()` hard-coded to the core's folder, and two
  // copies of "what exists" is how one command reports content the other never
  // ran.
  //
  // `check.mjs` was withdrawn (docs/content.md), so only one caller is left. The
  // assertion stays anyway, and deliberately: the reason for the shared
  // enumeration was never "there are two of them" — it was that a module's
  // appliers must be visible to whoever asks. The successor to the withdrawn
  // check will be the second caller, and it will find the enumeration already
  // here rather than writing a third walk.
  const apply = readFileSync(join(ROOT, "scripts", "content", "apply.mjs"), "utf8");

  it("does not walk a directory of its own", () => {
    expect(apply, "apply.mjs enumerates appliers itself").not.toMatch(
      /readdirSync\(\s*APPLIERS_DIR/,
    );
    expect(apply, "apply.mjs does not use the shared enumerator").toContain("applierSources(");
  });

  // The second caller is back, and it is a different shape: `content-check`
  // asks the ENVIRONMENT over the setup surface, and the applier half of that
  // answer is computed in-app by `lib/content/applier-presence.ts`. That file
  // is therefore the one that must not grow a walk of its own.
  it("the in-app half asks through the same enumeration", () => {
    const presence = readFileSync(join(ROOT, "lib", "content", "applier-presence.ts"), "utf8");
    expect(presence, "applier-presence.ts enumerates appliers itself").not.toMatch(
      /readdirSync\(/,
    );
    expect(presence, "applier-presence.ts does not use the shared enumerator").toContain(
      "applierSources(",
    );
  });

  it("and the command itself counts nothing — it delegates", () => {
    // 🚨 The fault the first `content-check` had by construction: it counted
    // appliers from the core, which was the whole answer only while the core
    // could see everything there was. This asserts the new one does not.
    const check = readFileSync(join(ROOT, "scripts", "content", "check.mjs"), "utf8");
    expect(check).not.toMatch(/applierSources\(|readdirSync\(/);
    expect(check).toContain("content_presence");
  });

  // 🚨 The printer's half of the HEAD, and a needle rather than a nicety.
  // `lib/content/media-presence.test.ts` proves the store is ASKED; this proves
  // the answer does not disappear on the way to the screen. An item carrying
  // `notChecked` that renders as `✓` is the original defect in a new place: a
  // tick over a question nobody put. Comments are blanked first, because this
  // file's own prose says every word it looks for.
  it("🚨 renders an unasked question as ⏭, never as a tick", () => {
    const check = blankComments(
      readFileSync(join(ROOT, "scripts", "content", "check.mjs"), "utf8"),
    );

    // The mark is chosen from `notChecked` before it can fall through to `✓`.
    expect(check, "check.mjs never reads notChecked — the third state is invisible").toContain(
      "item.notChecked",
    );
    expect(check).toMatch(/item\.notChecked\s*\?\s*"⏭"/);
    // And the verdict names it. A run that skipped something must not print the
    // same closing sentence as one that asked everything.
    expect(check, "the closing verdict does not know about unchecked items").toMatch(
      /unchecked\.length/,
    );
  });
});

// ── the machinery travels into a standalone build ───────────────────────────
//
// `content_presence` runs INSIDE the app, served from `/api/setup`, and every
// path it walks is resolved at RUNTIME: `config/modules.json` by
// `readFileSync`, each `modules/<id>/module.json` after it, the applier `.mjs`
// files by `pathToFileURL()` with the bundler explicitly told to keep away, and
// `content/media-manifest.json` off `process.cwd()`. None of that is an import,
// so with `output: "standalone"` none of it is something Next can SEE.
//
// 🚨 **What a real build says, so this describe is not a claim about a build
// nobody built.** Measured on next 16.2.11: with this entry removed, every one
// of these files was in `.next/standalone/` anyway — `@vercel/nft` partially
// evaluates the path arithmetic and copies the directory it inferred. So these
// assertions are not standing over an open hole today, and the honest reading
// is the one `next.config.ts` carries: an inference about the current shape of
// `_appliers.mjs` and `presence.ts` is not a stated requirement. Move a
// `join()` behind a helper and the inference stops without a word from
// anywhere; what is written down here does not.
//
// The failure it guards against has one colour and no sound: `filesIn()`
// refuses an unreadable directory, `safely()` turns the throw into
// `unanswered`, and `presenceProblems()` counts that as a failure — in
// production, on a build that passed every gate on the machine that made it.
describe("🚨 the content machinery is traced into a standalone image", () => {
  // Named one by one, so deleting a glob is a red test rather than a shorter
  // list nobody diffs. Each line says which reader stops working without it.
  const REQUIRED: Record<string, string> = {
    "./config/modules.json":
      "scripts/modules/installed.mjs reads it with readFileSync — it throws when it is " +
      "missing, so the FIRST thing that breaks in a standalone image is an app with no " +
      "modules at all",
    "./modules/*/module.json":
      "scripts/modules/registry.mjs needs each installed module's manifest for its " +
      "`appliers` field and its dir",
    "./scripts/content/**":
      "the enumerator itself and the core's own appliers — and the core half fails " +
      "QUIETLY where the module half throws",
    "./content/**/*":
      "the applier material (modules/courses reads content/course/*.json from the APP " +
      "root) and content/media-manifest.json, whose absence removes the product-media " +
      "item from the report entirely",
  };

  it("every path the machinery reads is named for the setup route", () => {
    const globs = CORE_TRACING_INCLUDES[SETUP_TRACING_ROUTE] ?? [];
    for (const [glob, why] of Object.entries(REQUIRED)) {
      expect(
        globs,
        `next.config.ts no longer traces "${glob}" for ${SETUP_TRACING_ROUTE}: ${why}.`,
      ).toContain(glob);
    }
  });

  it("the route key is the one the setup surface is served from", () => {
    // A key nothing matches traces nothing, silently — picomatch is asked about
    // the ROUTE, so a typo here is a no-op rather than an error.
    expect(existsSync(join(ROOT, "app", SETUP_TRACING_ROUTE.slice(1), "route.ts"))).toBe(true);
  });

  it("🚨 no core file names a module — the globs come from the manifests", () => {
    // The module half is `applierTracing()` in scripts/modules/inventory.mjs,
    // derived from each manifest's `appliers` field. `next.config.ts` naming
    // `courses` would be the thing `modules/boundary.test.ts` refuses, and a
    // hand-kept list is wrong the day a fifth module lands.
    const config = blankComments(readFileSync(join(ROOT, "next.config.ts"), "utf8"));
    for (const id of readdirSync(join(ROOT, "modules"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)) {
      expect(config, `next.config.ts names the module "${id}"`).not.toContain(`modules/${id}/`);
    }
  });

  it("the shipped, module-free app traces the core's globs and nothing else", () => {
    // AC 4: `config/modules.json` ships `{ "installed": [] }`, and in that state
    // the entry is exactly the core's — no module id anywhere in it.
    const composed = mergeTracingIncludes(CORE_TRACING_INCLUDES, moduleTracingIncludes(ROOT, []));
    expect(composed[SETUP_TRACING_ROUTE]).toEqual(Object.keys(REQUIRED));
  });

  it("an installed module's applier directory joins that same key", () => {
    // AC 3, against the real `courses` manifest: the module's glob is ADDED to
    // the core's four, never spread over them. A spread would leave one entry
    // here, and the length is what says so.
    const composed = mergeTracingIncludes(
      CORE_TRACING_INCLUDES,
      // `withRequires()`, not the bare id: `courses` declares `requires:
      // ["api"]`, and `moduleTracingIncludes()` swallows `loadModules()`'s
      // refusal of an unclosed list into an empty map — so `["courses"]` would
      // quietly contribute nothing and this assertion would blame the seam.
      moduleTracingIncludes(ROOT, withRequires(["courses"], ROOT)),
    );
    expect(composed[SETUP_TRACING_ROUTE]).toEqual([
      ...Object.keys(REQUIRED),
      "./modules/courses/content/appliers/**/*",
    ]);
  });
});
