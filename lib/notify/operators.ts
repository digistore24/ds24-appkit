// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The way this app reaches the person who owns it.
//
// Before this file there was none: all three senders in `lib/email.ts` wrote to
// a MEMBER, the only owner query counted rather than listed, and every mail text
// was resolved out of the running request. `config/community.json` records the
// consequence in one line — "v1 has no notification channel and a silent expiry
// unblocks a spammer without anybody finding out".
//
// ── What belongs to this file, and what belongs to its caller ─────────────
// This owns: whether the channel is on, who the operator is, whether this
// message has already gone out, one delivery per recipient, and turning a
// transport failure into something a job may write down.
//
// The CALLER owns the words. It gets a translator and a formatter for the
// operator's language and composes with them, so its sentences live in its own
// namespace in `messages/{de,en}.json` and this file never grows a text key per
// feature.
//
// ── It does not throw when it cannot send ─────────────────────────────────
// Five reasons for silence, and none of them is an error: an app with no mail
// configured is the normal state in DEV, and a job that failed because the
// operator has not set up Postmark would be a red line in `cron_runs` about
// nothing.
//
// ── What DOES throw — three things, and each is a `NotifyError` ───────────
// The five reasons above are states of the app. These are faults, and cron
// rule 3 wants them loud:
//
//  * `badSendKey` — the caller handed a key the grammar refuses. A programming
//    error, not an operating state, so it is checked BEFORE anything else runs:
//    no config read, no owner query, no claim. It is the only one of the three
//    that says nothing about this app's health.
//  * `composeFailed` — the caller's own `compose()` threw. See below.
//  * `deliveryFailed` — a transport that was there and did not work.
//
// 🚨 **All three carry a COUNT and never a caller's string.** `lib/cron/run.ts`
// writes `error.message` into `cron_runs.lastDetail`, and that column promises
// to hold nothing personal (`docs/data-protection.md` §11, cron rule 2). The
// original always goes to `console.error`, where a human is reading.
//
// ── One marker debounces the MESSAGE, not the delivery ────────────────────
// ⚠️ If recipient 1 succeeds and recipient 2's transport fails, the run throws
// and the key stays claimed — so recipient 2 never gets this window's message,
// on this run or any later one, and recipient 1 has no way of knowing somebody
// is missing. That is structural rather than an oversight: `notification_sends`
// deliberately holds no recipient state (`db/schema-notify.ts`), and a key per
// recipient would force an address or an id into the key, which is exactly what
// the grammar and `docs/cron.md` forbid. Whoever needs a per-recipient delivery
// guarantee needs a different table, and that is a decision rather than an
// extension.

import {
  isPostmarkConfigured,
  isSmtpConfigured,
  sendOperatorMail,
  type OperatorMail,
} from "@/lib/email";
import { formatterFor, translatorFor, type Translate } from "@/i18n/translator";

import { isOperatorNotifyEnabled, notifyConfigProblems, operatorLocale } from "./config";
import { NotifyError } from "./errors";
import { operatorRecipients } from "./owners";
import { assertSendKey, claimSend } from "./sent-once";

export { NotifyError } from "./errors";
export type { NotifyErrorCode } from "./errors";

/** Why nothing was sent. Never an error — see the header. */
export type NotifyReason =
  | "disabledInConfig"
  | "brokenConfig"
  | "noTransport"
  | "noRecipients"
  | "alreadySent";

/** What a formatter for the operator's language looks like to a caller. */
export type Format = ReturnType<typeof formatterFor>;

export interface OperatorNotification {
  /**
   * What this message IS — and therefore what a second run must not repeat.
   *
   * 🚨 It has to name the WINDOW as well as the job: `courses-digest:2026-08-09`,
   * not `courses-digest`. A key without one is claimed on the first run and
   * never again, so the channel goes quiet for ever and looks like a channel
   * with nothing to say. The grammar is in `./sent-once.ts`.
   */
  key: string;

  /**
   * The message, in the operator's language.
   *
   * Called ONCE — there is one operator language, not one per recipient — and
   * given the translator and the formatter for it. The result is handed to
   * `sendOperatorMail` as it stands.
   */
  compose(t: Translate, format: Format): Omit<OperatorMail, "locale">;

  /** The tick's clock. Never `new Date()` inside a job. */
  now?: Date;
}

export interface NotifyResult {
  /** How many were delivered. */
  sent: number;
  /** How many the query found. Zero and `sent: 0` mean different things. */
  recipients: number;
  /** Null when it sent. */
  reason: NotifyReason | null;
}

const silent = (reason: NotifyReason, recipients = 0): NotifyResult => ({
  sent: 0,
  recipients,
  reason,
});

/**
 * Tell the operator something. One mail per operator, at most once per key.
 *
 * The five checks below run in a fixed order, and the order is the point: the
 * SWITCH is read before anything else, so an app with the channel off never asks
 * the database who its owners are. Same shape and same argument as
 * `modules/courses/module.ts`, where it is already written out. Ahead of all
 * five sits the key's grammar, which is not a check on this app but on the
 * caller — see step 0.
 *
 * And the last two steps are *compose, then claim, then send*, deliberately in
 * that order: everything that can throw on somebody else's behalf happens
 * before the key is spent.
 */
export async function notifyOperators(
  notification: OperatorNotification,
): Promise<NotifyResult> {
  // ── 0. The caller's own mistake, before anything at all ─────────────────
  // A malformed key is the one input this function takes that can be WRONG
  // rather than merely off, and refusing it here costs nothing. `claimSend()`
  // asks again on its own account; what this line buys is that the refusal
  // arrives before the config read and the owner query rather than after them.
  assertSendKey(notification.key);

  // ── 1 + 2. The switch, before any query ─────────────────────────────────
  // A broken file resolves to the closed default, so "off" has two causes and
  // they are worth telling apart: one is a decision somebody made, the other is
  // a typo they have not noticed. `notifyOffReason()` carries the detail for a
  // command line; the reason code is what a job may write down.
  if (!isOperatorNotifyEnabled()) {
    return silent(notifyConfigProblems().length > 0 ? "brokenConfig" : "disabledInConfig");
  }

  // ── 3. No transport is not a fault ──────────────────────────────────────
  // In DEV it is the normal state, and in STAGING/PROD the app would not have
  // started (`lib/env-guard.ts`). Answering quietly here is what keeps a
  // developer's tree from failing a job it was never going to be able to run —
  // and it changes nothing about that start condition in either direction.
  if (!isPostmarkConfigured() && !isSmtpConfigured()) return silent("noTransport");

  // ── 4. Somebody to write to ─────────────────────────────────────────────
  const recipients = await operatorRecipients();
  if (recipients.length === 0) return silent("noRecipients");

  // ── 5. Compose — BEFORE the claim, and that order is the point ──────────
  // 🚨 `compose()` is the caller's code, and `translatorFor()` fetches a
  // catalogue. Between a claim and the first delivery, a throw from either
  // would do two things at once: burn the key (this window's message lost for
  // good, since a claimed key is never claimed again) and send the raw error to
  // `cron_runs.lastDetail` past the very catch built to keep that column clean.
  // `./sent-once.ts` argues the losing trade for a TRANSPORT failure only; a
  // failure to compose is not one, and composing first costs nothing but the
  // work of a second run that turns out to be already sent.
  const locale = operatorLocale();
  let mail: OperatorMail;
  try {
    // Once, not per recipient: there is one operator language.
    mail = {
      locale,
      ...notification.compose(await translatorFor(locale), formatterFor(locale)),
    };
  } catch (error) {
    // Same containment as the delivery catch below, for the same column and the
    // same reason: `format.dateTime()` on a value that is not a `Date` throws
    // with the value in the message, and a caller's sentence is a caller's
    // sentence. The original goes where a human reads it.
    console.error(`[notify] composing an operator message failed:`, error);
    throw new NotifyError(
      "composeFailed",
      `the message for ${recipients.length} operator(s) could not be composed`,
    );
  }

  // ── 6. Not already said ─────────────────────────────────────────────────
  // The claim still stands BEFORE the first delivery — that is what makes two
  // processes on the same tick safe, and nothing above it can send.
  const now = notification.now ?? new Date();
  if (!(await claimSend(notification.key, now))) {
    return silent("alreadySent", recipients.length);
  }

  // Sequentially, and one address per delivery. Never a `cc`, never a `bcc`,
  // never a comma-separated `to`: two operators are third parties to each
  // other, and a collective recipient line is the form in which their addresses
  // become known to one another with nobody having decided that.
  let sent = 0;
  let failure: unknown = null;
  for (const recipient of recipients) {
    try {
      await sendOperatorMail(recipient.email, mail);
      sent += 1;
    } catch (error) {
      // 🚨 The provider's own text stops here. `sendViaPostmark` puts Postmark's
      // response body — which NAMES the recipient — into its message, and
      // `lib/cron/run.ts` writes `error.message` straight into
      // `cron_runs.lastDetail`, a column that promises to hold nothing personal
      // (`docs/data-protection.md` §11, cron rule 2). So the original goes to
      // the console, where a human is reading, and what travels on is a count.
      console.error(`[notify] delivery to an operator failed:`, error);
      failure ??= error;
    }
  }

  if (failure) {
    // Every recipient is attempted before this throws: one unreachable address
    // must not silence the operators it would have reached.
    throw new NotifyError(
      "deliveryFailed",
      `${sent} of ${recipients.length} operator mail(s) sent`,
    );
  }

  return { sent, recipients: recipients.length, reason: null };
}
