#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Receive Digistore24 IPNs on your own machine — via a free Cloudflare Quick
// Tunnel. No Cloudflare account, no domain, no cost.
//
// Why a tunnel at all: Digistore24 only accepts an IPN address that is publicly
// reachable over https, and it checks that itself — `ipnSetup` performs a GET
// and insists on HTTP 200 (it even refuses a 301/302, so the `/redir/` bridge
// the other URLs take cannot help here: that one works because a *browser*
// follows it, while the IPN is Digistore24's own server calling).
//
//   node scripts/ds24/tunnel.mjs start [port]   open it + register the IPN
//   node scripts/ds24/tunnel.mjs stop           close it
//   node scripts/ds24/tunnel.mjs restore [port] re-open it after `node run.mjs stop` —
//                                               only if this app was using one
//   node scripts/ds24/tunnel.mjs status         is one running? which address?
//   node scripts/ds24/tunnel.mjs url            print the address (for scripts)
//
// Via make: `node run.mjs ds24-tunnel`. It runs in the BACKGROUND and returns — the
// address lives in .dev/tunnel.url, `node run.mjs stop` ends it along with everything
// else, `node run.mjs start` brings it back, and `node run.mjs ds24-sync` finds it there.
//
// **The address is new every time**, and it has to be. A free quick tunnel gets
// a random name on every start; keeping one would mean a Cloudflare account, a
// named tunnel and your own domain. That is why the Digistore24 connection
// hangs off a stable `domain_id` and not off the URL: every open re-registers
// the new address onto the SAME connection (ipnSetup updates rather than
// creates), so nothing multiplies and nothing has to be copied by hand.
//
// This is Node and not bash on purpose: starting, finding and stopping a
// process is the one thing shell tools do differently on every system
// (`setsid` is Linux-only, `pgrep`/`ps -o pgid=` are missing or crippled
// elsewhere, POSIX process groups do not exist on Windows at all). Node's
// spawn/kill behave the same on Linux, macOS and Windows — see the
// cross-platform rule in CLAUDE.md.
//
// APP_URL in the .env is deliberately NOT touched. It is the address of your
// app, not of a temporary tunnel, and a non-local value there switches off the
// development login (lib/auth/dev-login.ts) — you would lock yourself out.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// The .env decides whether `restore` acts at all (DIGISTORE_IPN_DOMAIN_ID,
// APP_URL) — shell variables still win, as everywhere in these scripts.
import "../lib/env.mjs";
import {
  CLOUDFLARED_MISSING,
  LOG_FILE,
  activeTunnelUrl,
  appPort,
  clearTunnel,
  openTunnel,
  probe,
  readTunnel,
  shouldRestoreTunnel,
  stopPid,
  waitReachable,
} from "./_tunnel.mjs";

const IPN_SETUP = fileURLToPath(new URL("./ipn-setup.mjs", import.meta.url));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── start ───────────────────────────────────────────────────────────────────

async function start(argPort) {
  const port = appPort(argPort);

  // Already up? Then this command is a no-op — `node run.mjs start` and `make
  // ds24-tunnel` may be run in any order and as often as you like.
  const running = activeTunnelUrl();
  if (running) {
    console.log(`✓ Tunnel already running: ${running}`);
    console.log("  (a fresh address: node run.mjs stop, then node run.mjs ds24-tunnel)");
    return 0;
  }

  const opened = await openTunnel({ port, log: (m) => console.log(m) });
  if (!opened.ok) return explainFailure(opened, port);

  console.log(`   ${opened.url}`);
  process.stdout.write(">> Testing whether the app answers through it … ");
  const reachable = await waitReachable(opened.url);
  console.log(reachable ? "✓" : "not from here yet — that is fine, carrying on");

  return registerIpn(opened.url);
}

// ── restore ─────────────────────────────────────────────────────────────────

/**
 * Bring the tunnel back after a `node run.mjs stop` — called by `node run.mjs start`.
 *
 * The difference to `start` is entirely in what it refuses to do. `node run.mjs start`
 * runs dozens of times a day for work that has nothing to do with billing, so
 * this only acts when the app demonstrably WAS receiving IPNs:
 *
 *   - DIGISTORE_IPN_DOMAIN_ID is in the .env — written the first time an IPN
 *     connection was set up. No entry, no tunnel: an app that never received
 *     an IPN does not get published to the internet by `node run.mjs start`.
 *   - APP_URL is local. With a public one the domain is the IPN address and a
 *     tunnel would be wrong (and would overwrite the live registration).
 *
 * And it NEVER fails the start: no cloudflared, no network, Digistore24 down —
 * all of that costs a line of output, not the app. Exit code is always 0.
 */
async function restore(argPort) {
  const may = shouldRestoreTunnel({
    domainId: process.env.DIGISTORE_IPN_DOMAIN_ID,
    appUrl: process.env.APP_URL,
    alreadyRunning: Boolean(activeTunnelUrl()),
  });
  if (!may) return 0;

  console.log("→ Restoring the IPN tunnel (this app receives Digistore24 events) …");
  console.log("  While it runs the app has a public address — the app, nothing else on this");
  console.log("  computer. `node run.mjs stop` closes it.");
  const opened = await openTunnel({ port: appPort(argPort), log: () => {} });
  if (!opened.ok) {
    console.log(`  • not restored: ${shortExcuse(opened.reason)}`);
    console.log("    Purchases will not arrive until `node run.mjs ds24-tunnel` succeeds.");
    return 0;
  }

  console.log(`  ${opened.url}`);
  await waitReachable(opened.url);
  // The address is new, so Digistore24 has to be told — same connection, via
  // the stable domain_id. Without this the old, dead address stays registered
  // and every purchase runs into the void.
  const ok = (await registerIpn(opened.url, { quiet: true })) === 0;
  console.log(
    ok
      ? "  ✓ Digistore24 updated to the new address."
      : "  • Digistore24 could not be updated — run `node run.mjs ds24-tunnel` to retry.",
  );
  return 0;
}

function shortExcuse(reason) {
  if (reason === "no-cloudflared") return "cloudflared is not installed";
  if (reason === "no-app") return "the app is not answering yet";
  return "cloudflared reported no address";
}

/** Turn an openTunnel() refusal into something the reader can act on. */
function explainFailure(result, port) {
  switch (result.reason) {
    case "no-app":
      console.error(`✗ Nothing answers on port ${port} — start the app first:`);
      console.error("    node run.mjs start");
      console.error("  (a different port: node run.mjs ds24-tunnel --port 3005)");
      break;
    case "no-cloudflared":
      console.error(`${CLOUDFLARED_MISSING}\n\nThen run 'node run.mjs ds24-tunnel' again.`);
      break;
    default:
      console.error("✗ cloudflared did not report an address. Last lines of the log:");
      console.error(result.detail || `(see ${LOG_FILE})`);
  }
  return 1;
}

/**
 * Hand the address to Digistore24 — straight via --url, NOT via --auto:
 * --auto would derive it from APP_URL, and APP_URL is deliberately left alone.
 *
 * A brand-new address takes half a minute or so to be reachable from
 * everywhere. Until then Digistore24's own check answers "http error 0" — not a
 * broken setup, only one that came too early, so it is worth repeating.
 * Everything else (wrong key, refused parameters) is repeated by nobody.
 */
async function registerIpn(url, { quiet = false } = {}) {
  const say = quiet ? () => {} : (m) => console.log(m);
  say(">> Registering the IPN at Digistore24 …");
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = spawnSync(process.execPath, [IPN_SETUP, "--url", `${url}/api/ipn`, "--apply"], {
      encoding: "utf8",
    });
    const out = `${res.stdout || ""}${res.stderr || ""}`.trim();
    if (res.status === 0) {
      if (quiet) return 0;
      console.log(out);
      console.log(`
✓ Digistore24 now delivers events to this tunnel.
  The tunnel runs in the background — 'node run.mjs stop' ends it, 'node run.mjs status' shows it.
  Digistore24 keeps pointing here until the next 'node run.mjs ds24-tunnel' updates it.`);
      return 0;
    }
    if (/http error/i.test(out) && attempt < 3) {
      say("   … Digistore24 cannot open the address yet — the tunnel is still");
      say(`     spreading through the network. Again in 15 s (${attempt + 1}/3)`);
      await sleep(15000);
      continue;
    }
    if (quiet) return 1;
    console.error(out);
    console.error(`
✗ The IPN registration failed — see the message above.
  The tunnel stays up. Once the cause is fixed:
    node scripts/ds24/ipn-setup.mjs --url "${url}/api/ipn" --apply`);
    return 1;
  }
  return 1;
}

// ── stop / status ───────────────────────────────────────────────────────────

async function stop({ quiet = false } = {}) {
  const state = readTunnel();
  if (!state) {
    if (!quiet) console.log("• No tunnel running.");
    return 0;
  }

  const outcome = await stopPid(state.pid);

  // A process we could not end keeps its record: it is still forwarding, and
  // the PID is the only handle anyone has left on it. Forgetting it here is
  // exactly how a tunnel gets stranded.
  if (outcome === "stubborn") {
    console.error(`✗ The tunnel process (PID ${state.pid}) will not stop.`);
    console.error(`  Your machine is still reachable at ${state.url} — end it by hand:`);
    console.error(`    kill -9 ${state.pid}      (Windows: taskkill /PID ${state.pid} /F)`);
    return 1;
  }

  clearTunnel();
  // There WAS one, so say so even when asked to be quiet — `node run.mjs stop` should
  // report that it took the public address down. Only "nothing to do" is silent.
  console.log(
    outcome === "gone"
      ? "• Tunnel was no longer running — state cleared"
      : "✓ Tunnel closed",
  );
  return 0;
}

async function status() {
  const active = activeTunnelUrl();
  if (!active) {
    console.log("Tunnel:    none — the app is reachable from this computer only");
    return 0;
  }
  // Running is one thing, reachable from *here* is another — and the second is
  // not a defect. A fresh address often needs a few minutes before this
  // machine's resolver knows it, while Digistore24 already reaches it.
  const reachable = await probe(active);
  console.log(`Tunnel:    running — ${active}`);
  console.log("           (public while it runs: anyone with this address reaches the app;");
  console.log("            node run.mjs stop closes it)");
  if (!reachable) {
    console.log("           (not resolvable from this machine yet — normal for a few");
    console.log("            minutes after opening; Digistore24 reaches it regardless)");
  }
  return 0;
}

/** For scripts: the address on stdout, nothing else. Exit 1 if there is none. */
function url() {
  const active = activeTunnelUrl();
  if (!active) return 1;
  console.log(active);
  return 0;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const [cmd, arg] = process.argv.slice(2);
const commands = {
  start: () => start(arg),
  stop: () => stop({ quiet: arg === "--quiet" }),
  restore: () => restore(arg),
  status,
  url,
};

if (!commands[cmd]) {
  console.error("Usage: node scripts/ds24/tunnel.mjs start|stop|restore|status|url");
  process.exit(2);
}
process.exit((await commands[cmd]()) ?? 0);
