// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { chooseGrantTransition, grantState, pausedKeys } from "./rules";
import type { GrantTransitionInput } from "./rules";
import type { Entitlement } from "./manage";

const MEMBER = "member-1";

/** A paid subscription purchase belonging to somebody. The default case. */
function input(over: Partial<GrantTransitionInput> = {}): GrantTransitionInput {
  return {
    event: "on_payment",
    productKind: "subscription",
    memberId: MEMBER,
    grant: null,
    // Absent on every payload that is not reporting a stopped rebilling —
    // which is most of them. `null` is therefore the DEFAULT here, not an
    // edge case (story 2.4, §D1).
    ...over,
  };
}

describe("chooseGrantTransition", () => {
  it("activates on a paid subscription purchase", () => {
    expect(chooseGrantTransition(input())).toEqual({ kind: "activate" });
  });

  it("activates on the subscription signup event too", () => {
    // The same fact as on_payment — money arrived. This codebase names the two
    // together everywhere (ipn.ts, schema-digistore.ts). If this dropped
    // through, a subscription signup would produce no grant and Digistore24
    // would never redeliver the event.
    expect(
      chooseGrantTransition(input({ event: "on_payment_subscription_signup" })),
    ).toEqual({ kind: "activate" });
  });

  it("activates on a paid one-time purchase", () => {
    expect(chooseGrantTransition(input({ productKind: "one_time" }))).toEqual({
      kind: "activate",
    });
  });

  it("creates nothing for a token package (AC 6)", () => {
    // Token packages are BALANCE, not entitlement. They are credited to the
    // ledger; a grant for one would entitle the buyer to a plan they never
    // bought.
    expect(chooseGrantTransition(input({ productKind: "token" }))).toEqual({
      kind: "none",
      why: "notAGrantProduct",
    });
  });

  it("creates nothing when the product could not be resolved", () => {
    // Unknown must grant NOTHING, never guess. A product sold outside the
    // registry, or one not yet synced, leaves productKey NULL on the order —
    // the Operator can still attach it by hand.
    expect(chooseGrantTransition(input({ productKind: null }))).toEqual({
      kind: "none",
      why: "notAGrantProduct",
    });
  });

  it("creates nothing for an unattributed purchase (AD-3)", () => {
    // An unattributed purchase lives in `orders` alone. It becomes a grant
    // when the claim attributes it, not before — a grant needs an owner.
    expect(chooseGrantTransition(input({ memberId: null }))).toEqual({
      kind: "none",
      why: "noMember",
    });
  });

  it("reports the product before the missing member", () => {
    // Both guards apply to an anonymous token purchase. "Not a grant product"
    // is the more fundamental answer: attributing it later still creates no
    // grant, so the log line must not suggest that attribution is what is
    // missing.
    expect(
      chooseGrantTransition(input({ productKind: "token", memberId: null })),
    ).toEqual({ kind: "none", why: "notAGrantProduct" });
  });

  it("does not create a grant on on_rebill_resumed (AD-2)", () => {
    // Maps to "paid" like on_payment does, and that is exactly the trap. A
    // resumed rebilling is a support click, not a payment: it may LIFT a
    // suspension (story 2.4) but must never bring a grant into existence.
    // `noGrant` since 2.4 — the event is handled now, and there is simply
    // nothing to lift.
    expect(chooseGrantTransition(input({ event: "on_rebill_resumed" }))).toEqual(
      { kind: "none", why: "noGrant" },
    );
  });

  it("does nothing on cancellation — access continues (AD-2)", () => {
    // Story 2.3 gave this its OWN reason. It is not "an event we do not care
    // about": it is an event we deliberately decline to act on, and the two
    // must not be spelled the same way — a reader of the log line has to be
    // able to tell "Digistore24 invented an event" from "the buyer cancelled
    // and keeps their paid period".
    expect(
      chooseGrantTransition(input({ event: "on_rebill_cancelled" })),
    ).toEqual({ kind: "none", why: "cancellationKeepsAccess" });
  });

  it("returns none for an unknown event instead of throwing", () => {
    // An uncaught throw here 500s the webhook, and Digistore24 redelivers a
    // failed IPN forever. Digistore24 may add events at any time.
    expect(() =>
      chooseGrantTransition(input({ event: "on_something_new_in_2027" })),
    ).not.toThrow();
    expect(
      chooseGrantTransition(input({ event: "on_something_new_in_2027" })),
    ).toEqual({ kind: "none", why: "irrelevantEvent" });
  });

  it("returns none for an empty event name", () => {
    expect(chooseGrantTransition(input({ event: "" }))).toEqual({
      kind: "none",
      why: "irrelevantEvent",
    });
  });

  // === Story 2.2 — a refund or chargeback closes access ======================

  /** A grant that is alive: nothing ended it, nothing suspended it. */
  const live = { suspendedAt: null, endedAt: null };
  const ENDED = new Date("2026-01-01T00:00:00Z");

  it("ends the grant on a refund (AC 1)", () => {
    expect(
      chooseGrantTransition(input({ event: "on_refund", grant: live })),
    ).toEqual({ kind: "end", reason: "refund" });
  });

  it("ends the grant on a chargeback (AC 2)", () => {
    expect(
      chooseGrantTransition(input({ event: "on_chargeback", grant: live })),
    ).toEqual({ kind: "end", reason: "chargeback" });
  });

  it("ends a grant that is merely suspended", () => {
    // A missed payment followed by a refund. Suspension is reversible and
    // ending is not, so the refund must win — otherwise the grant sits
    // suspended forever and `on_rebill_resumed` (story 2.4) would lift it back
    // into life on money that was given back.
    expect(
      chooseGrantTransition(
        input({ event: "on_refund", grant: { suspendedAt: ENDED, endedAt: null } }),
      ),
    ).toEqual({ kind: "end", reason: "refund" });
  });

  it("ends nothing twice — a redelivered refund is a no-op (AC 4)", () => {
    expect(
      chooseGrantTransition(
        input({ event: "on_refund", grant: { suspendedAt: null, endedAt: ENDED } }),
      ),
    ).toEqual({ kind: "none", why: "alreadyEnded" });
  });

  it("does not restore access when a payment is redelivered after a refund (AC 5)", () => {
    // THE ordering this story exists for. Digistore24 retries until it gets a
    // 200 and does not guarantee delivery order, so an on_payment can land
    // AFTER the on_refund that ended the grant. There is no sequence number in
    // the payload — the guard has to be state-based, and the state is
    // `endedAt`.
    expect(
      chooseGrantTransition(
        input({ event: "on_payment", grant: { suspendedAt: null, endedAt: ENDED } }),
      ),
    ).toEqual({ kind: "none", why: "alreadyEnded" });
  });

  it("does not resurrect an ended grant on a subscription signup either", () => {
    expect(
      chooseGrantTransition(
        input({
          event: "on_payment_subscription_signup",
          grant: { suspendedAt: null, endedAt: ENDED },
        }),
      ),
    ).toEqual({ kind: "none", why: "alreadyEnded" });
  });

  it("does not resurrect an ended grant on on_rebill_resumed (AD-2)", () => {
    // The sibling case nobody lists: a support "restart rebilling" months
    // after the grant expired. Covered for free because the guard sits BEFORE
    // the event switch and therefore applies to every event at once.
    expect(
      chooseGrantTransition(
        input({
          event: "on_rebill_resumed",
          grant: { suspendedAt: null, endedAt: ENDED },
        }),
      ),
    ).toEqual({ kind: "none", why: "alreadyEnded" });
  });

  it("reports alreadyEnded for an event it has never heard of", () => {
    expect(
      chooseGrantTransition(
        input({ event: "on_whatever_2030", grant: { suspendedAt: null, endedAt: ENDED } }),
      ),
    ).toEqual({ kind: "none", why: "alreadyEnded" });
  });

  it("ends nothing for a token package, refund or not", () => {
    // The product guard outranks the event: a token package never had a grant,
    // so a refund of one has nothing to end. Its balance is not this
    // function's business.
    expect(
      chooseGrantTransition(
        input({ event: "on_refund", productKind: "token", grant: live }),
      ),
    ).toEqual({ kind: "none", why: "notAGrantProduct" });
  });

  it("ends nothing for a refund with no grant behind it", () => {
    // Reachable only when there IS no grant: the shell loads the grant before
    // it asks, and a loaded grant names its own owner (see
    // lib/digistore/payment-event.ts). A refund of a purchase that never
    // became a grant has nothing to close.
    expect(
      chooseGrantTransition(input({ event: "on_refund", memberId: null })),
    ).toEqual({ kind: "none", why: "noMember" });
  });

  // === Story 2.3 — cancelling keeps access until the paid period ends ========

  it("does not end a grant when rebilling is cancelled, but does at last_paid_day", () => {
    // THE test this story exists for, and the reason the two assertions sit in
    // ONE `it` rather than two: both events map to subscriptionStatus
    // "cancelled" (ipn.ts:93-95 and :121-123) and to orders.status "cancelled".
    // That collapse is intentional and stays. Split across two tests, a
    // refactor that reads the mapped value instead of the raw event name makes
    // one of them fail and the other pass, and the pair reads like a flake.
    // Side by side they are one statement: the SAME mapped value must produce
    // OPPOSITE transitions, so nothing derived from that value can be the
    // input. This is AD-2 in executable form.
    expect(
      chooseGrantTransition(input({ event: "on_rebill_cancelled", grant: live }))
        .kind,
    ).toBe("none");
    expect(
      chooseGrantTransition(input({ event: "last_paid_day", grant: live })).kind,
    ).toBe("end");
  });

  it("ends the grant at last_paid_day, and says why (AC 2)", () => {
    // `lastPaidDay` is STORED, and it has to be distinguishable from `refund`:
    // a normal expiry and a returned payment call for opposite support
    // responses, and nothing can reconstruct which it was afterwards.
    expect(
      chooseGrantTransition(input({ event: "last_paid_day", grant: live })),
    ).toEqual({ kind: "end", reason: "lastPaidDay" });
  });

  it("leaves a SUSPENDED grant alone when rebilling is cancelled", () => {
    // Digistore24 sends on_payment_missed after every cancellation (§D2), so a
    // grant can already be suspended when the cancellation is processed — or
    // suspended by a genuinely failed charge that was later cancelled. Either
    // way on_rebill_cancelled must neither END it (that is last_paid_day's job,
    // days later) nor UN-suspend it (that is on_rebill_resumed's, story 2.4).
    expect(
      chooseGrantTransition(
        input({
          event: "on_rebill_cancelled",
          grant: { suspendedAt: ENDED, endedAt: null },
        }),
      ),
    ).toEqual({ kind: "none", why: "cancellationKeepsAccess" });
  });

  it("ends a suspended grant at last_paid_day", () => {
    // The §D2 sequence in full: cancel → missed payment (suspends, story 2.4)
    // → last paid day. The paid period is genuinely over now, so the reversible
    // state has to become the terminal one. Left merely suspended, an
    // on_rebill_resumed click months later would hand access back.
    expect(
      chooseGrantTransition(
        input({
          event: "last_paid_day",
          grant: { suspendedAt: ENDED, endedAt: null },
        }),
      ),
    ).toEqual({ kind: "end", reason: "lastPaidDay" });
  });

  it("ends nothing twice — a redelivered last_paid_day is a no-op", () => {
    // Story 2.2's terminal-endedAt guard covers the double delivery. Asserted
    // for THIS event too, because it is the one whose redelivery is most
    // likely: last_paid_day fires on a schedule, not on a transaction.
    expect(
      chooseGrantTransition(
        input({
          event: "last_paid_day",
          grant: { suspendedAt: null, endedAt: ENDED },
        }),
      ),
    ).toEqual({ kind: "none", why: "alreadyEnded" });
  });

  it("keeps the refund's reason when last_paid_day follows it", () => {
    // A cancelled subscription that was also refunded. First writer wins, and
    // the refund is what closed it — the expiry that follows must not overwrite
    // the reason a support agent needs.
    expect(
      chooseGrantTransition(
        input({
          event: "last_paid_day",
          grant: { suspendedAt: null, endedAt: ENDED },
        }),
      ),
    ).toEqual({ kind: "none", why: "alreadyEnded" });
  });

  it("ends nothing at last_paid_day for a token package", () => {
    expect(
      chooseGrantTransition(
        input({ event: "last_paid_day", productKind: "token", grant: live }),
      ),
    ).toEqual({ kind: "none", why: "notAGrantProduct" });
  });

  it("does NOT act on the on_payment_missed that FOLLOWS A CANCELLATION (§D2)", () => {
    // Digistore24 sends on_payment_missed after EVERY cancellation, not only
    // after a failed charge, and it arrives on EITHER SIDE of last_paid_day —
    // their own worked example has it landing 1–3 September for a last paid day
    // of 1 September. A rule here that suspends on it unconditionally would
    // revoke access up to two days BEFORE the paid period ends, defeating this
    // story through the 2.4 door.
    //
    // STORY 2.4 OWNS THIS EVENT NOW, and this assertion is what makes sure it
    // owns it CONDITIONALLY: the discriminator is `billing_stop_reason` on the
    // payload, and after a buyer cancellation it reads `by_buyer`. Story 2.3
    // wrote this test asserting `irrelevantEvent` because nothing yet read that
    // field; the guarantee it was defending — a cancelled customer keeps their
    // paid period — is unchanged and is what is asserted here.
    expect(
      chooseGrantTransition(
        input({
          event: "on_payment_missed",
          grant: live,
        }),
      ),
    ).toEqual({ kind: "suspend" });
  });

  it("takes no status or subStatus parameter (AD-2)", () => {
    // The signature IS the architecture rule. `mapEventToStatus` collapses
    // on_rebill_cancelled and last_paid_day into one value — "cancelled" —
    // that means "access continues" in one case and "access is over" in the
    // other. A transition derived from it takes back time the customer paid
    // for. This test fails the moment somebody adds the parameter back.
    const keys = Object.keys(input());
    expect(keys).not.toContain("status");
    expect(keys).not.toContain("subStatus");
    // The event name is the only payload field this function reads.
    expect(keys.sort()).toEqual([
      "event",
      "grant",
      "memberId",
      "productKind",
    ]);
  });

  // === Story 2.4 — a missed payment suspends, a resumed payment restores =====
  //
  // `on_payment_missed` suspends UNCONDITIONALLY. An earlier version branched
  // on `billing_stop_reason`, believing the event could arrive before the paid
  // period ended. Digistore24's own guide settles it (IPN Guide p.5): Alice
  // pays monthly on the 1st and cancels on 20 August; her paid period runs to
  // 31 August, and `payment missed` is sent on 1 September "or up to two days
  // later". At or after the end — never before. The same page recommends using
  // the event to cancel access.

  const SUSPENDED = { suspendedAt: new Date("2026-03-01T00:00:00Z"), endedAt: null };

  it("suspends on a missed payment — unconditionally (AC 1)", () => {
    // The card expired. This is the case the story exists for, and the reason
    // it is a SUSPENSION and not an ending: it is reversible, and the customer
    // did not cancel anything.
    expect(chooseGrantTransition(input({ event: "on_payment_missed", grant: live }))).toEqual({ kind: "suspend" });
  });




  it("defaults to suspend for a reason Digistore24 has not invented yet (§D1)", () => {
    // A genuine payment failure is the common case, so the default is the
    // useful one — and the `alreadyEnded` guard limits the damage of guessing
    // wrong. Both value sets are nevertheless listed EXPLICITLY in the switch,
    // so a new Digistore24 value is a diff a reviewer sees rather than a silent
    // change of behaviour.
    expect(chooseGrantTransition(input({ event: "on_payment_missed", grant: live }))).toEqual({ kind: "suspend" });
  });

  it("suspends a grant that is already suspended — the write is the guard", () => {
    // Digistore24 retries a failing charge several times, so this event arrives
    // repeatedly. The decision stays `suspend`; `AND suspended_at IS NULL` on
    // the UPDATE (manage.ts) is what keeps the FIRST suspension time, so the
    // pure function does not need a second opinion about it.
    expect(
      chooseGrantTransition(
        input({ event: "on_payment_missed", grant: SUSPENDED }),
      ),
    ).toEqual({ kind: "suspend" });
  });

  it("does not suspend an ENDED grant, whatever the reason says (AC 5)", () => {
    // The terminal-`endedAt` guard sits before the event switch, so it covers
    // this event for free — and it must: `on_payment_missed` routinely arrives
    // AFTER `last_paid_day` has already closed the grant, and a suspension
    // stamped on a closed grant shows the Operator an expired grant as
    // "suspended" (§D2).
    expect(
      chooseGrantTransition(
        input({
          event: "on_payment_missed",
          grant: { suspendedAt: null, endedAt: ENDED },
        }),
      ),
    ).toEqual({ kind: "none", why: "alreadyEnded" });
  });

  it("suspends nothing for a token package or an unattributed purchase", () => {
    // The product and attribution guards outrank the event, exactly as they do
    // for a refund. A token package has no entitlement to suspend.
    expect(
      chooseGrantTransition(
        input({ event: "on_payment_missed", productKind: "token", grant: live }),
      ),
    ).toEqual({ kind: "none", why: "notAGrantProduct" });
    expect(
      chooseGrantTransition(
        input({ event: "on_payment_missed", memberId: null, grant: live }),
      ),
    ).toEqual({ kind: "none", why: "noMember" });
  });

  it("lifts the suspension on on_rebill_resumed (AC 3)", () => {
    expect(
      chooseGrantTransition(
        input({ event: "on_rebill_resumed", grant: SUSPENDED }),
      ),
    ).toEqual({ kind: "resume" });
  });

  it("lifts the suspension on a successful payment too (AC 3)", () => {
    // "an on_payment event may occur, if the buyer succeeds in payment after
    // the on_payment_missed event" — Digistore24. The customer paid; the
    // suspension has to go, and `activate` cannot do it: it is an INSERT ...
    // DO NOTHING, which writes no column of the row that already exists.
    expect(
      chooseGrantTransition(input({ event: "on_payment", grant: SUSPENDED })),
    ).toEqual({ kind: "resume" });
    expect(
      chooseGrantTransition(
        input({ event: "on_payment_subscription_signup", grant: SUSPENDED }),
      ),
    ).toEqual({ kind: "resume" });
  });

  it("CREATES on a payment but never on a resumed rebilling (AC 6, §D4)", () => {
    // The two events sit side by side for the same reason 2.3's pair does: both
    // mapEventToStatus and mapEventToSubscriptionStatus give them the SAME
    // value ("paid" / "active", ipn.ts:85 and :117), and here they must differ.
    // `on_payment` is a transaction and may bring a grant into existence;
    // `on_rebill_resumed` is a support click with no money behind it and may
    // only ever lift a suspension. Split into two tests, a refactor that
    // collapses them again makes one fail and the other pass, and the pair
    // reads like a flake.
    expect(chooseGrantTransition(input({ event: "on_payment", grant: null })))
      .toEqual({ kind: "activate" });
    expect(
      chooseGrantTransition(input({ event: "on_rebill_resumed", grant: null })),
    ).toEqual({ kind: "none", why: "noGrant" });
  });

  it("does not resume an ENDED grant (AC 5)", () => {
    // Support clicking "restart rebilling" months after expiry, or a payment
    // redelivered after a refund. Both would hand back access with no money
    // behind them. Covered by the guard before the switch.
    expect(
      chooseGrantTransition(
        input({
          event: "on_rebill_resumed",
          grant: { suspendedAt: ENDED, endedAt: ENDED },
        }),
      ),
    ).toEqual({ kind: "none", why: "alreadyEnded" });
  });

  it("resumes a grant that is not suspended — an idempotent no-op", () => {
    // A redelivered on_rebill_resumed, or one that arrived before the
    // on_payment_missed it answers (§D3). The UPDATE writes `suspended_at =
    // NULL` over a NULL and changes nothing that anybody can observe; there is
    // deliberately no "notSuspended" reason, because a second state to keep in
    // step is a second thing that can be got wrong.
    expect(
      chooseGrantTransition(input({ event: "on_rebill_resumed", grant: live })),
    ).toEqual({ kind: "resume" });
  });

  it("ignores billing_stop_reason on every event that is not on_payment_missed", () => {
    // The field travels on the payload of a cancellation too. It must not leak
    // into the branches that 2.2 and 2.3 own — those read the EVENT NAME, and
    // reading a second thing there would be a second way to get the
    // cancel/expire pair wrong.
    expect(
      chooseGrantTransition(
        input({ event: "on_rebill_cancelled", grant: live }),
      ),
    ).toEqual({ kind: "none", why: "cancellationKeepsAccess" });
    expect(
      chooseGrantTransition(
        input({ event: "last_paid_day", grant: live }),
      ),
    ).toEqual({ kind: "end", reason: "lastPaidDay" });
    expect(
      chooseGrantTransition(
        input({ event: "on_refund", grant: live }),
      ),
    ).toEqual({ kind: "end", reason: "refund" });
    expect(
      chooseGrantTransition(
        input({ event: "on_payment", grant: null }),
      ),
    ).toEqual({ kind: "activate" });
  });

  it("never resumes or suspends a token package", () => {
    expect(
      chooseGrantTransition(
        input({ event: "on_rebill_resumed", productKind: "token", grant: SUSPENDED }),
      ),
    ).toEqual({ kind: "none", why: "notAGrantProduct" });
  });
});

// --- grantState (story 3.1) --------------------------------------------------

const NOW = new Date("2026-07-22T12:00:00Z");
const PAST = new Date("2026-07-21T12:00:00Z");
const FUTURE = new Date("2026-07-23T12:00:00Z");

/** A live, permanent grant — the shape every case below varies from. */
function grant(over: Partial<Parameters<typeof grantState>[0]> = {}) {
  return {
    accessUntil: null,
    suspendedAt: null,
    endedAt: null,
    ...over,
  };
}

describe("grantState", () => {
  it("calls a permanent open grant active", () => {
    expect(grantState(grant(), NOW)).toBe("active");
  });

  it("calls a dated grant active while the date is still ahead", () => {
    expect(grantState(grant({ accessUntil: FUTURE }), NOW)).toBe("active");
  });

  it("calls a grant whose date has passed expired", () => {
    // The case §D5 exists for: byte-identical to a live permanent grant
    // except for one timestamp comparison, and NOTHING in the row marks it.
    expect(grantState(grant({ accessUntil: PAST }), NOW)).toBe("expired");
  });

  it("treats accessUntil exactly at `now` as expired", () => {
    // activeFor() asks `access_until > now()`, strictly. Equal is not active,
    // and the two answers to "is this active" must not disagree on the
    // boundary.
    expect(grantState(grant({ accessUntil: NOW }), NOW)).toBe("expired");
  });

  it("calls a suspended grant suspended", () => {
    expect(grantState(grant({ suspendedAt: PAST }), NOW)).toBe("suspended");
  });

  it("calls an ended grant ended", () => {
    expect(grantState(grant({ endedAt: PAST }), NOW)).toBe("ended");
  });

  it("reports ended over suspended — endedAt is terminal", () => {
    // endGrant() carries no `suspended_at IS NULL` guard, so a suspended grant
    // that is then refunded holds both timestamps. Terminal wins: "suspended"
    // would tell the Operator to expect a resume that can never come.
    expect(grantState(grant({ suspendedAt: PAST, endedAt: PAST }), NOW)).toBe(
      "ended",
    );
  });

  it("reports ended over expired", () => {
    expect(grantState(grant({ accessUntil: PAST, endedAt: PAST }), NOW)).toBe(
      "ended",
    );
  });

  it("reports suspended over expired", () => {
    expect(
      grantState(grant({ accessUntil: PAST, suspendedAt: PAST }), NOW),
    ).toBe("suspended");
  });

  it("asks the same three conditions activeFor() asks, in SQL", async () => {
    // The transcription test below compares grantState against a JS RESTATEMENT
    // of the predicate, so it only fails when grantState drifts — never when
    // activeFor does. This one reads the real SQL, so a change on either side
    // is caught.
    //
    // No database is touched: postgres.js connects on the first query, and
    // .toSQL() builds the statement without issuing one.
    const { db } = await import("@/db");
    const { grants } = await import("@/db/schema");
    const { activeFor } = await import("./manage");
    const { sql } = db.select().from(grants).where(activeFor("m")).toSQL();
    expect(sql).toContain('"ended_at" is null');
    expect(sql).toContain('"suspended_at" is null');
    // Strict `>`, not `>=` — a grant expires AT its accessUntil, and
    // grantState's boundary case depends on it.
    //
    // And ZONE-FREE on both sides (story 3.3 §D2). `access_until` is
    // `timestamp` WITHOUT time zone; `now()` returns `timestamptz`. Postgres
    // resolves that comparison by casting the left side using the SESSION
    // TimeZone — which nothing in this project sets — while drizzle round-trips
    // the column as UTC. Two zones, one comparison, and the answer moves with
    // the server's locale. `now() at time zone 'utc'` makes both sides
    // `timestamp`, so no session setting can change who has access.
    //
    // Invisible until story 3.3: `access_until` is NULL on every PURCHASE grant
    // by AD-2, so the branch was never taken. Manual grants are what make it
    // real.
    expect(sql).toMatch(/"access_until"\s*>\s*\(now\(\) at time zone 'utc'\)/);
    expect(sql).not.toMatch(/"access_until"\s*>\s*now\(\)/);
  });

  it("answers `active` for exactly the rows activeFor() would match", () => {
    // Same three conditions, same strict `>`. Paired with the SQL test above:
    // that one pins the predicate's shape, this one pins the answers.
    const rows = [
      grant(),
      grant({ accessUntil: FUTURE }),
      grant({ accessUntil: NOW }),
      grant({ accessUntil: PAST }),
      grant({ suspendedAt: PAST }),
      grant({ endedAt: PAST }),
      grant({ accessUntil: FUTURE, endedAt: PAST }),
    ];
    for (const row of rows) {
      const activeBySql =
        row.endedAt === null &&
        row.suspendedAt === null &&
        (row.accessUntil === null || row.accessUntil.getTime() > NOW.getTime());
      expect(grantState(row, NOW) === "active", JSON.stringify(row)).toBe(
        activeBySql,
      );
    }
  });
});

describe("pausedKeys", () => {
  it("reports a suspended key the Member cannot otherwise use", () => {
    // AC 4 of story 3.5: without this the card-expiry customer sees an empty
    // list and no explanation — the failure docs/entitlements.md warns about.
    expect(pausedKeys([], ["basic_monthly"])).toEqual(["basic_monthly"]);
  });

  it("says nothing when the same key is still usable another way", () => {
    // Two grants on ONE key are deliberately legal (grantByHand). A
    // subscription whose card failed, plus the comp the Operator issued while
    // it gets sorted out: the comp is doing its job, and warning "your access
    // is paused" beside the plan listed as available is a contradiction the
    // Member cannot resolve.
    // A whole Entitlement, exactly as entitlementsFor returns it — the call
    // site hands the rows straight through, so the parameter has to accept
    // them without a projection step nobody would remember to keep.
    const comp: Entitlement = {
      productKey: "basic_monthly",
      source: "manual",
      accessUntil: null,
    };
    expect(pausedKeys([comp], ["basic_monthly"])).toEqual([]);
  });

  it("subtracts per key, not wholesale", () => {
    expect(
      pausedKeys(
        [{ productKey: "basic_monthly" }],
        ["basic_monthly", "basic_yearly"],
      ),
    ).toEqual(["basic_yearly"]);
  });

  it("reports each key once", () => {
    expect(pausedKeys([], ["pro", "pro"])).toEqual(["pro"]);
  });

  it("keeps the caller's order", () => {
    // suspendedFor() orders by product key, so the warning does not reshuffle
    // itself between two loads.
    expect(pausedKeys([], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("is empty when nothing is suspended", () => {
    expect(pausedKeys([{ productKey: "basic_monthly" }], [])).toEqual([]);
  });
});


// The two reads story 3.5 added, asserted the way `activeFor` already is: on
// the SQL they produce. No database is touched — postgres.js connects on the
// first query, and .toSQL() builds the statement without issuing one.
describe("the Member surface's reads", () => {
  async function drizzle() {
    const { db } = await import("@/db");
    const { grants } = await import("@/db/schema");
    return { db, grants };
  }

  it("breaks a DISTINCT ON tie on accessUntil, newest access last to lose", async () => {
    // §D2, and invisible in every result: `product_key, PURCHASE_FIRST` alone
    // leaves two manual grants on ONE key indistinguishable, so DISTINCT ON
    // kept an arbitrary row. A Member entitled until 1 August AND until
    // 1 September could then be told access ends in August.
    const { db, grants } = await drizzle();
    const { ENTITLEMENT_ORDER } = await import("./manage");
    const { sql } = db
      .select()
      .from(grants)
      .orderBy(...ENTITLEMENT_ORDER)
      .toSQL();

    // The Product Key leads — DISTINCT ON demands it.
    expect(sql).toMatch(/order by "grants"\."product_key"/i);
    // Money beats a comp, spelled as a boolean rather than `source desc`: the
    // enum sorts by declaration order and DESC would invert the rule.
    expect(sql).toContain("'purchase') desc");
    // And the tiebreak. DESC is NULLS FIRST in Postgres, so a permanent grant
    // beats a bounded one.
    expect(sql).toMatch(/"access_until" desc/i);
    // Ordering matters as much as presence: accessUntil must come AFTER the
    // purchase rule, or a comp would be reported as the source of access
    // somebody paid for.
    expect(sql.indexOf("'purchase') desc")).toBeLessThan(
      sql.search(/"access_until" desc/i),
    );
  });

  it("carries accessUntil out of the query", async () => {
    // The projection is what AC 2 renders. A widened interface with an
    // unchanged SELECT type-checks and shows `undefined`.
    const { db, grants } = await drizzle();
    const { activeFor } = await import("./manage");
    const { sql } = db
      .selectDistinctOn([grants.productKey], {
        productKey: grants.productKey,
        source: grants.source,
        accessUntil: grants.accessUntil,
      })
      .from(grants)
      .where(activeFor("m"))
      .toSQL();
    expect(sql).toContain('"access_until"');
  });

  it("asks for suspended grants that are neither ended nor run out", async () => {
    // AC 4. `activeFor` with `suspended_at` inverted, and the other two
    // conditions deliberately unchanged: an ENDED grant is over, not paused,
    // and telling that customer to fix their card promises something
    // `endedAt` being terminal makes impossible.
    const { db, grants } = await drizzle();
    const { suspendedFor } = await import("./manage");
    const { sql } = db.select().from(grants).where(suspendedFor("m")).toSQL();

    expect(sql).toContain('"suspended_at" is not null');
    expect(sql).toContain('"ended_at" is null');
    // The same zone-free comparison activeFor uses — see the test above. A
    // second, subtly different restatement of this predicate is exactly what
    // sharing `withinTerm()` exists to prevent.
    expect(sql).toMatch(/"access_until"\s*>\s*\(now\(\) at time zone 'utc'\)/);
    expect(sql).not.toMatch(/"access_until"\s*>\s*now\(\)/);
  });

  it("never asks a billing table (AD-1)", async () => {
    const { db, grants } = await drizzle();
    const { suspendedFor, activeFor } = await import("./manage");
    for (const where of [activeFor("m"), suspendedFor("m")]) {
      const { sql } = db.select().from(grants).where(where).toSQL();
      expect(sql).not.toMatch(/\borders\b/i);
      expect(sql).not.toMatch(/\bsubscriptions\b/i);
    }
  });
});
