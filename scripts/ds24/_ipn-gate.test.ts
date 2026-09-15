// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The IPN gate is the one thing that stands between a Cloudflare Quick Tunnel
// and the app. These tests run it for real — a loopback server in front of a
// stand-in app — because the property it holds ("nothing but /api/ipn gets
// through") is one a unit test of the decision alone would not measure: the
// forwarding, the 404, the body and the headers all have to be seen on a wire.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

import { createGate, decide, IPN_PATH } from "./_ipn-gate.mjs";

const GATE_SCRIPT = fileURLToPath(new URL("./_ipn-gate.mjs", import.meta.url));

/** What the stand-in app saw, request by request. */
type Seen = { method: string; url: string; body: string; headers: IncomingMessage["headers"] };

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * A stand-in for the app: answers EVERY path 200 — so any request that reaches
 * it and should not have would show up as a 200 where the test expects a 404.
 * `/api/ipn` behaves like the real route: GET says "OK", POST echoes the body.
 */
function fakeApp(seen: Seen[]): Server {
  return createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", body, headers: req.headers });
      res.setHeader("x-answered-by", "app");
      if (req.url === IPN_PATH && req.method === "GET") {
        res.end("OK");
      } else if (req.url === IPN_PATH && req.method === "POST") {
        res.end(`echo:${body}`);
      } else {
        res.end(`reached ${req.method} ${req.url}`);
      }
    });
  });
}

describe("decide — the table of what passes", () => {
  it("lets the IPN through: GET (Digistore24's check), HEAD, POST (the IPN)", () => {
    for (const method of ["GET", "HEAD", "POST"]) {
      expect(decide(method, "/api/ipn")).toEqual({ ok: true, path: IPN_PATH });
    }
  });

  it("forwards the constant path, never the caller's string", () => {
    // A query string does not travel — the IPN carries everything in its body.
    expect(decide("POST", "/api/ipn?x=1")).toEqual({ ok: true, path: IPN_PATH });
  });

  it("refuses every other method on the IPN path", () => {
    for (const method of ["PUT", "PATCH", "DELETE", "OPTIONS", "TRACE", "CONNECT"]) {
      expect(decide(method, "/api/ipn")).toEqual({ ok: false });
    }
  });

  it("refuses every other path — the pages a tunnel used to publish first", () => {
    for (const path of [
      "/",
      "/login",
      "/dashboard",
      "/dashboard/admin/purchases",
      "/api/auth/callback/dev-login",
      "/api/auth/signin",
      "/api/chat",
      "/plans",
      "/_next/static/x.js",
    ]) {
      expect(decide("GET", path), path).toEqual({ ok: false });
      expect(decide("POST", path), path).toEqual({ ok: false });
    }
  });

  it("compares the path literally — no trailing slash, no encoding, no dot-segments", () => {
    for (const path of [
      "/api/ipn/",
      "/api/ipn/extra",
      "/api/%69pn",
      "/API/IPN",
      "/api/ipn/../login",
      "/api/ipn%2F..%2Flogin",
      "/api//ipn",
      "//evil.example/api/ipn",
      "http://evil.example/api/ipn",
    ]) {
      expect(decide("GET", path), path).toEqual({ ok: false });
    }
  });

  it("refuses what is not a path at all", () => {
    expect(decide("GET", "")).toEqual({ ok: false });
    expect(decide("GET", "*")).toEqual({ ok: false });
    expect(decide("GET", "not a url")).toEqual({ ok: false });
  });
});

describe("the gate on a wire", () => {
  const seen: Seen[] = [];
  const logged: string[] = [];
  let app: Server;
  let gate: Server;
  let appPort = 0;
  let base = "";

  beforeAll(async () => {
    app = fakeApp(seen);
    appPort = await listen(app);
    gate = createGate({ appPort, log: (line) => logged.push(line) });
    base = `http://127.0.0.1:${await listen(gate)}`;
  });

  afterAll(async () => {
    await close(gate);
    await close(app);
  });

  afterEach(() => {
    seen.length = 0;
    logged.length = 0;
  });

  it("forwards Digistore24's GET check and hands back the app's OK", async () => {
    const res = await fetch(`${base}/api/ipn`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
    expect(res.headers.get("x-answered-by")).toBe("app");
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(["GET /api/ipn"]);
  });

  it("forwards the IPN POST with its body and headers intact", async () => {
    const body = "event=on_payment&order_id=ABC12345&sha_sign=deadbeef";
    const res = await fetch(`${base}/api/ipn`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "cf-connecting-ip": "203.0.113.7",
        "x-forwarded-proto": "https",
      },
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(`echo:${body}`);
    expect(seen).toHaveLength(1);
    expect(seen[0].body).toBe(body);
    // What Cloudflare stamps on the request reaches the app unchanged — the
    // route's rate limiter keys on the caller.
    expect(seen[0].headers["cf-connecting-ip"]).toBe("203.0.113.7");
    expect(seen[0].headers["x-forwarded-proto"]).toBe("https");
    expect(seen[0].headers["content-type"]).toBe("application/x-www-form-urlencoded");
  });

  it("drops the query string on the way in", async () => {
    await fetch(`${base}/api/ipn?debug=1&admin=true`);
    expect(seen.map((s) => s.url)).toEqual(["/api/ipn"]);
  });

  it("answers 404 for every other path and the app NEVER sees the request", async () => {
    // The stand-in app answers every path 200, so a request that got through
    // would show up twice: as a 200 here and as an entry in `seen`.
    for (const path of ["/", "/login", "/dashboard", "/api/auth/callback/dev-login", "/api/ipn/"]) {
      const res = await fetch(`${base}${path}`, { method: "GET" });
      expect(res.status, path).toBe(404);
      expect(await res.text()).toBe("Not found\n");
    }
    const post = await fetch(`${base}/api/auth/callback/dev-login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=owner@example.com",
    });
    expect(post.status).toBe(404);
    expect(seen).toEqual([]);
  });

  it("refuses the wrong method on the right path", async () => {
    const res = await fetch(`${base}/api/ipn`, { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(seen).toEqual([]);
  });

  it("logs a refusal, with the caller Cloudflare named", async () => {
    await fetch(`${base}/dashboard`, { headers: { "cf-connecting-ip": "198.51.100.9" } });
    expect(logged).toEqual(['gate: refused GET "/dashboard" from 198.51.100.9']);
  });

  it("answers 502 when the app is down, rather than hanging or crashing", async () => {
    const dead = createGate({ appPort: 1, log: () => {} });
    const deadBase = `http://127.0.0.1:${await listen(dead)}`;
    try {
      const res = await fetch(`${deadBase}/api/ipn`);
      expect(res.status).toBe(502);
    } finally {
      await close(dead);
    }
  });
});

describe("the gate as the process _tunnel.mjs starts", () => {
  const seen: Seen[] = [];
  let app: Server;
  let child: ChildProcess | null = null;

  beforeAll(async () => {
    app = fakeApp(seen);
  });

  afterAll(async () => {
    await close(app);
  });

  afterEach(() => {
    if (child?.pid) {
      try {
        process.kill(child.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
    child = null;
  });

  async function freePort(): Promise<number> {
    const probe = createServer();
    const port = await listen(probe);
    await close(probe);
    return port;
  }

  async function waitFor(url: string, tries = 40): Promise<Response | null> {
    for (let i = 0; i < tries; i++) {
      try {
        return await fetch(url);
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    return null;
  }

  it("comes up from the command line and holds the same rule", async () => {
    const appPort = await listen(app);
    const gatePort = await freePort();
    child = spawn(
      process.execPath,
      [GATE_SCRIPT, "--app-port", String(appPort), "--port", String(gatePort)],
      { stdio: "ignore" },
    );

    const ok = await waitFor(`http://127.0.0.1:${gatePort}/api/ipn`);
    expect(ok?.status).toBe(200);
    expect(await ok?.text()).toBe("OK");

    const refused = await fetch(`http://127.0.0.1:${gatePort}/login`);
    expect(refused.status).toBe(404);
    expect(seen.map((s) => s.url)).toEqual(["/api/ipn"]);
  });

  it("refuses to start without both ports", async () => {
    const exit = await new Promise<number | null>((resolve) => {
      const c = spawn(process.execPath, [GATE_SCRIPT, "--port", "1"], { stdio: "ignore" });
      c.on("exit", (code) => resolve(code));
    });
    expect(exit).toBe(2);
  });
});
