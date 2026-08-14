// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Environment rules: DEV / STAGING / PROD.
//
// This template knows three environments (see docs/environments.md). They
// differ in more than name — hard rules hang off them:
//
//   DEV      local. Mail sending optional; as long as none is set up, the
//            development login exists (sign-in without a magic link).
//   STAGING  real domain, real user testing. Mail sending is MANDATORY,
//            the development login is ruled out.
//   PROD     real money, real customers. Mail sending is MANDATORY,
//            the development login is ruled out.
//
// The development login is an auth bypass (lib/auth/dev-login.ts). So that a
// forgotten env flag cannot let it slip into a real environment, this file
// checks the environment at server start (instrumentation.ts) and aborts
// instead of carrying on unsafely.

export type AppEnv = "development" | "staging" | "production";

import { senderDomainProblem } from "./email-from.mjs";
import { authUrlProblem } from "./auth/auth-url.mjs";

// --- Detecting the mail transport ----------------------------------------
// Deliberately here and not in lib/email.ts: these checks only read env values
// and pull in no dependencies. lib/email.ts depends on nodemailer — if
// instrumentation.ts imported from there, nodemailer would end up in the edge
// bundle and the app would stop starting ("Can't resolve 'stream'").

export interface MailEnv {
  POSTMARK_SERVER_TOKEN?: string;
  POSTMARK_SENDER?: string;
  SMTP_HOST?: string;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  // Index signature so process.env can be passed in directly.
  [key: string]: string | undefined;
}

export function hasPostmarkConfig(env: MailEnv): boolean {
  return Boolean(env.POSTMARK_SERVER_TOKEN && env.POSTMARK_SENDER);
}

export function hasSmtpConfig(env: MailEnv): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD);
}

/** true if at least one transport is fully configured. */
export function hasEmailConfig(env: MailEnv): boolean {
  return hasPostmarkConfig(env) || hasSmtpConfig(env);
}

export interface EnvCheckInput {
  APP_ENV?: string;
  NODE_ENV?: string;
  AUTH_SECRET?: string;
  emailConfigured: boolean;
  /**
   * The declared public URL — what the sender-domain rule compares against,
   * and where outgoing auth links take their origin from (`authOriginProblem()`
   * below).
   */
  APP_URL?: string;
  /**
   * AUTH_URL / NEXTAUTH_URL — normally nobody sets these: `auth.config.ts`
   * derives AUTH_URL from APP_URL. They are read here so that an operator's own
   * value can be compared against APP_URL rather than silently winning.
   */
  AUTH_URL?: string;
  NEXTAUTH_URL?: string;
  /**
   * The From address the app would send with (`resolvedFrom(process.env)`,
   * `lib/email-from.mjs`) — null when a transport is configured but no sender
   * is set, which is a fault of its own in a real environment: mails would go
   * out as "login@localhost".
   */
  emailFrom?: string | null;
  /**
   * EMAIL_FROM_FOREIGN_DOMAIN — the deliberate-decision override for a sender
   * on a foreign domain. Must name that domain itself; see `senderProblem()`.
   */
  emailFromForeignDomain?: string;
  /**
   * Which media driver this machine is set to, and whether its bucket is
   * configured. See `mediaProblem()` below for why this is a start condition
   * rather than a warning.
   */
  MEDIA_DRIVER?: string;
  mediaBucketConfigured?: boolean;
  /**
   * Whether the app accepts media at all (`config/media.json` → `enabled`).
   *
   * Passed in rather than read here: `instrumentation.ts` is built for the edge
   * runtime too, and importing the config module drags the product registry in
   * with it. The flag itself is plain JSON, so the hook reads that.
   */
  mediaEnabled?: boolean;
}

/**
 * Normalizes APP_ENV. Unknown values count as "production" — when in doubt the
 * strictest environment, not the loosest.
 */
export function appEnv(value?: string): AppEnv {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "" || v === "development" || v === "dev" || v === "local") {
    return "development";
  }
  if (v === "staging" || v === "test") return "staging";
  return "production";
}

/** true for environments real users see (STAGING and PROD). */
export function isRealEnvironment(value?: string): boolean {
  return appEnv(value) !== "development";
}

/**
 * Checks the environment and returns the list of violations (empty = fine).
 * A pure function, so it can be tested on its own in lib/env-guard.test.ts.
 */
export function checkEnvironment(env: EnvCheckInput): string[] {
  const problems: string[] = [];
  const environment = appEnv(env.APP_ENV);

  if (environment === "development") return problems;

  // From here on: STAGING or PROD.
  if (!env.emailConfigured) {
    problems.push(
      `APP_ENV=${environment}: No email delivery is configured. ` +
        "In STAGING and PROD it is mandatory — without it nobody could sign " +
        "in, and the development login is deliberately unavailable there. " +
        "Set up Postmark (POSTMARK_SERVER_TOKEN + POSTMARK_SENDER) " +
        "or SMTP (SMTP_HOST + SMTP_USER + SMTP_PASSWORD).",
    );
  }

  if (!env.AUTH_SECRET) {
    problems.push(
      `APP_ENV=${environment}: AUTH_SECRET is missing. Without a secret, ` +
        "sessions cannot be signed securely. Generate one with:\n" +
        `  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }

  const authOrigin = authOriginProblem(environment, env);
  if (authOrigin) problems.push(authOrigin);

  // Only when a transport IS configured — without one, the "no email delivery"
  // problem above already covers the case, and two messages for one missing
  // setup read like two faults.
  if (env.emailConfigured) {
    const sender = senderProblem(environment, env);
    if (sender) problems.push(sender);
  }

  const media = mediaProblem(environment, env);
  if (media) problems.push(media);

  return problems;
}

/**
 * The origin of the links the app MAILS OUT, on a real environment: taken from
 * `APP_URL`, or the app does not start.
 *
 * ── Why this is a refusal and not a warning ────────────────────────────────
 * The same shape as the sender rule below, one step further along: nothing
 * breaks on the day it is misconfigured. The app starts, every page answers
 * 200, `smoke` is green, the log is clean — and the sign-in mail carries a link
 * to an address that exists only inside the container. It was measured on a
 * real deployment (DigitalOcean App Platform, `http_port: 8080`): the mail said
 * `https://localhost:8080/api/auth/callback/email?…` and the customer could not
 * reach their own account. The only symptom is somebody telling you, and by
 * then it is every customer since the deploy.
 *
 * Without `APP_URL` there is nothing to derive the origin from and Auth.js
 * falls back to the request headers — which is exactly the state the failure
 * above was in. So a real environment does not start without it, which is what
 * `docs/DEPLOY.md` has been promising in its "refuses to start without them"
 * table all along.
 *
 * ── Why an operator's own AUTH_URL is compared rather than overruled ───────
 * `auth.config.ts` derives `AUTH_URL` from `APP_URL` and leaves an existing
 * value alone — a deployment that worked around this by hand must keep
 * working. But two variables meaning "where this app lives" and disagreeing is
 * a state nobody chose; one of them is then wrong, and which one it is cannot
 * be guessed from here. Origins are compared, so an `AUTH_URL` that merely
 * carries Auth.js's base path is not a disagreement.
 */
function authOriginProblem(environment: AppEnv, env: EnvCheckInput): string | null {
  const problem = authUrlProblem(env);
  if (!problem) return null;

  const head = `APP_ENV=${environment}: `;

  if (problem.code === "missingAppUrl") {
    return (
      head +
      "APP_URL is not set. It is the app's own address, and everything the app " +
      "MAILS OUT takes its origin from it — the sign-in link above all. " +
      "Without it Auth.js falls back to the request headers, and behind a " +
      "hosting router those say what the container calls itself " +
      '("localhost:8080" on DigitalOcean App Platform), so sign-in mails go ' +
      "out with a link nobody outside the container can open — while the app " +
      "itself looks perfectly healthy. Set APP_URL to the public domain, " +
      "https://, no trailing slash (docs/DEPLOY.md)."
    );
  }

  if (problem.code === "badAppUrl") {
    return (
      head +
      `APP_URL ("${problem.appUrl}") is not a URL, so the app cannot say ` +
      "where it lives. Sign-in links would then be built from the request " +
      "headers and point wherever the hosting router happens to say. It needs " +
      "the scheme too: https://your-domain.de, no trailing slash."
    );
  }

  if (problem.code === "badAuthUrl") {
    return (
      head +
      `AUTH_URL ("${problem.authUrl}") is not a URL. Normally nobody sets it — ` +
      `it is derived from APP_URL (${problem.appOrigin}) at startup. Remove ` +
      "it, or give it the app's own address."
    );
  }

  return (
    head +
    `AUTH_URL says this app lives at ${problem.authOrigin}, APP_URL says ` +
    `${problem.appOrigin}. One of the two is wrong, and which one cannot be ` +
    "guessed from here: AUTH_URL decides where sign-in links point, APP_URL " +
    "decides the mails' legal links, the checkout return and the IPN target — " +
    "so a running app would send half its customers to one address and half " +
    "to the other. Normally AUTH_URL is not set at all; it is derived from " +
    `APP_URL. Delete it (value: "${problem.authUrl}") unless you know why it ` +
    "is there."
  );
}

/**
 * The sender address on a real environment: on the app's own domain, or the
 * app does not start.
 *
 * ── Why this is a refusal and not a warning ────────────────────────────────
 * A sign-in mail whose links point at the app's domain but whose From lives on
 * another one is the exact shape of a phishing mail. Nothing breaks on the day
 * it is configured — the mails arrive, sign-in works, every test is green. The
 * failure arrives weeks later, from outside: recipients report the mails, and
 * enough reports put the app's domain on Google's Safe Browsing "Dangerous
 * site" list — which blocks the whole app in Chrome, for every visitor, and
 * takes a Search Console appeal to undo. A warning is the wrong instrument for
 * a fault that is invisible until it is expensive — the same shape as the mail
 * and media rules above.
 *
 * ── Why the override must NAME the domain ──────────────────────────────────
 * A foreign sender can be a deliberate, informed decision (a mail service on
 * its own domain, properly DKIM/SPF-verified there). The override for that is
 * EMAIL_FROM_FOREIGN_DOMAIN=<the foreign domain itself> — not a boolean,
 * because `=1` acknowledges nothing in particular: set once, it would silence
 * this check for every future sender too. Naming the domain makes the
 * acknowledgment specific — if the From later moves to yet another foreign
 * domain, the guard fires again.
 */
function senderProblem(environment: AppEnv, env: EnvCheckInput): string | null {
  const verdict = senderDomainProblem({
    from: env.emailFrom ?? null,
    appUrl: env.APP_URL,
    foreignDomainAck: env.emailFromForeignDomain,
  });
  if (!verdict) return null;

  if (verdict.code === "missingFrom") {
    return (
      `APP_ENV=${environment}: A mail transport is configured, but no sender ` +
      'address is set — mails would go out as "login@localhost", which ' +
      "receiving servers treat as spam at best. Set SMTP_FROM (SMTP) or " +
      "POSTMARK_SENDER (Postmark), or EMAIL_FROM as the fallback, to an " +
      "address on the app's own domain. `node run.mjs mail-setup` does it " +
      "interactively."
    );
  }

  if (verdict.code === "badOverride") {
    return (
      `APP_ENV=${environment}: EMAIL_FROM_FOREIGN_DOMAIN is set to a yes-flag. ` +
      "It must name the foreign sender domain itself " +
      `(EMAIL_FROM_FOREIGN_DOMAIN=${verdict.fromDomain ?? "<domain>"}) — a ` +
      "specific acknowledgment, so a sender that later moves to yet another " +
      "domain is caught again. See docs/auth-setup.md."
    );
  }

  if (!verdict.fromDomain) {
    return (
      `APP_ENV=${environment}: The sign-in mails' sender address ` +
      `("${verdict.from}") has no parseable domain, so it cannot be checked ` +
      `against the app's domain (${verdict.host}) — and an address that ` +
      "cannot be judged must not pass silently. Set a real address on " +
      `${verdict.host}; \`node run.mjs mail-setup\` does it interactively.`
    );
  }

  return (
    `APP_ENV=${environment}: The sign-in mails' sender address ` +
    `(${verdict.from}) is not on the app's own domain — the mails' links ` +
    `point at ${verdict.host}, the sender lives on ${verdict.fromDomain}. ` +
    "That is the exact shape of a phishing mail: recipients report it, and " +
    "enough reports put the domain on Google's Safe Browsing \"Dangerous " +
    "site\" list, which blocks the whole app in Chrome. Use an address on " +
    `${verdict.host} (\`node run.mjs mail-setup\`) and verify it at the ` +
    "provider (DKIM/SPF). If the foreign sender is a deliberate, informed " +
    `decision, set EMAIL_FROM_FOREIGN_DOMAIN=${verdict.fromDomain} — the ` +
    "Safe Browsing risk is then yours to carry. See docs/auth-setup.md."
  );
}

/**
 * Media on a real environment: object storage, or the app does not start.
 *
 * ── Why this is a refusal and not a warning ────────────────────────────────
 * `MEDIA_DRIVER=local` writes files to the machine's own disk. On one node that
 * works perfectly, which is exactly the problem: the failure it produces
 * appears only AFTER success. The first redeploy loses everything stored so
 * far. The second node makes an upload land on one disk and the next request be
 * answered by the other, so a file is there about half the time — which reaches
 * the operator as "customers say pictures disappear sometimes" and cannot be
 * reproduced on the machine anybody tests on.
 *
 * A warning is the wrong instrument for a fault that is invisible until it is
 * expensive. So this is the same shape as the mail rule above: STAGING and PROD
 * do not start without somewhere real to put things.
 *
 * ── Why an unconfigured bucket counts too ──────────────────────────────────
 * `MEDIA_DRIVER=s3` with no endpoint or no credentials is not "media off", it
 * is an app that accepts uploads and fails at the moment it tries to store one
 * — after the customer has waited for their file to travel. Failing at start is
 * the honest version, and `setup-hosting` books the bucket alongside the
 * database so that reaching this message is unusual.
 */
export function mediaProblem(
  environment: AppEnv,
  env: { MEDIA_DRIVER?: string; mediaBucketConfigured?: boolean; mediaEnabled?: boolean },
): string | null {
  if (environment === "development") return null;

  // An app that accepts no media needs nowhere to put it. Requiring a bucket
  // anyway made every app generated from 0.7.0 book storage before it could
  // deploy at all — including the ones that will never take a file. The cost of
  // this exemption is that switching media ON later without a bucket is a state
  // nothing refuses at startup, so `media-check` and `go-live` say so loudly
  // instead.
  if (env.mediaEnabled === false) return null;

  const driver = (env.MEDIA_DRIVER ?? "").trim().toLowerCase();

  if (driver === "" || driver === "local") {
    return (
      `APP_ENV=${environment}: MEDIA_DRIVER is "${driver || "unset"}", which ` +
      "stores uploaded files on this machine's own disk. That is a development " +
      "convenience and not storage: the next redeploy loses every file, and a " +
      "second instance cannot see what the first one wrote — so a customer's " +
      "picture is there roughly half the time, and nobody can reproduce it. " +
      "Set MEDIA_DRIVER=s3 and point it at a bucket (Amazon S3, DigitalOcean " +
      "Spaces, Cloudflare R2, Backblaze B2, Hetzner Object Storage — any of " +
      "them). The skill `setup-hosting` books one; `node run.mjs media-check` " +
      "verifies it."
    );
  }

  if (driver !== "s3") {
    return (
      `APP_ENV=${environment}: MEDIA_DRIVER="${driver}" is not a driver. ` +
      'Use "s3". See docs/visuals.md.'
    );
  }

  if (env.mediaBucketConfigured === false) {
    return (
      `APP_ENV=${environment}: MEDIA_DRIVER=s3, but the bucket is not ` +
      "configured. Needs MEDIA_S3_ENDPOINT, MEDIA_S3_BUCKET, " +
      "MEDIA_S3_ACCESS_KEY_ID and MEDIA_S3_SECRET_ACCESS_KEY. Without them an " +
      "upload fails after the customer has already waited for it to travel. " +
      "Check with: node run.mjs media-check"
    );
  }

  return null;
}
