// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The door in front of the scheduled jobs, and the assertion is on the EFFECT
// rather than on the status code: this endpoint can prune tables and hand out
// entitlements, so "did it answer 401" is not the question — "did a job RUN" is.
// `runDueJobs` is therefore mocked and COUNTED, the same way
// `app/api/ipn/route.test.ts` counts the log rows the cap was meant to prevent.
//
// 🚨 What it is really pinning is finding L-6 of the 2026-08-18 scan: `!secret`
// without `trim()` reads a value made of whitespace as SET. A NON-BREAKING
// SPACE is the case that turns that into a real bypass rather than a curiosity
// — `String.trim()` removes it, but a header parser does not, so before the fix
// `CRON_SECRET=" "` armed the endpoint with a credential a stranger can
// send. That is not an invented shape: a secret pasted out of a rendered web
// page carries exactly that character.

import { beforeEach, describe, expect, it, vi } from "vitest";

const ran = vi.hoisted(() => ({ due: 0, byId: [] as string[], statuses: 0 }));

vi.mock("@/lib/cron/run", () => ({
  runDueJobs: async () => {
    ran.due += 1;
    return [];
  },
  runJobById: async (id: string) => {
    ran.byId.push(id);
    return { id, outcome: "ok" as const, detail: "" };
  },
  jobStatuses: async () => {
    ran.statuses += 1;
    return [];
  },
}));

vi.mock("@/lib/cron/jobs", () => ({ CRON_JOBS: [{ id: "prune" }] }));

import { GET, POST } from "./route";

const SECRET = "c".repeat(48);

function call(authorization?: string, url = "https://app.example.com/api/cron") {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return POST(new Request(url, { method: "POST", headers }));
}

beforeEach(() => {
  ran.due = 0;
  ran.byId = [];
  ran.statuses = 0;
  delete process.env.CRON_SECRET;
});

describe("the endpoint everybody can reach", () => {
  it("runs the due jobs for the right secret", async () => {
    process.env.CRON_SECRET = SECRET;
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(ran.due).toBe(1);
  });

  it("answers 503 while no secret is configured — never runs", async () => {
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    expect(ran.due).toBe(0);
  });

  it("answers 401 for a wrong secret", async () => {
    process.env.CRON_SECRET = SECRET;
    const response = await call("Bearer nope");
    expect(response.status).toBe(401);
    expect(ran.due).toBe(0);
  });

  it("GET is the same door — most platform schedulers only send GET", async () => {
    process.env.CRON_SECRET = SECRET;
    const response = await GET(
      new Request("https://app.example.com/api/cron", {
        headers: { authorization: `Bearer ${SECRET}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(ran.due).toBe(1);
  });
});

describe("a secret made of whitespace is not a secret (L-6)", () => {
  it("🚨 a non-breaking space does not arm the endpoint — and does not let a stranger in", async () => {
    // Before the fix this whole test passed the other way round: the 503 gate
    // saw a truthy value and stood aside, and the constant-time compare then
    // matched `Bearer  ` byte for byte, so an unauthenticated caller got a
    // full cron run out of it.
    process.env.CRON_SECRET = " ";

    const stranger = await call("Bearer  ");
    expect(stranger.status).toBe(503);
    expect(ran.due).toBe(0);
  });

  it("🚨 an ordinary space does not arm it either", async () => {
    process.env.CRON_SECRET = " ";
    const response = await call("Bearer  ");
    expect(response.status).toBe(503);
    expect(ran.due).toBe(0);
  });

  it("accepts the secret when the store padded it", async () => {
    // The other half of trimming the VALUE rather than only the emptiness
    // test: a secret store that appends a newline used to make every correct
    // Authorization header wrong by one invisible byte, and the operator's
    // symptom was a 401 with nothing to look at.
    process.env.CRON_SECRET = `  ${SECRET}\n`;
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(ran.due).toBe(1);
  });
});
