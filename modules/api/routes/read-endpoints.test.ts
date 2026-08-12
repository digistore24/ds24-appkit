// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The v1 read surface, one contract per route: guard first (a refused request
// reaches no query), every Date serialized as ISO at the boundary, and the
// IDOR invariant — the member acted on is the KEY's owner, and a memberId in
// the query string or body changes nothing.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/api/api/guard", () => ({ guardApi: vi.fn() }));
vi.mock("@/lib/users/manage", () => ({ findUser: vi.fn(), setOwnName: vi.fn() }));
vi.mock("@/lib/entitlements/manage", () => ({
  entitlementsFor: vi.fn(),
  suspendedKeysFor: vi.fn(),
}));
vi.mock("@/lib/tokens/account", () => ({ getTokenAccount: vi.fn() }));
vi.mock("@/lib/tokens/own-ledger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tokens/own-ledger")>()),
  listOwnLedger: vi.fn(),
}));
vi.mock("@/lib/billing-mode", () => ({ sellsPlans: vi.fn(() => true) }));
vi.mock("@/lib/digistore/member-billing", () => ({ listBillingForMember: vi.fn() }));
vi.mock("@/lib/digistore/subscriptions", () => ({ nextPaymentForMember: vi.fn() }));

import { guardApi } from "@/modules/api/api/guard";
import { findUser, setOwnName } from "@/lib/users/manage";
import { entitlementsFor, suspendedKeysFor } from "@/lib/entitlements/manage";
import { getTokenAccount } from "@/lib/tokens/account";
import { listOwnLedger } from "@/lib/tokens/own-ledger";
import { listBillingForMember } from "@/lib/digistore/member-billing";
import { nextPaymentForMember } from "@/lib/digistore/subscriptions";

import * as me from "./me";
import * as entitlements from "./entitlements";
import * as tokens from "./tokens";
import * as ledger from "./tokens-ledger";
import * as billing from "./billing";

const MEMBER = "member-1";
const GUARDED = {
  ok: true,
  memberId: MEMBER,
  keyId: "key-1",
  scope: "write",
  role: "member",
} as const;
const WHEN = new Date("2026-08-01T10:00:00Z");
const ISO = "2026-08-01T10:00:00.000Z";

/** A request that TRIES to name somebody else, every way a request can. */
function nosyRequest(method = "GET", body?: unknown): Request {
  return new Request("http://localhost:3000/api/v1/x?memberId=somebody-else", {
    method,
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(guardApi).mockResolvedValue({ ...GUARDED });
  vi.mocked(findUser).mockResolvedValue({
    id: MEMBER,
    email: "m@example.com",
    name: "M",
    role: "member",
    createdAt: WHEN,
    blockedAt: null,
  });
  vi.mocked(entitlementsFor).mockResolvedValue([
    { productKey: "basis_monatlich", source: "purchase", accessUntil: WHEN },
  ]);
  vi.mocked(suspendedKeysFor).mockResolvedValue([]);
  vi.mocked(getTokenAccount).mockResolvedValue(undefined);
  vi.mocked(listOwnLedger).mockResolvedValue([]);
  vi.mocked(listBillingForMember).mockResolvedValue([]);
  vi.mocked(nextPaymentForMember).mockResolvedValue(null);
});

const ROUTES: Array<[string, (r: Request) => Promise<Response>]> = [
  ["GET /me", me.GET],
  ["PATCH /me", (r) => me.PATCH(r)],
  ["GET /entitlements", entitlements.GET],
  ["GET /tokens", tokens.GET],
  ["GET /tokens/ledger", ledger.GET],
  ["GET /billing", billing.GET],
];

describe("every handler is guard-first", () => {
  for (const [name, handler] of ROUTES) {
    it(`${name} returns the guard's refusal untouched and reads nothing`, async () => {
      const refusal = Response.json({ error: "unauthorized" }, { status: 401 });
      vi.mocked(guardApi).mockResolvedValue({ ok: false, response: refusal });
      const response = await handler(nosyRequest(name.startsWith("PATCH") ? "PATCH" : "GET"));
      expect(response).toBe(refusal);
      expect(findUser).not.toHaveBeenCalled();
      expect(entitlementsFor).not.toHaveBeenCalled();
      expect(getTokenAccount).not.toHaveBeenCalled();
      expect(listBillingForMember).not.toHaveBeenCalled();
    });
  }
});

describe("the IDOR invariant", () => {
  it("acts on the key's owner no matter what the request names", async () => {
    await me.GET(nosyRequest());
    await entitlements.GET(nosyRequest());
    await tokens.GET(nosyRequest());
    await ledger.GET(nosyRequest());
    await billing.GET(nosyRequest());
    await me.PATCH(nosyRequest("PATCH", { name: "X", memberId: "somebody-else" }));

    expect(findUser).toHaveBeenCalledWith(MEMBER);
    expect(entitlementsFor).toHaveBeenCalledWith(MEMBER);
    expect(getTokenAccount).toHaveBeenCalledWith(MEMBER);
    expect(listOwnLedger).toHaveBeenCalledWith(MEMBER);
    expect(listBillingForMember).toHaveBeenCalledWith(MEMBER);
    expect(setOwnName).toHaveBeenCalledWith(MEMBER, "X");
  });
});

describe("shapes and serialization", () => {
  it("GET /me answers the profile with ISO dates and without blockedAt", async () => {
    const response = await me.GET(nosyRequest());
    expect(await response.json()).toEqual({
      id: MEMBER,
      email: "m@example.com",
      name: "M",
      role: "member",
      createdAt: ISO,
    });
  });

  it("PATCH /me requires write scope, normalizes, and clears on null", async () => {
    await me.PATCH(nosyRequest("PATCH", { name: "  A   B " }));
    expect(guardApi).toHaveBeenLastCalledWith(expect.anything(), { scope: "write" });
    expect(setOwnName).toHaveBeenLastCalledWith(MEMBER, "A B");

    await me.PATCH(nosyRequest("PATCH", { name: null }));
    expect(setOwnName).toHaveBeenLastCalledWith(MEMBER, null);

    const bad = await me.PATCH(nosyRequest("PATCH", { name: 42 }));
    expect(bad.status).toBe(400);
    const empty = await me.PATCH(nosyRequest("PATCH", {}));
    expect(empty.status).toBe(400);
  });

  it("GET /entitlements carries paused keys beside the owned ones", async () => {
    vi.mocked(suspendedKeysFor).mockResolvedValue(["premium_jahr"]);
    const response = await entitlements.GET(nosyRequest());
    expect(await response.json()).toEqual({
      entitlements: [{ productKey: "basis_monatlich", source: "purchase", accessUntil: ISO }],
      paused: ["premium_jahr"],
    });
  });

  it("GET /tokens answers zero for an account that never bought tokens", async () => {
    const none = await tokens.GET(nosyRequest());
    expect(await none.json()).toEqual({ balance: 0 });

    vi.mocked(getTokenAccount).mockResolvedValue({ balance: 250 } as never);
    const some = await tokens.GET(nosyRequest());
    expect(await some.json()).toEqual({ balance: 250 });
  });

  it("GET /tokens/ledger passes the member-facing label through, dates as ISO", async () => {
    vi.mocked(listOwnLedger).mockResolvedValue([
      {
        id: "l1",
        type: "consume",
        amount: -5,
        balanceAfter: 245,
        label: "report generation",
        origin: null,
        createdAt: WHEN,
      },
    ]);
    const response = await ledger.GET(nosyRequest());
    expect(await response.json()).toEqual({
      entries: [
        {
          id: "l1",
          type: "consume",
          amount: -5,
          balanceAfter: 245,
          label: "report generation",
          origin: null,
          createdAt: ISO,
        },
      ],
      capped: false,
    });
  });

  it("GET /billing nests invoices under their order, dates as ISO", async () => {
    vi.mocked(nextPaymentForMember).mockResolvedValue("2026-09-01");
    vi.mocked(listBillingForMember).mockResolvedValue([
      {
        ds24OrderId: "ORDER1",
        productKey: "basis_monatlich",
        status: "paying",
        amount: "9.00",
        currency: "EUR",
        createdAt: WHEN,
        rebillingStopUrl: "https://ds24.example/stop",
        renewUrl: null,
        invoices: [
          {
            id: "inv1",
            invoiceUrl: "https://ds24.example/invoice",
            amount: "9.00",
            currency: "EUR",
            paySequenceNo: 1,
            createdAt: WHEN,
          },
        ],
      },
    ]);
    const response = await billing.GET(nosyRequest());
    expect(await response.json()).toEqual({
      nextPaymentAt: "2026-09-01",
      orders: [
        {
          ds24OrderId: "ORDER1",
          productKey: "basis_monatlich",
          status: "paying",
          amount: "9.00",
          currency: "EUR",
          createdAt: ISO,
          rebillingStopUrl: "https://ds24.example/stop",
          renewUrl: null,
          invoices: [
            {
              id: "inv1",
              invoiceUrl: "https://ds24.example/invoice",
              amount: "9.00",
              currency: "EUR",
              paySequenceNo: 1,
              createdAt: ISO,
            },
          ],
        },
      ],
    });
  });
});
