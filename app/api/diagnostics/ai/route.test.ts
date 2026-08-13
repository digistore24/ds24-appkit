// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The door `node run.mjs ai-check --live` knocks on — the half of a live check
// that can be measured without an invoice.
//
// ── What is real here ──────────────────────────────────────────────────────
//
// Everything except the provider's socket. The handler, the guard, the meter,
// `runTask()`, the binding resolution, the real OpenAI-shaped adapter and the
// real status→outcome table all run; only `fetch` is stubbed, so the provider
// answers 401, 429 or nothing at all without anybody being billed. That is the
// same arrangement `lib/ai/providers/openai-compat.test.ts` uses, one layer
// down.
//
// ── The three claims ───────────────────────────────────────────────────────
//
//   1. 🚨 **The guard is first.** An unauthenticated caller gets one bodiless
//      404 and no model call is made — an endpoint that spent money before
//      checking a bearer would be a way to run up somebody's bill from outside.
//   2. 🚨 **Every call is recorded**, exactly as CLAUDE.md requires it of every
//      model call: task, provider, model, tokens, latency, outcome, member —
//      and no prompt, no completion. Including a call that FAILED, which is the
//      row an operator most needs.
//   3. **Four endings stay four.** A key that is rejected, a provider that is
//      busy, a provider that cannot be reached and an answer that arrived come
//      back as four different bodies rather than one "it did not work".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UsageRecord } from "@/lib/ai/usage";
import { PROBE_MAX_TOKENS, PROBE_MESSAGE, PROBE_SYSTEM } from "@/lib/ai/probe.mjs";
// ⚠️ The key is set through the shared NAME TABLE, never by naming the variable
// on a `process.env` of its own — `lib/ai/providers/leak-guard.test.ts` fails
// the build on a provider credential read outside `lib/ai/providers/`, and it
// is right to: this file is a call site like any other. Measured, not guessed:
// the guard caught the first draft of this file, and then caught the COMMENT
// that explained it — it reads source as raw text, so the spelling stays out of
// the prose here too.
import { PROVIDER_ENV_VARS } from "@/lib/ai/providers/ids.mjs";

// The row is captured instead of written. `lib/ai/run.test.ts` explains why in
// full: outside a request there is no `after()`, so the real `recordUsage()`
// detaches a write that either floods stderr on a machine with no database or —
// worse — quietly inserts junk into a developer's own `ai_usage`.
const recorded: UsageRecord[] = [];
vi.mock("@/lib/ai/usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/usage")>()),
  recordUsage: (record: UsageRecord) => void recorded.push(record),
}));

import { POST } from "./route";

const SECRET = "diagnostics-secret-0123456789abcdef";

/** Every request gets its own caller, so one test's meter is not another's. */
let caller = 0;

const ask = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("https://app.example.com/api/diagnostics/ai", {
      method: "POST",
      headers: {
        authorization: `Bearer ${SECRET}`,
        "content-type": "application/json",
        "x-forwarded-for": `10.0.0.${(caller += 1)}`,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );

/** An OpenAI-shaped success, as the compat adapter expects to read it. */
const completion = {
  choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 31, completion_tokens: 2, total_tokens: 33 },
};

beforeEach(() => {
  recorded.length = 0;
  process.env.DIAGNOSTICS_SECRET = SECRET;
  // One key, so `"auto"` resolves to one company and the binding is known.
  vi.stubEnv(PROVIDER_ENV_VARS.openai, "sk-not-a-real-key");
});

afterEach(() => {
  delete process.env.DIAGNOSTICS_SECRET;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("🚨 the guard runs before any money is spent", () => {
  it("answers one bodiless 404 to a stranger, and calls nothing", async () => {
    const sent = vi.fn();
    vi.stubGlobal("fetch", sent);

    const answer = await POST(
      new Request("https://app.example.com/api/diagnostics/ai", { method: "POST" }),
    );

    expect(answer.status).toBe(404);
    expect(await answer.text()).toBe("");
    expect(sent, "a provider was called for an unauthenticated request").not.toHaveBeenCalled();
    expect(recorded).toEqual([]);
  });

  it("answers the same 404 when no DIAGNOSTICS_SECRET is configured", async () => {
    // The shipped state: `.env.example` carries the variable commented out, so
    // a fresh app is indistinguishable from one that never had this route.
    delete process.env.DIAGNOSTICS_SECRET;
    const sent = vi.fn();
    vi.stubGlobal("fetch", sent);

    const answer = await ask({ task: "chat" });

    expect(answer.status).toBe(404);
    expect(await answer.text()).toBe("");
    expect(sent).not.toHaveBeenCalled();
  });
});

describe("what it refuses to probe", () => {
  it("refuses a task it does not know, and names the ones it does", async () => {
    const sent = vi.fn();
    vi.stubGlobal("fetch", sent);

    const answer = await ask({ task: "summarise-everything" });

    expect(answer.status).toBe(400);
    const body = await answer.json();
    expect(body.error).toBe("unknownTask");
    // What it offers is what it would actually probe — never a task it would
    // refuse in the next breath.
    expect(body.known).toContain("chat");
    expect(body.known).not.toContain("image");
    expect(sent).not.toHaveBeenCalled();
  });

  it("🚨 refuses an image task rather than drawing a picture to prove a key works", async () => {
    const sent = vi.fn();
    vi.stubGlobal("fetch", sent);

    const answer = await ask({ task: "image" });
    const body = await answer.json();

    expect(answer.status).toBe(400);
    expect(body.error).toBe("notATextTask");
    expect(body.known).not.toContain("image");
    expect(sent, "an image was generated for a connectivity probe").not.toHaveBeenCalled();
  });
});

describe("a call that goes through", () => {
  it("answers with what ran, what it consumed and what it said", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(completion)));

    const answer = await ask({ task: "chat" });
    const body = await answer.json();

    expect(answer.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("openai");
    expect(body.model).toBeTruthy();
    expect(body.usage).toMatchObject({ inputTokens: 31, outputTokens: 2 });
    expect(body.said).toBe("OK");
    expect(typeof body.latencyMs).toBe("number");
  });

  it("sends the probe named in lib/ai/probe.mjs — the one the command priced", async () => {
    // The anti-drift needle. The command announces a cost BEFORE the call, off
    // the token figures in `probe.mjs`; a prompt that grew here would make that
    // announcement quietly wrong, with nothing anywhere disagreeing.
    const sent = vi.fn(async () => Response.json(completion));
    vi.stubGlobal("fetch", sent);

    await ask({ task: "chat" });

    const [, init] = sent.mock.calls[0] as unknown as [string, RequestInit];
    const request = JSON.parse(String(init.body));
    expect(request.max_tokens ?? request.max_completion_tokens).toBe(PROBE_MAX_TOKENS);
    expect(JSON.stringify(request)).toContain(PROBE_MESSAGE);
    expect(JSON.stringify(request)).toContain(PROBE_SYSTEM);
  });

  it("🚨 records the row every other call in this app records", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(completion)));

    await ask({ task: "chat" });

    expect(recorded).toHaveLength(1);
    const row = recorded[0];
    expect(row.task).toBe("chat");
    expect(row.provider).toBe("openai");
    expect(row.model).toBeTruthy();
    expect(row.outcome).toBe("ok");
    expect(row.usage).toMatchObject({ inputTokens: 31, outputTokens: 2 });
    expect(typeof row.latencyMs).toBe("number");
    // Nobody's call: the probe is the operator's, not a customer's.
    expect(row.memberId).toBeNull();
    // A numbers table. There is no column for either of these, and there must
    // be no field on the record carrying one in.
    expect(JSON.stringify(row)).not.toContain(PROBE_MESSAGE);
    expect(JSON.stringify(row)).not.toContain("OK");
  });
});

describe("🚨 the ways a call fails stay apart", () => {
  const cases = [
    { name: "a key the provider rejects", status: 401, outcome: "noCredential" },
    { name: "a model the provider does not serve", status: 404, outcome: "unknownModel" },
    { name: "a provider that is rate limiting", status: 429, outcome: "providerRefused" },
    { name: "a provider that is overloaded", status: 503, outcome: "providerRefused" },
  ] as const;

  for (const { name, status, outcome } of cases) {
    it(`reports ${name} as ${outcome}`, async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status })));

      const answer = await ask({ task: "chat" });
      const body = await answer.json();

      // 200, deliberately: the app answered in full. A non-2xx here would mean
      // "the app could not answer", which is the other half of the distinction
      // the command lives on.
      expect(answer.status).toBe(200);
      expect(body.ok).toBe(false);
      expect(body.outcome).toBe(outcome);
      // Named even though the call never produced anything — usually the answer
      // to "why is nothing working" (FR-39a).
      expect(body.provider).toBe("openai");
      expect(body.model).toBeTruthy();
    });
  }

  it("reports a provider that cannot be reached at all as its own outcome", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const body = await (await ask({ task: "chat" })).json();

    expect(body.ok).toBe(false);
    expect(body.outcome).toBe("providerUnreachable");
  });

  it("does not let the provider's own error text out of the app", async () => {
    // A provider's error body can quote the prompt back, and on a real call the
    // prompt is a Member's. It goes to the log and never into a response.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("invalid api key sk-live-abc123", { status: 401 })),
    );

    const raw = await (await ask({ task: "chat" })).text();

    expect(raw).not.toContain("sk-live-abc123");
    expect(raw).toContain("noCredential");
  });

  it("🚨 records a failed call too — that is the row an operator needs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 429 })));

    await ask({ task: "chat" });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      task: "chat",
      provider: "openai",
      outcome: "providerRefused",
      memberId: null,
    });
  });
});

describe("the meter on the spending", () => {
  it("stops one caller after a dozen calls in the window", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(completion)));
    const headers = { "x-forwarded-for": "203.0.113.9" };

    const statuses: number[] = [];
    for (let i = 0; i < 14; i += 1) {
      statuses.push((await ask({ task: "chat" }, headers)).status);
    }

    expect(statuses.filter((status) => status === 200)).toHaveLength(12);
    expect(statuses.filter((status) => status === 429)).toHaveLength(2);
    // The meter counts calls, so the refused ones cost nothing.
    expect(recorded).toHaveLength(12);
  });
});
