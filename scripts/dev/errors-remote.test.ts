// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The exit-code contract, which is the single most important behaviour in
// this command.
//
//   0  nothing found — and the line always names the WINDOW it looked at
//   1  findings
//   2  could not look
//
// "Green because it checked" and "green because it skipped" are the same
// colour, and a `✓` on a 404 or a timeout is how a deployed app gets reported
// as healthy by a command that never reached it. So every refusal path is
// asserted twice: for the exit code, and for the ABSENCE of a tick.
//
// And the credential resolver is pure so that the refusal can be tested rather
// than hoped for — the shape `smokeCredentials()` established. A secret
// provisioned for one host must never travel to a lookalike domain because a
// URL was mistyped.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  describeWindow,
  diagnosticsCredentials,
  readRemoteFindings,
  resolveEnvName,
  runRemote,
} from "./errors-remote.mjs";

/**
 * The refusal half of a `{ … } | { reason }` union, narrowed.
 *
 * The resolvers return one shape or the other on purpose — that is what makes
 * "never a probably-meant fallback" a type and not a habit — so a test that
 * reads `.reason` off the union has to say which side it means.
 */
function reasonOf(answer: object): string {
  return "reason" in answer ? String((answer as { reason: string }).reason) : "";
}

/** True when the answer carries a secret rather than a refusal. */
function resolved(answer: object): boolean {
  return "secret" in answer;
}

const ENV = {
  APP_URL: "http://localhost:3000",
  APP_URL_STAGING: "https://staging.example.com",
  APP_URL_PROD: "https://app.example.com",
  DIAGNOSTICS_SECRET: "dev-secret",
  DIAGNOSTICS_SECRET_STAGING: "staging-secret",
  DIAGNOSTICS_SECRET_PROD: "prod-secret",
};

/** Captures what the command wrote, on both streams, without printing it. */
function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
  const error = vi.spyOn(console, "error").mockImplementation((...a) => void err.push(a.join(" ")));
  return {
    out,
    err,
    all: () => [...out, ...err].join("\n"),
    restore: () => {
      log.mockRestore();
      error.mockRestore();
    },
  };
}

function answering(status: number, body?: unknown) {
  return vi.fn(async () => ({
    status,
    json: async () => {
      if (body === undefined) throw new Error("not json");
      return body;
    },
  })) as unknown as typeof fetch;
}

const WINDOW = {
  seq: 12,
  since: "2026-08-10T09:00:00.000Z",
  instance: "ab12cd",
  retainedLines: 34,
  oldest: "2026-08-10T09:02:00.000Z",
  droppedLines: 0,
  findings: [] as unknown[],
};

afterEach(() => vi.restoreAllMocks());

describe("which environment a --url belongs to", () => {
  it("matches the configured hostname and hands back that environment's secret", () => {
    expect(diagnosticsCredentials(ENV, "https://app.example.com")).toEqual({
      envName: "production",
      secret: "prod-secret",
      keyVar: "DIAGNOSTICS_SECRET_PROD",
    });
    expect(diagnosticsCredentials(ENV, "https://staging.example.com/")).toMatchObject({
      envName: "staging",
      secret: "staging-secret",
    });
  });

  it("🚨 never guesses — a lookalike host gets a reason, not a fallback", () => {
    const answer = diagnosticsCredentials(ENV, "https://app.exampIe.com");
    expect(resolved(answer)).toBe(false);
    expect(reasonOf(answer)).toMatch(/matches none of the configured hosts/);
    // The secret provisioned for app.example.com must not be POSTed at a
    // domain that merely looks like it.
    expect(reasonOf(answer)).not.toContain("prod-secret");
  });

  it("accepts --env dev and --env prod, and refuses anything else", () => {
    expect(resolveEnvName("prod")).toBe("production");
    expect(resolveEnvName("dev")).toBe("development");
    expect(resolveEnvName("staging")).toBe("staging");
    expect(resolveEnvName("live")).toBeUndefined();
    expect(reasonOf(diagnosticsCredentials(ENV, "https://x.example.com", "live"))).toMatch(
      /unknown environment "live"/,
    );
  });

  it("names the variable that is missing rather than saying 'not configured'", () => {
    const { DIAGNOSTICS_SECRET_PROD: _drop, ...without } = ENV;
    expect(reasonOf(diagnosticsCredentials(without, "https://app.example.com"))).toContain(
      "DIAGNOSTICS_SECRET_PROD",
    );
  });

  it("says what there was to match against when nothing is configured at all", () => {
    expect(reasonOf(diagnosticsCredentials({}, "https://app.example.com"))).toMatch(
      /nothing to match .* against/,
    );
  });

  it("refuses a URL that is not one", () => {
    expect(reasonOf(diagnosticsCredentials(ENV, "app.example.com"))).toMatch(/not a usable URL/);
  });
});

describe("reading the endpoint", () => {
  it("names the two indistinguishable causes on a 404", async () => {
    vi.stubGlobal("fetch", answering(404));
    const answer = await readRemoteFindings({ baseUrl: "https://app.example.com", secret: "s" });
    expect(answer.ok).toBe(false);
    expect(reasonOf(answer)).toMatch(/no DIAGNOSTICS_SECRET set/);
    expect(reasonOf(answer)).toMatch(/does not match/);
  });

  it("reports a 429 as its own reason", async () => {
    vi.stubGlobal("fetch", answering(429));
    expect(reasonOf(await readRemoteFindings({ baseUrl: "https://a.b", secret: "s" }))).toMatch(
      /429/,
    );
  });

  it("reports an answer that is not JSON as something in FRONT of the app", async () => {
    vi.stubGlobal("fetch", answering(200));
    expect(reasonOf(await readRemoteFindings({ baseUrl: "https://a.b", secret: "s" }))).toMatch(
      /not JSON/,
    );
  });

  it("reports an unreachable host", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    expect(reasonOf(await readRemoteFindings({ baseUrl: "https://a.b", secret: "s" }))).toMatch(
      /ECONNREFUSED/,
    );
  });

  it("sends the bearer, and the after mark when it has one", async () => {
    // The parameters are declared so `mock.calls` is typed — an untyped
    // `vi.fn(async () => …)` has an empty tuple and the assertions below would
    // not compile.
    const fetcher = vi.fn(
      async (_url: string, _init: { headers: Record<string, string> }) => ({
        status: 200,
        json: async () => WINDOW,
      }),
    );
    vi.stubGlobal("fetch", fetcher as unknown as typeof fetch);
    await readRemoteFindings({ baseUrl: "https://app.example.com/", secret: "s3cret", after: 7 });
    expect(fetcher.mock.calls[0][0]).toBe("https://app.example.com/api/diagnostics/errors?after=7");
    expect(fetcher.mock.calls[0][1].headers.authorization).toBe("Bearer s3cret");
  });
});

describe("🚨 the exit codes, and what may be printed with each", () => {
  it("exits 2 and prints NO tick when it could not look", async () => {
    vi.stubGlobal("fetch", answering(404));
    const shown = capture();
    const code = await runRemote({ url: "https://app.example.com", env: ENV, argv: [] });
    shown.restore();

    expect(code).toBe(2);
    expect(shown.all()).not.toContain("✓");
    expect(shown.all()).toMatch(/Could not look/);
  });

  it("exits 2 without asking anything when no secret resolves", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher as unknown as typeof fetch);
    const shown = capture();
    const code = await runRemote({ url: "https://unknown.example.org", env: ENV, argv: [] });
    shown.restore();

    expect(code).toBe(2);
    expect(fetcher).not.toHaveBeenCalled();
    expect(shown.all()).not.toContain("✓");
  });

  it("exits 0 on a clean window — and NEVER with a bare tick", async () => {
    vi.stubGlobal("fetch", answering(200, WINDOW));
    const shown = capture();
    const code = await runRemote({ url: "https://app.example.com", env: ENV, argv: [] });
    shown.restore();

    expect(code).toBe(0);
    const text = shown.all();
    expect(text).toContain("✓");
    // The window is the whole point: an empty answer must read as "nothing in
    // the last N lines since …", never as "your app is fine".
    expect(text).toContain("34 line(s)");
    expect(text).toContain("ab12cd");
    expect(text).toContain("2026-08-10T09:00:00.000Z");
    // …and the multi-instance sentence, because this is not localhost.
    expect(text).toMatch(/another instance/);
  });

  it("exits 1 on findings, printing them in the local run's format", async () => {
    vi.stubGlobal(
      "fetch",
      answering(200, {
        ...WINDOW,
        droppedLines: 3,
        findings: [
          {
            message: "FORMATTING_ERROR: Invalid time value",
            location: "app/dashboard/page.tsx:174",
            frame: "{format.dateTime(person.since)}",
            count: 2,
          },
        ],
      }),
    );
    const shown = capture();
    const code = await runRemote({ url: "https://app.example.com", env: ENV, argv: [] });
    shown.restore();

    expect(code).toBe(1);
    const text = shown.all();
    expect(text).toContain("✗ 2 error(s)");
    expect(text).toContain("FORMATTING_ERROR: Invalid time value");
    expect(text).toContain("app/dashboard/page.tsx:174");
    // The hint that belongs to this code, from the SAME table the local run uses.
    expect(text).toMatch(/the value is not a Date/);
    // A truncated window is visible rather than silent.
    expect(text).toContain("3 dropped");
    // 🚨 The findings go to STDERR, like the local run — a caller redirecting
    // `2>` must see the same thing on both.
    expect(shown.err.join("\n")).toContain("FORMATTING_ERROR");
    expect(shown.out.join("\n")).not.toContain("FORMATTING_ERROR");
  });

  it("does not print the multi-instance sentence about localhost", async () => {
    vi.stubGlobal("fetch", answering(200, WINDOW));
    const shown = capture();
    await runRemote({ url: "http://localhost:3000", env: ENV, argv: [] });
    shown.restore();
    expect(shown.all()).not.toMatch(/another instance/);
  });
});

describe("the window, in words", () => {
  it("names lines, oldest, instance and boot time", () => {
    expect(describeWindow(WINDOW)).toBe(
      "in the last 34 line(s), oldest 2026-08-10T09:02:00.000Z of the deployed app's log " +
        "(instance ab12cd, up since 2026-08-10T09:00:00.000Z)",
    );
  });

  it("leaves the dropped clause out when nothing was dropped", () => {
    expect(describeWindow(WINDOW)).not.toContain("dropped");
    expect(describeWindow({ ...WINDOW, droppedLines: 9 })).toContain("9 dropped");
  });
});
