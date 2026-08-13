// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT


import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";
import raw from "@/config/setup.json";
import {
  DEFAULT_SETUP_CONFIG,
  isSetupEnabled,
  setupConfig,
  setupConfigFrom,
  setupConfigProblems,
  setupOffReason,
  setupOffReasonFrom,
  setupProblemsFrom,
} from "./config";

// 🚨 **The POSITION of this switch is the customer's, and this suite runs in the
// customer's app.** These tests used to assert `isSetupEnabled()` false,
// `setupConfig().allowDestructive` empty, `setupOffReason()` containing
// `"enabled"`, and an underscore key in the real `config/setup.json` — four
// claims about the state the TEMPLATE ships in, made through functions that open
// the file themselves.
//
// Switching the surface on is a documented, supported step: `content-check` and
// `courses-diff` need it, and `node run.mjs setup-check` sends the operator here
// on purpose. Measured 2026-08-12 on a real installation: `"enabled": true` gave
// `2 failed | 6995 passed`, and since `CLAUDE.md` makes green the commit
// condition, `.githooks/pre-commit` then refused every commit — leaving three
// ways out, all of them wrong (switch back, delete a shipped test, or
// `--no-verify` for ever).
//
// So the POSITION is asserted where the template is pristine by construction —
// `scripts/shipped-lists.test.mjs` in the source repo, section 6b. What stays
// here is everything a customer's tree can still answer, and that is more than
// the position was: the reader read both ways, the closed default, and the
// WIRING from their own file to the function the app calls.
//
// ⚠️ Losing that last one is how this move goes wrong, and a review caught it
// here once already: with the wiring untested, `setupConfig()` hardwired to
// `{ enabled: true }` left typecheck clean, 6988 tests green and the source
// repo's 12 green — every deployed app's write surface open, nothing red
// anywhere. `describe("this app's own file")` below is that gap closed.

describe("reading a setup config", () => {
  // Both directions. A reader stuck on "off" would satisfy every closed case
  // below, and it is exactly what section 6b in the source repo cannot catch —
  // it would report the template as shipping OFF whatever the file said.
  it("reads the position the file actually holds", () => {
    expect(setupConfigFrom({ enabled: false, allowDestructive: [] }).enabled).toBe(false);
    expect(setupConfigFrom({ enabled: true, allowDestructive: [] }).enabled).toBe(true);
  });

  it("trims the tool names it is given", () => {
    expect(setupConfigFrom({ enabled: true, allowDestructive: [" media_upload "] })).toEqual({
      enabled: true,
      allowDestructive: ["media_upload"],
    });
  });

  // The comment convention the module manifests already use. A config file that
  // cannot explain itself is one whose reasoning lives somewhere else and rots.
  it("ignores underscore keys, so a file can explain itself", () => {
    const file = { _comment: "why this is off", enabled: true, allowDestructive: [] };
    expect(setupProblemsFrom(file)).toEqual([]);
    expect(setupConfigFrom(file).enabled).toBe(true);
  });

  // 🚨 The closed default written out, never `toEqual(DEFAULT_SETUP_CONFIG)`.
  // Comparing the fallback against the constant it returns is `x` vs `x`:
  // measured, `DEFAULT_SETUP_CONFIG = { enabled: true, allowDestructive:
  // ["media_upload"] }` left every one of the cases below green. The same trap
  // `modules/api/api/config.test.ts:29` avoids by asserting the CONSTANT.
  it("ships a closed default", () => {
    expect(DEFAULT_SETUP_CONFIG).toEqual({ enabled: false, allowDestructive: [] });
  });

  // Every doubt falls towards closed, and towards the default WHOLESALE — a file
  // with one unknown key is a file somebody was editing, and half-applying their
  // intent is worse than not applying it. Note the third case: `enabled: true`
  // beside a broken `allowDestructive` still yields off.
  it.each([
    ["an unknown key", { enabled: true, allowDestrucive: [] }],
    ["a non-boolean switch", { enabled: "true" }],
    ["an empty tool name", { enabled: true, allowDestructive: ["", "media_upload"] }],
    ["a tool list that is not a list", { enabled: true, allowDestructive: "media_upload" }],
    ["no file at all", undefined],
    ["a file that could not be parsed", null],
    ["something that is not an object", ["enabled"]],
  ])("falls closed on %s", (_case, file) => {
    expect(setupProblemsFrom(file).length).toBeGreaterThan(0);
    expect(setupConfigFrom(file)).toEqual({ enabled: false, allowDestructive: [] });
    expect(setupOffReasonFrom(file)).not.toBeNull();
  });

  it("says which key it did not know", () => {
    expect(setupProblemsFrom({ allowDestrucive: [] })[0]).toContain("allowDestrucive");
  });

  // A caller that mutates what it was handed must not move the answer for the
  // next one — the fallback is a fresh object, not the shared constant.
  it("never hands out the shared default", () => {
    const first = setupConfigFrom(undefined);
    first.allowDestructive.push("media_upload");
    first.enabled = true;
    expect(setupConfigFrom(undefined)).toEqual({ enabled: false, allowDestructive: [] });
    expect(DEFAULT_SETUP_CONFIG).toEqual({ enabled: false, allowDestructive: [] });
  });

  // The sentence, not merely its absence. `setupOffReasonFrom` is the only
  // explanation an operator gets, and `null` reads as "it is on".
  it("says why it is off, in words", () => {
    expect(setupOffReasonFrom({ enabled: false })).toContain("enabled");
    expect(setupOffReasonFrom({ enabled: true, allowDestrucive: [] })).toContain("allowDestrucive");
    expect(setupOffReasonFrom({ enabled: true })).toBeNull();
  });
});

describe("this app's own file", () => {
  // Position-independent, and therefore still a fair question in a customer's
  // tree: whatever they set, the file has to be one this reader understands. A
  // typo here means the surface is silently off, which is the state worth
  // failing a build over.
  it("is coherent", () => {
    expect(setupConfigProblems()).toEqual([]);
  });

  // 🚨 **The wiring, asserted without asserting the position.** Whatever the
  // customer set, the three functions the app really calls have to be the pure
  // reader applied to their own file — a `setupConfig()` that stopped delegating
  // is the one failure mode with a production database on the other end.
  it("is read by the same reader the fixtures above prove", () => {
    expect(setupConfig()).toEqual(setupConfigFrom(raw));
    expect(isSetupEnabled()).toBe(setupConfigFrom(raw).enabled);
    expect(setupConfigProblems()).toEqual(setupProblemsFrom(raw));
  });

  // `setupOffReason()` is the pure answer plus the file's name. Both halves:
  // it must agree with the pure one about WHETHER, and carry the file so an
  // operator reading one line off a terminal knows which one to open.
  it("names the file when it explains itself", () => {
    const pure = setupOffReasonFrom(raw);
    const reason = setupOffReason();
    expect(reason === null).toBe(pure === null);
    if (reason !== null) expect(reason).toContain("config/setup.json");
  });
});

// 🚨 **A switch with ONE reader, and the tree says so** — the technique
// `modules/companion/config.test.ts` and `lib/ai/providers/leak-guard.test.ts`
// use for rules nobody can be expected to remember.
//
// The two pure functions above take their input, which is what made them
// testable — and is also a way to build a config out of data this file's own
// header forbids ever coming from anywhere but the deploy: "there is no runtime
// toggle and no admin setting". `setupConfigFrom(await request.json())` in some
// future route is a runtime toggle wearing a helper's name, and nothing else in
// this repo would notice.
describe("the pure reader has no caller outside lib/setup", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const read = (rel: string) => readFileSync(new URL(rel, new URL("../../", import.meta.url)), "utf8");

  /** Every file that decides whether THIS surface is on. */
  const CONSUMERS = ["lib/setup/guard.ts", "lib/setup/dispatch.ts"];

  it("names files that exist and are not empty", () => {
    // Non-vacuity first: a wrong path must not make the assertion below pass
    // against an empty string.
    expect(root.length).toBeGreaterThan(0);
    for (const file of CONSUMERS) {
      expect(read(file).length, file).toBeGreaterThan(200);
    }
  });

  it("has every consumer ask isSetupEnabled(), never the pure half", () => {
    for (const file of CONSUMERS) {
      const source = read(file);
      expect(source, file).toMatch(/isSetupEnabled|setupConfig\(\)/);
      expect(source, file).not.toMatch(/setupConfigFrom|setupProblemsFrom|setupOffReasonFrom/);
    }
  });
});

describe("the switch has ONE reader, and the tree says so", () => {
  // "Import the shared module" is advice. A test that reads the tree is not —
  // the technique `modules/companion/config.test.ts` and
  // `lib/ai/providers/leak-guard.test.ts` use for rules nobody can be expected
  // to remember.
  //
  // 🚨 Reported 2026-08-12, closed 2026-08-13: `scripts/setup/check.mjs` had its
  // own known-key set, its own unknown-key filter and its own `enabled`
  // predicate, because a `.mjs` cannot import a `.ts`. It had already drifted —
  // it printed `allowDestructive` without checking its shape, so a file the app
  // throws away whole made `setup-check` answer `✓ enabled`.
  const read = (rel: string) =>
    blankComments(readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8"));

  const CONSUMERS = ["lib/setup/config.ts", "scripts/setup/check.mjs"];

  it("names files that exist and are not empty", () => {
    for (const file of CONSUMERS) {
      expect(read(file).length, file).toBeGreaterThan(200);
    }
  });

  it("has every reader import config-shape.mjs", () => {
    for (const file of CONSUMERS) {
      expect(read(file), file).toMatch(/config-shape\.mjs/);
    }
  });

  it("🚨 and none of them keep a second opinion about what the keys are", () => {
    for (const file of CONSUMERS) {
      const source = read(file);
      // The shape a copy takes: its own set of the two key names. Matched on
      // the pair rather than on either word, so prose and a schema elsewhere
      // are not findings — and through `blankComments()`, because a file that
      // EXPLAINS the rule must not be punished for it.
      expect(
        /new Set\(\[\s*["']enabled["']/.test(source),
        `${file} builds its own set of known keys — that is the copy this file is about`,
      ).toBe(false);
      expect(
        /\.enabled\s*===\s*true/.test(source),
        `${file} decides "on" itself. Ask setupConfigFrom(); a second predicate is how ` +
          `setup-check came to say "✓ enabled" about a file the app refuses.`,
      ).toBe(false);
    }
  });
});
