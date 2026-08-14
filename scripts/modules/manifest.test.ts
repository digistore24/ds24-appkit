// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The module manifest, and the rules it is refused for.
//
// No module has moved into `modules/` yet, so a test that only walked that
// folder would pass on nothing — the exact green-by-vacuity this repo refuses
// elsewhere (`scripts/core/purity.test.ts` guards its manifest length for the
// same reason). So the weight here is carried by a REFERENCE manifest: the one
// the community will ship, written out in full, asserted coherent, and then
// broken one field at a time.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { manifestProblems, readManifest } from "./manifest.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * What a real manifest looks like. Kept complete rather than minimal: a
 * reference that omits the hard parts stops being the thing a reader copies.
 */
const REFERENCE = {
  id: "community",
  version: "1.0.0",
  requiresTemplate: "0.19.0",
  requires: [],
  title: { de: "Community", en: "Community" },
  summary: "a place for members: rooms, discussions under the pages they belong to, private messages",
  docs: "docs/community.md",
  skill: "community",

  config: "config/community.json",
  configDefault: "config.default.json",

  app: ["dashboard/community", "dashboard/admin/community", "api/community"],
  publicRoutes: {
    "/api/community/live":
      "isCommunityEnabled() first, then currentActiveUser(), then the per-scope access check re-derived on every answer",
  },

  schema: "schema.ts",
  tables: ["community_profiles", "community_groups", "community_posts"],
  tablePrefix: "community_",
  content: "collected",
  migrations: "drizzle",
  migrationsTable: "__drizzle_migrations_community",

  messages: { namespaces: ["community", "communityAdmin"], dir: "messages" },
  errorCodes: { source: "rules.ts", export: "COMMUNITY_ERROR_CODES" },

  nav: "nav.ts",
  features: ["community", "communityAdmin"],
  gate: "gate.ts",
  entry: "module.ts",

  privacy: {
    sections: ["communityProfile", "communityPosts"],
    accountNotes: { export: "community.accountExportNote", deletion: "community.accountDeletionNote" },
    ts: "privacy/sections.ts",
    mjs: "privacy/sections.mjs",
  },
  erase: true,
  presence: "presence/check.ts",

  commands: { "community-prune": { script: "scripts/prune.mjs", help: "Delete private messages past the retention window" } },
  cron: "cron.ts",
  cronJobs: ["community-prune"],
  smoke: "smoke.mjs",

  navAreas: ["community"],
};

const WHERE = "modules/community/module.json";

/** The reference with one field replaced — `undefined` removes it. */
function broken(patch: Record<string, unknown>) {
  const copy: Record<string, unknown> = { ...REFERENCE, ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete copy[k];
  return copy;
}

describe("a coherent manifest passes", () => {
  it("accepts the reference", () => {
    expect(manifestProblems(REFERENCE, WHERE)).toEqual([]);
    expect(() => readManifest(REFERENCE, WHERE)).not.toThrow();
  });

  it("accepts a module with no tables and no routes", () => {
    // The smallest legal module: an id, a version, a title and the one line
    // that says what it is. Everything else is a promise it does not make.
    expect(
      manifestProblems(
        {
          id: "tiny",
          version: "0.1.0",
          title: { de: "Klein", en: "Tiny" },
          summary: "the smallest module there is, and it brings nothing but itself",
          docs: "docs/modules.md",
        },
        WHERE,
      ),
    ).toEqual([]);
  });

  it("accepts a dashed id, with its SQL names spelled in underscores", () => {
    // The shape a third party's id takes — `<vendor>-<feature>` — and the one
    // no module of ours has ever had, which is why the two rules below could
    // demand `acme-crm_` and `__drizzle_migrations_acme-crm` for years without
    // anybody noticing they were asking for identifiers Postgres takes only in
    // quotes.
    expect(
      manifestProblems(
        broken({
          id: "acme-crm",
          tablePrefix: "acme_crm_",
          tables: ["acme_crm_leads"],
          migrationsTable: "__drizzle_migrations_acme_crm",
          messages: { namespaces: ["acme-crm"], dir: "messages" },
          commands: undefined,
          cron: undefined,
          cronJobs: undefined,
          slots: undefined,
          components: undefined,
          serverExports: undefined,
          contentSource: undefined,
          app: undefined,
          publicRoutes: undefined,
          navAreas: undefined,
          coreExport: undefined,
          errorCodes: undefined,
          privacy: {
            sections: ["acme-crm"],
            ts: "privacy/sections.ts",
            mjs: "privacy/sections.mjs",
            accountNotes: {
              export: "acme-crm.accountExportNote",
              deletion: "acme-crm.accountDeletionNote",
            },
          },
        }),
        WHERE,
      ),
    ).toEqual([]);
  });

  it("accepts a docs page inside the module — the form a foreign module uses", () => {
    // Our own five point into `docs/`, where `node run.mjs update` keeps them
    // current. A module this template did not write has no page there and never
    // could: we cannot ship a doc about a module we have never heard of. It
    // ships its own, and the update channel never touches it because the file
    // is in neither manifest.
    expect(manifestProblems(broken({ docs: "modules/community/docs.md" }), WHERE)).toEqual([]);
    expect(manifestProblems(broken({ docs: "modules/community/docs/guide.md" }), WHERE)).toEqual([]);
  });

  it("refuses a docs path that points into ANOTHER module, or out of the tree", () => {
    // The same containment the tracing globs get, and for the same reason: a
    // path that resolves from the app root could otherwise name somebody
    // else's file — or the core's — and `module list` would print it as this
    // module's own page.
    for (const docs of [
      "modules/courses/docs.md",
      "modules/community/../courses/docs.md",
      "modules/community/docs.txt",
      "../secrets.md",
    ]) {
      expect(manifestProblems(broken({ docs }), WHERE).join(" "), docs).toMatch(/"docs"/);
    }
  });

  it("🚨 refuses `guidance` — a module does not ship its own docs or skill", () => {
    // It was a validated key that no module declared, no generator read and no
    // page documented, and it is gone rather than built: guidance has to be
    // readable in an app that does NOT have the module (that is how anybody
    // learns it exists), and `node run.mjs update` addresses guidance by PATH —
    // text under `modules/` could never be brought up to date in a released app.
    // The full reasoning is beside `KNOWN` in manifest.mjs.
    //
    // Asserted rather than left to the unknown-key check in general, because the
    // cheap way to "fix" a refusal somebody does not expect is to add the key
    // back to `KNOWN`, and then the decision is gone with no test to notice.
    const problems = manifestProblems(
      broken({ guidance: { claudeSection: "guidance/CLAUDE.md" } }),
      WHERE,
    );
    expect(problems.join(" ")).toMatch(/guidance/);
  });
});

describe("🚨 a module with tables declares its whole GDPR wiring", () => {
  // The rule that replaces remembering. A module storing rows about a person
  // and unable to answer for them is the failure this system must not add.
  it("refuses tables without privacy sections", () => {
    expect(manifestProblems(broken({ privacy: undefined }), WHERE).join(" ")).toMatch(/privacy/);
  });

  it("refuses an empty section list", () => {
    expect(
      manifestProblems(broken({ privacy: { ...REFERENCE.privacy, sections: [] } }), WHERE).join(" "),
    ).toMatch(/privacy/);
  });

  it("refuses privacy that answers only one of the two exports", () => {
    // The member's own download and the operator's command are two files and
    // have drifted apart once already in this app.
    for (const missing of ["ts", "mjs"] as const) {
      const privacy: Record<string, unknown> = { ...REFERENCE.privacy };
      delete privacy[missing];
      expect(manifestProblems(broken({ privacy }), WHERE).join(" "), missing).toMatch(/privacy/);
    }
  });

  it("🚨 refuses tables without the two sentences the account page shows", () => {
    // Answering Art. 15 in the export files is half of it. The other half is
    // what a member READS before pressing download or delete — and those two
    // sentences used to be core strings enumerating this module's data, so a
    // fresh app promised data it did not hold. Only the module knows what it
    // stores; the manifest is where it is made to say so.
    const privacy: Record<string, unknown> = { ...REFERENCE.privacy };
    delete privacy.accountNotes;
    expect(manifestProblems(broken({ privacy }), WHERE).join(" ")).toMatch(/accountNotes/);

    for (const missing of ["export", "deletion"] as const) {
      const notes: Record<string, unknown> = { ...(REFERENCE.privacy.accountNotes as object) };
      delete notes[missing];
      expect(
        manifestProblems(broken({ privacy: { ...REFERENCE.privacy, accountNotes: notes } }), WHERE)
          .join(" "),
        missing,
      ).toMatch(/accountNotes/);
    }
  });

  it("refuses a note key in a namespace the module does not own", () => {
    // A module writes its own text. A key under `privacy.…` or another module's
    // namespace is either text this module cannot ship or text it would be
    // overwriting — and the merged catalogue would answer for whoever wrote last.
    expect(
      manifestProblems(
        broken({
          privacy: {
            ...REFERENCE.privacy,
            accountNotes: { export: "privacy.exportHint", deletion: "community.accountDeletionNote" },
          },
        }),
        WHERE,
      ).join(" "),
    ).toMatch(/namespace/);
  });

  it("refuses tables without eraseFor()", () => {
    expect(manifestProblems(broken({ erase: undefined }), WHERE).join(" ")).toMatch(/erase/);
    expect(manifestProblems(broken({ erase: false }), WHERE).join(" ")).toMatch(/erase/);
  });

  it("🚨 refuses tables without a presence check", () => {
    // `docs/modules.md` and `docs/content.md` stated this as required on the
    // same bar `privacy` clears, and for a while nothing enforced it: two of
    // the four modules with tables shipped without one and validated cleanly,
    // so `content-check` answered a smaller question than its name while
    // showing a green tick. A promise with no executor is what `guidance` was
    // removed for.
    expect(manifestProblems(broken({ presence: undefined }), WHERE).join(" ")).toMatch(/presence/);
    // A module with no tables owes nothing — there is nothing an environment
    // could have been given.
    expect(
      manifestProblems(
        { ...REFERENCE, tables: undefined, tablePrefix: undefined, schema: undefined,
          migrations: undefined, migrationsTable: undefined, privacy: undefined,
          erase: undefined, presence: undefined, content: undefined },
        WHERE,
      ),
    ).toEqual([]);
  });

  it("refuses tables with no schema, migrations or journal table", () => {
    for (const key of ["schema", "migrations", "migrationsTable"]) {
      expect(manifestProblems(broken({ [key]: undefined }), WHERE).join(" "), key).toMatch(key);
    }
  });

  it("insists the journal table is named after the module", () => {
    // One database, several chains: a shared or mistyped journal name is two
    // modules overwriting each other's migration history.
    expect(
      manifestProblems(broken({ migrationsTable: "__drizzle_migrations" }), WHERE).join(" "),
    ).toMatch(/__drizzle_migrations_community/);
  });
});

describe("🚨 a module with tables says WHOSE its rows are", () => {
  // Story 36.1. `docs/modules.md` has stated the content transport as an
  // obligation since the `appliers` field existed — "a module that brings
  // tables must be able to fill them, or its content exists only where it was
  // typed" — and nothing enforced it: the third instance in `manifest.mjs` of a
  // promise with no executor, after `guidance` (removed) and `presence` (which
  // two shipped modules had validated cleanly without).
  //
  // ⚠️ It could NOT be made unconditional, and that is why the fix is a
  // discriminator rather than a `tables` → `appliers` line: `community`, `api`
  // and `activity` bring tables and author nothing, so requiring an applier
  // would refuse three correct shipped modules — and one there would upsert
  // over what members wrote. Every one of the five refusals below has its own
  // case here, positive and negative, because a refusal no test executes is
  // exactly what this key was added to replace.

  /** `courses`' shape: rows from the repo, and the transport that carries them. */
  const authored = { content: "authored", appliers: "content/appliers" };

  it("R1 — refuses tables that do not say where their rows come from", () => {
    expect(manifestProblems(broken({ content: undefined }), WHERE).join(" ")).toMatch(/"content"/);
    // The negative half: BOTH answers are legal on a module with tables, so
    // this is a discriminator and not a rule that refuses everything.
    expect(manifestProblems(broken({ content: "collected" }), WHERE)).toEqual([]);
    expect(manifestProblems(broken(authored), WHERE)).toEqual([]);
  });

  it("R2 — refuses a third answer, naming it and the two that exist", () => {
    for (const value of ["member", "operator", "authored ", true, 1]) {
      const problems = manifestProblems(broken({ content: value }), WHERE).join(" ");
      expect(problems, String(value)).toMatch(/the two answers are "authored".*"collected"/);
      expect(problems, String(value)).toContain(JSON.stringify(value));
    }
    expect(manifestProblems(broken({ content: "collected" }), WHERE)).toEqual([]);
  });

  it('R3 — "authored" without a transport is content that exists only where it was typed', () => {
    expect(manifestProblems(broken({ content: "authored" }), WHERE).join(" "))
      .toMatch(/"content" is "authored" but no "appliers"/);
    expect(manifestProblems(broken(authored), WHERE)).toEqual([]);
  });

  it('R4 — "collected" MUST NOT ship a transport that upserts over what members wrote', () => {
    // The refusal that only a discriminator can express, and the reason this is
    // not a boolean: the community holds a great deal of content, and an
    // applier for it would overwrite people's posts on every content-apply.
    expect(manifestProblems(broken({ appliers: "content/appliers" }), WHERE).join(" "))
      .toMatch(/"content" is "collected" but "appliers" is declared/);
    expect(manifestProblems(broken(authored), WHERE)).toEqual([]);
  });

  it("R5 — a module with no tables promises nothing about rows it does not have", () => {
    // `companion` is the shipped case: a seam with no schema at all. Declaring
    // the key there would be an answer to a question it is not asked.
    const noTables = {
      ...REFERENCE, tables: undefined, tablePrefix: undefined, schema: undefined,
      migrations: undefined, migrationsTable: undefined, privacy: undefined,
      erase: undefined, presence: undefined,
    };
    expect(manifestProblems({ ...noTables, content: "collected" }, WHERE).join(" "))
      .toMatch(/"content" declared but no "tables"/);
    expect(manifestProblems({ ...noTables, content: "authored" }, WHERE).join(" "))
      .toMatch(/"content" declared but no "tables"/);
    expect(manifestProblems({ ...noTables, content: undefined }, WHERE)).toEqual([]);
  });

  it("🚨 AC5 — an `appliers` path that climbs out of the module is refused", () => {
    // Measured before this story was written: `manifest.mjs`'s relative-path
    // loop covers thirteen keys and a test reached it for exactly TWO
    // (`schema`, `contentSource`). This story cites `appliers` as a duty, so it
    // executes that refusal for it too — otherwise the citation is a claim
    // about code nothing has ever run, which is the shape the `guidance` key
    // was removed for.
    for (const path of ["../../elsewhere", "/etc/appliers", "content/../../elsewhere"]) {
      expect(
        manifestProblems(broken({ content: "authored", appliers: path }), WHERE).join(" "),
        path,
      ).toMatch(/"appliers" must be a relative path inside the module/);
    }
    expect(manifestProblems(broken(authored), WHERE)).toEqual([]);
  });
});

describe("🚨 module routes live under dashboard/ or api/", () => {
  // proxy.ts's matcher is read from the AST at build time, so it cannot be
  // computed from a manifest. A module route anywhere else would be public with
  // nothing in front of it.
  it("refuses a top-level route subtree", () => {
    expect(manifestProblems(broken({ app: ["community"] }), WHERE).join(" ")).toMatch(/dashboard\//);
    expect(manifestProblems(broken({ app: ["login"] }), WHERE).join(" ")).toMatch(/dashboard\//);
  });

  it("accepts dashboard/ and api/ subtrees", () => {
    expect(manifestProblems(broken({ app: ["dashboard/x", "api/x"] }), WHERE)).toEqual([]);
  });

  it("demands a sentence for every public route", () => {
    // The same bar app/route-protection.test.ts sets, applied at the manifest.
    expect(
      manifestProblems(broken({ publicRoutes: { "/api/community/live": "TODO" } }), WHERE).join(" "),
    ).toMatch(/what guards it/);
    expect(
      manifestProblems(
        broken({ publicRoutes: { "/api/community/live": "later, this is fine for now ok" } }),
        WHERE,
      ).join(" "),
    ).toMatch(/placeholder/);
  });
});

describe("names cannot collide with the core or another module", () => {
  it("insists tables carry the module's prefix", () => {
    expect(manifestProblems(broken({ tablePrefix: "cmty_" }), WHERE).join(" ")).toMatch(/module id/);
    expect(
      manifestProblems(broken({ tables: [...REFERENCE.tables, "users"] }), WHERE).join(" "),
    ).toMatch(/outside the prefix/);
  });

  it("insists message namespaces start with the module id", () => {
    expect(
      manifestProblems(broken({ messages: { namespaces: ["errors"], dir: "messages" } }), WHERE)
        .join(" "),
    ).toMatch(/collide/);
  });

  it("insists a command is prefixed with the module id", () => {
    // `run.mjs help` is how anybody finds a command; an unprefixed one reads
    // like a core command and can shadow one.
    expect(
      manifestProblems(broken({ commands: { prune: { script: "scripts/prune.mjs", help: "delete old rows" } } }), WHERE).join(" "),
    ).toMatch(/module id/);
  });

  it("insists a command carries a help line", () => {
    // `run.mjs help` (and its `--json` form, which an agent reads) is how
    // anybody finds a command at all. One without help is one nobody runs.
    expect(
      manifestProblems(broken({ commands: { "community-x": { script: "s.mjs" } } }), WHERE)
        .join(" "),
    ).toMatch(/"help"/);
    expect(
      manifestProblems(
        broken({ commands: { "community-x": { script: "s.mjs", help: "short" } } }),
        WHERE,
      ).join(" "),
    ).toMatch(/"help"/);
  });

  it("insists a command's script stays inside the module", () => {
    expect(
      manifestProblems(
        broken({ commands: { "community-x": { script: "../../rm.mjs", help: "does a thing" } } }),
        WHERE,
      ).join(" "),
    ).toMatch(/inside the module/);
  });
});

describe("the shape itself", () => {
  it("refuses an unknown key rather than ignoring it", () => {
    // A misspelt key is a promise nothing keeps: the generator would produce a
    // silently smaller registry and every gate would stay green.
    expect(manifestProblems(broken({ tabels: [] }), WHERE).join(" ")).toMatch(/unknown key/);
  });

  it("insists an AI-disclosure contributor is .mjs", () => {
    // 🚨 Art. 50(1): a module that talks to a person as a machine joins the one
    // registry that is checked. `legal-check` has no `needs` and runs with no
    // bundler, so the contributor cannot be TypeScript.
    expect(manifestProblems(broken({ disclosure: "disclosure.ts" }), WHERE).join(" "))
      .toMatch(/\.mjs/);
    expect(manifestProblems(broken({ disclosure: "disclosure.mjs" }), WHERE)).toEqual([]);
  });

  // ── the module's own content source ───────────────────────────────────────
  //
  // Four cases, the same four every path key gets: it validates, it may not be
  // absolute, it may not climb out, and it has to be the runtime the consumer
  // can load. The reference manifest deliberately does NOT carry the key —
  // `modules/community/ai-boundary.test.ts` refuses that coupling in the
  // community's own tree, and a reference that showed it there would be the
  // wrong thing to copy.
  it("accepts a module's own content source", () => {
    expect(manifestProblems(broken({ contentSource: "content-source.ts" }), WHERE)).toEqual([]);
  });

  it("refuses an absolute content-source path", () => {
    expect(
      manifestProblems(broken({ contentSource: "/etc/content-source.ts" }), WHERE).join(" "),
    ).toMatch(/"contentSource" must be a relative path inside the module/);
  });

  it("refuses a content source outside the module", () => {
    expect(
      manifestProblems(broken({ contentSource: "../../lib/content-source/rogue.ts" }), WHERE).join(" "),
    ).toMatch(/"contentSource" must be a relative path inside the module/);
  });

  it("insists a content source is .ts", () => {
    // The source reads the module's own tables, so it runs where the database
    // is. A `.mjs` here would be a file the app's bundler never sees registered
    // and bare Node could not usefully hold either.
    expect(manifestProblems(broken({ contentSource: "content-source.mjs" }), WHERE).join(" "))
      .toMatch(/must be a \.ts file/);
  });

  // ── what a module may trace into a standalone build ───────────────────────
  //
  // 🚨 Measured here for the first time. `manifest.mjs` has refused these three
  // shapes since the field existed, and grepping the whole template for any of
  // its three messages found only `manifest.mjs` itself — so "the refusal still
  // holds" was a claim about code nothing had ever run. The globs are resolved
  // from the APP root, which is what makes the third case matter: a module
  // asking for `./content/**` would quietly claim the core's files.
  it("refuses a tracing key that is not a route", () => {
    expect(
      manifestProblems(
        broken({ outputFileTracingIncludes: { "dashboard/community": ["./modules/community/x/**"] } }),
        WHERE,
      ).join(" "),
    ).toMatch(/is not a route/);
  });

  it("refuses a tracing key with no globs behind it", () => {
    // An empty list is a declaration that promises nothing, and it reads as a
    // module having said what it needs.
    for (const files of [[], "./modules/community/x/**"]) {
      expect(
        manifestProblems(
          broken({ outputFileTracingIncludes: { "/dashboard/community": files } }),
          WHERE,
        ).join(" "),
        JSON.stringify(files),
      ).toMatch(/non-empty list of file globs/);
    }
  });

  it("🚨 refuses a glob that points outside the module's own folder", () => {
    // The whole reason the rule exists: the paths resolve from the app root, so
    // an unchecked glob is a module tracing — and, once `next.config.ts` merges
    // rather than spreads, ADDING to — the core's files.
    const problems = manifestProblems(
      broken({ outputFileTracingIncludes: { "/api/chat": ["./content/knowledge/**/*"] } }),
      WHERE,
    ).join(" ");
    expect(problems).toMatch(/\.\/content\/knowledge\/\*\*\/\*/);
    expect(problems).toMatch(/modules\/community\/ and nowhere else/);
  });

  it("🚨 refuses a glob that only CONTAINS the module's folder further along", () => {
    // The needle. Until this story the check was
    // `f.includes("modules/<id>/")` — a SUBSTRING — so a path whose FIRST
    // segment is the core's tree passed by carrying the module's folder name
    // somewhere in the middle. It resolves from the app root like every other
    // glob here, so what it actually traces is `content/`, which belongs to the
    // operator and to the core.
    for (const glob of [
      "./content/x/modules/community/y/**",
      "content/knowledge/modules/community/**/*",
      "./lib/modules/community/**",
    ]) {
      const problems = manifestProblems(
        broken({ outputFileTracingIncludes: { "/api/chat": [glob] } }),
        WHERE,
      ).join(" ");
      expect(problems, glob).toMatch(/modules\/community\/ and nowhere else/);
      expect(problems, glob).toContain(glob);
    }
  });

  it("🚨 refuses a glob that climbs back out of the module's folder", () => {
    // The prefix's blind spot, and the same clause `app`, `components` and
    // `serverExports` carry: `modules/<id>/../..` is spelled correctly for two
    // segments and then leaves. One message, because the answer is the same —
    // the glob is not inside `modules/community/`.
    for (const glob of [
      "./modules/community/../../content/**/*",
      "modules/community/../api/**",
    ]) {
      expect(
        manifestProblems(
          broken({ outputFileTracingIncludes: { "/api/chat": [glob] } }),
          WHERE,
        ).join(" "),
        glob,
      ).toMatch(/modules\/community\/ and nowhere else/);
    }
  });

  it("🚨 refuses a glob that is absolute rather than app-relative", () => {
    // `/modules/community/**` resolves from the filesystem root, not the app's,
    // so it is not the same statement as `./modules/community/**` — and the
    // substring check could not tell them apart either.
    expect(
      manifestProblems(
        broken({ outputFileTracingIncludes: { "/api/chat": ["/modules/community/content/**"] } }),
        WHERE,
      ).join(" "),
    ).toMatch(/modules\/community\/ and nowhere else/);
  });

  it("accepts a glob inside the module's own folder", () => {
    // 🚨 The other direction, and the reason it is here: a prefix check that
    // refuses everything would pass every refusal above. Both spellings a
    // manifest may legitimately use — the leading `./` is what
    // `inventory.mjs` derives from `appliers`, and it is what every fixture in
    // `inventory.test.ts` writes.
    expect(
      manifestProblems(
        broken({
          outputFileTracingIncludes: {
            "/dashboard/community": ["./modules/community/content/**/*"],
            "/api/chat": ["./modules/community/handbook/**/*", "modules/community/fixtures/**"],
          },
        }),
        WHERE,
      ),
    ).toEqual([]);
  });

  it("refuses a tracing field that is not a map at all", () => {
    expect(
      manifestProblems(broken({ outputFileTracingIncludes: ["./modules/community/x/**"] }), WHERE)
        .join(" "),
    ).toMatch(/must map a route glob to the files it needs/);
  });

  it("refuses a reserved id", () => {
    // `route.test.ts` has exactly the shape of a route belonging to a module
    // called "test". Found by page-extensions.test.ts walking app/, not guessed.
    for (const id of ["test", "spec", "core", "modules"]) {
      expect(manifestProblems(broken({ id }), WHERE).join(" "), id).toMatch(/reserved/);
    }
  });

  it("🚨 refuses an id that would claim the core's own tables", () => {
    // A different failure from the reserved names above, and the sharper one:
    // `docs/modules.md` describes it and nothing prevented it. `ai` forces the
    // prefix `ai_` and thereby owns `ai_usage`; `token` owns `token_ledger`;
    // `chat` owns `chat_messages`. After which `module check` calls a core
    // table that module's orphan, and `remove --drop-data` offers to drop it.
    for (const id of ["ai", "chat", "token", "users", "media", "grants", "setup", "cron"]) {
      expect(manifestProblems(broken({ id }), WHERE).join(" "), id).toMatch(/reserved/);
    }
  });

  it("🚨 refuses an id too long for one migration journal per module", () => {
    // Postgres truncates at 63 bytes in silence and `__drizzle_migrations_`
    // spends 21. Two ids agreeing on their first 42 characters would share a
    // journal — and a shared journal is one module's `0000` counting as applied
    // for the other, so its tables simply never appear.
    const long = `acme-${"x".repeat(40)}`;
    expect(manifestProblems(broken({ id: long }), WHERE).join(" ")).toMatch(/at most 40/);
    expect(manifestProblems(broken({ id: "a".repeat(40) }), WHERE).join(" ")).not.toMatch(
      /at most 40/,
    );
  });

  it("🚨 refuses SQL names that spell a dashed id verbatim", () => {
    // The rule reads `acme-crm` as `acme_crm` everywhere it becomes an
    // identifier. Spelled with the dash it is a name Postgres takes only in
    // quotes, and the module's own bare-Node privacy half writes raw SQL where
    // nothing quotes for it.
    const dashed = {
      id: "acme-crm",
      tables: ["acme_crm_leads"],
      migrationsTable: "__drizzle_migrations_acme_crm",
      tablePrefix: "acme_crm_",
    };
    expect(
      manifestProblems({ ...broken(dashed), tablePrefix: "acme-crm_" }, WHERE).join(" "),
    ).toMatch(/must start with "acme_crm"/);
    expect(
      manifestProblems(
        { ...broken(dashed), migrationsTable: "__drizzle_migrations_acme-crm" },
        WHERE,
      ).join(" "),
    ).toMatch(/__drizzle_migrations_acme_crm/);
  });

  it("refuses a missing or malformed identity", () => {
    expect(manifestProblems(broken({ id: "Community" }), WHERE).join(" ")).toMatch(/"id"/);
    expect(manifestProblems(broken({ version: "one" }), WHERE).join(" ")).toMatch(/"version"/);
    expect(manifestProblems(broken({ title: { de: "" } }), WHERE).join(" ")).toMatch(/"title"/);
  });

  it("refuses a module that does not say what it is", () => {
    // `module list` is the ONE command that answers "what is this app made of",
    // and before this field it answered with four bare ids. Same bar as a
    // command's `help` line: undiscoverable is the same as unshipped.
    for (const summary of [undefined, "", "a module", "TODO: write this one up properly"]) {
      expect(manifestProblems(broken({ summary }), WHERE).join(" "), String(summary))
        .toMatch(/"summary"/);
    }
  });

  it("refuses a module that does not say where the full story is", () => {
    // The one line `summary` prints is the hook; `docs` is where the reader
    // goes next, and every one of the four modules already had a page nothing
    // named. `.claude/skills/` is optional — a module may be a seam with no
    // playbook of its own — but a page is not.
    for (const docs of [undefined, "", "community.md", "modules/community/README.md", "docs/x.txt"]) {
      expect(manifestProblems(broken({ docs }), WHERE).join(" "), String(docs)).toMatch(/"docs"/);
    }
    expect(manifestProblems(broken({ skill: undefined }), WHERE)).toEqual([]);
    expect(manifestProblems(broken({ skill: "Community Skill" }), WHERE).join(" "))
      .toMatch(/"skill"/);
  });

  it("keeps the summary to one terminal line", () => {
    // It prints beside the id, so past ~110 characters it wraps into the next
    // module's row and the list stops being readable at a glance.
    expect(manifestProblems(broken({ summary: "a place for members. ".repeat(9) }), WHERE)
      .join(" ")).toMatch(/"summary" is \d+ characters/);
    expect(manifestProblems(broken({ summary: "a place for members,\nand a second line" }), WHERE)
      .join(" ")).toMatch(/"summary"/);
  });

  it("refuses a path that climbs out of the module", () => {
    expect(manifestProblems(broken({ schema: "../../db/schema.ts" }), WHERE).join(" "))
      .toMatch(/relative path inside the module/);
  });

  it("keeps the operator's config in config/", () => {
    expect(manifestProblems(broken({ config: "community.json" }), WHERE).join(" "))
      .toMatch(/config\//);
  });

  it("accepts a declared cross-module dependency", () => {
    // ⚠️ Deliberately NOT a problem, and the first draft had it as one — which
    // made the field undeclarable. A dependency costs the factory's k+2 variant
    // matrix, but refusing it here only pushes it underground as an undeclared
    // cross-module import. `module check` is where the cost is said out loud.
    expect(manifestProblems(broken({ requires: ["chat"] }), WHERE)).toEqual([]);
  });

  it("refuses a module that requires itself", () => {
    expect(manifestProblems(broken({ requires: ["community"] }), WHERE).join(" "))
      .toMatch(/itself/);
  });

  it("collects every problem instead of stopping at the first", () => {
    // Whoever is writing a manifest wants the whole list, not six runs.
    const problems = manifestProblems({ id: "X", version: "no", title: {} }, WHERE);
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });

  it("names the file in every message", () => {
    for (const line of manifestProblems({ id: "X" }, WHERE)) expect(line).toContain(WHERE);
  });
});

// ── A24: the refusals nothing executed ──────────────────────────────────────
//
// 🚨 Measured, not assumed. `say()` was instrumented to write its own call-site
// line for every refusal it produced, the whole vitest suite was run against it,
// and the answer was that **42 of this file's 75 refusals fired and 33 never
// did** — plus the relative-path loop, whose single `say()` counts as executed
// while ten of its thirteen KEYS had never once reached it.
//
// A refusal no test executes is a claim about code nobody has run. It can have
// been broken since the day it was written and every gate here would still be
// green — which is not a hypothetical: Story 42.4 is exactly that finding, found
// once, in the small. The blocks below execute the other 33, one case each,
// through the real validator and against the real message.
//
// ⚠️ The bar is deliberately higher than "the message appears somewhere".
// Where a manifest can be broken in ONE way, the assertion is `toEqual` on the
// whole list — a refusal that fires alongside four others it did not intend is
// not the refusal anybody described. Where a break necessarily trips a second
// rule (`erase: "yes"` is both "not a boolean" and "not true"), the second one
// is named in the comment rather than hidden behind a `toMatch`.

/** The single-problem assertion: this manifest is wrong in exactly this way. */
function onlyProblem(patch: Record<string, unknown>, message: string) {
  expect(manifestProblems(broken(patch), WHERE)).toEqual([`${WHERE}: ${message}`]);
}

describe("A24 — the shape of the whole file is refused before anything is read", () => {
  it("🚨 refuses anything that is not a JSON object at all", () => {
    // The one refusal that is not a `say()` — it returns immediately, because a
    // list of faults found in a number would be a list of the same fault.
    // Nothing had executed it: every other test hands in an object by
    // construction, and `module.json` is only read after `JSON.parse`, which
    // happily returns `null`, `[]` or `42` for a file somebody truncated.
    for (const raw of [null, undefined, 42, "modules/community", true, ["community"]]) {
      expect(manifestProblems(raw, WHERE), JSON.stringify(raw ?? null)).toEqual([
        `${WHERE}: must be a JSON object`,
      ]);
    }
    expect(() => readManifest(null, WHERE)).toThrow(/must be a JSON object/);
  });
});

describe("A24 — every path key is refused for climbing out, not just the three with tests", () => {
  // The loop covers thirteen keys and one `say()`. A test had reached it for
  // exactly three of them (`schema`, `appliers`, `contentSource`), so for the
  // other ten "a module says where things are INSIDE itself" was a sentence in a
  // comment. The refusal is one line of code and the reasoning is identical per
  // key — which is the argument for one line of test per key, not for trusting
  // that a loop tested once is a loop tested.
  //
  // Each value is chosen to trip the path rule and NOTHING else: `cron` ends in
  // `.ts` and `disclosure` in `.mjs` so their runtime checks stay quiet, and
  // `appliers` comes with `"content": "authored"` so it is a transport the
  // module owes rather than one it may not have. That is what makes `toEqual`
  // on a one-element list the right assertion here.
  const PATH_KEYS: Array<[string, string, Record<string, unknown>]> = [
    ["schema", "../../db/schema.ts", {}],
    ["migrations", "../../drizzle", {}],
    ["nav", "../../components/app-shell.tsx", {}],
    ["gate", "../../lib/entitlements/manage.ts", {}],
    ["entry", "../../lib/modules/registry.ts", {}],
    ["smoke", "../../scripts/dev/smoke.mjs", {}],
    ["configDefault", "../../config/community.json", {}],
    ["disclosure", "../../lib/ai/disclosure.mjs", {}],
    ["cron", "../../lib/cron/jobs.ts", {}],
    ["appliers", "../../scripts/content/appliers", { content: "authored" }],
    ["setup", "../../lib/setup/tools.ts", {}],
    ["presence", "../../lib/content/presence.ts", {}],
    ["contentSource", "../../lib/content-source/sources.ts", {}],
  ];

  for (const [key, climbing, extra] of PATH_KEYS) {
    it(`refuses "${key}" pointing outside the module`, () => {
      onlyProblem(
        { ...extra, [key]: climbing },
        `"${key}" must be a relative path inside the module`,
      );
    });
  }

  it("refuses an absolute path and a non-string for every one of them", () => {
    // The other two halves of the same line. Kept as one case because the
    // per-key argument above is about the KEY reaching the rule at all.
    for (const [key, , extra] of PATH_KEYS) {
      for (const value of ["/etc/passwd", 7]) {
        expect(
          manifestProblems(broken({ ...extra, [key]: value }), WHERE).join(" "),
          `${key} = ${JSON.stringify(value)}`,
        ).toMatch(`"${key}" must be a relative path inside the module`);
      }
    }
  });
});

describe("A24 — identity and dependencies", () => {
  it('refuses a "requiresTemplate" that is not a version', () => {
    // The field says which template this module needs. Prose there is a
    // comparison that never happens rather than one that fails.
    for (const value of ["0.19", "neunzehn", 19, null]) {
      expect(manifestProblems(broken({ requiresTemplate: value }), WHERE), String(value)).toEqual([
        `${WHERE}: "requiresTemplate" must look like 0.19.0`,
      ]);
    }
    expect(manifestProblems(broken({ requiresTemplate: "1.2.3-rc.1" }), WHERE)).toEqual([]);
  });

  it('refuses a "requires" that is not a list of ids', () => {
    onlyProblem({ requires: "chat" }, '"requires" must be an array of module ids');
    onlyProblem({ requires: [1] }, '"requires" must be an array of module ids');
  });

  it("names the dependency that is not a module id", () => {
    // A dependency is resolved against a folder name under `modules/`, so
    // "Chat" or "../chat" is a lookup that can only ever miss.
    onlyProblem({ requires: ["Chat"] }, '"requires": "Chat" is not a module id');
    onlyProblem({ requires: ["../chat"] }, '"requires": "../chat" is not a module id');
  });
});

describe("A24 — routes, slots and the two export maps", () => {
  it('refuses an "app" that is not an array of subtrees', () => {
    onlyProblem({ app: "dashboard/community" }, '"app" must be an array of route subtrees');
    onlyProblem({ app: { 0: "dashboard/community" } }, '"app" must be an array of route subtrees');
  });

  it("🚨 refuses a subtree that climbs out from under dashboard/ or api/", () => {
    // The prefix check and this one are two rules, and only the first had ever
    // run. `dashboard/../../secret` clears the prefix check by spelling and
    // then leaves the app tree entirely — which is the case the second rule
    // exists for, and the only one where it fires alone.
    onlyProblem({ app: ["dashboard/../../secret"] }, '"app": "dashboard/../../secret" is not a relative subtree');
    onlyProblem({ app: ["api/x/../../../etc"] }, '"app": "api/x/../../../etc" is not a relative subtree');
    // An absolute path trips BOTH rules, and that is correct: it is neither
    // under `dashboard/` by spelling nor relative.
    const both = manifestProblems(broken({ app: ["/dashboard/community"] }), WHERE);
    expect(both).toHaveLength(2);
    expect(both.join(" ")).toMatch(/is not a relative subtree/);
  });

  it('refuses "slots" that is not a map at all', () => {
    onlyProblem({ slots: ["account"] }, '"slots" must map a slot name to the component file that fills it');
    onlyProblem({ slots: "account" }, '"slots" must map a slot name to the component file that fills it');
  });

  it("refuses a slot name the generated registry could not carry", () => {
    // Only the SHAPE is checked here — whether `account` is a place that exists
    // is the compiler's job. But a name that is not an identifier-ish token
    // cannot become one, so it is refused before the generator writes it.
    onlyProblem({ slots: { Account: "slots/account.tsx" } }, '"slots": "Account" is not a slot name — lower case, letters, digits and dashes');
    onlyProblem({ slots: { "account view": "slots/account.tsx" } }, '"slots": "account view" is not a slot name — lower case, letters, digits and dashes');
  });

  it("refuses a slot filled from outside the module", () => {
    onlyProblem({ slots: { account: "../../components/card.tsx" } }, '"slots": "account" must name a file inside the module');
    onlyProblem({ slots: { account: 42 } }, '"slots": "account" must name a file inside the module');
  });

  it("🚨 refuses a slot file that climbs out AFTER a legal first segment", () => {
    // The needle. `REL` refuses a path that STARTS with a dot, so
    // `../../components/card.tsx` above was never the hole — this is:
    // `slots/../../card.tsx` is spelled entirely in characters `REL` allows and
    // reaches exactly as far out. `components` and `serverExports` have carried
    // the `..` clause since they existed and refuse the same shape
    // (`ui/../../panel.tsx`, `lib/../../run.ts`); `slots` did not, which made
    // the one key that puts a module's component on a page the CORE owns the
    // one key fillable from outside the module.
    onlyProblem({ slots: { account: "slots/../../card.tsx" } }, '"slots": "account" must name a file inside the module');
    onlyProblem({ slots: { account: "components/../../../etc/passwd.tsx" } }, '"slots": "account" must name a file inside the module');
  });

  it("accepts the slot file shape the shipped modules use", () => {
    // The other direction, so the clause above is a discriminator rather than a
    // rule that refuses everything: this is byte for byte what `community` and
    // `api` declare, and both are still valid after the change.
    expect(manifestProblems(broken({ slots: { account: "components/account-card.tsx" } }), WHERE))
      .toEqual([]);
  });

  it('refuses "components" that is not a map at all', () => {
    onlyProblem({ components: ["ActivityPanel"] }, '"components" must map an exported name to the file inside the module that exports it');
    onlyProblem({ components: "ActivityPanel" }, '"components" must map an exported name to the file inside the module that exports it');
  });

  it("🚨 refuses a component name an app's page could not render", () => {
    // This key is what fills `lib/modules/component-registry.ts`, and a page
    // imports from there. A lower-case name would generate an export that is
    // neither a component nor a hook — valid TypeScript, nothing to render.
    // ⚠️ `Use` and `ACTIVITY` are deliberately NOT in this list: both match the
    // PascalCase half and are accepted. The rule is "starts with a capital, or
    // is `use` followed by one" — not "is a name somebody would write".
    for (const name of ["activityPanel", "activity_panel", "use", "useactivity", "_Panel"]) {
      expect(
        manifestProblems(broken({ components: { [name]: "ui/panel.tsx" } }), WHERE),
        name,
      ).toEqual([
        `${WHERE}: "components": "${name}" is neither a component (PascalCase) nor a hook ` +
          "(useSomething) — this key is what an app's own page imports, and it can render neither",
      ]);
    }
    // The accepting half, so the rule above is a discriminator rather than a
    // refusal of everything: a component AND a hook are both legal.
    expect(
      manifestProblems(
        broken({ components: { ActivityPanel: "ui/panel.tsx", useActivity: "ui/use-activity.ts" } }),
        WHERE,
      ),
    ).toEqual([]);
  });

  it("refuses a component file outside the module", () => {
    onlyProblem({ components: { ActivityPanel: "../../components/panel.tsx" } }, '"components": "ActivityPanel" must name a file inside the module');
    onlyProblem({ components: { ActivityPanel: "ui/../../panel.tsx" } }, '"components": "ActivityPanel" must name a file inside the module');
    onlyProblem({ components: { ActivityPanel: null } }, '"components": "ActivityPanel" must name a file inside the module');
  });

  it('refuses "serverExports" that is not a map at all', () => {
    onlyProblem({ serverExports: ["askCompanion"] }, '"serverExports" must map an exported name to the file inside the module that exports it');
    onlyProblem({ serverExports: "askCompanion" }, '"serverExports" must map an exported name to the file inside the module that exports it');
  });

  it("refuses a server export name that is not a plain identifier", () => {
    // The server-side twin of `components`, and deliberately looser — a server
    // export is a function, not a thing React renders — but it still has to be
    // a name the generated barrel can write.
    for (const name of ["ask-companion", "2ask", "ask companion", ""]) {
      expect(
        manifestProblems(broken({ serverExports: { [name]: "companion.ts" } }), WHERE),
        JSON.stringify(name),
      ).toEqual([`${WHERE}: "serverExports": "${name}" is not a plain identifier an app can import`]);
    }
    expect(manifestProblems(broken({ serverExports: { askCompanion: "companion.ts" } }), WHERE))
      .toEqual([]);
  });

  it("refuses a server export from outside the module", () => {
    onlyProblem({ serverExports: { askCompanion: "../../lib/ai/run.ts" } }, '"serverExports": "askCompanion" must name a file inside the module');
    onlyProblem({ serverExports: { askCompanion: "lib/../../run.ts" } }, '"serverExports": "askCompanion" must name a file inside the module');
  });

  it('refuses "publicRoutes" that is not a map at all', () => {
    // A list of urls says nothing about what guards them, which is the only
    // thing this key exists to record.
    onlyProblem({ publicRoutes: ["/api/community/live"] }, '"publicRoutes" must map a url to the sentence saying what guards it');
    onlyProblem({ publicRoutes: "/api/community/live" }, '"publicRoutes" must map a url to the sentence saying what guards it');
  });

  it("refuses a public route that is not a url", () => {
    const guard = "isCommunityEnabled() first, then currentActiveUser() on every answer";
    onlyProblem({ publicRoutes: { "api/community/live": guard } }, '"publicRoutes": "api/community/live" must be a url');
    onlyProblem({ publicRoutes: { "https://example.com/x": guard } }, '"publicRoutes": "https://example.com/x" must be a url');
  });
});

describe("A24 — tables and their prefix", () => {
  it('refuses "tables" that is not a list of names', () => {
    // With no `content` beside it this is the only fault, which is what makes
    // it visible that the whole tables block is skipped rather than half-run.
    onlyProblem({ tables: "community_posts", content: undefined }, '"tables" must be an array of table names');
    onlyProblem({ tables: { 0: "community_posts" }, content: undefined }, '"tables" must be an array of table names');
    // ⚠️ An ARRAY of the wrong thing is a different case, and worth having: it
    // fails `isStringArray` and still enters the tables block, because that
    // block is guarded by `Array.isArray` rather than by the same predicate.
    const numbers = manifestProblems(broken({ tables: [1, 2], content: undefined }), WHERE);
    expect(numbers).toContain(`${WHERE}: "tables" must be an array of table names`);
    expect(numbers.join(" ")).toMatch(/"tables" declared but no "content"/);
  });

  it("refuses a prefix that does not end in an underscore", () => {
    // Without the underscore `community` also matches `communityarchive_x`, and
    // the prefix is how a bare-Node script recognises a module's tables.
    onlyProblem({ tablePrefix: "community" }, '"tablePrefix" must end in an underscore, e.g. "community_"');
    // ⚠️ A non-string trips both this rule and the one below it — there is no
    // prefix at all, so the tables have nothing to be recognised by either.
    const notAString = manifestProblems(broken({ tablePrefix: 7 }), WHERE);
    expect(notAString).toContain(`${WHERE}: "tablePrefix" must end in an underscore, e.g. "community_"`);
    expect(notAString.join(" ")).toMatch(/"tables" without a "tablePrefix"/);
  });

  it("🚨 refuses tables with no prefix to recognise them by", () => {
    // The rule the story names by hand, and nothing had run it: a module with
    // tables and no `tablePrefix` is one whose rows no script can find without
    // importing TypeScript — which is what `remove`, `module check` and the
    // orphan-table sweep all refuse to do.
    onlyProblem(
      { tablePrefix: undefined },
      '"tables" without a "tablePrefix" — the prefix is how a script recognises the ' +
        "module's tables without importing TypeScript",
    );
  });
});

describe("A24 — the shared core a companion repo gets", () => {
  // `coreExport` is how a module contributes files to `node run.mjs
  // export-core`. It exists because the core's own manifest used to name
  // `modules/api/keys/rules.ts`, so an app without the api module still copied
  // that file into its companion repo. Both of its refusals were unexecuted.
  it("refuses a coreExport that is not a non-empty list of paths", () => {
    onlyProblem({ coreExport: [] }, '"coreExport" must be a non-empty array of paths inside the module');
    onlyProblem({ coreExport: "keys/rules.ts" }, '"coreExport" must be a non-empty array of paths inside the module');
    onlyProblem({ coreExport: [7] }, '"coreExport" must be a non-empty array of paths inside the module');
  });

  it("🚨 refuses a coreExport entry that leaves the module", () => {
    // The exported file lands in somebody else's repository. An entry pointing
    // at the core's tree would put a file there that the module does not own
    // and cannot keep in step.
    onlyProblem({ coreExport: ["../../lib/entitlements/rules.ts"] }, '"coreExport" entry "../../lib/entitlements/rules.ts" leaves the module — a module exports its own files');
    onlyProblem({ coreExport: ["/etc/passwd"] }, '"coreExport" entry "/etc/passwd" leaves the module — a module exports its own files');
    // The accepting half.
    expect(manifestProblems(broken({ coreExport: ["keys/rules.ts", "lib/shape.ts"] }), WHERE))
      .toEqual([]);
  });
});

describe("A24 — texts and error codes", () => {
  it('refuses a "messages" block that is not { namespaces, dir }', () => {
    for (const messages of [
      { dir: "messages" },
      { namespaces: [], dir: "messages" },
      { namespaces: ["community"] },
      { namespaces: "community", dir: "messages" },
      "messages",
      ["community"],
    ]) {
      expect(manifestProblems(broken({ messages }), WHERE), JSON.stringify(messages)).toContain(
        `${WHERE}: "messages" must be { namespaces: [...], dir: "messages" }`,
      );
    }
    // ⚠️ A missing `dir` is one problem; an unusable `namespaces` is two, and
    // the second is not noise. `privacy.accountNotes` is checked against the
    // namespaces this module DECLARES rather than against its id, so a module
    // whose text layer cannot say what it owns cannot ship the account page's
    // two sentences either. That coupling is what keeps the two answers from
    // drifting, and it deserves to be executed rather than described.
    expect(manifestProblems(broken({ messages: { namespaces: ["community"] } }), WHERE))
      .toHaveLength(1);
    expect(manifestProblems(broken({ messages: { dir: "messages" } }), WHERE).join(" "))
      .toMatch(/namespace this module declares/);
  });

  it('refuses an "errorCodes" block that does not name both halves', () => {
    // The generator imports the union BY NAME out of the file, so half a
    // declaration is an import that cannot be written.
    for (const errorCodes of [
      { source: "rules.ts" },
      { export: "COMMUNITY_ERROR_CODES" },
      { source: "rules.ts", export: 7 },
      "rules.ts",
      ["rules.ts", "COMMUNITY_ERROR_CODES"],
    ]) {
      expect(manifestProblems(broken({ errorCodes }), WHERE), JSON.stringify(errorCodes)).toEqual([
        `${WHERE}: "errorCodes" must be { source, export } naming the file and the exported union`,
      ]);
    }
  });

  it('refuses "features" and "navAreas" that are not arrays', () => {
    onlyProblem({ features: "community" }, '"features" must be an array');
    onlyProblem({ features: [1] }, '"features" must be an array');
    onlyProblem({ navAreas: "community" }, '"navAreas" must be an array');
    onlyProblem({ navAreas: { community: true } }, '"navAreas" must be an array');
  });
});

describe("A24 — the scheduler: cron and cronJobs, both or neither", () => {
  // 🚨 All four of these were unexecuted, and this is the one area of the file
  // whose history says what that costs: `cronJobs` used to be accepted ALONE.
  // It validated, `module list` printed it, and the session greeting was even
  // taught to keep quiet about it — while nothing registered the job and it
  // could never run. Three readers honouring a promise no executor kept.
  it("refuses cronJobs that is not a list of names", () => {
    // ⚠️ Two problems by construction: a `cronJobs` that is not a string array
    // is also, to the rule below, a `cron` with no names beside it.
    const problems = manifestProblems(broken({ cronJobs: "community-prune" }), WHERE);
    expect(problems).toContain(`${WHERE}: "cronJobs" must be an array`);
    expect(problems.join(" ")).toMatch(/"cron" without "cronJobs"/);
  });

  it("insists the job bodies are .ts — they run inside the app", () => {
    // `lib/cron/jobs.ts` is imported by the app, where the database and the
    // mail transport are. A `.mjs` there is a file the bundler never sees.
    onlyProblem({ cron: "cron.mjs" }, '"cron" must be a .ts file — the job bodies run inside the app, where the database and the mail transport are (see lib/cron/jobs.ts)');
    onlyProblem({ cron: "cron.js" }, '"cron" must be a .ts file — the job bodies run inside the app, where the database and the mail transport are (see lib/cron/jobs.ts)');
  });

  it("refuses bodies with no names beside them", () => {
    // `lib/cron/config.ts` and the bare-Node scripts read the NAMES without
    // being able to load the bodies, so the names cannot be derived from them.
    onlyProblem(
      { cronJobs: undefined },
      '"cron" without "cronJobs" — the ids have to be declared too, because ' +
        "lib/cron/config.ts and scripts/ read the names without being able to load the " +
        "bodies. lib/cron/rules.test.ts holds the two to each other",
    );
  });

  it("🚨 refuses names with no bodies behind them — the trap this rule was written for", () => {
    onlyProblem(
      { cron: undefined },
      '"cronJobs" without "cron" — nothing would register these jobs, so they ' +
        "would be validated here, printed by `module list`, excluded from the greeting's " +
        'reminder, and never run. Point "cron" at the file whose default export is them',
    );
  });
});

describe("A24 — erase and the commands map", () => {
  it('refuses an "erase" that is not a boolean', () => {
    // ⚠️ Two problems: anything that is not `true` is also a module with tables
    // that has not promised `eraseFor()`. Both are the truth about `"yes"`.
    for (const erase of ["yes", 1, null, {}]) {
      const problems = manifestProblems(broken({ erase }), WHERE);
      expect(problems, JSON.stringify(erase)).toContain(`${WHERE}: "erase" must be true or false`);
      expect(problems.join(" "), JSON.stringify(erase)).toMatch(/must export eraseFor\(\)/);
    }
    // `false` IS a boolean, so only the tables rule fires — which is the line
    // that tells the two refusals apart.
    expect(manifestProblems(broken({ erase: false }), WHERE)).toHaveLength(1);
  });

  it('refuses a "commands" block that is not a map', () => {
    onlyProblem({ commands: ["community-prune"] }, '"commands" must map a command name to { script, help }');
    onlyProblem({ commands: "community-prune" }, '"commands" must map a command name to { script, help }');
  });

  it("refuses a command entry that is not { script, help }", () => {
    // It stops at the entry rather than going on to read `script` and `help`
    // off a string — so this refusal is the ONLY one, and that is the property
    // worth pinning: one fault, one message, not three about missing fields.
    onlyProblem({ commands: { "community-x": "scripts/prune.mjs" } }, '"commands": "community-x" must be { script, help }');
    onlyProblem({ commands: { "community-x": ["scripts/prune.mjs"] } }, '"commands": "community-x" must be { script, help }');
    onlyProblem({ commands: { "community-x": null } }, '"commands": "community-x" must be { script, help }');
  });
});

describe("every manifest on disk is coherent", () => {
  // Vacuous today by construction — no module exists. It is here so the first
  // module that lands is checked the moment it lands, and the count below says
  // out loud how many were examined so a reader is never misled by a green tick.
  const dir = path.join(ROOT, "modules");
  let ids: string[] = [];
  try {
    ids = readdirSync(dir).filter((e) => statSync(path.join(dir, e)).isDirectory());
  } catch {
    /* no modules/ folder yet */
  }

  it(`checks the ${ids.length} module(s) that exist`, () => {
    for (const id of ids) {
      const file = path.join(dir, id, "module.json");
      const raw = JSON.parse(readFileSync(file, "utf8"));
      expect(manifestProblems(raw, `modules/${id}/module.json`), id).toEqual([]);
      expect(raw.id, `modules/${id}/module.json declares a different id`).toBe(id);
    }
  });

  // 🚨 `manifestProblems()` is pure — it can check that `docs` looks like a path
  // and cannot check that anything is there. A pointer `module list` prints to
  // somebody who has just learned a module exists is worse than no pointer at
  // all when it dangles, and the way it dangles is a rename in `docs/`, which
  // touches nothing under `modules/` and so breaks nothing else in the tree.
  it("opens every page and skill a manifest points at", () => {
    expect(ids.length, "no manifests examined — this test would be vacuous").toBeGreaterThan(0);
    for (const id of ids) {
      const raw = JSON.parse(readFileSync(path.join(dir, id, "module.json"), "utf8"));
      expect(existsSync(path.join(ROOT, raw.docs)), `"${id}" points at ${raw.docs}`).toBe(true);
      if (raw.skill !== undefined) {
        const skill = path.join(ROOT, ".claude", "skills", raw.skill, "SKILL.md");
        expect(existsSync(skill), `"${id}" points at the skill "${raw.skill}"`).toBe(true);
      }
    }
  });
});
