// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The guard is the v1 surface's whole security story, so what is asserted here
// is the ORDER and the shape of the refusals, not just that refusals exist:
// off beats a valid key, a foreign origin beats everything, and every kind of
// "no key" is one indistinguishable 401.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";
import { API_AUTH_FAIL_LIMIT, API_CALL_LIMIT } from "@/modules/api/api/rules";

vi.mock("@/modules/api/api/config", () => ({
  isApiEnabled: vi.fn(() => true),
  apiConfig: vi.fn(() => ({ enabled: true, requiresPlan: null })),
}));

vi.mock("@/modules/api/keys/keys", () => ({
  authenticate: vi.fn(),
}));

vi.mock("@/lib/entitlements/manage", () => ({
  hasPlan: vi.fn(async () => true),
}));

import { guardApi } from "./guard";
import { apiConfig, isApiEnabled } from "@/modules/api/api/config";
import { authenticate } from "@/modules/api/keys/keys";
import { hasPlan } from "@/lib/entitlements/manage";

const GOOD = {
  ok: true,
  memberId: "member-1",
  keyId: "key-1",
  scope: "read",
  role: "member",
} as const;

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/v1/me", { headers });
}

function withBearer(extra: Record<string, string> = {}): Request {
  return request({ authorization: "Bearer ds24api_" + "a".repeat(43), ...extra });
}

beforeEach(() => {
  resetRateLimits();
  vi.clearAllMocks();
  vi.mocked(authenticate).mockResolvedValue({ ...GOOD });
  vi.mocked(isApiEnabled).mockReturnValue(true);
  // `selfService` is about the account page's card and never about a request —
  // it is set here only because `ApiConfig` is one object. If a change ever
  // makes the guard read it, these tests are where that shows up.
  vi.mocked(apiConfig).mockReturnValue({
    enabled: true,
    requiresPlan: null,
    selfService: false,
  });
  vi.mocked(hasPlan).mockResolvedValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("the order of refusals", () => {
  it("refuses a foreign origin before anything else — even before 'is it on'", async () => {
    vi.mocked(isApiEnabled).mockReturnValue(false);
    const result = await guardApi(request({ origin: "https://evil.example" }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.response.status).toBe(403);
    expect((await body(result.response)).error).toBe("originForbidden");
    // The key lookup never ran.
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("answers 404 while the feature is off — a valid key changes nothing", async () => {
    // OFF is the shipped state: the path behaves as if it did not exist. This
    // is what the deploy test asserts against a real boot.
    vi.mocked(isApiEnabled).mockReturnValue(false);
    const result = await guardApi(withBearer());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.response.status).toBe(404);
    expect((await body(result.response)).error).toBe("apiDisabled");
    expect(authenticate).not.toHaveBeenCalled();
  });
});

describe("authentication", () => {
  it("lets a valid key through, carrying member, scope and role", async () => {
    const result = await guardApi(withBearer());
    expect(result).toEqual({
      ok: true,
      memberId: "member-1",
      keyId: "key-1",
      scope: "read",
      role: "member",
    });
  });

  it("answers every kind of missing or bad key with ONE identical 401", async () => {
    // No oracle: unknown, expired, revoked, blocked and absent all look the
    // same from outside. The distinction lives in the server log.
    const bodies: string[] = [];

    const noHeader = await guardApi(request());
    if (noHeader.ok) throw new Error("unreachable");
    bodies.push(JSON.stringify(await body(noHeader.response)));
    expect(noHeader.response.status).toBe(401);
    expect(noHeader.response.headers.get("www-authenticate")).toContain("Bearer");

    for (const reason of ["unknown", "expired", "revoked", "blocked", "malformed"] as const) {
      resetRateLimits();
      vi.mocked(authenticate).mockResolvedValue({ ok: false, reason });
      const result = await guardApi(withBearer());
      if (result.ok) throw new Error("unreachable");
      expect(result.response.status).toBe(401);
      bodies.push(JSON.stringify(await body(result.response)));
    }

    expect(new Set(bodies).size).toBe(1);
  });

  it("stops trying keys from one origin at the auth-fail limit", async () => {
    vi.mocked(authenticate).mockResolvedValue({ ok: false, reason: "unknown" });
    const from = { "x-forwarded-for": "203.0.113.5" };
    for (let i = 0; i < API_AUTH_FAIL_LIMIT.max; i++) {
      await guardApi(withBearer(from));
    }
    // Now even a VALID key from that origin is refused — the limit is the
    // point, and it must not be resettable by finally guessing right.
    vi.mocked(authenticate).mockResolvedValue({ ...GOOD });
    const result = await guardApi(withBearer(from));
    if (result.ok) throw new Error("expected the auth-fail limit to hold");
    expect(result.response.status).toBe(401);
    expect(authenticate).toHaveBeenCalledTimes(API_AUTH_FAIL_LIMIT.max);
  });
});

describe("the runaway brake", () => {
  it("answers 429 with retry-after past the per-member call limit", async () => {
    for (let i = 0; i < API_CALL_LIMIT.max; i++) {
      const ok = await guardApi(withBearer());
      expect(ok.ok).toBe(true);
    }
    const result = await guardApi(withBearer());
    if (result.ok) throw new Error("expected the call limit to hold");
    expect(result.response.status).toBe(429);
    expect(result.response.headers.get("retry-after")).toBe("60");
    expect((await body(result.response)).error).toBe("rateLimited");
  });
});

describe("plan and scope", () => {
  it("refuses a member without the required plan, after authentication", async () => {
    vi.mocked(apiConfig).mockReturnValue({
      enabled: true,
      requiresPlan: "basic_monthly",
      selfService: false,
    });
    vi.mocked(hasPlan).mockResolvedValue(false);
    const result = await guardApi(withBearer());
    if (result.ok) throw new Error("unreachable");
    expect(result.response.status).toBe(403);
    expect((await body(result.response)).error).toBe("planRequired");
    expect(hasPlan).toHaveBeenCalledWith("member-1", "basic_monthly");
  });

  it("refuses a read key on a writing handler — the refusal is in the call path", async () => {
    const result = await guardApi(withBearer(), { scope: "write" });
    if (result.ok) throw new Error("unreachable");
    expect(result.response.status).toBe(403);
    expect((await body(result.response)).error).toBe("scopeReadOnly");
  });

  it("lets a write key run everything", async () => {
    vi.mocked(authenticate).mockResolvedValue({ ...GOOD, scope: "write" });
    expect((await guardApi(withBearer(), { scope: "write" })).ok).toBe(true);
    expect((await guardApi(withBearer())).ok).toBe(true);
  });
});
