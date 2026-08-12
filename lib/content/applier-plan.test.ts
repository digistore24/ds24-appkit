// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The plan walker, measured where it can be measured — and the needle that
// decides whether "read-only" is a mechanism or a sentence.
//
// Three things this file is careful about, each because the obvious version of
// the test would be vacuous:
//
//   · The appliers are REAL files on disk, imported by the real dynamic import
//     through the real enumerator (`scripts/content/_appliers.mjs`). Handing the
//     walker a list of fake modules would test the aggregation and nothing that
//     has ever broken.
//   · The `sql` handle is a fake that behaves like Postgres in a read-only
//     transaction: it refuses a write with the sentence Postgres uses. That
//     proves the plumbing — the flag goes out FIRST, the refusal becomes that
//     applier's problem, the walk carries on. Whether Postgres really enforces
//     it is measured against a real database, and is written into the story's
//     Verification section.
//   · `@/db` is mocked away. The walker imports `applierSql` at module scope,
//     and a driver built for a test that never queries is weight for nothing.
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveImport } from "@/scripts/lib/import-graph.mjs";
import { blankComments } from "@/scripts/lib/source-text.mjs";

vi.mock("@/db", () => ({ applierSql: {} }));

const { applierPlans, capSubjects, normalisePlan, SUBJECTS_CAP } = await import("./applier-plan");
type PlanSql = NonNullable<NonNullable<Parameters<typeof applierPlans>[0]>["sql"]>;

// ── a fake postgres that keeps a read-only transaction's promise ────────────

/**
 * `begin()`, a tagged template, and Postgres's own refusal for a write.
 *
 * `answers` is a queue: a query the walker gains without this test gaining an
 * answer for it comes back empty rather than being absorbed silently, and the
 * recorded `statements` are what the assertions read.
 */
function fakeSql(answers: Record<string, unknown>[][] = []) {
  const statements: string[] = [];
  const transactions: { readOnlyFirst: boolean; committed: boolean }[] = [];
  const queue = [...answers];

  const sql: PlanSql = {
    async begin<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      const record = { readOnlyFirst: false, committed: false };
      transactions.push(record);
      let first = true;
      let readOnly = false;

      const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
        void values;
        const text = strings.raw.join("?").replace(/\s+/g, " ").trim();
        statements.push(text);
        if (first) {
          record.readOnlyFirst = text === "set transaction read only";
          first = false;
        }
        if (text === "set transaction read only") {
          readOnly = true;
          return Promise.resolve([]);
        }
        const write = /^(insert|update|delete|truncate)\b/i.exec(text);
        if (readOnly && write) {
          return Promise.reject(
            new Error(`cannot execute ${write[1].toUpperCase()} in a read-only transaction`),
          );
        }
        return Promise.resolve(queue.shift() ?? []);
      };

      const value = await fn(tx as never);
      // Only reached when the callback RESOLVED — which the walker never lets
      // happen, because that is what a commit would be.
      record.committed = true;
      return value;
    },
  };

  return { sql, statements, transactions, queue };
}

// ── a throwaway app root with real applier files in it ──────────────────────

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function appRoot(appliers: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "ds24-applier-plan-"));
  roots.push(root);
  mkdirSync(join(root, "scripts", "content", "appliers"), { recursive: true });
  for (const [name, source] of Object.entries(appliers)) {
    writeFileSync(join(root, "scripts", "content", "appliers", name), source);
  }
  return root;
}

/** No `config/modules.json` in a temp root, so the module half is handed a list. */
const CORE_ONLY = { ids: [] as string[] };

const PLANS = `
export async function plan(sql) {
  const rows = await sql\`select slug from things where origin = 'content'\`;
  return {
    created: 2,
    reasserted: rows.length,
    subjects: ["block-1", "lektion-1", "lektion-2"],
    problems: ["\\"lektion-3\\" is held by an operator-authored row"],
  };
}
export async function present(sql) { return 1; }
`;

const SILENT = `
export async function apply(sql) { return 0; }
export async function present(sql) { return 7; }
`;

const WRITES = `
export async function plan(sql) {
  await sql\`insert into things (id, slug) values ('x', 'x')\`;
  return { created: 1, reasserted: 0, subjects: ["x"], problems: [] };
}
`;

// ── the pure half ──────────────────────────────────────────────────────────

describe("capping the subjects", () => {
  it("leaves a short list alone", () => {
    expect(capSubjects(["a", "b"])).toEqual(["a", "b"]);
  });

  it("names how many it left out rather than truncating in silence", () => {
    const many = Array.from({ length: SUBJECTS_CAP + 5 }, (_, i) => `slug-${i}`);
    const capped = capSubjects(many);

    expect(capped).toHaveLength(SUBJECTS_CAP + 1);
    expect(capped.at(-1)).toBe("and 5 more");
  });
});

describe("what a planner's answer is taken to mean", () => {
  it("carries the numbers and prefixes every problem with the applier", () => {
    const plan = normalisePlan("courses:course.mjs", "courses", {
      created: 12,
      reasserted: 43,
      subjects: ["block-1"],
      problems: ['"lektion-3" is claimed'],
    });

    expect(plan).toMatchObject({ answered: true, created: 12, reasserted: 43 });
    expect(plan.problems).toEqual(['courses:course.mjs: "lektion-3" is claimed']);
  });

  it("🚨 refuses an unreadable answer instead of reading it as zero", () => {
    // The inversion this whole file is written against: a planner that answered
    // something nobody can read has not said "nothing to do".
    const plan = normalisePlan("seed.mjs", null, "yes");

    expect(plan.answered).toBe(false);
    expect(plan.created).toBeUndefined();
    expect(plan.reasserted).toBeUndefined();
    expect(plan.problems?.[0]).toContain("plan(sql) must return");
  });

  it("counts a missing number as zero but never invents a report", () => {
    const plan = normalisePlan("seed.mjs", null, { created: 3 });

    expect(plan).toMatchObject({ answered: true, created: 3, reasserted: 0 });
    expect(plan.subjects).toEqual([]);
    expect(plan.problems).toBeUndefined();
  });
});

// ── the walk ───────────────────────────────────────────────────────────────

describe("what the walker reports", () => {
  it("asks each applier and keeps its label", async () => {
    const root = appRoot({ "a-course.mjs": PLANS });
    const { sql } = fakeSql([[{ slug: "one" }, { slug: "two" }]]);

    const [plan] = await applierPlans({ ...CORE_ONLY, root, sql });

    expect(plan.label).toBe("a-course.mjs");
    expect(plan.module).toBeNull();
    expect(plan).toMatchObject({ answered: true, created: 2, reasserted: 2 });
    expect(plan.subjects).toEqual(["block-1", "lektion-1", "lektion-2"]);
    expect(plan.problems).toEqual([
      'a-course.mjs: "lektion-3" is held by an operator-authored row',
    ]);
  });

  it("🚨 an applier with no plan(sql) has NO numbers, not zeros", async () => {
    const root = appRoot({ "z-seed.mjs": SILENT });
    const { sql, statements } = fakeSql();

    const [plan] = await applierPlans({ ...CORE_ONLY, root, sql });

    expect(plan.answered).toBe(false);
    // The whole of NFR-60 in this file: "cannot say" and "nothing to do" are two
    // reports, and a caller summing `created ?? 0` over these must get nothing
    // from them rather than a zero it cannot tell from a real one.
    expect(plan.created).toBeUndefined();
    expect(plan.reasserted).toBeUndefined();
    expect(plan.note).toContain("exports no plan(sql)");
    expect(plan.note).toContain("z-seed.mjs");
    // And it opened no transaction at all — there was nothing to run.
    expect(statements).toEqual([]);
  });

  it("carries on past a planner that failed, and says which one", async () => {
    const root = appRoot({
      "a-broken.mjs": "export async function plan() { throw new Error('the table is gone'); }",
      "b-course.mjs": PLANS,
    });
    const { sql } = fakeSql([[{ slug: "one" }]]);

    const plans = await applierPlans({ ...CORE_ONLY, root, sql });

    expect(plans.map((plan) => plan.label)).toEqual(["a-broken.mjs", "b-course.mjs"]);
    expect(plans[0].answered).toBe(false);
    // Named, because the tool aggregates every applier's problems into one list
    // and an unattributed sentence there is a finding nobody can act on.
    expect(plans[0].problems?.[0]).toBe("a-broken.mjs: the table is gone");
    expect(plans[1]).toMatchObject({ answered: true, created: 2 });
  });
});

describe("🚨 read-only is the database's refusal, not our promise", () => {
  it("makes `set transaction read only` the FIRST statement of every plan", async () => {
    const root = appRoot({ "a-course.mjs": PLANS });
    const { sql, statements, transactions } = fakeSql([[]]);

    await applierPlans({ ...CORE_ONLY, root, sql });

    expect(statements[0]).toBe("set transaction read only");
    expect(transactions).toHaveLength(1);
    expect(
      transactions[0].readOnlyFirst,
      "a planner ran before the transaction was made read-only — everything after that is trust",
    ).toBe(true);
  });

  it("rolls the transaction back unconditionally, even on a clean plan", async () => {
    const root = appRoot({ "a-course.mjs": PLANS });
    const { sql, transactions } = fakeSql([[]]);

    const [plan] = await applierPlans({ ...CORE_ONLY, root, sql });

    // The answer came back…
    expect(plan.answered).toBe(true);
    // …and the transaction still never resolved its callback, which is what a
    // commit would have been. A planner that somehow wrote in a way the
    // read-only flag permits leaves nothing behind either.
    expect(transactions[0].committed).toBe(false);
  });

  it("🚨 THE NEEDLE — a planner that attempts an insert is reported, and nothing lands", async () => {
    const root = appRoot({ "a-writes.mjs": WRITES, "b-course.mjs": PLANS });
    const { sql, statements } = fakeSql([[{ slug: "one" }]]);

    const plans = await applierPlans({ ...CORE_ONLY, root, sql });

    const writer = plans.find((plan) => plan.label === "a-writes.mjs");
    expect(writer?.answered, "a planner that was refused must not report numbers").toBe(false);
    expect(writer?.created).toBeUndefined();
    expect(writer?.problems?.[0]).toBe(
      "a-writes.mjs: cannot execute INSERT in a read-only transaction",
    );
    expect(writer?.note).toContain("a-writes.mjs");

    // Nothing landed: the insert was ISSUED and refused, and no second attempt
    // was made around the flag.
    expect(statements.filter((text) => text.startsWith("insert into"))).toHaveLength(1);

    // And the walk still answered for the applier that behaved.
    expect(plans.find((plan) => plan.label === "b-course.mjs")).toMatchObject({
      answered: true,
      created: 2,
    });
  });
});

describe("🚨 the enumeration's refusal travels — it is never an empty plan", () => {
  it("throws the enumerator's own sentence when the core directory cannot be read", async () => {
    const root = mkdtempSync(join(tmpdir(), "ds24-applier-plan-empty-"));
    roots.push(root);
    const { sql } = fakeSql();

    // NOT an empty array. `applierSources()` refuses on ENOENT because "not
    // carried into a built output" IS ENOENT, and a walker that swallowed it
    // would answer "0 applier(s) would run" for an app whose appliers are gone.
    await expect(applierPlans({ ...CORE_ONLY, root, sql })).rejects.toThrow(
      /Cannot read the app's own applier directory/,
    );
  });
});

// ── the source properties nothing else can measure ─────────────────────────

const APP_ROOT = process.cwd();
const SOURCE = readFileSync(join(APP_ROOT, "lib", "content", "applier-plan.ts"), "utf8");

describe("the applier import survives bundling", () => {
  // ⚠️ Deliberately NOT through `blankComments()` — here the comment IS the
  // mechanism, exactly as in `applier-presence.test.ts`, and blanking it would
  // delete what is being checked.
  it("found the file it is guarding", () => {
    expect(SOURCE).toContain("applierSources");
    expect(SOURCE).toMatch(/await import\(/);
  });

  it("🚨 tells webpack and Turbopack to leave the dynamic specifier alone", () => {
    for (const spell of ["webpackIgnore: true", "turbopackIgnore: true"]) {
      expect(
        SOURCE,
        `applier-plan.ts imports an applier by a runtime path without ${spell}. The bundler ` +
          'answers "Cannot find module as expression is too dynamic", and content_publish ' +
          "refuses in every deployed app for a reason that has nothing to do with content.",
      ).toContain(spell);
    }
  });

  it("imports a file URL, not a bare absolute path", () => {
    expect(SOURCE).toContain("pathToFileURL(file).href");
  });
});

describe("🚨 nothing on this tool's code path can WRITE to the media store", () => {
  // ── The claim was narrowed once, deliberately, and this says why ──────────
  // It used to be *"cannot reach the media store"* — no specifier under
  // `lib/media/` anywhere in the closure — and that was the right shape while
  // the plan had no honest reason to address the store at all.
  //
  // It has one now. `mediaPresence()` answers *is the declared media actually
  // there*, and a row in `media` cannot answer it: `content_publish` writes that
  // row itself out of the manifest's recorded `sha256`/`bytes`, so a row is
  // present over an emptied bucket and the check said `✓ 1 of 1` (Story 34.4,
  // action A47). The answer needs one `head()` per declared file, and `head()`
  // lives exactly where `put()` does.
  //
  // So the ban moved from the DOOR to the ACT, which is the stronger place for
  // it: the read half is named — one specifier, `@/lib/media/store` — and every
  // writing method stays unreachable, asserted over the whole closure below.
  // What must not happen is this describe being softened into "reaches lib/media
  // sometimes": a plan that could `put()` would be a plan that writes.
  //
  // AC7's source half, written the way `scripts/mcp/no-db.test.ts` is written.
  // The entries are the plan's own two halves rather than `lib/setup/tools.ts`:
  // that file legitimately imports `acceptUpload()` for `media_upload`, a
  // different tool, so walking it would prove nothing about this one.
  const ENTRIES = [
    join(APP_ROOT, "lib/content/applier-plan.ts"),
    join(APP_ROOT, "lib/content/media-presence.ts"),
  ];

  /** Static AND dynamic specifiers — this path uses both. */
  function importsIn(source: string): string[] {
    const blanked = blankComments(source);
    const out: string[] = [];
    for (const match of blanked.matchAll(/\bfrom\s+["']([^"']+)["']/g)) out.push(match[1]);
    for (const match of blanked.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g)) out.push(match[1]);
    for (const match of blanked.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) out.push(match[1]);
    return out;
  }

  /**
   * ⚠️ `resolveImport()` probes the bare path FIRST, so `@/db` answers with the
   * DIRECTORY — which is a real path, and reading it is an `EISDIR`. The walk
   * would otherwise stop at exactly the specifier it most wants to follow.
   */
  function fileFor(from: string, specifier: string): string | null {
    const target = resolveImport(from, specifier, { root: APP_ROOT });
    if (!target?.exists) return null;
    if (!statSync(target.path).isDirectory()) return target.path;
    const indexed = resolveImport(from, specifier, {
      root: APP_ROOT,
      extensions: ["/index.ts", "/index.mjs"],
    });
    return indexed?.exists ? indexed.path : null;
  }

  const seen = new Set<string>();
  const specifiers: string[] = [];
  const queue = [...ENTRIES];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const specifier of importsIn(readFileSync(file, "utf8"))) {
      specifiers.push(specifier);
      const target = fileFor(file, specifier);
      if (target) queue.push(target);
    }
  }

  // The needle probe. A walk that silently found nothing reports green for ever.
  it("actually walked something", () => {
    // Named files rather than a count: the closure is 25-odd files deep — the
    // enumerator, the module registry, `db/index.ts` and every schema slice —
    // and a walk that quietly stopped at the first specifier would still be
    // "greater than two".
    const walked = [...seen].map((file) => file.slice(APP_ROOT.length + 1));
    for (const file of [
      "db/schema.ts",
      "db/index.ts",
      "lib/content/presence.ts",
      "scripts/content/_appliers.mjs",
    ]) {
      expect(walked, `the walk never reached ${file}`).toContain(file);
    }
    expect(specifiers).toContain("@/db");
    expect(specifiers).toContain("@/scripts/content/_appliers.mjs");
  });

  it("reaches ONE thing under lib/media, and it is the store's front door", () => {
    const hit = [...new Set(specifiers.filter((specifier) => /(^|\/)lib\/media\//.test(specifier)))];
    expect(
      hit,
      `the plan's code path reaches ${hit.join(", ")}. Exactly one specifier is licensed here — ` +
        `@/lib/media/store, for the HEAD that tells a media ROW from the object it points at. ` +
        `Anything else under lib/media/ is a second way in, and the write ban below only holds ` +
        `over what this list says can be addressed.`,
    ).toEqual(["@/lib/media/store"]);
  });

  it("🚨 and it asks that store for head() and nothing else", () => {
    // The narrowed ban's sharp end. `head()` is a read; `put`, `copy` and
    // `remove` are on the same object, one keystroke away, and this is the file
    // that holds the reference.
    const source = blankComments(
      readFileSync(join(APP_ROOT, "lib/content/media-presence.ts"), "utf8"),
    );
    const called = [...new Set([...source.matchAll(/\bstore\s*\.\s*(\w+)\s*\(/g)].map((m) => m[1]))];
    expect(
      called,
      `media-presence.ts calls ${called.join(", ")} on the store. A presence check reads; ` +
        `getBytes() would pull a nine-hundred-megabyte video through the process to learn ` +
        `that it is there, and everything else writes.`,
    ).toEqual(["head"]);
  });

  it("calls nothing that writes an object, anywhere in that closure", () => {
    for (const file of seen) {
      const source = blankComments(readFileSync(file, "utf8"));
      expect(
        /\bstore\s*\.\s*(put|copy|remove)\s*\(/.test(source),
        `${file} writes to the media store on a path a plan reaches`,
      ).toBe(false);
    }
  });
});
