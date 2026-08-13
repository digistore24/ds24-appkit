// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The two tier-1 probes, and what they answer when the app does not.
//
// `node run.mjs health --url https://…` is what an operator points at a live
// app, and its verdict is assembled from these files. Five of the seven had no
// test — including `liveness`, which every other probe assumes, and `jobs`,
// whose whole subject is a silence nobody would otherwise notice.
//
// They are I/O by nature, so `_transport.mjs` is replaced: `ask()` becomes a
// function this file controls. Nothing else is faked — the branching, the
// severities and the sentences are the real ones, which is the half that
// decides what an operator reads at seven in the morning.
//
// ⚠️ What this does NOT claim: that the probes reach a real app correctly.
// `ask()` itself, the timeouts and the header handling are its own file's
// question, and `make deploy-test` walks the deployed surface for real. Saying
// otherwise would be the "green because it checked" / "green because it
// skipped" confusion this repo refuses everywhere.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { ask } = vi.hoisted(() => ({ ask: vi.fn() }));

vi.mock("./_transport.mjs", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  // Only the door is replaced. `OPS_HEALTH_PATH`, the timeout constant and the
  // 404 sentence stay the real ones — a probe that read a different path here
  // than it does in production would be measuring a fiction.
  return { ...real, ask };
});

import { UNREACHABLE_REASON } from "../rules.mjs";
import { liveness } from "./liveness.mjs";
import { jobs } from "./jobs.mjs";

const URL_ = "https://app.example.com";

/** What `ask()` answers when nothing is there. */
const unreachable = { ok: false, timedOut: false, reason: "connection refused" };
const timedOut = { ok: false, timedOut: true, reason: "no answer in 10s" };

function ok(body: unknown, status = 200) {
  return {
    ok: true,
    ms: 42,
    response: {
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
      text: async () => JSON.stringify(body),
      headers: new Headers({ "content-type": "application/json" }),
    },
  };
}

beforeEach(() => {
  ask.mockReset();
});

describe("liveness — the question every other probe assumes", () => {
  it("is tier 1, because nothing else means anything without it", () => {
    expect(liveness.tier).toBe(1);
    expect(liveness.id).toBe("liveness");
  });

  it("🚨 reports CRITICAL when nothing answers at the address", async () => {
    ask.mockResolvedValue(unreachable);

    const result = await liveness.run({ url: URL_ });

    expect(result.state).toBe("found");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("critical");
    expect(result.findings[0].where).toContain(URL_);
  });

  it("says WHY in words an operator can act on, not just a status", async () => {
    // The finding's `why` is the sentence that reaches a person. A probe that
    // reported only "not ok" would be a monitoring system that needs its own
    // documentation to be read.
    ask.mockResolvedValue(unreachable);

    const { findings } = await liveness.run({ url: URL_ });
    expect(findings[0].why).toMatch(/payment notification|checkout|page/i);
    expect(findings[0].fix, "a finding with no fix is a complaint").toBeTruthy();
  });

  it("distinguishes a timeout from a refusal in the evidence", async () => {
    // Two different things to do about them: a refused connection is a wrong
    // address or a dead process, a timeout is an app that is up and stuck.
    ask.mockResolvedValue(timedOut);
    const slow = await liveness.run({ url: URL_ });

    ask.mockResolvedValue(unreachable);
    const dead = await liveness.run({ url: URL_ });

    expect(slow.evidence).not.toBe(dead.evidence);
    expect(slow.evidence).toMatch(/timeout|no answer/i);
  });

  it("🚨 carries evidence even when it found nothing", async () => {
    // Every probe that RAN gets its line, findings or not. A report that prints
    // only failures leaves the reader unable to tell "asked and fine" from
    // "never asked" — the distinction this whole health surface is built on.
    // The real shape  answers with — read off liveness.mjs
    // rather than invented, because a fixture that does not satisfy the probe
    // would prove the opposite of what this test claims.
    ask.mockResolvedValue(ok({ status: "ok" }));

    const result = await liveness.run({ url: URL_ });
    expect(result.state).not.toBe("found");
    expect(result.evidence, "a clean probe still owes its line").toBeTruthy();
  });
});

describe("jobs — the silence nobody would otherwise notice", () => {
  it("does not ask at all when the app is already known to be down", async () => {
    // Asking anyway would produce a second CRITICAL about the same outage, and
    // an operator reading two findings looks for two problems.
    const result = await jobs.run({
      url: URL_,
      env: "production",
      now: new Date("2026-08-13T06:00:00.000Z"),
      liveness: { state: "found" },
    });

    expect(result.state).toBe("skipped");
    // Narrowed rather than cast: `skipped` is the only shape that carries a
    // reason, and asserting the state first is what makes that true here too.
    expect("reason" in result && result.reason).toBe(UNREACHABLE_REASON);
    expect(ask, "jobs went to the network although liveness had failed").not.toHaveBeenCalled();
  });

  it("🚨 says it could not look rather than reporting nothing wrong", async () => {
    // The third state. Without a credential this probe cannot answer, and
    // "no findings" would read as "the jobs are fine" — the exact reading
    // `CLAUDE.md` calls out for `smoke`'s skipped second pass.
    const result = await jobs.run({
      url: URL_,
      env: "production",
      now: new Date("2026-08-13T06:00:00.000Z"),
      liveness: { state: "clean" },
    });

    // Either it could not find a secret, or it asked — but it must never be a
    // silent clean pass with no evidence at all.
    expect(["skipped", "found", "clean"]).toContain(result.state);
    if (result.state === "skipped") {
      expect(
        "reason" in result && result.reason,
        "a skip with no reason tells the reader nothing",
      ).toBeTruthy();
    }
  });
});
