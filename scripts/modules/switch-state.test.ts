// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Which way a module's switch points, as `module list` reports it.
//
// The property under test is not "does it read `enabled`" — it is that this
// reader is strictly WEAKER than the app's, in one direction. Every `off` it
// prints must be an off the app also decides; it may never print `on` for a file
// the app refuses. So the interesting cases are the near-misses an operator
// really types (`"true"`, `1`, `"yes"`) rather than the happy path.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { blankComments } from "../lib/source-text.mjs";
import { noSwitchLine, switchLine, switchStateFrom } from "./switch-state.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

describe("switchStateFrom", () => {
  it("reads the one shape that means on", () => {
    expect(switchStateFrom({ enabled: true })).toEqual({ on: true, note: null });
  });

  it("says off without a note for the ordinary case, so the note means something when it appears", () => {
    expect(switchStateFrom({ enabled: false })).toEqual({ on: false, note: null });
  });

  // 🚨 The direction this file may never fail in. A `Boolean(raw.enabled)` would
  // pass every one of these and report on for a file every reader in the app
  // treats as off — a command that exists to end a confusion, causing it.
  it.each([
    ["the string", "true"],
    ["the number", 1],
    ["a yes", "yes"],
    ["an empty array", []],
    ["an object", {}],
  ])("refuses %s — truthy is not `true`", (_what, value) => {
    expect(switchStateFrom({ enabled: value }).on).toBe(false);
  });

  it("tells a missing file apart from an unreadable one, and both from a plain false", () => {
    // "I could not look" and "it is off" are the same colour on screen
    // otherwise, which is the confusion this whole command exists to end.
    expect(switchStateFrom(undefined)).toEqual({ on: false, note: "no such file" });
    expect(switchStateFrom(null)).toEqual({ on: false, note: "unreadable" });
    expect(switchStateFrom({ enabled: false }).note).toBeNull();
  });

  it("refuses a file that is not an object at all", () => {
    expect(switchStateFrom([]).on).toBe(false);
    expect(switchStateFrom("enabled").on).toBe(false);
    expect(switchStateFrom(7).on).toBe(false);
  });

  it("says so when the key is simply absent", () => {
    expect(switchStateFrom({ live: { visibleSeconds: 5 } })).toEqual({
      on: false,
      note: 'no "enabled" key',
    });
  });
});

describe("switchLine", () => {
  it("shouts OFF and does not shout on — off is the state that surprises people", () => {
    expect(switchLine("config/community.json", { on: false, note: null })).toBe(
      "switch: config/community.json — OFF",
    );
    expect(switchLine("config/community.json", { on: true, note: null })).toBe(
      "switch: config/community.json — on",
    );
  });

  it("carries the note when there is one", () => {
    expect(switchLine("config/api.json", { on: false, note: "unreadable" })).toBe(
      "switch: config/api.json — OFF (unreadable)",
    );
  });
});

describe("the switch files really in this tree", () => {
  const ids = readdirSync(join(ROOT, "modules"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  // 🚨 The needle probe: every assertion below loops over a list read off the
  // disk, and a walk that found nothing passes all of them in silence.
  it("found the modules", () => {
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain("community");
  });

  // 🚨 **The POSITION of these switches is the customer's, and this suite runs
  // in the customer's app.** This assertion used to read `toEqual({ on: false,
  // note: null })` — "every shipped switch is OFF, that is what they ship as" —
  // and that claim is true, load-bearing, and about the TEMPLATE. It is measured
  // where the template is: `scripts/shipped-lists.test.mjs` in the source repo,
  // beside the four greeting inventories and `config/modules.json`, which moved
  // there for exactly this reason and say so at length.
  //
  // Here it was the failure class `CLAUDE.md` names under *Modules* — "installing
  // a module does not make your test suite red, and if it ever does that is a bug
  // in the test". Measured 2026-08-10 in a real tree: `config/course.json` →
  // `"enabled": true` gave `4711 passed, 1 failed`, and `config/community.json`,
  // `config/api.json` and `config/ai-companion.json` each did the same on their
  // own. So a customer who did the one thing their course's guidance tells them
  // to do — switch it on once the content is written — got a red suite reporting
  // their own correct state as a fault.
  //
  // What is left is the half that IS this tree's business and holds in either
  // position: a manifest that declares a switch declares one this app really has,
  // and `switchStateFrom()` can read a position out of it. Missing, unparseable,
  // not an object, no `enabled` key — those four are `module list` printing OFF
  // with a note about a FILE, and none of them is a state anybody chose.
  it("can read a position out of every switch a manifest declares", () => {
    let checked = 0;
    for (const id of ids) {
      const manifest = JSON.parse(readFileSync(join(ROOT, "modules", id, "module.json"), "utf8"));
      if (typeof manifest.config !== "string") continue;
      checked += 1;
      // `undefined` for "no such file" and `null` for "unreadable" is
      // `switchStateFrom()`'s own contract, so the note below is the app's word
      // for what happened rather than a second vocabulary invented here.
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(join(ROOT, manifest.config), "utf8")) as unknown;
      } catch (err) {
        raw = (err as NodeJS.ErrnoException).code === "ENOENT" ? undefined : null;
      }
      const state = switchStateFrom(raw);
      expect(
        state.note,
        `${id} declares ${manifest.config} and \`node run.mjs module list\` would print ` +
          `"${switchLine(manifest.config, state)}" for it. A switch nobody can read is a ` +
          `module nobody can turn on — fix the file, or the manifest's \`config\` path.`,
      ).toBeNull();
      // 🚨 And deliberately NOTHING about `state.on`: which way it points is the
      // operator's decision about their own app.
    }
    expect(checked, "at least one module in this tree ships a switch").toBeGreaterThan(0);
  });
});

describe("a module with no switch says so", () => {
  // 🚨 The state that used to be printed as SILENCE. Every module that declares
  // a `config` gets a `switch:` line, the guidance says "set the switch" after
  // each `module add`, and against that background the one module without a
  // line reads as an unfinished manifest rather than as a decision — which is
  // how it was read (reported 2026-08-12).
  it("names the state rather than leaving a gap", () => {
    expect(noSwitchLine()).toMatch(/no switch/);
    // And says what that MEANS, because "no switch" alone is the same gap in
    // words: the reader's next question is whether the module is doing anything.
    expect(noSwitchLine()).toMatch(/installed/);
  });

  it("is a state some module in this tree really is in", () => {
    // The non-vacuity guard, and the thing that would change the answer: if
    // every module grew a `config`, this line would be unreachable and the
    // sentence above would be describing nothing. `activity` is the one today —
    // it contributes components INTO a lesson somebody else gates, so it has no
    // route of its own to answer 404 with.
    const without = readdirSync(join(ROOT, "modules"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((id) => {
        const manifest = JSON.parse(
          readFileSync(join(ROOT, "modules", id, "module.json"), "utf8"),
        );
        return typeof manifest.config !== "string";
      });
    expect(
      without.length,
      "every module now declares a switch, so noSwitchLine() is dead code",
    ).toBeGreaterThan(0);
  });
});

describe("cli.mjs reports it", () => {
  // Source read as TEXT, so through `blankComments()` — `cli.mjs` now carries a
  // paragraph ABOUT the weak/strong distinction, and a checker that counted
  // comments would pass on a file that only discusses printing the state.
  const cli = blankComments(readFileSync(join(ROOT, "scripts", "modules", "cli.mjs"), "utf8"));

  it("renders the line through switch-state.mjs rather than its own wording", () => {
    expect(cli).toMatch(/import \{[^}]*switchLine[^}]*\} from "\.\/switch-state\.mjs"/);
    expect(cli).toContain("switchLine(");
  });

  it("asks only for an INSTALLED module — a dormant one is off because it is absent", () => {
    // Printing a position for a module that is not in the app answers a
    // different question than the one the column heading asks.
    expect(cli).toMatch(/pointers\(manifest, installed\)|installed\s*\n?\s*\?/);
    expect(cli).toContain("pointers(manifest, withParts)");
  });

  it("prints the no-switch state through that file too, not in its own words", () => {
    // Same rule as `switchLine` above, and the same reason: a second wording at
    // the call site is a second answer to drift apart from this one.
    expect(cli).toMatch(/import \{[^}]*noSwitchLine[^}]*\} from "\.\/switch-state\.mjs"/);
    expect(cli).toContain("noSwitchLine()");
  });

  it("keeps no `.enabled` peek of its own", () => {
    // The copy this design exists to avoid. Everything about `enabled` lives in
    // switch-state.mjs, where the weak-claim argument is written down.
    expect(cli).not.toMatch(/\.enabled\b/);
  });
});
