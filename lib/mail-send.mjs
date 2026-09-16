// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Handing ONE finished message to whichever transport is configured.
//
// Three transports, one decision (`mailTransport()` in `lib/email-from.mjs`):
//
//   brevo     HTTPS API, EU-hosted (Paris)      BREVO_API_KEY + BREVO_SENDER
//   postmark  HTTPS API, US-hosted              POSTMARK_SERVER_TOKEN + POSTMARK_SENDER
//   smtp      a raw connection to 587/465       SMTP_HOST + SMTP_USER + SMTP_PASSWORD
//
// Why a separate `.mjs` rather than the functions inside `lib/email.ts`: the
// wizard's test mail (`scripts/dev/mail-setup.mjs`) runs under plain Node and
// cannot import a TS module that pulls in the app's i18n and legal pages. It
// used to carry its own copy of both transports, and a test mail that takes a
// different road from the real mail proves the wrong road. Now both call this.
//
// 🚨 Never import this from `instrumentation.ts` or `lib/env-guard.ts`: it loads
// nodemailer, and that breaks the edge bundle ("Can't resolve 'stream'").
//
// 🚨 A provider's error text can name the recipient (Postmark's and Brevo's
// response bodies do, and so does an SMTP server's 550). This file keeps that
// text in the thrown message on purpose — a human reading the console needs it —
// and every caller that writes somewhere persistent strips it
// (`lib/notify/operators.ts`).
import { mailTransport, splitAddress } from "./email-from.mjs";
import { smtpTargetFromEnv, smtpUnreachableMessage } from "./diagnostics/smtp-probe.mjs";

/** What a timeout at the connection stage looks like from nodemailer. */
const CONNECTION_CODES = new Set(["ETIMEDOUT", "ESOCKET", "ECONNECTION", "EDNS"]);
const CONNECTION_WORDS = /ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN|Connection timeout|Greeting never received/;

/**
 * Whether an SMTP failure happened before the server ever answered — the case
 * where the credentials were never even tried, and a host blocking the port is
 * the likely cause. A rejection FROM the server (550, auth failed) is not one.
 *
 * @param {any} error
 */
export function isSmtpConnectionFailure(error) {
  if (!error || typeof error !== "object") return false;
  if (typeof error.responseCode === "number") return false;
  return CONNECTION_CODES.has(error.code) || CONNECTION_WORDS.test(String(error.message ?? ""));
}

/**
 * @typedef {{ from: string, to: string, subject: string, text: string, html?: string }} OutgoingMail
 */

/**
 * @param {Record<string, string | undefined>} env
 * @param {OutgoingMail} mail
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<void>}
 */
export async function sendMail(env, mail, { timeoutMs = 10_000 } = {}) {
  const transport = mailTransport(env);
  switch (transport) {
    case "postmark":
      return sendViaPostmark(env, mail, timeoutMs);
    case "brevo":
      return sendViaBrevo(env, mail, timeoutMs);
    case "smtp":
      return sendViaSmtp(env, mail, timeoutMs);
    default:
      throw new Error("No email transport configured (Brevo, Postmark or SMTP).");
  }
}

/** @param {Record<string, string | undefined>} env @param {OutgoingMail} mail @param {number} timeoutMs */
async function sendViaPostmark(env, mail, timeoutMs) {
  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": String(env.POSTMARK_SERVER_TOKEN),
    },
    body: JSON.stringify({
      From: mail.from,
      To: mail.to,
      Subject: mail.subject,
      ...(mail.html ? { HtmlBody: mail.html } : {}),
      TextBody: mail.text,
      MessageStream: env.POSTMARK_MESSAGE_STREAM || "outbound",
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`Postmark delivery failed (HTTP ${res.status}): ${await res.text()}`);
  }
}

/**
 * Brevo's transactional endpoint. The sender has to be a validated sender or
 * sit on a domain authenticated at Brevo, or it answers 400 — which the
 * wizard's test mail surfaces before anything is deployed.
 *
 * @param {Record<string, string | undefined>} env @param {OutgoingMail} mail @param {number} timeoutMs
 */
async function sendViaBrevo(env, mail, timeoutMs) {
  const { email, name } = splitAddress(mail.from);
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": String(env.BREVO_API_KEY),
    },
    body: JSON.stringify({
      sender: name ? { email, name } : { email },
      to: [{ email: mail.to }],
      subject: mail.subject,
      ...(mail.html ? { htmlContent: mail.html } : {}),
      textContent: mail.text,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`Brevo delivery failed (HTTP ${res.status}): ${await res.text()}`);
  }
}

/** @param {Record<string, string | undefined>} env @param {OutgoingMail} mail @param {number} timeoutMs */
async function sendViaSmtp(env, mail, timeoutMs) {
  const mod = await import("nodemailer");
  const nodemailer = mod.default ?? mod;
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === "true", // true = 465, otherwise STARTTLS
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    // nodemailer waits TWO MINUTES for a connection by default. Behind a host
    // that drops the packets that is two minutes per sign-in click, and the
    // browser gives up first with "this page couldn't load" — the symptom the
    // tester reported, with nothing in it pointing at mail. The same bound the
    // two HTTPS transports have.
    connectionTimeout: timeoutMs,
  });
  try {
    await transport.sendMail({
      to: mail.to,
      from: mail.from,
      subject: mail.subject,
      text: mail.text,
      ...(mail.html ? { html: mail.html } : {}),
    });
  } catch (error) {
    // A bare "Connection timeout" is what an operator saw on every sign-in on a
    // host that blocks SMTP, with nothing saying which way to go. The same
    // sentence the boot probe prints, with the original kept as the cause.
    const target = smtpTargetFromEnv(env);
    if (target && isSmtpConnectionFailure(error)) {
      throw new Error(smtpUnreachableMessage(target), { cause: error });
    }
    throw error;
  }
}
