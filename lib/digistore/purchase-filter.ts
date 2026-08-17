// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What the Operator's purchases screen is looking at — as pure values.
//
// Story 3.7. The page lists EVERY purchase (paid, refunded, charged back,
// paused, cancelled) and narrows it by buyer address, product, order id and
// whether an account is attached. All of that is decided here rather than
// inside the SQL `where` clause, for the reason claimable.ts:1-9 already gives:
// nothing asserts a `where`. A filter that quietly matches too much is how an
// Operator ends up acting on the wrong purchase.
//
// Nothing in here touches the database or React — it is called from the page
// (parsing the URL), from the table (building paging links) and from the tests.
import { isClaimable, type OrderStatus } from "./claimable";

/** The screen these filters belong to — one place, used for every link. */
export const PURCHASES_PATH = "/dashboard/admin/purchases";

/** Rows per page. The list is paged, not truncated. */
export const PURCHASES_PAGE_SIZE = 50;

/**
 * The product Select's "any product" entry.
 *
 * Radix refuses an empty item value, so the "no product filter" choice needs a
 * value of its own. `*` cannot collide with a product key that the plans page
 * would render or that `ds24-sync` would create, and it never appears in the
 * URL as long as JavaScript is on — the form builds a clean address. Without
 * JavaScript the plain GET form submits it, and `parsePurchaseFilter` reads it
 * back as "no filter".
 */
export const ANY_PRODUCT = "*";

/** Whether a purchase has an account attached — the old page was `unassigned`. */
export type AssignmentFilter = "all" | "unassigned" | "assigned";

export interface PurchaseFilter {
  /** Fragment of the buyer address, case-insensitive. `null` = no filter. */
  email: string | null;
  /** Exact product key from config/digistore-products.json. */
  productKey: string | null;
  /** Fragment of the Digistore24 order id, case-insensitive. */
  orderId: string | null;
  assignment: AssignmentFilter;
  /** 1-based. */
  page: number;
}

/** Next.js hands `searchParams` over in this shape. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/** A repeated key (`?email=a&email=b`) is the first one — not an array. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Trimmed, or `null` when the field was empty or only whitespace. */
function fragment(value: string | string[] | undefined): string | null {
  const raw = first(value)?.trim();
  return raw ? raw : null;
}

/**
 * The URL, read as a filter.
 *
 * An unknown product key is deliberately KEPT (§D2): dropping it would show
 * more rows than the URL asked for. It stays in the query, matches nothing, and
 * the list is honestly empty. There is no injection risk — drizzle
 * parameterises the value.
 */
export function parsePurchaseFilter(params: RawSearchParams): PurchaseFilter {
  const assignment = first(params.assignment);
  const page = Number.parseInt(first(params.page) ?? "", 10);
  const product = fragment(params.product);

  return {
    email: fragment(params.email),
    productKey: product === ANY_PRODUCT ? null : product,
    orderId: fragment(params.order),
    assignment:
      assignment === "unassigned" || assignment === "assigned"
        ? assignment
        : "all",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** Is anything narrowed? Paging is not a filter — it does not count here. */
export function isFiltered(filter: PurchaseFilter): boolean {
  return (
    filter.email !== null ||
    filter.productKey !== null ||
    filter.orderId !== null ||
    filter.assignment !== "all"
  );
}

/**
 * May this purchase be attached to an account by hand?
 *
 * Both conditions the attach actually enforces, in one place, so the button and
 * the server action cannot drift: no account yet, and a status the claim path
 * accepts. `isClaimable` is imported, never re-listed — refunded and charged
 * back purchases must stay unattachable (claimable.ts:23-28).
 */
export function canAttachOrder(order: {
  memberId: string | null;
  status: OrderStatus;
}): boolean {
  return order.memberId === null && isClaimable(order.status);
}

/**
 * The same filter, pointed at another page.
 *
 * Built from the parsed filter rather than from the current location, so it
 * works in a server render. Page 1 carries no `page` parameter — the first page
 * is the bare URL.
 */
export function purchaseFilterHref(
  filter: PurchaseFilter,
  page: number,
): string {
  const params = new URLSearchParams();
  if (filter.email) params.set("email", filter.email);
  if (filter.productKey) params.set("product", filter.productKey);
  if (filter.orderId) params.set("order", filter.orderId);
  if (filter.assignment !== "all") params.set("assignment", filter.assignment);
  if (page > 1) params.set("page", String(page));

  const query = params.toString();
  return query ? `${PURCHASES_PATH}?${query}` : PURCHASES_PATH;
}
