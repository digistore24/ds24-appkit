// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The grace, as a rule — the floor under a room that costs nothing to enter.
//
// This file drives the PURE half: given how old an account is, whether it has
// paid and what the operator configured, what still binds it. No database, no
// clock — `memberHours` is handed in, exactly as `memberDays` is to
// `reporterWeight()` one function up, and for the reason written there: a
// second function reading a second clock is a second place for a window to be
// counted wrongly.
//
// 🚨 **The shell half is `grace-guard.test.ts`, and the split is where the
// needles live.** A defect in the hours arithmetic cannot be seen from here at
// all — this file never computes them — so a test that only exercised the rule
// would be green while every new account in a real app was treated as 60 days
// old. That is measured over there.
import { describe, expect, it } from "vitest";

import {
  countLinks,
  graceLimitsFor,
  graceProblem,
  type NewMemberLimits,
} from "./rules";
import { DEFAULT_COMMUNITY_CONFIG } from "./config";

/** The shipped block. Read, never typed out — see the last test in this file. */
const SHIPPED: NewMemberLimits = DEFAULT_COMMUNITY_CONFIG.newMember;

/** An ordinary new member: two hours old, has paid nothing, plain role. */
function newcomer(over: Partial<Parameters<typeof graceLimitsFor>[0]> = {}) {
  return graceLimitsFor({
    memberHours: 2,
    paidGrants: 0,
    role: "member",
    config: SHIPPED,
    ...over,
  });
}

describe("who is inside the grace", () => {
  it("binds an account that is new, unpaid and ordinary", () => {
    const grace = newcomer();
    expect(grace).not.toBeNull();
    expect(grace?.maxPostsPerDay).toBe(SHIPPED.maxPostsPerDay);
    expect(grace?.maxLinksPerPost).toBe(SHIPPED.maxLinksPerPost);
    expect(grace?.maxDmsPer10Min).toBe(SHIPPED.maxDmsPer10Min);
  });

  it("lets a BUYER through in their very first second", () => {
    // 🚨 The sentence the decision to ship this switched ON rests on: in an app
    // that sells access to its community, nobody ever meets the grace. Checked
    // before the clock, so a buyer is exempt at hour 0 rather than at hour 48.
    expect(newcomer({ memberHours: 0, paidGrants: 1 })).toBeNull();
  });

  it("lets the operator and the moderators through", () => {
    // Same exemption as `sendBlockState()` and `postHideState()`: a community
    // whose own moderation is throttled on its first day has handed itself to
    // whoever organises fastest.
    expect(newcomer({ role: "owner" })).toBeNull();
    expect(newcomer({ role: "moderator" })).toBeNull();
  });

  it("lets a protected member through — the human override", () => {
    // The row that already overrides the automatic block. It is what makes this
    // an automated restriction a person can lift, which docs/data-protection.md
    // §14g leans on.
    expect(newcomer({ protected: true })).toBeNull();
  });

  it("lets everybody through when the operator switched it off", () => {
    expect(newcomer({ config: { ...SHIPPED, enabled: false } })).toBeNull();
  });

  it("ends exactly at graceHours, not an hour either side", () => {
    const config = { ...SHIPPED, graceHours: 48 };
    expect(newcomer({ memberHours: 47, config })).not.toBeNull();
    expect(newcomer({ memberHours: 48, config })).toBeNull();
    expect(newcomer({ memberHours: 49, config })).toBeNull();
  });

  it("counts the hours left UP, so it never claims to be over early", () => {
    // Somebody with fifty minutes left must not read "0 hours". A grace that
    // says it is finished and is not is worse than one that overstates itself.
    expect(newcomer({ memberHours: 47, config: { ...SHIPPED, graceHours: 48 } })?.hoursLeft).toBe(1);
    expect(newcomer({ memberHours: 0, config: { ...SHIPPED, graceHours: 48 } })?.hoursLeft).toBe(48);
  });

  it("is negative-safe about the hours", () => {
    // A clock that went backwards (an account row written a second in the
    // future, a host with a skewed time) must not produce a negative countdown.
    expect(newcomer({ memberHours: -5 })?.hoursLeft).toBeGreaterThan(0);
  });
});

describe("what the grace refuses", () => {
  const grace = newcomer();

  it("refuses nothing at all when there is no grace", () => {
    expect(graceProblem(null, { kind: "postCount", postsInLast24h: 9999 })).toBeNull();
    expect(graceProblem(null, { kind: "links", links: 50 })).toBeNull();
  });

  it("refuses the post AT the daily count, not one past it", () => {
    const max = SHIPPED.maxPostsPerDay;
    expect(graceProblem(grace, { kind: "postCount", postsInLast24h: max - 1 })).toBeNull();
    expect(graceProblem(grace, { kind: "postCount", postsInLast24h: max })).toBe(
      "communityNewMemberPostLimit",
    );
  });

  it("refuses a link while the shipped ceiling is zero, and says so in its own code", () => {
    expect(graceProblem(grace, { kind: "links", links: 0 })).toBeNull();
    expect(graceProblem(grace, { kind: "links", links: 1 })).toBe(
      "communityNewMemberNoLinks",
    );
  });

  it("obeys an operator who allows a couple of links", () => {
    const relaxed = newcomer({ config: { ...SHIPPED, maxLinksPerPost: 2 } });
    expect(graceProblem(relaxed, { kind: "links", links: 2 })).toBeNull();
    expect(graceProblem(relaxed, { kind: "links", links: 3 })).toBe(
      "communityNewMemberNoLinks",
    );
  });
});

describe("counting links the way the renderer draws them", () => {
  // 🚨 These are the cases a hand-rolled counter gets wrong, and the reason
  // `countLinks()` is built on `postSegments()` rather than on a regex beside
  // it. A second definition would refuse posts whose "links" never render as
  // links, and pass ones that do.

  it("counts a plain address once", () => {
    expect(countLinks("look at https://example.com please")).toBe(1);
  });

  it("counts an address ending in a bracket ONCE, not twice and not zero", () => {
    // `trimTrailing()`/`keepsBracket()`: the URL opened that bracket itself, so
    // it keeps it. A `split("http")` counter gets this right by luck and the
    // next one wrong.
    expect(
      countLinks("https://en.wikipedia.org/wiki/Ruby_(programming_language)"),
    ).toBe(1);
  });

  it("does not count a scheme the renderer refuses to link", () => {
    // `LINKABLE` is a whitelist, and its own comment says adding a scheme to it
    // is a security decision. A counter that saw this as a link would be that
    // decision taken a second time, unnoticed.
    expect(countLinks("javascript:alert(1)")).toBe(0);
  });

  it("does not count the word http in prose", () => {
    expect(countLinks("we should talk about http headers")).toBe(0);
  });

  it("counts two addresses as two", () => {
    expect(countLinks("https://a.example and https://b.example")).toBe(2);
  });

  it("counts nothing in an empty post", () => {
    expect(countLinks("")).toBe(0);
  });
});

describe("what ships", () => {
  it("ships the grace switched ON — the one block in that file that does", () => {
    // 🚨 Not a restatement of the config: it is the assertion that the decision
    // survives. A switch that ships off measures nothing and is never found,
    // and this one can afford to be on because a buyer never meets it.
    expect(SHIPPED.enabled).toBe(true);
  });

  it("ships a grace that is tighter than the ordinary brakes, not looser", () => {
    // The pair rule `communityConfigProblems()` enforces, asserted here against
    // the shipped numbers so the shipped file cannot drift into the state the
    // rule would switch the whole community off for.
    expect(SHIPPED.maxPostsPerDay).toBeLessThanOrEqual(
      DEFAULT_COMMUNITY_CONFIG.posting.maxPer10Min,
    );
    expect(SHIPPED.maxDmsPer10Min).toBeLessThanOrEqual(
      DEFAULT_COMMUNITY_CONFIG.messaging.maxPer10Min,
    );
  });
});
