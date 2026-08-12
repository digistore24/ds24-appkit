// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `node run.mjs journey` — where am I, and what comes next.
//
// Three lines of work: read the disk (`journeyFacts()`), decide
// (`journeyState()`), print (`./journey-render.mjs`). Everything interesting is
// in one of those three files and none of it is here, which is the point — this
// is the impure edge, and it is deliberately too small to hold a judgement.
//
// 🚨 **It NEVER writes anything.** No cache, no stamp, no "last seen" file.
// `./operations.mjs` argues it for the greeting's own line and the argument is
// the same one: the record IS the cache, and a cache of a cache is a second truth
// with its own TTL. Everything here is derived from disk on every call, which is
// also why the answer can never be stale.
//
// Plain Node, no dependency, ESM — Linux, macOS and Git Bash on Windows
// (CLAUDE.md → Three systems).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readEnvValue } from "../lib/env-write.mjs";
import { journeyFacts, journeyState } from "./journey.mjs";
import { describeJourney, describeNext, journeyJson } from "./journey-render.mjs";

/** Resolved from THIS file, never from the cwd — `journey.mjs` says why. */
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The app's own name, or `null`.
 *
 * ⚠️ **`"Your App"` is not a name and is answered as `null`.** That is what
 * `lib/app.ts` falls back to when nobody has set one, so printing it would put a
 * placeholder in the first line of the page — and a placeholder in the position
 * of a name reads as the app being called that. The brief instructs: name it, or
 * omit the name.
 */
export function appName(root = PROJECT_ROOT) {
  const env = join(root, ".env");
  const found =
    readEnvValue(env, "NEXT_PUBLIC_APP_NAME") ||
    readEnvValue(env, "APP_NAME") ||
    process.env.NEXT_PUBLIC_APP_NAME ||
    process.env.APP_NAME ||
    "";
  const name = String(found).trim();
  return name && name.toLowerCase() !== "your app" ? name : null;
}

/**
 * The command. Three modes, one state — never three derivations of it.
 *
 * @param {string[]} [args]
 */
export function journeyCommand(args = []) {
  const state = journeyState(journeyFacts(PROJECT_ROOT));
  const name = appName();

  if (args.includes("--json")) {
    console.log(JSON.stringify(journeyJson(state, { appName: name }), null, 2));
    return;
  }

  if (args.includes("--next")) {
    console.log(describeNext(state));
    return;
  }

  console.log(describeJourney(state, { appName: name }));
}
