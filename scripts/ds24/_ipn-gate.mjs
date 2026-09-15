#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The IPN gate — the only thing a Cloudflare Quick Tunnel of ours ever points at.
//
//   Digistore24 ──► trycloudflare.com ──► cloudflared ──► THIS ──► the app
//                                                          │
//                                                  everything that is not
//                                                  `/api/ipn` ends here: 404
//
// Why it exists: a quick tunnel forwards EVERY path of the address it was given,
// and it cannot be told otherwise — ingress rules need a named tunnel, an
// account and a domain. Pointed straight at the app it published the whole
// thing: the sign-in page, and in DEV that page signs anyone in without a
// password (lib/auth/dev-login.ts). All the tunnel is opened for is one route
// that Digistore24's server calls. So cloudflared is given this gate on a
// loopback port instead, and the gate forwards exactly one thing:
//
//   GET | HEAD | POST  /api/ipn   →  http://localhost:<app port>/api/ipn
//   anything else                 →  404, and the app never sees it
//
// GET because Digistore24 checks a new IPN address with a GET and insists on
// HTTP 200, POST because that is the IPN. The path is compared literally,
// AFTER URL parsing and BEFORE any decoding: `/api/ipn/`, `/api/%69pn`,
// `/api/ipn/../login` are all refused. What is forwarded is the constant path,
// never the caller's string — a query string does not travel either, the IPN
// carries everything in its body.
//
// The gate listens on 127.0.0.1 only. It is a filter, not a second front door.
//
// Lifecycle: `_tunnel.mjs` starts it detached right before cloudflared, records
// its PID next to cloudflared's (.dev/tunnel.gate.pid, .dev/tunnel.gate.port),
// and `node run.mjs stop` ends both. A tunnel whose gate is gone forwards onto a
// closed port — closed in the safe direction, and `_tunnel.mjs` ends the
// survivor rather than keep half a tunnel. Pure node:http, no shell, no
// third-party module, so it behaves the same on Linux, macOS and Windows.
//
//   node scripts/ds24/_ipn-gate.mjs --app-port 3000 --port 41234
import { createServer, request as httpRequest } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flagsFrom } from "../lib/args.mjs";

export const IPN_PATH = "/api/ipn";
const METHODS = new Set(["GET", "HEAD", "POST"]);

// Hop-by-hop headers belong to one connection, not to the request — RFC 7230
// §6.1. Node adds the right ones for the connection it opens itself.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const PLAIN = { "content-type": "text/plain; charset=utf-8", connection: "close" };

// Refusals are logged so the log shows the gate at work — but a scanner
// walking the address must not be able to fill the disk with it.
const LOGGED_REFUSALS = 20;

/**
 * The one decision: may this request reach the app?
 *
 * Pure, so the whole table of refusals is testable without a socket. `rawUrl`
 * is what the HTTP parser hands over (`req.url`) — a path with optional query,
 * or something odd that a client sent on purpose.
 *
 * @returns {{ ok: true, path: string } | { ok: false }}
 */
export function decide(method, rawUrl) {
  if (!METHODS.has(method)) return { ok: false };
  // Origin-form only — one slash, then the path. `//evil.example/api/ipn` and
  // `http://evil.example/api/ipn` are request targets a parser reads as a HOST
  // plus `/api/ipn`; nothing Digistore24 sends looks like that.
  if (typeof rawUrl !== "string" || !/^\/(?!\/)/.test(rawUrl)) return { ok: false };
  let pathname;
  try {
    ({ pathname } = new URL(rawUrl, "http://gate.invalid"));
  } catch {
    return { ok: false };
  }
  // Literal compare, no decoding — the app's router decodes, so a literal
  // match here is the narrower of the two and the only one worth having.
  if (pathname !== IPN_PATH) return { ok: false };
  return { ok: true, path: IPN_PATH };
}

function copyHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(name)) out[name] = value;
  }
  return out;
}

/** Printable for a log line, and bounded — the raw URL is the caller's string. */
function shown(text) {
  return JSON.stringify(String(text).slice(0, 160));
}

/**
 * The gate as an `http.Server`, not yet listening — tests hand it a port of
 * their own, the CLI below hands it the one `_tunnel.mjs` chose.
 *
 * @param {{ appPort: number, appHost?: string, timeoutMs?: number, log?: (line: string) => void }} opts
 */
export function createGate({ appPort, appHost = "localhost", timeoutMs = 30_000, log = () => {} }) {
  let refusals = 0;

  const server = createServer((req, res) => {
    const verdict = decide(req.method, req.url ?? "");
    if (!verdict.ok) {
      refusals++;
      if (refusals <= LOGGED_REFUSALS) {
        const from = req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress ?? "?";
        log(`gate: refused ${req.method} ${shown(req.url)} from ${from}`);
      } else if (refusals === LOGGED_REFUSALS + 1) {
        log(`gate: further refusals are not logged (${LOGGED_REFUSALS} so far)`);
      }
      // Drain nothing, promise nothing: a body that was announced is not read.
      res.writeHead(404, PLAIN);
      res.end("Not found\n");
      return;
    }

    const upstream = httpRequest(
      {
        host: appHost,
        port: appPort,
        method: req.method,
        path: verdict.path,
        headers: copyHeaders(req.headers),
        timeout: timeoutMs,
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, copyHeaders(answer.headers));
        answer.pipe(res);
      },
    );
    upstream.on("timeout", () => upstream.destroy(new Error("upstream timeout")));
    upstream.on("error", (err) => {
      log(`gate: the app did not answer ${req.method} ${IPN_PATH}: ${err.message}`);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(502, PLAIN);
      res.end("Bad gateway\n");
    });
    req.pipe(upstream);
  });

  // A request the parser cannot read gets a bare 400 and the socket back.
  server.on("clientError", (_err, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    else socket.destroy();
  });

  return server;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function intFlag(flag, name) {
  const n = Number.parseInt(flag(name) ?? "", 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = flagsFrom(process.argv.slice(2));
  const appPort = intFlag(flag, "app-port");
  const port = intFlag(flag, "port");
  if (!appPort || !port) {
    console.error("Usage: node scripts/ds24/_ipn-gate.mjs --app-port <app port> --port <gate port>");
    process.exit(2);
  }

  const server = createGate({ appPort, log: (line) => console.log(line) });
  server.on("error", (err) => {
    console.error(`gate: cannot listen on 127.0.0.1:${port}: ${err.message}`);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `gate: listening on 127.0.0.1:${port} — forwards ${IPN_PATH} to http://localhost:${appPort}, refuses everything else`,
    );
  });

  // Ends on request (Linux/macOS deliver these; on Windows `process.kill` is
  // TerminateProcess and no handler runs — the outcome is the same).
  const bye = () => {
    server.close();
    process.exit(0);
  };
  process.on("SIGTERM", bye);
  process.on("SIGINT", bye);
}
