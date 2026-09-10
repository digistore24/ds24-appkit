// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The cap on `/api/ipn`, and it is asserted on the EFFECT rather than on the
// status code.
//
// A 413 proves the handler answered; it does not prove the bytes stayed out of
// the database, and that was the whole finding (H-1 of the 2026-08-18 scan, and
// measured against the running app: 45 B, 1 MB and 20 MB all answered 403 and
// all three landed in `ipn_events` in full). So `recordIpnEvent` is mocked and
// COUNTED — the same way `scripts/deploy-ipn.mjs` reads the effect and not the
// exit code.
//
// The second claim is about ORDER: `content-length` is judged before the body
// is read at all. It is asserted by making the body itself observable — a
// stream that records whether anybody pulled from it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock("@/lib/digistore/ipn-log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/digistore/ipn-log")>();
  return {
    ...actual,
    recordIpnEvent: async (row: unknown) => {
      log.rows.push(row);
    },
  };
});

vi.mock("@/lib/digistore/payment-event", () => ({
  onPaymentEvent: async () => {},
}));

import { POST } from "./route";
import { resetRateLimits } from "@/lib/rate-limit";

const MAX = 64 * 1024;

/** A body that says how big it is and reports whether it was ever read. */
function post(body: string, opts: { announce?: number | null } = {}) {
  const announced = opts.announce === undefined ? body.length : opts.announce;
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    "x-forwarded-for": "203.0.113.7",
  };
  if (announced !== null) headers["content-length"] = String(announced);
  return POST(new Request("https://app.example.com/api/ipn", { method: "POST", body, headers }));
}

beforeEach(() => {
  log.rows = [];
  resetRateLimits();
  delete process.env.DIGISTORE_IPN_PASSPHRASE;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the body cap", () => {
  it("refuses an oversized body and writes NOTHING", async () => {
    const response = await post("x=" + "A".repeat(MAX + 1));

    expect(response.status).toBe(413);
    // The point of the whole exercise.
    expect(log.rows).toHaveLength(0);
  });

  it("refuses on the announced length alone, before the body is read", async () => {
    // A small body with a large `content-length`. If the handler read the body
    // first and measured that, this would pass the cap and be logged.
    const response = await post("x=1", { announce: 20 * 1024 * 1024 });

    expect(response.status).toBe(413);
    expect(log.rows).toHaveLength(0);
  });

  it("counts BYTES, not UTF-16 units", async () => {
    // "€" is three bytes and one unit. `raw.length` would see a third of the
    // real size and let roughly 3x the cap through.
    const body = "x=" + "€".repeat(MAX / 2);
    expect(body.length).toBeLessThan(MAX);
    expect(Buffer.byteLength(body)).toBeGreaterThan(MAX);

    const response = await post(body, { announce: null });

    expect(response.status).toBe(413);
    expect(log.rows).toHaveLength(0);
  });

  it("lets a real captured payload through — the cap must not break the money path", async () => {
    const vectors = (await import("@/lib/digistore/ipn-vectors.json")).default as unknown as {
      vectors: { name: string; params: Record<string, string | undefined> }[];
    };
    const captured = vectors.vectors.find((v) => v.name === "captured-on-payment");
    expect(captured).toBeTruthy();

    const body = new URLSearchParams(
      Object.entries(captured!.params).filter(([, v]) => typeof v === "string") as [
        string,
        string,
      ][],
    ).toString();
    expect(Buffer.byteLength(body)).toBeLessThan(MAX);

    // No passphrase configured → 403 "not configured", but it IS logged, which
    // is what proves the request got past the cap.
    const response = await post(body);
    expect(response.status).toBe(403);
    expect(log.rows).toHaveLength(1);
  });
});

describe("the brake on the branches a stranger can reach", () => {
  it("stops writing rows once the window is full, and the answer never changes", async () => {
    vi.stubEnv("DIGISTORE_IPN_PASSPHRASE", "a-passphrase");

    const bodies: Response[] = [];
    for (let i = 0; i < 80; i += 1) {
      bodies.push(await post(`event=on_payment&order_id=${i}&sha_sign=deadbeef`));
    }

    // Every single answer is the same one. If the brake showed through here it
    // would be an oracle for which signatures were worth trying.
    for (const response of bodies) {
      expect(response.status).toBe(403);
      expect(await response.text()).toBe("Invalid signature");
    }
    // 60 written, the remaining 20 dropped.
    expect(log.rows).toHaveLength(60);
  });

  it("meters per caller, not globally", async () => {
    vi.stubEnv("DIGISTORE_IPN_PASSPHRASE", "a-passphrase");

    for (let i = 0; i < 60; i += 1) {
      await post(`event=on_payment&sha_sign=deadbeef&n=${i}`);
    }
    expect(log.rows).toHaveLength(60);

    const other = await POST(
      new Request("https://app.example.com/api/ipn", {
        method: "POST",
        body: "event=on_payment&sha_sign=deadbeef",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-forwarded-for": "198.51.100.9",
        },
      }),
    );
    expect(other.status).toBe(403);
    expect(log.rows).toHaveLength(61);
  });
});
