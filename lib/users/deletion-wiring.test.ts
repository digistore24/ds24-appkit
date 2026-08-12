// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// That the erasure steps are CALLED, which is the half nothing else proves.
//
// ⚠️ **`lib/community/deletion.test.ts` proves the scrub does the right thing;
// this file proves it happens at all.** That distinction is the whole reason
// this file exists. The scrub is tested against a fake transaction and its own
// header says so — "this file does not prove the SQL runs". Delete the
// `scrubCommunityContentFor(tx, memberId)` line from `deleteAccountRow()`
// and every gate in the repo stays green: typecheck passes, the scrub's own
// four tests pass (the function is untouched), smoke passes, and erasure
// requests silently stop erasing words. The proven unit was the function; the
// unproven part was the call.
//
// It is a SOURCE check rather than an execution test, and that is a deliberate
// second-best. Both deletion paths need a database, a session and a media
// store; there is no database in this suite by decision. What can be asserted
// without one is that the two paths still route through the one function that
// owns "what leaves with a person", and that this function still performs the
// three steps in the order the file argues for. A source check cannot see a
// step that is called and does nothing — `deletion.test.ts` is what covers
// that end, and neither file is sufficient alone.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { blankComments } from "@/scripts/lib/source-text.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, "manage.ts"), "utf8");

/** The file without comments — a mention in prose is not a call. */
const code = blankComments(source);

/** The body of one exported function, from its signature to the next one. */
function bodyOf(name: string): string {
  const start = code.indexOf(`function ${name}(`);
  expect(start, `${name}() not found — was it renamed?`).toBeGreaterThan(-1);
  const rest = code.slice(start + 1);
  const next = rest.search(/\nexport (async )?function |\nasync function |\nfunction /);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("both deletion paths route through deleteAccountRow()", () => {
  // The operator's button and the member's own self-service are two entry
  // points to one answer. If either grows its own `db.delete(users)`, "what
  // leaves with a person" becomes two copies that drift the first time a table
  // is added — which is the reason `deleteAccountRow()` was extracted at all.
  for (const entry of ["deleteUser", "deleteOwnAccount"]) {
    it(`${entry}() calls deleteAccountRow()`, () => {
      const body = bodyOf(entry);
      expect(
        body,
        `${entry}() no longer calls deleteAccountRow(). Both deletion paths ` +
          `must share one answer to "what leaves with a person".`,
      ).toMatch(/deleteAccountRow\s*\(/);
    });

    it(`${entry}() deletes the stored objects before the row`, () => {
      const body = bodyOf(entry);
      const media = body.search(/deleteOwnedMedia\s*\(/);
      const row = body.search(/deleteAccountRow\s*\(/);
      expect(media, `${entry}() does not delete owned media`).toBeGreaterThan(-1);
      expect(
        media,
        "the objects go BEFORE the row: a foreign-key cascade reaches the " +
          "database and not the bucket, and `media.ownerId` is `set null` — so " +
          "row-first leaves the file in the bucket with nothing left in the " +
          "database able to find it.",
      ).toBeLessThan(row);
    });
  }

  it("deleteAccountRow() scrubs the departing member's words inside the transaction", () => {
    const body = bodyOf("deleteAccountRow");

    // ⚠️ This used to assert `scrubCommunityContentFor(tx,` by name. The
    // community is a MODULE now, so naming it here would be a core test
    // pinning a feature most apps do not have — and it would go quietly green
    // in an app that never installed one, which is the worse half.
    //
    // The PROPERTY is unchanged and is what is asserted instead: every module
    // takes its member's words out inside the same transaction, before the row
    // goes. `scripts/modules/generated.test.ts` holds the same line from the
    // module system's side, and each module's own `eraseFor()` is where the
    // "which words, and why not a cascade" argument now lives.
    expect(
      body,
      "deleteAccountRow() no longer walks MODULES. Rows a member WROTE outlive " +
        "the account by design (remove them and every reply answers nothing), " +
        "so the words have to be taken out explicitly — nothing else in the app " +
        "does it, and no other test would notice.",
    ).toMatch(/for\s*\(\s*const mod of MODULES\s*\)/);
    expect(body, "the loop no longer calls eraseFor()").toMatch(/eraseFor\?\.\(\s*tx\s*,/);

    // In the transaction, and before the row goes: a window where the account
    // is deleted and the words are not is the state the comment rules out.
    const scrub = body.search(/for\s*\(\s*const mod of MODULES\s*\)/);
    const del = body.search(/tx\s*\.\s*delete\s*\(/);
    expect(del, "deleteAccountRow() no longer deletes the user row").toBeGreaterThan(-1);
    expect(
      scrub,
      "the erasure must run inside the same transaction as the delete, and before it",
    ).toBeLessThan(del);
    expect(
      body,
      "the erasure and the delete must share ONE transaction — two would leave a " +
        "window where the account is gone and the words are not",
    ).toMatch(/db\s*\.\s*transaction\s*\(/);

    // 🚨 Not gated. An app that installed a module, ran it, and later switched
    // it off still holds every row written while it was on — the loop must not
    // grow an `if` in front of it.
    expect(body, "the erasure loop is behind a condition").not.toMatch(
      /if\s*\([^)]*\)\s*(\{[^}]*)?for\s*\(\s*const mod of MODULES/,
    );
  });
});
