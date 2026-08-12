// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The steps between `module add <id>` and the module doing anything.
//
// The failure this pins is not a crash — it is a silence. An operator added the
// community to a real app, saw no menu entries, and concluded the module system
// was broken; `config/community.json` said `"enabled": false`, which is what it
// ships as, and no command they had run said so. `module list` knew the sentence
// but printed it only for a module that is still DORMANT, so the moment after an
// install was the one moment it was gone.
//
// So two things are asserted here, and the second is the one with teeth: the
// steps a manifest produces, AND that both call sites in `cli.mjs` really print
// them. A pure function nobody calls would pass the first half all day.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { blankComments } from "../lib/source-text.mjs";
import { INSTALLING_IS_NOT_SWITCHING_ON, afterInstall, whileOff } from "./next-steps.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The switch step, or a throw. Narrows the union for TypeScript AND fails loudly
 * where `?.` would have quietly turned a missing step into an `undefined` that
 * every `toContain` below would then also skip — the same shape of silence this
 * whole file is about.
 */
function switchStep(manifest: Record<string, unknown>) {
  const step = afterInstall(manifest).find((s) => s.kind === "switch");
  if (step?.kind !== "switch") throw new Error(`no switch step for ${JSON.stringify(manifest)}`);
  return step;
}

describe("afterInstall", () => {
  it("asks for the migration first — a switched-on module whose tables are missing 500s where the honest answer was a 404", () => {
    const steps = afterInstall({ tables: ["a", "b"], config: "config/x.json" });
    expect(steps.map((s) => s.kind)).toEqual(["migrate", "switch"]);
    expect(steps[0]).toMatchObject({ kind: "migrate", tables: 2 });
    expect(steps[1]).toMatchObject({ kind: "switch", file: "config/x.json" });
  });

  it("carries both halves of the switch step, so a caller renders what fits", () => {
    // `module list` has a command column and takes `why`; `module add` has a
    // wrapped line and takes both. Neither may have to know the wording.
    const step = switchStep({ config: "config/x.json", nav: "nav.ts" });
    expect(step.why).toBe(INSTALLING_IS_NOT_SWITCHING_ON);
    expect(step.why.length, "short enough for a command column").toBeLessThan(45);
    expect(step.whileOff).toContain("menu entries stay hidden");
  });

  it("says nothing about a migration for a module that declares no table", () => {
    expect(afterInstall({ config: "config/x.json" }).map((s) => s.kind)).toEqual(["switch"]);
  });

  it("says nothing about a switch for a module that declares none", () => {
    // `activity` is this shape: one table, no config file. Naming a switch it
    // does not have would send somebody looking for a file to edit.
    expect(afterInstall({ tables: ["a"] }).map((s) => s.kind)).toEqual(["migrate"]);
  });

  it("has nothing to say about a module that brings neither", () => {
    expect(afterInstall({})).toEqual([]);
  });
});

describe("whileOff", () => {
  it("promises a 404 only to a module that declares routes", () => {
    expect(whileOff({ app: ["dashboard/x"] })).toContain("404");
    expect(whileOff({ nav: "nav.ts" })).not.toContain("404");
  });

  it("promises hidden menu entries only to a module that declares a menu", () => {
    expect(whileOff({ nav: "nav.ts" })).toContain("menu entries stay hidden");
    expect(whileOff({ app: ["api/v1"] })).not.toContain("menu");
  });

  it("falls back to the plain claim for a module that is a seam and nothing else", () => {
    // `companion` is this shape — no routes, no menu. A sentence promising it a
    // 404 would be describing another module.
    expect(whileOff({})).toBe("it does nothing");
  });

  it("names both shapes when a module has both", () => {
    const said = whileOff({ app: ["dashboard/community"], nav: "nav.ts" });
    expect(said).toContain("404");
    expect(said).toContain("menu entries stay hidden");
  });
});

describe("the modules really in this tree", () => {
  const ids = readdirSync(join(ROOT, "modules"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  // 🚨 The needle probe. Every assertion below is a `for` over a list this test
  // reads off the disk, and a walk that found nothing passes all of them in
  // silence — which is the failure mode this whole file exists to complain
  // about. So: prove the walk ran before believing what it says.
  it("found the modules", () => {
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain("community");
  });

  it("gives every module with a switch a step naming its file", () => {
    let withSwitch = 0;
    for (const id of ids) {
      const manifest = JSON.parse(readFileSync(join(ROOT, "modules", id, "module.json"), "utf8"));
      const steps = afterInstall(manifest);
      if (typeof manifest.config !== "string") {
        expect(steps.some((s) => s.kind === "switch"), `${id} declares no config`).toBe(false);
        continue;
      }
      withSwitch += 1;
      expect(switchStep(manifest), `${id} declares ${manifest.config}`).toMatchObject({
        file: manifest.config,
        why: INSTALLING_IS_NOT_SWITCHING_ON,
      });
    }
    expect(withSwitch, "at least one module in this tree keeps a switch").toBeGreaterThan(0);
  });

  it("tells the community's operator both halves of what off means", () => {
    // The measured case: routes that 404 AND a menu that stays empty. This is
    // the only module that brings menu entries, so it is the only one that can
    // produce the confusion in full.
    const manifest = JSON.parse(readFileSync(join(ROOT, "modules", "community", "module.json"), "utf8"));
    const { whileOff: said } = switchStep(manifest);
    expect(said).toContain("404");
    expect(said).toContain("menu entries stay hidden");
  });
});

describe("cli.mjs prints them", () => {
  // Read as TEXT and therefore through `blankComments()` — this file's own
  // reasoning names `afterInstall` a dozen times in prose, and so does the
  // header of `next-steps.mjs`. A checker that counts comments is a checker
  // that passes on a file which only TALKS about calling the function.
  const cli = blankComments(readFileSync(join(ROOT, "scripts", "modules", "cli.mjs"), "utf8"));

  it("imports it", () => {
    expect(cli).toMatch(/import \{[^}]*afterInstall[^}]*\} from "\.\/next-steps\.mjs"/);
  });

  it("calls it from both places — the install and the list's example", () => {
    // Two, not one: `add` is where somebody stands when they ask the question,
    // and `list` is where they look it up afterwards. One call site was the bug.
    const calls = cli.match(/afterInstall\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("renders the module-specific consequence, not only the invariant", () => {
    // The precise regression: `list` printed the invariant ("installing does not
    // switch it on") and `add` printed nothing, so nothing anywhere said what
    // OFF costs THIS module — which for the community is an empty menu.
    expect(cli).toContain("step.whileOff");
  });

  it("keeps no copy of the sentence — it renders `why`, never its own wording", () => {
    // A second copy is how the two commands start saying different things about
    // the same file, which is the state before this change in miniature.
    expect(cli).not.toMatch(/does not switch (it|a module) on/);
    expect(cli).toContain("step.why");
  });
});
