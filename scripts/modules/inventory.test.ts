// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What a module adds to the greeting's inventory of "things that shipped".
//
// These are the lists that already went wrong once: the community shipped
// without joining two of them, so every app was told it had built eleven tables
// and a page itself — and every FRESH app took the "carry on" branch instead of
// the "Build my app" line. A module declaring itself is the fix for the class.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import nextConfig, { CORE_TRACING_INCLUDES } from "@/next.config";
import { blankComments } from "@/scripts/lib/source-text.mjs";
import {
  SETUP_TRACING_ROUTE,
  composedMessages,
  mergeTracingIncludes,
  moduleCronJobs,
  moduleNavAreas,
  modulePublicRoutes,
  moduleTablePrefixes,
  moduleTracingIncludes,
  runModuleSmoke,
} from "./inventory.mjs";
import { manifestProblems } from "./manifest.mjs";
import { withRequires } from "./registry.mjs";
import { installedModules } from "./installed.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const roots: string[] = [];

function app(installed: string[], modules: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), "ds24-inventory-"));
  roots.push(root);
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(join(root, "config", "modules.json"), JSON.stringify({ installed }));
  for (const [id, manifest] of Object.entries(modules)) {
    mkdirSync(join(root, "modules", id), { recursive: true });
    writeFileSync(join(root, "modules", id, "module.json"), JSON.stringify(manifest));
  }
  return root;
}

/** Every fixture needs one; what it says is never what the test is about. */
const SUMMARY = "a fixture module, present only so this test has something to read";

const withTables = (id: string) => ({
  id,
  version: "1.0.0",
  title: { de: id, en: id },
  summary: SUMMARY,
  docs: "docs/modules.md",
  navAreas: [id],
  schema: "schema.ts",
  tables: [`${id}_rows`],
  tablePrefix: `${id}_`,
  // Required of a module with tables (Story 36.1), and `collected` is the
  // fixture's default because most of these tests declare no `appliers` — the
  // two that do override it to `authored`, which is the pairing the manifest
  // insists on.
  content: "collected",
  migrations: "drizzle",
  migrationsTable: `__drizzle_migrations_${id}`,
  messages: { namespaces: [id], dir: "messages" },
  privacy: {
    sections: [`${id}Rows`],
    accountNotes: { export: `${id}.accountExportNote`, deletion: `${id}.accountDeletionNote` },
    ts: "privacy/sections.ts",
    mjs: "privacy/sections.mjs",
  },
  erase: true,
  presence: "presence/check.ts",
  cron: "cron.ts",
  cronJobs: [`${id}-prune`],
});

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("what a module contributes", () => {
  it("contributes nothing when nothing is installed", () => {
    const root = app([], {});
    expect(moduleNavAreas(root)).toEqual([]);
    expect(moduleTablePrefixes(root)).toEqual([]);
    expect(moduleCronJobs(root)).toEqual([]);
  });

  it("contributes its nav area, table prefix and jobs", () => {
    const root = app(["community"], { community: withTables("community") });
    expect(moduleNavAreas(root)).toEqual(["community"]);
    expect(moduleTablePrefixes(root)).toEqual(["community_"]);
    expect(moduleCronJobs(root)).toEqual(["community-prune"]);
  });

  it("leaves out a module that declares none of them", () => {
    const root = app(["tiny"], {
      tiny: { id: "tiny", version: "1.0.0", title: { de: "t", en: "t" }, summary: SUMMARY, docs: "docs/modules.md" },
    });
    expect(moduleNavAreas(root)).toEqual([]);
    expect(moduleTablePrefixes(root)).toEqual([]);
  });
});

describe("🚨 a broken arrangement never costs the user their greeting", () => {
  it("answers empty instead of throwing", () => {
    // The greeting is the first thing anybody sees, and CLAUDE.md names the
    // absence of one as the single signal never to read as "fine". A manifest
    // typo must not be able to produce that absence — `module check` is where a
    // broken arrangement is diagnosed.
    const root = app(["gone"], {});
    for (const fn of [moduleNavAreas, moduleTablePrefixes, moduleCronJobs]) {
      expect(() => fn(root)).not.toThrow();
      expect(fn(root)).toEqual([]);
    }
  });
});

describe("the public routes a module declares", () => {
  it("carries the url, the reason and which module brought it", () => {
    const root = app(["community"], {
      community: {
        ...withTables("community"),
        publicRoutes: {
          "/api/community/live":
            "isCommunityEnabled() first, then currentActiveUser(), then per-scope access",
        },
      },
    });
    expect(modulePublicRoutes(root)).toEqual([
      {
        url: "/api/community/live",
        reason:
          "isCommunityEnabled() first, then currentActiveUser(), then per-scope access",
        module: "community",
      },
    ]);
  });

  it("sorts by url, so the merged list does not reshuffle", () => {
    const root = app(["a"], {
      a: {
        id: "a",
        version: "1.0.0",
        title: { de: "a", en: "a" },
        summary: SUMMARY,
        docs: "docs/modules.md",
        publicRoutes: {
          "/api/a/z": "guarded by the handler's own session check, 401 for anonymous",
          "/api/a/a": "guarded by the handler's own session check, 401 for anonymous",
        },
      },
    });
    expect(modulePublicRoutes(root).map((r) => r.url)).toEqual(["/api/a/a", "/api/a/z"]);
  });
});

describe("what a module traces into a standalone build", () => {
  it("merges its globs per route", () => {
    const root = app(["community"], {
      community: {
        ...withTables("community"),
        outputFileTracingIncludes: {
          "/dashboard/community": ["./modules/community/content/**/*"],
        },
      },
    });
    expect(moduleTracingIncludes(root)).toEqual({
      "/dashboard/community": ["./modules/community/content/**/*"],
    });
  });

  it("is empty with no module, so the core's entries are untouched", () => {
    expect(moduleTracingIncludes(app([], {}))).toEqual({});
  });

  // ── `appliers` is a tracing entry too, and nobody types it ────────────────
  //
  // A module that brings tables may bring the appliers that fill them, and
  // those are `.mjs` files loaded by path at runtime — the bundler is told to
  // keep its hands off them in as many words (`lib/content/applier-presence.ts`).
  // So under `output: "standalone"` their presence in the image is a tracing
  // question, and the core cannot answer it for a module: `next.config.ts`
  // naming `courses` is what `modules/boundary.test.ts` refuses. It is derived
  // from the manifest field that already exists.
  it("🚨 derives the /api/setup glob from a module's `appliers` field", () => {
    const root = app(["fix"], {
      fix: { ...withTables("fix"), content: "authored", appliers: "content/appliers" },
    });
    expect(moduleTracingIncludes(root)).toEqual({
      [SETUP_TRACING_ROUTE]: ["./modules/fix/content/appliers/**/*"],
    });
  });

  it("contributes nothing for a module that declares no appliers", () => {
    const root = app(["fix"], { fix: withTables("fix") });
    expect(moduleTracingIncludes(root)).toEqual({});
  });

  it("adds the derived glob to what the module declares itself, never over it", () => {
    // A module free to declare `/api/setup` explicitly must not lose the entry
    // its own `appliers` field implies — the same fold, one layer down.
    const root = app(["fix"], {
      fix: {
        ...withTables("fix"),
        content: "authored",
        appliers: "content/appliers",
        outputFileTracingIncludes: {
          [SETUP_TRACING_ROUTE]: ["./modules/fix/fixtures/**/*"],
        },
      },
    });
    expect(moduleTracingIncludes(root)[SETUP_TRACING_ROUTE]).toEqual([
      "./modules/fix/content/appliers/**/*",
      "./modules/fix/fixtures/**/*",
    ]);
  });

  it("🚨 the SHIPPED module that has appliers really produces the glob", () => {
    // Against the REAL manifest rather than a fixture: `modules/courses`
    // declares `"appliers": "content/appliers"`, so this is the assertion that
    // notices if that field is renamed or the derivation stops firing. A
    // fixture-only version of this test would pass over a dead seam.
    //
    // ⚠️ `withRequires()` and not the bare id. `courses` declares `requires:
    // ["api"]`, and `moduleTracingIncludes()` goes through `safeModules()`,
    // which swallows `loadModules()`'s refusal of an unclosed list into an
    // empty one — so `["courses"]` would answer `undefined` here and this
    // assertion would fail while claiming the seam was dead. `api` declares no
    // appliers, so the expected value is unchanged by carrying it.
    expect(
      moduleTracingIncludes(ROOT, withRequires(["courses"], ROOT))[SETUP_TRACING_ROUTE],
    ).toEqual(["./modules/courses/content/appliers/**/*"]);
  });

  it("the derived glob stays inside modules/<id>/, the bar a declared one clears", () => {
    // `manifestProblems()` refuses a DECLARED glob that points outside the
    // module, because the globs resolve from the app root. A derived one is
    // held to the same bar rather than exempted from it.
    //
    // 🚨 Asked THROUGH the validator rather than restated as a substring here.
    // `toContain("modules/<id>/")` was the same test the validator itself used
    // to run, and that test is exactly what this story replaced: a path can
    // contain the module's folder name and still point at the core's tree.
    // Two copies of a rule drift; one of them is the copy nobody updates.
    for (const id of ["courses"]) {
      const globs =
        moduleTracingIncludes(ROOT, withRequires([id], ROOT))[SETUP_TRACING_ROUTE] ?? [];
      expect(globs.length, id).toBeGreaterThan(0);
      const problems = manifestProblems(
        {
          id,
          version: "1.0.0",
          title: { de: id, en: id },
          summary: SUMMARY,
          docs: "docs/modules.md",
          outputFileTracingIncludes: { [SETUP_TRACING_ROUTE]: globs },
        },
        `modules/${id}/module.json`,
      );
      expect(problems, JSON.stringify(globs)).toEqual([]);
    }
  });

  // ── the core's map and a module's, on the same route key ──────────────────
  //
  // ⚠️ This used to say the collision could not be produced from the real tree,
  // because no shipped manifest declared `outputFileTracingIncludes`. That is
  // still true of the FIELD and no longer true of the collision: `courses`
  // declares `appliers`, and the test above shows that becoming a real
  // `/api/setup` glob against a real core key. The fixture below stays because
  // it is the sharper instrument — it pins the ORDER and the length, which is
  // what a spread would break, and it does so without depending on which
  // modules happen to ship.
  it("🚨 adds a module's globs to the core's for a shared route key", () => {
    // The key is READ out of the core's map, never typed a second time — the
    // point is a collision with whatever the core really traces today.
    const sharedKey = Object.keys(CORE_TRACING_INCLUDES)[0];
    const moduleGlob = "./modules/tracer/content/**/*";
    const ownKey = "/dashboard/tracer";

    const root = app(["tracer"], {
      tracer: {
        id: "tracer",
        version: "1.0.0",
        title: { de: "T", en: "T" },
        summary: SUMMARY,
        docs: "docs/modules.md",
        outputFileTracingIncludes: {
          [sharedKey]: [moduleGlob],
          [ownKey]: [moduleGlob],
        },
      },
    });

    const merged = mergeTracingIncludes(CORE_TRACING_INCLUDES, moduleTracingIncludes(root));

    // Both sides, core's first.
    expect(merged[sharedKey]).toEqual([...CORE_TRACING_INCLUDES[sharedKey], moduleGlob]);
    // 🚨 The needle probe. A spread — `{ ...core, ...moduleTracingIncludes() }`
    // — passes "contains the module's glob" and fails THIS: last writer wins,
    // so the array would hold the module's one entry and none of the core's.
    expect(
      merged[sharedKey],
      `"${sharedKey}" holds ${merged[sharedKey]?.length} glob(s); the core declares ` +
        `${CORE_TRACING_INCLUDES[sharedKey].length} and the module 1. A shorter list means ` +
        `one side was dropped — silently, with no build error and no failing page.`,
    ).toHaveLength(CORE_TRACING_INCLUDES[sharedKey].length + 1);

    // No key from either side goes missing, and the core's other keys are
    // exactly what they were.
    for (const [key, globs] of Object.entries(CORE_TRACING_INCLUDES)) {
      if (key === sharedKey) continue;
      expect(merged[key], key).toEqual(globs);
    }
    expect(merged[ownKey]).toEqual([moduleGlob]);
    expect(Object.keys(merged)).toEqual([...Object.keys(CORE_TRACING_INCLUDES), ownKey]);
  });

  it("folds several maps left to right, keeping first-seen key order", () => {
    expect(
      mergeTracingIncludes(
        { "/a": ["one"], "/b": ["two"] },
        { "/a": ["three"] },
        { "/c": ["four"] },
      ),
    ).toEqual({ "/a": ["one", "three"], "/b": ["two"], "/c": ["four"] });
    expect(Object.keys(mergeTracingIncludes({ "/z": ["x"] }, { "/a": ["y"] }))).toEqual([
      "/z",
      "/a",
    ]);
  });
});

describe("🚨 the shipped app's tracing map is exactly the core's", () => {
  // ⚠️ The literal below is written out on purpose and gets EDITED when what a
  // shipped app traces changes — as Story 34.1 edited it to add `/api/setup`.
  // That is the point: a change to what every customer's image carries is a
  // change somebody makes deliberately. Do NOT loosen it into "contains at
  // least these" to avoid the edit.
  //
  // 🚨 **It pins `CORE_TRACING_INCLUDES`, not `nextConfig`, and that distinction
  // is the whole repair.** It used to read the LIVE composed value —
  // `nextConfig.outputFileTracingIncludes`, which is
  // `mergeTracingIncludes(CORE_TRACING_INCLUDES, moduleTracingIncludes())` —
  // and hold it against the core's literal. In this tree the two agree, because
  // `config/modules.json` ships `{ "installed": [] }`; in a customer's app they
  // agree only until the first `module add`. `courses` declares `appliers`, so
  // its `./modules/courses/content/appliers/**/*` joins `/api/setup` exactly as
  // designed — and the test that exists to catch an UNDELIBERATE change called
  // that a defect (reported 2026-08-12, on an app with five modules).
  //
  // So the claim is split by what each half can honestly say. The core's map is
  // pinned here and edited by hand. What a composed app adds is asserted below
  // as a SHAPE — the core's globs survive at the head of their key, and every
  // added glob belongs to a module that is really installed — which stays true
  // in every app and still refuses the two things that would hurt.
  it("pins the core's own map, a literal that gets edited rather than loosened", () => {
    expect(CORE_TRACING_INCLUDES).toEqual({
      "/api/chat": ["./content/knowledge/**/*"],
      "/dashboard/chat": ["./content/knowledge/**/*"],
      "/api/knowledge-media/\\[\\.\\.\\.path\\]": ["./content/knowledge-media/**/*"],
      // The content machinery `content_presence` walks at runtime — every path
      // resolved from a string rather than an import, so Next cannot see one of
      // them. `scripts/content/appliers.test.ts` names each glob with the
      // reader that stops working without it.
      "/api/setup": [
        "./config/modules.json",
        "./modules/*/module.json",
        "./scripts/content/**",
        "./content/**/*",
      ],
      // The security ladder, which the `check-advisories` job runs INSIDE the
      // app — `lib/cron/security-record.ts` imports `scripts/security/check.mjs`
      // and `verdict.mjs` by file URL with `webpackIgnore`, which is exactly a
      // promise that the bundler will not carry them, and the rungs then read
      // the lockfile off disk. `./scripts/**` rather than the measured file list
      // because that closure MOVES whenever a rung is added; `next.config.ts`
      // carries the measurement and the argument.
      "/api/cron": [
        "./package-lock.json",
        "./config/modules.json",
        "./scripts/**",
        "./lib/diagnostics/parse.mjs",
      ],
    });
    expect(Object.keys(CORE_TRACING_INCLUDES)).toEqual([
      "/api/chat",
      "/dashboard/chat",
      "/api/knowledge-media/\\[\\.\\.\\.path\\]",
      "/api/setup",
      "/api/cron",
    ]);
  });

  it("is what THIS app's next.config.ts actually carries", () => {
    // The live value still gets read — a `next.config.ts` that stopped composing
    // from `CORE_TRACING_INCLUDES`, or composed against the wrong root, would
    // leave the pin above green over an image that traces something else. What
    // it may NOT do is hold the live value against the core's literal: that is
    // true only while nothing is installed, and it is the whole defect this
    // describe was rewritten for.
    //
    // ⚠️ Two claims this deliberately does NOT make, because
    // `scripts/modules/profiles.test.ts` § 6 already makes both over every
    // profile of this tree — the shipped one, each module with its requires,
    // and all of them together: that no profile LOSES a core glob (the object
    // spread that once dropped the handbook from a standalone image), and that
    // the shipped profile is the core's map unchanged. It also carries the
    // needle that a real profile collides on a core key at all, which is what
    // keeps that loop from proving `{...core}` equals `core`.
    expect(nextConfig.outputFileTracingIncludes).toEqual(
      mergeTracingIncludes(
        CORE_TRACING_INCLUDES,
        moduleTracingIncludes(ROOT, withRequires(installedModules(ROOT), ROOT)),
      ),
    );
  });
});

describe("the smoke claims a module makes", () => {
  it("counts a module whose assert() is missing as a failure", async () => {
    // 🚨 Green-by-skip wearing the colour of green-by-check is the confusion the
    // whole smoke script is built against. A module arriving with a broken
    // assertion must not be the quietest way to reach it.
    const root = app(["broken"], {
      broken: {
        id: "broken", version: "1.0.0", title: { de: "b", en: "b" }, summary: SUMMARY,
        docs: "docs/modules.md",
        smoke: "smoke.mjs",
      },
    });
    const failures = await runModuleSmoke(
      { baseUrl: "http://127.0.0.1:1", cookie: "x", isLocal: true },
      root,
    );
    expect(failures).toBe(1);
  });

  it("asks nothing of a module that makes no claim", async () => {
    const root = app(["tiny"], {
      tiny: { id: "tiny", version: "1.0.0", title: { de: "t", en: "t" }, summary: SUMMARY, docs: "docs/modules.md" },
    });
    expect(
      await runModuleSmoke({ baseUrl: "http://127.0.0.1:1", cookie: "x", isLocal: true }, root),
    ).toBe(0);
  });

  it("smoke.mjs really runs them", () => {
    const source = readFileSync(join(ROOT, "scripts/dev/smoke.mjs"), "utf8");
    expect(source).toMatch(/failures \+= await runModuleSmoke\(/);
  });

  it("next.config.ts really merges the tracing globs", () => {
    // Kept as a TEXT assertion beside the composed one above: the other tests
    // build the map by hand, so this is the only thing that would catch the
    // spread being re-introduced into the file they are standing in for.
    //
    // 🚨 It names the MERGE rather than the function, and refuses the spread by
    // name. A bare /moduleTracingIncludes/ would be green in both the fixed and
    // the broken form, which is the whole distinction this line exists to make.
    //
    // ⚠️ Through `blankComments()` — `CLAUDE.md` → *A checker that reads source
    // as TEXT*. The comment above that composition WRITES OUT the broken form
    // it is warning about, so the raw text fails this and the only way to green
    // would be to stop the file explaining itself. Measured here, not theory.
    const source = blankComments(readFileSync(join(ROOT, "next.config.ts"), "utf8"));
    expect(source).toMatch(
      /mergeTracingIncludes\(\s*CORE_TRACING_INCLUDES,\s*moduleTracingIncludes\(\),?\s*\)/,
    );
    expect(
      source,
      "next.config.ts spreads the module entries again — an object spread assigns per " +
        "key, so a module contributing a core route key DELETES the core's globs for it",
    ).not.toMatch(/\.\.\.\s*moduleTracingIncludes\(/);
  });
});

describe("route-protection and the message test really merge them", () => {
  it("route-protection.test.ts adds the module routes to PUBLIC", () => {
    // A module's routes exist only while it is installed, so a hard-coded line
    // in PUBLIC would be dead in every app that declined the module — and the
    // "PUBLIC names a route that does not exist" check would fire on a healthy
    // app.
    const source = readFileSync(join(ROOT, "app/route-protection.test.ts"), "utf8");
    expect(source).toMatch(/for \(const \{ url, reason \} of modulePublicRoutes\(\)\)/);
  });

  it("messages.test.ts adds the module error-code unions", () => {
    const source = readFileSync(join(ROOT, "i18n/messages.test.ts"), "utf8");
    expect(source).toMatch(/of await moduleErrorCodes\(\)/);
    expect(source).toMatch(/ERROR_CODE_UNIONS\[source\] = codes/);
  });
});

describe("the greeting really uses them", () => {
  const source = readFileSync(join(ROOT, "scripts/dev/session-start.mjs"), "utf8");

  it("adds module nav areas, prefixes and jobs to the shipped lists", () => {
    expect(source).toMatch(/for \(const area of moduleNavAreas\(\)\) SHIPPED\.add\(area\)/);
    // ⚠️ The prefixes are the whole list now, not an addition to a seeded one.
    // It used to be `["community_"]` plus a `.push(...)`, because the
    // community's twelve tables shipped in every app; as a module they ship in
    // none, so a hard-coded seed would excuse a prefix nothing matches — which
    // the factory's `scripts/shipped-lists.test.mjs` refuses by name.
    expect(source).toMatch(/const SHIPPED_TABLE_PREFIXES = \[\.\.\.moduleTablePrefixes\(\)\]/);
    expect(source).toMatch(/for \(const job of moduleCronJobs\(\)\) SHIPPED_JOBS\.add\(job\)/);
  });

  it("keeps the Set literals free of brackets", () => {
    // ⚠️ `scripts/session-start.test.ts` and the factory's
    // `scripts/shipped-lists.test.mjs` both read these as TEXT, with a regex
    // that stops at the first `]`. A spread INSIDE the literal would put a
    // bracket there and quietly blind both of them — which is why the module
    // entries are added afterwards.
    for (const name of ["SHIPPED", "SHIPPED_AREAS", "SHIPPED_TABLES", "SHIPPED_JOBS"]) {
      const match = source.match(new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]`));
      expect(match, `${name} is no longer readable as a plain literal`).not.toBeNull();
      expect(match![1], `${name} has a spread inside the literal`).not.toContain("...");
    }
  });
});

// 🚨 The catalogue a checker judges must be the one the APP renders.
//
// `node run.mjs legal-check` used to read `messages/<locale>.json` and nothing
// else, so it reported a missing Art. 50 notice in every app that had installed
// the `companion` module — for a sentence the app was showing perfectly, out of
// `modules/companion/messages/de.json`. A false alarm on a legal check is worse
// than none: it teaches the reader that this command is wrong about things.
describe("composedMessages — the texts a customer really sees", () => {
  /** Adds a catalogue file to a fixture module. */
  function catalogue(root: string, id: string, locale: string, body: unknown) {
    mkdirSync(join(root, "modules", id, "messages"), { recursive: true });
    writeFileSync(
      join(root, "modules", id, "messages", `${locale}.json`),
      JSON.stringify(body),
    );
  }

  it("merges an installed module's own namespace in", () => {
    const root = app(["alpha"], { alpha: withTables("alpha") });
    catalogue(root, "alpha", "de", { alpha: { disclaimer: "Eine KI antwortet hier." } });

    const merged = composedMessages("de", { chat: { disclaimer: "core" } }, root);
    expect(merged.alpha).toEqual({ disclaimer: "Eine KI antwortet hier." });
    // And the core's own is untouched — the failure this replaces was a
    // catalogue that had one half of the app in it.
    expect(merged.chat).toEqual({ disclaimer: "core" });
  });

  it("merges INTO a shared namespace rather than over it", () => {
    // The same rule `mergeModuleMessages()` carries, asserted through this
    // reader: a shallow spread here would take every core error message out.
    const root = app(["alpha"], { alpha: withTables("alpha") });
    catalogue(root, "alpha", "de", { errors: { alphaBroke: "Kaputt." } });

    const merged = composedMessages("de", { errors: { unknown: "Unbekannt." } }, root);
    expect(merged.errors).toEqual({ unknown: "Unbekannt.", alphaBroke: "Kaputt." });
  });

  it("ignores a module that is present but NOT installed", () => {
    // Uninstalled means the code is not in the app at all; its texts are not
    // either, and a checker that read them would judge a page nobody can reach.
    const root = app([], { alpha: withTables("alpha") });
    catalogue(root, "alpha", "de", { alpha: { disclaimer: "Eine KI." } });

    expect(composedMessages("de", { chat: {} }, root).alpha).toBeUndefined();
  });

  it("says nothing about a locale a module does not carry", () => {
    // The core decides which languages exist; a module adds keys, never a
    // language. A missing file here is silence, not a throw — `i18n/
    // messages.test.ts` is where a missing key is a finding.
    const root = app(["alpha"], { alpha: withTables("alpha") });
    catalogue(root, "alpha", "de", { alpha: { disclaimer: "Eine KI." } });

    expect(composedMessages("fr", { chat: {} }, root)).toEqual({ chat: {} });
  });

  it("leaves the core catalogue object alone", () => {
    const root = app(["alpha"], { alpha: withTables("alpha") });
    catalogue(root, "alpha", "de", { alpha: { disclaimer: "Eine KI." } });

    const core = { chat: { disclaimer: "core" } };
    composedMessages("de", core, root);
    expect(core).toEqual({ chat: { disclaimer: "core" } });
  });
});
