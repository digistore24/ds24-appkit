// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

import { type KeysCardInput, keysCardMode } from "./visibility";

/** Everything permitted. Each test below withdraws exactly one permission. */
const OPEN: KeysCardInput = {
  apiOff: null,
  selfService: true,
  entitled: true,
  keyCount: 0,
};

const mode = (over: Partial<KeysCardInput>) => keysCardMode({ ...OPEN, ...over });

describe("keysCardMode — the card is only fully open when all three agree", () => {
  it("manages when the API is live, self-service is on and the member is entitled", () => {
    expect(mode({})).toEqual({ mode: "manage", reason: null });
    expect(mode({ keyCount: 4 })).toEqual({ mode: "manage", reason: null });
  });

  // The table in docs/api.md, one row at a time. Each pair is the SAME refusal
  // seen by a member with no keys and by one who holds some — the second half is
  // the one that regressed once, so it is asserted every time rather than once.
  const REFUSALS: Array<[string, Partial<KeysCardInput>, string]> = [
    ["the API is switched off", { apiOff: "disabledInConfig" }, "disabledInConfig"],
    ["the API's config is broken", { apiOff: "brokenConfig" }, "brokenConfig"],
    ["self-service is off", { selfService: false }, "selfServiceOff"],
    ["the member lacks the required plan", { entitled: false }, "planRequired"],
  ];

  for (const [what, over, reason] of REFUSALS) {
    it(`hides the card when ${what} and the member holds none`, () => {
      expect(mode({ ...over, keyCount: 0 })).toEqual({ mode: "hidden", reason });
    });

    it(`keeps it READ-ONLY when ${what} and the member holds keys`, () => {
      expect(mode({ ...over, keyCount: 1 })).toEqual({ mode: "readOnly", reason });
    });
  }
});

describe("keysCardMode — which reason a member is told", () => {
  it("names the API being off ahead of anything about them", () => {
    expect(
      mode({ apiOff: "disabledInConfig", selfService: false, entitled: false, keyCount: 1 }),
    ).toEqual({ mode: "readOnly", reason: "disabledInConfig" });
  });

  it("names self-service ahead of a plan — buying one would still get no card", () => {
    expect(mode({ selfService: false, entitled: false, keyCount: 1 })).toEqual({
      mode: "readOnly",
      reason: "selfServiceOff",
    });
  });

  it("names the plan only when that is the single thing missing", () => {
    expect(mode({ entitled: false, keyCount: 1 })).toEqual({
      mode: "readOnly",
      reason: "planRequired",
    });
  });

  it("never hands back a null reason with anything but manage", () => {
    for (const over of [
      { apiOff: "disabledInConfig" as const },
      { selfService: false },
      { entitled: false },
    ]) {
      for (const keyCount of [0, 3]) {
        expect(mode({ ...over, keyCount }).reason).not.toBeNull();
      }
    }
  });
});
