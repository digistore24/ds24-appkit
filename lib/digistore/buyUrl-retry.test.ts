// Copyright (c) 2026 Digistore24 Inc, SPDX-License-Identifier: MIT

// The one failure mode stored payment plans introduce — and the reason it is
// caught here rather than by the customer.
//
// A payment plan is validated against the product it is named for
// (`createBuyUrl.php:427-430`). So a plan id the registry still holds after
// somebody deleted the plan at Digistore24 does not make ONE card fail: every
// buy button of that offering answers `payment_plan_not_found`, in every
// language, for every visitor. The page goes dark with money on the table.
//
// The answer is the same shape as the unknown-affiliate retry one door over:
// narrow detection, exactly one retry, and the sale goes through at the
// registry price while the vendor gets told in the log.
import { describe, it, expect, vi, beforeEach } from "vitest";

const post = vi.fn();
vi.mock("./client", () => ({ ds24Post: (...a: unknown[]) => post(...a) }));
vi.mock("@/db", () => ({ db: {} }));

const { createBuyUrl } = await import("./buyUrl");

const offer = {
  key: "silber:yearly",
  productId: "512345",
  priceCents: 19000,
  billingInterval: "12_month",
  payplanId: "992",
  optionKey: "yearly",
};

beforeEach(() => {
  post.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("a stored plan Digistore24 no longer knows", () => {
  it("retries once WITHOUT the plan and sells at the registry price", async () => {
    post
      .mockRejectedValueOnce(new Error("payment_plan_not_found: 992"))
      .mockResolvedValueOnce({ data: { url: "https://checkout/x" } });

    const url = await createBuyUrl("key", offer);

    expect(url).toBe("https://checkout/x");
    expect(post).toHaveBeenCalledTimes(2);

    const first = post.mock.calls[0][2] as Record<string, string>;
    const second = post.mock.calls[1][2] as Record<string, string>;
    expect(first["settings[plan]"]).toBe("992");
    // The retry prices itself, so the buyer pays what the registry says —
    // never the product's default plan.
    expect(second["settings[plan]"]).toBeUndefined();
    expect(second["payment_plan[template]"]).toBeUndefined();
    expect(second["payment_plan[first_amount]"]).toBe("190.00");
    expect(second["payment_plan[number_of_installments]"]).toBe("0");
  });

  it("says which plan and which offering, so the vendor can fix it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    post
      .mockRejectedValueOnce(new Error("payment_plan_not_found: 992"))
      .mockResolvedValueOnce({ data: { url: "https://checkout/x" } });

    await createBuyUrl("key", offer);

    const line = String(logged.mock.calls[0]?.[0]);
    expect(line).toContain("992");
    expect(line).toContain("512345");
    expect(line).toContain("ds24-sync");
  });

  it("does NOT retry an unrelated failure — the real cause has to surface", async () => {
    post.mockRejectedValue(new Error("invalid api key"));
    await expect(createBuyUrl("key", offer)).rejects.toThrow(/invalid api key/);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("does not retry when there was no stored plan to blame", async () => {
    post.mockRejectedValue(new Error("payment_plan_not_found: 992"));
    const inline = { ...offer, payplanId: undefined };
    await expect(createBuyUrl("key", inline)).rejects.toThrow();
    expect(post).toHaveBeenCalledTimes(1);
  });
});
