// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import net from "node:net";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import {
  bootSmtpProbe,
  cachedSmtpProbe,
  probeTcp,
  resetSmtpProbe,
  smtpTargetFromEnv,
  smtpUnreachableMessage,
} from "./smtp-probe.mjs";
import { parseErrors, renderFindings } from "./parse.mjs";

/** A socket stand-in that never connects and never fails — a dropped SYN. */
function silentSocket() {
  const socket = new EventEmitter() as EventEmitter & { destroy: () => void; destroyed: boolean };
  socket.destroyed = false;
  socket.destroy = () => {
    socket.destroyed = true;
  };
  return socket;
}

function failingSocket(code: string) {
  const socket = silentSocket();
  setImmediate(() => socket.emit("error", Object.assign(new Error(`connect ${code}`), { code })));
  return socket;
}

async function listening(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  return { port, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

async function closedPort(): Promise<number> {
  const { port, close } = await listening();
  await close();
  return port;
}

afterEach(() => resetSmtpProbe());

describe("smtpTargetFromEnv", () => {
  it("reads host and port the way the send path does", () => {
    expect(smtpTargetFromEnv({ SMTP_HOST: "smtp.x.de" })).toEqual({ host: "smtp.x.de", port: 587, valid: true });
    expect(smtpTargetFromEnv({ SMTP_HOST: " smtp.x.de ", SMTP_PORT: "465" })).toEqual({
      host: "smtp.x.de",
      port: 465,
      valid: true,
    });
  });

  it("has nothing to probe without a host, and says so about a port that is not one", () => {
    expect(smtpTargetFromEnv({})).toBeNull();
    expect(smtpTargetFromEnv({ SMTP_HOST: "smtp.x.de", SMTP_PORT: "abc" })?.valid).toBe(false);
    expect(smtpTargetFromEnv({ SMTP_HOST: "smtp.x.de", SMTP_PORT: "70000" })?.valid).toBe(false);
  });
});

describe("probeTcp", () => {
  it("reports a listening port as reachable", async () => {
    const server = await listening();
    try {
      const result = await probeTcp({ host: "127.0.0.1", port: server.port }, { timeoutMs: 2000 });
      expect(result.reachable).toBe(true);
      expect(typeof result.ms).toBe("number");
    } finally {
      await server.close();
    }
  });

  it("tells a refused port apart from a dropped one", async () => {
    const refused = await probeTcp({ host: "127.0.0.1", port: await closedPort() }, { timeoutMs: 2000 });
    expect(refused).toMatchObject({ reachable: false, code: "refused" });

    // The blocked-port case: nothing answers, nothing errors. Only our own
    // timer can end it — `socket.setTimeout` would wait for ever here.
    let socket: ReturnType<typeof silentSocket> | null = null;
    const dropped = await probeTcp(
      { host: "smtp.x.de", port: 587 },
      {
        timeoutMs: 30,
        connect: (() => {
          socket = silentSocket();
          return socket;
        }) as never,
      },
    );
    expect(dropped).toMatchObject({ reachable: false, code: "timeout" });
    expect(socket!.destroyed).toBe(true);
  });

  it("classifies a name that does not resolve", async () => {
    const result = await probeTcp(
      { host: "nope.invalid", port: 587 },
      { timeoutMs: 2000, connect: (() => failingSocket("ENOTFOUND")) as never },
    );
    expect(result).toMatchObject({ reachable: false, code: "dns" });
  });

  it("never throws, even when connecting itself throws", async () => {
    const result = await probeTcp(
      { host: "smtp.x.de", port: 587 },
      {
        connect: (() => {
          throw Object.assign(new Error("boom"), { code: "ERR_SOCKET_BAD_PORT" });
        }) as never,
      },
    );
    expect(result).toMatchObject({ reachable: false, code: "unreachable" });
  });
});

describe("cachedSmtpProbe", () => {
  const env = { SMTP_HOST: "smtp.x.de", SMTP_PORT: "587" };

  it("is null when SMTP is not configured", async () => {
    expect(await cachedSmtpProbe({}, { source: "request" })).toBeNull();
  });

  it("reuses an answer inside its window and asks again after it", async () => {
    let connects = 0;
    const connect = (() => {
      connects += 1;
      return failingSocket("ECONNREFUSED");
    }) as never;
    const t0 = Date.parse("2026-09-16T10:00:00Z");

    await cachedSmtpProbe(env, { source: "boot", now: t0, connect });
    await cachedSmtpProbe(env, { source: "request", now: t0 + 60_000, connect });
    expect(connects).toBe(1);

    const later = await cachedSmtpProbe(env, { source: "request", now: t0 + 6 * 60_000, connect });
    expect(connects).toBe(2);
    expect(later?.source).toBe("request");
  });

  it("lets two callers at the same moment share one connection", async () => {
    let connects = 0;
    const connect = (() => {
      connects += 1;
      return failingSocket("ECONNREFUSED");
    }) as never;
    const [a, b] = await Promise.all([
      cachedSmtpProbe(env, { source: "request", connect }),
      cachedSmtpProbe(env, { source: "request", connect }),
    ]);
    expect(connects).toBe(1);
    expect(a).toEqual(b);
  });

  it("keeps its answer on globalThis, where a second module instance can read it", async () => {
    // The boot hook and the route are separate module instances in a built
    // app (lib/diagnostics/capture.ts measured it). vitest cannot reproduce the
    // split, so this pins the mechanism instead.
    await cachedSmtpProbe(env, { source: "boot", connect: (() => failingSocket("ECONNREFUSED")) as never });
    const held = (globalThis as Record<symbol, { snapshot: unknown }>)[Symbol.for("ds24.smtp-probe")];
    expect(held.snapshot).toMatchObject({ host: "smtp.x.de", port: 587, reachable: false, code: "refused", source: "boot" });
  });

  it("carries facts only — no error text travels in a snapshot", async () => {
    const snapshot = await cachedSmtpProbe(env, {
      source: "request",
      connect: (() => failingSocket("ETIMEDOUT")) as never,
    });
    expect(Object.keys(snapshot!).sort()).toEqual(["code", "host", "ms", "port", "probedAt", "reachable", "source"]);
    expect(JSON.stringify(snapshot)).not.toMatch(/connect ETIMEDOUT/);
  });

  it("reports a port that is not a port without connecting", async () => {
    let connects = 0;
    const snapshot = await cachedSmtpProbe(
      { SMTP_HOST: "smtp.x.de", SMTP_PORT: "five-eight-seven" },
      {
        source: "request",
        connect: (() => {
          connects += 1;
          return silentSocket();
        }) as never,
      },
    );
    expect(snapshot?.code).toBe("badPort");
    expect(connects).toBe(0);
  });
});

describe("bootSmtpProbe", () => {
  const env = { SMTP_HOST: "smtp.blocked.example", SMTP_PORT: "587" };

  it("writes a line `node run.mjs errors` actually FINDS, pointing at an HTTPS transport", async () => {
    const lines: string[] = [];
    const record = (...args: unknown[]) =>
      lines.push(args.map((arg) => (arg instanceof Error ? arg.stack ?? String(arg) : String(arg))).join(" "));

    await bootSmtpProbe(env, {
      timeoutMs: 20,
      connect: (() => silentSocket()) as never,
      log: record,
      error: record,
    });

    const log = lines.join("\n");
    const findings = parseErrors(log);
    // A line printed for a parser that does not see it would be the old
    // failure again, one layer down.
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("smtp.blocked.example:587");
    const body = renderFindings(findings).body.join("\n");
    expect(body).toMatch(/Brevo or Postmark/);
  });

  it("says reachable on a benign line the parser ignores", async () => {
    const server = await listening();
    const lines: string[] = [];
    try {
      await bootSmtpProbe(
        { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(server.port) },
        { log: (line) => lines.push(String(line)), error: (line) => lines.push(String(line)) },
      );
    } finally {
      await server.close();
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^• Mail: SMTP 127\.0\.0\.1:\d+ reachable/);
    expect(parseErrors(lines.join("\n"))).toEqual([]);
  });

  it("never throws, whatever the probe does", async () => {
    const errors: unknown[] = [];
    await expect(
      bootSmtpProbe(env, {
        connect: (() => {
          throw new Error("boom");
        }) as never,
        log: () => {},
        error: (...args) => errors.push(args),
      }),
    ).resolves.not.toThrow();
  });
});

describe("smtpUnreachableMessage", () => {
  it("names the server, the likely cause and both ways out", () => {
    const text = smtpUnreachableMessage({ host: "smtp-relay.brevo.com", port: 587 });
    for (const part of ["smtp-relay.brevo.com:587", "blocks outbound SMTP", "Railway", "Brevo", "Postmark", "mail-setup"]) {
      expect(text).toContain(part);
    }
  });
});
