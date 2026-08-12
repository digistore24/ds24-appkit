// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// A deployed app's own error text, kept where the app can answer for it.
//
// `node run.mjs errors` reads `.dev/dev.log` — the dev server's stdout+stderr,
// captured to a file by `scripts/dev/app.mjs`. On a host there is no such file:
// a deployed app is `next start` (or a standalone `server.js`), nobody runs
// `node run.mjs start` there, and `.dev/` is never created. So the command that
// exists to find the errors a 200 hides had nothing to read about the one app
// where it matters most.
//
// This is the source. `instrumentation.ts` installs a wrapper around
// `process.stderr.write` at boot; every complete line is redacted
// (`redact.mjs`) and appended to a bounded ring, and `GET
// /api/diagnostics/errors` runs the UNMODIFIED `parseErrors()` over it. Same
// bytes, same parser, same verdict as the local command — by construction, not
// by two implementations agreeing today.
//
// ⚠️ **IN MEMORY, PER PROCESS**, exactly like `lib/rate-limit.ts` and
// `lib/cron/scheduler.ts`, and worth knowing precisely rather than discovering
// later:
//
//   · **After a restart the ring is empty.** Every deploy, crash-restart and
//     host-initiated recycle resets it — which is why every answer carries the
//     boot time. An empty ring five seconds after a redeploy must not read as
//     health.
//   · **Several instances behind a load balancer answer separately.** The reply
//     carries a short instance id, and the command says that calling again may
//     sample another one. Aggregating across instances is what an APM does; that
//     is a decision with a monthly price on it, not the baseline.
//   · **A chatty stderr pushes older lines out.** `droppedLines` is reported so a
//     truncated window is visible rather than silent.
//   · **Browser-side errors are not in it.** `[browser] Uncaught …` blocks are
//     the DEV SERVER forwarding the browser's output; production has no such
//     channel.
//
// ── 🚨 The state hangs off `globalThis`, and that is not a slip ────────────
//
// `lib/rate-limit.ts` keeps its state in a module-level `const`, and this file
// follows its house style in everything EXCEPT that. Copying it here is a
// silent, total failure.
//
// `rate-limit.ts` is only ever read from inside the app graph. This buffer is
// **written from `instrumentation.ts` and read from a route** — two different
// Next entry points, and Next does not guarantee they share a module instance.
//
// The failure that produces: `installErrorCapture()` patches
// `process.stderr.write` (process-global, so the tap works and the host's log is
// fine) and fills ring **A**; `readWindow()` reads ring **B**, which is empty
// for ever. The endpoint answers `200 { findings: [] }` — green because it
// skipped.
//
// 🚨 **Measured, in this tree, rather than argued.** The `globalThis` lookup
// below was replaced with a module-level `let` — the tidy-looking version — and
// nothing else was touched. The result:
//
//     npm run typecheck    clean
//     npx vitest run       5339 passed, 0 failed
//     make deploy-test     RED: "the deployed app logged an error and its own
//                          endpoint reports none"
//
// Every unit test passes because vitest has ONE module registry and cannot
// reproduce the split. Only a booted app can, which is why the rung in the
// factory's `scripts/deploy-test.mjs` provokes a real error through a real
// request and then asks the endpoint for it.
//
// So: `globalThis[Symbol.for("ds24.diagnostics")]`. The next person to see a
// `globalThis` in this codebase will read it as a slip and "fix" it — the three
// lines above are what that costs, and they are reproducible.
//
// ── stdout is deliberately NOT tapped ──────────────────────────────────────
//
// `.dev/dev.log` is stdout+stderr, so tapping only stderr looks like half the
// job. It is not: every line the `BENIGN` list in `parse.mjs` exists to discard
// (`GET /x 200 …`, `✓ Ready`, `▲ Next.js`) is a stdout line. Tapping stdout
// would add volume and no findings, and it would push real error blocks out of
// a bounded ring faster. The next person will ask; this is the answer.
//
// ── and `console.error` is NOT tapped either ───────────────────────────────
//
// `console.error` sits ON TOP of stderr, so tapping the stream is a superset —
// it also catches Node's own unhandled-rejection dump, which no `console` hook
// sees. And `.dev/dev.log` is a stream capture, which is what makes the two
// inputs the same class rather than merely similar.

import { redactLine } from "./redact.mjs";

/** Whichever bites first. Constants, not configuration — see docs/DEPLOY.md. */
export const MAX_LINES = 500;
export const MAX_BYTES = 64 * 1024;

/** One retained line. `at` is what makes "since when" answerable. */
interface Entry {
  readonly seq: number;
  readonly at: number;
  readonly text: string;
}

interface Ring {
  entries: Entry[];
  bytes: number;
  /** Monotonic, never reset while the process lives. */
  seq: number;
  droppedLines: number;
  /** This process's boot time — part of every answer. */
  since: number;
  instance: string;
  /** A write that did not end on a newline waits here for the rest of its line. */
  partial: string;
  installed: boolean;
  /** Stops the tap recording its own output if anything below ever writes. */
  busy: boolean;
  original: StderrWrite | null;
}

type StderrWrite = typeof process.stderr.write;

const STATE = Symbol.for("ds24.diagnostics");

type Host = typeof globalThis & { [STATE]?: Ring };

function ring(): Ring {
  const host = globalThis as Host;
  let existing = host[STATE];
  if (!existing) {
    existing = {
      entries: [],
      bytes: 0,
      seq: 0,
      droppedLines: 0,
      since: Date.now(),
      // Short on purpose: it is a hint that two answers came from two
      // processes, never an identifier of anything.
      instance: Math.random().toString(36).slice(2, 8),
      partial: "",
      installed: false,
      busy: false,
      original: null,
    };
    host[STATE] = existing;
  }
  return existing;
}

/** Adds one finished line, evicting from the front until both caps hold. */
function push(state: Ring, raw: string): void {
  const text = redactLine(raw);
  state.seq += 1;
  state.entries.push({ seq: state.seq, at: Date.now(), text });
  state.bytes += Buffer.byteLength(text, "utf8") + 1;

  while (
    state.entries.length > MAX_LINES ||
    (state.bytes > MAX_BYTES && state.entries.length > 1)
  ) {
    const gone = state.entries.shift();
    if (!gone) break;
    state.bytes -= Buffer.byteLength(gone.text, "utf8") + 1;
    state.droppedLines += 1;
  }
}

/** Splits a chunk into whole lines, holding a partial tail for the next write. */
function absorb(state: Ring, chunk: unknown, encoding: unknown): void {
  let text: string;
  if (typeof chunk === "string") {
    text = chunk;
  } else if (chunk instanceof Uint8Array) {
    text = Buffer.from(chunk).toString(
      typeof encoding === "string" && Buffer.isEncoding(encoding) ? encoding : "utf8",
    );
  } else {
    return;
  }

  const combined = state.partial + text;
  const parts = combined.split(/\r?\n/);
  // The last part has no newline behind it yet — it is the start of a line that
  // will be completed by a later write. A cap on it too, so a process that
  // writes megabytes without a newline cannot grow this without bound.
  state.partial = parts.pop() ?? "";
  if (state.partial.length > MAX_BYTES) state.partial = state.partial.slice(-MAX_BYTES);

  for (const line of parts) push(state, line);
}

/**
 * Wrap `process.stderr.write` so every line also lands in the ring.
 *
 * Idempotent (`installed`), a no-op outside the Node runtime, and a no-op when
 * `DIAGNOSTICS_CAPTURE=off`. Called from `instrumentation.ts` before the
 * environment guard, because that guard's own `console.error` lines and the
 * scheduler's `[cron] tick failed` are exactly what an operator wants to find.
 *
 * 🚨 Three properties are load-bearing and none of them is decoration:
 *
 *   · **The original is called FIRST and its return value is passed back
 *     verbatim.** That value is backpressure. Returning `true` unconditionally
 *     makes a busy app buffer without bound, and a diagnostics tap that changes
 *     how the app writes is worse than no tap.
 *   · **The recording half cannot throw into a caller.** It is wrapped and the
 *     error is swallowed — there is no sensible way to report a failure here,
 *     and `console.error` from inside a stderr wrapper is a loop.
 *   · **It cannot recurse into itself.** `busy` guards the case where anything
 *     under `absorb()` ever writes to stderr.
 */
export function installErrorCapture(): void {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.DIAGNOSTICS_CAPTURE === "off") return;

  const state = ring();
  if (state.installed) return;
  state.installed = true;

  const original = process.stderr.write.bind(process.stderr) as StderrWrite;
  state.original = original;

  // Rest args, so both documented signatures — `(chunk, cb)` and
  // `(chunk, encoding, cb)` — travel through untouched.
  const wrapper = function (this: unknown, ...args: unknown[]) {
    const result = (original as (...a: unknown[]) => boolean)(...args);
    if (!state.busy) {
      state.busy = true;
      try {
        absorb(state, args[0], typeof args[1] === "string" ? args[1] : undefined);
      } catch {
        // A diagnostics tap must never be able to break a write.
      } finally {
        state.busy = false;
      }
    }
    return result;
  };

  process.stderr.write = wrapper as unknown as StderrWrite;
}

export interface Window {
  /** The highest sequence number issued so far — the mark for a later `after`. */
  seq: number;
  /** ISO — when THIS PROCESS started. An empty ring right after a restart. */
  since: string;
  instance: string;
  /** How many lines the answer holds. */
  retainedLines: number;
  /** ISO of the oldest retained line, or null when there are none. */
  oldest: string | null;
  /** Evicted since boot — a truncated window, visible rather than silent. */
  droppedLines: number;
  lines: string[];
}

/**
 * What is in the ring, optionally only what arrived after a mark.
 *
 * `after` is the remote twin of `markLog()`: take the `seq` before doing
 * something to the app, ask again with it afterwards, and you get the errors
 * your own requests caused rather than everything since boot.
 */
export function readWindow({ after }: { after?: number } = {}): Window {
  const state = ring();
  const kept =
    typeof after === "number" && Number.isFinite(after)
      ? state.entries.filter((entry) => entry.seq > after)
      : state.entries;

  return {
    seq: state.seq,
    since: new Date(state.since).toISOString(),
    instance: state.instance,
    retainedLines: kept.length,
    oldest: kept.length > 0 ? new Date(kept[0].at).toISOString() : null,
    droppedLines: state.droppedLines,
    lines: kept.map((entry) => entry.text),
  };
}

/** Test seam only — uninstalls the tap and forgets everything. */
export function resetCapture(): void {
  const host = globalThis as Host;
  const state = host[STATE];
  if (state?.installed && state.original) process.stderr.write = state.original;
  delete host[STATE];
}
