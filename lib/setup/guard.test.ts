// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 `guardSetup()`, EXECUTED — the one door into the surface that writes
// production without a session.
//
// Measured 2026-09-15: 5 of 59 statements in `guard.ts` had ever run under a
// test. `guard-presence.test.ts` proves every handler CALLS the guard and
// `dispatch-target.test.ts` mocks it away; `scripts/deploy-two-act.mjs` sends
// only the valid key. So the twelve refusals below — foreign origin, the
// switch, the failure meter, APP_ENV unset, a garbled or mismatched env claim,
// no key, a bad key, the per-key ceiling, an unknown tool, a destructive tool
// outside DEV, an unknown input field, a missing confirmation — were held by
// nothing but the prose beside them. This file drives the real function with
// the real `rules.ts` and the real `lib/rate-limit.ts`; only the two database
// calls (`authenticateKey`, `spendConfirmation`) and the config file are stubbed,
// because their own files test them.
//
// What is asserted is the ORDER as much as the answer: off beats a good key,
// the meter fires before the key is looked up, and every kind of "no key" is
// one indistinguishable 401.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";

const { authenticateKey, spendConfirmation, isSetupEnabled, setupConfig } = vi.hoisted(() => ({
  authenticateKey: vi.fn(),
  spendConfirmation: vi.fn(),
  isSetupEnabled: vi.fn(() => true),
  setupConfig: vi.fn(() => ({ enabled: true, allowDestructive: [] as string[] })),
}));

vi.mock("./manage", () => ({ authenticateKey, spendConfirmation }));
vi.mock("./config", () => ({ isSetupEnabled, setupConfig }));

import { SETUP_LIMITS, guardSetup, type SetupRequestBody } from "./guard";
import { SETUP_KEY_PREFIX, payloadDigest } from "./rules";
import type { SetupTool } from "./types";

/** A key with the right marker and the right length — what a minted one looks like. */
const GOOD_KEY = SETUP_KEY_PREFIX + "a".repeat(43);
const OWNER = { keyId: "key-1", ownerId: "owner-1" };

function tool(over: Partial<SetupTool> & { name: string }): SetupTool {
  return {
    description: "probe",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string" },
        note: { type: "string", default: "none" },
      },
      required: ["email"],
    },
    targetField: "email",
    mutates: false,
    destructive: false,
    run: async () => ({ ok: true }),
    ...over,
  } as unknown as SetupTool;
}

const TOOLS: ReadonlyMap<string, SetupTool> = new Map(
  [
    tool({ name: "probe_read" }),
    tool({ name: "probe_write", mutates: true }),
    tool({ name: "probe_destroy", mutates: true, destructive: true }),
  ].map((t) => [t.name, t]),
);

interface CallOptions {
  headers?: Record<string, string>;
  body?: SetupRequestBody;
  callerKey?: string;
  file?: { bytes: Uint8Array; name: string; type: string };
  tools?: ReadonlyMap<string, SetupTool>;
}

/** A well-formed call — every test below breaks exactly one thing about it. */
function call(over: CallOptions = {}) {
  const headers = new Headers({ authorization: `Bearer ${GOOD_KEY}`, ...over.headers });
  for (const [name, value] of Object.entries(over.headers ?? {})) {
    if (value === "") headers.delete(name);
  }
  return guardSetup({
    request: new Request("http://localhost:3000/api/setup", { method: "POST", headers }),
    body: {
      tool: "probe_read",
      env: process.env.APP_ENV,
      mode: "plan",
      input: { email: "a@example.com" },
      ...over.body,
    },
    tools: over.tools ?? TOOLS,
    callerKey: over.callerKey ?? "203.0.113.7",
    file: over.file as never,
  });
}

async function refusal(result: Awaited<ReturnType<typeof guardSetup>>) {
  expect(result.ok, "expected a refusal, got ok").toBe(false);
  if (result.ok) throw new Error("unreachable");
  const text = await result.response.text();
  return {
    status: result.response.status,
    body: text ? (JSON.parse(text) as { error: string; detail?: string }) : null,
    headers: result.response.headers,
  };
}

const ENV = { APP_ENV: process.env.APP_ENV, APP_URL: process.env.APP_URL };

beforeEach(() => {
  resetRateLimits();
  vi.clearAllMocks();
  process.env.APP_ENV = "production";
  process.env.APP_URL = "http://localhost:3000";
  authenticateKey.mockResolvedValue({ ...OWNER });
  spendConfirmation.mockResolvedValue(null);
  isSetupEnabled.mockReturnValue(true);
  setupConfig.mockReturnValue({ enabled: true, allowDestructive: [] });
});

afterEach(() => {
  process.env.APP_ENV = ENV.APP_ENV;
  process.env.APP_URL = ENV.APP_URL;
});

describe("the happy path — what a tool is handed", () => {
  it("lets a well-formed plan call through with the key's identity", async () => {
    const result = await call();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).toMatchObject({
      keyId: "key-1",
      ownerId: "owner-1",
      appEnv: "production",
      mode: "plan",
      payloadSha: null,
    });
    expect(result.tool.name).toBe("probe_read");
    expect(authenticateKey).toHaveBeenCalledWith(GOOD_KEY);
  });

  it("hands over the VALIDATED input — defaults filled, nothing else added", async () => {
    const result = await call();
    expect(result.ok && result.input).toEqual({ email: "a@example.com", note: "none" });
  });

  it("a success does not feed the failure meter", async () => {
    for (let i = 0; i < SETUP_LIMITS.AUTH_FAIL_LIMIT.max + 5; i++) {
      expect((await call()).ok).toBe(true);
    }
  });
});

describe("1. origin — a browser on another origin never gets in", () => {
  it("refuses a foreign Origin with 400, before the key is even read", async () => {
    const r = await refusal(await call({ headers: { origin: "https://evil.example" } }));
    expect(r.status).toBe(400);
    expect(r.body?.error).toBe("badRequest");
    expect(authenticateKey).not.toHaveBeenCalled();
  });

  it("accepts the app's own origin, and no origin at all", async () => {
    expect((await call({ headers: { origin: "http://localhost:3000" } })).ok).toBe(true);
    expect((await call()).ok).toBe(true);
  });

  it("with APP_URL unset, EVERY origin is foreign", async () => {
    delete process.env.APP_URL;
    const r = await refusal(await call({ headers: { origin: "http://localhost:3000" } }));
    expect(r.status).toBe(400);
  });

  it("🚨 counts — a stranger probing origins runs into the meter", async () => {
    for (let i = 0; i < SETUP_LIMITS.AUTH_FAIL_LIMIT.max; i++) {
      await call({ headers: { origin: "https://evil.example" } });
    }
    const r = await refusal(await call());
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("900");
  });
});

describe("2. the switch — off means off for everybody", () => {
  it("answers 404 with NO body, and never asks the key table", async () => {
    isSetupEnabled.mockReturnValue(false);
    const r = await refusal(await call());
    expect(r.status).toBe(404);
    expect(r.body).toBeNull();
    expect(authenticateKey).not.toHaveBeenCalled();
  });

  it("a foreign origin outranks the switch — the 400 stays even when off", async () => {
    isSetupEnabled.mockReturnValue(false);
    const r = await refusal(await call({ headers: { origin: "https://evil.example" } }));
    expect(r.status).toBe(400);
  });

  it("probing a switched-off surface does not count as a failed authentication", async () => {
    isSetupEnabled.mockReturnValue(false);
    for (let i = 0; i < SETUP_LIMITS.AUTH_FAIL_LIMIT.max + 5; i++) await call();
    isSetupEnabled.mockReturnValue(true);
    expect((await call()).ok).toBe(true);
  });
});

describe("3. the failure meter — per origin, before every reachable refusal", () => {
  it("fires after AUTH_FAIL_LIMIT.max refusals from one caller, and only for that caller", async () => {
    authenticateKey.mockResolvedValue(null);
    for (let i = 0; i < SETUP_LIMITS.AUTH_FAIL_LIMIT.max; i++) {
      expect((await refusal(await call())).status).toBe(401);
    }
    expect((await refusal(await call())).status).toBe(429);

    authenticateKey.mockResolvedValue({ ...OWNER });
    expect((await call({ callerKey: "198.51.100.9" })).ok, "another caller is not punished").toBe(true);
  });

  it("🚨 a limited caller is refused BEFORE the key is looked up — no more table probes", async () => {
    authenticateKey.mockResolvedValue(null);
    for (let i = 0; i < SETUP_LIMITS.AUTH_FAIL_LIMIT.max; i++) await call();
    authenticateKey.mockClear();
    authenticateKey.mockResolvedValue({ ...OWNER });

    expect((await refusal(await call())).status).toBe(429);
    expect(authenticateKey).not.toHaveBeenCalled();
  });
});

describe("4/5. the environment — the server's own, then the caller's claim", () => {
  it("🚨 APP_ENV unset is 500, not 'development' — and counted", async () => {
    delete process.env.APP_ENV;
    const r = await refusal(await call({ body: { env: "development" } }));
    expect(r.status).toBe(500);
    expect(r.body?.error).toBe("envUnset");
    expect(authenticateKey).not.toHaveBeenCalled();
  });

  it.each(["prod", "dev", "PRODUCTION", "", 42, null, undefined])(
    "a claim of %j is a 400 — the set is closed and nothing is normalised",
    async (env) => {
      const r = await refusal(await call({ body: { env } }));
      expect(r.status).toBe(400);
      expect(r.body?.error).toBe("badRequest");
      expect(authenticateKey).not.toHaveBeenCalled();
    },
  );

  it("a well-formed claim for the WRONG environment is 409 and names both", async () => {
    const r = await refusal(await call({ body: { env: "staging" } }));
    expect(r.status).toBe(409);
    expect(r.body?.error).toBe("envMismatch");
    expect(r.body?.detail).toContain("production");
    expect(r.body?.detail).toContain("staging");
    expect(authenticateKey).not.toHaveBeenCalled();
  });

  it("both refusals feed the meter", async () => {
    for (let i = 0; i < SETUP_LIMITS.AUTH_FAIL_LIMIT.max; i++) {
      await call({ body: { env: i % 2 ? "banana" : "staging" } });
    }
    expect((await refusal(await call())).status).toBe(429);
  });
});

describe("6/7. the key — one identical 401 for every kind of no", () => {
  const cases: [string, Record<string, string>][] = [
    ["no Authorization header", { authorization: "" }],
    ["a Basic credential", { authorization: "Basic dXNlcjpwYXNz" }],
    ["an empty Bearer", { authorization: "Bearer " }],
    ["an x-api-key header instead", { authorization: "", "x-api-key": GOOD_KEY }],
  ];

  it.each(cases)("%s → 401, and the key table is never asked", async (_label, headers) => {
    const r = await refusal(await call({ headers }));
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: "unauthorized" });
    expect(authenticateKey).not.toHaveBeenCalled();
  });

  it("a Bearer the table does not know (or that is revoked, expired, blocked, not an owner) → the SAME 401", async () => {
    authenticateKey.mockResolvedValue(null);
    const r = await refusal(await call());
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: "unauthorized" });
    expect(authenticateKey).toHaveBeenCalledWith(GOOD_KEY);
  });

  it("the scheme is case-insensitive", async () => {
    expect((await call({ headers: { authorization: `bearer ${GOOD_KEY}` } })).ok).toBe(true);
  });
});

describe("8. the per-key ceiling", () => {
  it("refuses the call after CALL_LIMIT.max in a minute, with retry-after 60 — per key", async () => {
    for (let i = 0; i < SETUP_LIMITS.CALL_LIMIT.max; i++) {
      expect((await call()).ok).toBe(true);
    }
    const r = await refusal(await call());
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");

    authenticateKey.mockResolvedValue({ keyId: "key-2", ownerId: "owner-1" });
    expect((await call()).ok, "a second key of the same owner has its own ceiling").toBe(true);
  });
});

describe("9. the tool — the surface is enumerated", () => {
  it.each(["", "rm_rf", 42, undefined])("tool %j → 404 unknownTool", async (name) => {
    const r = await refusal(await call({ body: { tool: name } }));
    expect(r.status).toBe(404);
    expect(r.body?.error).toBe("unknownTool");
  });

  it("an unknown tool is refused AFTER the key — a stranger cannot enumerate the surface", async () => {
    authenticateKey.mockResolvedValue(null);
    const r = await refusal(await call({ body: { tool: "rm_rf" } }));
    expect(r.status).toBe(401);
  });
});

describe("10. destructive tools", () => {
  it("are refused outside DEV unless named in config/setup.json", async () => {
    const r = await refusal(await call({ body: { tool: "probe_destroy" } }));
    expect(r.status).toBe(403);
    expect(r.body?.error).toBe("destructiveRefused");
    expect(r.body?.detail).toContain("probe_destroy");
  });

  it("run when the config names exactly this tool", async () => {
    setupConfig.mockReturnValue({ enabled: true, allowDestructive: ["probe_destroy"] });
    expect((await call({ body: { tool: "probe_destroy" } })).ok).toBe(true);
  });

  it("naming ANOTHER tool does not open this one", async () => {
    setupConfig.mockReturnValue({ enabled: true, allowDestructive: ["probe_write"] });
    expect((await refusal(await call({ body: { tool: "probe_destroy" } }))).status).toBe(403);
  });

  it("run in DEV without being named", async () => {
    process.env.APP_ENV = "development";
    expect((await call({ body: { tool: "probe_destroy", env: "development" } })).ok).toBe(true);
  });
});

describe("11. the input, through the tool's own schema", () => {
  it("an unknown field is a 400 that names it — never silently dropped", async () => {
    const r = await refusal(await call({ body: { input: { email: "a@example.com", emial: "x" } } }));
    expect(r.status).toBe(400);
    expect(r.body?.detail).toContain('"emial"');
  });

  it("a missing required field is a 400 that names it", async () => {
    const r = await refusal(await call({ body: { input: {} } }));
    expect(r.status).toBe(400);
    expect(r.body?.detail).toContain('"email"');
  });

  it("a non-object input is a 400", async () => {
    const r = await refusal(await call({ body: { input: ["a@example.com"] } }));
    expect(r.status).toBe(400);
  });
});

describe("12. the two acts — apply outside DEV needs the confirmation of ITS plan", () => {
  it("apply on a mutating tool without a confirmation → 428", async () => {
    const r = await refusal(await call({ body: { tool: "probe_write", mode: "apply" } }));
    expect(r.status).toBe(428);
    expect(r.body?.error).toBe("confirmationRequired");
    expect(spendConfirmation).not.toHaveBeenCalled();
  });

  it("an empty-string confirmation is no confirmation", async () => {
    const r = await refusal(
      await call({ body: { tool: "probe_write", mode: "apply", confirmation: "" } }),
    );
    expect(r.status).toBe(428);
  });

  it("spends the token against THIS key, tool, env, validated input and payload", async () => {
    const result = await call({
      body: { tool: "probe_write", mode: "apply", confirmation: "tok-1" },
    });
    expect(result.ok).toBe(true);
    expect(spendConfirmation).toHaveBeenCalledTimes(1);
    expect(spendConfirmation).toHaveBeenCalledWith({
      token: "tok-1",
      keyId: "key-1",
      tool: "probe_write",
      appEnv: "production",
      toolInput: { email: "a@example.com", note: "none" },
      payloadSha: null,
    });
  });

  it("a spent, expired or foreign token is the code the ledger names — 403", async () => {
    spendConfirmation.mockResolvedValue("confirmationInvalid");
    const r = await refusal(
      await call({ body: { tool: "probe_write", mode: "apply", confirmation: "tok-used" } }),
    );
    expect(r.status).toBe(403);
    expect(r.body?.error).toBe("confirmationInvalid");
  });

  it("a PLAN never spends anything", async () => {
    expect((await call({ body: { tool: "probe_write", mode: "plan" } })).ok).toBe(true);
    expect(spendConfirmation).not.toHaveBeenCalled();
  });

  it("a read-only tool applies without a confirmation, even in production", async () => {
    expect((await call({ body: { tool: "probe_read", mode: "apply" } })).ok).toBe(true);
    expect(spendConfirmation).not.toHaveBeenCalled();
  });

  it("in DEV a mutation applies in one call", async () => {
    process.env.APP_ENV = "development";
    const result = await call({ body: { tool: "probe_write", mode: "apply", env: "development" } });
    expect(result.ok && result.mode).toBe("apply");
    expect(spendConfirmation).not.toHaveBeenCalled();
  });

  it("anything but the literal \"apply\" is a plan", async () => {
    const result = await call({ body: { tool: "probe_write", mode: "APPLY" } });
    expect(result.ok && result.mode).toBe("plan");
  });
});

describe("the payload digest — computed once, only where a confirmation is in play", () => {
  const file = { bytes: new TextEncoder().encode("PNG-ish"), name: "a.png", type: "image/png" };

  it("a mutating tool outside DEV hashes the bytes it was handed", async () => {
    const result = await call({ body: { tool: "probe_write" }, file });
    expect(result.ok && result.payloadSha).toBe(payloadDigest(file.bytes));
  });

  it("…and hands that same digest to the spend", async () => {
    await call({ body: { tool: "probe_write", mode: "apply", confirmation: "tok-1" }, file });
    expect(spendConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ payloadSha: payloadDigest(file.bytes) }),
    );
  });

  it("a read-only tool never hashes, and neither does DEV", async () => {
    expect((await call({ body: { tool: "probe_read" }, file })) as { payloadSha?: unknown }).toMatchObject({
      payloadSha: null,
    });
    process.env.APP_ENV = "development";
    const dev = await call({ body: { tool: "probe_write", env: "development" }, file });
    expect(dev.ok && dev.payloadSha).toBeNull();
  });
});
