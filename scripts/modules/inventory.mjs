// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What the installed modules add to the app's own inventory of "things that
// shipped" — the lists `scripts/dev/session-start.mjs` subtracts from what it
// finds on disk before reminding the user to write the rest into `docs/app.md`.
//
// The reason this exists as its own file: those lists are the ones that already
// went wrong once. The community shipped without joining two of them, so every
// app was told it had built eleven tables and a page itself — and, because the
// page count never reached zero, every FRESH app was greeted as a project
// already under way instead of with the "Build my app" line the README points
// at. A module joining the inventory by declaring itself, rather than by
// somebody editing a Set, is the fix for the class rather than the instance.
//
// 🚨 Nothing here throws. The greeting runs before anything else in a session,
// and a broken manifest must not be the reason a user sees no greeting at all —
// absence of a greeting is the one signal `CLAUDE.md` says never to read as
// "fine". `node run.mjs module check` is where a broken arrangement is
// diagnosed.
import { loadModules } from "./registry.mjs";

/**
 * The installed modules, or none at all if the arrangement cannot be read.
 *
 * `ids` is passed straight through to `loadModules()` — see the long note at
 * `registry.mjs:112` for why that parameter exists at all. It changes nothing
 * about the swallowing: a broken manifest still answers "none", here as there.
 *
 * @param {string} [root]
 * @param {string[]} [ids]
 */
function safeModules(root, ids) {
  try {
    return loadModules(root, ids);
  } catch {
    return [];
  }
}

/**
 * Page areas under `app/dashboard/` that came with an installed module.
 *
 * @param {string} [root]
 * @returns {string[]}
 */
export function moduleNavAreas(root) {
  return safeModules(root).flatMap((r) =>
    Array.isArray(r.manifest.navAreas) ? r.manifest.navAreas : [],
  );
}

/**
 * The nav files installed modules ship, as paths relative to the app root.
 *
 * 🚨 **Paths rather than parsed hrefs, and read as TEXT by whoever asks.** A
 * module's `nav.ts` is TypeScript, and the tool that needs this — `node run.mjs
 * ux-check` — is bare Node with no bundler, so it cannot import one. That is
 * exactly why `lib/modules/nav.ts` insists the export be named `NAVIGATION`:
 * `navHrefs()` in `scripts/ux/rules.mjs` finds a menu by that name in a source
 * file, core or module alike.
 *
 * ⚠️ That claim was written before anything kept it. `ux-check` read
 * `components/app-shell.tsx` and nothing else, so a module's entries were
 * invisible to it — and its page walk missed the module's pages in the same
 * breath, which is the only reason nothing went red: two errors cancelling into
 * a green result. Fixing either one alone reports every module page as
 * unreachable, or every module entry as pointing nowhere.
 *
 * @param {string} [root]
 * @returns {string[]}
 */
export function moduleNavFiles(root) {
  return safeModules(root)
    .filter((r) => typeof r.manifest.nav === "string")
    .map((r) => `${r.dir}/${r.manifest.nav}`);
}

/**
 * Files installed modules contribute to the shared core, app-root-relative.
 *
 * 🚨 Sorted, because `config/core-export.json` is sorted and the merged list is
 * what a companion repo's `.core-version` records — an order that depended on
 * install order would rewrite that stamp for no reason.
 *
 * @param {string} [root]
 * @returns {string[]}
 */
export function moduleCoreExports(root) {
  return safeModules(root)
    .flatMap((r) =>
      Array.isArray(r.manifest.coreExport)
        ? r.manifest.coreExport.map((file) => `${r.dir}/${file}`)
        : [],
    )
    .sort();
}

/**
 * Table prefixes that belong to installed modules.
 *
 * A prefix rather than the table names themselves, for the reason the community
 * taught: a file that LISTS `community_messages` is a file that names a
 * direct-message table, and `dm-guard.test.ts` refuses those outside a short
 * allowlist. A greeting script has no business on that list.
 *
 * @param {string} [root]
 * @returns {string[]}
 */
export function moduleTablePrefixes(root) {
  return safeModules(root)
    .map((r) => r.manifest.tablePrefix)
    .filter((p) => typeof p === "string" && p.length > 0);
}

/**
 * Cron job ids an installed module registers.
 *
 * @param {string} [root]
 * @returns {string[]}
 */
export function moduleCronJobs(root) {
  return safeModules(root).flatMap((r) =>
    Array.isArray(r.manifest.cronJobs) ? r.manifest.cronJobs : [],
  );
}

/**
 * The routes an installed module leaves public, each with the sentence naming
 * what guards it instead.
 *
 * The same thing `PUBLIC` in `app/route-protection.test.ts` holds, and held to
 * the same bar by `manifestProblems()` — a real sentence, no placeholder.
 *
 * @param {string} [root]
 * @returns {{ url: string, reason: string, module: string }[]}
 */
export function modulePublicRoutes(root) {
  const routes = [];
  for (const { id, manifest } of safeModules(root)) {
    const declared = manifest.publicRoutes;
    if (!declared || typeof declared !== "object") continue;
    for (const [url, reason] of Object.entries(declared)) {
      routes.push({ url, reason, module: id });
    }
  }
  return routes.sort((a, b) => a.url.localeCompare(b.url));
}

/**
 * Fold several `outputFileTracingIncludes` maps into one, ADDING per route key
 * rather than replacing.
 *
 * What it is FOR: a module that wants files traced for a route the CORE
 * already traces — `/api/chat` reads the handbook, and a module may want its
 * own content beside it. What it prevents: an object spread assigns per key, so
 * the later map's array REPLACES the earlier one's, and the core's globs are
 * silently dropped from a standalone image. There is no build error for that —
 * the symptom is a file that is simply absent in production while everything
 * worked on the machine that built it.
 *
 * Pure: maps in, map out. No `fs`, no `process`. Nothing is sorted and nothing
 * is deduplicated — Next takes the list as given, the first map's entries go
 * first because they are the app's own, and install order decides the rest.
 * Key order is first-seen.
 *
 * @param {...Record<string, string[]>} maps
 * @returns {Record<string, string[]>}
 */
export function mergeTracingIncludes(...maps) {
  /** @type {Record<string, string[]>} */
  const merged = {};
  for (const map of maps) {
    if (!map || typeof map !== "object") continue;
    for (const [route, files] of Object.entries(map)) {
      merged[route] = [...(merged[route] ?? []), ...files];
    }
  }
  return merged;
}

/**
 * The route the setup surface serves, and therefore the tracing key the content
 * machinery hangs off.
 *
 * Exported so `next.config.ts` and the derivation below spell it once. The two
 * halves of one entry typed twice is the shape where a rename silently splits a
 * merged array into two keys, neither of which is the route Next asks about.
 */
export const SETUP_TRACING_ROUTE = "/api/setup";

/**
 * The tracing entry a module's `appliers` field IMPLIES, or `null`.
 *
 * 🚨 **Derived from the manifest, never from a list in a core file.** A module
 * that brings tables must be able to fill them (`docs/content.md` → *A MODULE
 * can bring one*), and the appliers are `.mjs` files loaded by path at
 * runtime — invisible to the bundler by construction, because
 * `lib/content/applier-presence.ts` tells it so in as many words. Under
 * `output: "standalone"` that makes them a tracing question, and it is one the
 * core cannot answer for a module: a core file naming `courses` is what
 * `modules/boundary.test.ts` refuses, and a hand-kept list is a list that is
 * wrong the day a fifth module lands. The manifest already knows the path.
 *
 * ⚠️ It is a DECLARATION rather than a repair, and `next.config.ts` carries the
 * measurement that says so: on next 16.2.11 `@vercel/nft` infers these files
 * from our path arithmetic and copies them anyway. An inference about today's
 * code shape is not the same as a stated requirement — the day the shape moves,
 * this is what still holds.
 *
 * The glob stays inside `modules/<id>/`, which is the same bar
 * `manifestProblems()` holds an EXPLICIT `outputFileTracingIncludes` to
 * (`scripts/modules/manifest.mjs`): the globs resolve from the app root, so a
 * module traces its own files and nowhere else. A module's applier DATA is a
 * different question and deliberately not this one — `modules/courses`'s reads
 * `content/course/*.json` from the app root, which is the operator's tree and
 * is traced by the core.
 *
 * @param {import("./registry.mjs").ModuleRecord} record
 * @returns {Record<string, string[]> | null}
 */
function applierTracing(record) {
  const declared = record.manifest.appliers;
  if (typeof declared !== "string" || declared.length === 0) return null;
  return { [SETUP_TRACING_ROUTE]: [`./${record.dir}/${declared}/**/*`] };
}

/**
 * The `outputFileTracingIncludes` entries installed modules bring.
 *
 * Next only copies what it can SEE being imported, so a module that reads a
 * file at runtime — a handbook, a template, a fixture — has to say so or find
 * it absent under `output: "standalone"`. The symptom is never a build error:
 * it is a feature that works on the machine that built it and answers "not
 * found" in production.
 *
 * Two sources per module, and the derived one goes first: what its `appliers`
 * field implies, then whatever it declares explicitly. A module declaring
 * `/api/setup` itself therefore ADDS to its own applier glob rather than
 * replacing it — same fold, one layer down.
 *
 * The per-key fold is `mergeTracingIncludes()` above — one implementation, used
 * both module-against-module here and core-against-modules in `next.config.ts`.
 *
 * @param {string} [root]
 * @param {string[]} [ids] which modules to read; defaults to the installed list
 * @returns {Record<string, string[]>}
 */
export function moduleTracingIncludes(root, ids) {
  return mergeTracingIncludes(
    ...safeModules(root, ids).flatMap((record) => [
      applierTracing(record),
      record.manifest.outputFileTracingIncludes,
    ]),
  );
}

/**
 * The AI-disclosure surfaces the installed modules bring.
 *
 * 🚨 Art. 50(1) EU AI Act, applicable since 2 August 2026: a system that talks
 * to people says it is a machine. `CLAUDE.md` states it as a rule about a LIST
 * of surfaces rather than about the chat — "whatever AI feature you add next
 * inherits it" — and a module is exactly such a next feature.
 *
 * A module that adds a surface and does NOT join this list ships a page that
 * talks to a person as a machine without saying so. Nothing else in the app
 * would notice: the page renders, the tests pass, and the obligation is missed.
 *
 * `.mjs` on the module's side for the same reason the core's registry is:
 * `node run.mjs legal-check` is given no `needs`, so it runs with no bundler
 * and cannot import TypeScript.
 *
 * @typedef {object} DisclosureSurface
 * @property {string} id           the message namespace — the key is `<id>.disclaimer`
 * @property {string} label        what it is, for a report a person reads
 * @property {string} rendersIn    the file that must mount the notice
 * @property {string} configFile   which config decides whether it is live
 * @property {(config: unknown) => boolean} isOn
 * @property {string | null} insideBlock
 *
 * @param {string} [root]
 * @returns {Promise<DisclosureSurface[]>}
 */
export async function moduleDisclosureSurfaces(root) {
  const surfaces = [];
  for (const { id, dir, manifest } of safeModules(root)) {
    if (typeof manifest.disclosure !== "string") continue;
    const file = `${dir}/${manifest.disclosure}`;
    const loaded = await import(/* @vite-ignore */ `../../${file}`);
    if (!Array.isArray(loaded.surfaces)) {
      throw new Error(
        `${file} exports no \`surfaces\` array, which its manifest declares. A surface that ` +
          `is not in the list is an Art. 50 notice nobody checks.`,
      );
    }
    for (const surface of loaded.surfaces) {
      // `rendersIn` is read as a PATH by the checker, so it has to point at
      // something that exists — and inside the module, not at a core file.
      if (typeof surface.rendersIn === "string" && !surface.rendersIn.startsWith(`${dir}/`)) {
        throw new Error(
          `${file}: surface "${surface.id}" says it renders in "${surface.rendersIn}", which is ` +
            `outside modules/${id}/. A module discloses its own surfaces.`,
        );
      }
      surfaces.push(surface);
    }
  }
  return surfaces;
}

/**
 * The Art. 15 section names the installed modules declare, from their
 * MANIFESTS.
 *
 * The one source both exports and the drift test read, so a module cannot be in
 * one of the two and missing from the other: they do not each keep a list.
 *
 * @param {string} [root]
 * @returns {string[]}
 */
export function moduleDeclaredSections(root) {
  return safeModules(root).flatMap((r) =>
    r.manifest.privacy && Array.isArray(r.manifest.privacy.sections)
      ? r.manifest.privacy.sections
      : [],
  );
}

/**
 * What every installed module holds about one person, for the OPERATOR's
 * command — the bare-Node half of the Art. 15 answer.
 *
 * The app's half is `ModuleEntry.privacy` (`lib/privacy/export.ts`); this one
 * exists because the command runs with no bundler, no `@/` alias and no
 * TypeScript, against a raw `DATABASE_URL`. Both declare the same `sections`,
 * and `scripts/modules/privacy.test.ts` compares them with the manifest.
 *
 * 🚨 Throws rather than skipping a module whose contributor is broken. A
 * subject access request answered with a section missing is worse than one that
 * failed loudly: the first looks complete.
 *
 * @param {import("postgres").Sql} sql
 * @param {string} memberId
 * @param {string} [root]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function moduleExportSections(sql, memberId, root) {
  const sections = {};
  for (const { id, dir, manifest } of safeModules(root)) {
    const privacy = manifest.privacy;
    if (!privacy || typeof privacy.mjs !== "string") continue;
    const file = `${dir}/${privacy.mjs}`;
    const loaded = await import(/* @vite-ignore */ `../../${file}`);
    if (typeof loaded.build !== "function") {
      throw new Error(
        `${file} exports no build(), which its manifest declares. A subject access request ` +
          `with a section missing looks complete and is not.`,
      );
    }
    Object.assign(sections, await loaded.build(sql, memberId));
  }
  return sections;
}

/**
 * Run every installed module's own smoke assertion.
 *
 * A module that makes a claim about the running app — "switched off, my pages
 * are indistinguishable from routes that never existed" — declares a `smoke`
 * entry, and that file exports `assert(context)` returning how many FAILURES it
 * found. The same contract `scripts/dev/smoke-community.mjs` already follows.
 *
 * 🚨 A module whose assertion could not run SAYS SO and counts as a failure.
 * Green-by-skip wearing the colour of green-by-check is the confusion the whole
 * smoke script is built against, and a module arriving with a broken assertion
 * must not be the quietest way to reach it.
 *
 * @param {{ baseUrl: string, cookie: string, isLocal: boolean }} context
 * @param {string} [root]
 * @returns {Promise<number>} failures to add
 */
export async function runModuleSmoke(context, root) {
  let failures = 0;
  for (const { id, dir, manifest } of safeModules(root)) {
    if (typeof manifest.smoke !== "string") continue;
    const file = `${dir}/${manifest.smoke}`;
    try {
      const loaded = await import(/* @vite-ignore */ `../../${file}`);
      if (typeof loaded.assert !== "function") {
        failures++;
        console.log(`\n  ✗ ${file} exports no assert() — the module's smoke claim did not run`);
        continue;
      }
      failures += (await loaded.assert(context)) ?? 0;
    } catch (error) {
      failures++;
      console.log(`\n  ✗ module "${id}" smoke check errored: ${error.message}`);
    }
  }
  return failures;
}

/**
 * Error-code unions an installed module contributes, as
 * `{ source, codes }` — the shape `i18n/messages.test.ts` keeps for the core.
 *
 * Read with a dynamic import, which is fine HERE and would not be in the app:
 * this is only ever called from a test, where there is no bundler to satisfy.
 *
 * @param {string} [root]
 * @returns {Promise<{ source: string, codes: readonly string[] }[]>}
 */
export async function moduleErrorCodes(root) {
  const unions = [];
  for (const { dir, manifest } of safeModules(root)) {
    const declared = manifest.errorCodes;
    if (!declared || typeof declared !== "object") continue;
    const source = `${dir}/${declared.source}`;
    const loaded = await import(/* @vite-ignore */ `@/${source}`);
    const codes = loaded[declared.export];
    if (!Array.isArray(codes)) {
      throw new Error(
        `${source} does not export an array called "${declared.export}", which its manifest ` +
          `declares. Every code in it needs an errors.<code> in every locale, and a union ` +
          `nobody can read is a set of codes nobody checks.`,
      );
    }
    unions.push({ source, codes });
  }
  return unions;
}
