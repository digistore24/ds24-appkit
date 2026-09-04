// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT
//
// A table keyed on the member is personal data, and the inventory has to know
// it exists. `CLAUDE.md` → *What the app stores about people* says so in words:
// "Keep it current when you add a table — a privacy policy is only as true as
// the list it was written from." Nothing measured it, and on 2026-09-03 a field
// run built three member-keyed tables (`paint_rates`, `offer_settings`,
// `offers`) and neither `docs/data-protection.md` nor the member's own export
// learned of them — the customer's quotes were not in her data.
//
// So: every `pgTable` with a `memberId` (or `userId`) column is NAMED where its
// inventory lives. Core tables (`db/schema*.ts`) in `docs/data-protection.md`;
// a module's tables in the module's own `privacy/sections.*` or its doc
// (`docs/<module>.md`), which is where §14a of the inventory sends them.
// Measured on the shipped tree before this was armed: 19 core tables, all
// named; 1 module table (`metrics_events`), named in both places — zero
// findings, which is the condition a new rule has to meet here.
//
// It reads the schema files as TEXT through the API map's reader
// (`scripts/dev/api-map.mjs` → `tablesOf`, which goes through
// `blankComments()`), so it sees exactly what the map sees.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ROOT, schemaFiles, tablesOf } from "../../scripts/dev/api-map.mjs";

const MEMBER_COLUMNS = ["memberId", "userId"];

/** Where a table's inventory is expected, by the file it was declared in. */
function inventoryFor(file: string): { label: string; texts: string[] } {
  const moduleId = file.match(/^modules\/([a-z0-9-]+)\//)?.[1];
  if (moduleId) {
    const candidates = [
      `modules/${moduleId}/privacy/sections.ts`,
      `modules/${moduleId}/privacy/sections.mjs`,
      `docs/${moduleId}.md`,
    ];
    return {
      label: candidates.join(" or "),
      texts: candidates.filter((c) => existsSync(join(ROOT, c))).map((c) => readFileSync(join(ROOT, c), "utf8")),
    };
  }
  return { label: "docs/data-protection.md", texts: [readFileSync(join(ROOT, "docs/data-protection.md"), "utf8")] };
}

/** The member-keyed tables of one schema text that none of `texts` names. */
export function uninventoried(schema: string, texts: string[]): string[] {
  return tablesOf(schema)
    .filter((t) => t.columns.some((c) => MEMBER_COLUMNS.includes(c)))
    .filter((t) => !texts.some((text) => text.includes(t.table) || text.includes(t.constant)))
    .map((t) => t.table);
}

describe("every member-keyed table is in the privacy inventory", () => {
  const files = schemaFiles(ROOT);

  it("looks at schema files at all", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    it(`${file}: names its member-keyed tables in its inventory`, () => {
      const { label, texts } = inventoryFor(file);
      const missing = uninventoried(readFileSync(join(ROOT, file), "utf8"), texts);
      expect(
        missing,
        `${file} declares member-keyed table(s) that ${label} does not mention: ${missing.join(", ")} — ` +
          `a table holding a member's data gets its row in the inventory and its section in the export ` +
          `(lib/privacy/export.ts, or the module's privacy/sections) in the same commit as the table.`,
      ).toEqual([]);
    });
  }

  it("🚨 needle: a member-keyed table the inventory does not name is found", () => {
    const schema = [
      'export const offers = pgTable("offers", {',
      "  id: text().primaryKey(),",
      '  memberId: text("member_id").notNull(),',
      "});",
      'export const lookups = pgTable("lookups", {',
      "  id: text().primaryKey(),",
      "});",
    ].join("\n");
    // Named by table name, by constant, or not at all — and a table with no
    // member column is nobody's personal data and never a finding.
    expect(uninventoried(schema, ["| `offers` | …"])).toEqual([]);
    expect(uninventoried(schema, ["the offers constant"])).toEqual([]);
    expect(uninventoried(schema, ["| `lookups` | …"])).toEqual(["offers"]);
    expect(uninventoried(schema, [])).toEqual(["offers"]);
  });
});
