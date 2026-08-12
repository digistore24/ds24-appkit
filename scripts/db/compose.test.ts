// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Which Compose project the local database belongs to — and why the folder name
// is not allowed to be the answer.
//
// Same reason driver.test.ts exists: every wrong answer here still starts *a*
// database and still looks like a working app. It is simply somebody else's.
// The one case that produced this file — two apps in two folders both called
// `test`, one Docker volume between them — cannot be reproduced on the machine
// the suite runs on, so the paths are faked and the naming rule is measured.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { blankComments } from "../lib/source-text.mjs";

const machine = {
  envFile: true,
  env: {} as Record<string, string>,
  written: [] as [string, string][],
};

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: (target: unknown) =>
      String(target) === ".env" ? machine.envFile : actual.existsSync(target as string),
    // The directories these cases name do not exist, and resolving them is not
    // the thing under test — the hashing of the path is.
    realpathSync: (target: unknown) => String(target),
  };
});

vi.mock("../lib/env-write.mjs", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    readEnvValue: (_file: string, key: string) => machine.env[key] ?? "",
    setEnvValue: (_file: string, key: string, value: string) => {
      machine.written.push([key, value]);
    },
  };
});

async function composeModule() {
  vi.resetModules();
  return await import("./compose.mjs");
}

beforeEach(() => {
  machine.envFile = true;
  machine.env = {};
  machine.written = [];
  delete process.env.COMPOSE_PROJECT_NAME;
});

describe("the name is derived from the path, not from the folder", () => {
  // THE case. Compose's own default is the folder name, and this is what that
  // costs: the second app adopts the first one's volume and dies on the first
  // statement of its first migration with `type "ipn_result" already exists`.
  it("gives two same-named folders two different projects", async () => {
    const { deriveComposeProject } = await composeModule();
    expect(deriveComposeProject("/home/me/Project/test")).not.toBe(
      deriveComposeProject("/home/me/Other/test"),
    );
  });

  it("gives the same folder the same project every time", async () => {
    const { deriveComposeProject } = await composeModule();
    expect(deriveComposeProject("/home/me/Project/test")).toBe(
      deriveComposeProject("/home/me/Project/test"),
    );
  });

  // Readable in `docker ps` — the folder is still in there, the tail is only
  // what makes it unique.
  it("keeps the folder name in front", async () => {
    const { deriveComposeProject } = await composeModule();
    expect(deriveComposeProject("/home/me/Project/my-shop")).toMatch(/^my-shop-[0-9a-f]{8}$/);
  });

  it.each([
    ["/home/me/Meine App", /^meine-app-[0-9a-f]{8}$/],
    ["/home/me/TEST", /^test-[0-9a-f]{8}$/],
    ["/home/me/2024_app", /^2024_app-[0-9a-f]{8}$/],
    // Compose wants a letter or a digit up front; a folder that starts with a
    // dot or a dash must not produce a name it then refuses.
    ["/home/me/.hidden", /^hidden-[0-9a-f]{8}$/],
    ["/home/me/---", /^app-[0-9a-f]{8}$/],
  ])("makes a name Compose accepts out of %s", async (dir, shape) => {
    const { deriveComposeProject } = await composeModule();
    expect(deriveComposeProject(dir)).toMatch(shape);
  });
});

describe("it is decided once and written down", () => {
  it("records the derived name in .env", async () => {
    const { composeProject } = await composeModule();
    const name = composeProject();
    expect(machine.written).toEqual([["COMPOSE_PROJECT_NAME", name]]);
  });

  // Renaming or moving the project folder is a thing people do. The recorded
  // name is what keeps their database attached to it.
  it("obeys what is written down, whatever the path says", async () => {
    machine.env.COMPOSE_PROJECT_NAME = "an-older-name";
    const { composeProject, deriveComposeProject } = await composeModule();
    expect(composeProject()).toBe("an-older-name");
    expect(composeProject()).not.toBe(deriveComposeProject());
    expect(machine.written).toEqual([]);
  });

  it("takes the environment over .env", async () => {
    machine.env.COMPOSE_PROJECT_NAME = "from-env-file";
    process.env.COMPOSE_PROJECT_NAME = "from-the-shell";
    const { composeProject } = await composeModule();
    expect(composeProject()).toBe("from-the-shell");
  });

  it("still answers before there is a .env, and writes nothing", async () => {
    machine.envFile = false;
    const { composeProject } = await composeModule();
    expect(composeProject()).toMatch(/-[0-9a-f]{8}$/);
    expect(machine.written).toEqual([]);
  });

  // Same reasoning as DB_DRIVER: a name Compose refuses would fail somewhere
  // further on, in a message about a container rather than about the typo.
  it.each(["Uppercase", "has spaces", "-leading-dash", "dots.are.out"])(
    "refuses %s",
    async (value) => {
      machine.env.COMPOSE_PROJECT_NAME = value;
      const { composeProject } = await composeModule();
      expect(() => composeProject()).toThrow(/Docker Compose accepts/);
    },
  );
});

describe("the flag reaches every compose call", () => {
  it("is a -p pair", async () => {
    const { composeProjectFlag, composeProject } = await composeModule();
    expect(composeProjectFlag()).toEqual(["-p", composeProject()]);
  });
});

// ── The guard that matters after today ──────────────────────────────────────
//
// The helper is only worth anything if every `docker compose …` in the tree goes
// through it. A call site added later that forgets falls straight back onto
// Compose's default — the folder name — and does so silently: the container
// starts, the app runs, and it is simply the wrong database. Nothing else in the
// suite would notice.
//
// .env carries COMPOSE_PROJECT_NAME too, so a forgotten call would usually still
// land on the right project. "Usually" is the problem: a shell that exports the
// variable, and a run before setup has written a .env, both defeat it. `-p` is
// the half that cannot be overridden from outside.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SKIP_DIRS = new Set(["node_modules", ".next", ".dev", "dist"]);

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (SKIP_DIRS.has(entry)) continue;
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) yield* sourceFiles(rel);
    else if (/\.(mjs|js)$/.test(entry)) yield rel;
  }
}

/**
 * Does this line invoke compose without pinning the project?
 *
 * `compose version` is the one exemption and it is not a project operation at
 * all — `scripts/dev/doctor.mjs` asks it to find out whether Compose v2 is
 * installed, before there is anything to name.
 */
const unpinned = (line: string) =>
  /"compose"/.test(line) && !line.includes("composeProjectFlag") && !line.includes('"version"');

/** Every `"compose"` line in the command layer, comments blanked out. */
function composeLines() {
  const found: { file: string; line: number; text: string }[] = [];
  for (const file of [...sourceFiles("scripts"), ...sourceFiles("modules"), "run.mjs"]) {
    const source = blankComments(readFileSync(join(ROOT, file), "utf8"));
    source.split(/\r?\n/).forEach((text, index) => {
      if (/"compose"/.test(text)) found.push({ file, line: index + 1, text });
    });
  }
  return found;
}

describe("no compose call is left on the folder name", () => {
  // The needle probe. Without it a walk that finds nothing — a renamed folder, a
  // changed extension, a regex that stopped matching — reads exactly like a tree
  // with no offenders in it, and this file would go green for ever while
  // guarding nothing.
  it("really finds the compose calls that are there", () => {
    const files = new Set(composeLines().map((hit) => hit.file));
    expect(files).toContain("run.mjs");
    expect(files).toContain(join("scripts", "db", "up.mjs"));
    expect(files).toContain(join("scripts", "dev", "app.mjs"));
  });

  // …and the comparison works, not only the walk: the same predicate that
  // reports the tree has to reject a line that really is wrong.
  it("would report a call that forgot the flag", () => {
    expect(unpinned('await run("docker", ["compose", "down"]);')).toBe(true);
    expect(unpinned('await run("docker", ["compose", ...composeProjectFlag(), "down"]);')).toBe(
      false,
    );
    expect(unpinned('const v = await capture("docker", ["compose", "version"]);')).toBe(false);
  });

  it("finds none in the tree", () => {
    const offenders = composeLines()
      .filter((hit) => unpinned(hit.text))
      .map((hit) => `${hit.file}:${hit.line}`);
    expect(offenders).toEqual([]);
  });
});
