// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The one real call `node run.mjs ai-check --live` makes — its words, its
// ceiling, and the token shape its price is quoted for.
//
// ── Why this is a file of its own, and why it is `.mjs` ────────────────────
//
// Two places need the same three facts and they cannot import each other:
//
//   · `app/api/diagnostics/ai/route.ts` SENDS the probe (TypeScript, inside the
//     app, the only place `runTask()` can be reached from).
//   · `scripts/ai/check.mjs` PRICES it before it is sent (plain Node, no
//     bundler, no TypeScript — CLAUDE.md, "Three systems").
//
// Written twice, the price and the call drift the first time somebody makes the
// prompt longer: the command would go on announcing yesterday's figure and
// nobody would ever see the two disagree. So the prompt and the numbers quoted
// for it live in one file, and `app/api/diagnostics/ai/route.test.ts` asserts
// that what goes on the wire is what is named here.
//
// `.mjs` for the same reason `modules/companion/config.mjs` is — a script
// cannot import TypeScript, and a second copy for the script is the drift this
// file exists to prevent.

/**
 * Where the app answers "make one real call".
 *
 * Named here rather than in the script so the route and its caller cannot
 * disagree about the path — the same arrangement `OPS_HEALTH_PATH` has in
 * `scripts/health/probes/_transport.mjs`.
 */
export const LIVE_PATH = "/api/diagnostics/ai";

/**
 * The system prompt of the probe.
 *
 * Deliberately dull. It is not a test of the model's ability — it is a test of
 * whether the key, the model id, the network and the account behind them let a
 * request through at all, and every word of it is billed.
 */
export const PROBE_SYSTEM = "You are a connectivity probe. Answer with the single word OK.";

/** What the probe asks. One token where a provider's tokeniser is kind. */
export const PROBE_MESSAGE = "ping";

/**
 * The ceiling on the answer.
 *
 * A cap and not a hope: it is what the request actually carries, so it is also
 * the largest answer that can be billed. A model that ignores the instruction
 * and writes prose stops here.
 */
export const PROBE_MAX_TOKENS = 16;

/**
 * The token shape the announced price is quoted for.
 *
 * 🚨 **The output figure is the CAP, not the expected answer.** The command
 * prints this estimate *before* it causes the spend, and an estimate that
 * quotes the hoped-for case is a number somebody can be surprised by
 * afterwards. Two tokens of "OK" would make the printed figure smaller and
 * less true.
 *
 * The input figure is the system prompt plus the message plus what a provider
 * wraps around them, rounded up. Tokenisers differ by a few tokens between the
 * five companies and this is one number for all of them — which is why what is
 * printed says `~` and why the row that is written afterwards carries the
 * counts the provider itself reported.
 */
export const PROBE_INPUT_TOKENS = 32;
export const PROBE_OUTPUT_TOKENS = PROBE_MAX_TOKENS;

/**
 * How long one probe may take, end to end, from the command's side.
 *
 * Longer than the ten seconds the header-reading probes in
 * `scripts/health/probes/_transport.mjs` allow themselves, because this one
 * waits for a language model rather than for a header — and shorter than a
 * patience nobody has: a hung request inside a command nobody is watching the
 * network for is indistinguishable from a hung command, and the check somebody
 * interrupts is the check they stop running.
 */
export const PROBE_TIMEOUT_MS = 60_000;
