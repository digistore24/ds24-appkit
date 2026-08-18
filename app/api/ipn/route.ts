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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Digistore24 validates the IPN URL during setup (ipnSetup) with a GET request
// and expects HTTP 200. So GET simply answers "OK" (no side effects).
export function GET() {
  return new Response("OK");
}

export async function POST(request: Request) {
  // Read the form-urlencoded body.
  const raw = await request.text();
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

  if (disposition === "not_configured") {
    await recordIpnEvent({ ...logRow, result: "not_configured" });
    return new Response("IPN not configured", { status: 403 });
  }
  if (disposition === "invalid_signature") {
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
