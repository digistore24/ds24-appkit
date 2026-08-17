// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Every purchase, and the Operator's hand-attach — the data behind the
// purchases screen.
//
// Story 3.7 turned this from "the purchases that reached nobody" into the whole
// record: the page lists orders of EVERY status and narrows them with the
// filters parsed in ./purchase-filter.ts. The old work queue is still one click
// away — it is the `unassigned` assignment filter.
//
// A purchase with no member_id is one whose buyer paid under an address the app
// has never seen, or whose identity did not resolve. The Operator attaches it to
// the right Member by hand; the attach shares the same claim path as an
// automatic sign-in claim (lib/digistore/claim.ts), so the two cannot drift.
import { db } from "@/db";
import { escapeLikeFragment } from "@/lib/sql-like";
import { orders, users } from "@/db/schema";
import {
  and,
  count,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  type SQL,
} from "drizzle-orm";
import { claimOneOrder } from "./claim";
import { isClaimable, type OrderStatus } from "./claimable";
import {
  PURCHASES_PAGE_SIZE,
  type PurchaseFilter,
} from "./purchase-filter";

/** One row of the purchases table. */
export interface PurchaseRow {
  ds24OrderId: string;
  buyerEmail: string | null;
  productKey: string | null;
  amount: string | null;
  currency: string | null;
  status: OrderStatus;
  /** The account this purchase belongs to — null while unattributed. */
  memberId: string | null;
  /** That account's address, for the column. Null id or null email both show as none. */
  memberEmail: string | null;
  createdAt: Date;
}

/** One page of the list, plus what the header and the paging controls need. */
export interface PurchasePage {
  rows: PurchaseRow[];
  /** Purchases matching the filter — ALL of them, not just this page. */
  total: number;
  page: number;
  hasMore: boolean;
}

/**
 * The filter as SQL. `undefined` when nothing is set — an unfiltered list.
 *
 * The two fragment filters are `ILIKE '%…%'` over an escaped fragment
 * (`escapeLikeFragment`, §D3): without that escaping a pasted `%` or `_` would
 * match rows the Operator never asked for. Product is an equality — an unknown
 * key matches nothing, deliberately (§D2).
 */
function purchaseWhere(filter: PurchaseFilter): SQL | undefined {
  const conditions: SQL[] = [];

  if (filter.email) {
    conditions.push(
      ilike(orders.buyerEmail, `%${escapeLikeFragment(filter.email)}%`),
    );
  }
  if (filter.orderId) {
    conditions.push(
      ilike(orders.ds24OrderId, `%${escapeLikeFragment(filter.orderId)}%`),
    );
  }
  if (filter.productKey) {
    conditions.push(eq(orders.productKey, filter.productKey));
  }
  if (filter.assignment === "unassigned") {
    conditions.push(isNull(orders.memberId));
  }
  if (filter.assignment === "assigned") {
    conditions.push(isNotNull(orders.memberId));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * One page of purchases, newest first, plus the total behind it.
 *
 * No status filter of any kind: a refund is part of the record the Operator is
 * asked about. What a refunded row must NOT get is an attach button — that
 * narrowing lives in `canAttachOrder` and in `attachOrder` below, not here.
 *
 * `limit(PAGE_SIZE + 1)` answers "is there another page" without a second
 * query; the count is its own, because the header states how many purchases
 * match, not how many are on screen.
 *
 * The sort carries `ds24OrderId` as a tiebreaker on purpose: `createdAt` alone
 * is not unique — an IPN burst writes several rows in the same millisecond —
 * and an unstable sort under OFFSET shows one purchase on two pages while
 * hiding another entirely.
 */
export async function listOrders(
  filter: PurchaseFilter,
): Promise<PurchasePage> {
  const where = purchaseWhere(filter);
  const offset = (filter.page - 1) * PURCHASES_PAGE_SIZE;

  const [rows, totals] = await Promise.all([
    db
      .select({
        ds24OrderId: orders.ds24OrderId,
        buyerEmail: orders.buyerEmail,
        productKey: orders.productKey,
        amount: orders.amount,
        currency: orders.currency,
        status: orders.status,
        memberId: orders.memberId,
        memberEmail: users.email,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .leftJoin(users, eq(orders.memberId, users.id))
      .where(where)
      .orderBy(desc(orders.createdAt), desc(orders.ds24OrderId))
      .limit(PURCHASES_PAGE_SIZE + 1)
      .offset(offset),
    db.select({ value: count() }).from(orders).where(where),
  ]);

  return {
    rows: rows.slice(0, PURCHASES_PAGE_SIZE),
    total: totals[0]?.value ?? 0,
    page: filter.page,
    hasMore: rows.length > PURCHASES_PAGE_SIZE,
  };
}

/** Result of an attach attempt — a code the action translates. */
export type AttachResult =
  | { ok: true; credited: number }
  | {
      ok: false;
      reason:
        | "orderNotFound"
        | "memberNotFound"
        | "alreadyAttributed"
        | "notClaimable";
    };

/**
 * Attaches one purchase to a Member, by their id.
 *
 * The heavy lifting — the conditional, fill-only update and the idempotent
 * credit — is `claimOneOrder`. This wrapper only turns the outcomes into codes
 * the UI can translate, and refuses when the order has been attributed since
 * the Operator opened the list (an IPN redelivery, or another Operator).
 *
 * `isClaimable` is asked BEFORE `claimOneOrder` (story 3.7 §D6). Its conditional
 * UPDATE already carries the same status set, so a refunded purchase was
 * refused before this check existed — but as `attached: false`, which reads back
 * as "already attached" and told the Operator something untrue about a purchase
 * that is not attached at all. Invisible while the list could not show a
 * refunded row; reachable the moment it can.
 */
export async function attachOrder(
  ds24OrderId: string,
  memberId: string,
): Promise<AttachResult> {
  const [member] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, memberId))
    .limit(1);
  if (!member) return { ok: false, reason: "memberNotFound" };

  const [order] = await db
    .select({ memberId: orders.memberId, status: orders.status })
    .from(orders)
    .where(eq(orders.ds24OrderId, ds24OrderId))
    .limit(1);
  if (!order) return { ok: false, reason: "orderNotFound" };
  if (order.memberId) return { ok: false, reason: "alreadyAttributed" };
  if (!isClaimable(order.status)) return { ok: false, reason: "notClaimable" };

  const { attached, credited } = await claimOneOrder(memberId, ds24OrderId);
  // attached=false means the row was taken between the checks above and the
  // conditional update — the same "already attributed" outcome, race-safe.
  if (!attached) return { ok: false, reason: "alreadyAttributed" };
  return { ok: true, credited };
}
