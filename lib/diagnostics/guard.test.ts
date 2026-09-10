// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// One answer for every refusal, and the whole point is that they are the SAME
// answer. A stranger must not be able to tell "no secret configured here" from
// "wrong secret" from "this app has no such route" — and each of those is a
// different sentence in the code, which is exactly how three of them end up
// answering three different ways.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { guardDiagnostics } from "./guard";
import { resetRateLimits } from "@/lib/rate-limit";

const SECRET = "s".repeat(64);

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://app.example.com/api/diagnostics/errors", { headers });
}

beforeEach(() => {
  resetRateLimits();
  process.env.DIAGNOSTICS_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.DIAGNOSTICS_SECRET;
  resetRateLimits();
});

/** Every refusal has to look exactly like this one. */
async function shapeOf(response: Response) {
  return {
    status: response.status,
    body: await response.text(),
    authenticate: response.headers.get("www-authenticate"),
  };
}

describe("the four refusal paths, and they are one refusal", () => {
  it("lets a correct bearer through", () => {
    expect(guardDiagnostics(request({ authorization: `Bearer ${SECRET}` }))).toBeNull();
  });

  it("refuses with no Authorization header", async () => {
    const refusal = guardDiagnostics(request());
    expect(refusal).not.toBeNull();
    expect(await shapeOf(refusal!)).toEqual({ status: 404, body: "", authenticate: null });
  });

  it("refuses a malformed Authorization header", async () => {
    const refusal = guardDiagnostics(request({ authorization: "Basic abc" }));
    expect(await shapeOf(refusal!)).toEqual({ status: 404, body: "", authenticate: null });
  });

  it("refuses a wrong secret", async () => {
    const refusal = guardDiagnostics(request({ authorization: `Bearer ${"x".repeat(64)}` }));
    expect(await shapeOf(refusal!)).toEqual({ status: 404, body: "", authenticate: null });
  });

  it("refuses a secret of the wrong LENGTH without throwing", async () => {
    // `timingSafeEqual` throws on mismatched lengths rather than returning
    // false. Without the length guard in front, this path would be a 500 —
    // which is a different answer, and therefore a signal.
    const refusal = guardDiagnostics(request({ authorization: "Bearer short" }));
    expect(await shapeOf(refusal!)).toEqual({ status: 404, body: "", authenticate: null });
  });

  it("🚨 refuses when no secret is configured at all — the SHIPPED state", async () => {
    delete process.env.DIAGNOSTICS_SECRET;
    // …and with a well-formed header, because a stranger who guessed the
    // variable name must still learn nothing.
    const refusal = guardDiagnostics(request({ authorization: `Bearer ${SECRET}` }));
    expect(await shapeOf(refusal!)).toEqual({ status: 404, body: "", authenticate: null });
  });

  it("answers the unset-secret case BEFORE it parses anything", async () => {
    // The ordering IS the control, not tidiness — the same argument
    // `surfaceOffResponse()` makes in lib/setup/dispatch.ts. A guard that
    // parsed first could answer differently for a garbled header, and that
    // difference is the whole leak.
    delete process.env.DIAGNOSTICS_SECRET;
    const garbled = await shapeOf(guardDiagnostics(request({ authorization: "!!!" }))!);
    const absent = await shapeOf(guardDiagnostics(request())!);
    expect(garbled).toEqual(absent);
  });
});

describe("a secret made of whitespace is not a secret (L-6)", () => {
  // `!secret` reads " " as SET, so the surface believed it was configured with
  // a one-space credential. Finding L-6 of the 2026-08-18 scan; the realistic
  // way there is a copied empty value in a host's secret store.
  it("🚨 answers the unset way, and does not even spend the caller's meter", () => {
    // The assertion is on the METER because that is what distinguishes the two
    // branches: the unset branch returns before `record()`, the compare branch
    // counts a failure. Both answer 404, so counting is the only observable
    // difference — and it is the one that says WHICH line answered.
    const headers = { "x-forwarded-for": "203.0.113.44" };
    process.env.DIAGNOSTICS_SECRET = "   ";
    for (let i = 0; i < 25; i += 1) expect(guardDiagnostics(request(headers))).not.toBeNull();

    // The operator now sets a real one. If the whitespace phase had been
    // treated as "configured, wrong credential", this caller would be locked
    // out of their own diagnostics for fifteen minutes.
    process.env.DIAGNOSTICS_SECRET = SECRET;
    expect(guardDiagnostics(request({ ...headers, authorization: `Bearer ${SECRET}` }))).toBeNull();
  });

  it("accepts the secret when the store padded it", () => {
    // The other half of trimming the VALUE rather than only the emptiness
    // test. A secret store that appends a newline used to make every correct
    // token wrong by one invisible byte — the length guard refuses first, so
    // the operator sees the same blank 404 a stranger sees and has nothing to
    // go on.
    process.env.DIAGNOSTICS_SECRET = `  ${SECRET}\n`;
    expect(guardDiagnostics(request({ authorization: `Bearer ${SECRET}` }))).toBeNull();
  });
});

describe("the failure meter", () => {
  it("keeps answering 404 once a caller is rate-limited — never a 429", async () => {
    // A 429 would say out loud that there is something here worth metering.
    const headers = { "x-forwarded-for": "203.0.113.9" };
    for (let i = 0; i < 25; i += 1) guardDiagnostics(request(headers));
    const refusal = guardDiagnostics(request({ ...headers, authorization: `Bearer ${SECRET}` }));
    expect(refusal).not.toBeNull();
    expect(await shapeOf(refusal!)).toEqual({ status: 404, body: "", authenticate: null });
  });

  it("meters per caller, not globally", () => {
    for (let i = 0; i < 25; i += 1) guardDiagnostics(request({ "x-forwarded-for": "198.51.100.1" }));
    expect(
      guardDiagnostics({
        headers: new Headers({
          "x-forwarded-for": "198.51.100.2",
          authorization: `Bearer ${SECRET}`,
        }),
      } as Request),
    ).toBeNull();
  });

  it("does not meter a caller who got it right", () => {
    const headers = { "x-forwarded-for": "203.0.113.10", authorization: `Bearer ${SECRET}` };
    for (let i = 0; i < 40; i += 1) expect(guardDiagnostics(request(headers))).toBeNull();
  });
});
