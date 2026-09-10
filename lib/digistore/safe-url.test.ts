// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// One whitelist, and BOTH doors go through it.
//
// The behavioural half is small; the structural half is the point. Finding L-3
// named the API reader, and the tree had a second reader — the IPN — writing
// the same three columns into the database with no check, which is the one the
// billing page renders. A test that only exercised the helper would have been
// green while the door that mattered stayed open.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { blankComments } from "@/scripts/lib/source-text.mjs";
import { ds24HttpsUrl, ds24HttpsUrlOrNull } from "./safe-url";
import { invoiceRowFromIpn } from "./member-billing";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (f: string) => blankComments(readFileSync(join(ROOT, f), "utf8"));

describe("ds24HttpsUrl", () => {
  it("passes an https URL through untouched", () => {
    expect(ds24HttpsUrl("renew_url", "https://www.digistore24.com/x")).toBe(
      "https://www.digistore24.com/x",
    );
  });

  it("refuses everything else, and says which field it dropped", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "http://www.digistore24.com/x",
      "//evil.example/x",
      "/relative",
    ]) {
      expect(ds24HttpsUrl("renew_url", bad), bad).toBeUndefined();
    }
    expect(spy).toHaveBeenCalledTimes(5);
    // The shape `node run.mjs errors` needs.
    expect(spy.mock.calls[0]![1]).toBeInstanceOf(Error);
    expect(String(spy.mock.calls[0]![0])).toMatch(/renew_url/);
    spy.mockRestore();
  });

  it("treats absent, null and empty as absent — no log line", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(ds24HttpsUrl("x", undefined)).toBeUndefined();
    expect(ds24HttpsUrl("x", null)).toBeUndefined();
    expect(ds24HttpsUrl("x", "")).toBeUndefined();
    expect(ds24HttpsUrlOrNull("x", "")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("the IPN door, which is the one the billing page renders", () => {
  it("drops an invoice whose URL is not https", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const row = invoiceRowFromIpn({
      order_id: "ORD-1",
      transaction_id: "TX-1",
      invoice_url: "javascript:alert(1)",
    });
    // No URL survives the check, and without one there is no invoice row.
    expect(row).toBeNull();
    spy.mockRestore();
  });

  it("keeps an https invoice", () => {
    const row = invoiceRowFromIpn({
      order_id: "ORD-1",
      transaction_id: "TX-1",
      invoice_url: "https://www.digistore24.com/invoice/1",
    });
    expect(row?.invoiceUrl).toBe("https://www.digistore24.com/invoice/1");
  });
});

describe("every reader of these fields goes through the whitelist", () => {
  // 🚨 The structural half. A fourth place taking `renew_url` or
  // `invoice_url` out of a Digistore24 answer and skipping the check is red on
  // the day it is written, rather than at the next audit.
  const FIELDS = ["renew_url", "rebilling_stop_url", "invoice_url", "receipt_url"];
  const READERS = [
    "lib/digistore/payment-event.ts",
    "lib/digistore/member-billing.ts",
    "lib/digistore/billing.ts",
  ];

  it.each(READERS)("%s never reads one of them raw", (file) => {
    const code = read(file);
    for (const field of FIELDS) {
      // `body["renew_url"]` / `s("renew_url")` are allowed only as the ARGUMENT
      // of the whitelist. What must not exist is one of these landing anywhere
      // else — an assignment, a return, a template string.
      const raw = [...code.matchAll(new RegExp(`["'\`]${field}["'\`]`, "g"))];
      for (const hit of raw) {
        const around = code.slice(Math.max(0, hit.index - 220), hit.index + 60);
        expect(
          /ds24HttpsUrl(OrNull)?\(|httpUrl\(/.test(around),
          `${file}: "${field}" is read outside the whitelist`,
        ).toBe(true);
      }
    }
  });
});
