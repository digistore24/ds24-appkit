// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What the operator's user screen is looking at — as pure values.
//
// ── Why the list stopped being "all of them" ───────────────────────────────
// `listUsers()` selected every row and the page rendered every row. That is
// right for the app the template ships — two seeded accounts — and wrong for
// the app it becomes: a customer list is the one table in this product that
// grows with sales, so the page that works on day one is the page that stops
// working exactly when the business does. The comment on the page has named
// "search" as the missing half since it was written.
//
// The shape is the purchases screen's, deliberately: same URL-carried filter,
// same GET form, same paging links, same "page 1 has no page parameter". An
// operator who has learned one of the two lists has learned both, and the
// second one needed no new idea.
//
// Nothing in here touches the database or React — it is called from the page
// (parsing the URL), from the table (building paging links) and from the tests.
import { ROLES, type Role } from "@/lib/roles";

/** The screen these filters belong to — one place, used for every link. */
export const USERS_PATH = "/dashboard/admin/users";

/**
 * Rows per page. The list is paged, not truncated.
 *
 * 50, as the purchases list: a page an operator scrolls once, and a `limit`
 * small enough that the query stays cheap on a table nobody has indexed for
 * this beyond its primary key and the address's unique index.
 */
export const USERS_PAGE_SIZE = 50;

/**
 * The role Select's "any role" entry.
 *
 * Radix refuses an empty item value, so "no role filter" needs a value of its
 * own. `*` cannot collide with a role — `lib/roles.ts` is a closed list of
 * three words — and it never appears in the URL as long as JavaScript is on.
 */
export const ANY_ROLE = "*";

/** Whether an account can still sign in. `blockedAt` is the column behind it. */
export type BlockedFilter = "all" | "blocked" | "active";

export interface UserFilter {
  /** Fragment of the address or the name, case-insensitive. `null` = no filter. */
  query: string | null;
  /** Exact role from `lib/roles.ts`. */
  role: Role | null;
  blocked: BlockedFilter;
  /** 1-based. */
  page: number;
}

/** Next.js hands `searchParams` over in this shape. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/** A repeated key (`?q=a&q=b`) is the first one — not an array. */
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
 * ⚠️ **An unknown role is dropped, where an unknown product key is kept.** The
 * two look like the same decision and are not: a product key is data — a plan
 * that was renamed still names rows in `orders`, so keeping it shows an
 * honestly empty list — while `role` is a closed vocabulary of three words that
 * no row can hold anything else of. A `?role=wizard` that survived would filter
 * every user away and read as "this app has no users", which is a lie about the
 * table rather than an empty answer about a plan.
 */
export function parseUserFilter(params: RawSearchParams): UserFilter {
  const role = first(params.role);
  const blocked = first(params.blocked);
  const page = Number.parseInt(first(params.page) ?? "", 10);

  return {
    query: fragment(params.q),
    role: (ROLES as readonly string[]).includes(role ?? "") ? (role as Role) : null,
    blocked: blocked === "blocked" || blocked === "active" ? blocked : "all",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** Is anything narrowed? Paging is not a filter — it does not count here. */
export function isFiltered(filter: UserFilter): boolean {
  return filter.query !== null || filter.role !== null || filter.blocked !== "all";
}

/**
 * The same filter, pointed at another page.
 *
 * Built from the parsed filter rather than from the current location, so it
 * works in a server render. Page 1 carries no `page` parameter — the first page
 * is the bare URL.
 */
export function userFilterHref(filter: UserFilter, page: number): string {
  const params = new URLSearchParams();
  if (filter.query) params.set("q", filter.query);
  if (filter.role) params.set("role", filter.role);
  if (filter.blocked !== "all") params.set("blocked", filter.blocked);
  if (page > 1) params.set("page", String(page));

  const query = params.toString();
  return query ? `${USERS_PATH}?${query}` : USERS_PATH;
}
