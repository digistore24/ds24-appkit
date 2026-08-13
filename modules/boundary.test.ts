// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The guard that keeps a module a module.
//
// Written in this repo's established shape — walk + needle + allowlist with
// reasons + a non-vacuity probe — the same one `lib/ai/providers/leak-guard`,
// `lib/community/dm-guard` and `scripts/core/purity` use, and for the same
// reason: these are rules nobody can remember, protecting properties whose
// breach is invisible until much later.
//
// It carries three kinds of assertion, and the LAST is the one to read before
// changing anything here.
//
//  1. **The boundary.** No core file names a module; a module's three entry
//     files each stay inside their own world.
//
//  1b. **The one exception, and its price.** A module's routes have to live
//     under `app/` because that is the only place Next looks. Those files are
//     named `route.<id>.ts` / `page.<id>.tsx`, are read as the MODULE's rather
//     than the core's, and pay for that by being held to delegating: their own
//     module and the framework, nothing else.
//
//  1c. **The second exception, and it is a product decision rather than a
//     framework one.** Three files in the core's `config/` are named for a
//     module, and they ship in an app that has none of them — because a switch
//     has to outlive an uninstall: switching OFF is the way out `module remove`
//     names when rows exist. So each is written down with its reason, and what
//     gets held instead is that a declared switch file really exists.
//
//  1d. **The core the modules CONSUME, and the three ways they could stop.**
//      Community and courses store bytes today through `lib/media/`'s doors, own
//      no disk of their own, and keep to their own key namespace — all three by
//      fact rather than by construction. §5 is the permanent form of that: an
//      import of a driver, a write to a filesystem, and a slot naming somebody
//      else's namespace are each a refusal.
//
//  2. **Five refusals.** Five things in the core look inconsistent with the
//     module system and are deliberately NOT inverted. They are written down
//     HERE rather than in a design document because a design document is not
//     what somebody reads while "finishing the job" — this test is. Every one
//     of them trades a compile-time guarantee for a runtime lookup, and two
//     have a privilege hole as their failure mode.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { availableModules, loadModules } from "@/scripts/modules/registry.mjs";
import { expectedGenerated } from "@/scripts/modules/generate.mjs";
import { RESERVED_IDS } from "@/scripts/modules/manifest.mjs";
import { installedModules } from "@/scripts/modules/installed.mjs";
import { blankComments as withoutComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Trees a customer's app is built from — the ones that carry CODE.
 *
 * ⚠️ **`config/` is deliberately not one of them, and §1c is why rather than an
 * oversight.** The needle below is an import specifier (`@/modules/<id>`), and a
 * JSON file has none — a content scan there would be green by construction. What
 * config/ really carries is module names in FILE NAMES and in prose, and its own
 * `modules.json` explains the whole system in a `_comment` that names the
 * community. Scanning it for text would flag the file that documents the rule,
 * which is the mistake this repo has now made three times. So the question
 * config/ raises gets a different check, in §1c.
 */
const SCANNED = ["app", "lib", "components", "hooks", "db", "i18n", "scripts"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".dev", "dist", "modules"]);

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
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) yield rel;
  }
}

const ALL_FILES = [...SCANNED.flatMap((dir) => [...sourceFiles(dir)]), "proxy.ts", "next.config.ts", "run.mjs"];

/**
 * The module id a file's NAME declares, or null for an ordinary core file.
 *
 * 🚨 Next scans `app/` and nothing else — there is no runtime route
 * registration — so a module's routes have to live in the core's tree
 * physically. `scripts/modules/page-extensions.mjs` is what makes them appear
 * and disappear: `app/api/v1/me/route.api.ts` is a route exactly while
 * `api.ts` is in `pageExtensions`, which is exactly while the module is
 * installed.
 *
 * Such a file is **not a core file**. It is the module's own route declaration,
 * parked where the framework insists, and it necessarily imports its module —
 * which the boundary below would otherwise read as the hub coming back. The
 * distinction is not an allowlist entry somebody adds per file: the name IS the
 * claim, and §1b holds it to it.
 */
const moduleOf = (file: string): string | null => {
  const base = file.split(/[\\/]/).pop() ?? "";
  const m = /^(?:page|route|layout|default|loading|error|not-found)\.([a-z0-9-]+)\.(tsx?|mjs|js)$/
    .exec(base);
  // 🚨 `route.test.ts` matches this shape exactly, and there are three of them
  // in the tree — which is the whole reason `RESERVED_IDS` exists. Reading the
  // set from the validator rather than restating it here is the point: a name
  // that may not be a module id must not be read as one either, and the two
  // answers cannot drift apart if there is only one.
  return m && !RESERVED_IDS.has(m[1]) ? m[1] : null;
};

const CORE_FILES = ALL_FILES.filter((file) => moduleOf(file) === null);
const MODULE_ROUTE_FILES = ALL_FILES.filter((file) => moduleOf(file) !== null);

/** Strip comments — a file may EXPLAIN a rule while not breaking it. */
// ── 0. the scanner works at all ─────────────────────────────────────────────

describe("the walk is not empty", () => {
  it("found the core files it is supposed to guard", () => {
    // Without this, every assertion below passes on a loop that never runs —
    // the exact green-by-vacuity the rest of this repo refuses.
    expect(CORE_FILES.length).toBeGreaterThan(200);
    expect(CORE_FILES).toContain("proxy.ts");
    expect(CORE_FILES).toContain(join("components", "app-shell.tsx"));
  });

  it("finds a needle that is really there", () => {
    // The probe: if the reader ever stops reading files, this fails first.
    const found = CORE_FILES.filter((file) => read(file).includes("MODULE_GATES"));
    expect(found, "the scanner reads no content").not.toEqual([]);
  });
});

// ── 1. no core file names a module ──────────────────────────────────────────

describe("the core does not know any module by name", () => {
  /**
   * Files that may name a module, each with the reason.
   *
   * Every one is GENERATED — the whole point of generating them is that the
   * core's hand-written files never carry a module's name. An entry here that
   * is not generated is the hub coming back.
   *
   * 🚨 **This list rots in exactly one direction, and it had.** The assertion
   * below returns early when nothing is installed, and the template ships with
   * nothing installed — so a registry that only names a module ONCE ONE IS
   * INSTALLED could be added without this list ever noticing. Two were:
   * `slot-registry.ts` and `cron-registry.ts` both import from
   * `@/modules/<id>` as soon as a module fills a slot or brings a job, so
   * `node run.mjs module add community` turned this suite red in the
   * customer's app — the thing `CLAUDE.md` names as "a bug in the test" rather
   * than a finding. `every registry that WILL name a module is listed` below
   * closes that direction by computing the registries for all modules without
   * installing any.
   */
  const ALLOWED: Record<string, string> = {
    "db/schema-modules.ts": "generated — the schema barrel's module half",
    "lib/modules/registry.ts": "generated — the server entries",
    "lib/modules/nav-registry.ts": "generated — the client-safe navigation",
    "lib/modules/gate-registry.ts": "generated — the off-state gates",
    "lib/modules/messages.ts": "generated — the text catalogue's module half",
    "lib/modules/slot-registry.ts": "generated — the cards modules put on core pages",
    "lib/modules/cron-registry.ts": "generated — the scheduled jobs' bodies",
    "lib/modules/component-registry.ts":
      "generated — what the app's OWN pages import instead of naming a module",
    "lib/modules/server-exports.ts":
      "generated — the server-side twin of the above; the two are separate so a client component cannot drag a module's server graph into the browser",
    "lib/modules/setup-registry.ts":
      "generated — the setup tools a module lends the operator's coding agent",
    "lib/modules/presence-registry.ts":
      "generated — each module's answer to whether an environment holds its rows",
    "lib/modules/content-source-registry.ts":
      "generated — each module's own content source, what the assistant searches. ⚠️ It is also where `modules/community/ai-boundary.test.ts` direction 2 stops reaching: that scan covers `lib/content-source/`, and this file is not in it. Direction 1 — a `contentSource` key or a `content-source` mention inside the community module — is the half that carries FR-217, and it catches the DECLARATION rather than its consequence",
  };

  it("names no installed module outside the generated registries", () => {
    const ids = installedModules(ROOT);
    if (ids.length === 0) {
      // Nothing to find today. The assertion below still runs so the shape is
      // exercised, and the probe in §0 is what proves the scanner works.
      expect(ids).toEqual([]);
      return;
    }
    const offenders: string[] = [];
    for (const file of CORE_FILES) {
      const normalised = file.split(/[\\/]/).join("/");
      if (normalised in ALLOWED) continue;
      const code = withoutComments(read(file));
      for (const id of ids) {
        if (code.includes(`@/modules/${id}`)) offenders.push(`${normalised} → ${id}`);
      }
    }
    expect(
      offenders,
      "these core files import a module directly. Everything the core needs from " +
        "a module comes through a generated registry — a direct import is the hub returning:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("keeps no allowance for a registry that is gone", () => {
    for (const file of Object.keys(ALLOWED)) {
      expect(() => read(file), `${file} is on the allowlist but does not exist`).not.toThrow();
    }
  });

  it("🚨 lists every registry that WILL name a module once one is installed", () => {
    // The direction the assertion above cannot see. It reads what is INSTALLED,
    // and the template installs nothing — so a generated file that names a
    // module only in an app that has one was invisible here for as long as it
    // took somebody to install one. `slot-registry.ts` and `cron-registry.ts`
    // were exactly that, and `module add community` turned this file red in a
    // customer's app for a fault that was not theirs.
    //
    // Computed off the REAL manifests without installing anything, the way
    // `scripts/modules/profiles.test.ts` computes its six profiles.
    const all = availableModules(ROOT);
    const willName = [...expectedGenerated(ROOT, all)]
      .filter(([, body]) => /@\/modules\/[a-z0-9-]+/.test(body))
      .map(([file]) => file.split(/[\\/]/).join("/"));

    // Non-vacuity: a generator that returned nothing, or stopped emitting
    // imports, would make every assertion below pass by describing an empty
    // set — and this test exists because an empty set is what hid the fault.
    expect(all.length, "no modules to compute registries for").toBeGreaterThan(1);
    expect(willName.length, "no generated file names a module — generator broken?")
      .toBeGreaterThan(4);

    for (const file of willName) {
      expect(
        Object.keys(ALLOWED),
        `${file} imports from @/modules/… once a module is installed, and is not ` +
          `on the allowlist above. Installing that module would turn this suite red ` +
          `in the customer's app — which CLAUDE.md calls a bug in the test, not a ` +
          `finding. Add it with the reason it is generated.`,
      ).toContain(file);
    }
  });
});

// ── 1b. a module's route files are the module's, not the core's ─────────────
//
// The one place a module's code legitimately sits inside the core's tree,
// because Next scans `app/` and nothing else. `moduleOf()` above says why they
// are excluded from §1; this is the price of that exclusion.

describe("a module's route files under app/ stay thin and stay their own", () => {
  const importsOf = (source: string) =>
    [...withoutComments(source).matchAll(/from\s+"([^"]+)"|import\s+"([^"]+)"/g)].map(
      (m) => m[1] ?? m[2],
    );

  it(`found ${MODULE_ROUTE_FILES.length} of them`, () => {
    // ⚠️ Zero is the CORRECT answer for an app with no route-bearing module —
    // which is the shipped state, and was every state until one existed. Said
    // out loud rather than passed over, because a silently empty loop is how
    // this whole file would go green while guarding nothing.
    //
    // What must hold either way: nothing named `page.<id>.tsx` may be sitting
    // there for a module this app does NOT have. Such a file compiles, is not
    // a route, and is the one shape that looks installed and is not.
    const available = new Set(availableModules(ROOT));
    for (const file of MODULE_ROUTE_FILES) {
      expect(
        available.has(moduleOf(file)!),
        `${file} is named for "${moduleOf(file)}", which is not a module in this tree`,
      ).toBe(true);
    }
  });

  it("names its own module and no other", () => {
    for (const file of MODULE_ROUTE_FILES) {
      const own = moduleOf(file)!;
      const code = withoutComments(read(file));
      for (const other of availableModules(ROOT)) {
        if (other === own) continue;
        expect(
          code.includes(`@/modules/${other}`),
          `${file} belongs to "${own}" but reaches into "${other}"`,
        ).toBe(false);
      }
    }
  });

  // 🚨 **A title defined in the module and not re-exported here is a title the
  // route does not have.** `export { default } from …` carries the component and
  // nothing else — `generateMetadata` is a separate named export and has to be
  // named separately, which is exactly the sort of thing nobody remembers.
  //
  // Reported 2026-08-12: five module pages whose browser tab said only "Your
  // App" while every core page carried its own name, among them both landing
  // pages a member has open most. Half of that defect is invisible even to a
  // reader of the module — the page HAS its `generateMetadata`, and the omission
  // is one line away in a file nobody opens. It was invisible to every check
  // here too: on the day this was written, deleting only a re-export left the
  // whole suite green.
  //
  // Mechanical, and therefore safe where a textual rule would not be: it asks
  // what the wrapper already delegates to and whether that file exports a title
  // at all. Measured at **0 findings over 17 page wrappers** on the day it was
  // armed — the guard's own loop, not a hand count.
  //
  // ⚠️ **What it does NOT catch, said plainly: a module page with no title at
  // all.** That was the other half of the same report. It is out of scope here
  // because a page that wants no title is a legitimate page, and this file is
  // about the seam between a module and the core's tree, not about what a page
  // owes its reader. 🚨 And it is owned by NOTHING else either — `ux-check` has
  // no page-title rule and no doc states a house form. Whoever wants that
  // covered writes it there; do not read this paragraph as a hand-off.
  it("re-exports the title of the page it delegates to", () => {
    // Only PAGE wrappers. Roughly half of `MODULE_ROUTE_FILES` are
    // `route.<id>.ts` handlers, which have no default re-export and no title —
    // for them "did not match" is the expected state, and lumping them in would
    // let a page wrapper that stopped matching hide inside a set that is half
    // expected misses anyway.
    const pageWrappers = MODULE_ROUTE_FILES.filter((file) => /page\.[^.]+\.tsx$/.test(file));
    let withTitle = 0;

    for (const file of pageWrappers) {
      const source = withoutComments(read(file));
      const target = /export\s*\{[^}]*\bdefault\b[^}]*\}\s*from\s*["'`]@\/([^"'`]+)["'`]/.exec(
        source,
      )?.[1];

      // Every page wrapper delegates — §1b's whole claim. One that does not is
      // a finding about the walk, not a file to skip quietly.
      expect(
        target,
        `${file} has no \`export { default } from "@/…"\` — either it stopped delegating, ` +
          `or the pattern here no longer matches how this template writes it, and then the ` +
          `title check below silently passes over this file.`,
      ).toBeTruthy();
      if (!target) continue;

      // 🚨 Through `blankComments()` on BOTH sides. A page whose comment explains
      // why it has no title would otherwise be read as defining one — the
      // failure `scripts/lib/source-text.mjs` was written for.
      const page = `${target}.tsx`;
      let pageSource: string;
      try {
        pageSource = withoutComments(read(page));
      } catch {
        // A delegation that resolves through another extension or an index file
        // is a finding about this check, never a crash inside it.
        expect.fail(`${file} delegates to "@/${target}", and ${page} is not readable.`);
      }

      // Next accepts either spelling, and the wrapper has to re-export the SAME
      // name — `export { generateMetadata }` for a page that wrote `const
      // metadata` fails the build with "does not provide an export named".
      const exported = /export\s+(?:async\s+)?function\s+generateMetadata\b/.test(pageSource)
        ? "generateMetadata"
        : /export\s+const\s+metadata\b/.test(pageSource)
          ? "metadata"
          : null;
      if (exported === null) continue;

      withTitle += 1;
      // Any `generateMetadata` of its own counts too: a wrapper that wants
      // `params` in the tab writes one locally, and that is delegation's
      // legitimate other shape rather than a missing line.
      const carried =
        new RegExp(`export\\s*\\{[^}]*\\b${exported}\\b[^}]*\\}`).test(source) ||
        new RegExp(`export\\s+(?:async\\s+)?function\\s+${exported}\\b`).test(source) ||
        new RegExp(`export\\s+const\\s+${exported}\\b`).test(source);

      expect(
        carried,
        `${page} defines a title as \`${exported}\` and ${file} neither re-exports nor ` +
          `defines one, so the route has none — the browser tab falls back to the app's ` +
          `own name. Add:\n\n    export { ${exported} } from "@/${target}";`,
      ).toBe(true);
    }

    // Non-vacuity: the loop filters twice more after the wrapper list, and
    // either filter going blind would make it pass over an empty set. Zero is
    // only a legitimate answer for a tree whose modules bring no page at all.
    if (pageWrappers.length > 0) {
      expect(
        withTitle,
        `${pageWrappers.length} module page wrapper(s) exist and not one of them delegates ` +
          `to a page that defines a title. Either every module page lost it, or the two ` +
          `patterns above no longer match how this template writes one — and then this ` +
          `check guards nothing.`,
      ).toBeGreaterThan(0);
    }
  });

  it("delegates rather than implements", () => {
    // The claim this file's NAME makes is "I am that module's". A handler with
    // the logic in it would be a module's code that the module's own tests do
    // not cover and `module remove` would leave behind — so the rule is
    // mechanical: everything it needs comes from its own module, and the only
    // other things it may name are the framework's.
    for (const file of MODULE_ROUTE_FILES) {
      const own = moduleOf(file)!;
      for (const specifier of importsOf(read(file))) {
        const allowed =
          specifier.startsWith(`@/modules/${own}/`) ||
          specifier === `@/modules/${own}` ||
          /^(next|react)(\/|$)/.test(specifier);
        expect(
          allowed,
          `${file} imports "${specifier}". A module's route file delegates to ` +
            `@/modules/${own}/… — anything else is the module's logic living in the core's tree.`,
        ).toBe(true);
      }
    }
  });
});

// ── 1c. the module switches that live in the CORE's config/ ─────────────────
//
// Three files in `config/` are named for a module — `api.json`,
// `community.json`, `ai-companion.json` — and they ship in an app that has none
// of those modules. That looks exactly like the leak §1 forbids, and it is not:
// `module remove` refuses while any row exists, and the lawful way forward it
// names is *keep it installed and switch it OFF in its own config*. A switch
// that vanished with an uninstall would take that way out with it. So the file
// belongs to the core tree on purpose, and what needs holding is different:
//
//   - a module's declared `config` file must EXIST — a missing switch file
//     resolves to OFF, silently, for ever, which is the failure mode every one
//     of these readers is written to have;
//   - and each one is listed HERE with the reason, so a fourth is a decision
//     somebody takes rather than a file that appears.
//
// Derived from the manifests rather than typed out: the set of module config
// paths is declared, and a list retyped here would be the second copy that
// disagrees with the first.

describe("a module's switch may live in the core's config/, and says why", () => {
  const WHY: Record<string, string> = {
    "config/api.json":
      "the api module's switch — it has to outlive an uninstall, because switching OFF is the way out `module remove` names when rows exist",
    "config/community.json":
      "the community's switch, and the file an operator sets the whole module up in — same reason, and the one an app is most likely to still hold rows for",
    "config/ai-companion.json":
      "the companion's switch — same reason; it declares no table, so the switch is the only state it has",
    "config/course.json":
      "the course's switch, and the file its SHAPE is chosen in — same reason, plus one of its own: it ships off because a course has to be installed before its content is written, so the file is edited by every app that has the module and read by none that does not",
  };

  const declared = availableModules(ROOT)
    .map((id) => {
      const manifest = JSON.parse(read(join("modules", id, "module.json")));
      return typeof manifest.config === "string" ? { id, path: manifest.config } : null;
    })
    .filter((entry): entry is { id: string; path: string } => entry !== null);

  it("found the module switches to judge", () => {
    // Non-vacuity: most modules in the tree carry one. Without this the two
    // assertions below pass on an empty list. The floor is a floor rather than
    // the count of the day — a module that declares no switch (`activity`) is a
    // decision, not a regression, so this may not be read as "there are four".
    expect(declared.length).toBeGreaterThanOrEqual(3);
  });

  it("🚨 every declared switch file exists in the tree", () => {
    const missing = declared.filter(({ path }) => {
      try {
        read(path);
        return false;
      } catch {
        return true;
      }
    });
    expect(
      missing.map(({ id, path }) => `${id} → ${path}`),
      "these modules declare a config file that is not shipped. Every one of " +
        "these readers resolves an unreadable file to OFF, so the module would be " +
        "installed, migrated, and silently inert — the one failure this whole " +
        "arrangement is built to make loud:\n",
    ).toEqual([]);
  });

  it("names a reason for every module file in the core's config/", () => {
    const unexplained = declared.filter(({ path }) => !(path in WHY));
    expect(
      unexplained.map(({ id, path }) => `${id} → ${path}`),
      "a module's config file sits in the CORE's tree and is not accounted for " +
        "above. It is allowed — a switch has to outlive an uninstall — but it is " +
        "the one shape §1 otherwise forbids, so it is written down rather than " +
        "noticed later:\n",
    ).toEqual([]);
  });

  it("keeps no reason for a switch that is gone", () => {
    const paths = new Set(declared.map(({ path }) => path));
    const stale = Object.keys(WHY).filter((path) => !paths.has(path));
    expect(
      stale,
      "these are explained above and no module declares them any more — either " +
        "the module lost its switch or the file is a leftover in config/",
    ).toEqual([]);
  });
});

// ── 2. a module's three worlds stay apart ───────────────────────────────────

describe("a module's entry files stay in their own world", () => {
  /** Every specifier a file imports, resolved one level (no closure walk). */
  const importsOf = (source: string) =>
    [...withoutComments(source).matchAll(/from\s+"([^"]+)"|import\s+"([^"]+)"/g)].map(
      (m) => m[1] ?? m[2],
    );

  const records = installedModules(ROOT).length > 0 ? loadModules(ROOT) : [];

  it(`checks the ${records.length} installed module(s)`, () => {
    for (const { id, dir, manifest } of records) {
      if (typeof manifest.gate === "string") {
        // 🚨 The gate runs in front of EVERY matched request. Since Next 16 the
        // proxy runs in the Node runtime, so this is not a platform rule — it
        // is the discipline `proxy.ts` states in its own header: "a Postgres
        // import here would put the whole database layer in front of every
        // request." The guard is named for what it protects, not for a
        // platform constraint that does not exist.
        const gate = importsOf(read(join(dir, manifest.gate)));
        const heavy = gate.filter((s) => /^@\/db|^@\/lib\/(?!modules\/gate)|^node:|^react/.test(s));
        expect(heavy, `${id}'s gate.ts pulls ${heavy.join(", ")} in front of every request`).toEqual(
          [],
        );
      }
      if (typeof manifest.nav === "string") {
        // The nav file reaches the BROWSER through the client shell.
        const nav = importsOf(read(join(dir, manifest.nav)));
        const server = nav.filter((s) => /^@\/db|^node:|config\.json$/.test(s));
        expect(server, `${id}'s nav.ts would put ${server.join(", ")} in the browser`).toEqual([]);
      }
    }
  });
});

// ── 3. modules do not reach into each other ─────────────────────────────────

describe("modules stay independent unless they say otherwise", () => {
  it("imports no other module it has not declared", () => {
    // The invariant that lets the factory test k+2 profiles instead of 2^k.
    const ids = availableModules(ROOT);
    for (const id of ids) {
      const declared = new Set<string>();
      try {
        const manifest = JSON.parse(read(join("modules", id, "module.json")));
        for (const dep of manifest.requires ?? []) declared.add(dep);
      } catch {
        continue;
      }
      for (const file of sourceFiles(join("modules", id))) {
        const code = withoutComments(read(file));
        for (const other of ids) {
          if (other === id || declared.has(other)) continue;
          expect(
            code.includes(`@/modules/${other}`),
            `modules/${id} imports modules/${other} without declaring it in "requires"`,
          ).toBe(false);
        }
      }
    }
  });
});

// ── 4. 🚨 the five refusals ─────────────────────────────────────────────────
//
// Each of these looks inconsistent with everything above. Each is deliberate.
// Read the reason before "finishing the job".

describe("🚨 five things that are NOT inverted, on purpose", () => {
  it("lib/roles.ts keeps ROLES a literal", () => {
    // `users.role` is a CORE column. `canImpersonate()` must statically know a
    // moderator is never impersonated, `requireOwner()` must statically refuse
    // them, and `<RoleBadge>` and the CLI key off the same list. Computing it
    // from installed modules turns a compile-time authz fact into a runtime
    // lookup whose failure mode is a privilege hole.
    //
    // `moderator` exists for the community and stays core anyway: a role
    // nobody grants costs nothing.
    const roles = withoutComments(read("lib/roles.ts"));
    expect(roles).toMatch(/export const ROLES = \[/);
    expect(roles, "ROLES is being computed from modules").not.toMatch(/MODULES|modules\//);
  });

  it("lib/media/rules.ts keeps the owned-media list a literal", () => {
    // Mirrored in three places, one of them RAW SQL in
    // `scripts/privacy/export-data.mjs`, which cannot import TypeScript. If the
    // list shrank with an uninstalled module, the erasure sweep would stop
    // deleting a member's `members`-visibility picture — the exact class of
    // failure `lib/privacy/export.test.ts` exists to prevent.
    const media = withoutComments(read("lib/media/rules.ts"));
    expect(media).toMatch(/OWNED_MEDIA_VISIBILITIES/);
    expect(media, "the owned-media list is being computed from modules").not.toMatch(
      /MODULES|@\/modules\//,
    );
  });

  it("proxy.ts keeps its matcher a static literal", () => {
    // Next reads `config.matcher` out of the AST at build time; it cannot be
    // computed. That is why a module's routes may only live under `dashboard/`
    // or `api/` — enforced at the manifest — and why this stays a literal.
    const proxy = read("proxy.ts");
    expect(proxy).toMatch(/export const config = \{/);
    const matcher = proxy.slice(proxy.indexOf("matcher:"));
    expect(matcher.slice(0, 200), "the matcher is being computed").not.toMatch(
      /MODULE|modules|\.map\(|\.flatMap\(/,
    );
  });

  it("neither GDPR export is gated on a module being installed", () => {
    // The form inverts fine — a loop over installed modules, no `enabled`
    // anywhere. What must NOT appear is a section that vanishes because a
    // module is off or absent while its tables still hold rows. An export says
    // what the app HOLDS.
    //
    // `lib/privacy/export.test.ts` already forbids the switch; this forbids the
    // module-shaped version of the same mistake.
    for (const file of ["lib/privacy/export.ts", "scripts/privacy/export-data.mjs"]) {
      const code = withoutComments(read(file));
      expect(code, `${file} consults module enablement`).not.toMatch(
        /isModuleInstalled|MODULE_GATES|\.enabled\(\)/,
      );
    }
  });

  it("lib/ai/tasks.ts keeps `companion` in the TASKS union", () => {
    // The companion is a MODULE, and its task id is CORE vocabulary — the same
    // shape as `moderator` in `ROLES` and `members` in `MEDIA_VISIBILITIES`
    // above: a name the core knows because a module needs it, costing nothing
    // in an app that never installs one.
    //
    // Inverting it would trade the union — which is what makes `runTask("compnaion")`
    // a compile error and what `config/ai-models.json` is validated against —
    // for a list assembled at runtime from whatever happens to be installed.
    // The failure mode is the one this whole file is about, pointed the wrong
    // way: a binding in the operator's config would stop being checkable, and
    // an app that removed the module would find its recorded `ai_usage` rows
    // naming a task the code no longer admits exists.
    //
    // ⚠️ The two lists are declared TWICE on purpose — `tasks.ts` for the type
    // and `task-rules.mjs` for the bare-Node scripts, which cannot import
    // TypeScript. `lib/ai/tasks.test.ts` is what keeps them equal.
    for (const file of ["lib/ai/tasks.ts", "lib/ai/task-rules.mjs"]) {
      const code = withoutComments(read(file));
      expect(code, `${file} no longer declares the companion task`).toMatch(
        /TASKS = \[[^\]]*"companion"/,
      );
      expect(code, `${file} computes its task list from modules`).not.toMatch(
        /MODULES|@\/modules\//,
      );
    }
  });
});

// ── 5. 🚨 modules consume the media layer; they do not reimplement it ───────
//
// The question this epic was mistaken for was "wouldn't cloud storage in the
// core make sense?" — and it is already there: `lib/media/` is a `MediaStore`
// port with two drivers, four visibilities and three upload doors, and **no
// module writes a byte itself.** Community owns one nullable media FK, courses
// owns four, and both go through `acceptUpload()` / `createUploadTicket()`.
//
// That was true by fact rather than by construction, and there are exactly three
// ways it stops being true. Each is a needle here, modelled on the tree walk in
// `lib/media/manage.test.ts` → "no OTHER file calls acceptUpload":
//
//   1. a module importing a DRIVER (`store`, `s3`, `local`) instead of the
//      doors. That is the port bypassed: no visibility, no rate limit, no EXIF
//      strip, no row — and a second, slightly different opinion about signing.
//   2. a module writing to a FILESYSTEM. On one node in DEV that works; online
//      it is the failure `lib/env-guard.ts` refuses to start for, one layer down
//      where nothing is watching — the next redeploy takes the file, and a
//      second instance never had it.
//   3. a module claiming somebody ELSE's namespace in a storage key. The key
//      exists so an operator can read their own bucket and scope a lifecycle
//      rule to one subsystem; a key that lies about whose it is turns that rule
//      into one that deletes another module's objects.
//
// All three read the source through `blankComments()`, like every text scan in
// this repo — these files explain their own rules at length, and a raw grep
// reports the paragraph that documents a rule as breaking it (`CLAUDE.md` → *A
// checker that reads source as TEXT*).

describe("🚨 a module uses the core's media layer, and only its doors", () => {
  /** Every module in the tree, installed or not — the same set §3 walks. */
  const moduleIds = availableModules(ROOT);

  /**
   * A module's own source, minus its tests, with comments blanked.
   *
   * ⚠️ **Tests are excluded, and only from the filesystem half.** Two courses
   * test files legitimately write to a `mkdtempSync()` directory to build
   * content fixtures, which is not a module keeping state on a disk. The other
   * two needles keep the tests in: a test importing a driver, or asserting a
   * foreign namespace, is the same claim as source doing it.
   */
  const filesOf = (id: string, { withTests }: { withTests: boolean }) =>
    [...sourceFiles(join("modules", id))]
      .filter((file) => withTests || !/\.test\.(ts|tsx|mjs|js)$/.test(file))
      .map((file) => ({ file: file.split(/[\\/]/).join("/"), code: withoutComments(read(file)) }));

  it("finds module source to judge", () => {
    // Non-vacuity for all three assertions below: an empty walk reports every
    // module as clean, which is the green-by-vacuity this whole file refuses.
    expect(moduleIds.length).toBeGreaterThan(1);
    for (const id of moduleIds) {
      expect(filesOf(id, { withTests: true }).length, `no source found for ${id}`).toBeGreaterThan(
        0,
      );
    }
  });

  it("imports no media DRIVER — the port's doors or nothing", () => {
    // `lib/media/store.ts` is the port and the two files beside it are its
    // implementations. A module reaching any of them has stepped past
    // `acceptUpload()`, which is where the visibility, the hourly meter, the
    // byte-signature check and the metadata strip live.
    const offenders: string[] = [];
    for (const id of moduleIds) {
      for (const { file, code } of filesOf(id, { withTests: true })) {
        for (const driver of ["store", "s3", "local"]) {
          if (code.includes(`@/lib/media/${driver}`)) offenders.push(`${file} → ${driver}`);
        }
      }
    }
    expect(
      offenders,
      "these module files import a media DRIVER rather than the media layer's doors. " +
        "`acceptUpload()` / `createUploadTicket()` are where the visibility, the hourly rate " +
        "limit, the byte-signature check and the EXIF strip happen — a driver reached directly " +
        "has none of them, and CLAUDE.md calls an upload door without its guard a bug this " +
        "template has already shipped once:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("writes to no filesystem of its own", () => {
    // ⚠️ **Reads are fine and common** — `content-files.ts`, `smoke.mjs` and
    // `check.mjs` all read the repo, which travels with the deploy. What is
    // refused is a WRITE, because the thing written is state, and state on a
    // node's disk is the failure `lib/env-guard.ts` refuses to start for:
    // gone at the next redeploy, invisible to the second instance, and there
    // about half the time to whoever uploaded it.
    //
    // The three names are the three ways it is actually done, with their `Sync`
    // twins. `mkdtemp` is deliberately NOT among them: a throwaway directory is
    // not state, and it is what the excluded test files use.
    const WRITES = [
      /\bwriteFile(Sync)?\s*\(/,
      /\bcreateWriteStream\s*\(/,
      /\bmkdir(Sync)?\s*\(/,
      /\bappendFile(Sync)?\s*\(/,
    ];
    const offenders: string[] = [];
    for (const id of moduleIds) {
      for (const { file, code } of filesOf(id, { withTests: false })) {
        for (const needle of WRITES) {
          if (needle.test(code)) offenders.push(`${file} → ${needle.source}`);
        }
      }
    }
    expect(
      offenders,
      "these module files write to a filesystem. Bytes belong in the bucket through " +
        "`lib/media/`: a local disk loses every file on the next redeploy and a second instance " +
        "cannot see what the first wrote, which is why MEDIA_DRIVER=local stops the app from " +
        "starting in STAGING and PROD. One layer down, nothing stops it:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("names its OWN namespace in a storage slot, never another's", () => {
    // ── Why the scan is narrowed to media doors ──────────────────────────────
    // `namespace:` is two different words in this tree. In `lib/media/rules.ts`
    // it is half of a `MediaSlot`; in `modules/api/components/keys-ui.tsx` it is
    // an i18n message namespace (`namespace: "apiKeys"`), and a scan for the
    // token alone reports that file as claiming a namespace it does not own.
    // So a slot is read as "a `namespace:` in a file that ENTERS the media
    // layer", which is the only place the field means what this rule is about.
    const DOORS = /\b(acceptUpload|createMedia|createUploadTicket|confirmUpload)\s*\(/;
    const SLOT = /\bnamespace:\s*["'`]([^"'`]*)["'`]/g;

    const seen: string[] = [];
    const offenders: string[] = [];
    for (const id of moduleIds) {
      for (const { file, code } of filesOf(id, { withTests: true })) {
        if (!DOORS.test(code)) continue;
        for (const [, claimed] of code.matchAll(SLOT)) {
          seen.push(`${file} → ${claimed}`);
          if (claimed !== id) offenders.push(`${file} claims "${claimed}", owns "${id}"`);
        }
      }
    }

    // Non-vacuity, and it is the assertion that matters most here: two modules
    // store media today, so a walk that found no slot at all would report both
    // as correct. The number is a floor rather than an equality — a module
    // adding a slot must not have to come back and edit this line.
    expect(
      seen.length,
      "no module names a storage slot at a media door — either both shipped doors stopped " +
        "storing media, or this scan is not reading them. Both make the refusal above vacuous.",
    ).toBeGreaterThanOrEqual(2);

    expect(
      offenders,
      "these module files build a storage key in somebody else's namespace. The key exists so " +
        "an operator can read their own bucket and scope a lifecycle rule to ONE subsystem — a " +
        "key that lies about whose it is turns that rule into one that deletes another " +
        "module's objects. Use the module's own id:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("🚨 all three needles see a planted violation", () => {
    // The probes. Each needle is exercised against text that breaks it and text
    // that does not, so a scan that stopped matching — a renamed door, a regex
    // that lost its word boundary, comments that stopped being blanked — fails
    // HERE rather than reporting every module as clean.
    expect(withoutComments('import { s3 } from "@/lib/media/s3";\n')).toContain("@/lib/media/s3");
    expect(withoutComments('// import from "@/lib/media/s3"\n')).not.toContain("@/lib/media/s3");

    expect(/\bwriteFile(Sync)?\s*\(/.test('writeFileSync(path, "x");')).toBe(true);
    expect(/\bmkdir(Sync)?\s*\(/.test("mkdirSync(dir);")).toBe(true);
    // …and the one that must NOT match, because two courses test files use it.
    expect(/\bmkdir(Sync)?\s*\(/.test("const dir = mkdtempSync(prefix);")).toBe(false);

    const slot = /\bnamespace:\s*["'`]([^"'`]*)["'`]/g;
    expect([...'namespace: "courses",'.matchAll(slot)].map((m) => m[1])).toEqual(["courses"]);
    const doors = /\b(acceptUpload|createMedia|createUploadTicket|confirmUpload)\s*\(/;
    expect(doors.test("await acceptUpload({ ownerId })")).toBe(true);
    // The narrowing itself: the i18n meaning of the word is not at a door, so
    // it is not read as a slot. If this ever flips, the scan starts reporting
    // `modules/api` for a message namespace.
    expect(doors.test('<KeysCard namespace="apiKeys" />')).toBe(false);
  });
});
