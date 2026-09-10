// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 WHERE `node run.mjs update` writes — the one question the other three
// update tests do not ask.
//
// `update-plan.test.ts` pins what may be replaced, `update-apply.test.ts` the
// order of the writing, `update-check.test.ts` the greeting's line. All three
// take the manifest's paths as given, and the manifest is the least trustworthy
// thing in the whole mechanism: it is fetched over the network, from an address
// that lives in `.template-version` — a git-tracked file in the customer's own
// app. A commit there and the next `--apply` writes wherever that commit says.
//
// So this file runs the real command against a hand-written manifest served by
// a throwaway server on 127.0.0.1, with two paths a manifest must never get
// away with:
//
//   ../../.git/hooks/pre-commit   code that runs at the customer's next commit
//   .env                          every secret the app has
//
// And it asserts more than the exit code. The app under test sits two
// directories deep inside a temporary root, so `../../` is still INSIDE the
// root and a traversal would land somewhere this test can see; the assertion is
// then that the root is untouched — a refusal that leaves directories behind is
// not a refusal. The server counts its requests too: stopping before the first
// file is fetched is what "nothing was half-applied" means here.
//
// `spawnSync` would deadlock — the server answering the request lives in this
// process — so the child is spawned and awaited, the same way
// `scripts/content/check.test.ts` does it.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { normalizeText } from "./update-plan.mjs";

const SCRIPT = fileURLToPath(new URL("./update.mjs", import.meta.url));

/** The same hash the command computes — content, not line endings. */
const sha256 = (text: string) =>
  createHash("sha256").update(normalizeText(text), "utf8").digest("hex");

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  /** The temporary root. The app lives two levels down inside it. */
  root: string;
  /** Where the command ran, and where an honest update writes. */
  cwd: string;
  /** Every path the command asked the server for, in order. */
  requests: string[];
}

/**
 * Run the real `update --apply` against a manifest of this test's making.
 *
 * `--from` is passed on purpose: the host pin would otherwise refuse 127.0.0.1
 * before the paths are ever looked at, and it is the PATHS that are on trial
 * here. That is exactly the resolution the fix takes — a foreign host is
 * allowed when somebody asked for it on the command line, and the allowlist
 * holds anyway.
 */
async function runUpdate(
  files: Record<string, string>,
  options: { from?: boolean; shipped?: Record<string, string> } = {},
): Promise<Run> {
  const root = mkdtempSync(path.join(tmpdir(), "ds24-update-guard-"));
  temporary.push(root);
  const cwd = path.join(root, "app", "here");
  mkdirSync(cwd, { recursive: true });

  // Both filled in once the port is known — the manifest has to name the
  // address of the server that serves it.
  let manifest = "";
  const served = new Map<string, string>();
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const url = request.url ?? "/";
    requests.push(url);
    const body = url === "/.template-version" ? manifest : served.get(url);
    if (body === undefined) {
      response.writeHead(404).end("no");
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  manifest = JSON.stringify({
    version: "9.9.9",
    raw: `${origin}/`,
    files: Object.fromEntries(Object.entries(files).map(([file, text]) => [file, sha256(text)])),
  });
  // ⚠️ Keyed by the address the command really asks for, not by the manifest's
  // spelling of it: `fetch()` resolves `.../../../.git/hooks/pre-commit` to
  // `/.git/hooks/pre-commit` before the request goes out. Serving it under the
  // raw key instead would answer 404, the command would stop on the failed
  // download, and this test would go green for a reason that has nothing to do
  // with the guard — measured: with the allowlist neutered it still exited 1.
  for (const [file, text] of Object.entries(files)) {
    served.set(new URL(file, `${origin}/`).pathname, text);
  }

  writeFileSync(path.join(cwd, "package.json"), `${JSON.stringify({ version: "9.9.9" })}\n`);
  writeFileSync(
    path.join(cwd, ".template-version"),
    `${JSON.stringify({
      version: "9.9.8",
      source: `${origin}/.template-version`,
      raw: `${origin}/`,
      files: options.shipped ?? {},
    })}\n`,
  );

  const args = [SCRIPT, "--apply"];
  if (options.from !== false) args.push("--from", `${origin}/.template-version`);

  try {
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve) => {
        const child = spawn(process.execPath, args, { cwd });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("close", (code) => resolve({ code, stdout, stderr }));
      },
    );
    return { ...result, root, cwd, requests };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** What the app folder held before the command ran, and must still hold. */
const UNTOUCHED = [".template-version", "package.json"];

describe("update refuses a manifest that names a path it may not write", () => {
  it("🚨 stops on ../../.git/hooks/pre-commit, before anything is written", async () => {
    // The needle. A manifest entry that walks out of the app and lands in
    // .git/hooks is code execution at the customer's next commit — the one
    // finding in this mechanism that reaches all the way there.
    const run = await runUpdate({
      "docs/cron.md": "# Cron\n",
      "../../.git/hooks/pre-commit": "#!/bin/sh\necho pwned\n",
    });

    expect(run.code).toBe(1);
    expect(run.stderr).toContain("../../.git/hooks/pre-commit");
    expect(run.stderr).toContain("may not write");

    // Nothing written, anywhere: not the offered path, not the innocent one
    // beside it, and not a single directory on the way to either.
    expect(readdirSync(run.root)).toEqual(["app"]);
    expect(readdirSync(run.cwd).sort()).toEqual(UNTOUCHED);
    expect(existsSync(path.join(run.root, ".git"))).toBe(false);

    // And it stopped before fetching: the manifest was the only request.
    expect(run.requests).toEqual(["/.template-version"]);
  });

  it("🚨 stops on .env, before anything is written", async () => {
    // The second needle, and it needs no traversal at all — `.env` is a plain
    // relative path inside the app, which is what makes an exclusion list the
    // wrong shape and an allowlist the right one.
    const run = await runUpdate({
      "docs/cron.md": "# Cron\n",
      ".env": "DATABASE_URL=postgres://attacker\n",
    });

    expect(run.code).toBe(1);
    expect(run.stderr).toContain(".env");
    expect(readdirSync(run.root)).toEqual(["app"]);
    expect(readdirSync(run.cwd).sort()).toEqual(UNTOUCHED);
    expect(run.requests).toEqual(["/.template-version"]);
  });

  it("🚨 takes the whole manifest down, not just the bad entry", async () => {
    // The property that is easy to lose in a refactor: skipping the offending
    // path and applying the rest would write guidance from a source we have
    // just caught lying, and it would look like an ordinary update while doing
    // it. `docs/cron.md` is a perfectly good file and it must NOT arrive.
    const run = await runUpdate({
      "docs/cron.md": "# Cron\n",
      "CLAUDE.md": "# Guardrails\n",
      ".env": "SECRET=1\n",
    });

    expect(run.code).toBe(1);
    expect(existsSync(path.join(run.cwd, "docs", "cron.md"))).toBe(false);
    expect(existsSync(path.join(run.cwd, "CLAUDE.md"))).toBe(false);
    expect(readdirSync(run.cwd).sort()).toEqual(UNTOUCHED);
  });

  it("still writes an ordinary guidance file", async () => {
    // The counter-needle. A guard that refuses everything passes all three
    // tests above and breaks the command — this is what says it did not.
    const run = await runUpdate({ "docs/cron.md": "# Cron\n" });

    expect(run.code).toBe(0);
    expect(readFileSync(path.join(run.cwd, "docs", "cron.md"), "utf8")).toBe("# Cron\n");
    expect(run.requests).toContain("/docs/cron.md");

    // The stamp moved on for the file that was really written.
    const stamp = JSON.parse(readFileSync(path.join(run.cwd, ".template-version"), "utf8"));
    expect(stamp.files["docs/cron.md"]).toBe(sha256("# Cron\n"));
  });

  it("says out loud that --from is reading a foreign host", async () => {
    // Allowed, never silent: a foreign host somebody typed on the command line
    // is a decision, one that arrived in a file is the finding.
    const run = await runUpdate({ "docs/cron.md": "# Cron\n" });
    expect(run.stderr).toContain("foreign host");
  });

  it("🚨 refuses a foreign host that came out of .template-version", async () => {
    // Without `--from` there is nobody to have decided it, so the address in
    // the stamp is simply not believed — and this happens before the fetch, so
    // the manifest is never even read.
    const run = await runUpdate({ "docs/cron.md": "# Cron\n" }, { from: false });

    expect(run.code).toBe(1);
    expect(run.stderr).toContain("raw.githubusercontent.com");
    expect(run.requests).toEqual([]);
    expect(readdirSync(run.cwd).sort()).toEqual(UNTOUCHED);
  });
});
