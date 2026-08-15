// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What this module answers about a person, and what it must never stop
// answering.
//
// These two assertions lived in `lib/privacy/export.test.ts` while the table
// was the core's. They moved WITH the table rather than being deleted: a module
// that owns rows about a person owns the checks on them too, and a check left
// behind in the core is one nobody looks at when the module changes.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";

// Blanked at the reader rather than at each assertion, so a check added later
// inherits it. Both assertions below hunt a needle in code — a `.references(…,
// { onDelete: "cascade" })`, a `state: null`, a column name — and every one of
// those is a thing a file is likely to NAME while explaining what it does: the
// comment above `eraseFor()` describing what it empties would satisfy the check
// on its own, after somebody had deleted the update. Only `.ts` and `.mjs` come
// through here.
// (CLAUDE.md → a checker that reads source as TEXT goes through `blankComments()`.)
const read = (rel: string) => blankComments(readFileSync(new URL(rel, import.meta.url), "utf8"));

describe("what survives an account deletion", () => {
  it("activity_results still cascades from the member — member_id specifically", () => {
    // Pin the CASCADING column by name: a second users-reference added to the
    // file must not let this pass while member_id loses its cascade.
    expect(read("./schema.ts")).toMatch(
      /member_id"\)\s*\.notNull\(\)\s*\.references\(\(\)\s*=>\s*users\.id,\s*\{\s*onDelete:\s*"cascade"\s*\}\)/,
    );
  });

  it("eraseFor() empties what the learner WROTE and keeps the numbers", () => {
    // The row survives the cascade only because the member link is what
    // cascades; what a member wrote — their answers, their resume point — is
    // theirs and goes. An `eraseFor` that deleted the row would take the app's
    // own record of how an activity performed with it.
    const entry = read("./module.ts");
    expect(entry).toMatch(/\.update\(activityResults\)/);
    expect(entry).toMatch(/state: null/);
  });
});

describe("both halves answer with the same columns", () => {
  it("selects §8b's whole list on each side", () => {
    // The section-parity clamp compares section NAMES; it cannot see a column
    // dropped from one of the two queries.
    const columns: Array<[string, string]> = [
      ["activityId", "activity_id"],
      ["subject", "subject"],
      ["state", "state"],
      ["score", "score"],
      ["maxScore", "max_score"],
      ["passed", "passed"],
      ["attempts", "attempts"],
      ["startedAt", "started_at"],
      ["updatedAt", "updated_at"],
      ["completedAt", "completed_at"],
    ];
    const ts = read("./privacy/sections.ts");
    const mjs = read("./privacy/sections.mjs");
    for (const [camel, snake] of columns) {
      expect(ts, `sections.ts: ${camel}`).toContain(camel);
      expect(mjs, `sections.mjs: ${snake}`).toContain(snake);
    }
  });
});
