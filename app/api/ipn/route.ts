// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Digistore24 IPN webhook: POST /api/ipn
//
// Single-operator model: there is exactly one Digistore24 account per
// installation. The passphrase for signature verification comes from the
// environment (DIGISTORE_IPN_PASSPHRASE, set by `node run.mjs ds24-connect` or
// `node run.mjs ds24-ipn`); the owner of the records is the user with role = "owner" —
// see lib/digistore/settings.ts.
//
// This route does THREE things and nothing else: verify the SHA512 signature,
// answer the connection test, and hand an already-verified payload to
// onPaymentEvent() (lib/digistore/payment-event.ts), which decides whose
// payment it is and writes it.
//
// The signature check stays HERE, at the edge, and stays first. It must not
// move into the domain function, where a test of that function could stub it
// away.
import { verifyIpnSignature, type IpnParams } from "@/lib/digistore/ipn";
import { ds24IpnPassphrase } from "@/lib/digistore/settings";
import { onPaymentEvent } from "@/lib/digistore/payment-event";
import { classifyIpnRequest, recordIpnEvent } from "@/lib/digistore/ipn-log";
import { isLimited, record } from "@/lib/rate-limit";
import { callerKey } from "@/lib/setup/rules";

// ── The cap, and why there is one ──────────────────────────────────────────
//
// This route is public by design, `proxy.ts` covers only `/dashboard`, and
// `experimental.serverActions.bodySizeLimit` (next.config.ts) binds Server
// Actions, not Route Handlers. So until this line existed, anybody who could
// reach the URL could write as many bytes as they liked into `ipn_events` —
// measured against the running app on 2026-08-18: 45 B, 1 MB and 20 MB all
// answered 403 and all three landed in the table in full. Rejected and stored
// is the worst of both.
//
// 64 KiB is measured, not guessed: the CAPTURED on_payment in
// `lib/digistore/ipn-vectors.json` carries 173 parameters and 4567 bytes, so
// this is roughly fourteen times the real thing.
const MAX_IPN_BODY = 64 * 1024;

// The brake on the branches that are reachable WITHOUT a valid signature. It is
// defence in depth and not the fix — `callerKey()` keys on a header a caller
// can write (finding M-5), so the CAP above is what actually holds. Do not
// build these two the other way round.
const IPN_PREAUTH_BUCKET = "ipn:preauth";
const IPN_PREAUTH_LIMIT = { max: 60, windowMs: 15 * 60_000 };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Digistore24 validates the IPN URL during setup (ipnSetup) with a GET request
// and expects HTTP 200. So GET simply answers "OK" (no side effects).
export function GET() {
  return new Response("OK");
}

/**
 * May this unauthenticated request still cost a log row?
 *
 * `true` for the first `IPN_PREAUTH_LIMIT.max` in the window, `false` after
 * that. The caller answers the stranger identically either way — this decides
 * storage, not the reply.
 */
function allowPreAuthLog(request: Request): boolean {
  const caller = callerKey(request);
  if (isLimited(IPN_PREAUTH_BUCKET, caller, IPN_PREAUTH_LIMIT)) return false;
  record(IPN_PREAUTH_BUCKET, caller, IPN_PREAUTH_LIMIT);
  return true;
}

export async function POST(request: Request) {
  // 🚨 The announced length FIRST, before the body is pulled into memory at
  // all. `request.text()` buffers whatever arrives, so a check that runs after
  // it has already paid the cost it is there to avoid.
  const announced = Number(request.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > MAX_IPN_BODY) {
    // Nothing is logged. The payload IS the attack, and a log row is exactly
    // the thing it was aiming for.
    return new Response("Payload too large", { status: 413 });
  }

  // Read the form-urlencoded body.
  const raw = await request.text();

  // And again on what actually arrived — a `content-length` is a claim by the
  // caller, and a chunked request makes none at all. Byte length, not
  // `raw.length`: that counts UTF-16 units, so a multi-byte body would slip
  // through at roughly three times the cap.
  if (Buffer.byteLength(raw) > MAX_IPN_BODY) {
    return new Response("Payload too large", { status: 413 });
  }

  const body: IpnParams = Object.fromEntries(new URLSearchParams(raw));

  // Identifiers for the IPN log. Read here for logging only — the payment
  // handler reads them again itself. UNTRUSTED until the signature verifies,
  // which is why the log row also carries signatureValid.
  const event = body["event"] || "";
  const ds24OrderId = body["order_id"] || null;
  // RAW, and deliberately not the order id: this row records what ARRIVED.
  // Digistore24 sends no `purchase_id` (see lib/digistore/payment-event.ts), so
  // in practice this column stays NULL — and the day a payload does carry the
  // field, the log is where that becomes visible. The handler keys on the order
  // id; do not "align" this line with it, or the log stops being evidence and
  // starts being a copy of our own assumption.
  const ds24PurchaseId = body["purchase_id"] || null;

  // Signature check — fail closed. Without a passphrase nothing is processed.
  // The verdict (pure) decides both the response and the log entry; the
  // signature verification itself stays HERE, at the edge, and stays first.
  const passphrase = ds24IpnPassphrase();
  const signatureValid = Boolean(passphrase) && verifyIpnSignature(body, passphrase!);
  const disposition = classifyIpnRequest({
    hasPassphrase: Boolean(passphrase),
    signatureValid,
    event,
  });

  // The raw body is stored verbatim so a rejected/mis-signed IPN can be
  // diagnosed after the fact — recompute the signature over exactly what
  // arrived. Buyer PII lives in here, so ipn_events is pruned after 60 days.
  const logRow = { event, ds24OrderId, ds24PurchaseId, signatureValid, payload: raw };

  // 🚨 The two branches a stranger can reach. The brake decides whether the row
  // is WRITTEN — never what the caller is told: status, body and the absence of
  // any further work stay exactly as they were. A response that changed once
  // the brake engaged would tell an attacker which signatures were worth
  // trying, which is the same reason `guardDiagnostics()` answers every refusal
  // with one identical bodyless 404.
  if (disposition === "not_configured") {
    if (!allowPreAuthLog(request)) return new Response("IPN not configured", { status: 403 });
    await recordIpnEvent({ ...logRow, result: "not_configured" });
    return new Response("IPN not configured", { status: 403 });
  }
  if (disposition === "invalid_signature") {
    if (!allowPreAuthLog(request)) return new Response("Invalid signature", { status: 403 });
    await recordIpnEvent({ ...logRow, result: "invalid_signature" });
    return new Response("Invalid signature", { status: 403 });
  }
  if (disposition === "connection_test") {
    // Connection test from the DS24 backend: simply answer "OK". Deliberately
    // before anything is written — the test must also pass on a freshly set up
    // instance that has no operator account yet.
    await recordIpnEvent({ ...logRow, result: "connection_test" });
    return new Response("OK");
  }

  // A verified payment event. If processing throws, DS24 retries until it gets
  // OK/200 — so record the failure and re-throw (→ 500), never swallow it.
  try {
    await onPaymentEvent(body);
  } catch (error) {
    await recordIpnEvent({
      ...logRow,
      result: "error",
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  await recordIpnEvent({ ...logRow, result: "accepted" });
  // DS24 expects the body "OK" as the success response.
  return new Response("OK");
}
