// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 One writer per row class (spine AD-82).
//
// Rows reach an environment two ways now: a repo file plus an applier
// (`content-apply`), and the operator's agent through the setup surface. Two
// LAWFUL ways to create the same row is the fault this guards — they drift, and
// the drift is invisible until an environment holds both shapes.
//
// The rule is stated on row CLASSES rather than tables because of one real
// case, and that case is asserted below.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/scripts/lib/source-text.mjs";
import { CONTENT_MEDIA_BUCKET_PREFIX } from "@/lib/content-media/rules.mjs";

const ROOT = process.cwd();
const MODULES = join(ROOT, "modules");

describe("media is partitioned, because it is the one table with two writers", () => {
  // The applier route places product media at the deterministic key
  // `content/<topic>/<file>`; everything a member or an operator uploads gets a
  // key from `storageKey()`. That prefix IS the discriminator, and these two
  // assertions are what keep it one.

  it("the applier side owns exactly the content/ prefix", () => {
    // This used to pin a `content/${…}` template literal in that file. The
    // literal was a SECOND spelling of a prefix `lib/content-media/rules.mjs`
    // already defines, in the one file that was also reading a manifest key no
    // producer writes — so the key is now composed from the constant, and the
    // assertion follows it there. That is strictly more than the literal
    // proved: the prefix's VALUE is checked at its source, and its use is
    // checked here, where two spellings can no longer disagree.
    expect(CONTENT_MEDIA_BUCKET_PREFIX, "the applier's key prefix moved").toBe("content/");

    const presence = blankComments(
      readFileSync(join(ROOT, "lib/content/media-presence.ts"), "utf8"),
    );
    expect(presence, "the content/ prefix is no longer the applier's key").toContain(
      "CONTENT_MEDIA_BUCKET_PREFIX + path",
    );
  });

  it("the applier route's SECOND holder of that prefix is held to the same spelling", () => {
    // `lib/content/publish.ts` is the writer of the applier route's own media
    // rows — the half of this partition that `content-apply` fills from a shell
    // and `content_publish` now fills from inside the running app. An entry here
    // is a rule that gets CHECKED, never an exemption, so the rule is:
    //
    //   it composes its key through `keyFor()` in `scripts/content/_manifest.mjs`
    //   — which is `CONTENT_MEDIA_BUCKET_PREFIX + path` and is the spelling the
    //   CLI's own `mediaIdFor()` uses — and never through `storageKey()`.
    //
    // ⚠️ That is deliberately stricter than "contains the constant". Two
    // spellings of one prefix cannot disagree if there is only one function, and
    // the app-side and the shell-side then resolve the same path to the same key
    // by CONSTRUCTION rather than by agreement. `keyFor()`'s own value is pinned
    // by the assertion above, at its source.
    const publish = blankComments(readFileSync(join(ROOT, "lib/content/publish.ts"), "utf8"));

    expect(
      publish,
      "lib/content/publish.ts no longer imports keyFor() from the manifest reader — if it now " +
        "composes the key itself, the app-side and the CLI-side can drift, and a lesson would " +
        "resolve to a media row in one and to nothing in the other.",
    ).toMatch(/import \{ keyFor \} from "@\/scripts\/content\/_manifest\.mjs"/);

    expect(
      /["'`]content\//.test(publish),
      "lib/content/publish.ts carries a literal content/ prefix. That is a THIRD spelling of " +
        "something `lib/content-media/rules.mjs` defines once and `keyFor()` composes — and the " +
        "one nobody is looking at is the one that goes wrong.",
    ).toBe(false);

    expect(
      /\bstorageKey\s*\(/.test(publish),
      "lib/content/publish.ts builds a key through storageKey(). That function DERIVES an " +
        "upload's key from its row id, and it THROWS on the reserved `content` namespace — this " +
        "writer is on the other side of the partition by construction (lib/media/rules.ts, " +
        "RESERVED_MEDIA_NAMESPACES). Reaching for it is how two writers become one.",
    ).toBe(false);
  });

  it("the setup surface's content-media pair reaches that prefix ONE way", () => {
    // Story 34.4. `content_media_url` mints an address for a declared file's
    // content key and `content_media_confirm` reads back what landed there, so
    // `lib/setup/tools.ts` — which is the FIRST entry on the upload-door list
    // below — now also composes a key on the applier route's own prefix. That
    // makes it the third file in this partition and it is held to the same
    // rule as the second:
    //
    //   it composes the key through `keyFor()` in `scripts/content/_manifest.mjs`
    //   — which is `CONTENT_MEDIA_BUCKET_PREFIX + path` — and never through
    //   `storageKey()`, which THROWS on the reserved `content` namespace
    //   because the upload route's key space is the other half of this
    //   partition.
    //
    // ⚠️ The two claims are not the same claim, and both are needed. The door
    // list below already asserts that this file hands the media layer no
    // `storageKey:`; that is about UPLOADS. This is about the second thing the
    // file now does — build a content key of its own — and the failure it
    // prevents is a literal `"content/" + path` drifting from `keyFor()`, at
    // which point a lesson resolves to a media row through one spelling and the
    // object sits under the other.
    const tools = blankComments(readFileSync(join(ROOT, "lib/setup/tools.ts"), "utf8"));

    expect(
      tools,
      "lib/setup/tools.ts no longer imports keyFor() from the manifest reader — if it now " +
        "composes the content key itself, the tool and the applier can disagree about where a " +
        "declared file lives, and content-check would call a file present that no lesson can " +
        "resolve.",
    ).toMatch(/import \{ keyFor(, loadManifest)? \} from "@\/scripts\/content\/_manifest\.mjs"/);

    expect(
      /["'`]content\//.test(tools),
      "lib/setup/tools.ts carries a literal content/ prefix. That is a spelling of something " +
        "`lib/content-media/rules.mjs` defines once and `keyFor()` composes — and the one " +
        "nobody is looking at is the one that goes wrong.",
    ).toBe(false);

    expect(
      /\bstorageKey\s*\(/.test(tools),
      "lib/setup/tools.ts builds a key through storageKey(). That function DERIVES an upload's " +
        "key from its row id and THROWS on the reserved `content` namespace — the content-media " +
        "tools are on the other side of the partition by construction (lib/media/rules.ts, " +
        "RESERVED_MEDIA_NAMESPACES). Reaching for it is how two writers become one.",
    ).toBe(false);

    // And the row itself is still written on the applier route's side. A media
    // insert in an upload door spells `storageKey:`, which the door list below
    // fails the build on — so the tool is a thin caller and the writer stays in
    // `lib/content/publish.ts`, beside the bulk one.
    expect(
      tools,
      "lib/setup/tools.ts no longer calls assertContentMediaRow() — if it now writes the media " +
        "row itself, the applier route has two writers instead of one.",
    ).toContain("assertContentMediaRow");
    expect(
      /insert\s+into\s+media/i.test(tools),
      "lib/setup/tools.ts inserts into `media` directly. That row belongs to the applier " +
        "route's writer (lib/content/publish.ts) — an upload door that writes it is the second " +
        "lawful writer of one row class.",
    ).toBe(false);
  });

  it("an upload can never land on that prefix", () => {
    // `storageKey()` builds every uploaded object's key. If it ever produced a
    // `content/`-prefixed one, an operator's upload would be indistinguishable
    // from declared product media — and `content-check` would report a file as
    // present that no manifest names.
    const rules = blankComments(readFileSync(join(ROOT, "lib/media/rules.ts"), "utf8"));
    const manage = blankComments(readFileSync(join(ROOT, "lib/media/manage.ts"), "utf8"));
    for (const [name, source] of [
      ["lib/media/rules.ts", rules],
      ["lib/media/manage.ts", manage],
    ] as const) {
      expect(
        /["'`]content\//.test(source),
        `${name} builds a key on the content/ prefix. That prefix belongs to the applier ` +
          `route; an upload landing there makes the two writers indistinguishable.`,
      ).toBe(false);
    }
  });

  it("no upload door hands a storage key at all", () => {
    // Each of these hands bytes or a claim to the media layer, which decides
    // the key. A door that could choose one could choose `content/…`, and its
    // upload would then be indistinguishable from declared product media. The
    // courses door is here because it is the first one that stores the PRODUCT
    // rather than somebody's own file — which is exactly the sort of upload a
    // `content/` key would be a plausible-looking mistake for.
    //
    // ⚠️ **Each door names the function it enters, rather than the list
    // assuming one.** It used to assume `acceptUpload()`, which was true while
    // every upload travelled through the app. The direct-to-bucket path
    // (Story 8.1) enters `createUploadTicket()` and `confirmUpload()` instead —
    // and on that path the key exists BEFORE the row, which is precisely the
    // arrangement this assertion has to keep honest. A door added with the
    // wrong entry name fails the first expectation rather than passing the
    // second vacuously.
    const doors = [
      { file: "lib/setup/tools.ts", enters: /acceptUpload\(/ },
      { file: "modules/courses/admin/media-actions.ts", enters: /acceptUpload\(/ },
      { file: "app/api/media/upload-url/route.ts", enters: /createUploadTicket\(/ },
      { file: "app/api/media/confirm/route.ts", enters: /confirmUpload\(/ },
      // The course's video slot (Story 8.2) — the same two halves as the two
      // routes above, but behind `requireOwner()` because a lesson recording is
      // `entitled` and the HTTP door pins `owner`. Three entries for one file,
      // one per function it enters: the direct path is precisely where the key
      // exists BEFORE the row, so it is where a supplied one would be plausible.
      { file: "modules/courses/admin/media-actions.ts", enters: /createUploadTicket\(/ },
      { file: "modules/courses/admin/media-actions.ts", enters: /confirmUpload\(/ },
    ] as const;

    for (const { file, enters } of doors) {
      const source = blankComments(readFileSync(join(ROOT, file), "utf8"));
      expect(source, `${file}: no ${enters.source} call found — has the door moved?`).toMatch(
        enters,
      );
      expect(
        source,
        `${file} hands a storage key to the media layer. The key is DERIVED from the row's own ` +
          `id (\`storageKey()\`) and never supplied — a supplied one is a path traversal, a ` +
          `collision, or a landing on the applier's content/ prefix.`,
      ).not.toMatch(/storageKey\s*:/);
    }
  });
});

describe("no module writes one row class from both routes", () => {
  // ⚠️ A tripwire, and it has fired once. `courses` declares both, and the
  // decision it forced is recorded in `PARTITIONED` below — the guard did
  // exactly its job: the second lawful writer was about to exist by accident.
  //
  // What to do when it fires is in the message, and it is not "delete one":
  // both routes are legitimate, so the module has to say which rows belong to
  // which, the way `media` does with a key prefix.

  /**
   * Modules that declare both, with the discriminator each one settled on.
   *
   * 🚨 An entry here is NOT an exemption — it names a rule, and the rule is
   * asserted below. Adding a module without one is how this guard becomes an
   * allowlist, which is how it stops guarding.
   */
  const PARTITIONED: Record<string, string> = {
    courses:
      "blocks and lessons are split by their `origin` column. The APPLIER owns every " +
      "origin = 'content' row, keyed by slug from content/course/*.json, and each of its " +
      "`on conflict` clauses carries `where courses_*.origin = 'content'` so it cannot reach " +
      "the other half. A content file claiming a slug an operator row holds makes the whole " +
      "run REFUSE, naming slug and file — writing around such a row would graft repo content " +
      "onto a row no deploy carries. The operator's admin surface owns origin = 'operator': " +
      "rows made in ONE environment, which travel with no deploy and which no applier touches. " +
      "An operator row's four MEDIA slots are filled the same way — through that surface's own " +
      "upload door, which stores the bytes through acceptUpload() and therefore gets a key " +
      "DERIVED from the media row's id, never the applier's content/ prefix; the door is " +
      "asserted above beside the setup tool's. The setup tools still only read.",
  };
  const ids = (() => {
    try {
      return readdirSync(MODULES, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  })();

  it("finds modules at all", () => {
    expect(ids.length).toBeGreaterThan(0);
  });

  for (const id of ids) {
    const file = join(MODULES, id, "module.json");
    if (!existsSync(file)) continue;
    const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

    it(`${id} does not bring both an applier and a setup tool undeclared`, () => {
      const both =
        typeof manifest.appliers === "string" && typeof manifest.setup === "string";
      if (both && id in PARTITIONED) return; // its rule is asserted below
      expect(
        both,
        `"${id}" declares BOTH "appliers" and "setup". Both are lawful ways for rows to ` +
          `reach an environment, and that is exactly why a row class must belong to one ` +
          `of them: two ways to create the same row drift, and nothing downstream can ` +
          `tell. Say in the module's own docs which rows each route owns — the way ` +
          `\`media\` does it with the content/ key prefix — and add the module here with ` +
          `that discriminator named. See the spine's AD-82.`,
      ).toBe(false);
    });
  }

  it("🚨 every partitioned module declares itself `\"content\": \"authored\"`", () => {
    // Story 36.1 made the manifest able to say whose a module's rows are, and
    // the obvious move was to DERIVE `PARTITIONED` from it — only an
    // `"authored"` module may declare `appliers` at all, so the set of modules
    // that can declare both is now computable.
    //
    // ⚠️ It was not derived, deliberately. What this list carries is not the
    // membership — it is the DISCRIMINATOR SENTENCE beside each entry, the
    // written rule the three assertions below check `courses` against. That
    // sentence is not in the manifest and must not move there: `module.json` is
    // read by four kinds of consumer and none of them can act on a paragraph.
    // Deriving the set would have replaced a rule that gets checked with a
    // membership that does not, which is precisely the trade the comment above
    // `PARTITIONED` refuses.
    //
    // So the list stays and the declaration CROSS-CHECKS it: an entry here is a
    // module that writes rows from the repo, and the manifest now has to say
    // so. The two can no longer drift in silence.
    for (const id of Object.keys(PARTITIONED)) {
      const manifest = JSON.parse(
        readFileSync(join(MODULES, id, "module.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(
        manifest.content,
        `"${id}" is partitioned here — it owns a class of rows that reach an environment through ` +
          `an applier — but its manifest does not declare \`"content": "authored"\`. Either the ` +
          `module stopped bringing its own rows (then it belongs out of this list), or the ` +
          `manifest is now saying something its appliers contradict.`,
      ).toBe("authored");
    }
  });

  it("🚨 no module's SETUP surface mutates", () => {
    // Half of the discriminator, held mechanically rather than on trust: no
    // module in `PARTITIONED` writes rows through the tools an agent drives.
    // That used to be the whole rule ("the applier writes, the setup surface
    // reads") — it is not any more. `courses` now partitions by a column, and
    // the half this test cannot see, the applier keeping to its own side, has
    // its own assertion below. A module that partitions differently again needs
    // one of its own beside them, never a bigger allowlist.
    expect(Object.keys(PARTITIONED).length).toBeGreaterThan(0);

    for (const [id, rule] of Object.entries(PARTITIONED)) {
      const file = join(MODULES, id, "module.json");
      expect(existsSync(file), `${id} is partitioned here but is not a module`).toBe(true);
      const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

      const tools = blankComments(
        readFileSync(join(MODULES, id, String(manifest.setup)), "utf8"),
      );
      expect(
        tools,
        `"${id}" ships a setup tool that MUTATES, and its rule says otherwise:\n  ${rule}\n` +
          `Two lawful writers for one row class drift, and here the drift has a ` +
          `direction — content-apply re-asserts on every run, so the tool's write ` +
          `disappears at the next deploy with nothing to read about why.`,
      ).not.toMatch(/mutates:\s*true/);
    }
  });

  it("🚨 the courses APPLIER stays on its own side of the column", () => {
    // The other half of `courses`' rule, and the half that decides whether the
    // partition is real. A `do update` without the origin condition would
    // overwrite an operator-authored row on the next `content-apply` — silently,
    // because an upsert that matched nothing succeeds just the same. So every
    // `on conflict` in that file is required to carry it, by reading the file.
    //
    // Through `blankComments()`, like every source scan here: without it the
    // comment explaining the rule would be what satisfies the rule.
    const applier = blankComments(
      readFileSync(join(MODULES, "courses", "content", "appliers", "course.mjs"), "utf8"),
    );

    const chunks = applier.split("on conflict");
    expect(
      chunks.length - 1,
      "modules/courses/content/appliers/course.mjs has no `on conflict` at all — either the " +
        "applier stopped upserting, or this scan is looking at the wrong file. Both make the " +
        "check below vacuous, which is how a guard goes green by finding nothing.",
    ).toBeGreaterThan(0);

    for (const chunk of chunks.slice(1)) {
      expect(
        chunk,
        `modules/courses/content/appliers/course.mjs has an \`on conflict\` with no ` +
          `\`where courses_*.origin = 'content'\`. That upsert can overwrite a row the operator ` +
          `authored on the admin surface — and it does so QUIETLY, because an upsert matching no ` +
          `row still succeeds. The rule this breaks:\n  ${PARTITIONED.courses}`,
      ).toMatch(/where\s+courses_\w+\.origin\s*=\s*'content'/);
    }
  });

  it("🚨 the courses ADMIN surface stays on ITS own side of the column", () => {
    // The other half of `courses`' rule, and the half that only became
    // assertable once the surface could write. The entry above claims the
    // operator's page owns `origin = 'operator'`; an entry here names a rule
    // that gets CHECKED, never an exemption, so the claim needs the same
    // treatment the applier's got.
    //
    // Two properties, one per direction:
    //
    //   * every INSERT sets `origin` explicitly. The column's
    //     `default 'content'` belongs to the migration — it backfills rows that
    //     really did come through the applier. A writer leaning on it would
    //     produce rows nothing can tell apart, and the next `content-apply`
    //     would then own them.
    //   * every UPDATE and DELETE carries `origin` in its `where`. The action
    //     already refused a content row with a sentence naming its file; this
    //     is what a caller who skipped that runs into — hitting NOTHING rather
    //     than the wrong row.
    const manage = blankComments(
      readFileSync(join(MODULES, "courses", "lib", "manage.ts"), "utf8"),
    );

    const functions = manage
      .split(/export\s+async\s+function\s+/)
      .slice(1)
      .map((chunk) => ({ name: chunk.slice(0, chunk.indexOf("(")).trim(), body: chunk }));

    const inserts = functions.filter(({ body }) => /\.insert\(courses(Blocks|Units)\)/.test(body));
    const mutations = functions.filter(({ body }) =>
      /\.(update|delete)\(courses(Blocks|Units)\)/.test(body),
    );

    expect(
      inserts.length + mutations.length,
      "modules/courses/lib/manage.ts writes neither courses_blocks nor courses_units — either the " +
        "admin surface stopped writing, or this scan is looking at the wrong file. Both make the " +
        "checks below vacuous, which is how a guard goes green by finding nothing.",
    ).toBeGreaterThan(0);

    for (const { name, body } of inserts) {
      expect(
        body,
        `modules/courses/lib/manage.ts → ${name}() inserts into a partitioned table without ` +
          `setting \`origin\`. The column's default is 'content', so the row would come out ` +
          `belonging to the APPLIER — and the next content-apply would assert it. The rule this ` +
          `breaks:\n  ${PARTITIONED.courses}`,
      ).toMatch(/origin:\s*"operator"/);
    }

    for (const { name, body } of mutations) {
      expect(
        body,
        `modules/courses/lib/manage.ts → ${name}() updates or deletes a partitioned table with ` +
          `no \`origin\` condition. That statement can reach a row a content file owns, which ` +
          `the operator's surface may never touch. The rule this breaks:\n  ${PARTITIONED.courses}`,
      ).toMatch(/eq\(courses(Blocks|Units)\.origin,\s*"operator"\)/);
    }
  });
});
