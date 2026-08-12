// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The guard comes FIRST, and a probe that throws still produces a 200.
//
// Two claims, and both are about ORDER rather than about output:
//
//   1. 🚨 An unauthenticated request must reach a bodiless 404 without
//      `operationalState()` ever running. The order is the control, not
//      tidiness — an evaluator that ran first would touch the database and the
//      media store for every stranger who found the path, which is both a cost
//      and a timing oracle saying "something is here".
//   2. A component that cannot answer becomes `unchecked`, and the response
//      stays a 200. A 500 here would take the answer that DID work with it.
//
// `operationalState()` is mocked rather than exercised — `lib/ops/health.test.ts`
// is where its branches are asserted, against injected probes. What is asserted
// here is the handler's two decisions and nothing else.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ calls: 0, answer: null as unknown, throws: false }));

vi.mock("@/lib/ops/health", () => ({
  operationalState: async () => {
    state.calls += 1;
    if (state.throws) throw new Error("the evaluator itself blew up");
    return state.answer;
  },
}));

import { GET } from "./route";

const SECRET = "diagnostics-secret-0123456789abcdef";

const ask = (headers: Record<string, string> = {}) =>
  GET(new Request("https://app.example.com/api/diagnostics/health", { headers }));

beforeEach(() => {
  state.calls = 0;
  state.throws = false;
  state.answer = {
    checkedAt: "2026-08-10T12:00:00.000Z",
    media: { state: "ok", driver: "s3", code: "answered", ms: 41 },
    ipn: {
      state: "unchecked",
      code: "dbUnreachable",
      lastEventAt: null,
      sells: false,
      ordersRecent: -1,
      logRetentionDays: 60,
      silentDays: null,
    },
  };
  process.env.DIAGNOSTICS_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.DIAGNOSTICS_SECRET;
  vi.unstubAllEnvs();
});

describe("GET /api/diagnostics/health", () => {
  it("🚨 refuses with a bodiless 404 before the evaluator runs", async () => {
    const answer = await ask();
    expect(answer.status).toBe(404);
    expect(await answer.text()).toBe("");
    expect(state.calls, "operationalState() ran for an unauthenticated caller").toBe(0);
  });

  it("answers the same 404 with no secret configured at all", async () => {
    delete process.env.DIAGNOSTICS_SECRET;
    const answer = await ask({ authorization: `Bearer ${SECRET}` });
    expect(answer.status).toBe(404);
    expect(await answer.text()).toBe("");
    expect(state.calls).toBe(0);
  });

  it("answers the same 404 for a wrong secret and for a malformed header", async () => {
    for (const headers of [
      { authorization: "Bearer not-the-secret-0123456789abcdef" },
      { authorization: SECRET },
      { authorization: "Basic Zm9vOmJhcg==" },
    ]) {
      const answer = await ask(headers);
      expect(answer.status).toBe(404);
      expect(await answer.text()).toBe("");
    }
    expect(state.calls).toBe(0);
  });

  it("answers 200 with the two facts and nothing else for a good secret", async () => {
    const answer = await ask({ authorization: `Bearer ${SECRET}` });
    expect(answer.status).toBe(200);
    const body = await answer.json();
    expect(Object.keys(body).sort()).toEqual(["checkedAt", "ipn", "media"]);
    expect(state.calls).toBe(1);
  });

  it("a component that could not look stays a 200 with `unchecked`", async () => {
    // The AC6 claim from the handler's side: a database that is down must not
    // take the media answer — or the whole response — with it.
    const body = await (await ask({ authorization: `Bearer ${SECRET}` })).json();
    expect(body.ipn.state).toBe("unchecked");
    expect(body.media.state).toBe("ok");
  });

  it("🚨 the needle: the guard really is what refuses, not a coincidence", async () => {
    // Without this the four assertions above pass against a handler that answers
    // 404 unconditionally — which is the shape a nervous "fix" produces, and it
    // would leave the operator with a command that can never look.
    const good = await ask({ authorization: `Bearer ${SECRET}` });
    expect(good.status).toBe(200);
    expect(state.calls).toBe(1);
  });

  it("🚨 composes nothing of its own when the evaluator throws", async () => {
    // `operationalState()` is written so it cannot throw — every probe sits in
    // its own `try` and `lib/ops/health.test.ts` holds that. This asserts the
    // handler's half of the same rule: it must NOT wrap the call in a `catch`
    // that answers 200 with an invented body. A fabricated `state: "ok"` is the
    // one failure this whole surface exists to prevent, and a rescue here would
    // produce exactly that while looking like resilience.
    state.throws = true;
    await expect(ask({ authorization: `Bearer ${SECRET}` })).rejects.toThrow(
      "the evaluator itself blew up",
    );
  });
});
