// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The publish writer, measured where a test can measure it — and four needles
// for the four things that could quietly be vacuous.
//
// Three things this file is careful about, each because the obvious version of
// the test would prove nothing that has ever broken:
//
//   · The appliers are REAL files on disk, imported by the real dynamic import
//     through the real enumerator (`scripts/content/_appliers.mjs`). A list of
//     fake modules would test the aggregation and nothing else.
//   · The `sql` handle is a fake that BEHAVES like postgres: it records every
//     statement in order, refuses a write inside a read-only transaction the way
//     Postgres words it, keeps the media keys an insert created so that a second
//     run really finds them, and counts how many transactions are open at once.
//     What that buys is the ORDER assertions — media rows before appliers, the
//     pre-flight before the first statement of any kind.
//   · `@/db` and the media store are mocked away. The writer reaches for both at
//     module scope, and a driver built for a test that never queries is weight
//     for nothing.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";

vi.mock("@/db", () => ({ applierSql: {} }));
vi.mock("@/lib/media/store", () => ({
  mediaStore: () => {
    throw new Error("this test injects its own store");
  },
}));

const { publishContent, PublishError, PUBLISH_BUDGET_MS } = await import("./publish");
type PublishSql = NonNullable<Parameters<typeof publishContent>[0]["sql"]>;
type PublishStore = NonNullable<Parameters<typeof publishContent>[0]["store"]>;

// ── a fake postgres that keeps the promises this writer depends on ──────────

function fakeSql(options: { things?: string[] } = {}) {
  const statements: string[] = [];
  const transactions: { committed: boolean; readOnly: boolean }[] = [];
  const mediaKeys = new Map<string, string>();
  let openNow = 0;
  let openMost = 0;
  const things = options.things ?? [];

  const sql: PublishSql = {
    async begin<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      const record = { committed: false, readOnly: false };
      transactions.push(record);
      openNow += 1;
      openMost = Math.max(openMost, openNow);

      const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.raw.join("?").replace(/\s+/g, " ").trim();
        statements.push(text);

        if (text === "set transaction read only") {
          record.readOnly = true;
          return Promise.resolve([]);
        }
        const write = /^(insert|update|delete|truncate)\b/i.exec(text);
        if (record.readOnly && write) {
          return Promise.reject(
            new Error(`cannot execute ${write[1].toUpperCase()} in a read-only transaction`),
          );
        }
        if (/^insert into media\b/i.test(text)) {
          // The storage key is the fifth `${}` in that insert — `owner_id` is a
          // literal `null` and not a placeholder, which is exactly the sort of
          // off-by-one a fake gets wrong quietly.
          mediaKeys.set(String(values[4]), `media-${mediaKeys.size + 1}`);
          return Promise.resolve([]);
        }
        if (/^select storage_key from media where storage_key like\b/i.test(text)) {
          return Promise.resolve([...mediaKeys.keys()].map((key) => ({ storage_key: key })));
        }
        if (/^select id from media where storage_key = \?$/i.test(text)) {
          const id = mediaKeys.get(String(values[0]));
          return Promise.resolve(id ? [{ id }] : []);
        }
        if (/^select slug from things\b/i.test(text)) {
          return Promise.resolve(things.map((slug) => ({ slug })));
        }
        return Promise.resolve([]);
      };

      try {
        const value = await fn(tx as never);
        record.committed = true;
        return value;
      } finally {
        openNow -= 1;
      }
    },
  };

  return { sql, statements, transactions, mediaKeys, things, openMost: () => openMost };
}

function fakeStore(options: { holds?: string[]; failOn?: string } = {}) {
  const holds = new Set(options.holds ?? []);
  const put: string[] = [];
  const store: PublishStore = {
    async head(key) {
      return holds.has(key) ? { bytes: 1 } : null;
    },
    async put(key) {
      if (options.failOn === key) throw new Error("the bucket is not reachable");
      put.push(key);
      holds.add(key);
    },
  };
  return { store, put, holds };
}

// ── a throwaway app root with real appliers and a real manifest in it ───────

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function appRoot(input: {
  appliers?: Record<string, string>;
  manifest?: unknown;
  files?: Record<string, string>;
}) {
  const root = mkdtempSync(join(tmpdir(), "ds24-publish-"));
  roots.push(root);
  mkdirSync(join(root, "scripts", "content", "appliers"), { recursive: true });
  for (const [name, source] of Object.entries(input.appliers ?? {})) {
    writeFileSync(join(root, "scripts", "content", "appliers", name), source);
  }
  if (input.manifest !== undefined) {
    mkdirSync(join(root, "content"), { recursive: true });
    writeFileSync(
      join(root, "content", "media-manifest.json"),
      JSON.stringify(input.manifest, null, 2),
    );
  }
  for (const [path, body] of Object.entries(input.files ?? {})) {
    const full = join(root, "content", "media", ...path.split("/"));
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

/** No `config/modules.json` in a temp root, so the module half is handed a list. */
const CORE_ONLY = { appEnv: "development", ids: [] as string[] };

const MANIFEST = {
  entries: [
    { path: "kurs-basics/cover.png", visibility: "public", alt: "the cover" },
    { path: "kurs-basics/intro.mp4", visibility: "public" },
  ],
};

const APPLIES = `
export async function plan(sql) {
  const rows = await sql\`select slug from things\`;
  return { created: 3 - rows.length, reasserted: rows.length, subjects: ["a"], problems: [] };
}
export async function apply(sql, { mediaIdFor }) {
  await sql\`insert into things (id, slug) values ('1', 'a')\`;
  return 3;
}
export async function present(sql) { return 3; }
`;

const NEEDS_MEDIA = `
export async function apply(sql, { mediaIdFor }) {
  await mediaIdFor("kurs-basics/cover.png");
  return 1;
}
export async function present(sql) { return 1; }
`;

const NO_APPLY = `
export async function present(sql) { return 0; }
`;

const THROWS = `
export async function apply(sql) {
  await sql\`insert into things (id, slug) values ('9', 'z')\`;
  throw new Error("boom");
}
export async function present(sql) { return 0; }
`;

const NO_PLAN = `
export async function apply(sql) {
  await sql\`insert into things (id, slug) values ('5', 'e')\`;
  return 2;
}
export async function present(sql) { return 2; }
`;

const SILENT_COUNT = `
export async function apply(sql) {
  await sql\`insert into things (id, slug) values ('7', 'g')\`;
  return undefined;
}
export async function present(sql) { return 1; }
`;

// ── the pre-flight, which is an ORDERING requirement and not a wording one ──

describe("🚨 the whole run refuses BEFORE the first transaction", () => {
  it("THE NEEDLE — a broken applier placed LAST stops the earlier ones from writing", async () => {
    // The one that decides whether finding 3 survived. `a-course.mjs` sorts
    // first and would have committed by the time a CLI-shaped run discovered
    // `z-broken.mjs`. If any statement at all was issued, the pre-flight has
    // moved into the loop and "the whole run refuses" is not true any more.
    const root = appRoot({ appliers: { "a-course.mjs": APPLIES, "z-broken.mjs": NO_APPLY } });
    const { sql, statements } = fakeSql();
    const { store } = fakeStore();

    await expect(publishContent({ ...CORE_ONLY, root, sql, store })).rejects.toThrow(
      /z-broken\.mjs exports no apply/,
    );
    expect(
      statements,
      "an applier ran before the pre-flight had finished — the earlier appliers' rows are in " +
        "the database and the run still refused, which is a partial run with an explanation",
    ).toEqual([]);
  });

  it("carries a refusal code dispatch.ts recognises by shape", async () => {
    const root = appRoot({ appliers: { "z-broken.mjs": NO_APPLY } });
    const { sql } = fakeSql();
    const { store } = fakeStore();

    const error = await publishContent({ ...CORE_ONLY, root, sql, store }).catch((e) => e);
    expect(error).toBeInstanceOf(PublishError);
    expect(error.name).toBe("PublishError");
    expect(error.code).toBe("applierWithoutApply");
    // camelCase, not SCREAMING_SNAKE: `domainCodeOf()` treats the latter as a
    // Node system error and turns it into a 500.
    expect(/^[A-Z0-9_]+$/.test(error.code)).toBe(false);
  });

  it("🚨 lets the enumerator's own refusal travel — never 'nothing to publish'", async () => {
    const root = mkdtempSync(join(tmpdir(), "ds24-publish-empty-"));
    roots.push(root);
    const { sql, statements } = fakeSql();
    const { store } = fakeStore();

    const error = await publishContent({ ...CORE_ONLY, root, sql, store }).catch((e) => e);
    expect(error.code).toBe("appliersUnreadable");
    // "I could not look" and "there is nothing there" stay different answers.
    expect(error.message).toMatch(/could not enumerate/);
    expect(error.message).toMatch(/Cannot read the app's own applier directory/);
    expect(statements).toEqual([]);
  });

  it("refuses a manifest that does not judge, with nothing written", async () => {
    const root = appRoot({
      appliers: { "a-course.mjs": APPLIES },
      manifest: { entries: [{ path: "Kurs Basics/cover.png", visibility: "public" }] },
    });
    const { sql, statements } = fakeSql();
    const { store } = fakeStore();

    const error = await publishContent({ ...CORE_ONLY, root, sql, store }).catch((e) => e);
    expect(error.code).toBe("contentManifestInvalid");
    expect(error.message).toMatch(/violates the naming standard/);
    expect(statements).toEqual([]);
  });
});

// ── the order of the three steps ───────────────────────────────────────────

describe("🚨 media rows come first, or every mediaIdFor() throws", () => {
  it("asserts the rows before an applier resolves one", async () => {
    const root = appRoot({
      appliers: { "a-media.mjs": NEEDS_MEDIA },
      manifest: MANIFEST,
      files: { "kurs-basics/cover.png": "png", "kurs-basics/intro.mp4": "mp4" },
    });
    const { sql, statements } = fakeSql();
    const { store, put } = fakeStore();

    const report = await publishContent({ ...CORE_ONLY, root, sql, store });

    const firstInsert = statements.findIndex((text) => /^insert into media/i.test(text));
    const resolve = statements.findIndex((text) =>
      /^select id from media where storage_key/i.test(text),
    );
    expect(firstInsert).toBeGreaterThanOrEqual(0);
    expect(
      firstInsert < resolve,
      "an applier resolved a media reference before the rows were asserted — mediaIdFor() " +
        "throws by name on a missing row, so this order is what makes the run possible at all",
    ).toBe(true);

    expect(report.media).toMatchObject({ declared: 2, rowsCreated: 2, rowsChanged: 0, copied: 2 });
    expect(put).toEqual(["content/kurs-basics/cover.png", "content/kurs-basics/intro.mp4"]);
    expect(report.appliers[0]).toMatchObject({ label: "a-media.mjs", ran: true, rows: 1 });
    expect(report.partial).toBe(false);
  });

  it("throws BY NAME when a referenced file is in no manifest", async () => {
    // Not a null quietly wired into a lesson: the applier fails, is rolled back
    // whole, and the sentence names the path and the key.
    const root = appRoot({ appliers: { "a-media.mjs": NEEDS_MEDIA } });
    const { sql } = fakeSql();
    const { store } = fakeStore();

    const report = await publishContent({ ...CORE_ONLY, root, sql, store });

    expect(report.appliers[0].ran).toBe(false);
    expect(report.problems[0]).toMatch(/mediaIdFor\("kurs-basics\/cover\.png"\)/);
    expect(report.problems[0]).toMatch(/content\/kurs-basics\/cover\.png/);
    expect(report.partial).toBe(true);
  });

  it("HEADs before it PUTs, so a re-run copies nothing", async () => {
    const root = appRoot({
      appliers: { "a-course.mjs": APPLIES },
      manifest: MANIFEST,
      files: { "kurs-basics/cover.png": "png", "kurs-basics/intro.mp4": "mp4" },
    });
    const { sql } = fakeSql();
    const { store, put } = fakeStore({
      holds: ["content/kurs-basics/cover.png", "content/kurs-basics/intro.mp4"],
    });

    const report = await publishContent({ ...CORE_ONLY, root, sql, store });

    expect(put).toEqual([]);
    expect(report.media).toMatchObject({ copied: 0, present: 2 });
  });

  it("names what it never looked at when the store stops answering", async () => {
    // The `store-sync.mjs` contract: "Done — 1 copied" over a run that gave up
    // after one of two is a true number in a sentence that is a lie.
    const root = appRoot({
      appliers: { "a-course.mjs": APPLIES },
      manifest: MANIFEST,
      files: { "kurs-basics/cover.png": "png", "kurs-basics/intro.mp4": "mp4" },
    });
    const { sql } = fakeSql();
    const { store } = fakeStore({ failOn: "content/kurs-basics/cover.png" });

    const report = await publishContent({ ...CORE_ONLY, root, sql, store });

    expect(report.media?.unprocessed).toEqual(["kurs-basics/cover.png", "kurs-basics/intro.mp4"]);
    expect(report.partial).toBe(true);
  });

  it("writes no row with invented numbers, and says which entry it left out", async () => {
    const root = appRoot({ appliers: { "a-course.mjs": APPLIES }, manifest: MANIFEST });
    const { sql } = fakeSql();
    const { store } = fakeStore();

    const report = await publishContent({ ...CORE_ONLY, root, sql, store });

    expect(report.media).toMatchObject({ declared: 0, rowsCreated: 0 });
    expect(report.media?.skipped).toHaveLength(2);
    expect(report.problems.join(" ")).toMatch(/no sha256\/bytes/);
    // ⚠️ A warning, not a partial run — the same ruling content-apply makes.
    expect(report.partial).toBe(false);
  });
});

// ── what a run reports ─────────────────────────────────────────────────────

describe("what the publish says it did", () => {
  it("🚨 THE NEEDLE — a re-run creates nothing and re-asserts everything", async () => {
    // Idempotence, and the only place it is visible. A second run that creates
    // again means the applier is inserting rather than upserting, and nothing
    // else here would say so. The split comes from the applier's own plan(sql),
    // taken read-only immediately before the write.
    const root = appRoot({ appliers: { "a-course.mjs": APPLIES } });
    const { store } = fakeStore();

    const first = await publishContent({ ...CORE_ONLY, root, sql: fakeSql().sql, store });
    expect(first).toMatchObject({ created: 3, changed: 0, rows: 3 });

    const second = await publishContent({
      ...CORE_ONLY,
      root,
      sql: fakeSql({ things: ["a", "b", "c"] }).sql,
      store,
    });
    expect(second).toMatchObject({ created: 0, changed: 3, rows: 3 });
  });

  it("reports an applier that returned no finite count as 'ran', never as 0", async () => {
    const root = appRoot({ appliers: { "a-silent.mjs": SILENT_COUNT } });
    const { sql } = fakeSql();
    const { store } = fakeStore();

    const report = await publishContent({ ...CORE_ONLY, root, sql, store });

    expect(report.appliers[0]).toMatchObject({ ran: true, rows: null, created: null });
    // Nothing invented for the audit's number either.
    expect(report.rows).toBe(0);
  });

  it("leaves the split ABSENT rather than zero when an applier has no planner", async () => {
    // 🚨 Zero and unknown are the two numbers an operator would act on
    // differently — the same ruling the plan half makes about `answered: false`.
    const root = appRoot({ appliers: { "a-plain.mjs": NO_PLAN } });
    const { sql } = fakeSql();
    const { store } = fakeStore();

    const report = await publishContent({ ...CORE_ONLY, root, sql, store });

    expect(report.appliers[0].created).toBeNull();
    expect(report.appliers[0].changed).toBeNull();
    // …and its rows still reach the total, in the half that claims nothing new.
    expect(report.rows).toBe(2);
    expect(report.created).toBe(0);
    expect(report.changed).toBe(2);
  });

  it("is an honest no-op for an app that ships no content", async () => {
    const root = appRoot({ appliers: {} });
    const { sql, statements } = fakeSql();
    const { store } = fakeStore();

    const report = await publishContent({ ...CORE_ONLY, root, sql, store });

    expect(report).toMatchObject({ rows: 0, partial: false, media: null });
    expect(report.appliers).toEqual([]);
    expect(statements).toEqual([]);
  });
});

// ── one applier's failure is one applier's ─────────────────────────────────

describe("🚨 a throw rolls that applier back whole, and the trail says partial", () => {
  it("THE NEEDLE — the failing applier committed nothing and the others still ran", async () => {
    const root = appRoot({ appliers: { "a-course.mjs": APPLIES, "z-throws.mjs": THROWS } });
    const { sql, transactions } = fakeSql();
    const { store } = fakeStore();

    const report = await publishContent({ ...CORE_ONLY, root, sql, store });

    expect(report.appliers.map((applier) => applier.label)).toEqual([
      "a-course.mjs",
      "z-throws.mjs",
    ]);
    expect(report.appliers[0]).toMatchObject({ ran: true, rows: 3 });
    expect(report.appliers[1]).toMatchObject({ ran: false, rows: 0 });
    expect(report.problems[0]).toMatch(/z-throws\.mjs — failed and was rolled back: boom/);

    // 🚨 `rows` is what SURVIVED, not what was attempted — the whole reason the
    // fourth audit state exists.
    expect(report.rows).toBe(3);
    expect(report.partial).toBe(true);

    // The write transaction of the applier that threw never committed.
    const writes = transactions.filter((transaction) => !transaction.readOnly);
    expect(writes.at(-1)?.committed).toBe(false);
  });

  it("holds ONE connection at a time — a publish must not take the pool", async () => {
    const root = appRoot({
      appliers: { "a-course.mjs": APPLIES, "b-course.mjs": APPLIES },
      manifest: MANIFEST,
      files: { "kurs-basics/cover.png": "png", "kurs-basics/intro.mp4": "mp4" },
    });
    const { sql, openMost } = fakeSql();
    const { store } = fakeStore();

    await publishContent({ ...CORE_ONLY, root, sql, store });

    expect(
      openMost(),
      "two transactions were open at once — a publish would take DB_POOL_MAX connections " +
        "away from the customers using the app while it runs",
    ).toBe(1);
  });
});

// ── the budget ─────────────────────────────────────────────────────────────

describe("🚨 a long run is bounded, and a stopped one names what it never reached", () => {
  it("stops between appliers and names the rest", async () => {
    const root = appRoot({
      appliers: { "a-course.mjs": APPLIES, "b-course.mjs": APPLIES, "c-course.mjs": APPLIES },
    });
    const { sql } = fakeSql();
    const { store } = fakeStore();

    // A clock that spends the whole budget on the first applier.
    let tick = 0;
    const now = () => {
      tick += 1;
      return tick === 1 ? 0 : tick === 2 ? 0 : 10_000_000;
    };

    const report = await publishContent({ ...CORE_ONLY, root, sql, store, now, budgetMs: 25_000 });

    expect(report.appliers.map((applier) => applier.label)).toEqual(["a-course.mjs"]);
    expect(report.unreached).toEqual(["b-course.mjs", "c-course.mjs"]);
    expect(report.partial).toBe(true);
    // What ran is committed and is reported as such.
    expect(report.rows).toBe(3);
    expect(report.problems.join(" ")).toMatch(/never reached: b-course\.mjs, c-course\.mjs/);
  });

  it("checks the budget BETWEEN appliers and never inside one", async () => {
    // Half an applier is exactly what the per-applier transaction exists to
    // prevent, so the writer may not hand a deadline to an applier at all.
    const source = blankComments(
      readFileSync(join(process.cwd(), "lib", "content", "publish.ts"), "utf8"),
    );
    const applyCall = source.slice(source.indexOf("entry.apply(tx"));
    expect(applyCall).not.toMatch(/deadline/);
    expect(source).toMatch(/now\(\) >= deadline/);
  });

  it("carries the budget as a named constant, not a literal at the call site", () => {
    expect(PUBLISH_BUDGET_MS).toBe(25_000);
    const source = readFileSync(join(process.cwd(), "lib", "content", "publish.ts"), "utf8");
    // ⚠️ Deliberately NOT through `blankComments()`: here the comment IS what is
    // being checked. The number is a BOUND and not a measurement, and the file
    // has to say so where somebody would otherwise tighten it on a hunch.
    const at = source.slice(0, source.indexOf("export const PUBLISH_BUDGET_MS"));
    expect(at).toMatch(/UNMEASURED/);
    expect(at).toMatch(/maxDuration/);
  });
});

// ── the source properties nothing else can measure ─────────────────────────

describe("🚨 the writer stays on the applier route's side of the media partition", () => {
  const SOURCE = readFileSync(join(process.cwd(), "lib", "content", "publish.ts"), "utf8");

  it("tells webpack and Turbopack to leave the dynamic specifier alone", () => {
    // Deliberately not blanked: the comment IS the mechanism.
    for (const spell of ["webpackIgnore: true", "turbopackIgnore: true"]) {
      expect(
        SOURCE,
        `publish.ts imports an applier by a runtime path without ${spell}. The bundler answers ` +
          '"Cannot find module as expression is too dynamic", and content_publish refuses in ' +
          "every deployed app for a reason that has nothing to do with content.",
      ).toContain(spell);
    }
    expect(SOURCE).toContain("pathToFileURL(source.file).href");
  });

  it("never calls storageKey(), which is the other writer's function", () => {
    const source = blankComments(SOURCE);
    expect(
      /\bstorageKey\s*\(/.test(source),
      "publish.ts builds a key through storageKey(). That function DERIVES an upload's key from " +
        "its row id and throws on the reserved `content` namespace — this writer is on the other " +
        "side of the partition by construction, and reaching for it is how the two become one.",
    ).toBe(false);
  });
});
