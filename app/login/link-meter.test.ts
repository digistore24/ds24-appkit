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
//
// ── 🚨 What changed on 2026-09-10, and why this file had to change with it ──
//
// This file used to drive the meter through `signInAction` alone, with `signIn`
// faked. That measured the architecture the finding disproved: the brake sat in
// the ACTION, and `POST /api/auth/signin/email` reaches the Auth.js provider
// directly, past it (finding M-6). The meter is in `sendVerificationRequest()`
// now, so the fake `signIn` below CALLS THROUGH to it — which is what Auth.js
// really does — and the file gained a second describe block that posts at the
// provider directly, the way the open door did.
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
const signIn = vi.fn(async (_provider: unknown, options: unknown) => {
  // 🚨 Through the guard, not around it. Auth.js calls
  // `sendVerificationRequest()`, which calls `guardSignInLink()` before it
  // sends; a fake that only threw would leave the meter untouched and this
  // whole file green over an unmetered door. The structural test at the bottom
  // is what holds the provider to actually calling it.
  const email = (options as { email?: string } | undefined)?.email ?? "";
  await sendVerification(email);
  throw new Error("NEXT_REDIRECT");
});

vi.mock("@/auth", () => ({ signIn: (...args: unknown[]) => signIn(args[0], args[1]) }));

// Headers are read for the origin. Kept variable so the origin-keyed half can
// be driven independently of the address-keyed one.
let forwardedFor: string | null = null;
vi.mock("next/headers", () => ({
  headers: async () => new Headers(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
}));

// The dialog asks this before it decides anything, and it is not under test.
vi.mock("@/lib/auth/dev-login", () => ({ isDevLoginActive: () => false }));

vi.mock("@/lib/email", () => ({ isEmailLoginEnabled: () => true }));

const { signInAction } = await import("./actions");
const { INITIAL_SIGN_IN_STATE } = await import("./state");
const { asOperatorInvitation, guardSignInLink } = await import("@/lib/auth/link-context");

/**
 * What the provider does before it sends — the door `POST
 * /api/auth/signin/email` reaches, with the transport left out.
 *
 * ⚠️ The guard is called rather than `buildEmailProvider()`: the provider
 * closes over its own module's `isEmailLoginEnabled()` and `sendLoginEmail()`,
 * and a partial mock does not intercept a module's calls to itself — so driving
 * it would need the real transport. The decision lives in its own function for
 * exactly that reason, and the last test in this file reads the provider's
 * source to prove the two are still wired together.
 */
const mailed = { to: [] as string[] };
async function sendVerification(email: string) {
  await guardSignInLink(email);
  mailed.to.push(email);
}

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
  mailed.to.length = 0;
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

describe("🚨 the door the action never covered", () => {
  // `POST /api/auth/signin/email` with a csrf token and any address goes
  // straight to the provider. Before 2026-09-10 nothing metered it, and the
  // provider exists exactly when a mail transport is configured — which in
  // STAGING and PROD is mandatory. So the unmetered door existed precisely
  // where it counted.
  it("meters a caller that bypasses the sign-in dialog entirely", async () => {
    const address = "victim@example.com";

    for (let i = 0; i < LINK_SEND_LIMIT.max; i += 1) {
      await sendVerification(address);
    }
    expect(mailed.to).toHaveLength(LINK_SEND_LIMIT.max);

    await expect(sendVerification(address)).rejects.toThrow(/rate limit/);
    // The measurement: still three mails, not four.
    expect(mailed.to).toHaveLength(LINK_SEND_LIMIT.max);
  });

  it("lets the operator's invitation through — an exemption, not a gap", async () => {
    const address = "invited@example.com";

    // Fill the address's quota the ordinary way first.
    for (let i = 0; i < LINK_SEND_LIMIT.max; i += 1) {
      await sendVerification(address);
    }
    await expect(sendVerification(address)).rejects.toThrow(/rate limit/);

    // The admin's "send a sign-in link" is requireOwner-gated and must not be
    // counted against the person being invited.
    await asOperatorInvitation(() => sendVerification(address));
    expect(mailed.to).toHaveLength(LINK_SEND_LIMIT.max + 1);
  });

  it("the exemption does not leak past the act it wraps", async () => {
    // The reason it is AsyncLocalStorage and not a module-level flag: two
    // requests are served at once, and a flag set by one would exempt the
    // other's send.
    const address = "leak@example.com";
    for (let i = 0; i < LINK_SEND_LIMIT.max; i += 1) await sendVerification(address);
    await asOperatorInvitation(() => sendVerification(address));

    await expect(sendVerification(address)).rejects.toThrow(/rate limit/);
  });
});

describe("and the provider really reaches it", () => {
  // The behavioural half above drives `guardSignInLink()` directly, which
  // cannot see whether `sendVerificationRequest()` still calls it. This is the
  // other half: the source, read, with the ORDER asserted. A guard that runs
  // after the send has already paid for what it refuses.
  it("calls the guard before the mail, in sendVerificationRequest", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { join } = await import("node:path");
    const { blankComments } = await import("@/scripts/lib/source-text.mjs");

    const root = fileURLToPath(new URL("../../", import.meta.url));
    const source = blankComments(readFileSync(join(root, "lib/email.ts"), "utf8"));

    const start = source.indexOf("async sendVerificationRequest(");
    expect(start, "sendVerificationRequest is gone from lib/email.ts").toBeGreaterThan(0);
    const body = source.slice(start, source.indexOf("\n    },", start));

    const guard = body.indexOf("guardSignInLink(");
    const send = body.indexOf("sendLoginEmail(");
    expect(guard, "the provider no longer calls the guard").toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(-1);
    expect(guard, "the guard runs after the mail").toBeLessThan(send);
  });
});
