// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The two scripts that mint credentials, and the conditions they call
// load-bearing in their own headers.
//
// `scripts/setup/bootstrap.mjs` creates an environment's FIRST OWNER and its
// first setup key. `scripts/setup/mint-key.mjs` mints every key after that.
// Between them they are the only way an app gets a setup credential — and
// neither was named by any test in this tree.
//
// Both are top-level scripts that do their work on import and need a database,
// so what is asserted is what source text can answer exactly: that the two
// refusals are there, that they come BEFORE the write, and that the secret does
// not reach the terminal. Each of these is a sentence the file already states
// about itself; what was missing is anything holding it to them.
//
// ⚠️ What this deliberately does NOT claim: that the refusals WORK against a
// real database. That is `scripts/deploy-two-act.mjs`'s kind of question, and
// it is answered there for the surface these keys open. Saying otherwise would
// be the "green because it checked" / "green because it skipped" confusion
// `CLAUDE.md` warns about.
//
// Comments are blanked first (CLAUDE.md → Rules) — both scripts argue about
// these calls at length, and so does this header.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

const BOOTSTRAP = read("scripts/setup/bootstrap.mjs");
const MINT = read("scripts/setup/mint-key.mjs");

/** Every string the script hands to the terminal. */
function printed(source: string): string[] {
  return [...source.matchAll(/console\.(?:log|error)\(([\s\S]*?)\);\n/g)].map(([, arg]) => arg);
}

describe("bootstrap.mjs — it runs once, on an environment that has nobody", () => {
  it("was read at all", () => {
    expect(BOOTSTRAP.length, "bootstrap.mjs read as empty").toBeGreaterThan(1000);
  });

  it("🚨 counts the owners and refuses when there is one", () => {
    // Its own header: "a bootstrap that worked twice is a back door wearing a
    // setup step's name." The count is the whole condition.
    expect(BOOTSTRAP).toContain("count(*)::int as count from users where role = 'owner'");
    expect(BOOTSTRAP).toMatch(/if \(count > 0\)/);
  });

  it("🚨 refuses BEFORE it mints anything", () => {
    // A refusal after `newSetupKey()` would still be a refusal — and would
    // still have spent a key and, worse, written the owner row in the same
    // transaction. Order is the property.
    const refusal = BOOTSTRAP.indexOf("already has");
    const mint = BOOTSTRAP.indexOf("newSetupKey()");
    expect(refusal).toBeGreaterThan(0);
    expect(mint).toBeGreaterThan(0);
    expect(refusal).toBeLessThan(mint);
  });

  it("🚨 never prints the secret — it writes it and says that it did", () => {
    // A production credential in an agent's transcript is the same failure the
    // `.env` rule keeps out of git, by another route. `secret` may appear in
    // exactly two places: where it is derived from, and the `setEnvValue()`
    // call that stores it.
    expect(BOOTSTRAP).toContain("setEnvValue(ENV_FILE, ENV_KEY, secret)");
    for (const line of printed(BOOTSTRAP)) {
      expect(line, `bootstrap.mjs prints the secret: ${line}`).not.toMatch(/\bsecret\b/);
    }
  });

  it("is a dry run unless told otherwise", () => {
    // It writes an owner and a credential; the default has to be the one that
    // cannot. Same convention as `content-apply` and `ds24-sync`.
    expect(BOOTSTRAP).toContain('args.includes("--apply")');
    const dry = BOOTSTRAP.indexOf("DRY RUN");
    expect(dry).toBeGreaterThan(0);
    expect(dry).toBeLessThan(BOOTSTRAP.indexOf("newSetupKey()"));
  });
});

describe("mint-key.mjs — a key belongs to an owner who exists", () => {
  it("was read at all", () => {
    expect(MINT.length, "mint-key.mjs read as empty").toBeGreaterThan(1000);
  });

  it("🚨 never prints the secret either", () => {
    expect(MINT).toMatch(/setEnvValue\(/);
    for (const line of printed(MINT)) {
      expect(line, `mint-key.mjs prints the secret: ${line}`).not.toMatch(/\bsecret\b/);
    }
  });

  it("refuses rather than guessing which owner, when nobody was named", () => {
    // Its own words, and the reason `flagsFrom()`'s strict reading was written
    // here first: "never the first one, the trail is the whole point."
    expect(MINT).toContain("A key belongs to an owner");
  });

  it("stores only the hash, never the key itself", () => {
    // The row is a verifier, not a copy. `hashSetupKey()` is imported from the
    // shipped `lib/setup/key.mjs` rather than reimplemented — the mistake its
    // own header records having made once.
    expect(MINT).toContain("hashSetupKey(");
    expect(MINT).toContain('from "../../lib/setup/key.mjs"');
  });
});

describe("both", () => {
  it("read the argument list through the shared strict reader", () => {
    // `docs/conventions.md` → *A script that reads `--flag value`*. These two
    // are the reason that rule exists: one had the strict reading and wrote
    // down why, the other took the next token whatever it was — and it is the
    // one that creates an environment's first owner.
    for (const [name, source] of [
      ["bootstrap.mjs", BOOTSTRAP],
      ["mint-key.mjs", MINT],
    ] as const) {
      expect(source, `${name} builds its own flag reader`).toContain("flagsFrom(");
    }
  });
});
