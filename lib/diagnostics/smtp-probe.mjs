// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Can THIS server reach its SMTP server? — asked from the place the mail
// actually leaves, not from the developer's machine.
//
// Why it exists (tester feedback, 2026-09-16): several hosts block outbound
// SMTP on their cheaper plans — Railway does on everything below Pro. An app
// set up with SMTP there starts, passes every check, and times out on every
// sign-in. `node run.mjs mail-setup` had sent a test mail that ARRIVED — from
// the operator's laptop, which proved the credentials and hid the cause. On the
// server the log said `Connection timeout` and nothing said which way to go.
//
// So there are three askers, and they share this one file:
//
//   · the boot hook (`instrumentation.ts`) probes once in STAGING/PROD and
//     WARNS — never aborts: a mail server having a slow minute must not take
//     the whole app down with it;
//   · `lib/ops/health.ts` answers `node run.mjs health --url` from the cache
//     below, re-probing when the answer is old;
//   · `lib/mail-send.mjs` turns a connection failure at send time into the
//     same sentence, so the error names a direction and not just a timeout.
//
// It is `.mjs` with no app imports, like `lib/email-from.mjs`, so the send path
// the scripts use can import it too. It is NOT `scripts/dev/ports.mjs`: that one
// folds refused, unreachable and timed out into one `false`, which is right for
// "is my port free" and exactly wrong here — "refused" is a wrong port,
// "timeout" is a host that drops the packets. And `scripts/` does not ship in a
// standalone build.
//
// ⚠️ A connection is not a delivery. This opens TCP and closes it again: no
// greeting, no TLS, no login. "Reachable" means the host lets the packets out,
// never that mail works — every text built from a clean result says so.
import net from "node:net";

/** Long enough for a slow handshake across an ocean, short enough for boot. */
export const SMTP_PROBE_TIMEOUT_MS = 3_000;

/**
 * How long an answer is reused. A host that blocks SMTP blocks it for good, so
 * five minutes of staleness loses nothing — and it caps what anybody holding
 * `DIAGNOSTICS_SECRET` can make this server do at one connection per window.
 */
export const SMTP_PROBE_TTL_MS = 5 * 60_000;

/**
 * 🚨 On `globalThis`, not in a module-level `let`. The boot hook and the route
 * handler are separate Next.js entry points with separate module instances —
 * measured for the error ring in `lib/diagnostics/capture.ts`, where the tidy
 * `let` passed every unit test and failed a booted app. A boot answer kept in a
 * `let` here would never be seen by the route that is supposed to report it.
 */
const STATE_KEY = Symbol.for("ds24.smtp-probe");

function state() {
  const g = /** @type {Record<symbol, any>} */ (globalThis);
  g[STATE_KEY] ??= { snapshot: null, inflight: null };
  return g[STATE_KEY];
}

/**
 * The server and port the app would connect to, read the way the send path
 * reads them (`SMTP_PORT` defaults to 587).
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ host: string, port: number, valid: boolean } | null} null without a host
 */
export function smtpTargetFromEnv(env) {
  const host = String(env.SMTP_HOST ?? "").trim();
  if (!host) return null;
  const raw = String(env.SMTP_PORT ?? "").trim();
  const port = raw ? Number(raw) : 587;
  const valid = Number.isInteger(port) && port > 0 && port < 65536;
  return { host, port, valid };
}

/**
 * The one sentence every asker prints — the boot line, the send error, the
 * `errors` hint and the `health` finding all point the same way.
 *
 * @param {{ host: string, port: number }} target
 */
export function smtpUnreachableMessage({ host, port }) {
  return (
    `SMTP ${host}:${port} is not reachable from this server — the host probably blocks ` +
    "outbound SMTP (Railway does below its Pro plan); use an HTTPS transport instead " +
    "(Brevo or Postmark): node run.mjs mail-setup"
  );
}

/**
 * @typedef {"timeout" | "refused" | "dns" | "unreachable"} ProbeFailure
 * @typedef {{ reachable: true, ms: number }
 *   | { reachable: false, code: ProbeFailure, ms: number, error: Error }} ProbeResult
 */

/** @param {any} error @returns {ProbeFailure} */
function classify(error) {
  switch (error?.code) {
    case "ECONNREFUSED":
      return "refused";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "dns";
    case "ETIMEDOUT":
      return "timeout";
    default:
      return "unreachable";
  }
}

/**
 * One TCP connection attempt. Never throws, never leaves a socket open.
 *
 * @param {{ host: string, port: number }} target
 * @param {{ timeoutMs?: number, connect?: (options: { host: string, port: number }) => import("node:net").Socket }} [options]
 *   `connect` is the seam the tests use; production is `net.connect`.
 * @returns {Promise<ProbeResult>}
 */
export function probeTcp({ host, port }, { timeoutMs = SMTP_PROBE_TIMEOUT_MS, connect = net.connect } = {}) {
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    /** @type {import("node:net").Socket | null} */
    let socket = null;
    const finish = (/** @type {ProbeResult} */ result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket?.destroy();
      resolve(result);
    };
    // Our own timer rather than `socket.setTimeout`: that one measures
    // inactivity on an open socket, and a SYN that is silently dropped — the
    // blocked-port case this file exists for — is not "an open socket".
    const timer = setTimeout(() => {
      const error = Object.assign(new Error(`connect ETIMEDOUT ${host}:${port}`), { code: "ETIMEDOUT" });
      finish({ reachable: false, code: "timeout", ms: Date.now() - started, error });
    }, timeoutMs);
    try {
      socket = connect({ host, port });
      socket.once("connect", () => finish({ reachable: true, ms: Date.now() - started }));
      socket.once("error", (error) =>
        finish({ reachable: false, code: classify(error), ms: Date.now() - started, error }),
      );
    } catch (error) {
      finish({
        reachable: false,
        code: classify(error),
        ms: Date.now() - started,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  });
}

/**
 * @typedef {{
 *   host: string,
 *   port: number,
 *   reachable: boolean,
 *   code: ProbeFailure | "badPort" | null,
 *   ms: number,
 *   probedAt: string,
 *   source: "boot" | "request",
 * }} SmtpSnapshot
 *
 * Facts only — no Error, no message. It travels to `/api/diagnostics/health`,
 * and a caught error's words are the one thing that endpoint never carries.
 */

/**
 * The SMTP answer, reused while it is younger than `ttlMs` and shared between
 * concurrent callers. `null` when SMTP is not configured at all.
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ source: "boot" | "request", now?: number, ttlMs?: number, timeoutMs?: number,
 *           connect?: (options: { host: string, port: number }) => import("node:net").Socket }} options
 * @returns {Promise<SmtpSnapshot | null>}
 */
export async function cachedSmtpProbe(env, { source, now = Date.now(), ttlMs = SMTP_PROBE_TTL_MS, timeoutMs, connect } = { source: "request" }) {
  const target = smtpTargetFromEnv(env);
  if (!target) return null;

  if (!target.valid) {
    return {
      host: target.host,
      port: target.port,
      reachable: false,
      code: "badPort",
      ms: 0,
      probedAt: new Date(now).toISOString(),
      source,
    };
  }

  const shared = state();
  const cached = shared.snapshot;
  if (
    cached &&
    cached.host === target.host &&
    cached.port === target.port &&
    now - Date.parse(cached.probedAt) < ttlMs
  ) {
    return cached;
  }
  if (shared.inflight) return shared.inflight;

  shared.inflight = (async () => {
    try {
      const result = await probeTcp(target, { timeoutMs, connect });
      /** @type {SmtpSnapshot} */
      const snapshot = {
        host: target.host,
        port: target.port,
        reachable: result.reachable,
        code: result.reachable ? null : result.code,
        ms: result.ms,
        probedAt: new Date(now).toISOString(),
        source,
      };
      shared.snapshot = snapshot;
      // The Error is handed to the boot line and nowhere else.
      shared.lastError = result.reachable ? null : result.error;
      return snapshot;
    } finally {
      shared.inflight = null;
    }
  })();
  return shared.inflight;
}

/**
 * The boot-time half: probe once, say what came out, never throw.
 *
 * The failure line has the house shape `[prefix] sentence: <Error>` on purpose
 * — it is what `lib/diagnostics/parse.mjs` recognises, so
 * `node run.mjs errors --url …` finds it on a deployed app. The success line
 * starts with `•`, which that parser treats as benign.
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ timeoutMs?: number, connect?: (options: { host: string, port: number }) => import("node:net").Socket,
 *           log?: (...args: unknown[]) => void, error?: (...args: unknown[]) => void }} [options]
 * @returns {Promise<SmtpSnapshot | null>}
 */
export async function bootSmtpProbe(env, { timeoutMs, connect, log = console.log, error = console.error } = {}) {
  try {
    const snapshot = await cachedSmtpProbe(env, { source: "boot", timeoutMs, connect, ttlMs: 0 });
    if (!snapshot) return null;
    if (snapshot.code === "badPort") {
      error(
        `[mail] SMTP_PORT is not a port (${env.SMTP_PORT}) — no sign-in mail can leave:`,
        new Error(`invalid SMTP_PORT ${env.SMTP_PORT}`),
      );
    } else if (snapshot.reachable) {
      log(`• Mail: SMTP ${snapshot.host}:${snapshot.port} reachable (${snapshot.ms} ms)`);
    } else {
      error(`[mail] ${smtpUnreachableMessage(snapshot)}:`, state().lastError ?? new Error(snapshot.code ?? "unreachable"));
    }
    return snapshot;
  } catch (caught) {
    // A diagnostic that breaks the boot would be worse than no diagnostic.
    error("[mail] the SMTP reachability probe itself failed:", caught);
    return null;
  }
}

/** Test seam: forget every cached answer. */
export function resetSmtpProbe() {
  const g = /** @type {Record<symbol, any>} */ (globalThis);
  delete g[STATE_KEY];
}
