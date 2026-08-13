// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 What the IPN does to ACCESS — the wiring, not the rule.
//
// `onPaymentEvent()` is the longest function in this codebase and it decides
// money: it grants, refunds, charges back, suspends and credits. Until this
// file it was imported in exactly ONE place — `app/api/ipn/route.ts` — and by
// no test at all. Nineteen other mentions of it in the tree are comments.
//
// **What was already covered, and what was not.** The DECISION is a pure
// function, `chooseGrantTransition()` in `lib/entitlements/rules.ts`, and it is
// tested case by case there. What nothing looked at is the sentence either side
// of it: does this file hand that function the right event, the right product
// kind and the right owner — and does it then apply the answer to the right
// grant? A rules layer that is perfect and a caller that passes the mapped
// `status` instead of the raw event name (the AD-2 trap, named in both files)
// would be green everywhere and wrong in production.
//
// So the assertions here are all of the same shape: *for this payload, WHICH
// transition reaches `applyGrantTransition`, and against WHOSE grant.*
//
// **Measured, four needles, and every one of them is invisible elsewhere:**
//
//   · the AD-2 collapse — `event: status === "cancelled" ? "last_paid_day" :
//     event`. `mapEventToStatus()` maps `on_rebill_cancelled` AND
//     `last_paid_day` to `"cancelled"` (ipn.ts), so deriving the event from the
//     status makes a customer who merely cancelled lose access the same day.
//     `npm run typecheck` stays clean, all **218** tests over `lib/entitlements`
//     stay green — the rules layer cannot see this, it is handed the wrong word
//     — and exactly one test here goes red.
//   · the existing grant not loaded (`existing = null`): **3** red. This one
//     also breaks typecheck, so it is the weakest of the four.
//   · the owner fallback dropped (`memberId ?? null`): typecheck clean, **1** red.
//   · the orphan path allowed to suspend as well as end: typecheck clean,
//     **2** red.
//
// ⚠️ A fifth was tried first and caught NOTHING, which is worth writing down
// because it looked like the obvious one: `status === "paid" ? "on_payment"`.
// It is a no-op — every event mapping to `paid` already behaves that way. The
// pair that actually collapses is the cancellation pair, and a needle aimed at
// the wrong half of a rule reports a test as green that never asked anything.
//
// The database is `drizzle-orm/pg-proxy` — a real Drizzle instance whose driver
// is a function — as `modules/courses/lib/manage.test.ts` uses it. Nothing about
// the query building is faked, so the order write is a real INSERT and can be
// asserted as one. The collaborators that own their own tables (entitlements,
// the token ledger) are mocked, because what is under test is the orchestration
// between them.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Captured {
  sql: string;
  params: unknown[];
}

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const captured: Captured[] = [];
  const state = {
    /** `findMemberByIdentity` — the row when id AND checkout token agree. */
    identity: [] as unknown[][],
    /** `findMembersByEmail` — capped at two by the query itself. */
    byEmail: [] as unknown[][],
  };
  const db = drizzle(async (sql: string, params: unknown[]) => {
    captured.push({ sql, params });
    const q = sql.toLowerCase();
    // The two reads are told apart by the column only the identity path names.
    if (q.includes('from "users"')) {
      return { rows: q.includes("checkouttoken") ? state.identity : state.byEmail };
    }
    return { rows: [] };
  });
  return { db, __captured: captured, __state: state };
});

// `vi.hoisted`, because `vi.mock` is lifted above every `const` in this file —
// the arrangement `lib/setup/dispatch-target.test.ts` uses for the same reason.
const { applyGrantTransition, purchaseGrant, openPurchaseGrantByPurchase } =
  vi.hoisted(() => ({
    applyGrantTransition: vi.fn(async () => undefined),
    purchaseGrant: vi.fn(async () => null as unknown),
    openPurchaseGrantByPurchase: vi.fn(async () => null as unknown),
  }));

vi.mock("@/lib/entitlements/manage", () => ({
  applyGrantTransition,
  purchaseGrant,
  openPurchaseGrantByPurchase,
}));

// The token ledger owns its own idempotence and has its own tests. What is
// asserted through these spies is only what THIS file asks of it.
const { creditTokens, disarmAutoReload, getTokenAccount, setAutoReload } =
  vi.hoisted(() => ({
    creditTokens: vi.fn(async () => ({ credited: true })),
    disarmAutoReload: vi.fn(async () => false),
    getTokenAccount: vi.fn(async () => null as unknown),
    setAutoReload: vi.fn(async () => undefined),
  }));

vi.mock("@/lib/tokens/account", () => ({
  creditTokens,
  disarmAutoReload,
  getTokenAccount,
  setAutoReload,
}));

import * as dbModule from "@/db";

import { onPaymentEvent } from "./payment-event";

interface State {
  identity: unknown[][];
  byEmail: unknown[][];
}

const captured = (dbModule as unknown as { __captured: Captured[] }).__captured;
const state = (dbModule as unknown as { __state: State }).__state;

// 🚨 Both have to be well-formed or `parseCustom()` answers `null` and every
// case below quietly takes the anonymous path — green tests measuring nothing.
// A UUID (`MEMBER_RE`) and exactly ten alphanumerics (`TOKEN_RE`); the parser
// refuses half an identity outright, which is the point of the shapes.
const MEMBER = "3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const TOKEN = "Ab3xY9zQ71";
const PURCHASE = "PUR-1";
const ORDER = "ORD-1";
// A real key out of the shipped registry, and a real `subscription`. A made-up
// key would resolve to null and quietly take every case down the orphan path.
const PLAN = "basic_monthly";

/** A payload carrying an identity that resolves — the ordinary signed-in buy. */
function payload(event: string, over: Record<string, string> = {}) {
  return {
    event,
    order_id: ORDER,
    purchase_id: PURCHASE,
    buyer_email: "kaeufer@example.com",
    custom: `m:${MEMBER};t:${TOKEN};p:${PLAN}`,
    ...over,
  };
}

/** The one call this whole file is about. */
function transition() {
  expect(applyGrantTransition).toHaveBeenCalledTimes(1);
  return applyGrantTransition.mock.calls[0] as unknown as [
    { kind: string; reason?: string; why?: string },
    { memberId: string; productKey: string; ds24PurchaseId: string | null },
  ];
}

function statements(): string[] {
  return captured.map((c) => c.sql.toLowerCase());
}

beforeEach(() => {
  captured.length = 0;
  state.identity = [[MEMBER]];
  state.byEmail = [];
  applyGrantTransition.mockClear();
  purchaseGrant.mockClear().mockResolvedValue(null);
  openPurchaseGrantByPurchase.mockClear().mockResolvedValue(null);
  creditTokens.mockClear().mockResolvedValue({ credited: true });
  disarmAutoReload.mockClear().mockResolvedValue(false);
  getTokenAccount.mockClear().mockResolvedValue(null);
  setAutoReload.mockClear();
});

describe("onPaymentEvent — which transition reaches the entitlement", () => {
  it("a paid subscription ACTIVATES, for the identified member and that product", async () => {
    await onPaymentEvent(payload("on_payment"));

    const [what, target] = transition();
    expect(what.kind).toBe("activate");
    expect(target).toMatchObject({
      memberId: MEMBER,
      productKey: PLAN,
      ds24PurchaseId: PURCHASE,
    });
  });

  it("a refund ENDS it, and says which reason", async () => {
    await onPaymentEvent(payload("on_refund"));

    const [what] = transition();
    expect(what).toMatchObject({ kind: "end", reason: "refund" });
  });

  it("a chargeback ENDS it under its own reason", async () => {
    // Two reasons rather than one: the difference is what an operator reads off
    // the grant afterwards, and collapsing them here would be invisible.
    await onPaymentEvent(payload("on_chargeback"));

    const [what] = transition();
    expect(what).toMatchObject({ kind: "end", reason: "chargeback" });
  });

  it("a missed payment SUSPENDS — reversibly, not an ending", async () => {
    await onPaymentEvent(payload("on_payment_missed"));

    expect(transition()[0].kind).toBe("suspend");
  });

  it("🚨 a stopped rebilling does NOTHING — access runs to the end of the paid period", async () => {
    // The AD-2 trap in one case. `on_rebill_cancelled` and `last_paid_day` both
    // mean "the subscription is going away", and `status` cannot tell them
    // apart — only the raw event name can. If this file ever passed a mapped
    // status instead, a customer who cancelled would lose access the same day
    // rather than at the end of what they paid for.
    await onPaymentEvent(payload("on_rebill_cancelled"));

    expect(transition()[0]).toMatchObject({
      kind: "none",
      why: "cancellationKeepsAccess",
    });
  });

  it("…and the last paid day ENDS it — the other half of the same pair", async () => {
    await onPaymentEvent(payload("last_paid_day"));

    expect(transition()[0].kind).toBe("end");
  });

  it("🚨 a redelivered payment does not revive a grant that a refund ended", async () => {
    // Digistore24 redelivers until it gets a 200, so this is an ordinary event,
    // not an edge case. The rule needs the EXISTING grant to fire, which is why
    // this file loads it first — hand `null` in and the guard can never fire.
    purchaseGrant.mockResolvedValue({
      memberId: MEMBER,
      productKey: PLAN,
      suspendedAt: null,
      endedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    await onPaymentEvent(payload("on_payment"));

    expect(transition()[0]).toMatchObject({ kind: "none", why: "alreadyEnded" });
  });

  it("a payment on a SUSPENDED grant resumes it rather than activating a second", async () => {
    purchaseGrant.mockResolvedValue({
      memberId: MEMBER,
      productKey: PLAN,
      suspendedAt: new Date("2026-01-01T00:00:00.000Z"),
      endedAt: null,
    });

    await onPaymentEvent(payload("on_payment"));

    expect(transition()[0].kind).toBe("resume");
  });
});

describe("onPaymentEvent — whose grant it acts on", () => {
  it("falls back to the grant's own owner when the identity no longer resolves", async () => {
    // The checkout token was rotated, or the member deleted: the `custom` is
    // still well-formed — so the PRODUCT resolves out of its `p:` pair — but
    // neither the identity lookup nor the buyer address finds anybody. Without
    // the fallback the transition would decide `noMember` and the refunded
    // customer would keep their access.
    //
    // ⚠️ Not "a refund with no `custom` at all": that is a different path.
    // `parseCustom()` refuses half an identity outright, so a payload with only
    // a `p:` pair parses to `null` and the product does not resolve either —
    // which lands on the grant-row fallback tested below, not on this one.
    state.identity = [];
    state.byEmail = [];
    purchaseGrant.mockResolvedValue({
      memberId: "member-from-grant",
      productKey: PLAN,
      suspendedAt: null,
      endedAt: null,
    });

    await onPaymentEvent(payload("on_refund"));

    const [what, target] = transition();
    expect(what.kind).toBe("end");
    expect(target.memberId).toBe("member-from-grant");
  });

  it("🚨 ends via the grant ROW when the product no longer resolves at all", async () => {
    // `last_paid_day` is how a subscription normally expires. If the product
    // key has left the registry the payload resolves nothing, the ordinary gate
    // is skipped — and there is no redelivery and no reconciliation job, so the
    // grant would never end.
    openPurchaseGrantByPurchase.mockResolvedValue({
      memberId: "member-orphan",
      productKey: "gone_from_registry",
      suspendedAt: null,
      endedAt: null,
    });

    await onPaymentEvent(payload("last_paid_day", { custom: "" }));

    const [what, target] = transition();
    expect(what.kind).toBe("end");
    expect(target).toMatchObject({
      memberId: "member-orphan",
      productKey: "gone_from_registry",
    });
  });

  it("…but that fallback never SUSPENDS on a key the payload never named", async () => {
    // The one direction deliberately dropped: taking access away on a guess.
    openPurchaseGrantByPurchase.mockResolvedValue({
      memberId: "member-orphan",
      productKey: "gone_from_registry",
      suspendedAt: null,
      endedAt: null,
    });

    await onPaymentEvent(payload("on_payment_missed", { custom: "" }));

    expect(applyGrantTransition).not.toHaveBeenCalled();
  });

  it("…and never GRANTS through it either", async () => {
    // The counter-proof for the two above: an unknown product must grant
    // nothing, or a renamed key becomes a way to hand out access.
    openPurchaseGrantByPurchase.mockResolvedValue({
      memberId: "member-orphan",
      productKey: "gone_from_registry",
      suspendedAt: null,
      endedAt: null,
    });

    await onPaymentEvent(payload("on_payment", { custom: "" }));

    expect(applyGrantTransition).not.toHaveBeenCalled();
  });
});

// A token package is the OTHER half of this function, and the half carrying the
// non-null assertions — `memberId!`, `pkg!.credits`. They are correct today
// only because `shouldCreditTokens()` and `creditable` were checked one line
// above, which the compiler cannot see through. These cases are what makes it
// safe to say so in the type system instead.
describe("onPaymentEvent — a token package credits a balance, not a grant", () => {
  const TOKENS = "starter"; // 1000 credits, out of the shipped registry.

  function tokenPayload(event: string, over: Record<string, string> = {}) {
    return payload(event, { custom: `m:${MEMBER};t:${TOKEN};p:${TOKENS}`, ...over });
  }

  it("credits the identified member for the package that was bought", async () => {
    await onPaymentEvent(tokenPayload("on_payment"));

    expect(creditTokens).toHaveBeenCalledTimes(1);
    expect(creditTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: MEMBER,
        credits: 1000,
        ds24OrderId: ORDER,
      }),
    );
  });

  it("🚨 grants nothing — a balance is not an entitlement", async () => {
    // `hasPlan()` would answer false for such a row for ever, so a grant here
    // would be a plan the buyer can never lose and never really had.
    await onPaymentEvent(tokenPayload("on_payment"));

    expect(transition()[0]).toMatchObject({
      kind: "none",
      why: "notAGrantProduct",
    });
  });

  it("credits nobody when the payment could not be attributed", async () => {
    // The guard the assertions below the credit rely on. Without an attributed
    // member there is no balance to credit, and guessing one would put somebody
    // else's money on an account.
    state.identity = [];
    state.byEmail = [];

    await onPaymentEvent(tokenPayload("on_payment"));

    expect(creditTokens).not.toHaveBeenCalled();
  });

  it("credits nothing on an event that is not a payment", async () => {
    await onPaymentEvent(tokenPayload("on_refund"));

    expect(creditTokens).not.toHaveBeenCalled();
  });

  it("🚨 stops an auto top-up when the purchase behind the mandate is reversed", async () => {
    // The worst thing this feature can do is keep charging a card whose payment
    // was just given back, and it is scoped to the purchase that IS the mandate.
    await onPaymentEvent(tokenPayload("on_refund"));

    expect(disarmAutoReload).toHaveBeenCalledWith({
      memberId: MEMBER,
      onlyForPurchaseId: PURCHASE,
      clearMandate: true,
    });
  });

  it("does not fail the event when disarming throws", async () => {
    // The order write and the grant transition matter more, and Digistore24
    // redelivers the whole thing anyway.
    disarmAutoReload.mockRejectedValueOnce(new Error("token tables down"));

    await expect(onPaymentEvent(tokenPayload("on_refund"))).resolves.toBeUndefined();
  });
});

describe("onPaymentEvent — the order write outranks the rest", () => {
  it("writes the order before the entitlement is touched", async () => {
    await onPaymentEvent(payload("on_payment"));

    const orderAt = statements().findIndex((s) => s.includes('insert into "orders"'));
    expect(orderAt, "no order was written at all").toBeGreaterThanOrEqual(0);
    // The money is recorded whatever the entitlement layer then does.
    expect(applyGrantTransition).toHaveBeenCalled();
  });

  it("🚨 records the money even when the entitlement layer throws", async () => {
    // The header's rule that outranks the rest, and the reason step 5 is last.
    // If this inverted, a database blip in the grant tables would lose the
    // record that somebody paid.
    applyGrantTransition.mockRejectedValueOnce(new Error("grant tables down"));

    await expect(onPaymentEvent(payload("on_payment"))).rejects.toThrow(
      "grant tables down",
    );

    expect(statements().some((s) => s.includes('insert into "orders"'))).toBe(true);
  });

  it("keeps the attribution it already has, and fills one it lacked", async () => {
    // Both halves live in the same `onConflictDoUpdate`, and both are about a
    // redelivery: `coalesce(orders.member_id, excluded.member_id)` fills an
    // attribution the first delivery could not make and never clears one it did.
    await onPaymentEvent(payload("on_payment"));

    const insert = statements().find((s) => s.includes('insert into "orders"')) ?? "";
    expect(insert).toContain("on conflict");
    expect(insert).toContain("coalesce");
  });
});
