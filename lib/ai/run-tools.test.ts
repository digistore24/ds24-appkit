// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `tools` and `toolChoice` travel from TaskInput into the adapter's request —
// the one line in `buildRequest` whose absence every other test would survive:
// the tool loop mocks `streamTask`, the adapters are fed requests directly,
// and a dropped field here would surface as "the model never calls tools",
// which reads like a prompt problem. Own file because `run.test.ts`'s last
// test deliberately reaches the REAL registry and this one must mock it.
import { describe, expect, it, vi } from "vitest";

import type { Adapter, NormalizedRequest } from "./providers/types";

const requests: NormalizedRequest[] = [];

const captureAdapter: Adapter = {
  id: "openai",
  async complete(req) {
    requests.push(req);
    return { text: "ok", usage: null, stopReason: null, toolCalls: [] };
  },
  async *stream(req) {
    requests.push(req);
    yield { type: "done", usage: null, stopReason: null };
  },
};

vi.mock("./providers/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./providers/registry")>()),
  adapterFor: () => ({ adapter: captureAdapter, key: "test-key" }),
}));

vi.mock("./usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./usage")>()),
  recordUsage: () => {},
}));

import { runTask, streamTask } from "./run";

const TOOLS = [
  { name: "content_search", description: "Searches.", inputSchema: { type: "object" } },
];

describe("the tool fields reach the adapter", () => {
  it("streamTask passes tools and toolChoice through", async () => {
    requests.length = 0;
    for await (const event of streamTask("chat", {
      messages: [{ role: "user", content: "hi" }],
      tools: TOOLS,
      toolChoice: "none",
    })) {
      void event;
    }
    expect(requests[0].tools).toEqual(TOOLS);
    expect(requests[0].toolChoice).toBe("none");
  });

  it("runTask passes them too and hands toolCalls back", async () => {
    requests.length = 0;
    const result = await runTask("chat", {
      messages: [{ role: "user", content: "hi" }],
      tools: TOOLS,
    });
    expect(requests[0].tools).toEqual(TOOLS);
    expect(requests[0].toolChoice).toBeUndefined();
    expect(result.toolCalls).toEqual([]);
  });

  it("a call without tools carries neither field", async () => {
    requests.length = 0;
    await runTask("chat", { messages: [{ role: "user", content: "hi" }] });
    expect(requests[0].tools).toBeUndefined();
    expect(requests[0].toolChoice).toBeUndefined();
  });
});
