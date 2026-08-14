// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 What `content-check` PRINTS and what it EXITS with are the same statement.
//
// They were not. The command rendered the reports itself — `✗ core could not
// answer` for a report carrying `unanswered` — and then took its exit code from
// `data.problems`, the array the deployed app sends along. Measured in Story
// 42.3 and reproduced by the first test below: a report with `unanswered` beside
// an empty `problems` printed the cross, then printed
// `✓ every owner answered, nothing missing`, and exited **0**. A cross on the
// screen and a tick in the exit code, on the command that gates a go-live.
//
// Two things made that possible and both are gone:
//
//   · the verdict came from the OTHER side of an HTTP call — a deployed app that
//     may be older than this checkout — while the printing happened here;
//   · `data?.problems ?? []` collapsed "the answer carried no problems array"
//     into "there are no problems", which is Epic 42's error class sitting in
//     the judgement path.
//
// ── Why this test spawns the real command ──────────────────────────────────
// The claim is about an exit CODE and the lines above it, and neither exists
// until the script runs top to bottom. So the environment is a throwaway HTTP
// server on 127.0.0.1 — the same door `scripts/setup/client.mjs` opens against a
// real app (`POST /api/setup`) — and the assertions read the process's real
// stdout and real status. `spawnSync` would deadlock: the server answering the
// request lives in THIS process, so the child is spawned and awaited.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { loadManifest } from "./_manifest.mjs";

const SCRIPT = fileURLToPath(new URL("./check.mjs", import.meta.url));
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

interface Item {
  what: string;
  found: number;
  expected: number | null;
  missing?: string[];
  note?: string;
  notChecked?: string;
}
interface Report {
  owner: string;
  items: Item[];
  unanswered?: string;
}

/**
 * Run `node scripts/content/check.mjs` against an environment that answers
 * exactly `payload`, and hand back what an operator would have seen.
 *
 * The `data` envelope is the setup surface's own (`lib/setup/dispatch.ts`), so
 * the command is not being handed a shape only this test produces.
 */
async function check(payload: { reports?: unknown; problems?: unknown }) {
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: { appEnv: "development", ...payload } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    return await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, [SCRIPT], {
        cwd: ROOT,
        // Set here, so `scripts/lib/env.mjs` leaves them alone — an already-set
        // variable wins over the `.env`, which is what keeps this test from
        // depending on whatever the machine's own `.env` says.
        env: { ...process.env, APP_URL: `http://127.0.0.1:${port}`, SETUP_KEY: "test-key" },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/**
 * How many product files THIS checkout declares.
 *
 * 🚨 Read rather than assumed, because `check.mjs` reads it too: it compares
 * the environment's answer against `loadManifest(ROOT)` and exits 1 when the
 * environment is behind this tree (`declaredVsReported()`). Fixtures with the
 * numbers typed in were fine in the template, which declares none — and turned
 * red in the first app that shipped two files, i.e. in any app that used the
 * feature. The claim these tests make is about EXIT CODES; how much content the
 * app happens to hold is not part of it.
 *
 * The root is the script's own, not `process.cwd()` — `check.mjs` derives it
 * from `import.meta.url`, so there is no working directory to move this into.
 */
const DECLARED = (() => {
  const manifest = loadManifest(ROOT) as {
    missing?: boolean;
    entries?: unknown[];
  };
  return manifest.missing ? 0 : (manifest.entries?.length ?? 0);
})();

/** Always ahead of what this checkout declares, so the tree can never disagree. */
const COUNT = DECLARED + 2;

const clean: Report = {
  owner: "core",
  items: [{ what: "product media", found: COUNT, expected: COUNT }],
};

describe("the exit code is the reports, not the payload's verdict", () => {
  it("🚨 an owner that could not answer is exit 1 — even beside an empty `problems`", async () => {
    // THE NEEDLE. Exactly the answer Story 42.3 measured: the app names an owner
    // that could not look, and sends `problems: []` — an old build, a build whose
    // aggregation is not this one's, a body somebody rewrote. Before this change
    // the command printed the cross and exited 0.
    const run = await check({
      reports: [
        { owner: "core", items: [], unanswered: "content/media-manifest.json is not valid JSON" },
      ],
      problems: [],
    });

    expect(run.stdout).toContain("✗ core         could not answer");
    expect(
      run.stdout,
      "the command printed a cross and then a tick — the defect this test exists for",
    ).not.toContain("every owner answered");
    // Named, not merely counted: an operator has to know WHICH owner went silent.
    expect(run.stdout).toContain("core: could not answer — content/media-manifest.json");
    expect(run.code, `content-check exited ${run.code}: ${run.stderr}`).toBe(1);
  });

  it("a named missing object is exit 1 while `problems` says nothing", async () => {
    const run = await check({
      reports: [
        {
          owner: "core",
          items: [
            {
              what: "product media",
              found: COUNT - 1,
              expected: COUNT,
              missing: ["kurs/cover.png (a media row, but no object in the store)"],
            },
          ],
        },
      ],
      problems: [],
    });

    expect(run.stdout).toContain("missing: kurs/cover.png");
    expect(run.code).toBe(1);
  });

  it("the payload's `problems` is not read at all", async () => {
    // The other direction, and the positive proof that the array left the
    // judgement path: a clean set of reports stays clean even when the answer
    // carries a sentence that no report of its own supports. An honest app
    // cannot produce that pair — `lib/setup/tools.ts` computes `problems` from
    // these very reports with this very function — which is exactly why the
    // command does not need to read it, and why comparing the two answers was
    // rejected as a design.
    const run = await check({ reports: [clean], problems: ["core: something invented"] });

    expect(run.stdout).not.toContain("something invented");
    expect(run.code).toBe(0);
  });

  it("🚨 an answer with no reports at all is a refusal, not an empty environment", async () => {
    // The `?? []` this story removed, in its second hiding place: no `reports`
    // key would have meant no problems, which would have meant green.
    const run = await check({ problems: [] });

    expect(run.stderr).toContain("without a single presence report");
    expect(run.code).toBe(1);
  });
});

describe("the states that were already right stay right", () => {
  it("a clean answer is still exit 0 and still says so", async () => {
    const run = await check({ reports: [clean], problems: [] });

    expect(run.stdout).toContain(`✓ core         product media: ${COUNT} of ${COUNT}`);
    expect(run.stdout).toContain("✓ every owner answered, nothing missing.");
    expect(run.code, `content-check exited ${run.code}: ${run.stderr}`).toBe(0);
  });

  it("`⏭ not checked` is neither a pass nor a finding — exit 0, and the smaller claim", async () => {
    // A47's third state. A store that did not answer has said nothing about the
    // customer's content, so it must not become a problem — and it must not
    // disappear into a tick either.
    const run = await check({
      reports: [
        {
          owner: "core",
          items: [
            {
              what: "product media",
              found: COUNT,
              expected: COUNT,
              notChecked: "the media store was not asked — MEDIA_S3_BUCKET is not set",
            },
          ],
        },
      ],
      problems: [],
    });

    expect(run.stdout).toContain(`⏭ core         product media: ${COUNT} of ${COUNT}`);
    expect(run.stdout).toContain("1 thing(s) NOT checked");
    expect(run.stdout).toContain("nothing missing among what was checked");
    expect(run.code, `content-check exited ${run.code}: ${run.stderr}`).toBe(0);
  });

  it("a module that could not answer fails the run the core cannot see", async () => {
    // The reason the command exists at all: the core is fine and a module is not.
    const run = await check({
      reports: [clean, { owner: "courses", items: [], unanswered: "no presence check shipped" }],
      problems: [],
    });

    expect(run.stdout).toContain("✗ courses      could not answer");
    expect(run.code).toBe(1);
  });
});
