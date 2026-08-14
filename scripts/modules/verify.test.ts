// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `module verify` — could this app install that folder?
//
// Every case here builds a candidate in a throwaway directory, because the
// question is about a module that is NOT in the tree yet. That is the whole
// point of the command: the suite's own module checks walk `availableModules()`
// and therefore cannot be asked about a folder nobody has copied in.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { verifyProblems } from "./verify.mjs";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The smallest manifest that clears every rule. */
const tiny = (extra: Record<string, unknown> = {}) => ({
  id: "acme-crm",
  version: "1.0.0",
  title: { de: "Acme CRM", en: "Acme CRM" },
  summary: "a fixture module, present only so this test has something to read",
  docs: "modules/acme-crm/docs.md",
  ...extra,
});

/** A candidate folder holding `manifest` plus the given extra files. */
function candidate(manifest: unknown, files: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ds24-verify-"));
  dirs.push(dir);
  writeFileSync(join(dir, "module.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, "docs.md"), "# Acme CRM\n");
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

const problems = (manifest: unknown, files?: Record<string, string>) =>
  verifyProblems({ id: "acme-crm", dir: candidate(manifest, files) });

describe("a candidate this app could install", () => {
  it("has nothing to say about a coherent one", () => {
    expect(problems(tiny())).toEqual([]);
  });

  it("is not vacuous — a broken manifest still comes back with its reasons", () => {
    // Without this, every assertion here could be passing because the function
    // returns an empty array for anything at all.
    expect(problems(tiny({ version: "one" })).join(" ")).toMatch(/"version"/);
  });
});

describe("🚨 every file the manifest names is really there", () => {
  // The check nothing else makes. `manifestProblems()` is pure: it can say a
  // path LOOKS like a path and can never say anything is at the end of it. For
  // an archive that unpacked short, this is the difference between a refusal
  // and a build error three commands later.
  it("names the key and the path that dangles", () => {
    const found = problems(tiny({ nav: "nav.ts" }));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/"nav" names nav\.ts, which is not in the module/);
  });

  it("says nothing once the file is there", () => {
    expect(problems(tiny({ nav: "nav.ts" }), { "nav.ts": "export default {};\n" })).toEqual([]);
  });

  it("looks inside the groups too, not only the single-path keys", () => {
    const found = problems(tiny({ components: { AcmeCrmPanel: "components/panel.tsx" } }));
    expect(found.join(" ")).toMatch(/"components"\."AcmeCrmPanel" names components\/panel\.tsx/);
  });

  it("follows a docs path that points INTO the module", () => {
    // The form a module from outside uses. Ours point at `docs/<x>.md` in the
    // core tree, and this candidate has no core tree to point at.
    const found = problems(tiny({ docs: "modules/acme-crm/handbook.md" }));
    expect(found.join(" ")).toMatch(/"docs" names modules\/acme-crm\/handbook\.md/);
  });
});

describe("the arrangement it would join", () => {
  it("🚨 refuses a table one of this app's own modules already owns", () => {
    // `community` is in the tree of this template, so a candidate claiming
    // `community_posts` collides with a real manifest rather than a fixture.
    const found = problems(
      tiny({
        schema: "schema.ts",
        tables: ["acme_crm_posts", "community_posts"],
        tablePrefix: "",
        migrations: "drizzle",
        migrationsTable: "__drizzle_migrations_acme_crm",
      }),
    );
    expect(found.join(" ")).toMatch(/a table "community_posts" is claimed by both/);
  });
});

describe("packages the host would not install", () => {
  it("🚨 refuses an import this app does not depend on", () => {
    // `npm ci` installs package.json and nothing else, so a module importing a
    // package nobody added builds here and dies on the host.
    const found = problems(tiny({ entry: "module.ts" }), {
      "module.ts": 'import { hoist } from "left-pad";\nexport default { hoist };\n',
    });
    expect(found.join(" ")).toMatch(/imports "left-pad"/);
  });

  it("says nothing about a package that IS a dependency", () => {
    expect(
      problems(tiny({ entry: "module.ts" }), {
        "module.ts": 'import { eq } from "drizzle-orm";\nexport default { eq };\n',
      }),
    ).toEqual([]);
  });

  it("says nothing about node: builtins or the app's own aliases", () => {
    expect(
      problems(tiny({ entry: "module.ts" }), {
        "module.ts":
          'import { join } from "node:path";\nimport { db } from "@/db";\n' +
          'import x from "./local.ts";\nexport default { join, db, x };\n',
        "local.ts": "export default 1;\n",
      }),
    ).toEqual([]);
  });

  it("⚠️ reads only real import lines, never a quoted one in a test", () => {
    // Measured before this was anchored: a bare `/from\s+"([^"]+)"/` over
    // `modules/community` reported the app depending on packages called `" + "`
    // and `\.\` — matches out of the middle of string literals in the module's
    // own tests. A checker that punishes a file for what it QUOTES is the same
    // mistake `blankComments()` exists for, one level down.
    expect(
      problems(tiny({ entry: "module.ts" }), {
        "module.ts":
          'export const sql = `select from "left-pad"`;\n' +
          'export const note = \'import "nonesuch"\';\n',
      }),
    ).toEqual([]);
  });
});
