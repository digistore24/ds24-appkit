// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// ⚠️ This file ships INSIDE the customer's app and runs on every
// `node run.mjs test` — so it may only assert what stays true after the
// customer legitimately configures the feature. "The community is off" is NOT
// such a claim: switching it on is exactly what the community skill does. The
// shipped-off state is a FACTORY invariant, proven where the factory gates
// run — the deploy test's smoke pass asserts a real boot answers 404 on
// /dashboard/community. (The API config learned this from a field-test
// session that had to rewrite its test after enabling the API; same rule
// here, from the start.)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_COMMUNITY_CONFIG, communityConfigProblems } from "./config";

describe("config/community.json", () => {
  it("is coherent — with the customer's own values as much as the shipped ones", () => {
    expect(communityConfigProblems()).toEqual([]);
  });

  it("declares OFF as the default, so every fallback points closed", () => {
    // Named for what it actually asserts. It used to say "falls back to OFF
    // when the file is unreadable", which overstated it: `communityConfig()`
    // computes `enabled: file.enabled === true` directly and never consults
    // this constant as a fallback — the constant's real job is to be the
    // allow-list of known keys, plus the written-down statement that the
    // closed direction is the intended one. The unreadable-file behaviour is
    // genuinely covered, by the mocked shapes below.
    expect(DEFAULT_COMMUNITY_CONFIG.enabled).toBe(false);
  });
});

// The mocked shapes: what the reader does with files this repo never ships.
// `vi.doMock` + dynamic import, as `lib/media/config.test.ts` does.
describe("the reader, against malformed files", () => {
  beforeEach(() => {
    // BEFORE each test, not only after: the static import at the top of this
    // file has already loaded `./config` with the real JSON, and `vi.doMock`
    // does not evict an importer that is already cached — without this reset
    // the first mocked test silently asserts against the CUSTOMER'S real
    // config (`lib/media/config.test.ts`, the cited model, resets first too).
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock("@/config/community.json");
    vi.resetModules();
  });

  async function load() {
    return import("./config");
  }

  it("a disabled file is off with disabledInConfig", async () => {
    vi.doMock("@/config/community.json", () => ({ default: { enabled: false } }));
    const cfg = await load();
    expect(cfg.isCommunityEnabled()).toBe(false);
    expect(cfg.communityOffReason()).toBe("disabledInConfig");
    expect(cfg.communityConfigProblems()).toEqual([]);
  });

  it("an enabled, coherent file is on", async () => {
    vi.doMock("@/config/community.json", () => ({ default: { enabled: true } }));
    const cfg = await load();
    expect(cfg.isCommunityEnabled()).toBe(true);
    expect(cfg.communityOffReason()).toBeNull();
  });

  it('a string "true" is OFF — fail-closed, and the lint is on the record', async () => {
    // The exact shape the impersonation switch was measured against:
    // "enabled": "true" (a string) must not open the surface. The reason is
    // `disabledInConfig` — coercion reads the mistyped value as "not switched
    // on", and disabled wins the reason ordering by decision (AC 1). The lint
    // itself is not lost: it sits in `communityConfigProblems()`, and the
    // coherence test above turns it into a build failure on the customer's
    // own machine — a louder diagnosis than any page could render.
    vi.doMock("@/config/community.json", () => ({ default: { enabled: "true" } }));
    const cfg = await load();
    expect(cfg.isCommunityEnabled()).toBe(false);
    expect(cfg.communityConfigProblems()).not.toEqual([]);
    expect(cfg.communityOffReason()).toBe("disabledInConfig");
  });

  it("an empty file is off — disabled, not broken", async () => {
    // No `enabled` at all reads as "not switched on", which is a state the
    // operator chose by never touching the file — not a lint.
    vi.doMock("@/config/community.json", () => ({ default: {} }));
    const cfg = await load();
    expect(cfg.isCommunityEnabled()).toBe(false);
    expect(cfg.communityOffReason()).toBe("disabledInConfig");
    expect(cfg.communityConfigProblems()).toEqual([]);
  });

  it("an unknown field beside enabled:true is BROKEN — off, and the field is named", async () => {
    // The brokenConfig state: switched on, but the file carries something the
    // reader does not understand. Off (fail-closed), and the diagnosis page
    // gets a list naming the field — this is the one path that renders it.
    vi.doMock("@/config/community.json", () => ({
      default: { enabled: true, threshhold: 5 },
    }));
    const cfg = await load();
    expect(cfg.isCommunityEnabled()).toBe(false);
    expect(cfg.communityOffReason()).toBe("brokenConfig");
    expect(cfg.communityConfigProblems().join("\n")).toMatch(/threshhold/);
  });

  it('a typo\'d switch — {"enable": true} — stays off, and the typo is on the record', async () => {
    // The operator MEANT to switch on and did not: `enabled` is absent, so
    // "disabled" wins the reason ordering — but the unknown field is named in
    // the problems list, and the coherence test above turns it into a build
    // failure on their machine rather than a community that is silently off.
    vi.doMock("@/config/community.json", () => ({ default: { enable: true } }));
    const cfg = await load();
    expect(cfg.isCommunityEnabled()).toBe(false);
    expect(cfg.communityOffReason()).toBe("disabledInConfig");
    expect(cfg.communityConfigProblems().join("\n")).toMatch(/enable/);
  });

  it("a `_comment` is documentation, not an unknown field", async () => {
    // The house convention: six of the shipped config files carry a `_comment`
    // and `lib/media/config.ts` skips underscored keys explicitly. Before this
    // was mirrored here, an operator who documented their own switch the way
    // `media.json` shows got a community that was silently OFF *and* a red
    // `node run.mjs test` on a file they had filled in correctly.
    vi.doMock("@/config/community.json", () => ({
      default: { _comment: "our members meet here", enabled: true },
    }));
    const cfg = await load();
    expect(cfg.communityConfigProblems()).toEqual([]);
    expect(cfg.isCommunityEnabled()).toBe(true);
  });

  it("an unknown field named after an Object.prototype member is still named", async () => {
    // `key in DEFAULT_COMMUNITY_CONFIG` walked the prototype chain, so every
    // one of these was silently accepted and the community ran ON carrying a
    // field nothing reads. `Object.hasOwn` is the fix; this is the proof.
    for (const key of ["toString", "constructor", "valueOf", "hasOwnProperty"]) {
      vi.resetModules();
      vi.doMock("@/config/community.json", () => ({
        default: { enabled: true, [key]: 1 },
      }));
      const cfg = await load();
      expect(cfg.communityConfigProblems().join("\n"), key).toMatch(key);
      expect(cfg.isCommunityEnabled(), key).toBe(false);
      expect(cfg.communityOffReason(), key).toBe("brokenConfig");
      vi.doUnmock("@/config/community.json");
    }
  });

  it("a file that is not a JSON object at all is off, and says so", async () => {
    // `null`, `[]` and `"x"` are all valid JSON documents. `raw.enabled` on the
    // first of them threw — inside `proxy.ts`, which runs in front of every
    // matched request, so "fail toward off" became "500 on every page" in dev
    // (a prod build refuses most of these at typecheck; `next dev` does not
    // typecheck). The array is the quiet one: it has no `enabled` and no keys,
    // so before this guard it resolved to off with an EMPTY problems list — a
    // diagnosis page reporting that nothing is wrong about a community that is
    // not running.
    for (const shape of [null, [], "x", 42] as const) {
      vi.resetModules();
      vi.doMock("@/config/community.json", () => ({ default: shape }));
      const cfg = await load();
      expect(() => cfg.isCommunityEnabled()).not.toThrow();
      expect(cfg.isCommunityEnabled(), String(shape)).toBe(false);
      expect(cfg.communityConfigProblems().length, String(shape)).toBeGreaterThan(0);
      vi.doUnmock("@/config/community.json");
    }
  });
  it("takes the posting brake's default when the block is absent", async () => {
    // Every app generated before this block exists has no `posting` key. That
    // must be a clean fallback, not a problem — an update to the guidance does
    // not rewrite a customer's config, so "absent" is the shipped state of
    // most installations for a while.
    vi.resetModules();
    vi.doMock("@/config/community.json", () => ({ default: { enabled: true } }));
    const cfg = await load();
    expect(cfg.communityConfigProblems()).toEqual([]);
    expect(cfg.isCommunityEnabled()).toBe(true);
    expect(cfg.communityConfig().posting.maxPer10Min).toBe(
      DEFAULT_COMMUNITY_CONFIG.posting.maxPer10Min,
    );
    vi.doUnmock("@/config/community.json");
  });

  it("names a posting brake that was written and is not read", async () => {
    // The whole point of reporting rather than clamping: an operator who
    // believes they relaxed the limit and did not would have no way to find
    // out. Each of these switches the community OFF and says why — the
    // direction this module chose in its first story, because the failure mode
    // of this file is disclosure.
    for (const posting of [
      { maxPer10Min: 0 },
      { maxPer10Min: 1001 },
      { maxPer10Min: 2.5 },
      { maxPer10Min: "20" },
      { maxPerTenMinutes: 20 },
    ]) {
      vi.resetModules();
      vi.doMock("@/config/community.json", () => ({
        default: { enabled: true, posting },
      }));
      const cfg = await load();
      const label = JSON.stringify(posting);
      expect(cfg.communityConfigProblems().length, label).toBeGreaterThan(0);
      expect(cfg.isCommunityEnabled(), label).toBe(false);
      // And the value the app would use is still the safe default, never the
      // nonsense — the brake is never off because the config is wrong.
      expect(cfg.communityConfig().posting.maxPer10Min, label).toBe(
        DEFAULT_COMMUNITY_CONFIG.posting.maxPer10Min,
      );
      vi.doUnmock("@/config/community.json");
    }
  });

  it("accepts a posting block the operator legitimately tuned", async () => {
    vi.resetModules();
    vi.doMock("@/config/community.json", () => ({
      default: { enabled: true, posting: { maxPer10Min: 5 } },
    }));
    const cfg = await load();
    expect(cfg.communityConfigProblems()).toEqual([]);
    expect(cfg.communityConfig().posting.maxPer10Min).toBe(5);
    vi.doUnmock("@/config/community.json");
  });

  it("refuses a posting block that is not an object", async () => {
    for (const posting of [null, [], 20, "20"] as const) {
      vi.resetModules();
      vi.doMock("@/config/community.json", () => ({
        default: { enabled: true, posting },
      }));
      const cfg = await load();
      expect(cfg.communityConfigProblems().length, String(posting)).toBeGreaterThan(0);
      expect(cfg.isCommunityEnabled(), String(posting)).toBe(false);
      vi.doUnmock("@/config/community.json");
    }
  });
});

// ── The live intervals ─────────────────────────────────────────────────────
// AD-61's two numbers, and the three ways an operator can get them wrong. All
// three resolve toward the shipped defaults and toward a LOOSER loop — never a
// tighter one, which is the direction that would cost a host money.
describe("the live intervals", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock("@/config/community.json");
    vi.resetModules();
  });

  async function withLive(live: unknown) {
    vi.doMock("@/config/community.json", () => ({
      default: { enabled: true, live },
    }));
    return import("./config");
  }

  it("ships five seconds visible and thirty hidden", async () => {
    const cfg = await import("./config");
    expect(cfg.DEFAULT_COMMUNITY_CONFIG.live).toEqual({
      visibleSeconds: 5,
      hiddenSeconds: 30,
    });
    // The shipped file itself, not only the constant — a default nobody wrote
    // into the JSON is a default the customer never sees.
    expect(cfg.communityConfig().live).toEqual({
      visibleSeconds: 5,
      hiddenSeconds: 30,
    });
    expect(cfg.livePollSchedule()).toEqual({ visibleMs: 5_000, hiddenMs: 30_000 });
  });

  it("takes an app that predates the block without complaint", async () => {
    const cfg = await withLive(undefined);
    expect(cfg.communityConfigProblems()).toEqual([]);
    expect(cfg.communityConfig().live).toEqual({
      visibleSeconds: 5,
      hiddenSeconds: 30,
    });
  });

  it("honours values inside the bounds", async () => {
    const cfg = await withLive({ visibleSeconds: 8, hiddenSeconds: 120 });
    expect(cfg.communityConfigProblems()).toEqual([]);
    expect(cfg.livePollSchedule()).toEqual({ visibleMs: 8_000, hiddenMs: 120_000 });
  });

  it("refuses a visible interval past NFR-38's ten seconds", async () => {
    const cfg = await withLive({ visibleSeconds: 60 });
    expect(cfg.communityConfigProblems().join(" ")).toContain("live.visibleSeconds");
    expect(cfg.isCommunityEnabled()).toBe(false);
    // And the VALUE still falls back rather than being honoured half-way.
    expect(cfg.communityConfig().live.visibleSeconds).toBe(5);
  });

  it("refuses a sub-second loop, which is what a fraction here would be", async () => {
    const cfg = await withLive({ visibleSeconds: 0 });
    expect(cfg.communityConfigProblems().join(" ")).toContain("live.visibleSeconds");
    expect(cfg.communityConfig().live.visibleSeconds).toBe(5);
  });

  it("never resolves toward a TIGHTER loop when hidden is below visible", async () => {
    // The inversion of SM-16, written by hand. The reader raises the hidden
    // interval to the visible one rather than obeying it, AND says so.
    const cfg = await withLive({ visibleSeconds: 8, hiddenSeconds: 2 });
    expect(cfg.communityConfig().live).toEqual({
      visibleSeconds: 8,
      hiddenSeconds: 8,
    });
    expect(cfg.communityConfigProblems().join(" ")).toContain("hiddenSeconds");
  });

  it("names a misspelled key rather than running on a value nobody reads", async () => {
    const cfg = await withLive({ visibleSecond: 5 });
    expect(cfg.communityConfigProblems().join(" ")).toContain('unknown field "live.visibleSecond"');
    expect(cfg.isCommunityEnabled()).toBe(false);
  });

  it("takes an underscored comment inside the block", async () => {
    const cfg = await withLive({ _note: "why we slowed it down", visibleSeconds: 9 });
    expect(cfg.communityConfigProblems()).toEqual([]);
  });

  it("reports a live block that is not an object at all", async () => {
    for (const shape of [null, [], "5s", 5]) {
      vi.resetModules();
      const cfg = await withLive(shape);
      expect(cfg.communityConfigProblems().join(" "), JSON.stringify(shape)).toContain(
        '"live" must be an object',
      );
      vi.doUnmock("@/config/community.json");
    }
  });
});

// ── OQ-3: the DM retention window ──────────────────────────────────────────
//
// The one field in this file where falling back means KEEPING data. Every
// other bound resolves toward a shipped default that is merely conservative;
// this one resolves toward zero, which is OFF, which is "delete nothing". The
// inversion is the whole reason these tests exist: a reader that copied
// `configuredNumber()`'s direction — where zero means "delete everything" —
// would wipe a table on a typo.

describe("dmRetentionMonths", () => {
  it("ships as 0, which means keep until the account goes", async () => {
    const cfg = await import("./config");
    expect(cfg.DEFAULT_COMMUNITY_CONFIG.dmRetentionMonths).toBe(0);
    expect(cfg.communityConfig().dmRetentionMonths).toBe(0);
  });

  it("accepts a window an operator legitimately set", async () => {
    vi.resetModules();
    vi.doMock("@/config/community.json", () => ({
      default: { enabled: true, dmRetentionMonths: 24 },
    }));
    const cfg = await import("./config");
    expect(cfg.communityConfig().dmRetentionMonths).toBe(24);
    expect(cfg.communityConfigProblems()).toEqual([]);
  });

  it("falls back to OFF on anything it cannot read", async () => {
    // ⚠️ Each of these would DELETE if the fallback went the other way. `0.1`
    // is the fat-finger that matters most: three days of retention, typed by
    // somebody who meant "off".
    for (const value of [0.1, -1, 1000, "12", null, true, NaN]) {
      vi.resetModules();
      vi.doMock("@/config/community.json", () => ({
        default: { enabled: true, dmRetentionMonths: value },
      }));
      const cfg = await import("./config");
      expect(cfg.communityConfig().dmRetentionMonths, String(value)).toBe(0);
    }
  });

  it("names a window that was written and is not read", async () => {
    // Reporting switches the module off until the next deploy — harsh, and
    // right: an operator who believes they set a three-month window and did
    // not is holding data they told their customers they would delete.
    for (const value of [0.1, -1, 1000, "12"]) {
      vi.resetModules();
      vi.doMock("@/config/community.json", () => ({
        default: { enabled: true, dmRetentionMonths: value },
      }));
      const cfg = await import("./config");
      expect(cfg.communityConfigProblems().length, String(value)).toBeGreaterThan(0);
      expect(cfg.isCommunityEnabled(), String(value)).toBe(false);
    }
  });

  it("is absent from an app that predates it, without complaint", async () => {
    vi.resetModules();
    vi.doMock("@/config/community.json", () => ({ default: { enabled: true } }));
    const cfg = await import("./config");
    expect(cfg.communityConfig().dmRetentionMonths).toBe(0);
    expect(cfg.communityConfigProblems()).toEqual([]);
  });
});

describe("posting.imagesMax", () => {
  it("ships at three and is bounded at ten", async () => {
    const cfg = await import("./config");
    expect(cfg.DEFAULT_COMMUNITY_CONFIG.posting.imagesMax).toBe(3);
  });

  it("falls back to the shipped three on anything unreadable", async () => {
    // ⚠️ Never towards "as many as you like". Every picture is bytes in the
    // operator's bucket and a rendering cost on every reader's phone, so a value
    // this file cannot read resolves to the SMALLER post — the same direction
    // `report.attachmentMax` falls in, for a different reason.
    //
    // 🚨 **`0` is deliberately NOT in this list**, and its absence is the point:
    // zero is a legitimate value here (see the case below), so a test that lumped
    // it in with the nonsense would pin the opposite of the intended behaviour.
    // `-1` is what stands in for "below the floor".
    for (const value of [-1, 11, 2.5, "3", null]) {
      vi.resetModules();
      vi.doMock("@/config/community.json", () => ({
        default: { enabled: true, posting: { imagesMax: value } },
      }));
      const cfg = await import("./config");
      expect(cfg.communityConfig().posting.imagesMax, String(value)).toBe(3);
      // …and it is reported, so the operator is not left believing they raised a
      // ceiling they did not. Reporting switches the module OFF until the next
      // deploy, which is this file's ruling for every field in it.
      expect(cfg.communityConfigProblems().length, String(value)).toBeGreaterThan(0);
    }
  });

  it("takes a ceiling an operator legitimately tuned", async () => {
    vi.resetModules();
    vi.doMock("@/config/community.json", () => ({
      default: { enabled: true, posting: { maxPer10Min: 20, imagesMax: 6 } },
    }));
    const cfg = await import("./config");
    expect(cfg.communityConfig().posting.imagesMax).toBe(6);
    expect(cfg.communityConfigProblems()).toEqual([]);
  });

  it("🚨 zero is a real value — a community that does not take pictures", async () => {
    // The one number in this block that must NOT fall back. An operator who does
    // not want member-uploaded pictures in their rooms needs a way to say so that
    // is not "switch the whole community off": every picture is a file they store
    // and may have to moderate. `count()` refuses zero, which is why this field
    // has its own coercer — and why a test that only checked the fallbacks would
    // have left that coercer free to be "simplified" back into `count()`.
    vi.resetModules();
    vi.doMock("@/config/community.json", () => ({
      default: { enabled: true, posting: { imagesMax: 0 } },
    }));
    const cfg = await import("./config");
    expect(cfg.communityConfig().posting.imagesMax).toBe(0);
    // Zero is not a lint: the community stays ON, and the composer simply offers
    // no picture field.
    expect(cfg.communityConfigProblems()).toEqual([]);
    expect(cfg.isCommunityEnabled()).toBe(true);
  });

  it("is absent from an app that predates it, without complaint", async () => {
    // An app that ran a community before 26.2 has `posting: { maxPer10Min: 20 }`
    // and no `imagesMax` at all. That must be the default and NOT a problem — a
    // silent outage on the next `node run.mjs update` is exactly what this file's
    // fail-closed ruling would otherwise produce for every existing installation.
    vi.resetModules();
    vi.doMock("@/config/community.json", () => ({
      default: { enabled: true, posting: { maxPer10Min: 20 } },
    }));
    const cfg = await import("./config");
    expect(cfg.communityConfig().posting.imagesMax).toBe(3);
    expect(cfg.communityConfigProblems()).toEqual([]);
  });
});

describe("report.attachmentMax", () => {
  it("ships at five and is bounded at ten", async () => {
    const cfg = await import("./config");
    expect(cfg.DEFAULT_COMMUNITY_CONFIG.report.attachmentMax).toBe(5);
  });

  it("falls back to the shipped five on anything unreadable", async () => {
    // ⚠️ Never towards "unlimited". This number is how much of somebody's
    // private conversation a moderator may be shown, so every doubt about it
    // resolves to the NARROWER window.
    for (const value of [0, -1, 11, 2.5, "5", null]) {
      vi.resetModules();
      vi.doMock("@/config/community.json", () => ({
        default: { enabled: true, report: { attachmentMax: value } },
      }));
      const cfg = await import("./config");
      expect(cfg.communityConfig().report.attachmentMax, String(value)).toBe(5);
      // …and it is reported, so the operator is not left believing they
      // widened (or narrowed) a window they did not.
      expect(cfg.communityConfigProblems().length, String(value)).toBeGreaterThan(0);
    }
  });

  it("accepts a window an operator legitimately tuned", async () => {
    vi.resetModules();
    vi.doMock("@/config/community.json", () => ({
      default: { enabled: true, report: { attachmentMax: 3 } },
    }));
    const cfg = await import("./config");
    expect(cfg.communityConfig().report.attachmentMax).toBe(3);
    expect(cfg.communityConfigProblems()).toEqual([]);
  });
});
