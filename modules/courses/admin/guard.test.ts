// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Two claims about this surface's `"use server"` files that no behavioural test
// can make, because both are about the action somebody adds NEXT.
//
//   1. every exported action opens with `guard()`
//   2. no action takes a member id
//
// It reads EVERY `"use server"` file in the folder rather than a list — there
// are three now (`./actions.ts` for the rows, `./media-actions.ts` for their
// four media slots, `./submission-actions.ts` for the operator's reply), and a
// list kept by hand is one a fourth file joins late. Note what makes that safe:
// an exported function of a `"use server"` file IS a public endpoint, so
// "everything exported here" is exactly the set that needs guarding.
//
// ⚠️ `./authz.ts` is deliberately NOT in the set: it is where `guard()` itself
// lives, and it is not a `"use server"` file — a module that is one may export
// nothing but Server Actions, which is the whole reason that function has a file
// of its own.
//
// `actions.test.ts` exercises the actions that exist; this reads the FILE, so an
// eighth action arriving without a guard fails here on the day it lands rather
// than on the day somebody remembers to add a case for it. The same instrument
// `modules/api/routes/guard-presence.test.ts` uses on the HTTP handlers, and for
// the same stated reason: it reads the handler rather than trusting a list.
//
// 🚨 **Through `blankComments()`, never a regex of its own.** A checker that
// greps source punishes a file for explaining itself — this file's own header
// says `guard()` twice, and `actions.ts` says `memberId` in the comment that
// explains why it never reads one. `scripts/lib/source-text.mjs` carries the
// measured post-mortem (a `//` comment containing `/*` opening a phantom block).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";

const DIR = join(process.cwd(), "modules", "courses", "admin");

/** Every `"use server"` file on this surface, found rather than listed. */
const SERVER_FILES = readdirSync(DIR)
  .filter((name) => name.endsWith(".ts") && !name.includes(".test."))
  .map((name) => ({ name, source: blankComments(readFileSync(join(DIR, name), "utf8")) }))
  // The directive itself, and through `blankComments()` — a file that merely
  // MENTIONS "use server" in prose is not one.
  .filter(({ source }) => /^\s*["']use server["']/m.test(source));

/**
 * Every `export async function …Action`, with the text that follows it up to
 * the next one.
 *
 * A split rather than a parser: the shape is fixed by this template's own
 * convention, and a parser here would be a second thing to keep working.
 */
function actions(source: string): { name: string; body: string }[] {
  const chunks = source.split(/export\s+async\s+function\s+/).slice(1);
  return chunks.map((chunk) => ({
    name: chunk.slice(0, chunk.indexOf("(")).trim(),
    body: chunk,
  }));
}

const FOUND = SERVER_FILES.flatMap(({ name, source }) =>
  actions(source).map((action) => ({ ...action, file: name })),
);

describe("every action on the course's admin surface", () => {
  it("finds the actions at all", () => {
    // The needle that keeps the rest from being vacuous. A scan that matched
    // nothing would report every claim below as satisfied — "green because it
    // checked" and "green because it found nothing" are the same colour.
    expect(SERVER_FILES.map((file) => file.name).sort()).toEqual([
      "actions.ts",
      "media-actions.ts",
      "submission-actions.ts",
    ]);
    expect(FOUND.length).toBeGreaterThanOrEqual(13);
    expect(FOUND.map((action) => action.name)).toContain("createBlockAction");
    expect(FOUND.map((action) => action.name)).toContain("attachCoverAction");
    // 🚨 The one action on this surface that writes a row belonging to a
    // MEMBER. Named here so that the claim below — "takes no member id" — is
    // being made about the file where it stopped being trivially true.
    expect(FOUND.map((action) => action.name)).toContain("replyToSubmissionAction");
  });

  it("🚨 opens with guard() — the switch and requireOwner(), per request", () => {
    for (const { name, file } of FOUND) {
      expect(name, `${file} → ${name} is exported but is not named …Action`).toMatch(/Action$/);
    }
    for (const { name, file, body } of FOUND) {
      expect(
        body,
        `${file} → ${name} does not call guard(). A Server Action is an HTTP endpoint of its own — the ` +
          `page's checks say nothing about a request somebody replayed. guard() is ` +
          `isCourseEnabled() then requireOwner(), in that order, and neither line is optional.`,
      ).toMatch(/await\s+guard\(\)/);
    }
  });

  it("🚨 takes no member id from its form", () => {
    // No longer trivially true, and that is the point of having asserted it
    // while it was: `submission-actions.ts` writes a row belonging to a MEMBER.
    // It addresses that row by its OWN id and takes the answering identity from
    // the session — so no member id reaches it from a form, and this scan is
    // what says so about the action somebody adds next.
    for (const { name, file, body } of FOUND) {
      expect(
        body,
        `${file} → ${name} reads a member id out of its FormData. The account acted on is never named by ` +
          `the request — the same guarantee spendTokens() and /api/v1 give.`,
      ).not.toMatch(/get\(\s*["'`](memberId|member_id|userId|user_id)["'`]\s*\)/);
    }
  });

  it("🚨 the two scans find a planted fault", () => {
    // The needle probe. Without it, a scanner that had stopped matching
    // anything would report both claims above as satisfied for ever.
    const noGuard = actions(
      blankComments(
        `export async function badAction(_prev: X, formData: FormData) {\n` +
          `  const id = String(formData.get("id"));\n` +
          `  return { error: null, ok: null };\n}\n`,
      ),
    );
    expect(noGuard).toHaveLength(1);
    expect(noGuard[0].body).not.toMatch(/await\s+guard\(\)/);

    const takesMember = actions(
      blankComments(
        `export async function badAction(_prev: X, formData: FormData) {\n` +
          `  await guard();\n` +
          `  const who = String(formData.get("memberId"));\n  return who;\n}\n`,
      ),
    );
    expect(takesMember[0].body).toMatch(/get\(\s*["'`]memberId["'`]\s*\)/);
  });

  it("🚨 a comment can neither satisfy nor break either claim", () => {
    // What `blankComments()` is for, stated as a measurement: an action whose
    // guard exists only in prose must still fail.
    const commented = actions(
      blankComments(
        `export async function badAction(_prev: X, formData: FormData) {\n` +
          `  // this one calls await guard() somewhere, honestly\n  return null;\n}\n`,
      ),
    );
    expect(commented[0].body).not.toMatch(/await\s+guard\(\)/);
  });
});
