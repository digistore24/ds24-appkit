#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Reports what actually went wrong while the app was running. The counterpart
// to `node run.mjs logs`: that one is for a human to watch, this one is for
// deciding whether the app is broken.
//
// Usage:
//   node run.mjs errors                          this machine's .dev/dev.log
//   node run.mjs errors --url https://app.tld    a DEPLOYED app, over HTTP
//
// Two sources, ONE parser and ONE renderer — both in
// `lib/diagnostics/parse.mjs`. Locally the source is `.dev/dev.log`, which is
// the dev server's stdout+stderr captured to a file; remotely it is the
// deployed app's own stderr, held in a bounded redacted ring
// (`lib/diagnostics/capture.ts`) and read over a bearer token. Same bytes, same
// parser, same verdict — see `docs/DEPLOY.md` → *The errors a 200 hides*.
//
// Why this command exists at all is argued in `lib/diagnostics/parse.mjs`: a
// status code says the server answered, not that the page rendered.
import { existsSync, openSync, readSync, closeSync, statSync } from "node:fs";
import { LOG_FILE } from "./app-port.mjs";
import { parseErrors, renderFindings } from "../../lib/diagnostics/parse.mjs";

/**
 * How large the log is right now.
 *
 * Take this BEFORE doing something to the app, pass it to findErrors()
 * afterwards, and you get the errors your own requests caused rather than
 * everything since the app started. That is how smoke.mjs uses it.
 */
export function markLog() {
  if (!existsSync(LOG_FILE)) return 0;
  return statSync(LOG_FILE).size;
}

/** The log from `fromOffset` on. Starts over if the file has been truncated. */
function readFrom(fromOffset) {
  if (!existsSync(LOG_FILE)) return "";
  const size = statSync(LOG_FILE).size;
  // `start` opens the log with "w", so a restart shrinks it. An offset from
  // before that restart points into nothing — read the lot instead.
  const from = size < fromOffset ? 0 : fromOffset;
  if (size === from) return "";

  const fd = openSync(LOG_FILE, "r");
  try {
    const buffer = Buffer.alloc(size - from);
    readSync(fd, buffer, 0, buffer.length, from);
    return buffer.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/** Every error in .dev/dev.log from `fromOffset` on. */
export function findErrors(fromOffset = 0) {
  return parseErrors(readFrom(fromOffset));
}

/** Prints the findings. Returns how many distinct ones there were. */
export function report(fromOffset = 0) {
  const findings = findErrors(fromOffset);

  if (!existsSync(LOG_FILE)) {
    console.log("The app has not run yet — no log. Start it: node run.mjs start");
    return 0;
  }

  if (findings.length === 0) {
    console.log("✓ No errors in the log.");
    return 0;
  }

  // ⚠️ Head, findings and tail go to STDERR; the two lines above go to stdout.
  // That split is what a caller redirecting `2>` relies on — it has been this
  // way since the command existed, and the remote path below keeps it.
  const { head, body, tail } = renderFindings(findings);
  for (const line of [...head, ...body, ...tail]) console.error(line);
  return findings.length;
}

/**
 * `node run.mjs errors` — non-zero exit when there are errors.
 *
 * 🚨 The exit codes are the point of this command, and 1 and 2 are different on
 * purpose:
 *
 *   0  nothing found — and the output always says what window was looked at
 *   1  findings
 *   2  **could not look** — unreachable, 404, rate-limited, unusable answer
 *
 * "I found something" and "I could not look" are the two answers this whole
 * command exists to keep apart. A refusal never prints a `✓`.
 */
export async function cli() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--url");
  const url = at === -1 ? null : args[at + 1];

  if (at === -1) {
    // The local path, unchanged.
    if (report() > 0) process.exitCode = 1;
    return;
  }

  if (!url || url.startsWith("--")) {
    console.error("✗ --url needs an address: node run.mjs errors --url https://app.example.com");
    process.exitCode = 2;
    return;
  }

  // Dynamic, so the local path above keeps its promise: `errors` has no `needs`
  // in run.mjs because it must work precisely when the app has fallen over, and
  // the remote reader pulls in the `.env` loader and a URL parser it does not
  // need for that.
  const { runRemote } = await import("./errors-remote.mjs");
  process.exitCode = await runRemote({ url, env: process.env });
}

// Runnable on its own, not only through run.mjs.
if (process.argv[1] && process.argv[1].endsWith("log-errors.mjs")) {
  cli().catch((error) => {
    console.error(`✗ Could not look — ${error.message}`);
    process.exitCode = 2;
  });
}
