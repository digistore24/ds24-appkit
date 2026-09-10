// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 ONE reading of the forwarded address, and it counts from the RIGHT.
//
// Finding M-5 of the 2026-08-18 scan, and it had two halves.
//
// **The claim was false.** Three places read `x-forwarded-for` and all three
// took the LEFTMOST entry, on the stated grounds that "the app runs behind a
// proxy that OVERWRITES it (Railway, Render, Fly all do)". Nobody had measured
// that. Checked against the vendors' own words on 2026-09-10: Fly APPENDS
// (documented, and measured — a request sent with `X-Forwarded-For: 1.2.3.4`
// arrived as `1.2.3.4, <real client>, <fly ip>`), Render appends, DigitalOcean
// does not carry the client in that header at all, and Railway's own staff
// contradict each other. So the leftmost entry is precisely the part the caller
// writes, and every meter keyed on it could be handed a fresh bucket per
// request.
//
// **There were three of them.** Two called `callerKey`, and they behaved
// differently — one fell back to `x-real-ip`, the other did not; the third
// answered `null` where the others answered `"unknown"`. `callerKey`'s own
// doc-comment demanded there be exactly one.
//
// So: a behavioural half for the reading, and a structural half that walks the
// tree so a fourth reading is red on the day it is written. The mould is
// `lib/ai/providers/leak-guard.test.ts`.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

import { blankComments } from "@/scripts/lib/source-text.mjs";
import { callerKey, clientAddress } from "./rules";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const headers = (values: Record<string, string>) => new Headers(values);

// ── Behavioural ────────────────────────────────────────────────────────────

describe("clientAddress counts from the right", () => {
  it("takes the entry left of the trusted hops, not the leftmost", () => {
    // The Fly shape, measured 2026-09-10: forged, real client, fly's own.
    const chain = "1.2.3.4, 82.136.77.178, 37.16.16.7";
    expect(clientAddress(headers({ "x-forwarded-for": chain }), { TRUSTED_PROXY_HOPS: "1" })).toBe(
      "82.136.77.178",
    );
  });

  it("the old behaviour would have returned the forged entry", () => {
    // Not a tautology: it names what the defect WAS, so that a future
    // "simplification" back to `split(",")[0]` is visibly a step backwards.
    const chain = "1.2.3.4, 82.136.77.178, 37.16.16.7";
    expect(chain.split(",")[0]!.trim()).toBe("1.2.3.4");
    expect(clientAddress(headers({ "x-forwarded-for": chain }), {})).not.toBe("1.2.3.4");
  });

  it("honours two hops — the Render shape, Cloudflare in front of the balancer", () => {
    const chain = "81.97.145.24, 172.71.195.123, 10.226.90.65";
    expect(clientAddress(headers({ "x-forwarded-for": chain }), { TRUSTED_PROXY_HOPS: "2" })).toBe(
      "81.97.145.24",
    );
  });

  it("a platform header wins outright, and stops the counting", () => {
    // DigitalOcean's `do-connecting-ip` and Fly's `Fly-Client-IP`: the client is
    // not in the chain at all there, or is but need not be counted to.
    const answer = clientAddress(
      headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8", "do-connecting-ip": "203.0.113.9" }),
      { TRUSTED_CLIENT_IP_HEADER: "do-connecting-ip" },
    );
    expect(answer).toBe("203.0.113.9");
  });

  it("never runs off the left end when the chain is shorter than the hops", () => {
    // A misconfiguration, not an attack: fewer proxies appended than declared.
    // The leftmost is then the best available and no worse than the old code.
    expect(clientAddress(headers({ "x-forwarded-for": "9.9.9.9" }), { TRUSTED_PROXY_HOPS: "4" })).toBe(
      "9.9.9.9",
    );
  });

  it("falls back to x-real-ip, then to nothing", () => {
    expect(clientAddress(headers({ "x-real-ip": "198.51.100.4" }), {})).toBe("198.51.100.4");
    expect(clientAddress(headers({}), {})).toBeNull();
    expect(clientAddress(undefined, {})).toBeNull();
  });

  it("a broken TRUSTED_PROXY_HOPS falls back to 1, never to 0", () => {
    // 0 would read the rightmost entry, which behind one proxy is the proxy —
    // and then every caller shares one bucket.
    for (const value of ["banana", "-3", ""]) {
      expect(
        clientAddress(headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }), {
          TRUSTED_PROXY_HOPS: value,
        }),
      ).toBe("1.1.1.1");
    }
  });

  it("callerKey names the shared bucket rather than returning null", () => {
    expect(callerKey(new Request("https://example.com"))).toBe("unknown");
  });
});

// ── Structural: no second reading anywhere in the tree ─────────────────────

describe("nothing else reads x-forwarded-for", () => {
  const SKIP = new Set(["node_modules", ".next", ".git", ".dev", "drizzle"]);
  // The one file allowed to read it, and the test that proves it does.
  const ALLOWED = new Set(["lib/setup/rules.ts"]);

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      // ⚠️ Test files are left out, and only test files. They SET the header
      // to drive a fixture — six of them do — which is the opposite of the
      // concern here: what must not exist is a second place that READS it and
      // decides something. A rule that could not tell the two apart would have
      // to be switched off, and a switched-off rule holds nothing.
      else if (/\.(ts|tsx|mjs|js)$/.test(entry.name) && !/\.test\.(ts|tsx|mjs|js)$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  it("only lib/setup/rules.ts names the header in CODE", () => {
    const files = walk(ROOT);
    // 🚨 A walk that found nothing is a broken walk, not a clean tree.
    expect(files.length, "the walk found no source files at all").toBeGreaterThan(200);

    const offenders: string[] = [];
    for (const file of files) {
      // Through blankComments: all three original sites explained themselves at
      // length, and `password-login.ts` still names the header three times in
      // prose. A grep over raw source would report the explanations as the
      // defect.
      const code = blankComments(readFileSync(file, "utf8"));
      if (!/x-forwarded-for/i.test(code)) continue;
      const rel = relative(ROOT, file).split("\\").join("/");
      if (!ALLOWED.has(rel)) offenders.push(rel);
    }

    expect(offenders, "a second reading of x-forwarded-for appeared").toEqual([]);
  });

  it("and the reader itself is reached through one exported name", () => {
    const rules = blankComments(readFileSync(join(ROOT, "lib/setup/rules.ts"), "utf8"));
    expect(rules).toMatch(/export function clientAddress\(/);
    expect(rules).toMatch(/export function callerKey\(/);
    // `callerKey` must go through `clientAddress` rather than re-reading.
    const start = rules.indexOf("export function callerKey(");
    expect(rules.slice(start, start + 300)).toMatch(/clientAddress\(/);
  });
});
