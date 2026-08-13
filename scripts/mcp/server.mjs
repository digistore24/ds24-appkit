#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The MCP server your coding agent talks to — stdio, hand-written, no SDK.
//
// ── What it is, and what it deliberately is not ────────────────────────────
// It is a CLIENT of your app. It resolves an environment to a URL and a key,
// posts, and hands the answer back. It holds no domain knowledge, decides
// nothing, and — 🚨 — **never opens a database connection**. There is one write
// path in this product and it is the app's own; a second one here would be a
// second implementation of every rule, and the one that drifts is always the
// one nobody is looking at. `scripts/mcp/no-db.test.ts` walks this file's
// transitive imports and fails the build on `postgres`, `drizzle-orm` or `@/db`.
//
// ── No dependency, on purpose ──────────────────────────────────────────────
// Stdio MCP is newline-delimited JSON-RPC 2.0. An SDK in every customer's
// package.json for a developer-time tool is weight on a template that works to
// keep a customer's first install quiet — every package added here is one more
// thing that can deprecate, carry an advisory or argue about a peer range in
// front of somebody who has just deployed. `lib/media/sigv4.mjs` is the standing
// precedent: this app signs its own AWS requests rather than taking an SDK for
// it.
//
// ── Dual-era, and that is a requirement rather than a hedge ────────────────
// This template is built by Claude Code, Codex, Antigravity CLI and OpenCode,
// and it cannot dictate any of their MCP client versions. Revision 2026-07-28
// made the protocol STATELESS — no `initialize`, `server/discover` mandatory,
// the version carried per request in `_meta`. Measured 2026-08-09: Claude Code
// 2.1.226 speaks it. The others are unmeasured, and one of them is unmeasurABLE
// from here — Antigravity CLI publishes no client-capability table at all, so
// "it will surely do the modern thing" is a hope rather than a finding. That is
// the whole argument for keeping both: the legacy path costs a branch, and
// dropping it would trade that for a class of client that fails by going quiet.
// Both eras are served from this one process, chosen by how the client opens.
//
// Logging goes to STDERR. stdout is the protocol; a stray console.log there
// corrupts the stream, which is the classic way one of these breaks.

import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import "../lib/env.mjs";

const MODERN = "2026-07-28";
const SUPPORTED = [MODERN, "2025-11-25", "2025-06-18"];
const SERVER_INFO = { name: "ds24-setup", title: "App setup", version: "1.0.0" };
const META_VERSION = "io.modelcontextprotocol/protocolVersion";

/** How long a client may cache `tools/list`. Short: a module can be installed. */
const TOOLS_TTL_MS = 30_000;

const log = (...parts) => process.stderr.write(`[setup-mcp] ${parts.join(" ")}\n`);

// ── environments ────────────────────────────────────────────────────────────
//
// 🚨 The destination is CONFIGURATION and never a tool argument. A request
// carries the key to whatever host it names, so a URL a model can write is a
// URL a model can be talked into writing — and the key goes with it.

// ⚠️ The variable NAMES live here beside the values, and that is not
// decoration. They were derived once — `APP_URL_${name.toUpperCase()}` — and
// the refusal then told an operator to set `APP_URL_PRODUCTION` while the code
// read `APP_URL_PROD`. They would have set it, nothing would have changed, and
// nothing would have said why. `production` is spelled `PROD` in the .env
// because that is the suffix `DIGISTORE_IPN_PASSPHRASE_PROD` and
// `MEDIA_S3_*_PROD` already use; a message that guesses it is a message that
// will be wrong.
const ENVIRONMENTS = {
  development: { urlVar: "APP_URL", keyVar: "SETUP_KEY" },
  staging: { urlVar: "APP_URL_STAGING", keyVar: "SETUP_KEY_STAGING" },
  production: { urlVar: "APP_URL_PROD", keyVar: "SETUP_KEY_PROD" },
};

const settings = (name) => {
  const vars = ENVIRONMENTS[name];
  return vars
    ? { url: process.env[vars.urlVar], key: process.env[vars.keyVar], ...vars }
    : null;
};

/** Which environments this machine is actually set up to reach. */
function configured() {
  return Object.keys(ENVIRONMENTS).filter((name) => {
    const s = settings(name);
    return s?.url && s?.key;
  });
}

function resolve(name) {
  const env = settings(name);
  if (!env) {
    return { error: `unknown environment "${name}" — development, staging or production` };
  }
  if (!env.url || !env.key) {
    // Named from the table above, so the sentence and the lookup cannot disagree.
    const missing = [!env.url && env.urlVar, !env.key && env.keyVar].filter(Boolean);
    return { error: `${name} is not configured — set ${missing.join(" and ")} in .env` };
  }
  return { url: env.url.replace(/\/+$/, ""), key: env.key };
}

/** Where `tools/list` asks. The tool list belongs to a deployed app, not here. */
const DEFAULT_ENV = configured()[0] ?? "development";

// ── talking to the app ──────────────────────────────────────────────────────

async function callApp(envName, body, file) {
  const target = resolve(envName);
  if (target.error) return { transportError: target.error };

  const url = `${target.url}/api/setup${file ? "/media" : ""}`;
  const headers = { authorization: `Bearer ${target.key}` };
  let payload;

  if (file) {
    const form = new FormData();
    form.set("tool", body.tool);
    form.set("env", body.env);
    if (body.mode) form.set("mode", body.mode);
    if (body.confirmation) form.set("confirmation", body.confirmation);
    // The SAME input object the JSON door would carry. The confirmation token
    // is bound to the canonical hash of the validated input, so a plan and its
    // apply must hash the same thing — loose form fields would arrive as
    // strings and a plan could never be applied.
    //
    // 🚨 The token is bound to the FILE too (A79), and this is where that has a
    // consequence for the operator: `readFile()` above runs once per call, so
    // the plan and the apply read the path a few seconds apart. A file that
    // changed in between is refused as `confirmationInvalid` rather than
    // uploaded — which is the point, and the answer is to plan again.
    form.set("input", JSON.stringify(body.input ?? {}));
    form.set("file", new Blob([file.bytes]), file.name);
    payload = form;
  } else {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, { method: "POST", headers, body: payload });
  } catch (error) {
    return { transportError: `${url} did not answer (${error?.message ?? error})` };
  }

  // A bodiless 404 is the switched-off surface saying nothing, deliberately.
  // Guessing "it is off" would be a claim; naming both possibilities is not.
  const text = await response.text();
  if (!response.ok && text === "") {
    return {
      transportError:
        `${url} answered ${response.status} with no body — the setup surface is either ` +
        `switched off in config/setup.json or this app does not have it. ` +
        `Run: node run.mjs setup-check`,
    };
  }
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { transportError: `${url} answered ${response.status} with something that is not JSON` };
  }
}

// ── the tool list ───────────────────────────────────────────────────────────

let toolCache = null;

/**
 * The tools THIS environment offers, plus the `env` argument the agent chooses
 * with.
 *
 * Fetched rather than hard-coded: a module installed in production contributes
 * tools that a laptop's tree knows nothing about, and a list kept here would be
 * the second copy that goes stale.
 */
async function listTools() {
  if (toolCache && Date.now() - toolCache.at < TOOLS_TTL_MS) return toolCache.tools;

  const result = await callApp(DEFAULT_ENV, { tool: "list_environment", env: DEFAULT_ENV });

  if (result.transportError || result.status !== 200) {
    // ⚠️ ONE synthetic tool rather than an empty list, and this is the
    // difference between an alarm and a silence. A client that receives no
    // tools shows the agent nothing at all, and the session proceeds as if this
    // server were pointless. A single tool whose description carries the reason
    // is something the agent reads and can repeat to the operator.
    return [
      {
        name: "setup_unavailable",
        title: "Setup surface unavailable",
        description:
          `The setup surface could not be reached: ` +
          `${result.transportError ?? `it answered ${result.status}`}. ` +
          `Configured environments: ${configured().join(", ") || "none"}. ` +
          `Call this tool for the full diagnosis.`,
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
    ];
  }

  const envs = configured();
  const tools = (result.body?.data?.tools ?? []).map((tool) => ({
    name: tool.name,
    title: tool.name,
    description: tool.description,
    inputSchema: {
      ...tool.inputSchema,
      properties: {
        // Added here rather than declared per tool: it is a property of the
        // TRANSPORT (which app am I talking to), not of the act.
        env: {
          type: "string",
          enum: envs.length > 0 ? envs : ["development"],
          description: "Which environment to act on.",
        },
        mode: {
          type: "string",
          enum: ["plan", "apply"],
          default: "plan",
          description:
            "Outside development a change needs plan first, then apply with the confirmation it returns.",
        },
        confirmation: {
          type: "string",
          description: "The token a plan returned. Store it, echo it, never parse it.",
        },
        ...tool.inputSchema.properties,
      },
      required: [...(tool.inputSchema.required ?? []), "env"],
    },
  }));

  toolCache = { at: Date.now(), tools };
  return tools;
}

// ── running one ─────────────────────────────────────────────────────────────

async function callTool(name, args) {
  const { env, mode, confirmation, ...input } = args ?? {};

  if (name === "setup_unavailable") {
    const lines = ["The setup surface could not be reached.", ""];
    for (const envName of Object.keys(ENVIRONMENTS)) {
      const entry = settings(envName);
      lines.push(
        `  ${envName.padEnd(12)} ${entry.urlVar}=${entry.url ?? "(not set)"}   ` +
          `${entry.keyVar}=${entry.key ? "set" : "(not set)"}`,
      );
    }
    lines.push("", "Next: node run.mjs setup-check");
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  if (typeof env !== "string") {
    return fail('every call needs "env": development, staging or production');
  }

  // 🚨 A PATH, read HERE. The bytes never enter the model's context, the
  // transcript or the bill — the whole of the media decision, in four lines.
  let file;
  if (name === "media_upload") {
    if (typeof input.path !== "string") return fail('"path" is required');
    try {
      const bytes = await readFile(input.path);
      file = { bytes, name: input.path.split(/[\\/]/).pop() || "upload" };
    } catch (error) {
      return fail(`could not read ${input.path}: ${error?.message ?? error}`);
    }
  }

  const result = await callApp(env, { tool: name, env, mode, confirmation, input }, file);
  if (result.transportError) return fail(result.transportError);

  return {
    content: [{ type: "text", text: JSON.stringify(result.body, null, 2) }],
    isError: result.status >= 400,
  };
}

const fail = (text) => ({ content: [{ type: "text", text }], isError: true });

// ── the protocol ────────────────────────────────────────────────────────────

/**
 * Which era we are speaking. Decided by how the client opens, per the spec's
 * dual-era server rule, and then fixed for the life of this process.
 */
let era = null;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/**
 * Wrap a result for the era in play.
 *
 * ⚠️ Two serialisers, and the difference is not cosmetic: a legacy client must
 * NOT receive `resultType`, `ttlMs` or `cacheScope`. Emitting the modern fields
 * to an old client is the failure that looks like it works locally, because the
 * machine you tested on ran the new one.
 */
function result(id, payload, cacheable = false) {
  if (era === "legacy") return send({ jsonrpc: "2.0", id, result: payload });
  const modern = { ...payload, resultType: "complete", _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO } };
  if (cacheable) {
    modern.ttlMs = TOOLS_TTL_MS;
    // "private" and not "public": the tool list reflects one operator's
    // environments, and a shared intermediary must not hand it to somebody else.
    modern.cacheScope = "private";
  }
  send({ jsonrpc: "2.0", id, result: modern });
}

function error(id, code, message, data) {
  send({ jsonrpc: "2.0", id, error: data ? { code, message, data } : { code, message } });
}

async function handle(message) {
  const { id, method, params } = message;
  const requested = params?._meta?.[META_VERSION];

  // The opening move decides the era, once.
  if (era === null) {
    era = method === "initialize" ? "legacy" : "modern";
    log(`speaking ${era}${requested ? ` (${requested})` : ""}`);
  }

  if (era === "modern" && requested && !SUPPORTED.includes(requested)) {
    return error(id, -32022, "Unsupported protocol version", {
      supported: SUPPORTED,
      requested,
    });
  }

  switch (method) {
    // Mandatory in the modern era, and also the probe a dual-era client uses
    // on stdio to find out which era it is talking to.
    case "server/discover":
      return result(id, {
        protocolVersions: SUPPORTED,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    case "initialize":
      return result(id, {
        // Answer in the client's own revision where we know it, so a legacy
        // client is not told about one it cannot speak.
        protocolVersion: SUPPORTED.includes(params?.protocolVersion)
          ? params.protocolVersion
          : "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return; // notifications carry no id and get no answer

    case "ping":
      return result(id, {});

    case "tools/list":
      return result(id, { tools: await listTools() }, true);

    case "tools/call":
      return result(id, await callTool(params?.name, params?.arguments));

    default:
      if (id === undefined) return; // an unknown notification is ignored by design
      return error(id, -32601, `Method not found: ${method}`);
  }
}

// Newline-delimited JSON-RPC. `/\r?\n/` by way of readline, which is what makes
// this behave the same in a Git Bash on Windows.
const input = createInterface({ input: process.stdin });

for await (const line of input) {
  const trimmed = line.trim();
  if (trimmed === "") continue;

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    error(null, -32700, "Parse error");
    continue;
  }

  try {
    await handle(message);
  } catch (failure) {
    log("handler failed:", failure?.stack ?? failure);
    if (message?.id !== undefined) error(message.id, -32603, "Internal error");
  }
}
