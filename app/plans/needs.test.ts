// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

import { neededProduct } from "./needs";
import type { ProductDef } from "@/lib/digistore/products";

const basic = { key: "basic_monthly", name: "Basic (monthly)", sell: true } as unknown as ProductDef;
const parked = { key: "starter_tokens", name: "Starter Tokens", sell: false } as unknown as ProductDef;
const lookup = (key: string) => ({ basic_monthly: basic, starter_tokens: parked })[key] ?? null;

describe("neededProduct — what /plans says about the page the member came from", () => {
  it("names the product a gated page pointed at", () => {
    expect(neededProduct("basic_monthly", lookup)).toBe(basic);
  });

  it("takes the first value when the parameter was repeated", () => {
    expect(neededProduct(["basic_monthly", "other"], lookup)).toBe(basic);
  });

  it("says nothing without the parameter, for an unknown key, and for a parked product", () => {
    expect(neededProduct(undefined, lookup)).toBeNull();
    expect(neededProduct("", lookup)).toBeNull();
    expect(neededProduct("no_such_plan", lookup)).toBeNull();
    expect(neededProduct("starter_tokens", lookup)).toBeNull();
  });

  it("🚨 never hands a sentence through — only a key the registry can answer", () => {
    // A URL carrying words is a URL anybody can hand somebody else. Anything
    // that is not a Product Key is not even looked up.
    let asked = 0;
    const counting = (key: string) => {
      asked += 1;
      return lookup(key);
    };
    expect(neededProduct("You have been hacked", counting)).toBeNull();
    expect(neededProduct("<b>x</b>", counting)).toBeNull();
    expect(asked).toBe(0);
  });
});
