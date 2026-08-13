// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The `--live` half of `node run.mjs ai-check`, measured without spending
// anything.
//
// ── What is real here and what is stood in for ─────────────────────────────
//
// A live run costs money at a provider and needs a key, so this file cannot
// make one — and it does not pretend to. What it CAN measure, completely, is
// everything either side of the money:
//
//   · the plan and its price, before a call is made;
//   · the transport, against a real HTTP server on a real socket;
//   · the sentence every ending gets, and that no two endings share one.
//
// The one link this file does not own — a provider's HTTP status becoming an
// outcome code — is measured where it lives: `lib/ai/providers/openai-compat.test.ts`
// asserts 401 → `noCredential`, 429 → `providerRefused`, 404 → `unknownModel`
// and the rest of the table, and `app/api/diagnostics/ai/route.test.ts` proves
// the door hands those codes on unchanged. So the chain from "the provider said
// 429" to "the operator is told to wait a minute" is covered end to end, with
// no invoice anywhere in it.
//
// 🚨 **The distinctness test below is the point of the whole file.** "Could not
// look" and "there is nothing there" must never read alike, and neither must
// "your key is dead" and "the provider is busy" — those two arrive from statuses
// one apart and send somebody to two different places.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OUTCOMES, askApp, describeOutcome, describeSkip, planCost, probePlan } from "./live.mjs";
import { LIVE_PATH } from "../../lib/ai/probe.mjs";
import { PROVIDER_ENV_VARS, PROVIDER_IDS } from "../../lib/ai/providers/ids.mjs";

// ── a real server on a real socket ──────────────────────────────────────────
//
// A stubbed `fetch` would test this file against a mock of the thing it exists
// to talk to. The transport's whole job is what happens on a socket — a refused
// connection, a redirect, a body that is not the expected shape — so the tests
// use one.

const servers: Server[] = [];

async function serve(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

/** Answers one JSON body with one status, and remembers what it was asked. */
async function serveJson(status: number, body: unknown) {
  const seen: { method?: string; url?: string; auth?: string; body?: string }[] = [];
  const origin = await serve((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      seen.push({
        method: request.method,
        url: request.url,
        auth: request.headers.authorization,
        body: raw,
      });
      response.writeHead(status, { "content-type": "application/json" });
      response.end(typeof body === "string" ? body : JSON.stringify(body));
    });
  });
  return { origin, seen };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  vi.resetModules();
});

// ── the plan ────────────────────────────────────────────────────────────────

const MODELS = {
  default: { provider: "auto", model: "auto", maxTokens: 2000 },
  tasks: {
    chat: { provider: "auto", model: "auto", maxTokens: 4000 },
    image: { provider: "auto", model: "auto" },
    companion: { provider: "auto", model: "auto", maxTokens: 4000 },
  },
};

describe("what a live run would call", () => {
  it("calls one binding once, however many tasks share it", () => {
    // The shipped app: chat and companion both on "auto", so both land on the
    // same company and the same model. Two calls would bill twice for one
    // answer — and dropping the second task from the report would read as it
    // having been skipped.
    const plan = probePlan(MODELS, ["openai"]);

    expect(plan.problem).toBeNull();
    expect(plan.skip).toBeNull();
    expect(plan.calls).toHaveLength(1);
    expect(plan.calls[0].provider).toBe("openai");
    expect(plan.calls[0].alsoFor).toEqual(["companion"]);
  });

  it("calls each binding when the tasks are on different companies", () => {
    const plan = probePlan(
      {
        ...MODELS,
        tasks: {
          ...MODELS.tasks,
          companion: { provider: "mistral", model: "mistral-large-latest" },
        },
      },
      ["openai", "mistral"],
    );

    expect(plan.calls.map((call) => `${call.provider}/${call.model}`)).toEqual([
      "openai/gpt-5.6-luna",
      "mistral/mistral-large-latest",
    ]);
  });

  it("never probes an image task, and says why rather than dropping it", () => {
    const plan = probePlan(MODELS, ["openai"]);

    expect(plan.calls.some((call) => call.task === "image")).toBe(false);
    expect(plan.notProbed.map((entry) => entry.task)).toEqual(["image"]);
    expect(plan.notProbed[0].why).toMatch(/per picture/);
  });

  it("refuses --task image with a reason instead of calling nothing quietly", () => {
    const plan = probePlan(MODELS, ["openai"], { only: "image" });

    expect(plan.calls).toEqual([]);
    expect(plan.problem).toMatch(/image/);
    expect(plan.problem).toMatch(/no text task/);
  });

  it("skips, rather than guesses, when this machine has no key", () => {
    const plan = probePlan(MODELS, []);

    expect(plan.skip).toBe("noKey");
    expect(plan.calls).toEqual([]);
    expect(plan.problem).toBeNull();
  });

  it("🚨 does NOT read this machine's keys when the app is somewhere else", () => {
    // With --url the call is made by an app whose keys are its own. Resolving
    // "auto" here would print a company name for a machine this command has
    // never looked at — and it would be right only by luck.
    const plan = probePlan(MODELS, [], { remote: true });

    expect(plan.skip).toBeNull();
    expect(plan.calls).toHaveLength(1);
    expect(plan.calls[0].provider).toBe("auto");
    expect(plan.calls[0].alsoFor).toEqual(["companion"]);
  });
});

describe("🚨 a plan that measured nothing is a failure, not a pass", () => {
  it("fails when no text task is declared at all", async () => {
    vi.resetModules();
    vi.doMock("../../lib/ai/task-rules.mjs", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../lib/ai/task-rules.mjs")>()),
      TASKS: [],
    }));

    const { probePlan: walk } = await import("./live.mjs");
    const plan = walk(MODELS, ["openai"]);

    expect(plan.calls).toEqual([]);
    expect(plan.problem).toMatch(/no text task is declared/);
    // The half that matters: it is not reported as a skip, and not as clean.
    expect(plan.skip).toBeNull();
  });

  it("fails when the app knows no provider at all", async () => {
    vi.resetModules();
    vi.doMock("../../lib/ai/providers/ids.mjs", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../lib/ai/providers/ids.mjs")>()),
      PROVIDER_IDS: [],
    }));

    const { probePlan: walk } = await import("./live.mjs");
    const plan = walk(MODELS, ["openai"]);

    expect(plan.problem).toMatch(/no provider is known/);
    expect(plan.skip).toBeNull();
  });

  it("recognises a healthy plan, so the two guards above mean something", () => {
    // Non-vacuity. Both guards fire on a tree that has been broken on purpose;
    // this is the same walk on the tree as it ships.
    expect(probePlan(MODELS, ["openai"]).problem).toBeNull();
    expect(PROVIDER_IDS.length).toBeGreaterThan(0);
  });
});

// ── the money, said first ───────────────────────────────────────────────────

const PRICES = {
  defaultCurrency: "USD",
  models: {
    // The same shape `config/ai-prices.json` uses: whole currency units per
    // MILLION tokens.
    "openai/gpt-5.6-luna": { input: 1, output: 6 },
  },
};

describe("what it says it will cost", () => {
  it("prices each call and totals them", () => {
    const cost = planCost(PRICES, [
      { provider: "openai", model: "gpt-5.6-luna" },
      { provider: "openai", model: "gpt-5.6-luna" },
    ]);

    expect(cost.lines[0].text).toMatch(/^~ 0\./);
    expect(cost.total).toMatch(/^~ 0\./);
    expect(cost.unpriced).toEqual([]);
  });

  it("says so rather than counting an unpriced model as free", () => {
    const cost = planCost(PRICES, [{ provider: "mistral", model: "mistral-large-latest" }]);

    expect(cost.unpriced).toEqual(["mistral/mistral-large-latest"]);
    expect(cost.total).toMatch(/unknown/);
    expect(cost.total).not.toMatch(/^~ 0\.0000/);
  });

  it("names the provider that reports its own cost instead of estimating one", () => {
    const cost = planCost(PRICES, [{ provider: "openrouter", model: "anything" }]);

    expect(cost.lines[0].text).toMatch(/reports the real cost/);
    expect(cost.unpriced).toEqual([]);
  });

  it("does not price a binding another machine resolves", () => {
    const cost = planCost(PRICES, [{ provider: "auto", model: "auto" }]);

    expect(cost.lines[0].text).toMatch(/decided on the host/);
    expect(cost.hostDecided).toBe(1);
    expect(cost.total).toMatch(/unknown/);
  });
});

// ── one sentence per ending ─────────────────────────────────────────────────

const CALL = { task: "chat", provider: "openai", model: "gpt-5.6-luna", latencyMs: 812 };

describe("🚨 every ending gets its own words", () => {
  it("gives no two outcomes the same headline or the same action", () => {
    // The needle this file exists to hold. Two outcomes that render the same
    // sentence are a command that costs money and answers nothing: 401 and 429
    // are one status apart and send an operator to two different places — the
    // provider account's key page, or a chair for sixty seconds.
    const codes = Object.keys(OUTCOMES);
    const headlines = codes.map((outcome) => describeOutcome({ ...CALL, outcome }).headline);
    const actions = codes
      .filter((outcome) => outcome !== "ok")
      .map((outcome) => describeOutcome({ ...CALL, outcome }).then);

    expect(new Set(headlines).size, headlines.join("\n")).toBe(codes.length);
    expect(new Set(actions).size, actions.join("\n")).toBe(codes.length - 1);
  });

  it("gives every failing outcome an action a person can carry out", () => {
    for (const outcome of Object.keys(OUTCOMES)) {
      if (outcome === "ok") continue;
      const said = describeOutcome({ ...CALL, outcome });
      expect(said.then.length, outcome).toBeGreaterThan(40);
    }
  });

  it("separates a dead key from a busy provider, in the words and in the verdict", () => {
    const dead = describeOutcome({ ...CALL, outcome: "noCredential" });
    const busy = describeOutcome({ ...CALL, outcome: "providerRefused" });

    expect(dead.headline).toMatch(/no key for that provider, or the account rejected/);
    expect(dead.broken).toBe(true);
    expect(dead.mark).toBe("✗");

    expect(busy.headline).toMatch(/rate limit or overload/);
    // Not broken: a rate limit clears by itself, and a command that goes red
    // over one is a command people re-run until it is green.
    expect(busy.broken).toBe(false);
    expect(busy.mark).toBe("!");
  });

  it("reports a success with what it actually consumed", () => {
    const said = describeOutcome({
      ...CALL,
      outcome: "ok",
      usage: { inputTokens: 31, outputTokens: 2 },
      said: "OK",
    });

    expect(said.mark).toBe("✓");
    expect(said.headline).toMatch(/31 in \/ 2 out tokens/);
    expect(said.headline).toMatch(/said "OK"/);
    expect(said.then).toBe("");
  });

  it("does not report an unreported token count as zero", () => {
    const said = describeOutcome({ ...CALL, outcome: "ok", usage: null });

    expect(said.headline).toMatch(/no token counts reported/);
    expect(said.headline).not.toMatch(/0 in \/ 0 out/);
  });

  it("refuses to file an outcome it has never heard of under the nearest one", () => {
    // A sixth provider with a seventh code must not arrive as `providerFailed`
    // because a lookup defaulted. It is named, and it is broken.
    const said = describeOutcome({ ...CALL, outcome: "quotaExhausted" });

    expect(said.headline).toMatch(/quotaExhausted/);
    expect(said.broken).toBe(true);
    expect(said.then).toMatch(/scripts\/ai\/live\.mjs/);
  });
});

describe("🚨 a run that could not look never reads like a run that found nothing", () => {
  const REASONS = ["noKey", "appDown", "doorClosed", "doorLimited", "taskRefused", "doorFailed"];

  it("gives every skip its own reason and its own next move", () => {
    const said = REASONS.map((reason) => describeSkip(reason, { origin: "http://x" }));

    expect(new Set(said.map((entry) => entry.line)).size).toBe(REASONS.length);
    expect(new Set(said.map((entry) => entry.then)).size).toBe(REASONS.length);
    for (const [index, entry] of said.entries()) {
      expect(entry.then.length, REASONS[index]).toBeGreaterThan(30);
    }
  });

  it("names every key that would make a live run possible", () => {
    const said = describeSkip("noKey");

    expect(said.line).toMatch(/nothing to call/);
    for (const id of PROVIDER_IDS) {
      expect(said.then).toContain(PROVIDER_ENV_VARS[id as keyof typeof PROVIDER_ENV_VARS]);
    }
    expect(said.then).toMatch(/node run\.mjs ai-check --live/);
  });

  it("does not give somebody else's host this machine's advice", () => {
    const local = describeSkip("appDown", { origin: "http://127.0.0.1:3000" });
    const remote = describeSkip("appDown", {
      origin: "https://app.example.com",
      remote: { host: "app.example.com", keyVar: "DIAGNOSTICS_SECRET_PROD" },
    });

    expect(local.then).toMatch(/node run\.mjs start/);
    // "Start it" is wrong three times over about a host somebody else runs.
    expect(remote.then).not.toMatch(/node run\.mjs start/);
    expect(remote.then).toMatch(/app\.example\.com/);
  });

  it("explains a closed door differently on a host than on this machine", () => {
    const local = describeSkip("doorClosed", { origin: "http://127.0.0.1:3000" });
    const remote = describeSkip("doorClosed", {
      origin: "https://app.example.com",
      remote: { host: "app.example.com", keyVar: "DIAGNOSTICS_SECRET_PROD" },
    });

    expect(local.then).toMatch(/node run\.mjs restart/);
    expect(remote.then).toMatch(/DIAGNOSTICS_SECRET_PROD/);
    expect(remote.then).toMatch(/look the same on purpose/);
  });
});

// ── the transport ───────────────────────────────────────────────────────────

describe("asking the running app", () => {
  it("sends a POST with the bearer and the task, to the shared path", async () => {
    const { origin, seen } = await serveJson(200, { ok: true, provider: "openai", model: "m" });

    const answer = await askApp({ origin, secret: "s3cret", task: "chat" });

    expect(answer.state).toBe("called");
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("POST");
    expect(seen[0].url).toBe(LIVE_PATH);
    expect(seen[0].auth).toBe("Bearer s3cret");
    expect(JSON.parse(seen[0].body ?? "{}")).toEqual({ task: "chat" });
  });

  it("hands a provider outcome back as an answer, not as a transport failure", async () => {
    const { origin } = await serveJson(200, {
      ok: false,
      outcome: "providerRefused",
      provider: "openai",
      model: "m",
    });

    const answer = await askApp({ origin, secret: "s", task: "chat" });

    expect(answer).toMatchObject({ state: "called" });
    expect(answer.state === "called" && answer.body.outcome).toBe("providerRefused");
  });

  it("tells a closed door from a metered one from a refused task", async () => {
    const closed = await serveJson(404, "");
    const limited = await serveJson(429, { error: "rateLimited" });
    const refused = await serveJson(400, { error: "unknownTask", known: ["chat", "companion"] });

    expect(await askApp({ origin: closed.origin, secret: "s", task: "chat" })).toMatchObject({
      state: "skip",
      reason: "doorClosed",
    });
    expect(await askApp({ origin: limited.origin, secret: "s", task: "chat" })).toMatchObject({
      state: "skip",
      reason: "doorLimited",
    });

    const task = await askApp({ origin: refused.origin, secret: "s", task: "nope" });
    expect(task).toMatchObject({ state: "skip", reason: "taskRefused" });
    expect(task.state === "skip" && task.detail).toMatch(/unknownTask.*chat, companion/);
  });

  it("reports an app that answered with something else, naming the status", async () => {
    const { origin } = await serveJson(500, { error: "callFailed" });

    const answer = await askApp({ origin, secret: "s", task: "chat" });

    expect(answer).toMatchObject({ state: "skip", reason: "doorFailed", status: 500 });
  });

  it("refuses a 200 that is not the shape it understands", async () => {
    // An app behind a proxy that answers a login page with a 200 is the case
    // this catches — "ok" missing is not "ok: false".
    const { origin } = await serveJson(200, { hello: "world" });

    expect(await askApp({ origin, secret: "s", task: "chat" })).toMatchObject({
      state: "skip",
      reason: "doorFailed",
    });
  });

  it("🚨 never follows a redirect, so a 307 cannot hand back somebody else's 200", async () => {
    const elsewhere = await serveJson(200, { ok: true, provider: "openai", model: "m" });
    const origin = await serve((_request, response) => {
      response.writeHead(307, { location: `${elsewhere.origin}${LIVE_PATH}` });
      response.end();
    });

    const answer = await askApp({ origin, secret: "s", task: "chat" });

    // Followed, this would be `called` with a cheerful ok:true — and the bearer
    // token would have travelled to the other host.
    expect(answer).toMatchObject({ state: "skip", reason: "doorFailed", status: 307 });
    expect(elsewhere.seen).toEqual([]);
  });

  it("reports nothing listening as a skip that names the address", async () => {
    // A port nobody is on: the server is created and closed before the call.
    const origin = await serve(() => {});
    await new Promise<void>((resolve) => servers.pop()!.close(() => resolve()));

    const answer = await askApp({ origin, secret: "s", task: "chat" });

    expect(answer).toMatchObject({ state: "skip", reason: "appDown" });
    expect(answer.state === "skip" && answer.detail).toBeTruthy();
    expect(describeSkip("appDown", { origin }).line).toContain(origin);
  });

  it("gives up rather than hanging, and says which ending that is", async () => {
    const origin = await serve(() => {
      /* accepts the connection and never answers */
    });

    const answer = await askApp({ origin, secret: "s", task: "chat", timeoutMs: 150 });

    expect(answer).toMatchObject({ state: "skip", reason: "appDown" });
    expect(answer.state === "skip" && answer.detail).toMatch(/TimeoutError/);
  });
});
