// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The channel's one error type.
//
// It lives in a file of its own rather than beside `notifyOperators()` because
// `sent-once.ts` throws it and `operators.ts` imports `sent-once.ts` — the two
// would otherwise be a cycle. `operators.ts` re-exports it, so callers see one
// entry point either way.

/**
 * Reasons the channel refuses or fails outright, as codes rather than prose.
 *
 * Three, and they are three different owners: `badSendKey` is the CALLER's
 * mistake in an argument, `composeFailed` the caller's code throwing while it
 * writes the message, `deliveryFailed` this app's transport. None of them is an
 * operating state — those are `NotifyReason` and they never throw.
 */
export type NotifyErrorCode = "badSendKey" | "composeFailed" | "deliveryFailed";

/**
 * A refusal or a failure from the operator channel.
 *
 * ⚠️ **The message is written for `cron_runs`.** Whatever a caller puts in it may
 * end up in `cron_runs.lastDetail` (`lib/cron/run.ts` stores `error.message` on
 * a failed job), and that table promises to hold nothing personal
 * (`docs/data-protection.md` §11, cron rule 2). So: counts, not addresses.
 */
export class NotifyError extends Error {
  constructor(
    readonly code: NotifyErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "NotifyError";
  }
}
