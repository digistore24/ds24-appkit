// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Attaching purchases to the Member who made them.
//
// Two callers, one body: the sign-in event (all unattributed orders for the
// address the Member just proved) and the Operator's manual attach (one order,
// Story 1.7). Sharing the function is what makes "the manual attach behaves
// exactly like an automatic claim" true by construction rather than by review.
//
// The work is two passes, keyed differently ON PURPOSE:
//
//   1. ATTRIBUTE — a conditional UPDATE (member_id IS NULL) so two concurrent
//      sign-ins, or a sign-in racing the Operator, cannot both win a row. This
//      decides what gets *attributed*.
//
//   2. CREDIT — over ALL of the Member's paid token orders, not only the ones
//      pass 1 just touched. Digistore24 retries until it gets a 200, so a
//      crash between attributing and crediting is recoverable — but only if the
//      next pass reconsiders orders that are already attributed. The ledger's
//      unique (accountId, ds24OrderId) is the idempotency key, not the order's
//      attribution state. Conflating the two is the expensive mistake here.
//
//   3. GRANT — the same idea for everything that is NOT a token package. This
//      pass exists because there is no second chance: Digistore24 does not
//      redeliver an event it already got a 200 for, so the `on_payment` that
//      would have created the grant was acknowledged weeks before the buyer
//      signed up. Without this pass a Member who has PAID would have no
//      entitlement, permanently, and no job would ever come back to fix it.
//      Idempotent through the partial unique index on grants, so it may safely
//      reconsider every order on every sign-in — exactly as pass 2 does.
//
//   4. SUBSCRIPTIONS — the mirror is keyed on buyerEmail alone and no claim
//      path used to touch it, so a subscription bought while signed out kept
//      member_id NULL forever.
import { db } from "@/db";
import { grants, orders, subscriptions, tokenAccounts, tokenLedger } from "@/db/schema";
import { and, eq, isNull, isNotNull, inArray, sql } from "drizzle-orm";
import { normalizeEmail } from "@/lib/users/rules";
import { creditTokens } from "@/lib/tokens/account";
import { chooseGrantTransition } from "@/lib/entitlements/rules";
import { applyGrantTransition } from "@/lib/entitlements/manage";
import { getProduct } from "./products";
// The claim filter is a PURE, TESTED rule, not four SQL where-clauses:
// lib/digistore/claimable.ts. Re-exported so existing importers keep working.
import { CLAIMABLE_STATUSES, GRANTABLE_STATUSES } from "./claimable";
export { CLAIMABLE_STATUSES } from "./claimable";


export interface ClaimResult {
  attributed: number;
  credited: number;
  /** Purchase grants created by this run. Already-granted orders count 0. */
  granted: number;
}

/**
 * Attaches every unattributed, PAID purchase for `email` to `memberId`, then
 * credits any token purchases among the Member's paid orders.
 *
 * Idempotent: run it again and pass 1 attaches nothing new (the rows are no
 * longer NULL) and pass 2 credits nothing new (the ledger rejects the repeat).
 */
export async function claimOrdersFor(
  memberId: string,
  email: string | null | undefined,
): Promise<ClaimResult> {
  const normalized = normalizeEmail(email);
  // A null email cannot claim: `lower(buyer_email) = NULL` matches nothing
  // while looking like it might, and users.email is nullable.
  if (!normalized) return { attributed: 0, credited: 0, granted: 0 };

  // --- Pass 1: attribute -----------------------------------------------------
  const attributed = await db
    .update(orders)
    .set({ memberId, updatedAt: new Date() })
    .where(
      and(
        isNull(orders.memberId),
        inArray(orders.status, CLAIMABLE_STATUSES),
        // Raw address normalised in SQL; the session email is normalised in
        // JS above — the mirror image of what the IPN does.
        eq(sql`lower(btrim(${orders.buyerEmail}))`, normalized),
      ),
    )
    .returning({ id: orders.id });

  const credited = await creditClaimedTokenOrders(memberId);
  const granted = await grantClaimedOrders(memberId);
  await attachClaimedSubscriptions(memberId);
  return { attributed: attributed.length, credited, granted };
}

/** Attach one specific order (the Operator's manual attach, Story 1.7). */
export async function claimOneOrder(
  memberId: string,
  ds24OrderId: string,
): Promise<{ attached: boolean; credited: number; granted: number }> {
  const attached = await db
    .update(orders)
    .set({ memberId, updatedAt: new Date() })
    .where(
      and(
        eq(orders.ds24OrderId, ds24OrderId),
        // Fill only. An IPN redelivery may have attributed it between the
        // Operator seeing the list and clicking — refuse rather than overwrite.
        isNull(orders.memberId),
        inArray(orders.status, CLAIMABLE_STATUSES),
      ),
    )
    .returning({ id: orders.id });
  if (attached.length === 0)
    return { attached: false, credited: 0, granted: 0 };
  const credited = await creditClaimedTokenOrders(memberId);
  const granted = await grantClaimedOrders(memberId);
  await attachClaimedSubscriptions(memberId);
  return { attached: true, credited, granted };
}

/**
 * Credits every PAID token order attributed to this Member whose credit has
 * not yet been booked. Driven by the order rows, made safe by the ledger's
 * idempotency — a purchase already credited is a no-op.
 *
 * STAYS ON `paid` ALONE — do NOT reach for `CLAIMABLE_STATUSES` here, however
 * much it looks like the same query (story 2.3 §D4). That constant widens the
 * filter for ENTITLEMENTS, where `cancelled` and `paused` still mean "access
 * continues / may continue". A BALANCE has no such lifecycle: money that
 * reached `paused` or `cancelled` on a token order is money in some unfinished
 * state, and crediting it would hand out tokens that are then spent and cannot
 * be taken back. Token packages are one-off and are not supposed to reach
 * those statuses at all — this filter is what makes that an enforced fact
 * rather than an assumption, and the `kind === "token"` check below is the
 * second half of the same guard.
 */
async function creditClaimedTokenOrders(memberId: string): Promise<number> {
  const rows = await db
    .select({
      ds24OrderId: orders.ds24OrderId,
      productKey: orders.productKey,
      credits: orders.credits,
      ds24PurchaseId: orders.ds24PurchaseId,
    })
    .from(orders)
    .where(
      and(
        eq(orders.memberId, memberId),
        eq(orders.status, "paid"),
        isNotNull(orders.credits),
        // Already booked? Then skip it HERE, in SQL.
        //
        // This runs on EVERY sign-in, not only the first, and it used to load
        // every paid order the Member has ever had and then make ~6 database
        // round trips per row to discover that each was a no-op. Inside an
        // event Auth.js AWAITS: the session cookie is created but not yet
        // returned, and the magic-link token is already consumed. A throw is
        // caught below — a TIMEOUT is not. Nothing throws, the response never
        // arrives, the cookie is discarded and the link is burnt, and every
        // retry re-runs the same doomed loop.
        //
        // The key is still the LEDGER's, not the order's attribution state, so
        // a claim that crashed between attributing and crediting is still
        // picked up next time — that distinction is the one thing this pass
        // must not lose.
        sql`not exists (
          select 1 from ${tokenLedger} l
          join ${tokenAccounts} a on a.id = l.account_id
          where a.member_id = ${memberId}
            and l.ds24_order_id = ${orders.ds24OrderId}
        )`,
      ),
    );

  let credited = 0;
  for (const row of rows) {
    // Only token orders carry credits. A subscription order has none and is
    // handled by the entitlement layer, not the balance.
    if (!row.credits || row.credits <= 0 || !row.productKey) continue;
    // Skip a productKey the registry no longer knows — its kind is unverifiable
    // NO live-registry re-check here, deliberately.
    //
    // `credits` is written by payment-event.ts ONLY through safeTokenPackage,
    // which returns null for anything that is not kind:"token". So a stored
    // `credits > 0` already IS the proof that this was a token package at
    // payment time — the moment that counts.
    //
    // Asking `getProduct(...).kind` again would let the LIVE registry veto a
    // credit the buyer already paid for: retire a package, rename its key, or
    // flip its kind, and every unclaimed purchase of it becomes permanently
    // uncreditable — silently, on every future sign-in. That is exactly what
    // "the stored figure, never the live registry" is meant to prevent, and
    // taking the amount from the row while letting the registry decide WHETHER
    // to pay was half the rule.

    try {
      const { credited: didCredit } = await creditTokens({
        memberId,
        credits: row.credits, // the STORED figure, never the live registry
        ds24OrderId: row.ds24OrderId,
        note: `Nachträglich gutgeschrieben (${row.credits} Token)`,
        origin: "topup",
        linkPurchaseId: row.ds24PurchaseId ?? undefined,
      });
      if (didCredit) credited += 1;
    } catch (error) {
      // One bad row must not cost the Member every row behind it. Without this
      // a deterministically failing order aborts the loop on every sign-in
      // forever, and which purchases are lost depends on an unspecified order.
      console.error(`[claim] crediting order ${row.ds24OrderId} failed:`, error);
    }
  }
  return credited;
}

/**
 * Creates a purchase grant for every PAID, non-token order attributed to this
 * Member. Pass 3.
 *
 * Why it cannot be left to a later IPN: Digistore24 does not redeliver an
 * event it already got a 200 for (payment-event.ts:147-149). The `on_payment`
 * that would have created the grant was acknowledged when nobody owned the
 * purchase. There is no second chance and no scheduled job (AD-8) — without
 * this pass the Member has paid and has no entitlement, permanently.
 *
 * Driven by the order rows and made safe by the partial unique index on
 * `grants`, so reconsidering every order on every sign-in is free of
 * consequence — the same reasoning pass 2 documents at the top of this file.
 *
 * Filtered on `CLAIMABLE_STATUSES`, not on `paid` (story 2.3 §D4, AC 4): a
 * cancelled-but-still-running subscription is exactly the purchase this pass
 * has to find. See the constant for what stays excluded and why.
 *
 * KNOWN LIMITATION, and it is the price of §D4 — `orders.status` CANNOT tell a
 * cancellation that is still inside its paid period from one whose period is
 * over. Both `on_rebill_cancelled` and `last_paid_day` map to `cancelled`
 * (ipn.ts:93-95), the same collapse `chooseGrantTransition` refuses to read.
 * For a purchase that already HAS a grant this costs nothing: `last_paid_day`
 * ended it, and the insert below hits the partial unique index and does
 * nothing (DO NOTHING writes no column). The gap is the purchase that never
 * had a grant at all — bought anonymously, cancelled, expired, and only then
 * claimed — which is granted access it no longer holds. Closing it needs a
 * paid-through date the mirror does not carry today; story 2.5 is where that
 * date arrives. Narrow, and strictly better than the status quo it replaces,
 * in which the same buyer could claim NOTHING — but it is real, so it is
 * written down rather than discovered later.
 */
async function grantClaimedOrders(memberId: string): Promise<number> {
  const rows = await db
    .select({
      productKey: orders.productKey,
      ds24PurchaseId: orders.ds24PurchaseId,
    })
    .from(orders)
    .where(
      and(
        eq(orders.memberId, memberId),
        // GRANTABLE, not CLAIMABLE — `paused` is deliberately absent. A
        // subscription in payment default should be attributed and should show
        // up for the Operator, but must not hand out a LIVE entitlement on
        // sign-in: this pass only ever offers `on_payment`, whose answer is
        // `activate`. Once story 2.4 suspends on `on_payment_missed`, signing
        // in would otherwise launder the suspension away, permanently.
        inArray(orders.status, GRANTABLE_STATUSES),
        isNotNull(orders.productKey),
        // Same bounding as the credit pass: skip in SQL what already has a
        // grant, instead of loading every order and letting the partial unique
        // index discover the no-op one INSERT at a time. The steady state after
        // the first sign-in is one indexed query returning nothing.
        sql`not exists (
          select 1 from ${grants} g
          where g.ds24_purchase_id = ${orders.ds24PurchaseId}
            and g.product_key = ${orders.productKey}
        )`,
      ),
    );

  let granted = 0;
  for (const row of rows) {
    // No key means the purchase never said what it was — an order placed
    // before `node run.mjs ds24-sync` ran, or a product sold outside this registry.
    // Never guess one; the Operator can attach it by hand.
    if (!row.productKey) continue;
    // Provenance is a CHECK constraint on `grants`. Skipping here rather than
    // in applyGrantTransition keeps this pass from logging the same warning on
    // every single sign-in.
    //
    // ⚠️ A row written before the order-id fix (lib/digistore/payment-event.ts)
    // has NULL here and is skipped for ever, although the money is recorded and
    // the product key is known. One statement repairs it, and then the next
    // sign-in grants what was bought:
    //
    //     update orders set ds24_purchase_id = ds24_order_id
    //     where ds24_purchase_id is null;
    //
    // Repairing it HERE instead was considered and rejected: this pass runs on
    // every sign-in and must not start writing columns it exists to read.
    if (!row.ds24PurchaseId) continue;

    // Skip a productKey the registry no longer knows — its kind is
    // unverifiable and it must not take the sign-in down.
    let kind;
    try {
      kind = getProduct(row.productKey).kind;
    } catch {
      console.warn(
        `[claim] product "${row.productKey}" is no longer in the registry`,
      );
      continue;
    }

    // The SAME pure decision the IPN uses, replaying the `on_payment` that was
    // acknowledged before this Member existed. Not a second copy of the rule:
    // the token guard (AC 6) and the attribution guard (AD-3) are asserted in
    // one place only.
    // `grant: null` without a lookup, unlike the IPN path (payment-event.ts).
    // This pass only ever offers `on_payment`, and its answer for an already
    // ENDED grant would be `activate` — which reaches the insert, hits the
    // partial unique index and does nothing. DO NOTHING writes no column of
    // the existing row, so a refunded grant cannot be resurrected from here
    // even when the decision is uninformed.
    //
    // It is NOT unreachable, contrary to what this comment said before: several
    // orders share one purchase id once a subscription rebills, so refunding a
    // rebill flips only that order to `refunded` while the original on_payment
    // order stays `paid` — and the filter above lets it through to an ended
    // grant. Safe today only because DO NOTHING writes nothing.
    //
    // Story 2.4 gives this pass a state to react to — lifting a suspension —
    // and `resume` is an UPDATE, not an insert. It MUST load the grant first;
    // it cannot inherit this pass's safety.
    const transition = chooseGrantTransition({
      event: "on_payment",
      productKind: kind,
      memberId,
      grant: null,
      // There is no payload here — this pass REPLAYS a payment, it does not
      // receive one. The field only ever discriminates `on_payment_missed`
      // (rules.ts §D1), and this pass never offers that event.
    });
    // Still `activate` only. With `grant: null` the decision can never come
    // back `resume` — and it must not: `paused` orders are excluded from
    // GRANTABLE_STATUSES precisely so that signing in cannot launder away a
    // suspension (claimable.ts). A resume needs the grant loaded first, which
    // this pass deliberately does not do.
    if (transition.kind !== "activate") continue;

    const created = await applyGrantTransition(transition, {
      memberId,
      productKey: row.productKey,
      ds24PurchaseId: row.ds24PurchaseId,
    });
    if (created) granted += 1;
  }
  return granted;
}

/**
 * Attaches the subscription mirror rows behind this Member's purchases. Pass 4.
 *
 * Keyed on the PURCHASE ID coming from `orders` — Epic 1's strong attribution,
 * already computed. Deliberately NOT re-derived from `buyer_email`: that is
 * the weak identity `subscriptions.memberId` exists to replace.
 *
 * `member_id IS NULL` makes it fill-only, like every other attribution write
 * here: attribution grants, it never revokes.
 */
async function attachClaimedSubscriptions(memberId: string): Promise<void> {
  const owned = db
    .select({ purchaseId: orders.ds24PurchaseId })
    .from(orders)
    .where(
      and(eq(orders.memberId, memberId), isNotNull(orders.ds24PurchaseId)),
    );

  await db
    .update(subscriptions)
    .set({ memberId, updatedAt: new Date() })
    .where(
      and(
        isNull(subscriptions.memberId),
        inArray(subscriptions.ds24PurchaseId, owned),
      ),
    );
}
