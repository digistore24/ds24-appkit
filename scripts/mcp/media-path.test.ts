// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The one filesystem boundary the MCP server has, driven through the REAL
// process rather than asserted about its source.
//
// `media_upload` is the only branch in `server.mjs` that opens a local file, and
// the `path` it opens was written by a model. Until the security review of
// 2026-08-18 (L-2) it opened whatever it was handed: a prompt-injected coding
// agent asking for `~/Documents/backup.zip` had the operator's home directory
// read here, posted to the app, and stored under a delivery URL. The magic-byte
// check at the far end turns a `.env` or an SSH key away — which is why the
// finding was LOW — but that is a property of the store, not of this door.
//
// ── Why a spawned process and not an import ────────────────────────────────
// `server.mjs` is a script: importing it attaches a readline interface to
// stdin and starts serving. So the test speaks the protocol to it the way a
// client does — one JSON-RPC line in, one line out — which is also the only way
// to measure the branch as it actually runs, ordering included.
//
// ── Why no environment is configured ───────────────────────────────────────
// The refusal happens BEFORE the read and long before the post, so nothing here
// needs an app to talk to. The control case below leans on exactly that: an
// in-project path gets past the boundary and then fails for a completely
// different reason, which is what distinguishes a boundary from a tool that has
// simply stopped working.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SERVER = join(ROOT, "scripts", "mcp", "server.mjs");

/**
 * Call one tool through a freshly spawned server and give back its text.
 *
 * The server answers a `tools/call` with a `content: [{ type: "text", text }]`
 * whether or not it succeeded — `isError` is the other half — so both are
 * returned and the tests read whichever they are about.
 */
async function callTool(args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    // 🚨 An empty destination table on purpose. A configured environment would
    // make the control case below reach the network, and a test that reaches the
    // network is a test that fails on an aeroplane.
    env: {
      ...process.env,
      APP_URL: "",
      SETUP_KEY: "",
      APP_URL_STAGING: "",
      SETUP_KEY_STAGING: "",
      APP_URL_PROD: "",
      SETUP_KEY_PROD: "",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  try {
    const lines = createInterface({ input: child.stdout });
    const answer = new Promise<string>((ok, fail) => {
      lines.once("line", ok);
      child.once("error", fail);
      child.once("exit", () => fail(new Error("the server exited without answering")));
    });

    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "media_upload", arguments: args },
      })}\n`,
    );

    const parsed = JSON.parse(await answer);
    const content = parsed.result?.content?.[0]?.text ?? JSON.stringify(parsed);
    return { text: String(content), isError: parsed.result?.isError === true };
  } finally {
    child.kill();
  }
}

describe("🚨 media_upload reads inside the project and nowhere else", () => {
  it("refuses an absolute path above the project", async () => {
    // One directory up from the app is the developer's own workspace, and two
    // is everything they own. Built from the root rather than written out, so
    // the case means the same thing on a machine laid out differently.
    const outside = resolve(ROOT, "..", "not-this-app.png");

    const { text, isError } = await callTool({ env: "development", path: outside });

    expect(isError).toBe(true);
    expect(text).toMatch(/refusing to read outside the project/);
  }, 20_000);

  it("refuses a traversal that starts inside", async () => {
    // The shape a path arrives in when a model has been talked into it: a
    // plausible prefix, then `..`. A `startsWith("public/")` check would pass
    // this; resolving first is what does not.
    const { text, isError } = await callTool({
      env: "development",
      path: "public/../../not-this-app.png",
    });

    expect(isError).toBe(true);
    expect(text).toMatch(/refusing to read outside the project/);
  }, 20_000);

  it("refuses the project directory itself", async () => {
    // "" out of `relative()`. A directory is not a file, so the read would fail
    // anyway — but with a message about EISDIR rather than about the rule, and
    // the rule is what an operator has to be told.
    const { text, isError } = await callTool({ env: "development", path: "." });

    expect(isError).toBe(true);
    expect(text).toMatch(/refusing to read outside the project/);
  }, 20_000);

  it("🚨 lets an in-project file THROUGH — the boundary is not a wall", async () => {
    // The non-vacuity half, and the reason the two above mean anything. A branch
    // that had come to refuse everything would satisfy every assertion above
    // while breaking the only thing this tool does. `package.json` is in every
    // checkout, so the file is read, the environment is then found to be
    // unconfigured, and the answer is about THAT — never about the boundary.
    const { text } = await callTool({ env: "development", path: "package.json" });

    expect(text).not.toMatch(/refusing to read outside the project/);
    expect(text).toMatch(/not configured|APP_URL/);
  }, 20_000);

  it("still refuses a call with no path at all", async () => {
    const { text, isError } = await callTool({ env: "development" });
    expect(isError).toBe(true);
    expect(text).toMatch(/"path" is required/);
  }, 20_000);
});
