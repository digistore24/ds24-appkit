#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Set up mail delivery for the sign-in — interactive.
//
// Asks for the credentials, writes them into .env (which is gitignored) and
// sends a test mail on request. Afterwards the development sign-in disappears
// automatically and the magic-link sign-in is active.
//
// Two ways — exactly ONE of them gets configured:
//   Postmark  service with a free allowance; needs a server token
//             and a verified sender address (sender signature).
//   SMTP      any mail server/mailbox (your own provider's too).
//
// Usage:  node scripts/dev/mail-setup.mjs   (or: node run.mjs mail-setup)
import { createInterface } from "node:readline/promises";
import {
  appHost,
  emailDomain,
  isUnjudgeableHost,
  resolvedFrom,
  senderDomainProblem,
} from "../../lib/email-from.mjs";
import { commentEnvValue, setEnvValue } from "../lib/env-write.mjs";
import "../lib/env.mjs";

const ENV_FILE = ".env";

// This whole script is a conversation, so it needs somebody to have it with.
// Without a terminal — an agent running it through a tool, a pipe, a CI step —
// `rl.question` never returns, and `askRequired` below then loops on an empty
// answer forever: the command does not fail, it hangs until something outside
// kills it. Refused here, at the top, before a single value is asked for, and
// with the way through named. Same contract as `node run.mjs update`.
if (!process.stdin.isTTY) {
  console.error("✗ mail-setup asks questions and needs a terminal to ask them in.");
  console.error("  Nothing changed. Either the user runs it themselves:");
  console.error("      node run.mjs mail-setup");
  console.error("  or the values go into .env directly — docs/auth-setup.md lists them.");
  process.exit(2);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });

/** Question with an optional default value. */
async function ask(text, fallback = "") {
  const suffix = fallback ? ` [${fallback}]` : "";
  const answer = (await rl.question(`${text}${suffix}: `)).trim();
  return answer || fallback;
}

/** Required field — keeps asking until something is there. */
async function askRequired(text, fallback = "") {
  for (;;) {
    const value = await ask(text, fallback);
    if (value) return value;
    console.log("  (required)");
  }
}

/**
 * The sender address, held against the sender-domain rule (docs/auth-setup.md):
 * the From must live on the app's own domain, or the sign-in mails have the
 * exact shape of a phishing mail. This is the earliest moment anybody can say
 * so — the address is being typed right now. The wizard warns and asks rather
 * than refuses: DEV is where trying things out is legitimate, and the hard
 * line is held by the boot guard (lib/env-guard.ts) in STAGING/PROD.
 */
async function askSender(text, fallback = "") {
  const appUrl = process.env.APP_URL || "";
  const host = appHost(appUrl);

  for (;;) {
    const from = await askRequired(text, fallback);

    if (isUnjudgeableHost(host)) {
      console.log("  Note: once this app is live, the sender must be an address on the");
      console.log("  app's own domain — STAGING/PROD refuse to start otherwise");
      console.log("  (docs/auth-setup.md, \"the sender rule\").");
      return from;
    }

    if (!senderDomainProblem({ from, appUrl })) return from;

    console.log(`\n  ⚠ ${from} is not on the app's domain (${host}).`);
    console.log("  A mail whose links point at one domain but whose sender lives on another");
    console.log("  is the exact shape of a phishing mail. Recipients report it, and enough");
    console.log("  reports put the domain on Google's Safe Browsing \"Dangerous site\" list —");
    console.log("  blocking the whole app in Chrome. STAGING/PROD refuse to start like this");
    console.log(`  unless EMAIL_FROM_FOREIGN_DOMAIN=${emailDomain(from) ?? "<domain>"} acknowledges it`);
    console.log("  (docs/auth-setup.md).");
    const anyway = await ask("  Use this address anyway? (y/N)", "N");
    if (anyway.toLowerCase().startsWith("y")) return from;
    console.log("");
  }
}

/**
 * Writes values into .env: existing lines (commented-out ones too) are
 * replaced, missing ones are appended. The rest of the file stays untouched.
 *
 * This used to be a copy of scripts/lib/env-write.mjs and carried its bugs a
 * second time — there is exactly one .env writer, and this is not it.
 */
function writeEnv(values) {
  for (const [key, value] of Object.entries(values)) setEnvValue(ENV_FILE, key, value);
}

/** Comments out lines so that two transports are never set at the same time. */
function disable(keys) {
  for (const key of keys) commentEnvValue(ENV_FILE, key);
}

// Sends a test mail with the values just entered (the caller puts them into
// process.env via Object.assign beforehand).
async function sendTestMail(to) {
  const isPostmark = Boolean(process.env.POSTMARK_SERVER_TOKEN && process.env.POSTMARK_SENDER);
  // One From resolution for the whole template — lib/email.ts uses the same.
  const from = resolvedFrom(process.env);
  const subject = "Test mail from your app";
  const text = "If you are reading this, mail delivery works.\nThe magic-link sign-in is ready to use now.";

  if (isPostmark) {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Postmark-Server-Token": process.env.POSTMARK_SERVER_TOKEN,
      },
      body: JSON.stringify({
        From: from,
        To: to,
        Subject: subject,
        TextBody: text,
        MessageStream: process.env.POSTMARK_MESSAGE_STREAM || "outbound",
      }),
    });
    if (!res.ok) throw new Error(`Postmark ${res.status}: ${await res.text()}`);
    return;
  }

  const nodemailer = (await import("nodemailer")).default;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE) === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
  await transport.sendMail({ from, to, subject, text });
}

// ---------------------------------------------------------------------------

console.log("\nSet up mail delivery for the sign-in");
console.log("────────────────────────────────────");
console.log("The sign-in link (magic link) is sent by email. For that the app");
console.log("needs a mail account. As long as none is set up, there is the");
console.log("development sign-in locally — but not in staging and production:");
console.log("there, mail delivery is mandatory.\n");
console.log("  1) Postmark  — a service, free allowance, very reliable");
console.log("  2) SMTP      — your own mail server or your provider's mailbox\n");

const choice = await ask("How would you like to send? (1/2)", "1");

let values;
if (choice === "2" || choice.toLowerCase().startsWith("s")) {
  console.log("\nSMTP credentials (you get them from your mail provider):");
  const host = await askRequired("  Server (SMTP_HOST), e.g. smtp.strato.de", process.env.SMTP_HOST || "");
  const port = await ask("  Port (587 = STARTTLS, 465 = SSL)", process.env.SMTP_PORT || "587");
  const user = await askRequired("  Username", process.env.SMTP_USER || "");
  const pass = await askRequired("  Password", process.env.SMTP_PASSWORD || "");
  const from = await askSender("  Sender address (From)", process.env.SMTP_FROM || user);
  values = {
    SMTP_HOST: host,
    SMTP_PORT: port,
    SMTP_SECURE: port === "465" ? "true" : "false",
    SMTP_USER: user,
    SMTP_PASSWORD: pass,
    SMTP_FROM: from,
    EMAIL_FROM: from,
  };
  disable(["POSTMARK_SERVER_TOKEN", "POSTMARK_SENDER"]);
} else {
  console.log("\nPostmark credentials (Server → API Tokens):");
  console.log("The sender address has to be verified there as a sender signature.");
  const token = await askRequired("  Server token", process.env.POSTMARK_SERVER_TOKEN || "");
  const sender = await askSender("  Sender address", process.env.POSTMARK_SENDER || "");
  const stream = await ask("  Message stream", process.env.POSTMARK_MESSAGE_STREAM || "outbound");
  values = {
    POSTMARK_SERVER_TOKEN: token,
    POSTMARK_SENDER: sender,
    POSTMARK_MESSAGE_STREAM: stream,
    EMAIL_FROM: sender,
  };
  disable(["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"]);
}

writeEnv(values);
console.log(`\n✓ Saved in ${ENV_FILE} (that file is gitignored).`);

const to = await ask("\nSend a test mail to (empty = skip)", "");
if (to) {
  try {
    Object.assign(process.env, values);
    await sendTestMail(to);
    console.log(`✓ Test mail sent to ${to}. Have a look in your inbox (spam too).`);
  } catch (e) {
    console.error(`\n✗ Delivery failed: ${e.message}`);
    console.error("  Check the credentials and run `node run.mjs mail-setup` again.");
    rl.close();
    process.exit(1);
  }
}

console.log("\nNext step: node run.mjs restart");
console.log("After that the magic-link sign-in is active and the development sign-in is gone.");
rl.close();
