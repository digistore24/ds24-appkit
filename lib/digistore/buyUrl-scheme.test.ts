// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The strongest sink of the "a foreign URL reaches a browser unchecked" class,
// and the reason it is checked at the ANSWER.
//
// `createBuyUrl` used to ask `data.data.url` one question — does it exist? The
// value then travelled unchanged through `withTestpayParam()` into
// `app/plans/actions.ts`, where it becomes `redirect(url)`: a `Location`
// header the buyer's browser follows without a click and without ever showing
// them where they are going. A fake payment form at the other end is exactly
// the failure a checkout must not be able to produce.
//
// LOW, because the source is the Digistore24 API over HTTPS with an API key
// rather than a user — it needs a compromise on their side or a MITM. Fixed
// anyway: the check is three lines and the buyer's money is on the other side
// of it.
import { describe, it, expect, vi, beforeEach } from "vitest";

const post = vi.fn();
vi.mock("./client", () => ({ ds24Post: (...a: unknown[]) => post(...a) }));
vi.mock("@/db", () => ({ db: {} }));

const { createBuyUrl } = await import("./buyUrl");

const offer = {
  key: "gold",
  productId: "123456",
  priceCents: 900,
  billingInterval: "1_month",
};

beforeEach(() => {
  post.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the URL Digistore24 answers with", () => {
  it("passes an ordinary https checkout URL through untouched", async () => {
    post.mockResolvedValueOnce({
      data: { url: "https://www.digistore24.com/product/123456/xyz" },
    });

    expect(await createBuyUrl("key", offer)).toBe(
      "https://www.digistore24.com/product/123456/xyz",
    );
  });

  it("refuses anything that is not https, rather than redirecting the buyer", async () => {
    // 🚨 The failure this prevents is a buyer on a convincing fake payment
    // form with the vendor's product name on it, reached without a click.
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<form>pay</form>",
      // Plain http would put a payment page on a link anybody on the path can
      // rewrite. A checkout provider has no reason to ever answer with one.
      "http://www.digistore24.com/product/123456/xyz",
      // Protocol-relative: valid in a `Location` header and it leaves the
      // site. The same trap `lib/legal/markdown.ts` had in its `href` filter.
      "//evil.example/checkout",
      "/checkout",
    ]) {
      post.mockReset();
      post.mockResolvedValueOnce({ data: { url } });
      await expect(createBuyUrl("key", offer), url).rejects.toThrow(
        /non-https buy URL/,
      );
    }
  });

  it("still reports a MISSING url as missing", async () => {
    // The older check, kept: "absent" and "present but hostile" are different
    // diagnoses and the vendor reading the log needs to be able to tell them
    // apart.
    post.mockResolvedValueOnce({ data: {} });
    await expect(createBuyUrl("key", offer)).rejects.toThrow(/no buy URL/);
  });

  it("does not let the affiliate retry swallow the refusal", async () => {
    // 🚨 This is why the check sits OUTSIDE the try block.
    //
    // `isUnknownAffiliateError()` is deliberately a heuristic: it asks whether
    // the affiliate name occurs anywhere in the error message. The refusal
    // echoes the offending URL into its message, so raised inside the try, an
    // affiliate id as short as "evil" — or as short as one character — would
    // match, and `createBuyUrl` would answer a hostile response with a silent
    // retry against the same endpoint instead of a refusal. If the second
    // attempt then answered with the same hostile URL, the caller would get it.
    //
    // Note the mock is armed TWICE: if the retry ever fires, the second call
    // succeeds and the test sees a returned URL instead of a throw.
    const hostile = { data: { url: "//evil.example/checkout" } };
    post.mockResolvedValueOnce(hostile).mockResolvedValueOnce(hostile);

    await expect(
      createBuyUrl("key", offer, { affiliate: "evil" }),
    ).rejects.toThrow(/non-https buy URL/);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("checks the URL that a stale-plan retry comes back with, too", async () => {
    // The retry paths return through recursive calls, so each answer is judged
    // at its own level. Worth pinning: a fix that only guarded the first call
    // would leave the recursion — the path that actually runs when a vendor
    // deletes a payment plan — unguarded.
    post
      .mockRejectedValueOnce(new Error("Ungültige Bezahlplan-ID: 992"))
      .mockResolvedValueOnce({ data: { url: "javascript:alert(1)" } });

    await expect(
      createBuyUrl("key", { ...offer, payplanId: "992" }),
    ).rejects.toThrow(/non-https buy URL/);
    expect(post).toHaveBeenCalledTimes(2);
  });
});
