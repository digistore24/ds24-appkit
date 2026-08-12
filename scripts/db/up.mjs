// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Starts the local Postgres (docker compose) — with a safety net.
//
// Why this module exists: if the database port is already taken by ANOTHER
// project, Docker only shows a cryptic message — and in the worst case
// `DATABASE_URL=…localhost:5432…` then points at the foreign database.
// Migrations would end up over there. We check for that up front.
//
// Called by `node run.mjs db-up`, and as a prerequisite of start/dev/db-migrate.
//
// On a machine without Docker (DB_DRIVER=local) the whole file below is skipped
// and scripts/db/local.mjs takes over. The branch sits at the very top, in one
// place, because everything after it is about containers and none of it has an
// equivalent there.
import { existsSync } from "node:fs";
import { freePort, portInUse, urlPort, urlSetPort } from "../dev/ports.mjs";
import { readEnvValue, setEnvValue } from "../lib/env-write.mjs";
import { capture, run } from "../lib/proc.mjs";
import { composeProjectFlag } from "./compose.mjs";
import { usesLocalPostgres } from "./driver.mjs";
import { localUp } from "./local.mjs";

const DEFAULT_DB_PORT = 15432; // as in docker-compose.yml

/**
 * docker compose, output captured. `docker` is a real executable everywhere.
 *
 * `-p` on every call: without it Compose names the project after the folder, so
 * two apps in two folders both called `test` share one container and one volume
 * — and the second one silently inherits the first one's database. See
 * scripts/db/compose.mjs.
 */
const compose = (args) => capture("docker", ["compose", ...composeProjectFlag(), ...args]);

function hintPortInUse(dbPort, free) {
  return (
    `\n  How to fix it: put a free port into .env — and carry that port over into\n` +
    `  DATABASE_URL as well (the two must match!). Right now ${free} is free:\n\n` +
    `     DB_PORT=${free}\n` +
    `     DATABASE_URL=postgresql://app:app@localhost:${free}/app\n\n` +
    `  Then try again: node run.mjs start\n`
  );
}

export async function dbUp() {
  if (await usesLocalPostgres()) return localUp();

  // DB_PORT from the environment or from .env; default as in docker-compose.yml.
  let dbPort = Number(process.env.DB_PORT || readEnvValue(".env", "DB_PORT")) || DEFAULT_DB_PORT;
  let dbUrl = process.env.DATABASE_URL || readEnvValue(".env", "DATABASE_URL");

  // Resolve a taken port ourselves: look for a free one, adjust .env, carry on.
  // Only for the LOCAL database — if DATABASE_URL points somewhere else
  // (staging/production), nothing is touched.
  const canFallBack = () => {
    if (!existsSync(".env") || !dbUrl) return false;
    try {
      return ["localhost", "127.0.0.1"].includes(new URL(dbUrl).hostname);
    } catch {
      return false;
    }
  };

  const fallBackToFreePort = async () => {
    const newPort = await freePort(dbPort + 1);
    setEnvValue(".env", "DB_PORT", String(newPort));
    setEnvValue(".env", "DATABASE_URL", urlSetPort(dbUrl, newPort));
    console.log(`ℹ Port ${dbPort} is taken (another project) — the database runs on ${newPort}.`);
    console.log("  Written to .env: DB_PORT and the port inside DATABASE_URL.");
    dbPort = newPort;
    dbUrl = readEnvValue(".env", "DATABASE_URL");
    process.env.DB_PORT = String(newPort);
  };

  // 1) Is our own container already running? Then a taken port is fine — it is
  //    taken by us.
  let ours = (await compose(["ps", "-q", "db"])).stdout.trim();
  // Only a RUNNING container holds the port. One that has merely been created
  // (state "Created", typical after a start that failed on port binding) does
  // not — it must not defeat the foreign-usage check below.
  if (ours) {
    const state = await capture("docker", ["inspect", "-f", "{{.State.Running}}", ours]);
    if (state.stdout.trim() !== "true") ours = "";
  }

  // 2) Detect foreign usage BEFORE docker does. Otherwise we might start a
  //    container without a published port and talk to the foreign database
  //    afterwards.
  //    A TCP connect instead of lsof: the port may be held by a container of
  //    another project whose docker-proxy is owned by root — and lsof does not
  //    show that to a normal user (see scripts/dev/ports.mjs).
  if (!ours && (await portInUse(dbPort))) {
    if (canFallBack()) {
      await fallBackToFreePort();
    } else {
      throw new Error(
        `✗ Port ${dbPort} already hosts another database (another project\n` +
          `  or a locally installed Postgres).\n` +
          `  This app would otherwise work against THAT foreign database by\n` +
          `  accident — hence we stop here.\n` +
          hintPortInUse(dbPort, await freePort(dbPort + 1)),
      );
    }
  }

  // 3) Start it and wait for the healthcheck.
  if ((await run("docker", ["compose", ...composeProjectFlag(), "up", "-d", "--wait"])) !== 0) {
    throw new Error(
      `\n✗ Postgres could not start.\n` +
        `  Most common reason: port ${dbPort} is taken.\n` +
        hintPortInUse(dbPort, await freePort(dbPort + 1)) +
        `  Is Docker running at all? Check with: docker ps\n`,
    );
  }

  // 4) Cross-check: is the port really published to the outside, and is it the
  //    port that DATABASE_URL uses? If not, DATABASE_URL points nowhere or —
  //    worse — at a foreign database.
  let published = (await compose(["port", "db", "5432"])).stdout.trim();
  // No published port almost always means: the container was created while the
  // port was already taken by someone else. Restarting does not help then, only
  // a different port — so fall back and recreate the container with it (the
  // volume, and with it the data, is kept).
  if (!published && (await portInUse(dbPort)) && canFallBack()) {
    console.log("ℹ The database container is running without a published port.");
    await fallBackToFreePort();
    await compose(["up", "-d", "--force-recreate", "--wait"]);
    published = (await compose(["port", "db", "5432"])).stdout.trim();
  }
  if (!published) {
    let message = "✗ The database container is running but publishes no port.\n";
    if (await portInUse(dbPort)) {
      message +=
        `  Reason: port ${dbPort} belongs to another project.\n` +
        hintPortInUse(dbPort, await freePort(dbPort + 1));
    } else {
      message +=
        "  This happens after an aborted start. Set it up once more:\n" +
        "     docker compose down && node run.mjs start\n";
    }
    throw new Error(message);
  }

  const actualPort = Number(published.split(":").pop());
  if (actualPort !== dbPort) {
    throw new Error(
      `✗ The container listens on port ${actualPort}, expected was ${dbPort}.\n` +
        `  DB_PORT in .env and the running container do not match:\n` +
        `     docker compose down && node run.mjs start\n`,
    );
  }

  // 5) Does DATABASE_URL point at the same port? Otherwise the app works against
  //    a different database than the one we have just started here.
  if (dbUrl) {
    const urlsPort = Number(urlPort(dbUrl, 5432));
    if (urlsPort !== actualPort) {
      throw new Error(
        `✗ DATABASE_URL uses port ${urlsPort}, but the local database runs\n` +
          `  on port ${actualPort}. The app would work against a FOREIGN\n` +
          `  database that way (or find none at all).\n\n` +
          `  Line them up in .env:\n` +
          `     DB_PORT=${actualPort}\n` +
          `     DATABASE_URL=postgresql://app:app@localhost:${actualPort}/app\n`,
      );
    }
  }
}
