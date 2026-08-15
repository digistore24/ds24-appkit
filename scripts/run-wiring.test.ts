// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 Does `run.mjs` still point at things that exist?
//
// `run.mjs` is the customer's whole command line — `node run.mjs <command>` —
// and it is a table of 60-odd entries, each naming a script by PATH, an npm
// script by NAME, and other tasks by KEY in its `needs`.
//
// None of those three was checked. `scripts/docs-coverage.test.ts` asks whether
// every command is DOCUMENTED and `scripts/portability.test.ts` asks whether any
// of them passes a `shell:` option — both read the same table — but nothing
// asked whether the strings inside resolve. They are strings in closures, so
// `npm run typecheck` cannot see them and `scripts/imports.test.ts` does not
// either: it walks `import` specifiers, and these are arguments.
//
// The failure that leaves: somebody moves or renames a file under `scripts/`,
// every gate here stays green, and a shipped command dies in the customer's app
// with `Cannot find module` — the class of defect `scripts/lib/env.test.ts` was
// widened to the whole tree for.
//
// Read as TEXT, not imported: `run.mjs` executes the command on import — that is
// what the file is for. Comments are blanked first (CLAUDE.md → Rules), because
// this very header names script paths that do not exist.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { blankComments } from "./lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE = blankComments(readFileSync(join(ROOT, "run.mjs"), "utf8"));
const TABLE = SOURCE.slice(SOURCE.indexOf("const TASKS = {"));

/** Every entry of the table, key → body. The parse `docs-coverage` uses. */
const ENTRIES = new Map<string, string>(
  [...TABLE.matchAll(/^ {2}"?([a-z0-9_-]+)"?: \{([\s\S]*?)\n {2}\},/gm)].map(
    ([, name, body]) => [name, body] as const,
  ),
);

describe("run.mjs points at things that exist", () => {
  it("has a table this test can actually read", () => {
    // The count guard. A table this parse no longer understands would make
    // every assertion below vacuously true — green because nothing was asked.
    expect(ENTRIES.size, "the TASKS table did not parse").toBeGreaterThan(40);
  });

  it("names only scripts that are really there", () => {
    const referenced = [...SOURCE.matchAll(/\bscript\(\s*"([^"]+)"/g)].map(
      ([, path]) => path,
    );

    expect(referenced.length, "no script() call found at all").toBeGreaterThan(30);

    const missing = referenced.filter((path) => !existsSync(join(ROOT, path)));
    expect(
      [...new Set(missing)],
      "run.mjs calls script() with a path that does not exist — the command is " +
        "dead in every app built from this template, and nothing else notices",
    ).toEqual([]);
  });

  it("names only npm scripts that package.json declares", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const referenced = [...SOURCE.matchAll(/\bnpm\(\s*"([^"]+)"/g)].map(
      ([, name]) => name,
    );

    expect(referenced.length, "no npm() call found at all").toBeGreaterThan(0);

    const missing = referenced.filter((name) => !(name in pkg.scripts));
    expect(
      [...new Set(missing)],
      "run.mjs calls an npm script package.json does not declare",
    ).toEqual([]);
  });

  it("has a `needs` graph whose every edge lands on a real task", () => {
    const edges = [...ENTRIES.values()].reduce(
      (n, body) => n + needsOf(body).length,
      0,
    );
    expect(edges, "no needs edge found at all").toBeGreaterThan(10);

    expect(
      danglingIn(ENTRIES),
      "a task depends on one that does not exist — `run.mjs` would throw " +
        "before running anything",
    ).toEqual([]);
  });

  it("🚨 has no cycle in `needs` — a cycle is an app that never starts", () => {
    // `run.mjs` resolves prerequisites depth-first with a `done` set, so a cycle
    // does not loop for ever: it silently SKIPS the second visit, and a task
    // whose prerequisite has not finished runs anyway. `start` needing
    // `db-migrate` needing `start` would begin the app without its database.
    expect(cyclesIn(ENTRIES)).toEqual([]);
  });

  it("🚨 the walk can SEE a dangling edge and a cycle", () => {
    // The needle, and it drives the SAME functions the two tests above use —
    // not a re-implementation of them. Both of those assert "this list is
    // empty", and an empty list is also what a parse that understood nothing
    // produces.
    const fake = new Map<string, string>([
      ["a", 'needs: ["b", "nope"],'],
      ["b", 'needs: ["a"],'],
    ]);

    expect(danglingIn(fake)).toEqual(["a → nope"]);
    expect(cyclesIn(fake)).toEqual(["a → b → a"]);

    // And a graph that is fine really answers with nothing, so the two above
    // are not simply always-true.
    const sound = new Map<string, string>([
      ["a", 'needs: ["b"],'],
      ["b", "run: () => {},"],
    ]);
    expect(danglingIn(sound)).toEqual([]);
    expect(cyclesIn(sound)).toEqual([]);

    // And `needsOf` really reads the array rather than matching anything.
    expect(needsOf('needs: ["env", "node_modules"],')).toEqual([
      "env",
      "node_modules",
    ]);
    expect(needsOf("run: () => {},")).toEqual([]);
  });
});

/** Edges pointing at a task that is not in the table. */
function danglingIn(entries: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [task, body] of entries) {
    for (const need of needsOf(body)) {
      if (!entries.has(need)) out.push(`${task} → ${need}`);
    }
  }
  return out;
}

/** Every cycle reachable in the `needs` graph, as a readable path. */
function cyclesIn(entries: Map<string, string>): string[] {
  const state = new Map<string, "open" | "closed">();
  const cycles: string[] = [];

  const walk = (task: string, path: string[]) => {
    if (state.get(task) === "closed") return;
    if (state.get(task) === "open") {
      cycles.push([...path.slice(path.indexOf(task)), task].join(" → "));
      return;
    }
    state.set(task, "open");
    for (const need of needsOf(entries.get(task) ?? "")) {
      if (entries.has(need)) walk(need, [...path, task]);
    }
    state.set(task, "closed");
  };

  for (const task of entries.keys()) walk(task, []);
  return cycles;
}

// 🚨 `ds24-sync` runs TWO scripts, and the order plus the failure handling
// between them is what stops a refused product sync from being followed by an
// IPN registration — which, while `APP_URL` is local, also opens a Cloudflare
// tunnel and puts the machine on the internet.
//
// It holds today for a reason that is easy to lose: `script()` exits the
// process on a non-zero code, so `sync-products.mjs` refusing (exit 2) ends
// the run before `ipn-setup.mjs` is reached. Make `script()` tolerant, or swap
// the two lines, and the gate in `sync-products.mjs` still refuses — but the
// second half runs anyway, against a registry the first half declined to
// write. Nothing else in this repo asks either question.
describe("ds24-sync stops at the first script that refuses", () => {
  const body = ENTRIES.get("ds24-sync") ?? "";

  it("has an entry this test can read", () => {
    // Count guard, same reason as the table's: a renamed command would make
    // every assertion below vacuously true.
    expect(body, "no ds24-sync entry in the TASKS table").not.toBe("");
  });

  it("syncs the products before it registers the IPN", () => {
    const products = body.indexOf("scripts/ds24/sync-products.mjs");
    const ipn = body.indexOf("scripts/ds24/ipn-setup.mjs");
    expect(products).toBeGreaterThan(-1);
    expect(ipn).toBeGreaterThan(products);
  });

  it("awaits both, so the second cannot start before the first has answered", () => {
    expect(body).toContain('await script("scripts/ds24/sync-products.mjs"');
    expect(body).toContain('await script("scripts/ds24/ipn-setup.mjs"');
  });

  it("script() ends the run on a non-zero exit code", () => {
    // The mechanism the two assertions above rely on. Asserted where it
    // lives rather than assumed: this one line is what makes a refusal in
    // the first script bind on the second.
    const helper = SOURCE.slice(SOURCE.indexOf("async function script("));
    expect(helper.slice(0, 200)).toContain("if (code !== 0) process.exit(code)");
  });
});

/** The `needs: [...]` of one entry body. `[]` when it declares none. */
function needsOf(body: string): string[] {
  const match = /needs:\s*\[([^\]]*)\]/.exec(body);
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map(([, name]) => name);
}
