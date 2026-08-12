// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Start, stop, watch the dev server — the part that used to live as bash in the
// Makefile and only ever worked on Linux (setsid, pgrep, ps -o pgid=, kill -PGID).
//
// The three portable moves it is built on (CLAUDE.md → Three systems):
//
//  1. **Remember the PID**, don't look for the process. `.dev/dev.pid` holds it;
//     `process.kill(pid, 0)` asks whether it is still alive. No process table
//     is ever read.
//  2. **Spawn detached**, not via setsid/nohup. `{ detached: true }` gives the
//     child its own process group on Linux/macOS and survives our exit
//     everywhere.
//  3. **Ask the app, don't watch the log.** Readiness is an HTTP GET, not a
//     line in a file — that is the question we actually care about.
//
// Next is started as `node node_modules/next/dist/bin/next dev`, deliberately
// not through `npm run dev`: npm is a .cmd shim on Windows, so it would need a
// shell, and the PID we remembered would then be the shell's, not the app's.
import {
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { spawn } from "node:child_process";
import { chooseAppPort, DEV_DIR, LOG_FILE, rememberedPort } from "./app-port.mjs";
import { portInUse } from "./ports.mjs";
import { capture, isWindows, run, runScript, sleep } from "../lib/proc.mjs";
import { composeProjectFlag } from "../db/compose.mjs";
import { usesLocalPostgres } from "../db/driver.mjs";
import { localDown, localStatus } from "../db/local.mjs";

const PID_FILE = `${DEV_DIR}/dev.pid`;
const TUNNEL_CLI = "scripts/ds24/tunnel.mjs";
const READY_TIMEOUT_MS = 60_000;

/** The port this project uses: an explicit wish, else the remembered one, else 3000. */
export function appPort(wanted) {
  return wanted || rememberedPort() || 3000;
}

/** The PID of a running dev server, or null. Asks the OS, reads no process list. */
export function runningPid() {
  if (!existsSync(PID_FILE)) return null;
  const pid = Number.parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
  if (!Number.isFinite(pid)) return null;
  try {
    // Signal 0 delivers nothing — it only checks that the process is there.
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

/** Where npm put the `next` executable — read from its package.json, not guessed. */
export function nextBin() {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve("next/package.json");
  const bin = require("next/package.json").bin;
  const relative = typeof bin === "string" ? bin : bin.next;
  return path.join(path.dirname(pkgPath), relative);
}

/**
 * End a process and the children it spawned. `next dev` runs workers, so the
 * remembered PID alone is not enough.
 *   Linux/macOS: the detached child is its own process group → kill the group.
 *   Windows:     `taskkill /T` walks the tree; process groups do not exist there.
 */
async function killTree(pid) {
  if (isWindows) {
    await capture("taskkill", ["/pid", String(pid), "/T", "/F"]);
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

/**
 * Does the app answer on this port? ANY HTTP answer counts, a 500 included —
 * the question here is "is the server up", not "is the page correct". That
 * second one is what `node run.mjs smoke` is for, and it gives a far better
 * report than a start that silently waits out its minute.
 */
async function responds(port) {
  try {
    await fetch(`http://localhost:${port}`, {
      signal: AbortSignal.timeout(2000),
      redirect: "manual",
    });
    return true;
  } catch {
    return false;
  }
}

/** The last lines of the dev log — what you want to see when the start failed. */
function tailLog(lines = 30) {
  if (!existsSync(LOG_FILE)) return "(no log)";
  return readFileSync(LOG_FILE, "utf8").split("\n").slice(-lines).join("\n");
}

export async function start(wanted) {
  const running = runningPid();
  if (running) {
    console.log(`App is already running (PID ${running}) — http://localhost:${appPort(wanted)}`);
    return;
  }

  // An occupied app port is not something to complain about, it is something to
  // step around (writes .dev/port).
  const port = await chooseAppPort(appPort(wanted));

  mkdirSync(DEV_DIR, { recursive: true });
  // "w", not "a": each start gets a fresh log, so `logs` after a failed start
  // shows this run's error and not the one from three days ago.
  const log = openSync(LOG_FILE, "w");
  const child = spawn(process.execPath, [nextBin(), "dev", "--port", String(port)], {
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  writeFileSync(PID_FILE, `${child.pid}\n`);

  console.log("→ App starting … logs: node run.mjs logs   (stop it: node run.mjs stop)");

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await responds(port)) {
      console.log(`✓ App is running: http://localhost:${port}`);
      // The tunnel comes back last — it needs the app answering, and a quick
      // tunnel gets a NEW address every time, so Digistore24 is re-pointed at
      // it. Only for an app that was already receiving IPNs
      // (DIGISTORE_IPN_DOMAIN_ID in the .env); silent otherwise, and never fatal.
      await runScript(TUNNEL_CLI, ["restore", String(port)]);
      return;
    }
    if (!runningPid()) break; // it died — no point waiting out the minute
    await sleep(1000);
  }

  throw new Error(`✗ The app does not answer — last lines of the log:\n\n${tailLog()}`);
}

/** The dev server in the foreground — logs straight in the terminal, Ctrl-C ends it. */
export async function dev(wanted) {
  const port = await chooseAppPort(appPort(wanted));
  return run(process.execPath, [nextBin(), "dev", "--port", String(port)]);
}

export async function stop() {
  // First the tunnel: it publishes this machine to the internet, so it is the
  // one thing that must not survive a stop. Silent when there is none, and its
  // errors are deliberately NOT swallowed — a tunnel that refuses to die is the
  // one message here nobody may miss.
  await runScript(TUNNEL_CLI, ["stop", "--quiet"]);

  const pid = runningPid();
  if (pid) await killTree(pid);
  if (existsSync(PID_FILE)) rmSync(PID_FILE);

  // .dev/port stays on purpose: the port is a setting of this project, not
  // runtime state. So one `node run.mjs start --port 3001` is enough and every
  // later start picks it up again.
  const port = appPort();
  for (let i = 0; i < 10 && (await portInUse(port)); i++) await sleep(300);
  if (await portInUse(port)) {
    // Everything we started is gone, yet something still answers. Say so rather
    // than pretend: it is either a leftover worker or another project.
    console.log(`⚠ Something is still listening on port ${port}.`);
    // Advice printed for a human, not a command we run — and each line names the
    // tool that exists on the system it is printed on.
    console.log(
      isWindows
        ? `  Find and end it:  netstat -ano | findstr :${port}   then  taskkill /PID <pid> /T /F` // portability-ok
        : `  Find and end it:  fuser -k ${port}/tcp   (or close the terminal it runs in)`,
    );
  } else {
    console.log("✓ App stopped");
  }

  const kept = "(data is kept — to delete it: node run.mjs db-nuke)";
  if (await usesLocalPostgres()) {
    if (await localDown()) console.log(`✓ Database stopped ${kept}`);
  } else if ((await run("docker", ["compose", ...composeProjectFlag(), "down"])) === 0) {
    console.log(`✓ Database stopped ${kept}`);
  }
}

export async function status() {
  const pid = runningPid();
  const port = appPort();
  console.log(
    pid
      ? `App:       running (PID ${pid}) — http://localhost:${port}`
      : "App:       stopped",
  );
  await runScript(TUNNEL_CLI, ["status"]);
  if (await usesLocalPostgres()) await localStatus();
  else await run("docker", ["compose", ...composeProjectFlag(), "ps"]);
}

/** Follow the dev log, like `tail -f` — but with fs.watch, which exists everywhere. */
export async function logs() {
  mkdirSync(DEV_DIR, { recursive: true });
  if (!existsSync(LOG_FILE)) writeFileSync(LOG_FILE, "");

  let offset = statSync(LOG_FILE).size;
  const show = (from, to) =>
    new Promise((resolve) => {
      createReadStream(LOG_FILE, { start: from, end: to - 1 })
        .on("data", (chunk) => process.stdout.write(chunk))
        .on("close", resolve)
        .on("error", resolve);
    });

  // Start with the tail, as `tail -f` does.
  await show(Math.max(0, offset - 4096), offset);
  console.log("\n— following the log, Ctrl-C to stop —");

  watch(LOG_FILE, async () => {
    let size;
    try {
      size = statSync(LOG_FILE).size;
    } catch {
      return;
    }
    if (size < offset) offset = 0; // the file was truncated
    if (size > offset) {
      const from = offset;
      offset = size;
      await show(from, size);
    }
  });

  // Keep the process alive until Ctrl-C.
  await new Promise(() => {});
}
