// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Every IPN field this app reads, against a message Digistore24 really sent.
//
// ── Why this file exists ───────────────────────────────────────────────────
//
// For a year this app read `body["purchase_id"]` and hung the entitlement, the
// subscription mirror and the auto top-up mandate on it. **Digistore24 sends no
// such field.** It appears in no IPN parameter table Digistore24 publishes, and
// a captured live `on_payment` carries 173 parameters without it. The
// consequence was as bad as it gets in this product: the order was recorded, the
// money was real, and `activateGrant` refused for want of a key — a paying
// customer with no access, in every app built from this template.
//
// Nothing went red anywhere, and the reason is the shape of the evidence rather
// than a missing test. Every test of the payment handler builds its own payload,
// and a self-built message says only what its author already believed. The
// fixture supplied `purchase_id`, the handler read `purchase_id`, and the two
// agreed with each other about a field the sender does not send. Vectors existed
// too — `./ipn-vectors.json` — but they measured the SIGNATURE, which is a
// question about bytes and not about which fields arrive.
//
// So this file asks the one question none of them asked: **every parameter name
// this app reads out of an IPN body — does the sender send it?** The reference
// is `captured-on-payment` in `./ipn-vectors.json`: a real message, captured
// from a live connection and redacted value by value, with its key set
// untouched. It is cheap (no database, no network) and it is the only check here
// whose answer comes from Digistore24 rather than from us.
//
// ── What a failure means ───────────────────────────────────────────────────
//
// A new name in the finding list is one of three things, and they are not the
// same repair:
//
//   1. **A field that does not exist.** The `purchase_id` case. Fix the read.
//   2. **A field that exists but not in THIS message** — the captured payment is
//      a `single_payment`, so nothing about rebilling is in it. Add it to
//      `ELSEWHERE` below WITH the reason, which is a sentence somebody has to be
//      able to defend.
//   3. **A name of our own.** Four such aliases sat in the handler as `||`
//      alternatives and were dead in every app that ever ran. Delete them: a
//      dead alternative is what makes wrong code look like it knows several
//      spellings.
//
// ⚠️ `ELSEWHERE` is an allowlist and allowlists rot. Every entry carries its
// reason, and a reason that is only "it was there before" is not one.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, it, expect } from "vitest";
import { blankComments } from "@/scripts/lib/source-text.mjs";

import vectors from "./ipn-vectors.json";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Where an IPN reader can live. Not a list of FILES: the readers are found by
 * the type they take, so a fifth one — or a module that starts reading the
 * payload — is covered the day it lands rather than the day somebody remembers
 * this file.
 */
const SEARCHED = ["app", "lib", "modules", "scripts"];

/**
 * The captured message, and the only thing in this repo that answers "what does
 * Digistore24 send" without an opinion in it.
 */
const CAPTURED = "captured-on-payment";

/**
 * Real Digistore24 fields that this particular capture cannot contain, each with
 * the reason it is absent. Anything else this app reads is a finding.
 *
 * `onlyIn` narrows an entry to one file, and it is not a nicety: measured while
 * building this file, a plain name-level allowance for `purchase_id` let the
 * ORIGINAL DEFECT back in with all four tests green — the handler read the
 * field again and the allowlist covered it. An exemption that is not scoped to
 * the place that earned it is an exemption for the whole tree.
 */
const ELSEWHERE: Record<string, { why: string; onlyIn?: string }> = {
  next_payment_at: {
    why:
      "Rebilling section of the DS24 parameter table — sent for billing_type " +
      "subscription/installment only, and the captured message is a single_payment.",
  },
  other_billing_intervals: {
    why:
      "Same section, same reason: the interval between the second and third " +
      "payment does not exist for a one-off purchase.",
  },
  SHASIGN: {
    why:
      "The uppercase spelling of sha_sign. Digistore24's own example script has a " +
      "convert_keys_to_uppercase switch, and ./ipn.ts accepts either convention " +
      "because both need the passphrase — so reading both names costs nothing and " +
      "spares an operator a signature that will not verify.",
  },
  purchase_id: {
    why:
      "🚨 The field this whole file is about, and the ONE place it may still be " +
      "read: the route records it on the log row. That row is evidence of what " +
      "ARRIVED — in practice always NULL, and the day a payload does carry the " +
      "field, the log is where it becomes visible. Nothing keys on it, and " +
      "`onlyIn` is what makes that a property of the code rather than a promise.",
    onlyIn: "app/api/ipn/route.ts",
  },
};

function sourceFilesIn(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFilesIn(full));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Every file that handles an IPN body, found by the TYPE it names.
 *
 * `IpnParams` is `Record<string, string>` and exists for exactly this payload,
 * so a file that mentions it is a file that reads one. A test file is excluded
 * on purpose: a fixture may name whatever it likes, and pinning the FIXTURES to
 * the captured message is what `payment-event.test.ts` does in its own terms.
 */
function ipnReaders(): string[] {
  return SEARCHED.flatMap((dir) => sourceFilesIn(join(ROOT, dir))).filter((file) =>
    readFileSync(file, "utf8").includes("IpnParams"),
  );
}

/** Every `something["key"]` read in a file, comments blanked first. */
function keysReadIn(file: string): string[] {
  const source = blankComments(readFileSync(file, "utf8"));
  return [...source.matchAll(/\[\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*\]/g)].map((m) => m[1]);
}

const capturedKeys = new Set(
  Object.keys(vectors.vectors.find((v) => v.name === CAPTURED)?.params ?? {}),
);

describe("the IPN fields this app reads", () => {
  it("has a captured live message to measure against", () => {
    // Non-vacuity, and it is the whole file's foundation: every assertion below
    // is "not in this set", which a small or missing set answers cheerfully.
    // 173 is what the capture had; the guard is deliberately loose about the
    // exact number and hard about the order of magnitude.
    expect(capturedKeys.size).toBeGreaterThan(150);
    expect(capturedKeys.has("order_id")).toBe(true);
    // The finding itself, frozen: whoever "repairs" this file by adding the
    // field to the fixture has to delete this line first.
    expect(capturedKeys.has("purchase_id")).toBe(false);
  });

  it("finds the files that handle a payload", () => {
    const readers = ipnReaders();
    // Same reason: a walk that found nothing would make every check below pass.
    expect(readers.length).toBeGreaterThanOrEqual(4);
    expect(readers.some((f) => f.endsWith("payment-event.ts"))).toBe(true);
    expect(readers.some((f) => f.includes(join("api", "ipn")))).toBe(true);
  });

  it("🚨 reads no parameter name Digistore24 does not send", () => {
    const findings: string[] = [];
    let read = 0;

    for (const file of ipnReaders()) {
      for (const key of keysReadIn(file)) {
        read += 1;
        const relative = file.slice(ROOT.length);
        const allowed = ELSEWHERE[key];
        if (capturedKeys.has(key)) continue;
        if (allowed && (!allowed.onlyIn || relative === allowed.onlyIn)) continue;
        findings.push(`${relative} reads body["${key}"]`);
      }
    }

    // A regex that stopped matching would report zero findings over zero reads,
    // which reads exactly like a clean tree.
    expect(read).toBeGreaterThan(20);
    expect(findings).toEqual([]);
  });

  it("keeps every allowed absence explained", () => {
    for (const [key, entry] of Object.entries(ELSEWHERE)) {
      // Not a style rule: an entry without a defensible sentence is how an
      // allowlist becomes the place findings go to be forgotten.
      expect(entry.why.length, `${key} has no reason`).toBeGreaterThan(40);
      expect(capturedKeys.has(key), `${key} IS in the captured message`).toBe(false);
    }
  });
});
