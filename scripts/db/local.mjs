// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The local Postgres without Docker (DB_DRIVER=local).
//
// Docker stays the documented way — it is the one that matches production, and
// `docker-compose.yml` is the same Postgres 16 the app is deployed against.
// This is the second-best way, and it exists for one reason: on Windows the
// first one means Docker Desktop plus WSL2 plus a restart, and for the people
// this template is written for that is where the product used to end.
//
// What it is NOT: a second database stack. `embedded-postgres` ships the real
// Postgres binaries and speaks the real wire protocol, so DATABASE_URL,
// db/index.ts, the migrations in drizzle/ and every script keep working
// unchanged. The only thing that differs is who starts the server.
//
// The lifecycle follows scripts/dev/app.mjs, and for the same reasons
// (CLAUDE.md → Three systems): remember the PID in .dev/, spawn detached, and
// ask the database whether it is up rather than hunt for it in a process table.
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { portInUse } from "../dev/ports.mjs";
import { readEnvValue } from "../lib/env-write.mjs";
import { runNpm, sleep } from "../lib/proc.mjs";

const DEV_DIR = ".dev";
// Exported because it is evidence, not just a path: a data directory here means
// this project already runs without Docker, and scripts/db/driver.mjs lets that
// outrank anything it detects on the machine.
export const LOCAL_DATA_DIR = `${DEV_DIR}/pgdata`;
const DATA_DIR = LOCAL_DATA_DIR;
const PID_FILE = `${DEV_DIR}/db.pid`;
const LOG_FILE = `${DEV_DIR}/db.log`;
const SERVER = "scripts/db/local-server.mjs";
const READY_TIMEOUT_MS = 60_000;

// Pinned, and pinned to the 16 line on purpose: docker-compose.yml runs
// postgres:16, and a developer whose local database is a major version ahead of
// production finds that out at the worst possible moment. Every release of this
// package carries a `-beta` tag — that is how it is published, not a warning
// about this particular version, and it is why the version is written out in
// full instead of as a range (a `^16` would match nothing).
const PACKAGE = "embedded-postgres@16.14.0-beta.17";

/** The PID of a running local Postgres, or null. */
export function runningPid() {
  if (!existsSync(PID_FILE)) return null;
  const pid = Number.parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
  if (!Number.isFinite(pid)) return null;
  try {
    process.kill(pid, 0); // delivers nothing — only asks whether it is there
    return pid;
  } catch {
    return null;
  }
}

/** Connection details out of DATABASE_URL — the single place that parses it. */
export function connection() {
  const url = process.env.DATABASE_URL || readEnvValue(".env", "DATABASE_URL");
  if (!url) {
    throw new Error(
      "✗ DATABASE_URL is missing from .env — run `node run.mjs env` first.",
    );
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`✗ DATABASE_URL is not a usable URL: ${url}`);
  }
  return {
    port: Number(parsed.port) || 5432,
    user: decodeURIComponent(parsed.username) || "app",
    password: decodeURIComponent(parsed.password) || "app",
    database: parsed.pathname.replace(/^\//, "") || "app",
  };
}

/** Is the package there? It is installed on demand, not shipped. */
function packageInstalled() {
  try {
    createRequire(import.meta.url).resolve("embedded-postgres");
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch the Postgres binaries — once, and only for whoever actually needs them.
 * Not a dependency in package.json: that would make everybody download ~60 MB,
 * including the large majority who have Docker and never touch this path.
 */
async function installPackage() {
  console.log("→ Postgres for this machine is missing — fetching it now (about 60 MB, once).");
  // --save-dev on purpose: from now on this project genuinely depends on it for
  // development, and the next `npm install` has to bring it back.
  const code = await runNpm(["install", "--save-dev", PACKAGE]);
  if (code !== 0) {
    throw new Error(
      `✗ ${PACKAGE} could not be installed.\n` +
        "  Without it there is no database on this machine. Either fix the npm\n" +
        "  error above, or use Docker instead (DB_DRIVER=docker in .env).",
    );
  }
}

const tailLog = (lines = 25) =>
  existsSync(LOG_FILE) ? readFileSync(LOG_FILE, "utf8").split("\n").slice(-lines).join("\n") : "";

/** Start it, unless it is already running. Returns once it accepts connections. */
export async function localUp() {
  const { port, user, password, database } = connection();

  if (runningPid() && (await portInUse(port))) return; // ours, and up

  // Somebody else's database on our port is the one case where carrying on
  // would be actively harmful: the app would migrate into a foreign database.
  // Same guard as the Docker path in db/up.mjs, same reason.
  if (!runningPid() && (await portInUse(port))) {
    throw new Error(
      `✗ Port ${port} already hosts another database.\n` +
        "  This app would work against THAT one by accident — hence we stop here.\n\n" +
        "  How to fix it: pick a free port in .env, in BOTH lines:\n" +
        `     DB_PORT=<free port>\n` +
        `     DATABASE_URL=postgresql://${user}:${password}@localhost:<free port>/${database}\n`,
    );
  }

  if (!packageInstalled()) await installPackage();

  mkdirSync(DATA_DIR, { recursive: true });
  // "w", not "a": each start gets a fresh log, so a failed start shows this
  // run's error and not the one from three days ago. Same as app.mjs.
  const log = openSync(LOG_FILE, "w");
  const child = spawn(
    process.execPath,
    [SERVER, DATA_DIR, String(port), user, password, database],
    { detached: true, stdio: ["ignore", log, log] },
  );
  child.unref();
  writeFileSync(PID_FILE, `${child.pid}\n`);

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await accepts(port, user, password, database)) {
      console.log(`✓ Database running on port ${port} (without Docker).`);
      return;
    }
    if (!runningPid()) break; // it died — no point waiting out the minute
    await sleep(500);
  }

  throw new Error(`✗ The database does not answer — last lines of ${LOG_FILE}:\n\n${tailLog()}`);
}

/**
 * Ask the database, not the port. A bound port only means Postgres started; it
 * refuses connections for a moment longer while it recovers, and a migration
 * fired into that window fails for no reason anybody can see afterwards.
 */
async function accepts(port, user, password, database) {
  if (!(await portInUse(port))) return false;
  try {
    const { connectUtc } = await import("../lib/pg-utc.mjs");
    const sql = connectUtc(`postgresql://${user}:${password}@localhost:${port}/${database}`, {
      max: 1,
      connect_timeout: 3,
      onnotice: () => {},
    });
    try {
      await sql`select 1`;
      return true;
    } finally {
      await sql.end({ timeout: 1 });
    }
  } catch {
    return false;
  }
}

/** Stop it. The data stays. */
export async function localDown() {
  const pid = runningPid();
  if (!pid) {
    if (existsSync(PID_FILE)) rmSync(PID_FILE);
    return false;
  }

  // SIGTERM, not SIGKILL: the server script shuts Postgres down properly on it.
  // Windows has no SIGTERM, but Node maps process.kill() there to a terminate
  // that the child cannot intercept — so Postgres replays its WAL on the next
  // start. Correct, only noisier.
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* gone between the check and here */
  }

  for (let i = 0; i < 40 && runningPid(); i++) await sleep(250);
  if (runningPid()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* gone after all */
    }
  }
  if (existsSync(PID_FILE)) rmSync(PID_FILE);
  return true;
}

/** Stop it and delete the data — the counterpart of `docker compose down -v`. */
export async function localNuke() {
  await localDown();
  if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
}

/** One line for `node run.mjs status`. */
export async function localStatus() {
  const pid = runningPid();
  const { port } = connection();
  console.log(
    pid && (await portInUse(port))
      ? `Database:  running (PID ${pid}, port ${port}, without Docker)`
      : "Database:  stopped",
  );
}
