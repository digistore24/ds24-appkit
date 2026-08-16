// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The token endpoint is a password oracle by construction; what these tests
// hold in place is what keeps it from being a useful one — the single 401 —
// plus the meters and the defaults a client relies on.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";
import { TOKEN_MINT_LIMIT } from "@/modules/api/api/rules";
import { ApiKeyError } from "@/modules/api/keys/rules";

vi.mock("@/modules/api/api/config", () => ({
  isApiEnabled: vi.fn(() => true),
  apiConfig: vi.fn(() => ({ enabled: true, requiresPlan: null, selfService: false })),
}));

vi.mock("@/lib/credentials/manage", () => ({
  verifyPasswordLogin: vi.fn(),
}));

vi.mock("@/lib/entitlements/manage", () => ({
  hasPlan: vi.fn(),
}));

vi.mock("@/modules/api/keys/keys", () => ({
  createKey: vi.fn(),
}));

import { POST } from "./auth-token";
import { apiConfig, isApiEnabled } from "@/modules/api/api/config";
import { verifyPasswordLogin } from "@/lib/credentials/manage";
import { hasPlan } from "@/lib/entitlements/manage";
import { createKey } from "@/modules/api/keys/keys";

const USER = { id: "member-1", email: "m@example.com", name: "M", role: "member" };

const CREATED = {
  id: "key-1",
  name: "phone",
  scope: "read" as const,
  expiresAt: new Date("2026-11-01T00:00:00Z"),
  secret: "ds24api_" + "s".repeat(43),
};

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/v1/auth/token", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetRateLimits();
  vi.clearAllMocks();
  vi.mocked(isApiEnabled).mockReturnValue(true);
  vi.mocked(apiConfig).mockReturnValue({
    enabled: true,
    requiresPlan: null,
    selfService: false,
  });
  vi.mocked(hasPlan).mockResolvedValue(true);
  vi.mocked(verifyPasswordLogin).mockResolvedValue({ ok: true, user: { ...USER } });
  vi.mocked(createKey).mockResolvedValue({ ...CREATED });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("the happy path", () => {
  it("answers 201 with the secret's only appearance, dates as ISO strings", async () => {
    const response = await POST(post({ email: "m@example.com", password: "pw", name: "phone" }));
    expect(response.status).toBe(201);
    expect(await body(response)).toEqual({
      id: "key-1",
      name: "phone",
      scope: "read",
      expiresAt: "2026-11-01T00:00:00.000Z",
      secret: CREATED.secret,
    });
  });

  it("defaults to a read key that expires in 90 days", async () => {
    // The safe defaults are the contract: a client that asks for nothing gets
    // the key that can do the least and does not outlive its device.
    await POST(post({ email: "m@example.com", password: "pw" }));
    expect(createKey).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "member-1",
        scope: "read",
        lifetimeDays: 90,
        audience: "api",
      }),
    );
  });

  it("accepts null as 'no end date' — distinct from absent", async () => {
    await POST(post({ email: "m@example.com", password: "pw", lifetimeDays: null }));
    expect(createKey).toHaveBeenCalledWith(expect.objectContaining({ lifetimeDays: null }));
  });

  it("takes the member from the verified sign-in — a memberId in the body is ignored", async () => {
    // The IDOR invariant, stated as a test: nothing a caller writes can name
    // whose key gets minted.
    await POST(post({ email: "m@example.com", password: "pw", memberId: "somebody-else" }));
    expect(createKey).toHaveBeenCalledWith(expect.objectContaining({ memberId: "member-1" }));
  });
});

describe("one answer to every sign-in failure", () => {
  it("does not distinguish a wrong password from an unknown address", async () => {
    vi.mocked(verifyPasswordLogin).mockResolvedValue({ ok: false, rateLimited: false });
    const wrongPassword = await POST(post({ email: "m@example.com", password: "nope" }));
    const unknownAddress = await POST(post({ email: "who@example.com", password: "nope" }));
    expect(wrongPassword.status).toBe(401);
    expect(unknownAddress.status).toBe(401);
    expect(await body(wrongPassword)).toEqual(await body(unknownAddress));
    expect(createKey).not.toHaveBeenCalled();
  });

  it("answers 429 only for the rate limit — the one deliberate distinction", async () => {
    vi.mocked(verifyPasswordLogin).mockResolvedValue({ ok: false, rateLimited: true });
    const response = await POST(post({ email: "m@example.com", password: "pw" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("900");
  });
});

describe("the meters and switches in front of the password check", () => {
  it("answers 404 while the feature is off, before any verification", async () => {
    vi.mocked(isApiEnabled).mockReturnValue(false);
    const response = await POST(post({ email: "m@example.com", password: "pw" }));
    expect(response.status).toBe(404);
    expect(verifyPasswordLogin).not.toHaveBeenCalled();
  });

  it("refuses a foreign origin before anything else", async () => {
    const response = await POST(
      post({ email: "m@example.com", password: "pw" }, { origin: "https://evil.example" }),
    );
    expect(response.status).toBe(403);
    expect((await body(response)).error).toBe("originForbidden");
  });

  it("stops minting for one origin at the mint limit — success does not reset it", async () => {
    const from = { "x-forwarded-for": "203.0.113.9" };
    for (let i = 0; i < TOKEN_MINT_LIMIT.max; i++) {
      const ok = await POST(post({ email: "m@example.com", password: "pw" }, from));
      expect(ok.status).toBe(201);
    }
    const over = await POST(post({ email: "m@example.com", password: "pw" }, from));
    expect(over.status).toBe(429);
  });
});

describe("bad requests", () => {
  it("refuses a non-JSON body and a missing credential pair", async () => {
    const raw = new Request("http://localhost:3000/api/v1/auth/token", {
      method: "POST",
      body: "not json",
    });
    expect((await POST(raw)).status).toBe(400);
    expect((await POST(post({ email: "m@example.com" }))).status).toBe(400);
    expect((await POST(post({ password: "pw" }))).status).toBe(400);
  });

  it("refuses a present-but-wrong option instead of silently falling back", async () => {
    // A program that sent "admin" has a bug; hiding it mints a key the
    // developer did not ask for.
    expect(
      (await POST(post({ email: "m@example.com", password: "pw", scope: "admin" }))).status,
    ).toBe(400);
    expect(
      (await POST(post({ email: "m@example.com", password: "pw", lifetimeDays: 7 }))).status,
    ).toBe(400);
    expect(
      (await POST(post({ email: "m@example.com", password: "pw", name: "   " }))).status,
    ).toBe(400);
    expect(createKey).not.toHaveBeenCalled();
  });

  it("refuses a bearer on the sign-in door", async () => {
    const response = await POST(
      post(
        { email: "m@example.com", password: "pw" },
        { authorization: "Bearer ds24api_" + "a".repeat(43) },
      ),
    );
    expect(response.status).toBe(400);
  });

  it("turns the key ceiling into a 400 a client can read", async () => {
    vi.mocked(createKey).mockRejectedValue(new ApiKeyError("apiTooManyKeys"));
    const response = await POST(post({ email: "m@example.com", password: "pw" }));
    expect(response.status).toBe(400);
    expect((await body(response)).detail).toContain("Revoke");
  });
});

describe("the plan gate — who may have a key at all", () => {
  it("refuses a member whose access does not include the API, AFTER the password", async () => {
    vi.mocked(apiConfig).mockReturnValue({
      enabled: true,
      requiresPlan: "basic_monthly",
      selfService: false,
    });
    vi.mocked(hasPlan).mockResolvedValue(false);

    const response = await POST(post({ email: "m@example.com", password: "pw" }));

    expect(response.status).toBe(403);
    expect((await body(response)).error).toBe("planRequired");
    // Nothing was minted — the refusal has to come before the credential, not
    // after it. A key handed out here would be refused on its first call.
    expect(createKey).not.toHaveBeenCalled();
    // And it really got past the password: this answer is distinguishable from
    // the 401 exactly because the caller already proved the account is theirs.
    expect(verifyPasswordLogin).toHaveBeenCalled();
  });

  it("mints for a member who holds the plan", async () => {
    vi.mocked(apiConfig).mockReturnValue({
      enabled: true,
      requiresPlan: "basic_monthly",
      selfService: false,
    });
    vi.mocked(hasPlan).mockResolvedValue(true);

    const response = await POST(post({ email: "m@example.com", password: "pw" }));

    expect(response.status).toBe(201);
    expect(hasPlan).toHaveBeenCalledWith("member-1", "basic_monthly");
  });

  it("does not ask at all when every member may use the API", async () => {
    const response = await POST(post({ email: "m@example.com", password: "pw" }));
    expect(response.status).toBe(201);
    expect(hasPlan).not.toHaveBeenCalled();
  });

  // 🚨 The whole point of the second switch: an app can withdraw the card from
  // every customer and still have a companion that signs in. If this ever turns
  // red, `selfService` has stopped being a UI decision and become a boundary —
  // which is a different feature, and `docs/api.md` says what to build instead.
  it("is NOT closed by selfService — that switch governs the card only", async () => {
    for (const selfService of [false, true]) {
      vi.mocked(apiConfig).mockReturnValue({ enabled: true, requiresPlan: null, selfService });
      const response = await POST(post({ email: "m@example.com", password: "pw" }));
      expect(response.status).toBe(201);
    }
  });
});
