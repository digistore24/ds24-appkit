// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 **The refusal a blocked member meets must be the refusal everybody else
// meets.**
//
// FR-201: a member blocks another, and the blocked member is refused "with the
// same neutral refusal any undeliverable message gets — indistinguishable from
// other delivery refusals by comparison". That word — *by comparison* — is
// what this file measures. Two sentences that are merely similar are two
// sentences: somebody with two accounts sends a message from each and reads
// the difference.
//
// Sameness is asserted at three levels, because a leak can happen at any of
// them and only the first is obvious:
//
//   1. **The code.** All four causes resolve to `communityNotDeliverable` in the pure
//      core — writing to oneself, no such account, an account the operator
//      blocked, and a standing member block.
//   2. **The sentence.** `communityNotDeliverable` is ONE key in both language files.
//      A second key for the block would be the leak arriving as helpfulness.
//   3. **The shape.** The refusal carries no detail, in any cause — a field
//      present on one of them is the difference a prober is looking for. This
//      is the `embed-refusal.test.ts` byte-for-byte precedent (20.1), applied
//      to delivery instead of to a discussion.
//
// What this file does NOT assert is timing, and that is stated rather than
// silently skipped: `isDeliverableTo()` issues both of its reads in parallel
// and unconditionally, so no cause short-circuits ahead of another — the
// comment there carries the reasoning, and measuring it would need a harness
// this repo does not have.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { blankComments } from "@/scripts/lib/source-text.mjs";

import de from "../messages/de.json";
import en from "../messages/en.json";

import { canBlockMember, canDeliverTo } from "./rules";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * The four ways a message can fail to be deliverable.
 *
 * Named so a failure says WHICH cause diverged — the whole point of the suite
 * is that they must not be tellable apart, so the test has to be the one place
 * that can tell them apart.
 */
const CAUSES = {
  self: { self: true, target: { blockedAt: null }, blockedEitherWay: false },
  noSuchMember: { self: false, target: null, blockedEitherWay: false },
  accountBlocked: {
    self: false,
    target: { blockedAt: new Date("2026-01-01") },
    blockedEitherWay: false,
  },
  memberBlock: {
    self: false,
    target: { blockedAt: null },
    blockedEitherWay: true,
  },
} as const;

describe("every undeliverable cause answers with one code", () => {
  it("resolves all four to notDeliverable", () => {
    for (const [label, input] of Object.entries(CAUSES)) {
      expect(canDeliverTo(input), label).toBe("communityNotDeliverable");
    }
  });

  it("answers null when there is nothing wrong", () => {
    // Non-vacuity: a function that returned "communityNotDeliverable" unconditionally
    // would pass every assertion above.
    expect(
      canDeliverTo({
        self: false,
        target: { blockedAt: null },
        blockedEitherWay: false,
      }),
    ).toBeNull();
  });

  it("gives the four causes the same answer, compared against each other", () => {
    // The assertion the requirement actually makes: not "each equals the
    // string" but "each equals the others". A future refusal object with a
    // reason field would pass the test above and fail this one.
    const answers = Object.values(CAUSES).map((input) => canDeliverTo(input));
    for (const answer of answers) {
      expect(answer).toEqual(answers[0]);
    }
  });

  it("refuses a self-block with the same code", () => {
    // The one refusal blocking itself has. It shares the code deliberately:
    // "you cannot block yourself" is a sentence about a state nobody reaches
    // through the interface, and a second code would be a second sentence to
    // translate for it.
    expect(canBlockMember("a", "a")).toBe("communityNotDeliverable");
    expect(canBlockMember("a", "b")).toBeNull();
  });
});

describe("the sentence is one sentence", () => {
  it("exists once per language and says nothing about a cause", () => {
    const sentences = [de.errors.communityNotDeliverable, en.errors.communityNotDeliverable];

    for (const sentence of sentences) {
      expect(sentence).toBeTruthy();
      // It must not name a cause. A sentence mentioning a block, an account or
      // a person is a sentence that answers the question the neutral refusal
      // exists not to answer.
      expect(sentence.toLowerCase()).not.toMatch(
        /block|gesperrt|blockiert|konto|account|existiert|exists/,
      );
    }
  });

  it("has no per-cause siblings in either language", () => {
    // The realistic leak: somebody adds `notDeliverableBlocked` "so the
    // message is more helpful". There is one key, and this is what notices a
    // second.
    for (const messages of [de.errors, en.errors] as Array<
      Record<string, string>
    >) {
      const siblings = Object.keys(messages).filter(
        (key) => key.startsWith("communityNotDeliverable") && key !== "communityNotDeliverable",
      );
      expect(
        siblings,
        "one code, one sentence, all causes — a per-cause variant is the leak " +
          "FR-201 exists to prevent, arriving as helpfulness",
      ).toEqual([]);
    }
  });
});

describe("the delivery layer adds no detail of its own", () => {
  // `messages/actions.ts` is the one place a DM code becomes a sentence. If a
  // cause were ever to be told apart above the core, this is where it would
  // happen — a branch on the code, a second translation call, a field added to
  // one answer.
  // Comments blanked (CLAUDE.md: a checker reading source as TEXT does). The
  // slices below still line up — `blankComments()` keeps every offset.
  const actions = blankComments(
    readFileSync(join(ROOT, "modules/community/pages/messages/actions.ts"), "utf8"),
  );

  it("translates the code without branching on it", () => {
    // One `t(error.code, …)`, no `if (error.code === …)` anywhere near it.
    expect(actions).toContain("t(error.code");
    expect(actions).not.toMatch(/error\.code\s*===/);
  });

  it("never names the block in the refusal formatter", () => {
    // The DM actions may CALL blockMember/unblockMember — that is the member's
    // own act, with its own success message. What the function that turns a
    // refusal into a sentence may not do is know a block exists.
    const start = actions.indexOf("async function toState");
    expect(start, "toState should be in this file").toBeGreaterThan(-1);
    const body = actions.slice(start, actions.indexOf("\n}", start));

    expect(body.toLowerCase()).not.toContain("block");
    // Non-vacuity: the slice really is the formatter and not an empty string.
    expect(body).toContain("t(error.code");
  });
});
