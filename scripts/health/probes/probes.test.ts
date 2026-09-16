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
import { mail } from "./mail.mjs";
import { OPS_HEALTH_PATH } from "./_transport.mjs";

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

describe("mail — the question a test mail from a laptop cannot answer", () => {
  // The shared health request is handed over the way `readOpsHealth()` caches
  // it for one run: on `ctx.shared`. The credential is a real `--env prod` one,
  // so the probe's own credential branch runs.
  const CTX = { url: URL_, env: { DIAGNOSTICS_SECRET_PROD: "s" }, askedEnv: "prod", liveness: { state: "clean" } };
  const withBody = (mailState: unknown) => ({
    ...CTX,
    shared: new Map([
      [
        OPS_HEALTH_PATH,
        {
          ok: true,
          body: { media: { state: "ok" }, ipn: { state: "ok" }, ...(mailState === undefined ? {} : { mail: mailState }) },
        },
      ],
    ]),
  });
  const smtp = { host: "smtp.strato.de", port: 587, ms: 3001, probedAt: "2026-09-16T10:00:00.000Z", source: "boot" };
  /** Only a probe that RAN carries evidence; narrowed rather than cast. */
  const evidenceOf = (result: object) => ("evidence" in result ? String(result.evidence) : "");

  it("does not ask when the app is already known to be down", async () => {
    const result = await mail.run({ ...CTX, liveness: { state: "found" } });
    expect(result.state).toBe("skipped");
    expect("reason" in result && result.reason).toBe(UNREACHABLE_REASON);
  });

  it("says it could not look without the secret", async () => {
    const result = await mail.run({ ...CTX, env: {} });
    expect(result.state).toBe("skipped");
    expect("reason" in result && result.reason).toMatch(/DIAGNOSTICS_SECRET_PROD/);
  });

  it("skips, with a way forward, when the app's answer has no mail state yet", async () => {
    const result = await mail.run(withBody(undefined));
    expect(result.state).toBe("skipped");
    expect("reason" in result && result.reason).toMatch(/redeploy/);
    // No version floor in the sentence — nothing in the template names one.
    expect("reason" in result && result.reason).not.toMatch(/\d+\.\d+\.\d+/);
  });

  it("🚨 reports a blocked SMTP port as HIGH, naming the server and both ways out", async () => {
    const result = await mail.run(withBody({ state: "finding", transport: "smtp", code: "timeout", smtp }));
    expect(result.state).toBe("found");
    const [found] = "findings" in result ? result.findings : [];
    expect(found.severity).toBe("high");
    expect(found.evidence).toContain("smtp.strato.de:587");
    expect(found.evidence).toContain("at boot");
    expect(found.why).toMatch(/nobody can sign in/);
    for (const part of ["mail-setup", "Brevo", "Postmark", "Railway"]) expect(found.fix).toContain(part);
  });

  it("tells a refused port apart — that is usually the port, not the host", async () => {
    const result = await mail.run(withBody({ state: "finding", transport: "smtp", code: "refused", smtp }));
    const [found] = "findings" in result ? result.findings : [];
    expect(found.title).toMatch(/refuses/);
    expect(found.fix).toMatch(/SMTP_PORT/);
  });

  it("is clean with a line saying WHAT it knows, never that mail works", async () => {
    const https = await mail.run(withBody({ state: "ok", transport: "brevo", code: "httpsTransport", smtp: null }));
    expect(https.state).toBe("clean");
    expect(evidenceOf(https)).toMatch(/HTTPS via Brevo/);
    expect(evidenceOf(https)).toMatch(/test mail/);

    const reachable = await mail.run(
      withBody({ state: "ok", transport: "smtp", code: "reachable", smtp: { ...smtp, ms: 40, source: "request" } }),
    );
    expect(reachable.state).toBe("clean");
    expect(evidenceOf(reachable)).toContain("smtp.strato.de:587");
    expect(evidenceOf(reachable)).toMatch(/not a delivery/);

    const none = await mail.run(withBody({ state: "ok", transport: "none", code: "noTransport", smtp: null }));
    expect(evidenceOf(none)).toMatch(/development sign-in/);
  });

  it("skips when the app could not check its own transport", async () => {
    const result = await mail.run(withBody({ state: "unchecked", transport: "smtp", code: "probeFailed", smtp: null }));
    expect(result.state).toBe("skipped");
    expect("reason" in result && result.reason).toContain("probeFailed");
  });
});
