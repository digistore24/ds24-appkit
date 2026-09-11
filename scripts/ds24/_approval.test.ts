// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The approval line is read by everybody who opens a project with synced
// products, and its data comes from an UNDOCUMENTED response shape (see
// _approval.mjs). So the things worth pinning down are: the normalizer against
// the probed shape and every way it can degrade, the aggregation rule that
// decides what "the" status of a product is, the line itself (which state wins,
// and when it stays silent), and the three preconditions that decide whether
// the check asks the API at all — the last of these shipped broken once
// because it had no seam to test.
import { afterAll, beforeAll, describe as suite, expect, it } from "vitest";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  CACHE_PATH,
  MAX_CACHE_AGE,
  aggregateApprovalStatus,
  allApproved,
  approvalApplies,
  approvalStatusOf,
  isDue,
  classifyStatuses,
  describeApproval,
  dropApprovalCache,
  readApprovalCache,
  rejectedSomewhere,
  shouldCheck,
  statusesFrom,
  ttlFor,
  writeApprovalCache,
} from "./_approval.mjs";
import { isKnownLanguage, isReseller, resellerForLang } from "./_resellers.mjs";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * One item as the probe recorded it (2026-07-28, product 715507). `active`
 * mirrors `is_siteowner_active`, which the probe found "N" for GB and IE.
 */
const product = (
  statusByReseller: Record<string, string>,
  inactive: string[] = [],
) => ({
  id: "715507",
  name_intern: "fokus_sprint_7",
  approval_status: "", // the top-level field is empty on the live API — legacy
  approval_status_list: Object.entries(statusByReseller).map(([id, status]) => ({
    reseller_id: id,
    reseller_name: `DS-${id}`,
    approval_status: status,
    approval_status_msg: status,
    is_siteowner_active: inactive.includes(id) ? "N" : "Y",
    modified_at: null,
    approval_reject_reason: [],
    approval_reject_reason_msg: "",
    approval_reject_reason_description: "",
  })),
});

suite("approvalStatusOf — the per-marketplace view the write side needs", () => {
  it("reads the entry for the asked siteowner, not the first one", () => {
    const p = product({ "1": "approved", "2": "new" });
    expect(approvalStatusOf(p, "1")).toBe("approved");
    expect(approvalStatusOf(p, "2")).toBe("new");
  });

  it("takes a numeric siteowner id — the resellers file hands out strings, callers may not", () => {
    expect(approvalStatusOf(product({ "1": "pending" }), 1)).toBe("pending");
  });

  it("answers null for a siteowner the list does not carry (a private marketplace)", () => {
    expect(approvalStatusOf(product({ "1": "new" }), "9999")).toBeNull();
  });

  it("answers null when the list is missing — the shape is undocumented and may change", () => {
    expect(approvalStatusOf({ id: "1", approval_status: "approved" }, "1")).toBeNull();
    expect(approvalStatusOf(null, "1")).toBeNull();
  });

  it("answers null for a value it does not know, instead of guessing", () => {
    expect(approvalStatusOf(product({ "1": "in_review" }), "1")).toBeNull();
  });

  it("normalizes case and whitespace", () => {
    expect(approvalStatusOf(product({ "1": " Approved " }), "1")).toBe("approved");
  });
});

suite("aggregateApprovalStatus — can this product be sold at all?", () => {
  it("lets approved anywhere win, however the other marketplaces voted", () => {
    expect(aggregateApprovalStatus(product({ "1": "approved", "2": "rejected" }))).toBe("approved");
    expect(aggregateApprovalStatus(product({ "1": "new", "2": "approved" }))).toBe("approved");
  });

  it("prefers pending over rejected and new — somebody is already looking at it", () => {
    expect(aggregateApprovalStatus(product({ "1": "pending", "2": "rejected" }))).toBe("pending");
    expect(aggregateApprovalStatus(product({ "1": "new", "2": "pending" }))).toBe("pending");
  });

  it("reports rejected only while nothing is approved or pending anywhere", () => {
    expect(aggregateApprovalStatus(product({ "1": "rejected", "2": "new" }))).toBe("rejected");
  });

  it("falls through to new when nobody has been asked", () => {
    expect(aggregateApprovalStatus(product({ "1": "new", "2": "new" }))).toBe("new");
  });

  it("ignores a marketplace the account is not active for", () => {
    // GB is "N" on the probe account: it cannot act, so its verdict says
    // nothing about whether the product sells — otherwise a stray "rejected"
    // there would nag for ever about a marketplace nobody can use.
    expect(aggregateApprovalStatus(product({ "1": "new", "3": "rejected" }, ["3"]))).toBe("new");
    expect(aggregateApprovalStatus(product({ "1": "approved", "3": "new" }, ["3"]))).toBe("approved");
  });

  it("treats a missing is_siteowner_active as active — the field is undocumented", () => {
    const p = { approval_status_list: [{ reseller_id: "1", approval_status: "approved" }] };
    expect(aggregateApprovalStatus(p)).toBe("approved");
  });

  it("answers null when nothing readable is left", () => {
    expect(aggregateApprovalStatus(product({ "1": "in_review" }))).toBeNull();
    expect(aggregateApprovalStatus(product({ "1": "new" }, ["1"]))).toBeNull();
    expect(aggregateApprovalStatus({ id: "1" })).toBeNull();
    expect(aggregateApprovalStatus(null)).toBeNull();
  });
});

suite("classifyStatuses", () => {
  it("groups by state, and unreadable is its own bucket rather than silence", () => {
    const grouped = classifyStatuses({
      a: { productId: "1", status: "approved" },
      b: { productId: "2", status: "pending" },
      c: { productId: "3", status: "rejected" },
      d: { productId: "4", status: "new" },
      e: { productId: "5", status: null },
    });
    expect(grouped).toEqual({
      approved: ["a"],
      pending: ["b"],
      rejected: ["c"],
      unrequested: ["d"],
      unknown: ["e"],
      notApplicable: [],
    });
  });

  it("takes anything a hand-edited or foreign cache can hold", () => {
    const empty = {
      approved: [],
      pending: [],
      rejected: [],
      unrequested: [],
      unknown: [],
      notApplicable: [],
    };
    expect(classifyStatuses(null)).toEqual(empty);
    // A truthy non-object used to slip through and be reported as a clean pass.
    expect(classifyStatuses("broken")).toEqual(empty);
    expect(classifyStatuses([1, 2, 3])).toEqual(empty);
  });
});

suite("describeApproval", () => {
  const result = (statuses: Record<string, string | null>) => ({
    checkedAt: 0,
    statuses: Object.fromEntries(
      Object.entries(statuses).map(([key, status], i) => [key, { productId: String(i), status }]),
    ),
  });

  it("says nothing when everything is approved", () => {
    expect(describeApproval(result({ a: "approved", b: "approved" }))).toBeNull();
  });

  it("says nothing when there is no answer at all", () => {
    expect(describeApproval(null)).toBeNull();
    expect(describeApproval({ checkedAt: 0, statuses: null })).toBeNull();
  });

  it("speaks up when a status could not be read — doctor reports that state too", () => {
    // Staying silent here while doctor showed a failed check was the
    // "two surfaces disagree" bug in a new place. It also means something real:
    // a product deleted at Digistore24, or a key for another account.
    const line = describeApproval(result({ a: null, b: "approved" }));
    expect(line).toContain("unreadable for 1 product(s)");
  });

  it("names a rejection the aggregate hid behind a pending elsewhere", () => {
    const line = describeApproval({
      checkedAt: 1,
      statuses: { a: { productId: "1", status: "pending", rejected: true } },
    });
    expect(line).toContain('REJECTED for "a"');
  });

  it("stays silent about a rejection on a product that sells anyway", () => {
    // Approved somewhere means sellable — the vendor's own rule, and nothing
    // to nag about.
    expect(
      describeApproval({
        checkedAt: 1,
        statuses: { a: { productId: "1", status: "approved", rejected: true } },
      }),
    ).toBeNull();
  });

  it("points at the go-live step while nothing was requested", () => {
    const line = describeApproval(result({ a: "new", b: "new", c: "approved" }));
    expect(line).toContain("2 product(s) not submitted");
    expect(line).toContain("node run.mjs ds24-approval --apply");
    expect(line).toContain("test purchases");
  });

  it("reports pending without asking for action — the vendor already acted", () => {
    const line = describeApproval(result({ a: "pending", b: "approved" }));
    expect(line).toContain("pending for 1 product(s)");
    expect(line).not.toContain("--apply");
  });

  it("lets rejected win over everything, and names the product", () => {
    const line = describeApproval(result({ a: "rejected", b: "new", c: "pending" }));
    expect(line).toContain('REJECTED for "a"');
    expect(line).toContain("Digistore24 account");
  });

  it("caps how many rejected products it names — the line has to stay unobtrusive", () => {
    const many = Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`p${i}`, "rejected" as string | null]),
    );
    const line = describeApproval(result(many))!;
    expect(line).toContain("+6 more");
    expect(line.length).toBeLessThan(220);
  });

  it("is one line, never one per product", () => {
    const line = describeApproval(result({ a: "new", b: "pending", c: "rejected" }));
    expect(line).not.toContain("\n");
  });
});

suite("ttlFor", () => {
  // A real timestamp: a cache with no usable `checkedAt` is always due now,
  // and every fixture here is about the product/approval comparison instead.
  const cache = (statuses: Record<string, [string, string | null]>) => ({
    checkedAt: 1_700_000_000_000,
    statuses: Object.fromEntries(
      Object.entries(statuses).map(([k, [productId, status]]) => [k, { productId, status }]),
    ),
  });

  const approvedCache = cache({ a: ["10", "approved"], b: ["11", "approved"] });

  it("holds a day while anything is not approved", () => {
    expect(ttlFor(cache({ a: ["10", "pending"] }), ["10"])).toBe(DAY);
    expect(ttlFor(cache({ a: ["10", "new"] }), ["10"])).toBe(DAY);
  });

  it("stretches to a week once everything is approved", () => {
    expect(ttlFor(approvedCache, ["10", "11"])).toBe(WEEK);
    // Order of the ids must not matter — the registry is an object.
    expect(ttlFor(approvedCache, ["11", "10"])).toBe(WEEK);
  });

  it("forces a refetch when the product set changed — even mid-build, when nothing is approved yet", () => {
    // The regression this test exists for: the product comparison used to sit
    // BEHIND the all-approved shortcut, so during the normal not-yet-approved
    // state a freshly synced product went unmentioned for a whole day. The
    // old test asserted only that the number was DAY, which stayed true.
    expect(ttlFor(cache({ a: ["10", "new"] }), ["10", "12"])).toBe(0);
    expect(ttlFor(cache({ a: ["10", "pending"], b: ["11", "new"] }), ["10"])).toBe(0);
    expect(ttlFor(approvedCache, ["10", "11", "12"])).toBe(0);
    expect(ttlFor(approvedCache, ["10"])).toBe(0);
  });

  it("keeps a quiet answer for the day — this is the whole API budget", () => {
    // `{ statuses: null }` is what every failure path writes: "we asked and
    // could not find out". Treating it as unusable made `isDue` true at the
    // millisecond it was written, so an offline machine paid for a fresh
    // authenticated listProducts call at EVERY session start, for ever. The
    // regression shipped because the previous test asserted `0` for this.
    expect(ttlFor({ checkedAt: 1, statuses: null }, ["10"])).toBe(DAY);
  });

  it("treats a cache with no usable timestamp as always due", () => {
    expect(ttlFor(null, ["10"])).toBe(0);
    expect(ttlFor({ checkedAt: 0, statuses: null }, ["10"])).toBe(0);
    expect(ttlFor({ checkedAt: "yesterday", statuses: null }, ["10"])).toBe(0);
    expect(ttlFor({ checkedAt: 1, statuses: "broken" }, ["10"])).toBe(0);
  });
});

suite("allApproved", () => {
  it("needs at least one product — an empty answer is not an approval", () => {
    expect(allApproved({ statuses: {} })).toBe(false);
    expect(allApproved(null)).toBe(false);
    expect(allApproved({ statuses: "broken" })).toBe(false);
  });
});

suite("shouldCheck — the three preconditions AC 3 turns on", () => {
  const ok = { killSwitch: undefined, apiKey: "key", productIds: ["10"] };

  it("asks when there is a key, a synced product and no kill switch", () => {
    expect(shouldCheck(ok)).toBe(true);
  });

  it("obeys the kill switch, however it is written", () => {
    // The greeting honoured this from day one while doctor kept reporting from
    // a cache nobody refreshed — there was no seam to test, so nothing caught it.
    expect(shouldCheck({ ...ok, killSwitch: "off" })).toBe(false);
    expect(shouldCheck({ ...ok, killSwitch: "OFF" })).toBe(false);
    expect(shouldCheck({ ...ok, killSwitch: "on" })).toBe(true);
    expect(shouldCheck({ ...ok, killSwitch: "" })).toBe(true);
  });

  it("stays quiet without an API key — not connected is a setup state, not a finding", () => {
    expect(shouldCheck({ ...ok, apiKey: undefined })).toBe(false);
    expect(shouldCheck({ ...ok, apiKey: "" })).toBe(false);
  });

  it("stays quiet until something is synced", () => {
    expect(shouldCheck({ ...ok, productIds: [] })).toBe(false);
    expect(shouldCheck({ ...ok, productIds: undefined })).toBe(false);
  });
});

suite("rejectedSomewhere — the fact the precedence hides", () => {
  it("is true when an active marketplace rejected, even if another is pending", () => {
    // The aggregate calls this "pending" (sellability), and nothing will ever
    // move the pending entry — so without this flag the rejection the vendor
    // must act on is never mentioned again.
    expect(aggregateApprovalStatus(product({ "1": "rejected", "2": "pending" }))).toBe("pending");
    expect(rejectedSomewhere(product({ "1": "rejected", "2": "pending" }))).toBe(true);
  });

  it("ignores a rejection at a marketplace the account cannot use", () => {
    expect(rejectedSomewhere(product({ "1": "new", "3": "rejected" }, ["3"]))).toBe(false);
  });

  it("is false when nothing readable rejected", () => {
    expect(rejectedSomewhere(product({ "1": "new" }))).toBe(false);
    expect(rejectedSomewhere(null)).toBe(false);
  });
});

suite("Direct Sellers have no approval at all", () => {
  it("knows which siteowners are resellers", () => {
    expect(["1", "2", "3", "4"].every(isReseller)).toBe(true);
    expect(isReseller(1)).toBe(true);
    for (const id of ["5", "987654", "", null, undefined, "abc"]) {
      expect(isReseller(id)).toBe(false);
    }
  });

  it("does not apply when no reseller is active for the account", () => {
    // The Direct Seller shape: the four resellers are all inactive (or absent),
    // so there is nobody to submit a product to.
    expect(approvalApplies(product({ "1": "new", "2": "new" }, ["1", "2"]))).toBe(false);
    expect(approvalApplies({ approval_status_list: [] })).toBe(false);
    expect(approvalApplies(product({ "987654": "new" }))).toBe(false);
  });

  it("does apply as soon as one reseller is active", () => {
    expect(approvalApplies(product({ "1": "new", "3": "new" }, ["3"]))).toBe(true);
  });

  it("answers null when it cannot tell — that is not the same as 'does not apply'", () => {
    // Silencing an unreadable response as if the vendor sold direct would hide
    // a real problem behind a legitimate-looking quiet.
    expect(approvalApplies({ id: "1" })).toBeNull();
    expect(approvalApplies(null)).toBeNull();
  });

  it("never invents a verdict from a Direct Seller entry", () => {
    // A siteowner outside 1–4 has no approval concept, so its field means
    // nothing — counting it would report an approval nobody granted.
    expect(aggregateApprovalStatus(product({ "987654": "approved" }))).toBeNull();
    expect(rejectedSomewhere(product({ "987654": "rejected" }))).toBe(false);
  });

  it("keeps a Direct Seller out of every reported bucket", () => {
    const grouped = classifyStatuses({
      direct: { productId: "1", status: null, applies: false },
      real: { productId: "2", status: "new" },
    });
    expect(grouped.notApplicable).toEqual(["direct"]);
    expect(grouped.unknown).toEqual([]);
    expect(grouped.unrequested).toEqual(["real"]);
  });

  it("says nothing at all for a Direct Seller", () => {
    expect(
      describeApproval({
        checkedAt: 1,
        statuses: { a: { productId: "1", status: null, applies: false } },
      }),
    ).toBeNull();
  });

  it("does not even ask the API when the configured siteowner is a Direct Seller", () => {
    const base = { killSwitch: undefined, apiKey: "key", productIds: ["10"] };
    expect(shouldCheck({ ...base, siteowner: "2" })).toBe(true);
    expect(shouldCheck({ ...base, siteowner: "987654" })).toBe(false);
    // Unset says nothing either way — the response answers that case.
    expect(shouldCheck({ ...base, siteowner: undefined })).toBe(true);
    expect(shouldCheck({ ...base, siteowner: "" })).toBe(true);
  });
});

suite("isKnownLanguage — the guard on a silent, money-relevant choice", () => {
  it("accepts Digistore24's own codes, with or without a region", () => {
    for (const code of ["de", "en", "fr", "es", "nl", "it", "pt", "pl", "sl", "de-AT", "de_CH", "EN"]) {
      expect(isKnownLanguage(code)).toBe(true);
    }
  });

  it("rejects the plausible typos that route a German product to the USA", () => {
    // resellerForLang only tests startsWith("de"), so each of these silently
    // becomes "not German" — which is a different marketplace, not a cosmetic
    // difference.
    for (const code of ["german", "ger", "deutsch2", "", "xx", "1"]) {
      expect(isKnownLanguage(code)).toBe(false);
    }
    expect(resellerForLang("german").country).toBe("US");
    expect(resellerForLang("deutsch").country).toBe("DE"); // starts with "de" — fine either way
  });
});

suite("the cache on disk", () => {
  let saved: string | null = null;

  beforeAll(() => {
    saved = existsSync(CACHE_PATH) ? readFileSync(CACHE_PATH, "utf8") : null;
  });
  afterAll(() => {
    if (saved === null) rmSync(CACHE_PATH, { force: true });
    else writeFileSync(CACHE_PATH, saved);
  });

  it("writes and reads back what it was given", () => {
    const result = { checkedAt: Date.now(), statuses: { a: { productId: "1", status: "new" } } };
    writeApprovalCache(result);
    expect(readApprovalCache()).toEqual(result);
  });

  it("drops the file, and dropping a missing file is not an error", () => {
    writeApprovalCache({ checkedAt: Date.now(), statuses: null });
    dropApprovalCache();
    expect(existsSync(CACHE_PATH)).toBe(false);
    expect(() => dropApprovalCache()).not.toThrow();
    expect(readApprovalCache()).toBeNull();
  });

  it("refuses an answer nobody refreshed in a month", () => {
    // doctor reads this file with no `isDue` behind it, so a leftover would
    // otherwise be reported as today's verdict for ever.
    writeApprovalCache({ checkedAt: Date.now() - MAX_CACHE_AGE - 1000, statuses: {} });
    expect(readApprovalCache()).toBeNull();
  });

  it("refuses a cache whose timestamp cannot be trusted", () => {
    // The class of cache the age bound exists for — hand-written, or from
    // another version — is exactly the class whose `checkedAt` is unusable.
    for (const checkedAt of [0, -1, "yesterday", null, undefined]) {
      writeFileSync(CACHE_PATH, JSON.stringify({ checkedAt, statuses: {} }));
      expect(readApprovalCache()).toBeNull();
    }
  });

  it("survives a file that is not JSON at all", () => {
    writeFileSync(CACHE_PATH, "{{ not json");
    expect(readApprovalCache()).toBeNull();
  });
});

suite("statusesFrom", () => {
  type Statuses = Record<string, { productId: string; status: string | null; rejected?: boolean }>;
  const entries: [string, { productId: string }][] = [
    ["fokus", { productId: "715507" }],
    ["gone", { productId: "999999" }],
  ];

  it("aggregates per registry key and marks a product absent from the response as unknown", () => {
    // "absent" must not read as "approved" — the write side refuses to skip on
    // exactly this value, so conflating the two would re-open the fail-open.
    const statuses: Statuses = statusesFrom(entries, [
      { ...product({ "1": "approved" }), id: "715507" },
    ]);
    expect(statuses.fokus).toEqual({ productId: "715507", status: "approved", rejected: false });
    expect(statuses.gone).toEqual({ productId: "999999", status: null, rejected: false });
  });

  it("records a rejection alongside the aggregate, so the line can name it", () => {
    const statuses: Statuses = statusesFrom(entries, [
      { ...product({ "1": "rejected", "2": "pending" }), id: "715507" },
    ]);
    expect(statuses.fokus.status).toBe("pending");
    expect(statuses.fokus.rejected).toBe(true);
  });

  it("survives a response carrying junk elements", () => {
    // idOf(null) used to throw here, outside the inner guard, which turned the
    // daily budget into one authenticated call per session.
    const statuses: Statuses = statusesFrom(entries, [
      null,
      42,
      { ...product({ "1": "new" }), id: "715507" },
    ]);
    expect(statuses.fokus.status).toBe("new");
  });
});

suite("isDue", () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  it("asks on the first run", () => {
    expect(isDue(null, 1_000_000)).toBe(true);
  });

  it("asks again when a malformed cache is found", () => {
    expect(isDue({}, 1_000_000)).toBe(true);
    expect(isDue({ checkedAt: "yesterday" }, 1_000_000)).toBe(true);
  });

  it("stays quiet inside the day", () => {
    const now = 10 * DAY;
    expect(isDue({ checkedAt: now - HOUR }, now)).toBe(false);
  });

  it("asks once the day is up", () => {
    const now = 10 * DAY;
    expect(isDue({ checkedAt: now - DAY }, now)).toBe(true);
  });

  it("asks again when the stamp lies in the future", () => {
    // A restored machine or a clock correction would otherwise park the check
    // beyond any reachable date and switch it off silently.
    const now = 10 * DAY;
    expect(isDue({ checkedAt: now + 5 * DAY }, now)).toBe(true);
  });
});
