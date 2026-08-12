// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The session greeting, for OpenCode. Generated from
// scripts/dev/agent-configs.mjs — edit it there, not here.
//
// It runs the same scripts/dev/session-start.mjs as the other hooks. Spawned
// rather than imported: a child process cannot take OpenCode down with it, and
// the greeting must never be the reason somebody cannot start work.
//
// Node and not bash, like everything else that has to run on Linux, macOS and
// Windows alike (CLAUDE.md → Three systems).

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export const SessionGreeting = async ({ directory }) => {
  let done = false;

  async function greet() {
    if (done) return;
    done = true;

    try {
      const { stdout } = await run("node", ["scripts/dev/session-start.mjs"], {
        cwd: directory ?? process.cwd(),
        timeout: 15_000,
      });
      if (stdout.trim()) console.log(stdout.trimEnd());
    } catch (error) {
      // The one case worth a word: no node on this machine. Everything else
      // stays quiet — a broken greeting must not look like a broken project.
      if (error?.code === "ENOENT") {
        console.log(
          "[Setup: blocked — node. Node.js is not installed on this machine, so the " +
            "greeting could not run. Run the skill setup-machine BEFORE writing any code.]",
        );
      }
    }
  }

  // Registered twice on purpose. OpenCode's documented shape is a hook keyed by
  // the event name; a generic "event" hook is also described in the wild. Which
  // one is live is not something this file can find out, and the failure mode of
  // guessing wrong is the worst one available: no greeting, no error, and a
  // machine that may have no Node reading as "all fine". The done flag makes the
  // duplicate harmless — whichever fires first wins, the other returns.
  return {
    "session.created": () => greet(),
    event: async ({ event }) => {
      if (event?.type === "session.created") await greet();
    },
  };
};
