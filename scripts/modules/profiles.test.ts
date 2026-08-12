// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The four real modules, in combination — the state nothing else in this repo
// ever produces.
//
// ── What was missing, and why it was invisible ──────────────────────────────
// A fresh app installs no module, so `installedModules()` is `[]` everywhere,
// and everything that loops over it loops over nothing. That is not a gap in one
// test; it is the shape of the whole module system's verification:
//
//   · `loadModules()` refuses two modules claiming one table, one route subtree,
//     one nav feature key, one message namespace or one command. Five `clash()`
//     calls, every one of them dead code in the shipped state.
//   · `modules/boundary.test.ts` §1 and §2 return early on an empty list — their
//     own test names read "checks the 0 installed module(s)".
//   · `scripts/modules/messages.test.ts` and `privacy.test.ts` do the same.
//
// The existing two-module tests fill the hole with FIXTURES: temporary trees and
// synthetic records with ids like `"a"`, `"b"`, `"chat"`, `"zebra"`. Those prove
// the functions work on their arguments, and they are worth keeping. What they
// cannot prove is anything about `activity`, `api`, `community` and `companion`
// — the four manifests that actually ship, the four sets of message files, the
// two real components that both want the `account` slot.
//
// The proof that this distinction is not pedantry is in `docs/modules.md`: the
// flat message spread was correct against one module and against every fixture,
// and deleted eight of the community's refusals the moment a second REAL module
// was installed. Nothing found it but that state.
//
// ── Why this is cheap ──────────────────────────────────────────────────────
// It installs nothing. `loadModules(root, ids)` and `expectedGenerated(root,
// ids)` take the list to load instead of reading `config/modules.json`, so a
// profile is a pure computation over the real tree: no temporary directory, no
// checked-in file rewritten, no database. The whole matrix is milliseconds.
//
// ── Why k+2 profiles and not 2^k ───────────────────────────────────────────
// Six profiles: none, each module alone, and all four together — not the fifteen
// non-empty subsets. Two invariants license that, and if either is ever dropped
// this number has to be revisited:
//
//  1. `modules/boundary.test.ts` §3 — no module imports another it has not
//     declared in `requires`. So there is no code path that exists only for a
//     particular pair.
//  2. Every interaction checked below is over a SET: a collision is a duplicate
//     key anywhere in the profile, and the message fold is a reduction over all
//     of them. The all-four profile therefore contains every pair's interaction
//     — a namespace one module deletes from another is deleted in all-four too.
//
// What all-four does NOT subsume is a module PAIR that only breaks when a third
// is absent, and nothing in the design can produce that. The singles are here
// for the opposite reason: they are the profiles a customer actually runs, and
// they are what proves a module works without the others present.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CORE_TRACING_INCLUDES } from "@/next.config";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";
import { guardableSubtrees } from "@/lib/modules/gate";
import { SHARED_NAMESPACES, mergeModuleMessages } from "@/lib/modules/messages-merge";
import { blankComments } from "@/scripts/lib/source-text.mjs";
import { expectedGenerated } from "./generate.mjs";
import { mergeTracingIncludes, moduleTracingIncludes } from "./inventory.mjs";
import { availableModules, loadModules } from "./registry.mjs";
import de from "@/messages/de.json";
import en from "@/messages/en.json";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Every module in the tree, installed or not — the four that really ship. */
const ALL = availableModules(ROOT);

/**
 * The profiles. `[]` first because it is the shipped state and its assertions
 * are the ones that must keep passing unchanged.
 */
const PROFILES: string[][] = [[], ...ALL.map((id) => [id]), [...ALL]];

const label = (ids: string[]) => (ids.length ? ids.join("+") : "the core alone");

/** The manifest fields this file reads. */
interface Manifest {
  app?: string[];
  commands?: Record<string, unknown>;
  messages?: { dir?: string; namespaces?: string[] };
  slots?: Record<string, string>;
  tables?: string[];
}

type Record_ = { id: string; dir: string; manifest: Manifest };

const load = (ids: string[]) => loadModules(ROOT, ids) as Record_[];

// ── 0. the matrix is not empty ──────────────────────────────────────────────

describe("the matrix has real modules to combine", () => {
  it("found the modules the template ships", () => {
    // Non-vacuity for every loop below. A profile list built from an empty tree
    // would make this whole file pass while measuring nothing — the exact
    // green-by-vacuity it exists to remove.
    expect(ALL).toEqual(["activity", "api", "community", "companion", "courses"]);
    expect(PROFILES).toHaveLength(ALL.length + 2);
  });

  it("reads them off the real tree, not a fixture", () => {
    // The probe: these are the actual shipped manifests. If this file is ever
    // pointed at synthetic records, this fails first.
    const records = load(ALL);
    expect(records.map((r) => r.dir)).toEqual(ALL.map((id) => `modules/${id}`));
    expect(records.flatMap((r) => r.manifest.tables ?? [])).toContain("community_posts");
  });
});

// ── 1. every profile is a coherent app ──────────────────────────────────────

describe("every profile loads", () => {
  for (const ids of PROFILES) {
    it(`${label(ids)} passes every cross-module refusal`, () => {
      // This is the assertion that gives `loadModules()`'s five `clash()` calls
      // something to compare. It is a smoke test in the literal sense: the
      // function throws on a collision, so "does not throw" IS the check.
      expect(() => load(ids)).not.toThrow();
      expect(load(ids).map((r) => r.id)).toEqual(ids);
    });
  }

  it("really compared something in each of the five categories", () => {
    // 🚨 Without this, "does not throw" above would be satisfied by a profile
    // whose modules declare nothing at all — five loops over empty lists,
    // passing loudly. Each count below must exceed one, because a collision
    // needs two keys before it can be a collision.
    const records = load(ALL);
    const counted = {
      tables: records.flatMap((r) => r.manifest.tables ?? []),
      "route subtrees": records.flatMap((r) => r.manifest.app ?? []),
      "message namespaces": records.flatMap((r) => r.manifest.messages?.namespaces ?? []),
      commands: records.flatMap((r) => Object.keys(r.manifest.commands ?? {})),
    };

    for (const [what, keys] of Object.entries(counted)) {
      expect(
        keys.length,
        `the all-four profile claims ${keys.length} ${what} — with fewer than two, ` +
          `the collision check for them ran over nothing and proved nothing`,
      ).toBeGreaterThan(1);
      expect(new Set(keys).size, `duplicate ${what}: ${keys.join(", ")}`).toBe(keys.length);
    }
  });
});

// ── 2. what the generator would emit points at things that exist ────────────

describe("every profile's generated registries reference real files", () => {
  const EXTENSIONS = ["", ".ts", ".tsx", ".mjs", ".js"];

  /**
   * Import specifiers of the form `@/…`, which is where module paths live.
   *
   * 🚨 **Through `blankComments()` first**, and this file learned it the way
   * the rest of the repo did. A generated banner is source too, and
   * `lib/modules/component-registry.ts` has to SHOW an app which import is the
   * legal one — the line it shows is a comment naming a path that resolves to
   * nothing on purpose. Scanned raw, it read as a broken import, and the only
   * way to green would have been to stop the file explaining itself.
   * `CLAUDE.md` → *A checker that reads source as TEXT* is the rule; this is
   * the sixteenth copy it was written for.
   */
  const appImports = (content: string) =>
    [...blankComments(content).matchAll(/from "(@\/[^"]+)"/g)].map((m) => m[1]);

  for (const ids of PROFILES) {
    it(`${label(ids)} imports nothing that is not on disk`, () => {
      // The failure this catches: a module renames `components/account-card.tsx`
      // and the manifest still names the old path. Today nothing notices — the
      // generated registry is empty, so the bad path is never written, and it
      // surfaces for the first time on the customer's account page as React
      // being handed `undefined`. Relative imports (`./types`) are left to the
      // typecheck; they are core files and cannot move with a module.
      const broken: string[] = [];
      for (const [file, content] of expectedGenerated(ROOT, ids)) {
        for (const spec of appImports(content)) {
          const rel = spec.replace(/^@\//, "");
          if (!EXTENSIONS.some((ext) => existsSync(join(ROOT, rel + ext)))) {
            broken.push(`${file} imports "${spec}", which resolves to no file`);
          }
        }
      }
      expect(broken, broken.join("\n")).toEqual([]);
    });
  }

  it("resolved real specifiers, not an empty list", () => {
    // The probe for the loop above: `appImports` returning nothing would make
    // every profile pass without a single path being checked.
    const found = [...expectedGenerated(ROOT, ALL).values()].flatMap(appImports);
    expect(found.length).toBeGreaterThan(4);
    expect(found).toContain("@/modules/community/module");
  });

  it("names exactly the profile's modules and no others", () => {
    for (const ids of PROFILES) {
      // Comments blanked, same reason as `appImports` above: a registry that
      // documents the shape of a module path is not a registry that names a
      // module. What must not appear is a real IMPORT.
      const content = [...expectedGenerated(ROOT, ids).values()]
        .map(blankComments)
        .join("\n");
      for (const id of ALL) {
        expect(
          content.includes(`@/modules/${id}/`),
          `${label(ids)}: the registries ${ids.includes(id) ? "omit" : "name"} "${id}"`,
        ).toBe(ids.includes(id));
      }
    }
  });
});

/** A module's own catalogue per locale, read off the disk. */
const cataloguesOf = (record: Record_): Map<string, Record<string, unknown>> => {
  const dir = record.manifest.messages?.dir;
  const out = new Map<string, Record<string, unknown>>();
  if (!dir) return out;
  for (const file of readdirSync(join(ROOT, record.dir, dir))) {
    if (!file.endsWith(".json")) continue;
    const locale = file.replace(/\.json$/, "");
    out.set(locale, JSON.parse(readFileSync(join(ROOT, record.dir, dir, file), "utf8")));
  }
  return out;
};

// ── 3. 🚨 the message fold — the bug that shipped ───────────────────────────

describe("🚨 no module's texts are deleted by another's", () => {
  // The measured failure, from `docs/modules.md`: module messages were folded
  // with a shallow spread, `{...activity_de, ...companion_de}`. A module owns its
  // own namespace, so that looked safe and was — for owned namespaces. But every
  // module also writes into `errors` and `nav`, which the CORE owns, and the last
  // spread replaced the whole object. Eight of the community's refusals rendered
  // as raw keys, and only the state "two real modules installed" could show it.
  //
  // This reproduces the fold the generated file performs —
  // `[a, b].reduce(mergeModuleMessages, {})` — and then the merge
  // `i18n/request.ts` performs on top of the core catalogue, and asks whether
  // everything that went in came out.
  const CORE: Record<string, Record<string, unknown>> = {
    de: de as Record<string, unknown>,
    en: en as Record<string, unknown>,
  };

  const keysUnder = (catalogue: Record<string, unknown>, namespace: string): string[] => {
    const block = catalogue[namespace];
    return block && typeof block === "object" && !Array.isArray(block)
      ? Object.keys(block as Record<string, unknown>)
      : [];
  };

  for (const ids of PROFILES) {
    if (ids.length === 0) continue; // nothing to fold, and §4 covers the core

    it(`${label(ids)} keeps every key every module contributed`, () => {
      const records = load(ids);

      for (const locale of Object.keys(CORE)) {
        const contributors = records
          .map((record) => ({ record, catalogue: cataloguesOf(record).get(locale) }))
          .filter((entry): entry is { record: Record_; catalogue: Record<string, unknown> } =>
            Boolean(entry.catalogue),
          );
        if (contributors.length === 0) continue;

        // Exactly what the generated `lib/modules/messages.ts` computes …
        const folded = contributors
          .map((entry) => entry.catalogue)
          .reduce(mergeModuleMessages, {} as Record<string, unknown>);
        // … and exactly what `i18n/request.ts` does with it.
        const final = mergeModuleMessages(CORE[locale], folded);

        for (const { record, catalogue } of contributors) {
          for (const namespace of Object.keys(catalogue)) {
            if ((SHARED_NAMESPACES as readonly string[]).includes(namespace)) {
              // Shared: the module's keys must survive INSIDE the core's block.
              for (const key of keysUnder(catalogue, namespace)) {
                expect(
                  keysUnder(final, namespace),
                  `${locale}: "${record.id}" contributes ${namespace}.${key}, and the ` +
                    `merged catalogue has lost it — it would render to a member as its ` +
                    `raw key. This is the failure a shallow spread caused once.`,
                ).toContain(key);
              }
              continue;
            }
            // Owned: the whole namespace must be there, unreplaced.
            expect(
              final[namespace],
              `${locale}: "${record.id}" owns the "${namespace}" namespace and it is ` +
                `not in the merged catalogue`,
            ).toEqual(catalogue[namespace]);
          }
        }
      }
    });
  }

  it("🚨 keeps every one of the CORE's own shared keys", () => {
    // The other half, and the sharper one: the eight refusals that vanished were
    // the core's, not a module's. A module writing into `errors` must ADD to it.
    const records = load(ALL);
    for (const locale of Object.keys(CORE)) {
      const folded = records
        .map((record) => cataloguesOf(record).get(locale))
        .filter((c): c is Record<string, unknown> => Boolean(c))
        .reduce(mergeModuleMessages, {} as Record<string, unknown>);
      const final = mergeModuleMessages(CORE[locale], folded);

      for (const namespace of SHARED_NAMESPACES) {
        const before = keysUnder(CORE[locale], namespace);
        expect(
          before.length,
          `the core declares no ${namespace} keys in ${locale} — then this ` +
            `assertion is measuring nothing`,
        ).toBeGreaterThan(0);
        const after = keysUnder(final, namespace);
        const lost = before.filter((key) => !after.includes(key));
        expect(
          lost,
          `${locale}: installing all four modules deletes the core's ` +
            `${namespace} keys: ${lost.join(", ")}. Every one of them renders to a ` +
            `member as a raw key.`,
        ).toEqual([]);
      }
    }
  });

  it("measured a profile in which two modules really share a namespace", () => {
    // 🚨 The non-vacuity probe for this whole describe, and the one that matters
    // most: if only one module ever wrote into `errors`, the fold above would be
    // trivially correct and this file would be guarding the shipped bug's shape
    // without being able to see it.
    const records = load(ALL);
    const sharers = SHARED_NAMESPACES.map((namespace) => ({
      namespace,
      modules: records
        .filter((record) => {
          const catalogue = cataloguesOf(record).get("de");
          return catalogue ? keysUnder(catalogue, namespace).length > 0 : false;
        })
        .map((record) => record.id),
    }));

    const contested = sharers.filter((entry) => entry.modules.length > 1);
    expect(
      contested.length,
      `no shared namespace is written by two modules at once: ` +
        sharers.map((s) => `${s.namespace} ← ${s.modules.join(", ") || "nobody"}`).join("; ") +
        `. The measured failure needed exactly that state, so this file cannot ` +
        `see it and the assertions above are green for nothing.`,
    ).toBeGreaterThan(0);
  });
});

// ── 3a. 🚨 a module maintains BOTH of its languages ─────────────────────────
//
// 🚨 `i18n/messages.test.ts` is the reason the second language does not rot, and
// for a MODULE it is vacuous in the tree the template ships from. Its catalogue
// is `mergeModuleMessages(de, MODULE_MESSAGES.de ?? {})`, and `MODULE_MESSAGES`
// is generated from `config/modules.json`, which ships EMPTY — so a module's
// keys are not in it. `scripts/modules/messages.test.ts` is no better placed: it
// iterates the INSTALLED modules and says so in its own name ("checks the 0
// installed module(s)").
//
// Measured on story 8.6: had `coursesAdmin.digestCta` been written into `de.json`
// only, no gate here would have gone red, and the button in an English
// operator's mail would have read `coursesAdmin.digestCta` — not as an error but
// as text, because `i18n/catalogue.ts`'s `onIntlError` logs and renders the key
// path rather than throwing.
//
// So the question is asked here, where the real manifests are read off the tree
// whatever `config/modules.json` says. Same two claims the core's own test makes:
// the same key paths, and the same ICU placeholders in each of them.

describe("🚨 every module keeps its languages in step", () => {
  /** All keys of a nested object as "a.b.c" — the core test's own shape. */
  const keyPaths = (value: unknown, prefix = ""): string[] =>
    typeof value !== "object" || value === null
      ? [prefix]
      : Object.entries(value).flatMap(([key, inner]) =>
          keyPaths(inner, prefix ? `${prefix}.${key}` : key),
        );

  /** `{name}` and `{name, plural, …}` — a plural's text branches are text. */
  const placeholders = (message: string): string[] =>
    [...message.matchAll(/\{\s*(\w+)\s*[,}]/g)].map((match) => match[1]).sort();

  const messageAt = (catalogue: unknown, path: string): unknown =>
    path
      .split(".")
      .reduce<unknown>(
        (acc, part) =>
          typeof acc === "object" && acc !== null
            ? (acc as Record<string, unknown>)[part]
            : undefined,
        catalogue,
      );

  const withMessages = load(ALL).filter((record) => cataloguesOf(record).size > 0);

  it("has modules with catalogues to compare, in more than one language", () => {
    // Non-vacuity. A module with one language file would make every comparison
    // below a comparison with itself.
    expect(withMessages.map((record) => record.id).length).toBeGreaterThan(2);
    for (const record of withMessages) {
      expect(
        [...cataloguesOf(record).keys()].sort(),
        `${record.id} does not ship the locales i18n/config.ts declares`,
      ).toEqual([...LOCALES].sort());
    }
  });

  for (const record of withMessages) {
    it(`${record.id}: de and en carry the same keys and the same placeholders`, () => {
      const catalogues = cataloguesOf(record);
      const reference = keyPaths(catalogues.get(DEFAULT_LOCALE)!).sort();
      expect(reference.length, `${record.id} has no message keys at all`).toBeGreaterThan(0);

      for (const locale of LOCALES) {
        if (locale === DEFAULT_LOCALE) continue;
        const catalogue = catalogues.get(locale)!;
        const existing = keyPaths(catalogue).sort();

        expect(
          reference.filter((key) => !existing.includes(key)),
          `${record.id}/${locale}.json is missing keys that ${DEFAULT_LOCALE}.json ` +
            `has. A missing module text does not throw — it renders as its own key ` +
            `path, in a page or in an operator's mail.`,
        ).toEqual([]);
        expect(
          existing.filter((key) => !reference.includes(key)),
          `${record.id}/${locale}.json has keys ${DEFAULT_LOCALE}.json does not`,
        ).toEqual([]);

        for (const key of reference) {
          const source = messageAt(catalogues.get(DEFAULT_LOCALE)!, key);
          const target = messageAt(catalogue, key);
          if (typeof source !== "string" || typeof target !== "string") continue;
          expect(
            placeholders(target),
            `${record.id}/${locale}.json → ${key} does not take the same values as ` +
              `${DEFAULT_LOCALE}.json. ICU renders an unknown placeholder as literal ` +
              `text and a missing one as nothing at all.`,
          ).toEqual(placeholders(source));
        }
      }
    });
  }
});

// ── 3b. 🚨 every gate guards everything its module builds ───────────────────

describe("🚨 a module's gate covers the routes its manifest declares", () => {
  // The miss that shipped once: the community's hand-written block in `proxy.ts`
  // covered `/dashboard/community` and not `/dashboard/admin/community`, so the
  // operator's tree fell through to its own in-page `notFound()` — a
  // layout-wrapped document any signed-in member could tell apart from a real
  // 404, and that page's `notFound()` runs BEFORE its `requireOwner()`.
  //
  // `coversSubtrees()` was the fix, and `gate.test.ts` proves the helper works
  // against a fixture. What neither proves is that a module's own `gate.ts`
  // handed it the right list — it cannot read its manifest (no `fs` in front of
  // every request), so the list is a hand-written copy. Until this file, the copy
  // was compared to the original only in an app that had the module installed,
  // which is no app the factory ever builds.
  const withGate = load(ALL).filter((record) => (record.manifest as { gate?: string }).gate);

  it("has a gate to check", () => {
    // Non-vacuity. Should this reach zero, the off-state mechanism has left the
    // product and everything below is theatre.
    expect(withGate.length).toBeGreaterThan(0);
  });

  for (const record of load(ALL).filter((r) => (r.manifest as { gate?: string }).gate)) {
    it(`${record.id}'s gate covers every page subtree it builds`, async () => {
      const gateFile = (record.manifest as { gate: string }).gate.replace(/\.ts$/, "");
      const loaded = (await import(
        /* @vite-ignore */ `@/${record.dir}/${gateFile}`
      )) as { default: { id: string; covers: (path: string) => boolean } };
      const gate = loaded.default;

      expect(gate.id, `${record.id}'s gate calls itself "${gate.id}"`).toBe(record.id);

      const subtrees = guardableSubtrees((record.manifest.app ?? []) as string[]);
      expect(
        subtrees.length,
        `"${record.id}" declares a gate but no dashboard/ subtree — the gate guards nothing`,
      ).toBeGreaterThan(0);

      for (const subtree of subtrees) {
        expect(
          gate.covers(`/${subtree}`),
          `"${record.id}" builds /${subtree} and its gate does not cover it. Switched ` +
            `off, that route falls through to whatever the page does on its own — the ` +
            `distinguishable document the gate exists to prevent. Add it to the list in ` +
            `${record.dir}/${(record.manifest as { gate: string }).gate}.`,
        ).toBe(true);
      }
    });
  }

  it("🚨 a gate covers a page BELOW a declared subtree, not only the subtree itself", () => {
    // The claim that lets a module add a route without touching `module.json`
    // or its `gate.ts`: `coversSubtrees()` matches every path under a declared
    // one, so `dashboard/admin/course` covers the course's answering surface
    // and its dynamic detail page too. Without this, "no manifest line needed"
    // would be an argument nothing measures — and a deeper page falling through
    // the gate is exactly the failure the community shipped once: a
    // layout-wrapped `notFound()` any signed-in member can tell from a real 404.
    const record = load(ALL).find((entry) => entry.id === "courses");
    expect(record, "the courses module is not on disk — this check is idle").toBeDefined();
    expect(record!.manifest.app ?? []).toContain("dashboard/admin/course");
  });

  it("courses' gate covers the paths below its declared subtree", async () => {
    const record = load(ALL).find((entry) => entry.id === "courses")!;
    const gateFile = (record.manifest as { gate: string }).gate.replace(/\.ts$/, "");
    const loaded = (await import(/* @vite-ignore */ `@/${record.dir}/${gateFile}`)) as {
      default: { covers: (path: string) => boolean };
    };
    const gate = loaded.default;

    for (const path of [
      "/dashboard/admin/course",
      "/dashboard/admin/course/submissions",
      // The dynamic detail page, with a real-shaped id. This is the one
      // `node run.mjs smoke` never calls, so the claim that a switched-off
      // course answers a real 404 there is made here and in
      // `modules/courses/smoke.mjs`, nowhere else.
      "/dashboard/admin/course/submissions/abc",
    ]) {
      expect(gate.covers(path), `courses' gate does not cover ${path}`).toBe(true);
    }

    // The control: it covers what it declares and not the neighbourhood.
    expect(gate.covers("/dashboard/admin/courses-other")).toBe(false);
    expect(gate.covers("/dashboard/admin")).toBe(false);
  });

  it("does not demand a gate cover an api/ subtree", () => {
    // The control for `guardableSubtrees()`. `proxy.ts`'s matcher cannot be
    // computed, so it never runs for `api/…` and a gate covering one would be a
    // guarantee that never executes. The community declares `api/community` and
    // its gate does NOT cover it — correctly, and the assertions above must keep
    // saying so rather than growing to demand it.
    const declared = load(ALL).flatMap((r) => (r.manifest.app ?? []) as string[]);
    expect(declared, "no module declares an api/ subtree — this control is idle").toContain(
      "api/community",
    );
    expect(guardableSubtrees(declared)).not.toContain("api/community");
  });
});

// ── 3c. 🚨 a module's scheduled jobs ────────────────────────────────────────

describe("🚨 a module's cron ids match the jobs it actually exports", () => {
  // `cronJobs` (the names) and `cron` (the bodies) are two fields, and they are
  // two for a reason: `lib/cron/config.ts` must know the names without importing
  // the bodies, because `instrumentation.ts` reads it and is built for the edge
  // runtime. `lib/cron/rules.test.ts` holds `JOB_IDS` to `CRON_JOBS` — but only
  // for what is INSTALLED, which in a fresh app is the core alone. So a module's
  // two halves could disagree and nothing would say so until somebody installed
  // it: the id would be configurable and no job would answer to it, or a job
  // would run that `config/cron.json` could not name.
  //
  // This is also where the field earned the right to exist. `cronJobs` used to be
  // accepted with no `cron` beside it — validated, printed by `module list`, and
  // deliberately excluded from the greeting's reminder so the customer would not
  // be nagged about it — while nothing registered the job and it could never run.
  const withCron = load(ALL).filter((r) => (r.manifest as { cron?: string }).cron);

  it("has a module that brings a job", () => {
    // Non-vacuity, and the canary for the whole seam: at zero, everything below
    // is theatre and the generated registries are empty by accident rather than
    // by arithmetic.
    expect(withCron.length).toBeGreaterThan(0);
  });

  for (const record of load(ALL).filter((r) => (r.manifest as { cron?: string }).cron)) {
    it(`${record.id} exports exactly the ids it declares`, async () => {
      const file = (record.manifest as { cron: string }).cron.replace(/\.ts$/, "");
      const loaded = (await import(/* @vite-ignore */ `@/${record.dir}/${file}`)) as {
        default: Array<{ id: string; describe: string; enabledByDefault?: boolean }>;
      };
      const declared = ((record.manifest as { cronJobs?: string[] }).cronJobs ?? []).slice();

      expect(loaded.default.map((job) => job.id).sort()).toEqual([...declared].sort());
      for (const job of loaded.default) {
        // `cron --list` prints this, and a job nobody can describe is a job
        // nobody can decide about.
        expect(job.describe.length, `${job.id} has no description`).toBeGreaterThan(10);
      }
    });
  }

  it("🚨 claims no job id the CORE already runs", () => {
    // The cross-boundary check, and the same gap as the table prefixes above:
    // `loadModules()` compares modules to each other, `manifest.mjs` sees one
    // manifest at a time, and nobody compared a module against the core. `JOB_IDS`
    // is ONE flat list, so a module claiming `prune-ai-usage` would give
    // `jobById()` a first match and the core's job would silently stop running —
    // a retention job that quietly does nothing, which is the failure mode this
    // whole area is built to make visible.
    const core = readFileSync(join(ROOT, "lib", "cron", "ids.mjs"), "utf8");
    const coreIds = [...core.matchAll(/^\s+"([a-z][a-z0-9-]*)",$/gm)].map((m) => m[1]);
    expect(coreIds.length, "found no core job ids — then this compares nothing").toBeGreaterThan(3);

    const clashes = load(ALL)
      .flatMap((r) => ((r.manifest as { cronJobs?: string[] }).cronJobs ?? []).map((j) => ({ id: r.id, j })))
      .filter((entry) => coreIds.includes(entry.j));
    expect(
      clashes.map((c) => `${c.id} claims the core's job "${c.j}"`),
      "a module claims a job id the core already runs — jobById() returns the first " +
        "match, so one of the two would silently never run",
    ).toEqual([]);
  });
});

// ── 4. two modules on one page ──────────────────────────────────────────────

describe("the account slot with more than one card in it", () => {
  // `api` and `community` both declare `slots.account`. Every existing test of
  // that case uses mocks (`slots.test.ts` feeds the renderer `alpha` and `beta`)
  // or synthetic records (`zebra`, `alpha`). This is the two real ones.
  const fillers = (ids: string[]) =>
    load(ids)
      .filter((record) => record.manifest.slots?.account)
      .map((record) => record.id);

  it("has two real modules that want the same slot", () => {
    // Non-vacuity, and a canary: should this ever drop to one, the whole
    // multi-card case has left the product and the describe below is theatre.
    expect(fillers(ALL).length).toBeGreaterThan(1);
  });

  for (const ids of PROFILES) {
    it(`${label(ids)} lists exactly its own fillers, in install order`, () => {
      const registry = expectedGenerated(ROOT, ids).get("lib/modules/slot-registry.ts")!;
      const listed = [...registry.matchAll(/module: "([^"]+)"/g)].map((m) => m[1]);
      expect(listed).toEqual(fillers(ids));
    });
  }

  it("imports both components under distinct aliases", () => {
    // The failure this catches is a generator that derives its import alias from
    // the slot name alone: two modules filling `account` would emit
    // `import account_slot from …` twice, and the second would shadow the first
    // — one card silently replaced by the other. It is exactly the shape of the
    // message-spread bug, one layer down.
    const registry = expectedGenerated(ROOT, ALL).get("lib/modules/slot-registry.ts")!;
    const aliases = [...registry.matchAll(/^import (\w+) from/gm)].map((m) => m[1]);
    expect(aliases.length).toBe(fillers(ALL).length);
    expect(new Set(aliases).size, `duplicate alias: ${aliases.join(", ")}`).toBe(aliases.length);
  });
});

// ── 5. the tables of a full app ─────────────────────────────────────────────

describe("all four modules' tables coexist with the core's", () => {
  // ⚠️ Two obvious assertions are deliberately NOT here, because `manifest.mjs`
  // already owns them and one place decides:
  //
  //   · a table outside its module's prefix — `manifest.mjs:206` requires the
  //     prefix to start with the module id and the tables to start with the
  //     prefix;
  //   · two modules sharing a migration journal — `:216` pins it to exactly
  //     `__drizzle_migrations_<id>`, so distinctness follows from the ids being
  //     folder names.
  //
  // Measured rather than assumed: mutating either one makes `readModule()` throw
  // and takes this whole file red with it. Restating them here would be a second
  // opinion about a rule that has an owner.
  //
  // What follows is the question no per-manifest validator can ask, because it
  // needs both sides at once.

  /** Core table names, found the way the greeting finds them. */
  const coreTables = (): string[] => {
    const found = new Set<string>();
    for (const file of readdirSync(join(ROOT, "db"))) {
      if (!file.startsWith("schema") || !file.endsWith(".ts")) continue;
      if (file.includes(".test.") || file === "schema-modules.ts") continue;
      const source = readFileSync(join(ROOT, "db", file), "utf8");
      for (const match of source.matchAll(/pgTable\(\s*"([A-Za-z0-9_]+)"/g)) found.add(match[1]);
    }
    return [...found].sort();
  };

  it("🚨 no module's table prefix shadows a table the core already has", () => {
    // The gap this closes: `loadModules()` compares modules to EACH OTHER, and
    // the manifest validator sees one module at a time. Nobody compares a module
    // against the core — so a module whose id makes its prefix swallow a core
    // table is refused by nothing.
    //
    // It is not hypothetical arithmetic. The core has `ai_usage`, `chat_messages`
    // and `token_ledger`; a module called `ai`, `chat` or `token` — all three are
    // plausible next modules, and `docs/modules.md` names a chat module as a
    // candidate — would take `ai_`, `chat_` or `token_` as its prefix and
    // silently claim a core table as its own. What breaks then is not the build:
    // `module check` reports the core's table as an orphan belonging to that
    // module, the greeting stops naming it, and `module remove --drop-data`
    // offers to DROP it.
    const core = coreTables();
    expect(core.length, "found no core tables — then this compares nothing").toBeGreaterThan(10);

    const offenders: string[] = [];
    for (const record of load(ALL)) {
      const prefix = (record.manifest as { tablePrefix?: string }).tablePrefix;
      if (!prefix) continue;
      for (const table of core) {
        if (table.startsWith(prefix)) {
          offenders.push(`"${record.id}" (prefix "${prefix}") swallows the core's "${table}"`);
        }
      }
    }
    expect(
      offenders,
      `a module's table prefix covers a table the CORE owns:\n${offenders.join("\n")}\n` +
        `Rename the module, or the core table. A prefix is how every script decides ` +
        `whose row a row is, and this one answers "the module's" about the core's data.`,
    ).toEqual([]);
  });

  it("declares no table the core already has", () => {
    // The blunter half of the same question. Covered today by the prefix rule
    // (a module's tables all start with its id), but the prefix rule is one edit
    // away from being relaxed and this is the failure it would let through.
    const core = new Set(coreTables());
    const clashes = load(ALL)
      .flatMap((record) => (record.manifest.tables ?? []).map((t) => ({ id: record.id, t })))
      .filter((entry) => core.has(entry.t));
    expect(
      clashes.map((c) => `${c.id} declares the core's "${c.t}"`),
      "a module claims a table the core already creates — its migration would " +
        "collide with the core's, and both exports would name the same rows twice",
    ).toEqual([]);
  });

  it("re-exports every module's schema into one barrel", () => {
    const barrel = expectedGenerated(ROOT, ALL).get("db/schema-modules.ts")!;
    const withSchema = load(ALL).filter((r) => (r.manifest as { schema?: string }).schema);
    expect(withSchema.length).toBeGreaterThan(1);
    for (const record of withSchema) {
      expect(barrel).toContain(`export * from "@/${record.dir}/schema";`);
    }
  });
});

// ── 6. the build's file tracing, per profile ────────────────────────────────

describe("🚨 no profile loses one of the core's tracing globs", () => {
  // `next.config.ts` composes `outputFileTracingIncludes` from two maps: its own
  // `CORE_TRACING_INCLUDES` and whatever the installed modules declare. It used
  // to do that with an object spread, which assigns per KEY — so a module
  // contributing `/api/chat` would have replaced the core's
  // `./content/knowledge/**/*` instead of adding to it, and the handbook would
  // be missing from a standalone image with no build error anywhere. Same shape
  // as the message spread in §3, one abstraction lower.
  //
  // 🚨 **The module half is no longer empty, and that is what this loop was
  // waiting for.** No shipped manifest declares `outputFileTracingIncludes`
  // itself — not `activity`, `api`, `community`, `companion` or `courses` — but
  // `courses` declares `appliers`, and Story 34.1 turned that field into a real
  // `/api/setup` glob on a key the CORE also traces. So the collision this loop
  // guards is produced by the real tree in two of the six profiles, and the
  // probe below says which ones rather than trusting that it happens.
  const coreKeys = Object.keys(CORE_TRACING_INCLUDES);

  it("has a core map with several keys to lose", () => {
    // The non-vacuity this file CAN honestly assert: the core really traces
    // more than one route, so the loop below compares something.
    expect(coreKeys.length).toBeGreaterThan(1);
    for (const key of coreKeys) {
      expect(CORE_TRACING_INCLUDES[key].length, key).toBeGreaterThan(0);
    }
  });

  for (const ids of PROFILES) {
    it(`${label(ids)} keeps every core route's globs`, () => {
      const composed = mergeTracingIncludes(
        CORE_TRACING_INCLUDES,
        moduleTracingIncludes(ROOT, ids),
      );
      for (const key of coreKeys) {
        for (const glob of CORE_TRACING_INCLUDES[key]) {
          expect(
            composed[key] ?? [],
            `${label(ids)}: "${key}" no longer traces "${glob}". Under ` +
              `output: "standalone" that file is simply absent from the image — no ` +
              `build error, no failing test, and the feature that reads it answers ` +
              `"not found" in production while working on the machine that built it.`,
          ).toContain(glob);
        }
      }
    });
  }

  it("the shipped profile is the core's map unchanged", () => {
    // The empty profile is what a customer gets, so its result must be the core
    // alone — key for key, value for value, in the same order.
    const composed = mergeTracingIncludes(CORE_TRACING_INCLUDES, moduleTracingIncludes(ROOT, []));
    expect(composed).toEqual(CORE_TRACING_INCLUDES);
    expect(Object.keys(composed)).toEqual(coreKeys);
  });

  it("🚨 at least one REAL profile really collides with a core key", () => {
    // The needle for the loop above, and the reason it is here rather than in a
    // fixture file: a loop that only ever composes the core with an empty map
    // proves that `{...core}` equals `core`. It has to be a profile of this
    // tree, so it stops holding the day `courses` loses its `appliers` field —
    // at which point the loop is measuring nothing again and should say so.
    const colliding = PROFILES.filter((ids) => {
      const fromModules = moduleTracingIncludes(ROOT, ids);
      return coreKeys.some((key) => (fromModules[key]?.length ?? 0) > 0);
    });
    expect(
      colliding.length,
      "no installed profile contributes a glob on a route the core already traces, so the " +
        "loop above composes the core with nothing and cannot fail. Find the module that " +
        "used to (courses, through its `appliers` field) and say what happened to it.",
    ).toBeGreaterThan(0);
  });
});
