// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 NFR-60, in the one place the sentences live.
//
// "I could not ask", "the surface is off there" and "it refused" are three
// different facts, and every one of them is the same colour as a clean run the
// moment somebody collapses two of them. This file is what stops that: it reads
// the answers `callSetup()` produces and asserts they are DISTINGUISHABLE — not
// merely that each exists, but that no two of them share a sentence and that
// none of them can be mistaken for "there is nothing to do".
//
// Pure: no network, no `.env`, no app. The environment table and `fetch` are
// both seams, which is the only reason this can be asked at all.
import { describe, expect, it } from "vitest";

import {
  ENVIRONMENTS,
  applyThroughSetup,
  callSetup,
  configuredEnvironments,
  resolveEnvName,
  settingsFor,
  toolRefusal,
} from "./client.mjs";

const FULL = {
  APP_URL: "http://localhost:3000",
  SETUP_KEY: "ds24setup_dev",
  APP_URL_STAGING: "https://staging.example.com",
  SETUP_KEY_STAGING: "ds24setup_staging",
  APP_URL_PROD: "https://app.example.com",
  SETUP_KEY_PROD: "ds24setup_prod",
};

interface Refusal {
  ok: false;
  reason: string;
  lines: string[];
  exitCode: number;
}
interface Answered {
  ok: true;
  status: number;
  body: Record<string, unknown>;
}

/** Narrow, and fail with the answer itself when it went the other way. */
function refusal(answer: { ok: boolean }): Refusal {
  expect(answer.ok, `expected a refusal, got: ${JSON.stringify(answer)}`).toBe(false);
  return answer as Refusal;
}
function answered(answer: { ok: boolean }): Answered {
  expect(answer.ok, `expected an answer, got: ${JSON.stringify(answer)}`).toBe(true);
  return answer as Answered;
}

/** A `fetch` that answers exactly once, with what a test wants to hand back. */
function answering(status: number, text: string) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  return { fake, calls };
}

describe("the environment table", () => {
  // The names beside the values, because deriving them told an operator to set
  // APP_URL_PRODUCTION while the code read APP_URL_PROD.
  it("spells production PROD, and staging STAGING", () => {
    expect(ENVIRONMENTS.development).toEqual({ urlVar: "APP_URL", keyVar: "SETUP_KEY" });
    expect(ENVIRONMENTS.staging).toEqual({
      urlVar: "APP_URL_STAGING",
      keyVar: "SETUP_KEY_STAGING",
    });
    expect(ENVIRONMENTS.production).toEqual({ urlVar: "APP_URL_PROD", keyVar: "SETUP_KEY_PROD" });
  });

  it("expands the two short spellings, and nothing else", () => {
    // The app's guard validates the claim against the three literals and never
    // normalises it, so `prod` has to become `production` HERE or be refused
    // there with a sentence about a word the operator did type.
    expect(resolveEnvName("prod")).toEqual({ env: "production" });
    expect(resolveEnvName("dev")).toEqual({ env: "development" });
    expect(resolveEnvName("staging")).toEqual({ env: "staging" });
    expect(resolveEnvName(null)).toEqual({ env: "development" });
    expect(resolveEnvName("banana")).toEqual({
      error: 'unknown environment "banana" — development, staging or production',
    });
  });

  it("reads a value through the name it names", () => {
    expect(settingsFor("production", FULL)).toMatchObject({
      urlVar: "APP_URL_PROD",
      url: "https://app.example.com",
      key: "ds24setup_prod",
    });
    expect(settingsFor("nowhere", FULL)).toBeNull();
    expect(configuredEnvironments(FULL)).toEqual(["development", "staging", "production"]);
    expect(configuredEnvironments({ APP_URL_PROD: "https://app.example.com" })).toEqual([]);
  });
});

describe("🚨 the three answers stay three answers (NFR-60)", () => {
  it("① unreachable — nothing was learned about the app", async () => {
    const answer = refusal(
      await callSetup(
        "production",
        { tool: "content_presence" },
        {
          env: FULL,
          fetch: async () => {
            throw new Error("getaddrinfo ENOTFOUND app.example.com");
          },
        },
      ),
    );

    expect(answer.reason).toBe("unreachable");
    expect(answer.exitCode).toBe(1);
    expect(answer.lines[0]).toContain("did not answer");
    expect(answer.lines.join(" ")).toContain("ENOTFOUND");
  });

  it("② the surface is off there — a BODILESS 404, and both causes named", async () => {
    const { fake } = answering(404, "");
    const answer = refusal(
      await callSetup("production", { tool: "content_presence" }, { env: FULL, fetch: fake }),
    );

    expect(answer.reason).toBe("surfaceOff");
    expect(answer.exitCode).toBe(1);
    // Both causes, because from outside they are identical by construction and
    // guessing one would be a claim.
    expect(answer.lines[0]).toContain("the setup surface is off there");
    expect(answer.lines[0]).toContain("that app predates it");
    expect(answer.lines.join(" ")).toContain("config/setup.json");
  });

  it("③ refused — the app answered, and its code travels", async () => {
    const { fake } = answering(403, JSON.stringify({ error: "envMismatch" }));
    const answer = refusal(
      await callSetup("production", { tool: "content_presence" }, { env: FULL, fetch: fake }),
    );

    expect(answer.reason).toBe("refused");
    expect(answer.exitCode).toBe(1);
    expect(answer.lines[0]).toBe("production refused: envMismatch");
  });

  it("a 404 WITH a body is a refusal, not the switched-off surface", async () => {
    // The distinction is the empty body and nothing else — a route that was
    // never built cannot complain about your Content-Type.
    const { fake } = answering(404, JSON.stringify({ error: "unknownTool" }));
    const answer = refusal(
      await callSetup("production", { tool: "no_such" }, { env: FULL, fetch: fake }),
    );

    expect(answer.reason).toBe("refused");
    expect(answer.lines[0]).toContain("unknownTool");
  });

  it("no two of them share a sentence, and none of them reads as 'nothing to do'", async () => {
    const { fake: off } = answering(404, "");
    const { fake: refusedFetch } = answering(403, JSON.stringify({ error: "unauthorized" }));

    const answers: Refusal[] = [
      refusal(
        await callSetup(
        "production",
        { tool: "t" },
          {
            env: FULL,
            fetch: async () => {
              throw new Error("boom");
            },
          },
        ),
      ),
      refusal(await callSetup("production", { tool: "t" }, { env: FULL, fetch: off })),
      refusal(await callSetup("production", { tool: "t" }, { env: FULL, fetch: refusedFetch })),
      refusal(await callSetup("production", { tool: "t" }, { env: {}, fetch: off })),
    ];

    const reasons = answers.map((answer) => answer.reason);
    expect(new Set(reasons).size, `two answers share a reason: ${reasons.join(", ")}`).toBe(4);

    const firstLines = answers.map((answer) => answer.lines[0]);
    expect(new Set(firstLines).size, "two refusals print the same first line").toBe(4);

    for (const line of firstLines) {
      // The whole point: an operator must never be able to read one of these as
      // a green run over an empty repo.
      expect(/nothing to (publish|check|do)/i.test(line), line).toBe(false);
      expect(line.length).toBeGreaterThan(10);
    }
  });

  it("a missing key is 'nothing was asked', named apart from an app that refused", async () => {
    const answer = refusal(
      await callSetup(
        "production",
        { tool: "t" },
        { env: { APP_URL_PROD: "https://app.example.com" }, fetch: answering(200, "{}").fake },
      ),
    );

    expect(answer.reason).toBe("unconfigured");
    // Exit 2, the same as an unknown environment: the difference from the three
    // above is that nothing was asked at all.
    expect(answer.exitCode).toBe(2);
    expect(answer.lines[0]).toContain("SETUP_KEY_PROD");
    expect(answer.lines[0]).not.toContain("APP_URL_PROD");
  });
});

describe("what it sends", () => {
  it("carries the key as a bearer and the environment in the body", async () => {
    const { fake, calls } = answering(200, JSON.stringify({ mode: "plan", data: {} }));
    await callSetup(
      "production",
      { tool: "content_presence", mode: "plan", input: { path: "a/b.mp4" } },
      { env: FULL, fetch: fake },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://app.example.com/api/setup");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer ds24setup_prod");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      env: "production",
      tool: "content_presence",
      mode: "plan",
      input: { path: "a/b.mp4" },
    });
  });

  it("strips a trailing slash off the address rather than posting a double one", async () => {
    const { fake, calls } = answering(200, "{}");
    await callSetup(
      "production",
      { tool: "t" },
      { env: { ...FULL, APP_URL_PROD: "https://app.example.com/" }, fetch: fake },
    );
    expect(calls[0].url).toBe("https://app.example.com/api/setup");
  });
});

describe("a tool that refuses answers 200, and that is not a success", () => {
  it("finds the code in the body", () => {
    expect(toolRefusal({ data: { refused: "contentMediaUndeclared" } })).toBe(
      "contentMediaUndeclared",
    );
    expect(toolRefusal({ data: {} })).toBeNull();
    expect(toolRefusal({})).toBeNull();
    expect(toolRefusal(null)).toBeNull();
  });
});

describe("plan → apply", () => {
  it("passes the confirmation the plan issued", async () => {
    const seen: unknown[] = [];
    const fetchTwice = async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      seen.push(body);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify(
            body.mode === "plan"
              ? { mode: "plan", created: 1, confirmation: "tok-1", data: {} }
              : { mode: "apply", created: 1, data: {} },
          ),
      };
    };

    const answer = answered(
      await applyThroughSetup(
        "production",
        "content_media_confirm",
        { path: "a/b.mp4" },
        { env: FULL, fetch: fetchTwice },
      ),
    );

    expect(answer.ok).toBe(true);
    expect(seen).toHaveLength(2);
    expect((seen[1] as Record<string, unknown>).confirmation).toBe("tok-1");
  });

  it("sends no confirmation field where the plan issued none (DEV)", async () => {
    const seen: Record<string, unknown>[] = [];
    const fetchTwice = async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      seen.push(body);
      return { ok: true, status: 200, text: async () => JSON.stringify({ mode: body.mode, data: {} }) };
    };

    await applyThroughSetup("development", "content_media_url", {}, { env: FULL, fetch: fetchTwice });

    expect(Object.hasOwn(seen[1], "confirmation")).toBe(false);
  });

  it("stops at the plan when the TOOL refused — the apply is never sent", async () => {
    const seen: Record<string, unknown>[] = [];
    const fetchOnce = async (url: string, init: RequestInit) => {
      seen.push(JSON.parse(String(init.body)));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ mode: "plan", data: { refused: "contentMediaMissing" } }),
      };
    };

    const answer = answered(
      await applyThroughSetup(
        "production",
        "content_media_confirm",
        { path: "a/b.mp4" },
        { env: FULL, fetch: fetchOnce },
      ),
    );

    expect(seen).toHaveLength(1);
    expect(toolRefusal(answer.body)).toBe("contentMediaMissing");
  });
});
