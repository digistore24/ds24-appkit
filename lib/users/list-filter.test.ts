// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The user list's filter, as values. Same subject as
// `lib/digistore/purchase-filter.test.ts` one screen over, and the same reason
// for testing it here rather than through the page: nothing asserts a `where`
// clause, and a filter that quietly matches too much is how an operator ends
// up acting on the wrong account.
import { describe, it, expect } from "vitest";

import {
  ANY_ROLE,
  USERS_PATH,
  isFiltered,
  parseUserFilter,
  userFilterHref,
} from "./list-filter";

describe("parseUserFilter", () => {
  it("reads an empty URL as no filter, page one", () => {
    expect(parseUserFilter({})).toEqual({
      query: null,
      role: null,
      blocked: "all",
      page: 1,
    });
  });

  it("trims the search and treats whitespace as nothing", () => {
    expect(parseUserFilter({ q: "  anna  " }).query).toBe("anna");
    expect(parseUserFilter({ q: "   " }).query).toBeNull();
  });

  it("takes the first value of a repeated parameter", () => {
    expect(parseUserFilter({ q: ["anna", "bernd"] }).query).toBe("anna");
  });

  it("takes a role from lib/roles and nothing else", () => {
    expect(parseUserFilter({ role: "owner" }).role).toBe("owner");
    expect(parseUserFilter({ role: "moderator" }).role).toBe("moderator");
    expect(parseUserFilter({ role: "member" }).role).toBe("member");
  });

  it("🚨 drops a role no account can hold", () => {
    // Unlike an unknown PRODUCT key, which is kept: a product that was renamed
    // still names rows in `orders`, so keeping it shows an honestly empty list.
    // `role` is a closed vocabulary — a `?role=wizard` that survived would
    // filter every user away and read as "this app has no users", which is a
    // lie about the table rather than an empty answer about a plan.
    expect(parseUserFilter({ role: "wizard" }).role).toBeNull();
    expect(parseUserFilter({ role: "" }).role).toBeNull();
    expect(parseUserFilter({ role: ANY_ROLE }).role).toBeNull();
  });

  it("reads the blocked filter, and anything else as all", () => {
    expect(parseUserFilter({ blocked: "blocked" }).blocked).toBe("blocked");
    expect(parseUserFilter({ blocked: "active" }).blocked).toBe("active");
    expect(parseUserFilter({ blocked: "nonsense" }).blocked).toBe("all");
  });

  it("refuses a page below one, and anything that is not a number", () => {
    expect(parseUserFilter({ page: "3" }).page).toBe(3);
    expect(parseUserFilter({ page: "0" }).page).toBe(1);
    expect(parseUserFilter({ page: "-2" }).page).toBe(1);
    expect(parseUserFilter({ page: "abc" }).page).toBe(1);
    // `parseInt` stops at the dot, so `2.5` is page 2 rather than a refusal —
    // the same reading the purchases screen has always had, and the reason
    // this filter parses the page exactly as that one does rather than
    // inventing a stricter rule for one of the two lists.
    expect(parseUserFilter({ page: "2.5" }).page).toBe(2);
  });
});

describe("isFiltered", () => {
  it("is false for the bare page", () => {
    expect(isFiltered(parseUserFilter({}))).toBe(false);
  });

  it("🚨 paging alone is not a filter", () => {
    // The empty state depends on it: "page 4 of an unfiltered list" must not
    // offer "reset your search", and a heading must not claim a search nobody
    // made.
    expect(isFiltered(parseUserFilter({ page: "4" }))).toBe(false);
  });

  it("is true for each of the three", () => {
    expect(isFiltered(parseUserFilter({ q: "anna" }))).toBe(true);
    expect(isFiltered(parseUserFilter({ role: "owner" }))).toBe(true);
    expect(isFiltered(parseUserFilter({ blocked: "blocked" }))).toBe(true);
  });
});

describe("userFilterHref", () => {
  it("page one is the bare path", () => {
    expect(userFilterHref(parseUserFilter({}), 1)).toBe(USERS_PATH);
  });

  it("carries the filter and the page", () => {
    const filter = parseUserFilter({ q: "anna", role: "owner", blocked: "active" });
    expect(userFilterHref(filter, 3)).toBe(
      `${USERS_PATH}?q=anna&role=owner&blocked=active&page=3`,
    );
  });

  it("leaves the page parameter off the first page", () => {
    expect(userFilterHref(parseUserFilter({ q: "anna" }), 1)).toBe(`${USERS_PATH}?q=anna`);
  });

  it("escapes what it puts in the query", () => {
    // A search for an address is the common case, and `@` and `+` both have a
    // meaning in a query string.
    expect(userFilterHref(parseUserFilter({ q: "a+b@example.com" }), 1)).toBe(
      `${USERS_PATH}?q=a%2Bb%40example.com`,
    );
  });

  it("round-trips through the parser", () => {
    // The property that matters for paging: following a link must not change
    // what is being filtered.
    const filter = parseUserFilter({ q: "anna", role: "member", blocked: "blocked" });
    const href = userFilterHref(filter, 2);
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(parseUserFilter(params)).toEqual({ ...filter, page: 2 });
  });
});
