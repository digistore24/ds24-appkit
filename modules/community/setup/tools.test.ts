// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The community's setup tools, and the one property nothing measured:
// **an upsert PATCHES; it does not overwrite what the caller left out.**
//
// `accessLevel` is optional and its schema carries `default: "open"`, so a
// second call that only corrects the NAME arrived with `accessLevel: "open"`
// and `description: undefined` — and `updateGroup()` wrote both
// unconditionally. A room the agent had created as `plan` was therefore opened
// to every member, and its description deleted, by a call meant to fix a typo.
// `checkedGroup()` then discards `planKeys` as well, because those only survive
// while the level is `plan`. That is access somebody paid for.
//
// ⚠️ **The gate that exists could not see it.** `scripts/deploy-two-act.mjs`
// drives this tool four times, but as plan → apply → replay of the spent token
// → apply without a token: that is the confirmation protocol, not idempotency.
// AC 40.4 asks for "the second run reports found" and AC 41.3 for "idempotency
// measured rather than asserted" — and the same call twice can never see this,
// because the defect needs a second call with DIFFERENT arguments.
import { beforeEach, describe, expect, it, vi } from "vitest";

const listGroups = vi.fn();
const updateGroup = vi.fn();
const createGroup = vi.fn();

vi.mock("../lib/groups", () => ({
  listGroups: (...args: unknown[]) => listGroups(...args),
  updateGroup: (...args: unknown[]) => updateGroup(...args),
  createGroup: (...args: unknown[]) => createGroup(...args),
}));

const { default: tools } = await import("./tools");

const upsert = tools.TOOLS.find((tool) => tool.name === "community_group_upsert")!;

const room = (over: Record<string, unknown> = {}) => ({
  id: "grp-1",
  name: "Einsteiger",
  description: "Für alle, die anfangen",
  accessLevel: "plan",
  planKeys: ["basis_monatlich"],
  archivedAt: null,
  ...over,
});

const context = { appEnv: "development" as const, ownerId: "u1", mode: "apply" as const };

beforeEach(() => {
  listGroups.mockReset();
  updateGroup.mockReset();
  createGroup.mockReset();
  updateGroup.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
    ...room(),
    ...patch,
    archivedAt: null,
  }));
  createGroup.mockImplementation(async (patch: Record<string, unknown>) => ({
    ...room(),
    ...patch,
    id: "grp-new",
    archivedAt: null,
  }));
});

describe("🚨 community_group_upsert does not downgrade what it was not asked about", () => {
  it("keeps a plan-gated room gated when the second call names only the name", async () => {
    listGroups.mockResolvedValue([room()]);

    await upsert.run(context, { name: "Einsteiger" });

    expect(updateGroup).toHaveBeenCalledTimes(1);
    const [, patch] = updateGroup.mock.calls[0];
    expect(patch.accessLevel, "a paid room was opened to every member").toBe("plan");
    expect(patch.planKeys, "the keys that gate it were dropped").toEqual(["basis_monatlich"]);
    expect(patch.description, "the description was deleted").toBe("Für alle, die anfangen");
  });

  it("still CHANGES what the caller really sent — including to a weaker level", async () => {
    // The counter-proof. Without it the assertion above passes against a tool
    // that ignores its input entirely, which reads as caution and is a tool
    // nobody can use.
    listGroups.mockResolvedValue([room()]);

    await upsert.run(context, { name: "Einsteiger", accessLevel: "open", description: "" });

    const [, patch] = updateGroup.mock.calls[0];
    expect(patch.accessLevel).toBe("open");
    expect(patch.description).toBe("");
  });

  it("an absent value is not an empty one", async () => {
    // `undefined` means "leave it"; `""` and `[]` mean "clear it". A falsy test
    // would collapse the two and make the rule above unusable.
    listGroups.mockResolvedValue([room()]);

    await upsert.run(context, { name: "Einsteiger", planKeys: [] });

    const [, patch] = updateGroup.mock.calls[0];
    expect(patch.planKeys).toEqual([]);
  });

  it("a NEW room with no level named is open — the schema default still stands", async () => {
    listGroups.mockResolvedValue([]);

    await upsert.run(context, { name: "Neuer Raum" });

    expect(createGroup).toHaveBeenCalledTimes(1);
    const [patch] = createGroup.mock.calls[0];
    expect(patch.accessLevel).toBe("open");
  });

  it("says when the room it landed on is ARCHIVED — in both modes", async () => {
    // `listGroups()` returns archived rooms on purpose, so an upsert can land on
    // one. The answer used to say `updated` with nothing to tell the agent why
    // no member can see it.
    listGroups.mockResolvedValue([room({ archivedAt: new Date("2026-08-01") })]);
    updateGroup.mockResolvedValue({ ...room(), archivedAt: new Date("2026-08-01") });

    const planned = await upsert.run({ ...context, mode: "plan" }, { name: "Einsteiger" });
    expect(planned.detail).toContain("ARCHIVED");

    const applied = await upsert.run(context, { name: "Einsteiger" });
    expect(applied.detail).toContain("ARCHIVED");
    expect((applied.data as { archived: boolean }).archived).toBe(true);
  });
});
