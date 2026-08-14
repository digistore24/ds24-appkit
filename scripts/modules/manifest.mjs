// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What a module declares about itself — `modules/<id>/module.json`.
//
// One file, read by four kinds of consumer, which is why it is JSON and not
// TypeScript: the app (through a generated registry), `next.config.ts` (for
// `pageExtensions`), `run.mjs` and the bare-Node scripts under `scripts/`.
// Anything that needs a bundler to be read cannot be a manifest.
//
// ── Why a validator and not just a type ────────────────────────────────────
// A manifest is hand-written, and every field of it is a promise the generators
// keep on the module's behalf: which tables it owns, which sections its export
// contributes, which routes exist. A field that is quietly missing does not
// crash — it produces a registry that is silently smaller, which is the failure
// mode this whole system has to avoid. So the shape is checked, at build time,
// with the reason in the message.
//
// ── The two rules that are load-bearing ────────────────────────────────────
//  1. **Every `app` subtree starts with `dashboard/` or `api/`.** Next reads
//     `proxy.ts`'s `config.matcher` out of the AST at build time, so it cannot
//     be computed from this file. `dashboard/*` is already protected there and
//     `api/*` is already public-and-self-guarding; a module that wants a new
//     public top-level route is a deliberate core edit, not a manifest entry.
//  2. **A module with tables declares its whole GDPR wiring.** Tables and no
//     `privacy` is an app that stores personal data and cannot answer for it.
//     This is the structural replacement for remembering.

/** A module id, and the folder name under `modules/`. */
const ID = /^[a-z][a-z0-9-]*$/;

/**
 * Ids a module may not take, because the file name they produce already means
 * something else.
 *
 * A module's routes are named `page.<id>.tsx` / `route.<id>.ts`
 * (`scripts/modules/page-extensions.mjs`). `test` is therefore fatal: every
 * colocated `route.test.ts` in this app would look like a route of a module
 * called "test", and every one of that module's routes would look like a test.
 * Found by `page-extensions.test.ts` walking `app/` — a real collision, not a
 * hypothetical one.
 */
export const RESERVED_IDS = new Set([
  "test", "spec", "d", "module", "modules", "core",
  // 🚨 The second group, and a different failure. `docs/modules.md` names it and
  // nothing prevented it: a module called `ai`, `chat` or `token` takes `ai_`,
  // `chat_` or `token_` as its prefix and thereby CLAIMS the core's own tables —
  // `ai_usage`, `chat_messages`, `token_ledger`. After which `module check`
  // reports a core table as that module's orphan and `remove --drop-data`
  // offers to drop it. Reserved rather than detected, because the detection
  // needs a database and this needs none.
  "ai", "chat", "token", "user", "users", "media", "grants", "setup", "cron",
]);

/**
 * The id as it appears inside a SQL identifier.
 *
 * 🚨 **A dash is legal in an id and illegal in an unquoted SQL name.** `ID`
 * allows one, and no module of ours has ever used one — so the table prefix and
 * the journal name were compared against the id verbatim, and the first module
 * called `acme-crm` would have been told to name its journal
 * `__drizzle_migrations_acme-crm`. Postgres would take it only in quotes, and
 * the module's own bare-Node privacy half writes raw SQL where nothing quotes
 * for it.
 *
 * Dashes become underscores, so `acme-crm` owns `acme_crm_` and
 * `__drizzle_migrations_acme_crm`. For every module in this tree today the
 * answer is the id unchanged — none of them has a dash — which is why this can
 * be tightened without moving a single existing manifest.
 *
 * @param {string} id
 * @returns {string}
 */
export const sqlName = (id) => id.replaceAll("-", "_");

/**
 * How long an id may be.
 *
 * Postgres truncates an identifier at 63 bytes, silently. `__drizzle_migrations_`
 * is 21 of them, so two long ids sharing their first 42 characters would share
 * ONE journal — and a shared journal means one module's migrations count as
 * already applied and its tables never appear, which is the exact silent
 * failure the per-module journal exists to prevent. 40 leaves the prefix room
 * to be read as well.
 */
const MAX_ID = 40;

/** Loose semver — enough to reject prose, not a package manager. */
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** A path inside the module, always relative and never climbing out. */
const REL = /^[a-z0-9][a-z0-9/_.-]*$/i;

/**
 * Whose the rows in a module's tables are — and therefore which of the two
 * content duties it owes.
 *
 * `docs/modules.md` states one of them as an obligation ("a module that brings
 * tables must be able to fill them"), and until this key existed nothing could
 * enforce it: making `appliers` unconditional on `tables` would refuse
 * `community`, `api` and `activity`, three correct shipped modules whose rows
 * are what MEMBERS wrote. An applier there would be a transport that upserts
 * over them on every run. So the missing declaration was never "where are your
 * appliers" — it is which KIND of module this is, and that is one word.
 *
 * Two values rather than a boolean: `"content": false` would read as "this
 * module has no content", which is untrue of the community — it has a great
 * deal of it, it just does not come from us. And a boolean could not say the
 * second half, that a collected module may not declare a transport at all.
 */
const CONTENT_KINDS = ["authored", "collected"];

const KNOWN = new Set([
  "id", "version", "requiresTemplate", "requires", "title", "summary", "docs", "skill",
  "config", "configDefault",
  "app", "publicRoutes",
  "schema", "tables", "tablePrefix", "content", "migrations", "migrationsTable",
  "messages", "errorCodes",
  "nav", "features", "gate", "entry", "slots", "components", "serverExports",
  "privacy", "erase",
  "commands", "cron", "cronJobs", "smoke", "appliers", "setup", "presence", "contentSource",
  "navAreas", "outputFileTracingIncludes", "disclosure",
  "coreExport",
]);

// 🚨 **`guidance` was here, and it is gone on purpose (2026-08-08). A module does
// NOT ship its own CLAUDE.md fragment, docs page or skill.** It was validated
// here, declared by none of the four modules, read by no generator and
// documented nowhere — the same "a promise with no executor" shape `cronJobs`
// had before the cron seam, and the reason to remove it rather than build it is
// that the guidance genuinely belongs in the core tree:
//
//   - **An app has to be able to learn about a module it does NOT have.**
//     `docs/community.md` and `.claude/skills/community` are how an agent finds
//     out the community exists and is one command away. Guidance that arrived
//     with the module would only be readable once somebody already knew to
//     install it.
//   - **The update channel is addressed by PATH.** `node run.mjs update` and
//     `.template-version` cover `CLAUDE.md`, `docs/*.md` and
//     `.claude/skills/**` — text under `modules/` is not in that manifest, so a
//     module's own guidance would be the one guidance in the app that a released
//     app could never bring up to date.
//   - A skill that needs code the app does not have already has its answer, and
//     it is a version rather than a location: `requires:` in its frontmatter.
//
// So the seam that is missing here is missing because it should be. Whoever
// wants module-local guidance changes the update channel first, and that is a
// decision about how released apps get text — not a manifest field.
// `docs/modules.md` → *Where a module's guidance lives* carries this for the
// customer.
//
// ── What changed, and what did NOT ──────────────────────────────────────────
//
// 🚨 **The key stays gone.** What `docs` now also accepts is a path inside the
// module, and it is worth being exact about why that is not the same seam
// coming back through a side door — both bullets above were re-read against a
// module SOMEBODY ELSE wrote, and they answer differently:
//
//   - *"An app has to be able to learn about a module it does not have"* proves
//     the file must SHIP, not that it must sit in `docs/`. Every module folder
//     ships in every app — `config/modules.json` is empty in a fresh one and all
//     five folders are still there — so `modules/<id>/docs.md` is exactly as
//     readable as `docs/<id>.md` for a module nobody installed. And for a module
//     from outside there is no third option: we cannot ship a page about a
//     module we have never heard of.
//   - *"The update channel is addressed by PATH"* is TRUE and is the reason the
//     core form stays the default for our own five. It does not bind a foreign
//     module: `scripts/dev/update.mjs` plans over
//     `keys(remote.files) ∪ keys(stamp.files)`, and a vendor's page is in
//     neither, so the channel never touches it — no `withdrawn`, no overwrite.
//     Its guidance freezes with its code, which is what the rest of that module
//     does anyway.
//
// The skill is untouched by all of this and still points at `.claude/skills/`:
// that path is Claude Code's and OpenCode's, not ours. A module from outside
// simply declares no skill — the key is optional — and a third party who wants
// to publish one publishes it as a skill, which needs nothing from this file.

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Everything wrong with one manifest — empty when it is coherent.
 *
 * Collects rather than throwing on the first fault: whoever is writing a
 * manifest wants the whole list, not six runs.
 *
 * @param {unknown} raw the parsed `module.json`
 * @param {string} where for the messages, e.g. `modules/community/module.json`
 * @returns {string[]}
 */
export function manifestProblems(raw, where) {
  const p = [];
  const say = (m) => p.push(`${where}: ${m}`);

  if (!isObject(raw)) return [`${where}: must be a JSON object`];
  const m = /** @type {Record<string, unknown>} */ (raw);

  const unknown = Object.keys(m).filter((k) => !k.startsWith("_") && !KNOWN.has(k));
  if (unknown.length > 0) {
    say(`unknown key(s) ${unknown.map((k) => `"${k}"`).join(", ")} — a misspelt key is a ` +
      `promise nothing keeps, so it is refused rather than ignored`);
  }

  // ── identity ──────────────────────────────────────────────────────────────
  const id = m.id;
  if (typeof id !== "string" || !ID.test(id)) {
    say('"id" must be lower-case letters, digits and dashes');
  } else if (RESERVED_IDS.has(id)) {
    say(`"id": "${id}" is reserved — either a module's routes are named page.<id>.tsx and ` +
      `that name already means something else here (route.test.ts is the clearest case), ` +
      `or the table prefix it forces would claim tables the core owns`);
  } else if (id.length > MAX_ID) {
    say(`"id" is ${id.length} characters — at most ${MAX_ID}. Postgres truncates an ` +
      `identifier at 63 bytes silently, and "__drizzle_migrations_" already spends 21 of ` +
      `them: two long ids would share one journal, and a shared journal is a module whose ` +
      `migrations count as applied and whose tables never appear`);
  }
  if (typeof m.version !== "string" || !VERSION.test(m.version)) {
    say('"version" must look like 1.0.0');
  }
  if (m.requiresTemplate !== undefined &&
      (typeof m.requiresTemplate !== "string" || !VERSION.test(m.requiresTemplate))) {
    say('"requiresTemplate" must look like 0.19.0');
  }
  if (!isObject(m.title) || typeof m.title.de !== "string" || typeof m.title.en !== "string" ||
      !m.title.de.trim() || !m.title.en.trim()) {
    say('"title" needs a non-empty "de" and "en" — it is shown to the operator');
  }

  // 🚨 Required, and for the same reason `commands` requires a `help` line: a
  // name nobody can tell apart from its neighbours is a feature nobody installs.
  // `node run.mjs module list` is the ONE command that answers "what is this app
  // made of" (CLAUDE.md says so in four places), and it used to answer with four
  // bare ids — `activity`, `api`, `community`, `companion` — leaving the reader
  // to open four manifests, or a doc, to find out what any of them was.
  //
  // English, not `{ de, en }` like `title`. The terminal output of everything
  // under `scripts/` is English (CLAUDE.md → **Languages**), so a `de` half here
  // would be a translation nothing prints — the "promise with no executor" shape
  // that got `guidance` removed above. `title` stays the translatable display
  // name for a surface inside the app; this is the line the CLI prints.
  const summary = m.summary;
  if (typeof summary !== "string" || summary.trim().length < 20) {
    say('"summary" needs a sentence saying what this module IS, in English — it is what ' +
      "`node run.mjs module list` prints after the id, and it is the only place an app " +
      "learns what a module it does not have would give it");
  } else if (/\b(todo|tbd|later|fixme)\b/i.test(summary)) {
    say('"summary" has a placeholder rather than a sentence');
  } else if (summary.includes("\n")) {
    say('"summary" is more than one line — it prints beside the id in a terminal, so it is one ' +
      "sentence. The full story is the module's page in docs/");
  } else if (summary.trim().length > 110) {
    say(`"summary" is ${summary.trim().length} characters — it is ONE line beside the id in a ` +
      "terminal, so past about 110 it wraps into the next module's row. The full story is " +
      "the module's page in docs/");
  }

  // ── where the full story is ───────────────────────────────────────────────
  //
  // ⚠️ **This is not `guidance` coming back** (removed above, and it should stay
  // removed). A module does not SHIP guidance; these two fields POINT at the
  // core tree's, which is exactly what that note argues guidance is for:
  // `docs/*.md` and `.claude/skills/**` are addressed by path by
  // `node run.mjs update`, so a released app can bring them forward, and an app
  // can read about a module it does NOT have.
  //
  // What was missing was the pointer. Every one of the four modules has a page
  // and a skill; nothing named them, so `module list` could say what a module is
  // in one line and not where to read the other three thousand words. An agent
  // that has just been told `community` exists has to guess between
  // `docs/community.md`, `docs/modules.md` and four skills.
  //
  // A dangling pointer is worse than none, so `scripts/modules/manifest.test.ts`
  // opens both against the real tree.
  // Two legal forms, and the second one is for a module this template did not
  // write. See `moduleOwnedDocs` below for why that is not a hole in the rule
  // the note beside KNOWN states.
  const docs = m.docs;
  const inCore = typeof docs === "string" && /^docs\/[a-z0-9-]+\.md$/.test(docs);
  const inModule =
    typeof docs === "string" &&
    typeof id === "string" &&
    new RegExp(`^modules/${id}/[a-z0-9/-]+\\.md$`).test(docs) &&
    !docs.includes("..");
  if (!inCore && !inModule) {
    say('"docs" must name this module\'s page — either in the CORE tree, e.g. ' +
      `"docs/community.md", which is where a module of this template puts it and where ` +
      "`node run.mjs update` keeps it current; or inside the module itself, e.g. " +
      `"modules/${typeof id === "string" ? id : "<id>"}/docs.md", which is where a module ` +
      "from somewhere else puts it");
  }
  if (m.skill !== undefined && (typeof m.skill !== "string" || !ID.test(m.skill))) {
    say('"skill" must be the name of a skill in .claude/skills/, e.g. "community" — it is the ' +
      "playbook that installs this module and builds on it");
  }

  const requires = m.requires ?? [];
  if (!isStringArray(requires)) {
    say('"requires" must be an array of module ids');
  } else {
    if (typeof id === "string" && requires.includes(id)) say('"requires" lists the module itself');
    for (const dep of requires) {
      if (!ID.test(dep)) say(`"requires": "${dep}" is not a module id`);
    }
    // ⚠️ A non-empty `requires` is LEGAL and is deliberately not a problem here.
    // Module independence is what lets the factory test k+2 profiles instead of
    // 2^k, so a dependency costs something real — but refusing it outright
    // would make the field undeclarable, and an undeclared dependency is worse
    // than a declared one: it becomes a cross-module import nobody wrote down.
    // The cost is surfaced where it is paid — `node run.mjs module check` says
    // so, and the variant harness stops assuming independence.
  }

  // ── paths inside the module ───────────────────────────────────────────────
  // ⚠️ Every field naming a FILE or a DIRECTORY belongs in this list, `cron`
  // included — the extension check further down is about which runtime the
  // bodies need, not about where the file may sit. Without the entry here,
  // `"cron": "../../elsewhere.ts"` validates and `generate.mjs` writes it into
  // `lib/modules/cron-registry.ts` verbatim, as an import out of the module.
  //
  // `appliers` is a DIRECTORY, like `migrations`: a module may ship more than
  // one, and `scripts/content/_appliers.mjs` walks it. Content that reaches an
  // environment is the module's own claim — `docs/courses.md` calls the applier
  // absolute, because a course built as rows typed into a local database dies
  // with that database — and until this key existed both content runners were
  // hard-coded to the core's directory, so a module could make that claim and
  // have no way to keep it.
  for (const key of ["schema", "migrations", "nav", "gate", "entry", "smoke", "configDefault", "disclosure", "cron", "appliers", "setup", "presence", "contentSource"]) {
    const value = m[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !REL.test(value) || value.includes("..")) {
      say(`"${key}" must be a relative path inside the module`);
    }
  }
  if (m.config !== undefined &&
      (typeof m.config !== "string" || !m.config.startsWith("config/"))) {
    say('"config" is the operator\'s file and lives in config/ with every other setting');
  }

  // ── routes ────────────────────────────────────────────────────────────────
  const app = m.app ?? [];
  if (!isStringArray(app)) {
    say('"app" must be an array of route subtrees');
  } else {
    for (const sub of app) {
      if (!sub.startsWith("dashboard/") && !sub.startsWith("api/")) {
        say(`"app": "${sub}" must sit under dashboard/ or api/ — proxy.ts's matcher is read ` +
          `from the AST at build time and cannot be computed from this file, so a module ` +
          `cannot open a new public top-level route`);
      }
      if (sub.includes("..") || sub.startsWith("/")) say(`"app": "${sub}" is not a relative subtree`);
    }
  }

  // ── slots: a card on a page the CORE owns ─────────────────────────────────
  // Only the SHAPE is checked here. Whether "account" is a place that exists is
  // checked by the COMPILER — `lib/modules/slot-registry.ts` is generated and
  // typed against `SlotName`, so a slot nobody offers fails `npm run typecheck`
  // by name. Restating the list of slots here would be a second copy of it, and
  // the second copy is always the one that goes stale.
  const slots = m.slots ?? {};
  if (!isObject(slots)) {
    say('"slots" must map a slot name to the component file that fills it');
  } else {
    for (const [slot, file] of Object.entries(slots)) {
      if (!/^[a-z][a-z0-9-]*$/.test(slot)) {
        say(`"slots": "${slot}" is not a slot name — lower case, letters, digits and dashes`);
      }
      // ⚠️ `REL` alone is not "inside the module". It refuses a path that STARTS
      // with a dot, so `../../components/card.tsx` never reached the generator —
      // but `slots/../../card.tsx` is spelled entirely in characters it allows
      // and climbs out just as far. `components` and `serverExports` below have
      // carried the second half of this clause since they existed; this one did
      // not, so the one key that puts a module's component on a page the CORE
      // owns was the one key that could be filled from outside the module.
      if (typeof file !== "string" || !REL.test(file) || file.includes("..")) {
        say(`"slots": "${slot}" must name a file inside the module`);
      }
    }
  }

  // 🚨 What the APP's OWN pages may import from this module.
  //
  // A module whose whole product is a seam — `activity`, `companion` — ships a
  // component and expects the customer to render it on a page they wrote. That
  // page lives under `app/`, which `modules/boundary.test.ts` §1 scans, and §1
  // fails any core file naming `@/modules/<installed id>`. So the instruction
  // in `docs/learning.md` ("render `<ActivityPanel>` on your unit page") was
  // one an app structurally COULD NOT follow: doing it turned the customer's
  // own suite red, and nobody noticed because no field run has had a module
  // installed since the four moved under `modules/` (2026-08-08).
  //
  // §1's error message already names the way out — "everything the core needs
  // from a module comes through a generated registry" — so this key is what
  // fills `lib/modules/component-registry.ts`, and a page imports from there.
  //
  // Names are a component (`ActivityPanel`) or the hook that drives one
  // (`useActivity`), because that is what a page can do with them, and because
  // a lower-case typo would otherwise generate an export nothing can render.
  // Anything else this key might one day carry is a widening somebody decides,
  // not one that slips in.
  const components = m.components ?? {};
  if (!isObject(components)) {
    say('"components" must map an exported name to the file inside the module that exports it');
  } else {
    for (const [name, file] of Object.entries(components)) {
      if (!/^(?:[A-Z][A-Za-z0-9]*|use[A-Z][A-Za-z0-9]*)$/.test(name)) {
        say(
          `"components": "${name}" is neither a component (PascalCase) nor a hook (useSomething) — ` +
            `this key is what an app's own page imports, and it can render neither`,
        );
      }
      if (typeof file !== "string" || !REL.test(file) || file.includes("..")) {
        say(`"components": "${name}" must name a file inside the module`);
      }
    }
  }

  // The server-side twin of `components`. Same shape, opposite side of the
  // client boundary — see the header of `serverRegistryExports()` in
  // `generate.mjs` for why they may not be one barrel.
  const serverExports = m.serverExports ?? {};
  if (!isObject(serverExports)) {
    say('"serverExports" must map an exported name to the file inside the module that exports it');
  } else {
    for (const [name, file] of Object.entries(serverExports)) {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) {
        say(`"serverExports": "${name}" is not a plain identifier an app can import`);
      }
      if (typeof file !== "string" || !REL.test(file) || file.includes("..")) {
        say(`"serverExports": "${name}" must name a file inside the module`);
      }
    }
  }

  const publicRoutes = m.publicRoutes ?? {};
  if (!isObject(publicRoutes)) {
    say('"publicRoutes" must map a url to the sentence saying what guards it');
  } else {
    for (const [url, reason] of Object.entries(publicRoutes)) {
      if (!url.startsWith("/")) say(`"publicRoutes": "${url}" must be a url`);
      // The same bar app/route-protection.test.ts sets: a route outside
      // /dashboard is public until something else guards it, and the reason is
      // the record of what that something is.
      if (typeof reason !== "string" || reason.trim().length < 20) {
        say(`"publicRoutes": "${url}" needs a sentence saying what guards it instead`);
      } else if (/\b(todo|tbd|later|fixme)\b/i.test(reason)) {
        say(`"publicRoutes": "${url}" has a placeholder reason`);
      }
    }
  }

  // ── tables, and the GDPR wiring they oblige ───────────────────────────────
  const tables = m.tables ?? [];
  if (!isStringArray(tables)) say('"tables" must be an array of table names');
  const prefix = m.tablePrefix;
  if (prefix !== undefined && (typeof prefix !== "string" || !prefix.endsWith("_"))) {
    say('"tablePrefix" must end in an underscore, e.g. "community_"');
  }

  if (Array.isArray(tables) && tables.length > 0) {
    if (typeof prefix !== "string") {
      say('"tables" without a "tablePrefix" — the prefix is how a script recognises the ' +
        "module's tables without importing TypeScript");
    } else {
      if (typeof id === "string" && !prefix.startsWith(sqlName(id))) {
        say(`"tablePrefix" ("${prefix}") must start with "${sqlName(id)}" — the module id ` +
          `with dashes as underscores, which is what keeps two modules from claiming the ` +
          `same tables and still names a table nobody has to quote`);
      }
      const stray = tables.filter((t) => typeof t === "string" && !t.startsWith(prefix));
      if (stray.length > 0) say(`"tables" outside the prefix: ${stray.join(", ")}`);
    }

    for (const key of ["schema", "migrations", "migrationsTable"]) {
      if (m[key] === undefined) say(`"tables" declared but no "${key}"`);
    }
    if (typeof m.migrationsTable === "string" && typeof id === "string" &&
        m.migrationsTable !== `__drizzle_migrations_${sqlName(id)}`) {
      say(`"migrationsTable" must be "__drizzle_migrations_${sqlName(id)}" — one journal per ` +
        `module, named after it, so a database says which chains have run`);
    }

    // 🚨 Rule 2. A module that stores personal data and cannot answer for it is
    // the failure this system must not introduce.
    const privacy = m.privacy;
    if (!isObject(privacy) || !isStringArray(privacy.sections) || privacy.sections.length === 0 ||
        typeof privacy.ts !== "string" || typeof privacy.mjs !== "string") {
      say('"tables" declared but no complete "privacy" ({ sections, ts, mjs }) — a module ' +
        "that holds rows about a person answers Art. 15 in BOTH exports, the member's own " +
        "download and the operator's command, or it does not ship");
    }
    if (m.erase !== true) {
      say('"tables" declared but "erase" is not true — the module must export eraseFor() so ' +
        "account deletion reaches its rows; a cascade alone does not scrub what a member wrote");
    }

    // 🚨 Rule 2c. A module that holds rows must be able to say whether an
    // ENVIRONMENT has them.
    //
    // `docs/modules.md` and `docs/content.md` both state this as required, on
    // the same bar `privacy` clears — and for a while nothing enforced it, so
    // two of the four modules with tables shipped without one and validated
    // cleanly. That is the shape `manifest.mjs` refuses everywhere else: a
    // promise with no executor (`guidance`, removed for exactly this).
    //
    // ⚠️ Answering is not the same as having an expected count. A module whose
    // rows are the MEMBERS' own — results, keys — reports what it holds with
    // `expected: null` and can never fail on it; only `missing` or a shortfall
    // against a real expectation is a problem (`lib/content/presence.ts`). The
    // rule is about being ASKABLE, because `content-check` exists to find an
    // empty environment, and "nothing to report" must not render the same as
    // "I could not look".
    if (typeof m.presence !== "string") {
      say('"tables" declared but no "presence" — a module that holds rows says whether an ' +
        "environment HAS them, or `node run.mjs content-check` answers a smaller question " +
        "than its name while showing a green tick (docs/content.md)");
    }

    // 🚨 Rule 2d. A module that holds rows says WHOSE they are, and that answer
    // is what decides whether it owes a content transport.
    //
    // `docs/modules.md` has stated the transport as an obligation since the
    // `appliers` field existed — "a module that brings tables must be able to
    // fill them, or its content exists only where it was typed" — and nothing
    // enforced it, the third instance in this file of a promise with no
    // executor (`guidance`, removed; `presence`, enforced only after two
    // modules had shipped without one).
    //
    // ⚠️ It could not simply be made unconditional, and that is the whole
    // reason this key exists rather than a `tables` → `appliers` line beside
    // the `presence` one above: `community`, `api` and `activity` bring tables
    // and author nothing — their rows are posts, keys and a learner's answers.
    // An applier there would be a transport that overwrites what members wrote,
    // so for them the absence of one is the correct state and the RIGHT refusal
    // is the opposite one.
    const content = m.content;
    if (content === undefined) {
      say('"tables" declared but no "content" — say whether this module\'s rows come from the ' +
        'REPO ("authored": it owes an "appliers" transport, or its content exists only where it ' +
        'was typed) or from the people using the app ("collected": it owes no transport, and one ' +
        "here would upsert over what members wrote)");
    } else if (!CONTENT_KINDS.includes(content)) {
      say(`"content" is ${JSON.stringify(content)} — the two answers are "authored" (the rows ` +
        `come from the REPO, so the module owes an "appliers" transport) and "collected" (the ` +
        `rows come from the people using the app, so it owes none and may not ship one)`);
    } else if (content === "authored" && typeof m.appliers !== "string") {
      say('"content" is "authored" but no "appliers" — a module that brings its own rows must be ' +
        "able to fill an environment with them, or its content exists only where it was typed " +
        "(docs/content.md → A MODULE can bring one)");
    } else if (content === "collected" && m.appliers !== undefined) {
      say('"content" is "collected" but "appliers" is declared — these rows are written by the ' +
        "people using the app, and an applier upserts over them on every run, so this transport " +
        "would overwrite what members wrote every time content-apply is run");
    }

    // 🚨 Rule 2b. Answering Art. 15 in the exports is half of it. The other half
    // is what `/dashboard/account` SAYS to the member before they press the
    // button — the download's hint, and the deletion dialog's "what goes" list.
    //
    // ⚠️ This exists because the core used to say it for everybody. Those two
    // sentences enumerated the community's profile, moderator duties, posts and
    // read markers, and the api module's keys, in `messages/{de,en}.json` — so a
    // fresh app promised a member data it did not hold, and (the direction that
    // matters) trimming them would have made an app that DOES hold it describe
    // its own Art. 15 answer too narrowly. Neither is fixable in the core: only
    // the module knows what it stores.
    //
    // Keys, not sentences: the text lives in the module's own message files, in
    // every language, like all other text in this app.
    const notes = isObject(privacy) ? privacy.accountNotes : undefined;
    if (!isObject(notes) || typeof notes.export !== "string" || typeof notes.deletion !== "string") {
      say('"tables" declared but no "privacy.accountNotes" ({ export, deletion }) — a module ' +
        "that holds rows about a person says so on /dashboard/account too: one sentence for " +
        "the download's hint, one for the deletion dialog. The core cannot write them, because " +
        "only the module knows what it stores");
    } else {
      // A key the module cannot own is a key it cannot ship the text for.
      // Checked against the same `namespaces` rule below rather than against the
      // id directly, so the two answers cannot drift.
      const owned = isObject(m.messages) && isStringArray(m.messages.namespaces)
        ? m.messages.namespaces
        : [];
      for (const [which, key] of [["export", notes.export], ["deletion", notes.deletion]]) {
        if (!owned.some((ns) => key.startsWith(`${ns}.`))) {
          say(`"privacy.accountNotes.${which}" is "${key}", which is in no namespace this ` +
            `module declares (${owned.join(", ") || "none"}) — a module writes its own text ` +
            "and never into somebody else's namespace");
        }
      }
    }
  } else if (m.content !== undefined) {
    // The other side of Rule 2d, and the reason the key is two words rather
    // than a boolean somebody could set anywhere: `content` answers whose the
    // module's ROWS are. A module with no tables has none, so both answers
    // would be a promise about something it does not have — `companion` is the
    // shipped case, a seam with no schema at all.
    say('"content" declared but no "tables" — this key says whose the module\'s ROWS are ' +
      '("authored" from the repo, "collected" from the people using the app), and a module ' +
      "with no tables has none: it owes no transport and no presence answer either");
  }

  // ── the shared core a companion repo gets ─────────────────────────────────
  //
  // ⚠️ A module may contribute files to `node run.mjs export-core`, and it does
  // so HERE rather than by being typed into `config/core-export.json`. That is
  // where `modules/api/keys/rules.ts` sat: the core's own manifest naming a
  // module's file, so an app that never installed the api module still copied it
  // into its companion repo — a shared "core" file for a feature that app does
  // not have.
  //
  // Paths are relative to the module folder, for the same reason every other
  // manifest path is: a module says where things are inside itself.
  const coreExport = m.coreExport;
  if (coreExport !== undefined) {
    if (!isStringArray(coreExport) || coreExport.length === 0) {
      say('"coreExport" must be a non-empty array of paths inside the module');
    } else {
      for (const file of coreExport) {
        if (file.startsWith("/") || file.includes("..")) {
          say(`"coreExport" entry "${file}" leaves the module — a module exports its own files`);
        }
      }
    }
  }

  // ── texts ─────────────────────────────────────────────────────────────────
  const messages = m.messages;
  if (messages !== undefined) {
    if (!isObject(messages) || !isStringArray(messages.namespaces) ||
        messages.namespaces.length === 0 || typeof messages.dir !== "string") {
      say('"messages" must be { namespaces: [...], dir: "messages" }');
    } else if (typeof id === "string") {
      const stray = messages.namespaces.filter((n) => !n.startsWith(id));
      if (stray.length > 0) {
        say(`"messages.namespaces" outside the module id: ${stray.join(", ")} — a namespace ` +
          `that does not start with the module id can collide with the core or another module`);
      }
    }
  }
  const errorCodes = m.errorCodes;
  if (errorCodes !== undefined &&
      (!isObject(errorCodes) || typeof errorCodes.source !== "string" ||
       typeof errorCodes.export !== "string")) {
    say('"errorCodes" must be { source, export } naming the file and the exported union');
  }

  // ── the rest ──────────────────────────────────────────────────────────────
  const tracing = m.outputFileTracingIncludes;
  if (tracing !== undefined) {
    if (!isObject(tracing)) {
      say('"outputFileTracingIncludes" must map a route glob to the files it needs');
    } else {
      for (const [route, files] of Object.entries(tracing)) {
        if (!route.startsWith("/")) say(`"outputFileTracingIncludes": "${route}" is not a route`);
        if (!isStringArray(files) || files.length === 0) {
          say(`"outputFileTracingIncludes": "${route}" needs a non-empty list of file globs`);
        } else {
          // The globs are resolved from the APP root, so a module asking for
          // "./content/**" would quietly claim the core's files. Everything it
          // needs is inside itself.
          //
          // 🚨 A PREFIX, and never a substring. `.includes("modules/<id>/")`
          // accepted `./content/x/modules/community/y/**`: a path that points
          // straight into the core's tree and merely CONTAINS the module's
          // folder name further along. Narrow — an author has to write that
          // path — but the check's whole job is the one glob nobody meant to
          // write, and a substring test cannot tell the two apart.
          //
          // The `..` half is the same clause `app`, `components` and
          // `serverExports` carry: `modules/<id>/../../content/**` clears the
          // prefix by spelling and then leaves the folder again. One message for
          // both, because the answer is the same one — the glob is not inside
          // `modules/<id>/`.
          //
          // A leading `./` is the form `inventory.mjs` derives from `appliers`
          // (`./${record.dir}/…`) and the form every fixture uses, so it is
          // stripped rather than refused; `/modules/<id>/…` is absolute, resolves
          // from the filesystem root rather than the app's, and is not.
          const stray = files.filter((f) => {
            if (typeof id !== "string") return false;
            const path = f.startsWith("./") ? f.slice(2) : f;
            return !path.startsWith(`modules/${id}/`) || path.includes("..");
          });
          if (stray.length > 0) {
            say(`"outputFileTracingIncludes": ${stray.join(", ")} — the globs are resolved from ` +
              `the app root, so a module traces files inside modules/${id}/ and nowhere else`);
          }
        }
      }
    }
  }

  // 🚨 Art. 50(1) EU AI Act. A module that talks to a person as a machine says
  // so, and joins the one registry that is checked — `lib/ai/disclosure.mjs`.
  // `.mjs` because `legal-check` runs with no bundler and cannot read TypeScript.
  if (m.disclosure !== undefined && !String(m.disclosure).endsWith(".mjs")) {
    say('"disclosure" must be a .mjs file — `node run.mjs legal-check` runs with no bundler ' +
      "and cannot import TypeScript");
  }

  if (m.features !== undefined && !isStringArray(m.features)) say('"features" must be an array');
  if (m.navAreas !== undefined && !isStringArray(m.navAreas)) say('"navAreas" must be an array');
  // ── scheduled jobs ────────────────────────────────────────────────────────
  //
  // Two fields, and neither works alone: `cron` is the FILE whose default export
  // is the job bodies, `cronJobs` is the NAMES. The split mirrors
  // `lib/cron/jobs.ts` against `lib/cron/ids.mjs` — the names are needed by
  // readers that must not touch the database (`lib/cron/config.ts`, read by
  // `instrumentation.ts`) and by bare Node, which cannot import TypeScript.
  //
  // ⚠️ `cronJobs` used to be accepted ALONE, and that was the trap: it validated,
  // `module list` printed it, and `scripts/dev/session-start.mjs` was even taught
  // to keep quiet about it so the customer would not be nagged — while nothing
  // registered the job and it could never run. Three readers honouring a promise
  // no executor kept, with the one signal that would have shown it suppressed.
  if (m.cronJobs !== undefined && !isStringArray(m.cronJobs)) say('"cronJobs" must be an array');
  if (m.cron !== undefined && !String(m.cron).endsWith(".ts")) {
    say('"cron" must be a .ts file — the job bodies run inside the app, where the ' +
      "database and the mail transport are (see lib/cron/jobs.ts)");
  }
  if (m.cron !== undefined && !isStringArray(m.cronJobs)) {
    say('"cron" without "cronJobs" — the ids have to be declared too, because ' +
      "lib/cron/config.ts and scripts/ read the names without being able to load the " +
      "bodies. lib/cron/rules.test.ts holds the two to each other");
  }
  if (m.cronJobs !== undefined && m.cron === undefined) {
    say('"cronJobs" without "cron" — nothing would register these jobs, so they ' +
      "would be validated here, printed by `module list`, excluded from the greeting's " +
      "reminder, and never run. Point \"cron\" at the file whose default export is them");
  }
  if (isStringArray(m.cronJobs) && typeof id === "string") {
    for (const job of m.cronJobs) {
      // The same rule commands and shared message keys get, for the same reason:
      // `JOB_IDS` is one flat list the core and every module write into, and a
      // module must not be able to shadow `prune-ai-usage`.
      if (job !== id && !job.startsWith(`${id}-`)) {
        say(`"cronJobs": "${job}" must be "${id}" or start with "${id}-" — job ids are ` +
          `one flat list shared with the core, and a module may only name its own`);
      }
    }
  }
  // ── the module's own content source ───────────────────────────────────────
  //
  // What the in-app assistant may search inside this module (docs/content-source.md).
  // `.ts` for the same reason `cron` is: the default export runs INSIDE the app
  // process, where the database and the entitlement layer are — a source is a
  // reader of the module's own tables, not a script.
  //
  // ⚠️ **There is no both-or-neither partner here, and that is deliberate.**
  // `cron` needs `cronJobs` because readers that must not touch the database
  // need the job NAMES without the bodies. Nothing needs the source's id
  // without its methods: the only consumer is `CONTENT_SOURCES`, which imports
  // the default export itself and reads `.id` off it. A second key would be a
  // second copy of a value the file already carries.
  if (m.contentSource !== undefined && !String(m.contentSource).endsWith(".ts")) {
    say('"contentSource" must be a .ts file — the source runs inside the app, where the ' +
      "database and the entitlement layer are (see lib/content-source/sources.ts)");
  }

  if (m.erase !== undefined && typeof m.erase !== "boolean") say('"erase" must be true or false');

  const commands = m.commands ?? {};
  if (!isObject(commands)) {
    say('"commands" must map a command name to { script, help }');
  } else {
    for (const [name, entry] of Object.entries(commands)) {
      if (typeof id === "string" && !name.startsWith(`${id}-`) && name !== id) {
        say(`"commands": "${name}" must start with the module id — a module must not shadow ` +
          `a core command, and the prefix is what makes that visible in \`run.mjs help\``);
      }
      if (!isObject(entry)) {
        say(`"commands": "${name}" must be { script, help }`);
        continue;
      }
      if (typeof entry.script !== "string" || !REL.test(entry.script) ||
          entry.script.includes("..")) {
        say(`"commands": "${name}" needs a relative script path inside the module`);
      }
      // `run.mjs help` is how anybody finds a command at all. A module command
      // with no help line is one nobody can discover, which is the same as not
      // shipping it — and `--json` hands that empty line to an agent.
      if (typeof entry.help !== "string" || entry.help.trim().length < 10) {
        say(`"commands": "${name}" needs a "help" line — it is what \`run.mjs help\` prints, ` +
          `and a command nobody can find is one nobody runs`);
      }
    }
  }

  // `guidance` used to be validated here. It is now an UNKNOWN key and refused
  // by the check above, deliberately — the reasoning is beside `KNOWN`, and the
  // refusal naming it by name is better than the silent acceptance it had.

  return p;
}

/**
 * A validated manifest, or a throw naming everything wrong with it.
 *
 * @param {unknown} raw
 * @param {string} where
 */
export function readManifest(raw, where) {
  const problems = manifestProblems(raw, where);
  if (problems.length > 0) {
    throw new Error(`${problems.length} problem(s) in the module manifest:\n  ` +
      problems.join("\n  "));
  }
  return /** @type {Record<string, unknown>} */ (raw);
}
