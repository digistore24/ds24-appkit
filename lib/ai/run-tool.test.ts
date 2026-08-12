// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The executor's enforcement, pinned against FIXTURE tools.
//
// The shipped registry holds only the four content tools — all read-only,
// free and plan-less — so none of the refusal paths could be exercised
// through it. The fixtures below are the tool shapes an app may register
// later (a charging write tool, a plan-gated read); this file is what keeps
// the scope check, the plan gate and the TokenError mapping working for the
// day one arrives.
import { describe, it, expect, vi, beforeEach } from "vitest";

import { toolData, toolText } from "./tool-result";
import type { ChatTool } from "./tools";

vi.mock("@/lib/entitlements/manage", () => ({
  hasPlan: vi.fn(async () => false),
}));

const writeTool: ChatTool = {
  name: "fixture_write",
  description: "A metered write tool, as an app would register one for the chat.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  readOnly: false,
  requiresPlan: null,
  costTokens: 5,
  async run(_args, ctx) {
    const balanceLeft = await ctx.spend(5, "fixture: write");
    return toolData({ charged: 5, balanceLeft });
  },
};

const planTool: ChatTool = {
  name: "fixture_plan_gated",
  description: "A read tool that belongs to one plan, as an app would gate one.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  readOnly: true,
  requiresPlan: "basis_monatlich",
  costTokens: 0,
  async run() {
    return toolText("gated content");
  },
};

const openReadTool: ChatTool = {
  name: "fixture_open_read",
  description: "An open read tool whose handler tolerates empty arguments.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  readOnly: true,
  requiresPlan: null,
  costTokens: 0,
  async run(args) {
    return toolData({ gotArgs: args });
  },
};

/** Reports back exactly what its context handed it — the link seam's proof. */
const linkingTool: ChatTool = {
  name: "fixture_linking",
  description: "A read tool that offers a page, as the content tools do.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  readOnly: true,
  requiresPlan: null,
  costTokens: 0,
  async run(_args, ctx) {
    return toolData({ link: ctx.offerLink("/dashboard/kurs/x", "uebung-2", "Lektion 3") });
  },
};

/** Plan-gated AND linking: proves a refusal offers nothing. */
const gatedLinkingTool: ChatTool = {
  ...linkingTool,
  name: "fixture_gated_linking",
  requiresPlan: "basis_monatlich",
};

const FIXTURES = [writeTool, planTool, openReadTool, linkingTool, gatedLinkingTool];

vi.mock("./tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tools")>();
  return {
    ...actual,
    findTool: (name: string) => FIXTURES.find((tool) => tool.name === name) ?? null,
  };
});

import { hasPlan } from "@/lib/entitlements/manage";

import { runTool, type ToolRunner } from "./run-tool";

function runner(overrides: Partial<ToolRunner> = {}): ToolRunner {
  return {
    memberId: "member-1",
    scope: "write",
    spend: vi.fn(async () => 42),
    offerLink: vi.fn(() => null),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(hasPlan).mockReset();
  vi.mocked(hasPlan).mockResolvedValue(false);
});

describe("runTool", () => {
  it("answers unknownTool for a name outside the registry", async () => {
    const outcome = await runTool("no_such_tool", {}, runner());
    expect(outcome.kind).toBe("unknownTool");
  });

  it("refuses a write tool on a read-only runner — as a RESULT, not a throw", async () => {
    const outcome = await runTool(writeTool.name, {}, runner({ scope: "read" }));
    if (outcome.kind !== "result") throw new Error("expected a result");
    expect(outcome.result.isError).toBe(true);
    expect(outcome.result.content[0].text).toContain("read-only");
  });

  it("refuses a plan-gated tool the member does not hold", async () => {
    const outcome = await runTool(planTool.name, {}, runner());
    if (outcome.kind !== "result") throw new Error("expected a result");
    expect(outcome.result.isError).toBe(true);
    expect(vi.mocked(hasPlan)).toHaveBeenCalledWith("member-1", planTool.requiresPlan);
  });

  it("runs a plan-gated tool for a member who holds the plan", async () => {
    vi.mocked(hasPlan).mockResolvedValue(true);
    const outcome = await runTool(planTool.name, {}, runner());
    if (outcome.kind !== "result") throw new Error("expected a result");
    expect(outcome.result.isError).not.toBe(true);
    expect(outcome.result.content[0].text).toBe("gated content");
  });

  it("normalizes non-object arguments to an empty object", async () => {
    // A string, an array and undefined must all reach the handler as {}.
    for (const bad of ["not-an-object", ["array"], undefined]) {
      const outcome = await runTool(openReadTool.name, bad, runner());
      if (outcome.kind !== "result") throw new Error("expected a result");
      expect(JSON.parse(outcome.result.content[0].text)).toEqual({ gotArgs: {} });
    }
  });

  it("hands the runner's offerLink closure to the tool context", async () => {
    // Bound exactly as `spend` is: the ledger belongs to ONE request, and a
    // tool must have no way to name another one.
    const offerLink = vi.fn(() => "[link:/dashboard/kurs/x#uebung-2|Lektion 3]");
    const outcome = await runTool(linkingTool.name, {}, runner({ offerLink }));
    if (outcome.kind !== "result") throw new Error("expected a result");
    expect(offerLink).toHaveBeenCalledWith("/dashboard/kurs/x", "uebung-2", "Lektion 3");
    expect(JSON.parse(outcome.result.content[0].text)).toEqual({
      link: "[link:/dashboard/kurs/x#uebung-2|Lektion 3]",
    });
  });

  it("offers no link when the plan gate refused the tool", async () => {
    // The refusal is BEFORE the handler, so nothing was offered — a member
    // who may not read the content must not learn from the answer that it
    // exists.
    const offerLink = vi.fn(() => "[link:/dashboard/kurs/x#uebung-2|Lektion 3]");
    const outcome = await runTool(gatedLinkingTool.name, {}, runner({ offerLink }));
    if (outcome.kind !== "result") throw new Error("expected a result");
    expect(outcome.result.isError).toBe(true);
    expect(offerLink).not.toHaveBeenCalled();
  });

  it("hands the runner's spend closure to the tool context", async () => {
    // The spy proves the closure the surface bound — `spendTokens` for the
    // chat — is the one the tool receives.
    const spend = vi.fn(async () => 95);
    const outcome = await runTool(writeTool.name, {}, runner({ spend }));
    if (outcome.kind !== "result") throw new Error("expected a result");
    expect(outcome.result.isError).not.toBe(true);
    expect(spend).toHaveBeenCalledWith(5, "fixture: write");
  });

  it("maps a TokenError out of the tool into an isError result", async () => {
    const { TokenError } = await import("@/lib/tokens/rules");
    const spend = vi.fn(async () => {
      throw new TokenError("insufficientBalance");
    });
    const outcome = await runTool(writeTool.name, {}, runner({ spend }));
    if (outcome.kind !== "result") throw new Error("expected a result");
    expect(outcome.result.isError).toBe(true);
    expect(outcome.result.content[0].text).toContain("tokens");
  });

  it("rethrows anything that is not a TokenError", async () => {
    const spend = vi.fn(async () => {
      throw new Error("database on fire");
    });
    await expect(runTool(writeTool.name, {}, runner({ spend }))).rejects.toThrow(
      "database on fire",
    );
  });
});
