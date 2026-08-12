// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 What the off-state gate answers, and the one state it must NOT close.
//
// `proxy.ts` rewrites everything a gate answers `false` for into an unmatched
// path, so `false` here is not a refusal a page can soften — it is the whole
// module made unreachable, the operator's own diagnosis included. That is
// exactly right for the kill switch and exactly wrong for the broken state,
// and the gate used to answer `isCommunityEnabled()`, which cannot tell them
// apart (`enabled && no problems`).
//
// What that shipped: an operator with one mistyped key in
// `config/community.json` got `node run.mjs module list` reporting the switch
// as ON, every community page answering 404, and `/dashboard/community` — the
// page whose whole job is to name the bad key, and which `proxy.ts` and
// `docs/community.md` both promise stays reachable — rewritten away with the
// rest. No message anywhere named the typo.
//
// ⚠️ This file ships INSIDE the customer's app, so it asserts only against
// MOCKED config shapes. The customer's own `config/community.json` is theirs to
// fill in, and switching the community on is exactly what the `community` skill
// does — same rule as `lib/config.test.ts`, and the reason it is written there.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("the community's off-state gate", () => {
  beforeEach(() => {
    // Before each, not only after: `./gate` pulls in `./lib/config`, which has
    // already read the REAL JSON, and `vi.doMock` does not evict an importer
    // that is cached. Without this the first mocked case asserts against the
    // customer's own file (`lib/config.test.ts` carries the same note).
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock("@/config/community.json");
    vi.resetModules();
  });

  async function gateWith(config: Record<string, unknown>) {
    vi.doMock("@/config/community.json", () => ({ default: config }));
    return (await import("./gate")).default;
  }

  it('says "off" when the operator switched it off', async () => {
    // The kill switch, and the only state that earns the rewrite: every route
    // answers the document a route that never existed answers.
    const gate = await gateWith({ enabled: false });
    expect(gate.state()).toBe("off");
  });

  it('says "on" when the file is switched on and coherent', async () => {
    const gate = await gateWith({ enabled: true });
    expect(gate.state()).toBe("on");
  });

  it('🚨 says "broken", not "off", when the file is on but malformed', async () => {
    // The regression, and the state a boolean could not carry.
    vi.doMock("@/config/community.json", () => ({
      default: { enabled: true, threshhold: 5 },
    }));

    // The state, established rather than assumed: the reader calls it broken,
    // and `isCommunityEnabled()` — what the pages read, and what this gate used
    // to read — is false. The pages refusing on it is correct; the gate
    // reporting "off" on it is what rewrote the diagnosis page away.
    const cfg = await import("./lib/config");
    expect(cfg.communityOffReason()).toBe("brokenConfig");
    expect(cfg.isCommunityEnabled()).toBe(false);

    const gate = (await import("./gate")).default;
    expect(
      gate.state(),
      'a malformed-but-switched-on config must not report "off" — the proxy ' +
        "rewrites that state to an unmatched path, and proxy.ts and " +
        "docs/community.md both promise the operator's diagnosis page stays " +
        "reachable. This gate is the only thing that can break that promise.",
    ).toBe("broken");
  });

  it("names itself, so the rewrite target is this module's", async () => {
    const gate = await gateWith({ enabled: false });
    expect(gate.id).toBe("community");
  });
});
