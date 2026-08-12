// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The generated registries — how a module reaches the parts of the app that
// cannot read a folder.
//
// `scripts/modules/registry.mjs` reads the manifests off the disk, which is
// fine for a script and impossible for the app: a server component needs
// imports the bundler can SEE, and a path resolved at runtime breaks under
// `output: "standalone"`. So the module list is compiled into real files with
// real `import` statements, and those files are checked in.
//
// ── Why checked in rather than built ───────────────────────────────────────
// Because the customer's `npm run build` must not depend on a code generator
// having run. The deploy contract is `npm ci && npm run build`, on four hosts,
// and nothing in it regenerates anything. So the generated files are ordinary
// source files, and `scripts/modules/generated.test.ts` fails the build when
// they no longer match the manifests — the same shape `agents-md-check` and
// `knowledge-check` use in the factory.
//
// Regenerate with `node run.mjs module sync`.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadModules } from "./registry.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * A module-relative path as an import SPECIFIER — without its extension.
 *
 * TypeScript refuses `import … from "@/modules/x/schema.ts"` unless
 * `allowImportingTsExtensions` is on, and turning that on for one generated
 * line would change how every file in the app may be written. The manifest
 * names files (`schema.ts`), imports name modules (`schema`), and this is where
 * the two meet.
 */
const spec = (dir, file) => `@/${dir}/${file}`.replace(/\.(ts|tsx|mjs|js)$/, "");

/** The banner every generated file carries, so nobody edits one by hand. */
function banner(what) {
  return (
    `// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA\n` +
    `// SPDX-License-Identifier: MIT\n` +
    `\n` +
    `// GENERATED — do not edit. Run \`node run.mjs module sync\`.\n` +
    `//\n` +
    `// ${what}\n` +
    `// Its content is a function of config/modules.json and the manifests under\n` +
    `// modules/. \`scripts/modules/generated.test.ts\` fails the build when this\n` +
    `// file and those stop agreeing.\n`
  );
}

/**
 * The schema barrel's module half.
 *
 * `db/schema.ts` carries one permanent line — `export * from "./schema-modules"`
 * — and this is what that line reaches. With no module installed it exports
 * nothing, which is exactly what drizzle-kit saw before modules existed.
 *
 * @param {import("./registry.mjs").ModuleRecord[]} records
 */
function schemaModules(records) {
  const withTables = records.filter((r) => r.manifest.schema);
  const body = withTables.length
    ? withTables.map((r) => `export * from "${spec(r.dir, r.manifest.schema)}";`).join("\n") + "\n"
    : // `export {}` and not an empty file: without it TypeScript treats the file
      // as a script rather than a module, and `export *` from a script is an error.
      "export {};\n";

  return (
    banner("Every installed module's tables, re-exported into the app's one schema.") +
    "\n" +
    body
  );
}

/**
 * The server-side registry — what each installed module offers the app.
 *
 * Static imports, because this is the file a server component reaches: a path
 * resolved at runtime is exactly what breaks under `output: "standalone"`. The
 * shape each entry satisfies is `ModuleEntry` in `lib/modules/types.ts`, which
 * is hand-written — the generator produces the list, not the contract.
 *
 * @param {import("./registry.mjs").ModuleRecord[]} records
 */
function serverRegistry(records) {
  const withEntry = records.filter((r) => r.manifest.entry);
  const alias = (id) => `${id.replace(/-/g, "_")}_entry`;

  const imports = withEntry
    .map((r) => `import ${alias(r.id)} from "${spec(r.dir, r.manifest.entry)}";`)
    .join("\n");

  const list = withEntry.length
    ? "[\n" + withEntry.map((r) => `  ${alias(r.id)},`).join("\n") + "\n]"
    : "[]";

  return (
    banner("Every installed module's server entry, in the order they were installed.") +
    "\n" +
    'import type { ModuleEntry } from "./types";\n' +
    (imports ? imports + "\n" : "") +
    "\n" +
    `export const MODULES: readonly ModuleEntry[] = ${list};\n`
  );
}

/**
 * The client-safe navigation registry.
 *
 * Separate from the server registry above, and that separation is the point:
 * `components/app-shell.tsx` is a client component, so everything reachable
 * from here lands in the browser bundle. A module's `nav.ts` holds static data
 * and an icon; its `module.ts` holds the database work, and the two must never
 * meet in one import graph.
 *
 * @param {import("./registry.mjs").ModuleRecord[]} records
 */
function navRegistry(records) {
  const withNav = records.filter((r) => r.manifest.nav);
  const alias = (id) => `${id.replace(/-/g, "_")}_nav`;

  const imports = withNav
    .map((r) => `import ${alias(r.id)} from "${spec(r.dir, r.manifest.nav)}";`)
    .join("\n");

  const list = withNav.length
    ? "[\n" + withNav.map((r) => `  ${alias(r.id)},`).join("\n") + "\n]"
    : "[]";

  return (
    banner("Every installed module's navigation — CLIENT-SAFE, it reaches the browser.") +
    "\n" +
    'import type { ModuleNav } from "./nav";\n' +
    (imports ? imports + "\n" : "") +
    "\n" +
    `export const MODULE_NAV: readonly ModuleNav[] = ${list};\n`
  );
}

/**
 * The gate registry `proxy.ts` loops over.
 *
 * Its own file rather than a field on the server registry, and the separation
 * is the same one the nav registry needs for the client: everything reachable
 * from here runs in front of EVERY matched request, so a gate's import closure
 * must stay free of the database. `modules/boundary.test.ts` holds it there.
 *
 * @param {import("./registry.mjs").ModuleRecord[]} records
 */
function gateRegistry(records) {
  const withGate = records.filter((r) => r.manifest.gate);
  const alias = (id) => `${id.replace(/-/g, "_")}_gate`;

  const imports = withGate
    .map((r) => `import ${alias(r.id)} from "${spec(r.dir, r.manifest.gate)}";`)
    .join("\n");

  const list = withGate.length
    ? "[\n" + withGate.map((r) => `  ${alias(r.id)},`).join("\n") + "\n]"
    : "[]";

  return (
    banner("Every installed module's off-state gate — runs in front of every request.") +
    "\n" +
    'import type { ModuleGate } from "./gate";\n' +
    (imports ? imports + "\n" : "") +
    "\n" +
    `export const MODULE_GATES: readonly ModuleGate[] = ${list};\n`
  );
}

/**
 * What each module puts into the core's named slots.
 *
 * The one registry whose entries are COMPONENTS, and the one whose typo is
 * caught by the compiler rather than by this generator: the emitted `slot:`
 * literal is checked against `SlotName` in `lib/modules/slots.ts`, so a
 * manifest naming a place that does not exist fails `npm run typecheck` by
 * name. That is deliberate — the alternative is a card that renders nowhere,
 * which nothing can detect and a customer eventually reports.
 *
 * @param {import("./registry.mjs").ModuleRecord[]} records
 */
function slotRegistry(records) {
  const imports = [];
  const entries = [];

  for (const record of records) {
    const slots = record.manifest.slots;
    if (!slots || typeof slots !== "object") continue;
    // One module's OWN slots are sorted, so the emitted file does not depend on
    // the key order somebody happened to type into their manifest. Across
    // modules the order stays install order — the same as `MODULES` and
    // `MODULE_NAV`, and deterministic for a different reason: `config/modules
    // .json` is checked in, so every copy of the app has the same list.
    for (const slot of Object.keys(slots).sort()) {
      const alias = `${record.id.replace(/-/g, "_")}_${slot.replace(/-/g, "_")}_slot`;
      imports.push(`import ${alias} from "${spec(record.dir, slots[slot])}";`);
      entries.push(`  { module: "${record.id}", slot: "${slot}", Component: ${alias} },`);
    }
  }

  const list = entries.length ? "[\n" + entries.join("\n") + "\n]" : "[]";

  return (
    banner("What each installed module puts into the core's named page slots.") +
    "\n" +
    'import type { ModuleSlotEntry } from "./slots";\n' +
    (imports.length ? imports.join("\n") + "\n" : "") +
    "\n" +
    `export const MODULE_SLOTS: readonly ModuleSlotEntry[] = ${list};\n`
  );
}

/**
 * What the app's OWN pages may import from the installed modules.
 *
 * 🚨 **The one registry an app writes against by hand**, and the reason it
 * exists: `modules/boundary.test.ts` §1 scans `app/` and fails any file naming
 * `@/modules/<installed id>`. A customer's unit page rendering `<ActivityPanel>`
 * is such a file — so the instruction in `docs/learning.md` was one no app
 * could follow without turning its own suite red. §1's message names the way
 * out ("everything the core needs from a module comes through a generated
 * registry"), and this is it.
 *
 * A re-export, not a wrapper. `"use client"` lives in the module's own file and
 * survives the hop; a wrapper here would have to choose a boundary on the
 * module's behalf and would show up in every stack trace between the page and
 * the component.
 *
 * One `export` per NAME rather than one per file, even when two names come from
 * one file: it keeps the emitted order a function of the sorted names alone, so
 * the file cannot change because somebody regrouped a manifest.
 *
 * @param {import("./registry.mjs").ModuleRecord[]} records
 */
function componentRegistry(records) {
  const lines = [];

  for (const record of records) {
    const components = record.manifest.components;
    if (!components || typeof components !== "object") continue;
    // Sorted within a module for the same reason the slots are: the emitted
    // file must not depend on the key order somebody typed. Across modules the
    // order stays install order, and `config/modules.json` is checked in.
    for (const name of Object.keys(components).sort()) {
      lines.push(`export { ${name} } from "${spec(record.dir, components[name])}";`);
    }
  }

  return (
    banner("What the app's own pages may import from the installed modules.") +
    "//\n" +
    "// A page writes:\n" +
    "//   import { ActivityPanel } from \"@/lib/modules/component-registry\";\n" +
    "// never:\n" +
    "//   import { ActivityPanel } from \"@/modules/activity/components/activity-panel\";\n" +
    "//\n" +
    "// The second is a core file naming a module, which `modules/boundary.test.ts`\n" +
    "// §1 refuses — in the CUSTOMER's app, about their own page. That refusal is\n" +
    "// why this file exists: without it the instruction in `docs/learning.md` was\n" +
    "// one no app could follow.\n" +
    "\n" +
    (lines.length ? lines.join("\n") + "\n" : "export {};\n")
  );
}

/**
 * What the app's own SERVER code may import from the installed modules.
 *
 * 🚨 **The server-side twin of `componentRegistry`, and the split is the whole
 * point.** Both exist because `modules/boundary.test.ts` §1 refuses a core file
 * naming a module, and an app's own page or server action is a core file. What
 * they must not be is ONE barrel: importing any name from a barrel pulls its
 * whole graph, so a client component reaching for `useActivity` would drag
 * `askCompanion()` — and with it the AI layer and its keys — into the browser.
 *
 * So: `components` is client-safe and every file in it opens with
 * `"use client"`; this one is server-side and none of them may.
 * `scripts/modules/components.test.ts` holds both halves.
 *
 * @param {import("./registry.mjs").ModuleRecord[]} records
 */
function serverRegistryExports(records) {
  const lines = [];

  for (const record of records) {
    const exported = record.manifest.serverExports;
    if (!exported || typeof exported !== "object") continue;
    for (const name of Object.keys(exported).sort()) {
      lines.push(`export { ${name} } from "${spec(record.dir, exported[name])}";`);
    }
  }

  return (
    banner("What the app's own SERVER code may import from the installed modules.") +
    "//\n" +
    "// A server action writes:\n" +
    '//   import { askCompanion } from "@/lib/modules/server-exports";\n' +
    "// never:\n" +
    '//   import { askCompanion } from "@/modules/companion/companion";\n' +
    "//\n" +
    "// The second is a core file naming a module, which `modules/boundary.test.ts`\n" +
    "// §1 refuses — in the CUSTOMER's app, about their own action.\n" +
    "//\n" +
    "// 🚨 SERVER ONLY. Nothing here may be a client component, and nothing that\n" +
    "// imports from here may be one: this graph reaches the AI layer, the database\n" +
    "// and the keys. The client-safe half is `component-registry.ts`.\n" +
    "\n" +
    (lines.length ? lines.join("\n") + "\n" : "export {};\n")
  );
}

/**
 * What each installed module says about itself on `/dashboard/account`.
 *
 * Two message keys per module — the download's hint and the deletion dialog's
 * "what goes" list. CLIENT-SAFE, like the nav registry and for the same reason:
 * `app/dashboard/account/privacy-ui.tsx` is a client component, so everything
 * here lands in the browser. Strings only; nothing is imported.
 *
 * ⚠️ **Only modules with `tables`** — the manifest requires the declaration
 * exactly there, because a module that stores nothing about a person has
 * nothing to say in either sentence, and an empty paragraph on that page is
 * worse than none. So this registry filters on the declaration rather than on
 * `tables` itself: one place decides, and it is the validator.
 *
 * @param {import("./registry.mjs").ModuleRecord[]} records
 */
function accountNotesRegistry(records) {
  const entries = [];
  for (const record of records) {
    const notes = record.manifest.privacy?.accountNotes;
    if (!notes) continue;
    entries.push(
      `  { module: ${JSON.stringify(record.id)}, export: ${JSON.stringify(notes.export)}, ` +
        `deletion: ${JSON.stringify(notes.deletion)} },`,
    );
  }

  const list = entries.length ? "[\n" + entries.join("\n") + "\n]" : "[]";

  return (
    banner("What each installed module says about itself on /dashboard/account.") +
    "\n" +
    'import type { ModuleAccountNote } from "./account-notes";\n' +
    "\n" +
    `export const MODULE_ACCOUNT_NOTES: readonly ModuleAccountNote[] = ${list};\n`
  );
}

/**
 * Every installed module's scheduled jobs — the BODIES.
 *
 * The server half, like `serverRegistry()`: real imports the bundler can see,
 * reaching a module's `cron.ts`, which reaches its database work. Folded into
 * `CRON_JOBS` by `lib/cron/jobs.ts`.
 *
 * ⚠️ Its twin `cronIds()` below is the NAMES, and the split is not tidiness — it
 * is the same one `lib/cron/ids.mjs` already makes against `lib/cron/jobs.ts`.
 * `lib/cron/config.ts` needs to know which configured job does not exist, and it
 * is read by `instrumentation.ts`, which is built for the edge runtime; importing
 * the bodies there would drag the whole database layer into a hook that only
 * wanted to decide whether to start a timer.
 *
 * @param {import("./registry.mjs").ModuleRecord[]} records
 */
/**
 * Every installed module's setup tools — what a developer's coding agent may
 * ask this environment to do on that module's behalf (docs/setup-mcp.md).
 *
 * Ordered by installation, like the cron registry, so `tools/list` is
 * deterministic — MCP asks for that, because a client caches the list.
 */
function setupRegistry(records) {
  const withSetup = records.filter((r) => r.manifest.setup);
  const alias = (id) => `${id.replace(/-/g, "_")}_setup`;

  const imports = withSetup
    .map((r) => `import ${alias(r.id)} from "${spec(r.dir, r.manifest.setup)}";`)
    .join("\n");

  const list = withSetup.length
    ? "[\n" + withSetup.map((r) => `  ${alias(r.id)},`).join("\n") + "\n]"
    : "[]";

  return (
    banner("Every installed module's setup tools, in the order they were installed.") +
    "\n" +
    'import type { ModuleSetupTools } from "@/lib/setup/types";\n' +
    (imports ? imports + "\n" : "") +
    "\n" +
    `export const MODULE_SETUP_TOOLS: readonly ModuleSetupTools[] = ${list};\n`
  );
}

/**
 * Every installed module's answer to "does this environment hold what it
 * should" (docs/content.md). The core aggregates these and never inspects.
 */
function presenceRegistry(records) {
  const withPresence = records.filter((r) => r.manifest.presence);
  const alias = (id) => `${id.replace(/-/g, "_")}_presence`;

  const imports = withPresence
    .map((r) => `import ${alias(r.id)} from "${spec(r.dir, r.manifest.presence)}";`)
    .join("\n");

  const list = withPresence.length
    ? "[\n" + withPresence.map((r) => `  ${alias(r.id)},`).join("\n") + "\n]"
    : "[]";

  return (
    banner("Every installed module's presence check, in the order they were installed.") +
    "\n" +
    'import type { PresenceContributor } from "@/lib/content/presence";\n' +
    (imports ? imports + "\n" : "") +
    "\n" +
    `export const MODULE_PRESENCE: readonly PresenceContributor[] = ${list};\n`
  );
}

/**
 * Every installed module's content source — what the in-app assistant may
 * search inside it (docs/content-source.md).
 *
 * Typed against the CORE's `ContentSource`, and that is the load-bearing half:
 * a module whose default export does not keep the contract fails
 * `npm run typecheck` by name, rather than at a customer's first question. The
 * same argument `SlotName` makes about a slot nobody offers.
 *
 * Ordered by installation, like the registries above, so `content_list` reads
 * the same way twice — the handbook first (the core prepends it), then the
 * modules in the order this app was assembled.
 */
function contentSourceRegistry(records) {
  const withSource = records.filter((r) => r.manifest.contentSource);
  const alias = (id) => `${id.replace(/-/g, "_")}_content_source`;

  const imports = withSource
    .map((r) => `import ${alias(r.id)} from "${spec(r.dir, r.manifest.contentSource)}";`)
    .join("\n");

  const list = withSource.length
    ? "[\n" + withSource.map((r) => `  ${alias(r.id)},`).join("\n") + "\n]"
    : "[]";

  return (
    banner("Every installed module's content source, in the order they were installed.") +
    "\n" +
    'import type { ContentSource } from "@/lib/content-source/types";\n' +
    (imports ? imports + "\n" : "") +
    "\n" +
    `export const MODULE_CONTENT_SOURCES: readonly ContentSource[] = ${list};\n`
  );
}

function cronRegistry(records) {
  const withCron = records.filter((r) => r.manifest.cron);
  const alias = (id) => `${id.replace(/-/g, "_")}_cron`;

  const imports = withCron
    .map((r) => `import ${alias(r.id)} from "${spec(r.dir, r.manifest.cron)}";`)
    .join("\n");

  const list = withCron.length
    ? "[\n" + withCron.map((r) => `  ...${alias(r.id)},`).join("\n") + "\n]"
    : "[]";

  return (
    banner("Every installed module's scheduled jobs, in the order they were installed.") +
    "\n" +
    'import type { CronJob } from "@/lib/cron/types";\n' +
    (imports ? imports + "\n" : "") +
    "\n" +
    `export const MODULE_CRON_JOBS: readonly CronJob[] = ${list};\n`
  );
}

/**
 * Every installed module's job IDS — the bare-Node half.
 *
 * `.mjs` and a literal array, for the readers that run before a bundler exists
 * (`scripts/cron/run.mjs`, `scripts/dev/session-start.mjs`) and for
 * `lib/cron/config.ts`, which must stay free of the database. It says the names a
 * manifest DECLARED; `lib/cron/rules.test.ts` is what holds them to the bodies.
 *
 * @param {import("./registry.mjs").ModuleRecord[]} records
 */
function cronIds(records) {
  const ids = records.flatMap((r) => (Array.isArray(r.manifest.cronJobs) ? r.manifest.cronJobs : []));
  const list = ids.length ? "[\n" + ids.map((id) => `  ${JSON.stringify(id)},`).join("\n") + "\n]" : "[]";

  return (
    banner("Every installed module's scheduled job ids, in the order they were installed.") +
    "\n" +
    `export const MODULE_JOB_IDS = ${list};\n`
  );
}

/**
 * The texts every installed module brings, per locale.
 *
 * Merged into the core catalogue by `i18n/request.ts`.
 *
 * 🚨 This used to emit `{ ...activity_de, ...companion_de }`, with the reasoning
 * that a module owns whole top-level namespaces and `loadModules()` refuses two
 * modules claiming one — so a spread was said to be enough. **It is not, and
 * the collision check cannot see why.** A module declares the namespaces it
 * OWNS (`"messages": { "namespaces": ["activity"] }`), but it also contributes
 * to the two the CORE owns and everybody shares: `errors` and `nav`. Nobody
 * declares those, so nothing refused them — and the last spread won, silently
 * deleting every error text of every module before it. Measured with `activity`
 * and `companion` both installed: eight refusals rendering as raw keys.
 *
 * So the fold goes through `mergeModuleMessages`, the same function
 * `i18n/request.ts` uses for module-over-core — which means `SHARED_NAMESPACES`
 * is written down once and this file cannot disagree with it.
 *
 * @param {import("./registry.mjs").ModuleRecord[]} records
 * @param {(dir: string) => string[]} locales names the locale files a module ships
 */
function moduleMessages(records, locales) {
  const entries = [];
  const imports = [];

  for (const record of records) {
    const messages = record.manifest.messages;
    if (!messages || typeof messages !== "object") continue;
    for (const locale of locales(join(record.dir, messages.dir))) {
      const alias = `${record.id.replace(/-/g, "_")}_${locale}`;
      imports.push(`import ${alias} from "@/${record.dir}/${messages.dir}/${locale}.json";`);
      entries.push([locale, alias]);
    }
  }

  const byLocale = new Map();
  for (const [locale, alias] of entries) {
    if (!byLocale.has(locale)) byLocale.set(locale, []);
    byLocale.get(locale).push(alias);
  }

  const body = byLocale.size
    ? [...byLocale]
        .map(
          ([locale, aliases]) =>
            `  ${locale}: [${aliases.join(", ")}].reduce(mergeModuleMessages, {}),`,
        )
        .join("\n")
    : "";

  // Imported even for one module: with a single contributor the fold is a
  // no-op, and a shape that changes with the number of modules is one nobody
  // reads twice.
  const merge = imports.length
    ? 'import { mergeModuleMessages } from "./messages-merge";\n'
    : "";

  return (
    banner("Every installed module's texts, merged into the core catalogue per locale.") +
    "\n" +
    merge +
    (imports.length ? imports.join("\n") + "\n\n" : "") +
    "export const MODULE_MESSAGES: Record<string, Record<string, unknown>> = {" +
    (body ? `\n${body}\n` : "") +
    "};\n"
  );
}

/**
 * Every generated file, as a map of app-relative path to content. PURE — this
 * is the half the drift test re-runs in memory.
 *
 * @param {import("./registry.mjs").ModuleRecord[]} records
 * @param {(dir: string) => string[]} locales
 * @returns {Map<string, string>}
 */
export function generatedFiles(records, locales) {
  return new Map([
    ["db/schema-modules.ts", schemaModules(records)],
    ["lib/modules/messages.ts", moduleMessages(records, locales)],
    ["lib/modules/registry.ts", serverRegistry(records)],
    ["lib/modules/nav-registry.ts", navRegistry(records)],
    ["lib/modules/gate-registry.ts", gateRegistry(records)],
    ["lib/modules/slot-registry.ts", slotRegistry(records)],
    ["lib/modules/component-registry.ts", componentRegistry(records)],
    ["lib/modules/server-exports.ts", serverRegistryExports(records)],
    ["lib/modules/account-notes-registry.ts", accountNotesRegistry(records)],
    ["lib/modules/cron-registry.ts", cronRegistry(records)],
    ["lib/modules/setup-registry.ts", setupRegistry(records)],
    ["lib/modules/presence-registry.ts", presenceRegistry(records)],
    ["lib/modules/content-source-registry.ts", contentSourceRegistry(records)],
    ["lib/modules/cron-ids.mjs", cronIds(records)],
  ]);
}

/**
 * The locale files a module ships, e.g. `["de", "en"]`.
 *
 * Handed to `generatedFiles()` as a function rather than read inside it, so the
 * generating half stays pure and the drift test can feed it fixtures.
 */
function localesIn(root) {
  return (dir) => {
    try {
      return readdirSync(join(root, dir))
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""))
        .sort();
    } catch {
      // A module that ships no texts is normal, not an error.
      return [];
    }
  };
}

/**
 * What the generated files SHOULD contain for this app right now.
 *
 * `ids` is passed straight to `loadModules()` and exists for the one caller
 * described there — `scripts/modules/profiles.test.ts`, which asks what these
 * files would contain for a combination of the real modules without installing
 * one. Left undefined it is the app's own list, which is what every writer uses.
 *
 * @param {string} [root]
 * @param {string[]} [ids]
 * @returns {Map<string, string>}
 */
export function expectedGenerated(root = ROOT, ids) {
  return generatedFiles(loadModules(root, ids), localesIn(root));
}

/**
 * Write them. Returns the paths that actually changed, so `module sync` can say
 * "nothing to do" rather than claiming work it did not do.
 *
 * @param {string} [root]
 * @returns {string[]}
 */
export function writeGenerated(root = ROOT) {
  const changed = [];
  for (const [file, content] of expectedGenerated(root)) {
    const path = join(root, file);
    let current = null;
    try {
      current = readFileSync(path, "utf8");
    } catch {
      /* not there yet */
    }
    if (current !== content) {
      writeFileSync(path, content);
      changed.push(file);
    }
  }
  return changed;
}
