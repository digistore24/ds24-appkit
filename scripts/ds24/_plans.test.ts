// Copyright (c) 2026 Digistore24 Inc, SPDX-License-Identifier: MIT

// The payment plans a product carries — what gets created, what gets updated,
// and the one thing that never happens here: a delete.
//
// The sharpest assertion in this file is the installments rule. `0` is an
// open-ended subscription and `1` a single payment, so an interval that fails
// to reach `planData` turns a membership into a one-off sale — the buyer pays
// once and keeps the access for ever, and nothing anywhere goes red.
import { describe, expect, it, vi } from "vitest";

import {
  planData as rawPlanData,
  planRows,
  applyPlanRows,
  planIdOf,
} from "./_plans.mjs";

/** The wire shape: `data[...]` keys, all optional. The .mjs has no types. */
type PlanData = Record<string, string | undefined>;
const planData = (
  option: Record<string, unknown>,
  opts?: { active?: boolean; switchable?: boolean },
): PlanData => rawPlanData(option, opts) as PlanData;

const monthly = {
  key: "monthly",
  position: 0,
  priceCents: 1900,
  currency: "EUR",
  billingInterval: "1_month",
};
const yearly = {
  key: "yearly",
  position: 1,
  priceCents: 19000,
  currency: "EUR",
  billingInterval: "12_month",
};
const oneOff = { key: "default", position: 0, priceCents: 14900, currency: "EUR" };

describe("planData", () => {
  it("makes a subscription open-ended", () => {
    const d = planData(monthly);
    expect(d["data[number_of_installments]"]).toBe("0");
    expect(d["data[first_billing_interval]"]).toBe("1_month");
    expect(d["data[other_billing_intervals]"]).toBe("1_month");
    expect(d["data[first_amount]"]).toBe("19.00");
    expect(d["data[other_amounts]"]).toBe("19.00");
  });

  it("makes an offering without an interval a SINGLE payment", () => {
    const d = planData(oneOff);
    expect(d["data[number_of_installments]"]).toBe("1");
    expect(d["data[first_billing_interval]"]).toBeUndefined();
    expect(d["data[other_amounts]"]).toBeUndefined();
  });

  it("carries the declaration order onto the order form", () => {
    expect(planData(yearly)["data[position]"]).toBe("1");
  });

  it("allows switching only where there is something to switch to", () => {
    expect(planData(monthly, { switchable: true })["data[is_switching_allowed]"]).toBe("Y");
    expect(planData(monthly)["data[is_switching_allowed]"]).toBeUndefined();
  });

  it("sends Y/N, never a boolean — Digistore24 has no other shape", () => {
    expect(planData(monthly, { active: false })["data[is_active]"]).toBe("N");
    expect(planData(monthly)["data[is_active]"]).toBe("Y");
  });
});

describe("planRows", () => {
  it("creates what has no plan and updates what has one", () => {
    const rows = planRows([monthly, yearly], { monthly: { id: "991" } });
    expect(rows.map((r) => [r.action, r.option.key])).toEqual([
      ["update", "monthly"],
      ["create", "yearly"],
    ]);
    expect(rows[0].payplanId).toBe("991");
  });

  it("DEACTIVATES a way to pay that left the registry — never deletes it", () => {
    // Somebody is being billed against that plan and this script cannot see
    // who. Deleting it would be a rebilling that stops.
    const rows = planRows([monthly], { monthly: { id: "991" }, yearly: { id: "992" } });
    const gone = rows.find((r) => r.option.key === "yearly");
    expect(gone?.action).toBe("deactivate");
    expect(gone?.payplanId).toBe("992");
    expect(rows.some((r) => r.action === "delete")).toBe(false);
  });

  it("marks the rows switchable only when the offering has several ways to pay", () => {
    expect(planRows([monthly, yearly], {})[0].switchable).toBe(true);
    expect(planRows([oneOff], {})[0].switchable).toBe(false);
  });
});

describe("applyPlanRows", () => {
  function harness(answers: Record<string, unknown> = {}) {
    const calls: Array<[string, Record<string, string>]> = [];
    const call = vi.fn(async (fn: string, params: Record<string, string>) => {
      calls.push([fn, params]);
      return answers[fn] ?? { paymentplan_id: "777" };
    });
    const recorded: Array<[string, string]> = [];
    return {
      calls,
      recorded,
      opts: {
        call,
        record: (option: { key: string }, id: string) =>
          recorded.push([option.key, String(id)]),
      },
    };
  }

  it("records the id of a plan it created, against the option it created it for", () => {
    const h = harness();
    return applyPlanRows(planRows([yearly], {}), "512345", h.opts).then((r) => {
      expect(r.created).toBe(1);
      expect(h.recorded).toEqual([["yearly", "777"]]);
      expect(h.calls[0][0]).toBe("createPaymentplan");
      expect(h.calls[0][1].product_id).toBe("512345");
    });
  });

  it("re-records an updated plan too — the price it was written with travels with the id", () => {
    const h = harness();
    return applyPlanRows(
      planRows([monthly], { monthly: { id: "991" } }),
      "512345",
      h.opts,
    ).then((r) => {
      expect(r.updated).toBe(1);
      expect(h.recorded).toEqual([["monthly", "991"]]);
    });
  });

  it("writes no plan for a way to pay that has no price, and counts it", async () => {
    const h = harness();
    const priceless = { key: "monthly", position: 0, billingInterval: "1_month" };
    const r = await applyPlanRows(planRows([priceless], {}), "512345", h.opts);
    expect(r.created).toBe(0);
    expect(r.skipped).toBe(1);
    expect(h.calls).toHaveLength(0);
  });

  it("throws rather than recording nothing when the API returns no plan id", async () => {
    const h = harness({ createPaymentplan: { result: "success" } });
    await expect(
      applyPlanRows(planRows([yearly], {}), "512345", h.opts),
    ).rejects.toThrow(/paymentplan_id/);
  });
});

describe("planIdOf", () => {
  it("reads the documented key and the bare one", () => {
    expect(planIdOf({ paymentplan_id: "1" })).toBe("1");
    expect(planIdOf({ id: "2" })).toBe("2");
    expect(planIdOf({})).toBeNull();
  });
});
