// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Which action refuses, and which one must never start.
//
// ── Why structurally and not by calling it ─────────────────────────────────
// Both actions need a session and a database, and this project has no test
// database on purpose — the same constraint `modules/companion/actions.test.ts`
// works under, and the same technique. What the DECISION is, is already pinned
// one file over and without any of that: `keys/visibility.test.ts` walks the
// full matrix as a pure function. What is left here is where that decision is
// CALLED, and both halves of it are silent when they go wrong:
//
//   · a `createApiKeyAction` that stopped asking hands out a live credential
//     for an endpoint that will never answer it, and reports success;
//   · a `revokeApiKeyAction` that STARTED asking would strand a key on
//     somebody's laptop the moment the operator withdrew the feature — the
//     failure this whole change exists to fix, reintroduced one door over.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { blankComments } from "@/scripts/lib/source-text.mjs";

import { API_KEY_ERROR_CODES } from "./keys/rules";

const raw = readFileSync(fileURLToPath(new URL("./actions.ts", import.meta.url)), "utf8");

/**
 * The file with its comments removed.
 *
 * Not optional here: this file's own header and the docstring on
 * `revokeApiKeyAction` both name `refusalToMint()` in prose, so the sharpest
 * assertion below — that revoking does NOT call it — would fail against a
 * perfectly correct file. `CLAUDE.md`: a checker that reads source as TEXT goes
 * through `blankComments()`.
 */
const source = blankComments(raw);

/**
 * One function's body, so an ordering assertion cannot be satisfied by a call
 * that sits in the OTHER action.
 */
function bodyOf(name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  if (start < 0) throw new Error(`no such action: ${name}`);
  const rest = source.slice(start + 1);
  const next = rest.indexOf("\nexport async function ");
  return next < 0 ? rest : rest.slice(0, next);
}

describe("the file is what this test thinks it is", () => {
  // Non-vacuity first: every assertion below would pass against an empty
  // string, which is the one way a structural test lies.
  it("is a server action file with both actions in it", () => {
    expect(source.length).toBeGreaterThan(1_000);
    // The directive sits under the licence header here, so its presence is what
    // is asserted rather than its position at byte 0.
    expect(raw).toContain('"use server"');
    expect(bodyOf("createApiKeyAction").length).toBeGreaterThan(200);
    expect(bodyOf("revokeApiKeyAction").length).toBeGreaterThan(100);
  });

  it("strips comments without stripping the code — the guard's own guard", () => {
    expect(source).toContain("createKey({");
    expect(source).toContain("revokeKey({");
    // And the stripping really happened: this sentence is in a comment only.
    expect(source).not.toContain("a live credential for an endpoint");
  });
});

describe("createApiKeyAction", () => {
  const body = bodyOf("createApiKeyAction");

  it("establishes the session before it asks anything about them", () => {
    expect(body.indexOf("requireActiveUser()")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("requireActiveUser()")).toBeLessThan(body.indexOf("refusalToMint("));
  });

  it("asks whether this member may mint at all, before it mints", () => {
    expect(body).toContain("refusalToMint(");
    expect(body.indexOf("refusalToMint(")).toBeLessThan(body.indexOf("createKey({"));
  });

  it("refuses by throwing the code, so the Member gets a sentence in their language", () => {
    expect(body).toContain("new ApiKeyError(refusal)");
  });
});

describe("revokeApiKeyAction", () => {
  const body = bodyOf("revokeApiKeyAction");

  it("still establishes the session", () => {
    expect(body).toContain("requireActiveUser()");
  });

  // 🚨 The assertion this file exists for. Every condition that stops a Member
  // creating a key is a reason to let them destroy one.
  it("is refused by NOTHING — revoking survives every switch", () => {
    expect(body).not.toContain("refusalToMint(");
    expect(body).not.toContain("isApiEnabled(");
    expect(body).not.toContain("hasPlan(");
    expect(body).not.toContain("selfService");
  });
});

describe("the refusal codes reach the Member", () => {
  it("maps every reason onto a code the account page can translate", () => {
    // The mapping itself is exhaustive by type (a `Record` over the reason
    // union), so what is worth asserting is that the codes it names are really
    // in the registry `i18n/messages.test.ts` iterates — a code invented here
    // and absent there reaches the Member as its own name.
    for (const code of ["apiDisabled", "apiSelfServiceOff", "apiPlanRequired"] as const) {
      expect(source).toContain(code);
      expect(API_KEY_ERROR_CODES).toContain(code);
    }
  });
});
