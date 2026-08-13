#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Diagnose a failed IPN signature from the stored payload.
//
// The IPN log (app/dashboard/admin/purchases → IPN-Log) keeps the full raw body
// of every IPN, so a "signature invalid" can be investigated after the fact:
// recompute the SHA over exactly what arrived and see whether — and with which
// rule — it matches the sha_sign Digistore24 sent.
//
// It recomputes the canonical algorithm (lib/digistore/ipn.ts) AND a handful of
// known variants (no uppercasing, HTML-decoded values, keep duplicate keys,
// keep empty values, sha1/sha256). The variant that matches names the exact
// rule Digistore24 used — which is the fix for ipn.ts if the canonical one is
// wrong. If NONE match, the passphrase itself is the suspect.
//
// Usage:
//   node scripts/ds24/ipn-verify.mjs                 # newest invalid_signature row
//   node scripts/ds24/ipn-verify.mjs --order ABC123  # by Digistore24 order id
//   node scripts/ds24/ipn-verify.mjs --all           # every invalid row, newest first
//   Via the runner:  node run.mjs ds24-ipn-verify     (or: … --order ABC123)
import crypto from "node:crypto";
import "../lib/env.mjs";
import { connectUtc } from "../lib/pg-utc.mjs";

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") out.all = true;
    else if (a === "--order") out.order = argv[++i];
    else out._.push(a);
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

const passphrase = process.env.DIGISTORE_IPN_PASSPHRASE || "";
if (!passphrase) {
  console.error("ERROR: DIGISTORE_IPN_PASSPHRASE is not set (see .env).");
  process.exit(2);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("ERROR: DATABASE_URL is not set (see .env).");
  process.exit(2);
}

// All KEY/VALUE pairs, order preserved and duplicates KEPT — the faithful view
// of the body. URLSearchParams decodes %XX and turns "+" into a space, exactly
// as a PHP $_POST would, so the values match what Digistore24 signed.
function pairsOf(payload) {
  return [...new URLSearchParams(payload)];
}

function shaString(pairs, { uppercase, htmlDecode, keepEmpty }) {
  const prepared = pairs
    .map(([k, v]) => [uppercase ? k.toUpperCase() : k, v])
    .filter(([k]) => {
      const up = k.toUpperCase();
      return up !== "SHA_SIGN" && up !== "SHASIGN";
    })
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  let s = "";
  for (const [k, vRaw] of prepared) {
    const v = htmlDecode ? htmlEntityDecode(vRaw) : vRaw;
    if (!keepEmpty && (v === "" || v === null || v === undefined)) continue;
    s += `${k}=${v}${passphrase}`;
  }
  return s;
}

// A minimal html_entity_decode — DS24's sha_sign example has a do_html_decode
// switch; if it was on, a value like "Müller &amp; Sohn" was signed as "&".
function htmlEntityDecode(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'");
}

function hash(algo, s) {
  return crypto.createHash(algo).update(s, "utf8").digest("hex").toUpperCase();
}

// The variants to try. The first is the canonical one (lib/digistore/ipn.ts).
const VARIANTS = [
  { name: "canonical (uppercase, sha512, skip-empty)", algo: "sha512", uppercase: true, htmlDecode: false, keepEmpty: false, dedupe: false },
  { name: "keep duplicate keys collapsed (Object.fromEntries)", algo: "sha512", uppercase: true, htmlDecode: false, keepEmpty: false, dedupe: true },
  { name: "html-decoded values", algo: "sha512", uppercase: true, htmlDecode: true, keepEmpty: false, dedupe: false },
  { name: "keep empty values", algo: "sha512", uppercase: true, htmlDecode: false, keepEmpty: true, dedupe: false },
  { name: "original-case keys", algo: "sha512", uppercase: false, htmlDecode: false, keepEmpty: false, dedupe: false },
  { name: "sha256", algo: "sha256", uppercase: true, htmlDecode: false, keepEmpty: false, dedupe: false },
  { name: "sha1", algo: "sha1", uppercase: true, htmlDecode: false, keepEmpty: false, dedupe: false },
];

function dedupePairs(pairs) {
  // Object.fromEntries semantics: last value wins, but iteration order follows
  // first insertion — matches how the app collapses the body today.
  const seen = new Map();
  for (const [k, v] of pairs) seen.set(k, v);
  return [...seen.entries()];
}

function diagnose(row) {
  const received = (new URLSearchParams(row.payload).get("sha_sign") || "").toUpperCase();
  console.log(`\n──────── order ${row.ds24_order_id ?? "?"} · ${row.received_at.toISOString()} · ${row.result}`);
  console.log(`received sha_sign: ${received || "(none in payload)"}`);
  if (!received) {
    console.log("→ No sha_sign in the payload — Digistore24 sent none, or the field name differs.");
    return;
  }
  let matched = null;
  for (const v of VARIANTS) {
    const pairs = v.dedupe ? dedupePairs(pairsOf(row.payload)) : pairsOf(row.payload);
    const computed = hash(v.algo, shaString(pairs, v));
    const ok = computed === received;
    console.log(`  ${ok ? "✓ MATCH " : "  ·     "} ${v.name}`);
    if (ok && !matched) matched = v;
  }
  if (matched) {
    console.log(`\n→ Matches "${matched.name}".`);
    if (matched.name.startsWith("canonical")) {
      console.log("  The signature is actually VALID for this passphrase — if the app rejected");
      console.log("  it, the passphrase in .env differed FROM the one at that moment.");
    } else {
      console.log("  lib/digistore/ipn.ts should be adjusted to this rule.");
    }
  } else {
    console.log("\n→ No variant matches. The PASSPHRASE is the suspect:");
    console.log("  the value in .env is not the one Digistore24 signed with. Re-run");
    console.log("  `node run.mjs ds24-sync` so DS24 stores the passphrase from your .env, then");
    console.log("  re-trigger the IPN.");
  }
}

const sql = connectUtc(url, { max: 1 });
try {
  const where = args.order
    ? sql`ds24_order_id = ${args.order}`
    : sql`result = 'invalid_signature'`;
  const limit = args.all ? 50 : 1;
  const rows = await sql`
    select received_at, ds24_order_id, result, payload
    from ipn_events
    where ${where} and payload is not null
    order by received_at desc
    limit ${limit}`;
  if (rows.length === 0) {
    console.log("No matching IPN with a stored payload found.");
    console.log("(Rows recorded before the payload column was added have none — re-trigger the IPN.)");
  } else {
    for (const row of rows) diagnose(row);
  }
} finally {
  await sql.end({ timeout: 5 });
}
