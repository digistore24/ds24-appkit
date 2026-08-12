// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The three foreign keys that decide what a deleted account takes with it.
//
// `module.ts` promises, in prose above `eraseFor()`, that nothing of this module
// survives the account — and `docs/data-protection.md` §8c says the same to
// whoever writes the privacy policy from it. **Neither of them implements it.**
// The implementation is three `onDelete` clauses in `schema.ts`, and changing
// one of them leaves `npm run typecheck` clean, every other test green and every
// page rendering exactly as before. The promise would simply stop being true,
// silently, for as long as it took somebody to delete an account and look.
//
// That is the gap this file closes, in the shape `modules/community/schema.test.ts`
// established: there is no database in a vitest run, so reading the source IS
// the check. What a real one does is measured once per story in the module
// deploy profile (`make deploy-test-modules`).
//
// ⚠️ **Comments are blanked first**, although every assertion below is a
// positive match and would survive without it. The column comments in
// `schema.ts` contain the words `cascade` and `set null` while explaining why
// each clause reads the way it does — and a checker that can be satisfied, or
// broken, by the prose describing it is one whose prose gets deleted the first
// time it goes red for the wrong reason.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { blankComments as stripComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const code = stripComments(readFileSync(join(ROOT, "modules", "courses", "schema.ts"), "utf8"));

/**
 * One table declaration, and nothing of the next.
 *
 * Scoped per table for the reason the community's version spells out: a rule
 * asserted over the whole file stops being a rule about ONE table the moment a
 * second one satisfies the pattern. Both tables here carry a `member_id` with an
 * `onDelete`, so a file-wide match would go green with either of them reversed.
 */
function declaration(name: string): string {
  const start = code.indexOf(`export const ${name}`);
  if (start < 0) throw new Error(`cannot find ${name} in modules/courses/schema.ts`);
  const rest = code.slice(start + 1);
  const end = rest.indexOf("\nexport const ");
  return end < 0 ? rest : rest.slice(0, end);
}

const completions = declaration("coursesCompletions");
const submissions = declaration("coursesSubmissions");

/**
 * The needle for one table's declaration.
 *
 * ⚠️ Whitespace after `pgTable(` on purpose: both declarations put the table
 * name on its own line, and a `toContain('pgTable("x"')` written from a
 * single-line example finds neither — which reads as "the table is gone", the
 * one false alarm a non-vacuity check must not raise.
 */
const declares = (table: string) => new RegExp(`pgTable\\(\\s*"${table}"`);

describe("the test reads the right thing", () => {
  it("found both tables, each without the other", () => {
    // Non-vacuity. A slice that matched nothing would report every claim below
    // as satisfied — "green because it checked" and "green because it found
    // nothing" are the same colour.
    expect(completions).toMatch(declares("courses_completions"));
    expect(completions).not.toMatch(declares("courses_submissions"));
    expect(submissions).toMatch(declares("courses_submissions"));
    expect(submissions).not.toMatch(declares("courses_completions"));
    // …and the slices really carry the clauses, so a rename of `onDelete`
    // itself cannot pass unnoticed.
    expect(completions).toContain("onDelete");
    expect(submissions).toContain("onDelete");
  });
});

describe("🚨 everything of this module leaves with the account", () => {
  // ── What this catches ──────────────────────────────────────────────────
  // Somebody changes one of these to `set null`, reasoning — as an earlier
  // version of `module.ts` did in its own comment — that a workshop should keep
  // the record of the work it did. What that produces is a row of somebody's
  // prose with the link to its author removed: a person asked to be deleted,
  // the app kept what they wrote, and nothing left in the database can ever find
  // it again to finish the job. `lib/users/manage.ts` names the only criterion
  // that earns a row the right to outlive its author — one turn in a conversation
  // other people are still having — and a hand-in is 1:1 between one member and
  // the operator, so it does not meet it.

  it("a completion cascades", () => {
    expect(completions).toMatch(/memberId: text\("member_id"\)[\s\S]*?onDelete: "cascade"/);
  });

  it("a hand-in cascades", () => {
    expect(submissions).toMatch(/memberId: text\("member_id"\)[\s\S]*?onDelete: "cascade"/);
  });

  it("the reply's author does NOT — a coach who leaves keeps nobody's record", () => {
    // The opposite direction, and it is deliberate. `replied_by` is a THIRD
    // party's identity: cascading it would let a coach leaving the app delete
    // the hand-ins of every member they ever answered — the members' own data,
    // destroyed by somebody else's departure. `set null` keeps the record that a
    // reading happened and drops the name, which is also why the column is in
    // neither subject-access export (Art. 15(4), `privacy/sections.ts`).
    expect(submissions).toMatch(/repliedBy: text\("replied_by"\)[\s\S]*?onDelete: "set null"/);
  });
});
