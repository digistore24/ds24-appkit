// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT
//
// The API map (`docs/api-map.md`) is a PROJECTION of the tree — the signatures
// behind every `lib/` file the guidance names, plus the tables — and a
// projection is only worth reading while it cannot lag. This holds it to the
// tree the same way `journey-check` holds the README's phase tables to
// `journey.mjs`: regenerate and compare, and a new export without a regenerated
// map is red rather than a map quietly one function behind.
//
// Why the map exists at all is in the header of `scripts/dev/api-map.mjs`; the
// short form: measured over 26 field-test sessions, `lib/entitlements/manage.ts`
// was read 24 times, 13,700 characters each, for three signatures.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { MAP_PATH, ROOT, exportsOf, namedLibFiles, renderApiMap, tablesOf } from "./dev/api-map.mjs";

describe("docs/api-map.md is the tree, projected", () => {
  it("matches what the generator produces — run `node run.mjs api-map` when it does not", () => {
    const onDisk = readFileSync(join(ROOT, MAP_PATH), "utf8");
    const rendered = renderApiMap(ROOT);
    // Diffed as lines so a failure names the first line that moved rather than
    // dumping 30 kB twice.
    const a = onDisk.split("\n");
    const b = rendered.split("\n");
    const first = a.findIndex((line, i) => line !== b[i]);
    expect(
      first === -1 && a.length === b.length ? "" : `line ${first + 1}: "${a[first] ?? "<end>"}" vs "${b[first] ?? "<end>"}"`,
      "docs/api-map.md is behind the tree — run: node run.mjs api-map",
    ).toBe("");
  });

  it("is not a map of nothing", () => {
    // Count guards, each set well under today's value (45 files, 253 functions,
    // 46 tables on 2026-09-03) so a legitimate cut does not argue with them, and
    // well above zero so a generator that finds nothing is red rather than a
    // clean empty document. A guidance rewrite that drops the map under these
    // is worth noticing anyway.
    const files = namedLibFiles(ROOT);
    expect(files.length, "lib files named by the guidance").toBeGreaterThanOrEqual(25);
    expect(files, "CLAUDE.md → Access names it").toContain("lib/entitlements/manage.ts");
    expect(files.filter((f) => /\.test\.(ts|mjs)$/.test(f)), "no test file is a thing to call").toEqual([]);
    const functions = files.reduce((n, f) => n + exportsOf(readFileSync(join(ROOT, f), "utf8")).length, 0);
    expect(functions, "exported functions over those files").toBeGreaterThanOrEqual(120);
    const rendered = renderApiMap(ROOT);
    expect((rendered.match(/^- `[a-z0-9_]+` \(`/gm) ?? []).length, "tables").toBeGreaterThanOrEqual(25);
  });
});

describe("exportsOf reads source as text — through blankComments()", () => {
  it("🚨 needle: an `export function` inside a comment is prose, not an export", () => {
    // Commented-OUT code, at column 0 — the shape a reader without
    // `blankComments()` cannot tell from an export. (An indented ` * export`
    // inside a JSDoc never matched the line-anchored pattern anyway; a fixture
    // built only of those was green with the blanking removed, and was replaced
    // by this one.)
    const source = [
      "/*",
      "export function notReal(a: string) {}",
      "*/",
      "export function real(a: string): number {",
      "  return a.length;",
      "}",
      "/* export function alsoNotReal() {} */",
    ].join("\n");
    expect(exportsOf(source).map((e) => e.name)).toEqual(["real"]);
  });

  it("collapses a multi-line signature and drops `export async function`", () => {
    const source = [
      "/**",
      " * May this Member use `productKey`?",
      " *",
      " * THROWS on an unknown key. Deliberately.",
      " */",
      "export async function hasPlan(",
      "  memberId: string,",
      "  productKey: string,",
      "): Promise<boolean> {",
      "  return true;",
      "}",
    ].join("\n");
    const [fn] = exportsOf(source);
    expect(fn.signature).toBe("hasPlan(memberId: string, productKey: string): Promise<boolean>");
    // The FIRST sentence of the FIRST paragraph — not the whole comment.
    expect(fn.summary).toBe("May this Member use `productKey`?");
    expect(fn.line).toBe(6);
  });

  it("a `{` inside a comment in the parameter list does not end the signature", () => {
    const source = [
      "export function f(",
      "  a: string, // like { this }",
      "  b: number,",
      "): void {}",
    ].join("\n");
    expect(exportsOf(source)[0].signature).toBe("f(a: string, b: number): void");
  });

  it("a JSDoc that opens with a tag has no summary, and says so with an empty string", () => {
    const source = ["/** @deprecated use g */", "export function f(): void {}"].join("\n");
    expect(exportsOf(source)[0].summary).toBe("");
  });

  it("a `//` block directly above counts as the summary too", () => {
    const source = ["// The one that runs at boot.", "// More detail.", "export function boot(): void {}"].join("\n");
    expect(exportsOf(source)[0].summary).toBe("The one that runs at boot.");
  });
});

describe("tablesOf lists each column once", () => {
  const source = [
    'import { pgTable, text, timestamp } from "drizzle-orm/pg-core";',
    "export const users = pgTable(",
    '  "users",',
    "  {",
    "    id: text().primaryKey(),",
    "    /** A comment with { braces } and a colon: here */",
    "    // and a line comment: with a colon",
    "    name: text(),",
    "    ownerId: text().references(() => users.id, { onDelete: \"cascade\" }),",
    "    createdAt: timestamp({ withTimezone: true }).defaultNow(),",
    "  },",
    "  (table) => [uniqueIndex(\"users_name\").on(table.name)],",
    ");",
    "// pgTable(\"not_a_table\", { nope: text() })",
  ].join("\n");

  it("names the table and its columns, once each, without the index argument", () => {
    expect(tablesOf(source)).toEqual([
      { constant: "users", table: "users", columns: ["id", "name", "ownerId", "createdAt"] },
    ]);
  });

  it("🚨 needle: the real schema has no duplicated column", () => {
    // The first version of the reader counted a key once per blank line a
    // blanked comment left above it — `users` came out as `id, id, role, role,
    // role, role, role, …`. Every table in the real tree is the counter-test.
    const schema = readFileSync(join(ROOT, "db/schema-core.ts"), "utf8");
    for (const table of tablesOf(schema)) {
      expect(new Set(table.columns).size, table.table).toBe(table.columns.length);
    }
  });
});
