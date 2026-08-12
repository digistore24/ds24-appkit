// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { isSpendableAmount, spendErrorFor } from "./spend";
import { InsufficientTokensError } from "./account";
import { TokenError, MAX_TOKEN_AMOUNT } from "./rules";
import { blankComments } from "@/scripts/lib/source-text.mjs";

// The pure half of the debit. The impure half (`spendTokens`) is transcription
// — session in, `consumeTokens` out — and there is no test database here, so
// what is worth asserting is asserted without one. Same split as
// rules.ts/account.ts.

describe("isSpendableAmount", () => {
  it("accepts a whole positive price", () => {
    expect(isSpendableAmount(1)).toBe(true);
    expect(isSpendableAmount(42)).toBe(true);
    expect(isSpendableAmount(MAX_TOKEN_AMOUNT)).toBe(true);
  });

  it("rejects zero and negatives — a spend that gives tokens back is a credit", () => {
    expect(isSpendableAmount(0)).toBe(false);
    expect(isSpendableAmount(-1)).toBe(false);
  });

  it("rejects fractions — the ledger column is an integer", () => {
    expect(isSpendableAmount(0.5)).toBe(false);
    expect(isSpendableAmount(1.0001)).toBe(false);
  });

  it("rejects what a miscomputed price actually looks like", () => {
    // The realistic failure is not someone typing "abc" — nobody types here at
    // all. It is arithmetic on an undefined field.
    expect(isSpendableAmount(NaN)).toBe(false);
    expect(isSpendableAmount(Infinity)).toBe(false);
  });

  it("rejects above the integer column's ceiling", () => {
    expect(isSpendableAmount(MAX_TOKEN_AMOUNT + 1)).toBe(false);
  });
});

describe("spendErrorFor", () => {
  it("turns a shortfall into a translatable code", () => {
    const mapped = spendErrorFor(new InsufficientTokensError(3, 10));
    expect(mapped).toBeInstanceOf(TokenError);
    expect(mapped?.code).toBe("insufficientBalance");
  });

  it("leaves everything else alone", () => {
    // A dropped connection must reach the caller as itself. Dressing it as
    // "not enough tokens" would tell a Member who has plenty that they are
    // broke, and hide an outage.
    expect(spendErrorFor(new Error("connection terminated"))).toBeNull();
    expect(spendErrorFor(new TokenError("notOwner"))).toBeNull();
  });
});

describe("the session, not an argument, decides whose balance moves", () => {
  // AC 3, asserted the same way AC 4 is in billing-mode.test.ts: by reading the
  // source. There is no test database here, so a property about a function's
  // SIGNATURE — that it cannot be told whose balance to touch — is provable
  // only by looking at it.
  //
  // Why bother when TypeScript already types the parameter: the risk this
  // guards is a human or an agent ADDING the parameter, which type-checks
  // perfectly. §D2 of the story spells out why an optional `memberId`
  // defaulting to the session is not an acceptable version of this function.
  const source = readFileSync(new URL("./spend.ts", import.meta.url), "utf8");
  const code = blankComments(source);
  const signature = code.slice(
    code.indexOf("export async function spendTokens"),
    code.indexOf("): Promise<number>"),
  );

  it("spendTokens accepts no member id", () => {
    expect(
      /memberId/.test(signature),
      "spendTokens takes a memberId. It must not: a Server Action is an HTTP\n" +
        "endpoint of its own, so an id from a FormData drains another customer's\n" +
        "balance. An OPTIONAL one defaulting to the session does not fix this —\n" +
        "it makes the bad call compile again and skips the blocked-account check\n" +
        "in requireActiveUser(). Write spendTokensFor({ actor, memberId }) with\n" +
        "requireOwner() instead.",
    ).toBe(false);
  });

  it("spendTokens resolves the member from the session", () => {
    const body = code.slice(code.indexOf("export async function spendTokens"));
    expect(body).toMatch(/requireActiveUser\s*\(/);
  });
});
