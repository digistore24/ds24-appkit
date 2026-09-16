// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Probe 7 — can the sign-in mail leave the SERVER?
//
// Asked OF the app, like `media` and `ipn`, and for a sharper reason than
// theirs: here the operator's own machine gives the WRONG answer, not merely
// none. Several hosts block outbound SMTP on their cheaper plans (Railway below
// Pro). `node run.mjs mail-setup` had sent a test mail that arrived — from a
// laptop on a home connection — while the deployed app timed out on every
// sign-in (tester feedback, 2026-09-16). So the question goes to the one place
// that can answer it: `GET /api/diagnostics/health` → `mail`, the same request
// the two probes before this one share.
//
// ⚠️ What this does NOT prove, and every clean line says so: that a mail is
// delivered. For SMTP it is a TCP connection and nothing more; for Brevo and
// Postmark it is only which transport is configured. Whether the key is right
// is the wizard's test mail — that one is valid from any machine.
import { finding, notAsked, ranClean, ranFound, UNREACHABLE_REASON } from "../rules.mjs";
import { diagnosticsCredentials } from "../../dev/errors-remote.mjs";
import { OPS_HEALTH_PATH, readOpsHealth } from "./_transport.mjs";

const SWITCH =
  "Switch to an HTTPS transport: `node run.mjs mail-setup` → Brevo or Postmark, put the new " +
  "variables into the host's environment, remove the SMTP ones, redeploy.";

/** What each closed code means to a person, and what they should do about it. */
const FINDINGS = {
  timeout: {
    title: "The app cannot reach its SMTP server — the host probably blocks it",
    why:
      "Every sign-in mail leaves through that connection, and nothing answered. As it stands " +
      "nobody can sign in: the sign-in page loads, the button says a mail is on its way, and " +
      "none arrives. A test mail from your own computer proves nothing here — its network is " +
      "not the host's.",
    fix: `Several hosts block outbound SMTP on their cheaper plans (Railway does below Pro). ${SWITCH}`,
  },
  unreachable: {
    title: "The app cannot reach its SMTP server",
    why:
      "The server's network has no route to the mail server, so no sign-in mail can leave and " +
      "nobody can sign in.",
    fix: `The host is the likely cause — some block outbound SMTP outright. ${SWITCH}`,
  },
  refused: {
    title: "The app's SMTP server refuses the connection",
    why:
      "The mail server answered and said no on that port, so no sign-in mail can leave. That is " +
      "usually a wrong port rather than a blocked one.",
    fix:
      "Check SMTP_PORT at the host against your mail provider's documentation (587 = STARTTLS " +
      "with SMTP_SECURE=false, 465 = SSL with SMTP_SECURE=true). If the port is right, " +
      SWITCH.charAt(0).toLowerCase() +
      SWITCH.slice(1),
  },
  dns: {
    title: "The app's SMTP server name does not resolve",
    why: "SMTP_HOST names a server that does not exist from the host's point of view, so no sign-in mail can leave.",
    fix: "Check SMTP_HOST in the host's environment for a typo against your mail provider's documentation.",
  },
  badPort: {
    title: "SMTP_PORT is not a port",
    why: "The app cannot even try to connect, so no sign-in mail can leave and nobody can sign in.",
    fix: "Set SMTP_PORT at the host to the number your mail provider gives — usually 587.",
  },
};

export const mail = {
  id: "mail",
  label: "Its sign-in mail can leave",
  tier: 1,
  covers:
    "which transport the sign-in mail leaves through, and for SMTP whether the HOST lets the " +
    "connection out — the question a test mail from your own machine cannot answer",

  async run(ctx) {
    if (ctx.liveness?.state === "found") return notAsked(UNREACHABLE_REASON);

    const credentials = diagnosticsCredentials(ctx.env, ctx.url, ctx.askedEnv);
    if (credentials.reason) return notAsked(credentials.reason);

    const answer = await readOpsHealth({ ...ctx, secret: credentials.secret });
    if (!answer.ok) return notAsked(answer.reason);

    const state = answer.body.mail;
    if (!state) {
      return notAsked(
        "the app's health answer carried no mail state, so its code is older than this command — " +
          "redeploy it from this project and ask again",
      );
    }
    if (state.state === "unchecked") {
      return notAsked(`the app could not check its own mail transport (${state.code ?? "no code"})`);
    }

    const where = `${ctx.url}${OPS_HEALTH_PATH} → mail`;
    const smtp = state.smtp;
    const when = smtp ? (smtp.source === "boot" ? "at boot" : "on this request") : "";

    if (state.state === "finding") {
      const words = FINDINGS[state.code] ?? {
        title: "The app's mail transport reported a problem",
        why: "Sign-in mails may not leave; the app named a state this command does not know.",
        fix: SWITCH,
      };
      const observed = smtp
        ? `the app's own probe answered "${state.code}" for ${smtp.host}:${smtp.port} after ${smtp.ms} ms (${when}, ${smtp.probedAt})`
        : `the app's own probe answered "${state.code}"`;
      return ranFound(
        [finding({ severity: "high", ...words, where, evidence: observed })],
        `GET ${OPS_HEALTH_PATH} — ${observed}`,
      );
    }

    // 🚨 clean, and never bare — the three clean cases are three different facts.
    if (state.code === "noTransport") {
      return ranClean(
        "no mail transport is configured, so this is an app on the development sign-in — a " +
          "STAGING or PRODUCTION app refuses to start like this",
      );
    }
    if (state.code === "httpsTransport") {
      const name = state.transport === "brevo" ? "Brevo" : state.transport === "postmark" ? "Postmark" : state.transport;
      return ranClean(
        `sign-in mails leave over HTTPS via ${name}, which a host does not block the way it blocks ` +
          "SMTP — whether the key is right is what the test mail in `mail-setup` proves, not this",
      );
    }
    return ranClean(
      `the app opened a TCP connection to ${smtp?.host}:${smtp?.port} in ${smtp?.ms} ms (${when}) — ` +
        "the host lets SMTP out; a connection is not a delivery",
    );
  },
};
