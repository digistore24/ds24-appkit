// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// State of the local IPN tunnel — shared by `tunnel.mjs` (which manages it) and
// `ipn-setup.mjs` (which wants to know whether one is running).
//
// A tunnel of ours is TWO processes, and cloudflared never sees the app:
//
//   Digistore24 ──► trycloudflare.com ──► cloudflared ──► gate ──► app
//                                          (tunnel.pid)   (tunnel.gate.pid,
//                                                          tunnel.gate.port)
//
// The gate (`_ipn-gate.mjs`) is a loopback server that forwards `/api/ipn`
// and answers everything else 404. A quick tunnel forwards every path of the
// address it is given and cannot be told otherwise, so pointed at the app it
// published the sign-in page — which in DEV signs anyone in without a
// password. Pointed at the gate it publishes one route.
//
// Five small files under .dev/ hold everything:
//   tunnel.url        the public https address
//   tunnel.pid        the cloudflared process, so `node run.mjs stop` can end it
//   tunnel.gate.pid   the gate process — ended together with cloudflared
//   tunnel.gate.port  the loopback port cloudflared forwards to
//   tunnel.log        cloudflared's and the gate's output (that is where the
//                     address comes from, and where refusals show up)
//
// **Two different questions, two different answers — do not mix them up.**
//
//   "Is a tunnel of ours running?"   → the PIDs (`process.kill(pid, 0)`)
//   "Does it forward right now?"     → a GET on the address
//
// The first governs stopping and cleanup, the second governs *using* the
// address. Deciding the first one with a network probe is a trap that costs
// real money: a freshly created trycloudflare.com name does not resolve on
// every machine for the first few minutes (corporate DNS, a VPN, a resolver
// caching the negative answer) while Digistore24 resolves it perfectly well.
// Treating that as "no tunnel" deletes the PID we would need to stop it — and
// leaves cloudflared running, with this machine published to the internet and
// nothing left that remembers it.
//
// A failed probe means "I could not reach it from here", never "it is not
// there". Only `process.kill(pid, 0)` is allowed to declare a tunnel gone, and
// that call behaves the same on Linux, macOS and Windows.
//
// And a tunnel is running only while BOTH processes are. Half of one — the gate
// gone, cloudflared forwarding onto a closed port, or the other way round — is
// not "running" (nothing arrives) and not "gone" (a process is still there to
// end): `activeTunnelUrl()` answers null, asks the survivor to end, and keeps
// the state so that `stop` and the next `openTunnel()` can make sure of it.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXES, fixFor, fixLine } from "../dev/doctor.mjs";

export const DEV_DIR = ".dev";
export const URL_FILE = join(DEV_DIR, "tunnel.url");
export const PID_FILE = join(DEV_DIR, "tunnel.pid");
export const GATE_PID_FILE = join(DEV_DIR, "tunnel.gate.pid");
export const GATE_PORT_FILE = join(DEV_DIR, "tunnel.gate.port");
export const LOG_FILE = join(DEV_DIR, "tunnel.log");

const GATE_SCRIPT = fileURLToPath(new URL("./_ipn-gate.mjs", import.meta.url));

// The IPN route answers a GET with "OK" — the very question Digistore24 asks
// before it accepts an address. Probing that path therefore tests the whole
// chain (tunnel forwards → gate forwards → app runs → route works), not merely
// "something listens".
export const PROBE_PATH = "/api/ipn";

function readFile(path) {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

function readPid(path) {
  const pid = Number.parseInt(readFile(path), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** The remembered tunnel — no check whether it still runs. */
export function readTunnel() {
  const url = readFile(URL_FILE);
  if (!url) return null;
  return {
    url,
    pid: readPid(PID_FILE),
    gatePid: readPid(GATE_PID_FILE),
    gatePort: readPid(GATE_PORT_FILE),
  };
}

/** @param {{ url: string, pid?: number | null, gatePid?: number | null, gatePort?: number | null }} state */
export function writeTunnel({ url, pid, gatePid, gatePort }) {
  mkdirSync(DEV_DIR, { recursive: true });
  writeFileSync(URL_FILE, `${url}\n`);
  if (pid) writeFileSync(PID_FILE, `${pid}\n`);
  if (gatePid) writeFileSync(GATE_PID_FILE, `${gatePid}\n`);
  if (gatePort) writeFileSync(GATE_PORT_FILE, `${gatePort}\n`);
}

/** Forget the tunnel. The log stays — it is what you read after a failure. */
export function clearTunnel() {
  for (const f of [URL_FILE, PID_FILE, GATE_PID_FILE, GATE_PORT_FILE]) {
    if (existsSync(f)) rmSync(f, { force: true });
  }
}

/**
 * Does something answer at `url` the way our IPN route does?
 * Returns true only on HTTP 200 with the body "OK" — a captive portal or a
 * stranger's server on a recycled address gets no free pass.
 */
export async function probe(url, { timeoutMs = 5000, fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`${url}${PROBE_PATH}`, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    if (res.status !== 200) return false;
    return (await res.text()).trim() === "OK";
  } catch {
    return false;
  }
}

/**
 * Is the process still there? Signal 0 sends nothing — it only asks. Node
 * implements it on Windows too, which is why this and not `pgrep`/`ps`.
 *
 * EPERM means the process exists but belongs to someone else: existing is the
 * question, so that counts as alive.
 *
 * (A recycled PID could in theory belong to a stranger by now. We only ever
 * kill a number we wrote down ourselves moments earlier, so the window is
 * small — and the alternative, killing nothing, is the worse failure.)
 */
export function processAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TUNNEL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

// Built from the table rather than written out here. This message used to carry
// its own list of install commands, one per system — a second copy that nobody
// maintained, on systems nobody here runs. `scripts/dev/fixes.json` is the one
// place; see the header of `scripts/dev/doctor.mjs`.
//
// Only the line for THIS machine is printed: whoever reads this is standing on
// one of the three systems, and the other two are noise in front of the answer.
export const CLOUDFLARED_MISSING = `cloudflared is not installed. Installation (one-time):

  ${fixLine(fixFor({ fix: FIXES.cloudflared }))}`;

/** The port `node run.mjs start` settled on — it moves out of the way of busy ports. */
export function appPort(argPort) {
  if (argPort) {
    const p = Number.parseInt(argPort, 10);
    if (Number.isInteger(p) && p > 0) return p;
  }
  try {
    const p = Number.parseInt(readFileSync(join(DEV_DIR, "port"), "utf8").trim(), 10);
    if (Number.isInteger(p) && p > 0) return p;
  } catch {
    /* no .dev/port yet — fall through to the default */
  }
  return 3000;
}

/** A port the OS has just handed out on the loopback interface — free right now. */
export function ephemeralPort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Detached, output into the log, running on after we return. */
function spawnDetached(command, args, fd, extra = {}) {
  return spawn(command, args, { detached: true, stdio: ["ignore", fd, fd], ...extra });
}

/**
 * End whatever the state files remember — both processes — and verify it.
 *
 * @returns {{ ok: true } | { ok: false, stubborn: number[] }}
 */
export async function stopTunnel(opts = {}) {
  const state = readTunnel();
  if (!state) return { ok: true };
  const stubborn = [];
  for (const pid of [state.pid, state.gatePid]) {
    if ((await stopPid(pid, opts)) === "stubborn") stubborn.push(pid);
  }
  // A process we could not end keeps its record: it is still there, and the
  // PID is the only handle anyone has left on it. Forgetting it here is
  // exactly how a tunnel gets stranded.
  if (stubborn.length > 0) return { ok: false, stubborn };
  clearTunnel();
  return { ok: true };
}

/**
 * Open a Cloudflare Quick Tunnel onto the local app's IPN route and remember it.
 *
 * Shared by `tunnel.mjs start` and by `ipn-setup.mjs --auto`, which opens one
 * when it needs a public address and none is there. Registering the IPN is
 * NOT done here — both callers do that themselves, which is what keeps the two
 * from calling each other in a circle.
 *
 * Two processes, in this order, and the order is the point: first the gate on
 * a loopback port, probed through to the app; only then cloudflared, and onto
 * the gate — so there is no moment at which the tunnel forwards to anything
 * but the gate. Whatever the state files still remember is ended first: a
 * fresh tunnel never sits next to an old one, and an old one that was opened
 * straight onto the app (no gate recorded) is exactly the thing to end.
 *
 * @param {{port?: number, log?: (msg: string) => void, gateScript?: string}} [opts]
 * @returns {Promise<{ok: true, url: string, pid: number, gatePid: number, gatePort: number}
 *   | {ok: false, reason: "no-app"|"no-gate"|"no-cloudflared"|"no-url"|"stuck", detail?: string}>}
 */
export async function openTunnel({ port = appPort(), log = () => {}, gateScript = GATE_SCRIPT } = {}) {
  // Without a running app there is nothing to forward, and Digistore24's check
  // would fail on an address that answers with nothing.
  if (!(await probe(`http://localhost:${port}`))) return { ok: false, reason: "no-app" };

  const closed = await stopTunnel();
  if (!closed.ok) {
    return {
      ok: false,
      reason: "stuck",
      detail: `an earlier tunnel process will not end (PID ${closed.stubborn.join(", ")})`,
    };
  }

  mkdirSync(DEV_DIR, { recursive: true });
  writeFileSync(LOG_FILE, "");
  const fd = openSync(LOG_FILE, "a");

  // ── 1. the gate ───────────────────────────────────────────────────────────
  const gatePort = await ephemeralPort();
  log(`>> IPN gate on 127.0.0.1:${gatePort} — lets ${PROBE_PATH} through to http://localhost:${port}, nothing else`);
  const gate = spawnDetached(
    process.execPath,
    [gateScript, "--app-port", String(port), "--port", String(gatePort)],
    fd,
    { windowsHide: true },
  );
  let gateGone = false;
  gate.on("error", () => {
    gateGone = true;
  });
  gate.on("exit", () => {
    gateGone = true;
  });
  gate.unref();

  // Through the gate to the app — proves the chain the tunnel will use.
  let gateUp = false;
  for (let i = 0; i < 20 && !gateGone; i++) {
    if (await probe(`http://127.0.0.1:${gatePort}`, { timeoutMs: 1000 })) {
      gateUp = true;
      break;
    }
    await sleep(250);
  }
  if (!gateUp) {
    await stopPid(gate.pid);
    return { ok: false, reason: "no-gate", detail: tailOfLog() };
  }

  // ── 2. cloudflared, onto the gate — never onto the app ────────────────────
  log(`>> Public address onto the IPN gate (127.0.0.1:${gatePort}) — Cloudflare Quick Tunnel, no account`);
  let child;
  try {
    child = spawnDetached("cloudflared", ["tunnel", "--url", `http://127.0.0.1:${gatePort}`], fd);
  } catch {
    await stopPid(gate.pid);
    return { ok: false, reason: "no-cloudflared" };
  }

  // A spawn that cannot find the binary reports it asynchronously, not by throwing.
  let spawnError = null;
  child.on("error", (err) => {
    spawnError = err;
  });
  // Let it run on without us: the caller returns, the tunnel stays.
  child.unref();

  let url = null;
  for (let i = 0; i < 60 && !spawnError; i++) {
    const m = TUNNEL_RE.exec(readFile(LOG_FILE));
    if (m) {
      url = m[0];
      break;
    }
    await sleep(500);
  }

  if (spawnError) {
    await stopPid(gate.pid);
    return spawnError.code === "ENOENT"
      ? { ok: false, reason: "no-cloudflared" }
      : { ok: false, reason: "no-url", detail: spawnError.message };
  }
  if (!url) {
    await stopPid(child.pid);
    await stopPid(gate.pid);
    return { ok: false, reason: "no-url", detail: tailOfLog() };
  }

  writeTunnel({ url, pid: child.pid, gatePid: gate.pid, gatePort });
  return { ok: true, url, pid: child.pid, gatePid: gate.pid, gatePort };
}

function tailOfLog() {
  return readFile(LOG_FILE).split("\n").slice(-20).join("\n");
}

/**
 * May `node run.mjs start` re-open the tunnel? Pure decision, kept apart from the doing
 * because it is the one that puts this machine on the internet.
 *
 * Yes only for an app that demonstrably WAS receiving Digistore24 events:
 *
 * - `domainId` (DIGISTORE_IPN_DOMAIN_ID, written when an IPN connection was
 *   first set up). Without it nothing was ever received, and `node run.mjs start` —
 *   which runs dozens of times a day for work with no billing in it — must not
 *   publish the machine.
 * - a local `appUrl`. A public one IS the IPN address; a tunnel would be wrong
 *   there and would overwrite the live registration with a temporary address.
 * - nothing running yet, or there is nothing to restore.
 */
export function shouldRestoreTunnel({ domainId, appUrl, alreadyRunning } = {}) {
  if (alreadyRunning) return false;
  if (!domainId) return false;
  return !/^https:\/\//.test((appUrl || "").trim());
}

/**
 * A courtesy check, kept short on purpose. Plenty of machines cannot resolve a
 * brand-new trycloudflare name for the first few minutes while Digistore24
 * resolves it immediately — so a "no" here proves nothing, and waiting long for
 * it would only make every start slow. The verdict that counts is the one
 * Digistore24 reaches with its own call.
 */
export async function waitReachable(url, attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    if (await probe(url)) return true;
    await sleep(1000);
  }
  return false;
}

/**
 * End a process — and make sure it actually ended.
 *
 * `process.kill()` returning without throwing means the signal was *delivered*,
 * not that the process is gone; cloudflared shuts down gracefully and takes a
 * moment. Reporting "closed" on the strength of the send is how you end up
 * telling someone their machine is off the internet while it is still on it.
 * So: ask with SIGTERM, wait for it to become true, insist with SIGKILL.
 *
 * Both signals are mapped to TerminateProcess on Windows, so this reads the
 * same on all three systems.
 *
 * @returns "gone" (was not running) | "stopped" | "killed" | "stubborn"
 */
export async function stopPid(pid, { graceMs = 5000, killMs = 2000, stepMs = 250 } = {}) {
  if (!processAlive(pid)) return "gone";
  try {
    process.kill(pid);
  } catch {
    return "gone";
  }
  for (let waited = 0; waited < graceMs; waited += stepMs) {
    if (!processAlive(pid)) return "stopped";
    await sleep(stepMs);
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return "gone";
  }
  for (let waited = 0; waited < killMs; waited += stepMs) {
    if (!processAlive(pid)) return "killed";
    await sleep(stepMs);
  }
  return "stubborn";
}

/**
 * What the state files describe, checked against the processes — and nothing
 * else (see the header: the network has no vote here).
 *
 *   "none"       nothing recorded
 *   "foreign"    an address with no PID — written by hand, not ours to judge,
 *                and not guarded by our gate either
 *   "up"         cloudflared AND the gate are running
 *   "half"       one of them is gone (or no gate was ever recorded) — the
 *                address forwards nowhere, or straight at the app
 *   "gone"       both are gone
 */
export function tunnelHealth(state = readTunnel()) {
  if (!state) return "none";
  if (state.pid === null) return "foreign";
  const cloudflared = processAlive(state.pid);
  const gate = processAlive(state.gatePid);
  if (cloudflared && gate) return "up";
  if (!cloudflared && !gate) return "gone";
  return "half";
}

/**
 * The address of a tunnel of ours that is still running, or null.
 *
 * Deliberately decided by the PIDs and not by a probe — see the header. A
 * tunnel that runs but cannot be reached *from this machine* is still a
 * perfectly good IPN address, because Digistore24 calls it from somewhere
 * else. Handing it over and letting Digistore24 judge (it performs its own GET
 * and insists on HTTP 200) beats refusing it here on worse evidence.
 *
 * State is cleared only when both processes are provably gone — never on a
 * failed probe, which would strand a running cloudflared with nothing to stop
 * it. Half a tunnel gets a polite SIGTERM for the survivor and KEEPS its state:
 * `stopTunnel()` is what verifies the end, and it needs the PIDs to do so.
 */
export function activeTunnelUrl() {
  const state = readTunnel();
  switch (tunnelHealth(state)) {
    case "none":
      return null;
    // No PID recorded (hand-written file, or a crash between the writes):
    // keep the address rather than throw it away — a probe elsewhere can still
    // vouch for it, and there is no process for us to leak.
    case "foreign":
    case "up":
      return state.url;
    case "gone":
      clearTunnel();
      return null;
    default:
      for (const pid of [state.pid, state.gatePid]) {
        if (!processAlive(pid)) continue;
        try {
          process.kill(pid);
        } catch {
          /* raced with its own exit */
        }
      }
      return null;
  }
}
