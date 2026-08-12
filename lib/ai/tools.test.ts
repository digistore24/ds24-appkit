// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The registry's invariants — the ones that keep a tool from becoming a hole.
//
// None of this touches the database. It asserts the SHAPE of the tool list,
// which is what somebody changes when they add their own tools, and it is the
// reason a mistake there breaks the build instead of the customer's first call.
import { describe, expect, it } from "vitest";

import { TOOLS, findTool } from "./tools";
import { findProduct } from "@/lib/digistore/products";

describe("the tool registry", () => {
  it("has unique names", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("uses names a model can repeat exactly", () => {
    // Lower-case, no spaces. The chat keys its tool table on these.
    for (const tool of TOOLS) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]{1,63}$/);
    }
  });

  it("describes every tool well enough for a model to choose it", () => {
    // The single highest-leverage string in the file — a one-word description
    // is why a model never calls a tool that would have answered the question.
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(30);
    }
  });

  it("gives every tool a JSON-Schema object for its arguments", () => {
    for (const tool of TOOLS) {
      expect(tool.inputSchema.type).toBe("object");
      // `additionalProperties: false` is what stops a model inventing an
      // argument the handler then reads off `args` by accident.
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("never marks a tool that costs money as read-only", () => {
    // THE invariant of this file. `readOnly` is the security boundary a
    // read-only runner is measured against (lib/ai/run-tool.ts); a charging
    // tool wearing that flag is a read-only caller that can spend somebody's
    // balance.
    for (const tool of TOOLS) {
      if (tool.costTokens > 0) expect(tool.readOnly).toBe(false);
    }
  });

  it("prices every tool as a whole, non-negative number of tokens", () => {
    for (const tool of TOOLS) {
      expect(Number.isInteger(tool.costTokens)).toBe(true);
      expect(tool.costTokens).toBeGreaterThanOrEqual(0);
    }
  });

  it("gates only on plans that exist and can actually be held", () => {
    // A `requiresPlan` naming a deleted product would throw "unknown product
    // key" out of hasPlan() against a customer's first call — where the error
    // reaches a model, not a person. And a TOKEN package can never satisfy it:
    // a balance is not an entitlement, so hasPlan() answers false for one for
    // ever, locking out exactly the customers who paid.
    for (const tool of TOOLS) {
      if (!tool.requiresPlan) continue;
      const product = findProduct(tool.requiresPlan);
      expect(
        product,
        `tool "${tool.name}" gates on "${tool.requiresPlan}", which is not in config/digistore-products.json`,
      ).not.toBeNull();
      expect(
        product?.kind,
        `tool "${tool.name}" gates on the token package "${tool.requiresPlan}" — hasPlan() answers false for one for ever`,
      ).not.toBe("token");
    }
  });

  it("exposes no tool that acts on somebody other than the session's owner", () => {
    // Every argument is written by a model reading text somebody else may have
    // authored. A member/user/account id among them is an IDOR with a language
    // model holding the pen.
    const forbidden = ["memberid", "member_id", "userid", "user_id", "accountid", "account_id"];
    for (const tool of TOOLS) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
      for (const name of Object.keys(properties)) {
        expect(
          forbidden,
          `tool "${tool.name}" takes an argument called "${name}" — the account acted on must come from the session, never from the arguments`,
        ).not.toContain(name.toLowerCase());
      }
    }
  });

  it("finds a tool by name and nothing by a name it does not have", () => {
    expect(findTool(TOOLS[0].name)).toBe(TOOLS[0]);
    expect(findTool("does_not_exist")).toBeNull();
  });

  it("cannot be extended at runtime", () => {
    // The chat derives its tool definitions from this list once at module
    // load; the list staying fixed is what makes them byte-stable across
    // requests — the prompt-cache condition (lib/ai/chat-endpoint.ts).
    expect(Object.isFrozen(TOOLS)).toBe(true);
  });
});
