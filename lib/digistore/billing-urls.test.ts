// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The five management deep links a purchase carries, and the one question
// nobody used to ask them: which scheme is this?
//
// `renew_url`, `rebilling_stop_url` and `invoice_url` are rendered as `href`s
// on the member's billing page (`app/dashboard/billing/ui.tsx`), and until
// 2026-08-18 they arrived there straight out of Digistore24's answer through
// nothing but `String()`. A `javascript:` in `renew_url` would have run on the
// click. It needs a compromise on Digistore24's side to happen at all — which
// is why it is a LOW finding and why it is fixed at the READER rather than at
// the one page that renders them today: the second page to render them will
// not bring a whitelist of its own, and nothing anywhere would go red.
//
// These tests go through `getPurchase`/`listPurchases` rather than calling
// `toPurchaseInfo` directly, because the reader is the thing under test: a
// test that reached past the API boundary would still pass if somebody wired a
// second, unfiltered conversion in.
import { describe, it, expect, vi, beforeEach } from "vitest";

const post = vi.fn();
vi.mock("./client", () => ({ ds24Post: (...a: unknown[]) => post(...a) }));

const { getPurchase, listPurchases } = await import("./billing");

/** One purchase as Digistore24 answers it, with every URL field filled. */
function purchase(urls: Record<string, string>) {
  return {
    purchase_id: "PUR-1",
    product_id: "42",
    is_canceled_now: "N",
    amount: "9.00",
    currency: "EUR",
    ...urls,
  };
}

const HTTPS = {
  renew_url: "https://www.digistore24.com/renew/PUR-1",
  rebilling_stop_url: "https://www.digistore24.com/stop/PUR-1",
  invoice_url: "https://www.digistore24.com/invoice/PUR-1",
  receipt_url: "https://www.digistore24.com/receipt/PUR-1",
  support_url: "https://www.digistore24.com/support/PUR-1",
};

// One spy for the whole file, CLEARED per test rather than re-installed.
// `vi.spyOn` on an already-spied method hands back the same spy with its call
// history intact, so re-installing it in `beforeEach` would let the refusals
// of one test count against the "logs nothing" assertion of the next.
const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  post.mockReset();
  errorLog.mockClear();
});

describe("the management links of a purchase", () => {
  it("keeps the https URLs Digistore24 really sends", async () => {
    // The half that has to survive the fix. Without it a whitelist could be
    // "made safe" by dropping every link, and the billing page would quietly
    // lose its cancel and invoice buttons for everybody.
    post.mockResolvedValueOnce({ data: purchase(HTTPS) });

    const info = await getPurchase("key", "PUR-1");

    expect(info.renewUrl).toBe(HTTPS.renew_url);
    expect(info.rebillingStopUrl).toBe(HTTPS.rebilling_stop_url);
    expect(info.invoiceUrl).toBe(HTTPS.invoice_url);
    expect(info.receiptUrl).toBe(HTTPS.receipt_url);
    expect(info.supportUrl).toBe(HTTPS.support_url);
  });

  it("drops a javascript: link and says so in the log", async () => {
    post.mockResolvedValueOnce({
      data: purchase({ ...HTTPS, renew_url: "javascript:alert(document.cookie)" }),
    });

    const info = await getPurchase("key", "PUR-1");

    // `undefined`, not the string: the UI renders this link conditionally, so
    // the button disappears instead of the page breaking. Everything else in
    // the record is untouched — the refusal is per field, so one bad link does
    // not cost a customer their invoice.
    expect(info.renewUrl).toBeUndefined();
    expect(info.invoiceUrl).toBe(HTTPS.invoice_url);
    expect(info.purchaseId).toBe("PUR-1");

    // 🚨 Silence is the failure mode here. A missing "update payment details"
    // button looks exactly like Digistore24 not having sent one, so the drop
    // has to leave a trace in `node run.mjs logs`.
    // Two arguments, and the second is the point: `lib/diagnostics/parse.mjs`
    // keys on an Error object, so a message alone would be invisible to
    // `node run.mjs errors`. The check lives in `./safe-url` now — the IPN
    // writes the same columns through a second door and needed the same
    // judgement, so there is one of it.
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("renew_url"),
      expect.any(Error),
    );
  });

  it("refuses every non-https scheme, on every one of the five fields", async () => {
    // One case per field, so a whitelist that forgets one is red. The three
    // that were reported are the three rendered TODAY; `receipt_url` and
    // `support_url` come out of the same answer and reach the same kind of
    // sink, and a rule that covers three of five is a list somebody has to
    // keep current rather than a rule.
    const hostile = {
      renew_url: "javascript:alert(1)",
      rebilling_stop_url: "data:text/html,<script>alert(1)</script>",
      // Not a scheme attack: `http:` downgrades a payment-management page to a
      // link anybody on the path can rewrite. A checkout provider has no
      // reason to ever send one.
      invoice_url: "http://www.digistore24.com/invoice/PUR-1",
      // Protocol-relative — the same trap the legal markdown parser had
      // (`lib/legal/markdown.ts`). `https:` is required in full, so it cannot
      // slip through here.
      receipt_url: "//evil.example/receipt",
      support_url: "vbscript:msgbox",
    };
    post.mockResolvedValueOnce({ data: purchase(hostile) });

    const info = await getPurchase("key", "PUR-1");

    expect(info.renewUrl).toBeUndefined();
    expect(info.rebillingStopUrl).toBeUndefined();
    expect(info.invoiceUrl).toBeUndefined();
    expect(info.receiptUrl).toBeUndefined();
    expect(info.supportUrl).toBeUndefined();
  });

  it("applies the same rule to a LISTED purchase, not only a fetched one", async () => {
    // `listPurchases` is the second door into the same conversion and the one
    // the subscription overview uses. It shares `toPurchaseInfo` today; this
    // test is what notices if it ever stops sharing it.
    post.mockResolvedValueOnce({
      data: {
        purchases: [
          purchase({ ...HTTPS, rebilling_stop_url: "javascript:alert(1)" }),
        ],
      },
    });

    const [row] = await listPurchases("key", {});

    expect(row.rebillingStopUrl).toBeUndefined();
    expect(row.renewUrl).toBe(HTTPS.renew_url);
  });

  it("leaves a missing link missing and logs nothing", async () => {
    // Not every purchase carries every link — the IPN in particular often
    // omits them, which is the reason `getPurchase` exists at all. An absent
    // field is normal and must not produce an error line, or the log fills
    // with noise and the real refusal above stops being noticeable.
    post.mockResolvedValueOnce({ data: purchase({}) });

    const info = await getPurchase("key", "PUR-1");

    expect(info.renewUrl).toBeUndefined();
    expect(errorLog).not.toHaveBeenCalled();
  });
});
