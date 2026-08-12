// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The rules `modules/companion/companion.ts` exists to make true, as assertions.
//
// ⚠️ **Two thirds of them are not here any more, and that is the point.** The
// cache boundary and "customer text is content" belong to the fence, the fence
// is `lib/ai/customer-text.ts`, and its assertions moved with it — a claim about
// a file that no longer decides anything is a claim nobody can act on. What is
// left is what this MODULE decides: that it fetches nothing on its own behalf,
// that the task id reaches the usage row, that a keyless call behaves exactly as
// `runTask` does, and the `ai-check` hint.
//
// The first of those is not something a unit test can see from the outside, so
// it is read off the file itself, in the shape `providers/leak-guard.test.ts`
// established.
import { describe, expect, it, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { askCompanion, type CompanionInput } from "./companion";
import { parseFocus } from "@/lib/ai/report";
import { rowFor, type UsageRecord } from "@/lib/ai/usage";

// ── Why the recording is stubbed ───────────────────────────────────────────
// The failure-path test below reaches the provider layer on purpose: with no
// key it fails there with `noCredential`, and `run.ts` records that — because a
// call that never reached a provider is exactly the row that answers "why is
// nothing working". That write goes to the real database.
//
// Outside a request there is no `after()`, so `recordUsage` falls back to a
// detached promise nobody awaits. On a machine with no database that surfaces
// as a wall of `ECONNREFUSED`, or does not, depending on whether the process
// outlives the connection attempt. On a machine where `node run.mjs start` IS
// running it does not surface at all — it quietly inserts a junk row into the
// developer's own `ai_usage`. Commit `4261477` is that lesson; this is the same
// stub, keeping the record rather than dropping it.
const recorded: UsageRecord[] = [];

vi.mock("@/lib/ai/usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/usage")>()),
  recordUsage: (record: UsageRecord) => void recorded.push(record),
}));

beforeEach(() => {
  recorded.length = 0;
});

const base: CompanionInput = {
  instruction: "You are a writing coach on a twelve-week course.",
  ask: "Name one thing that works and one thing to try next.",
};

const filled: CompanionInput = {
  ...base,
  about: [
    { label: "Day", value: "7" },
    { label: "Task", value: "A scene without dialogue" },
  ],
  work: [{ label: "Their scene", text: "The kitchen was still warm." }],
};

describe("the module cannot fetch on its own behalf", () => {
  // AC 5's "never a member id it resolves for itself" is a property of the FILE.
  // A property nobody can remember is one something has to read the tree for —
  // the same argument `providers/leak-guard.test.ts` makes.
  const source = readFileSync(fileURLToPath(new URL("./companion.ts", import.meta.url)), "utf8");
  const imports = [...source.matchAll(/^import[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);

  it("imports no database, no entitlement and no token module", () => {
    for (const path of imports) {
      expect(path, path).not.toMatch(/\bdb\b/);
      expect(path, path).not.toMatch(/entitlements/);
      expect(path, path).not.toMatch(/tokens/);
    }
  });

  it("imports only from inside the AI layer, and now only twice", () => {
    // Spelled `@/lib/ai/…` since this became a module: the AI layer stayed in
    // the core — the provider registry, the task router and the usage ledger
    // are shared with image generation — so what were sibling imports now reach
    // INTO the core. The claim is unchanged: every model call leaves through
    // `runTask`, and this file fetches nothing itself.
    //
    // The list got SHORTER when the fence moved into `lib/ai/customer-text.ts`:
    // the prompt types and `hasControlChar` are that file's business now, and
    // this one composes a task id out of what it hands back.
    expect(imports.sort()).toEqual([
      "@/lib/ai/customer-text",
      "@/lib/ai/run",
    ]);
  });
});

describe("the spend is the companion's own, and the report needs nothing new", () => {
  // `lib/ai/report.ts` groups on `sql`${aiUsage.task}`` and `ai_usage.task` is
  // `text`, not an enum — so a third task appears on the cost page by itself the
  // moment a row carries it. These two seams are what that rests on.
  it("writes the task onto the usage row unchanged", () => {
    const row = rowFor({
      task: "companion",
      provider: "anthropic",
      model: "claude-sonnet-5",
      outcome: "ok",
      latencyMs: 12,
      memberId: null,
      usage: null,
    });
    expect(row.task).toBe("companion");
  });

  it("can be focused on in the cost report like any other task", () => {
    expect(parseFocus({ task: "companion" })).toMatchObject({ task: "companion" });
  });
});

describe("a call with no key behaves exactly as runTask does", () => {
  it("rejects with noCredential and still leaves one record naming the model", async () => {
    await expect(askCompanion(filled)).rejects.toMatchObject({ code: "noCredential" });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ task: "companion", outcome: "noCredential" });
    expect(recorded[0].provider).toBeTruthy();
    expect(recorded[0].model).toBeTruthy();
  });
});

describe("ai-check's hint is a note and never a failure", () => {
  // No unit test of the predicate: `scripts/ai/check.mjs` has top-level side
  // effects and no harness, and lifting one comparison into its own module ahead
  // of Story 13.2's `companionConfigFrom()` would create the second source of
  // truth 13.2 then has to reconcile. So the shape is read off the file.
  const check = readFileSync(
    fileURLToPath(new URL("../../scripts/ai/check.mjs", import.meta.url)),
    "utf8",
  );

  it("keys on a SWITCH, not on a scan of the tree", () => {
    // ⚠️ This used to assert `check` contains "ai-companion.json", and that was
    // the assertion of a CORE file naming this module. It stopped being true the
    // right way: the hint now asks `DISCLOSURE_SURFACES`, where every surface —
    // this module's included — carries its own `configFile` and its own
    // `isOn()`. So the property survives the move and the coupling does not, and
    // an app without this module installed has no surface beyond `chat`, which
    // is exactly the state the hint describes.
    expect(check).toContain("DISCLOSURE_SURFACES");
    expect(check).toMatch(/surface\.isOn\(/);
    expect(check).toMatch(/surface\.configFile/);
    // A tree scan would answer "found" in every generated app for ever, because
    // Story 13.2 ships a companion call site inside the template itself.
    expect(check).not.toContain("call-sites");
  });

  it("pushes the hint onto notes and never onto problems", () => {
    // Anchored on the condition itself. Reading a WINDOW rather than the file is
    // what makes this say something: `problems.push` exists elsewhere in the
    // script legitimately, and a whole-file `not.toMatch` would either be
    // vacuous or wrong.
    const lines = check.split("\n");
    const hint = lines.map((line) => line.includes("!beyondSupport")).lastIndexOf(true);
    expect(hint, "the hint's condition is not in scripts/ai/check.mjs").toBeGreaterThanOrEqual(0);

    const region = lines.slice(hint, hint + 16).join("\n");
    expect(region).toMatch(/notes\.push/);
    expect(region).not.toMatch(/problems\.push/);
  });

  it("counts only surfaces BEYOND the support assistant", () => {
    // Without the exclusion the hint would go silent in every app that has the
    // assistant switched on — which is most of them, and the exact opposite of
    // what it is for.
    expect(check).toMatch(/surface\.id !== "chat"/);
  });
});
