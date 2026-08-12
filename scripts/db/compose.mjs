// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Which Docker Compose project this app's local Postgres belongs to.
//
// **The failure this file exists to prevent, measured:** a freshly deployed app
// in a folder called `test` started, migrated — and died on the very first
// statement of the very first migration with `type "ipn_result" already
// exists`. On an empty database that sentence is impossible. The database was
// not empty: it held another app's tables (`catch_photos`, `trip_plans`, a
// `course_units`), because Docker Compose names its containers and volumes
// after the FOLDER the compose file sits in — and a folder called `test` is a
// folder somebody has had before. The new app adopted the old app's volume,
// found a schema it had never written, and had no way to say so.
//
// Two apps on one machine may share a folder name. They may not share a
// database. `scripts/db/up.mjs` already goes to some length over the same worry
// one level down — it refuses to start rather than let DATABASE_URL point at a
// port somebody else's Postgres holds — and this is the same question asked of
// the volume rather than the port.
//
// **So the project name is derived from the PATH, not from the folder name**,
// and then written into .env exactly the way DB_DRIVER and DB_PORT are
// (scripts/db/driver.mjs carries the long version of that argument): decided
// once, recorded, obeyed afterwards. Recording it is not tidiness —
//
//   - the path can change. Somebody renames or moves their project folder, and
//     a name re-derived from the new path would point at a second, empty
//     database while the first one sits there full. To the user that reads as
//     "the app forgot everything";
//   - Compose reads ./.env itself. So a `docker compose down` a person types by
//     hand in that folder — which two of this template's own error hints tell
//     them to — reaches the same project as our scripts do, instead of a
//     phantom named after the directory.
//
// The scripts still pass `-p` explicitly on top of that, because a
// COMPOSE_PROJECT_NAME exported in somebody's shell outranks the .env and would
// otherwise silently redirect every container this app starts.
import { existsSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { readEnvValue, setEnvValue } from "../lib/env-write.mjs";

export const COMPOSE_PROJECT_KEY = "COMPOSE_PROJECT_NAME";

// What Compose accepts: lowercase letters, digits, dash and underscore, and it
// has to begin with a letter or a digit.
const VALID = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * A folder name as Compose would take it — that is what it does to the
 * directory name today, so a project keeps the name it already had apart from
 * the suffix below.
 */
function slug(name) {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "")
    .slice(0, 24)
    .replace(/-+$/, "");
  return cleaned || "app";
}

/**
 * The name this directory would get if nobody had written one down.
 *
 * `<folder>-<8 hex of the path>`: still readable in `docker ps`, and the tail is
 * what makes two `test` folders two projects. The realpath rather than cwd, so
 * a symlinked route into the same directory does not count as a second app.
 */
export function deriveComposeProject(dir = process.cwd()) {
  let path = dir;
  try {
    path = realpathSync(dir);
  } catch {
    // A directory we cannot resolve is still a directory we can hash.
  }
  const tail = createHash("sha256").update(path).digest("hex").slice(0, 8);
  return `${slug(basename(path))}-${tail}`;
}

/**
 * The project in force. Reads what is written down, derives and records one when
 * nothing is.
 *
 * An unusable value throws rather than falling back — the same reasoning as
 * DB_DRIVER: a name Compose refuses is a start that fails somewhere further on,
 * with a message about the container rather than about the typo.
 */
export function composeProject() {
  const written = (process.env[COMPOSE_PROJECT_KEY] || readEnvValue(".env", COMPOSE_PROJECT_KEY) || "").trim();
  if (written) {
    if (!VALID.test(written)) {
      throw new Error(
        `✗ ${COMPOSE_PROJECT_KEY}="${written}" is not a name Docker Compose accepts.\n` +
          `  Allowed: lowercase letters, digits, "-" and "_", beginning with a\n` +
          `  letter or a digit. Fix it in .env, or delete the line — then this\n` +
          `  project's own name is derived from its path again.`,
      );
    }
    return written;
  }

  const derived = deriveComposeProject();
  // Only when there is a .env to write into. Before `node run.mjs setup` there
  // is not, and the derivation is stable enough to be used unrecorded until then.
  if (existsSync(".env")) setEnvValue(".env", COMPOSE_PROJECT_KEY, derived);
  return derived;
}

/**
 * The flags that pin a `docker compose …` call to this project.
 *
 * Written as flags rather than as a whole command line so the call sites keep
 * reading `docker("compose", …)` — which is what scripts/setup.test.ts looks for
 * when it checks that every compose call sits inside the DB_DRIVER branch.
 */
export function composeProjectFlag() {
  return ["-p", composeProject()];
}
