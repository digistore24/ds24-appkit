// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The brake on mailing a sign-in link.
//
// The door this is about was open: `signInAction` routes `intent === "link"`
// straight into `sendLink()`, which called `signIn("email", …)` and nothing
// else. Only step 1 (`lookUp` → `addressHasPassword`) paid a limit, and the
// form posts the link submit WITHOUT going through step 1. So a loop over that
// one submit mailed anybody, as often as anybody liked, from the operator's own
// verified sending domain.
//
// 🚨 **What is asserted is the CALL COUNT, not only the returned state.** A
// guard that answers `tooManyLinks` and mails anyway is the exact defect worth
// having a test for, and it is invisible to an assertion on the return value —
// `signIn` redirects on success, so the state a caller sees says nothing about
// whether a mail left. The spy is the measurement; the state is the sentence.
//
// The other half is the survivor: the fourth call must be refused AND the first
// three must have gone out. A brake that refuses everything passes any test
// that only counts refusals.
import { describe, it, expect, vi, beforeEach } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";
import { LINK_SEND_LIMIT, LINK_SEND_ORIGIN_LIMIT } from "@/lib/credentials/rules";

/**
 * The one thing this file fakes.
 *
 * A successful `signIn` THROWS `NEXT_REDIRECT` — that is the contract
 * `handOver()` in actions.ts is written against, and faking it as a plain
 * resolve would exercise a path the real code never takes (its own comment
 * says so: "unreachable: signIn redirects"). So the spy throws the same shape
 * Next does, and the action is expected to let it through.
 */
const signIn = vi.fn((..._args: unknown[]) => {
  const error = new Error("NEXT_REDIRECT");
  throw error;
});

vi.mock("@/auth", () => ({ signIn: (...args: unknown[]) => signIn(...args) }));

// Headers are read for the origin. Kept variable so the origin-keyed half can
// be driven independently of the address-keyed one.
let forwardedFor: string | null = null;
vi.mock("next/headers", () => ({
  headers: async () => new Headers(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
}));

// The dialog asks these two before it decides anything. Neither is under test.
vi.mock("@/lib/auth/dev-login", () => ({ isDevLoginActive: () => false }));
vi.mock("@/lib/email", () => ({ isEmailLoginEnabled: () => true }));

const { signInAction } = await import("./actions");
const { INITIAL_SIGN_IN_STATE } = await import("./state");

/** One press of "mail me a link instead". */
async function requestLink(email: string) {
  const form = new FormData();
  form.set("email", email);
  form.set("intent", "link");
  return signInAction(INITIAL_SIGN_IN_STATE, form);
}

beforeEach(() => {
  resetRateLimits();
  signIn.mockClear();
  forwardedFor = null;
});

describe("mailing a sign-in link", () => {
  it("mails up to the limit and then refuses — and the refusal does not mail", async () => {
    const address = "someone@example.com";

    for (let i = 0; i < LINK_SEND_LIMIT.max; i += 1) {
      // Each of these reaches `signIn`, which throws NEXT_REDIRECT. That is the
      // success path, so it must escape the action rather than be caught.
      await expect(requestLink(address)).rejects.toThrow("NEXT_REDIRECT");
    }
    expect(signIn).toHaveBeenCalledTimes(LINK_SEND_LIMIT.max);

    const refused = await requestLink(address);
    expect(refused.error).toBe("tooManyLinks");
    // The whole point: still three, not four.
    expect(signIn).toHaveBeenCalledTimes(LINK_SEND_LIMIT.max);
    // And the address survives the refusal — retyping it is what step 2 exists
    // to avoid, and a refusal that clears the field is a worse dialog.
    expect(refused.email).toBe(address);
    expect(refused.step).toBe("email");
  });

  it("does not let a second address inherit the first one's counter", async () => {
    // The counter is per address. Without this, a per-origin-only brake would
    // pass the test above and lock out an entire office on somebody else's
    // typing — the survivor half of the assertion.
    for (let i = 0; i < LINK_SEND_LIMIT.max; i += 1) {
      await expect(requestLink("first@example.com")).rejects.toThrow("NEXT_REDIRECT");
    }
    await expect(requestLink("second@example.com")).rejects.toThrow("NEXT_REDIRECT");
    expect(signIn).toHaveBeenCalledTimes(LINK_SEND_LIMIT.max + 1);
  });

  it("bounds many DIFFERENT addresses from one origin", async () => {
    // The shape the per-address counter structurally cannot see, and the one a
    // script actually has: one mail each to three hundred people. Every address
    // here is fresh, so the address bucket never fires and only the origin one
    // can produce the refusal.
    forwardedFor = "203.0.113.7";

    for (let i = 0; i < LINK_SEND_ORIGIN_LIMIT.max; i += 1) {
      await expect(requestLink(`user${i}@example.com`)).rejects.toThrow("NEXT_REDIRECT");
    }
    expect(signIn).toHaveBeenCalledTimes(LINK_SEND_ORIGIN_LIMIT.max);

    const refused = await requestLink("one-too-many@example.com");
    expect(refused.error).toBe("tooManyLinks");
    expect(signIn).toHaveBeenCalledTimes(LINK_SEND_ORIGIN_LIMIT.max);
  });

  it("normalises the address, so casing does not buy a fresh quota", async () => {
    const address = "Someone@Example.COM";
    for (let i = 0; i < LINK_SEND_LIMIT.max; i += 1) {
      await expect(requestLink(address)).rejects.toThrow("NEXT_REDIRECT");
    }
    const refused = await requestLink("someone@example.com");
    expect(refused.error).toBe("tooManyLinks");
    expect(signIn).toHaveBeenCalledTimes(LINK_SEND_LIMIT.max);
  });
});
