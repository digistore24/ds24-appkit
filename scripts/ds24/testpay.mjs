#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The Digistore24 test-purchase key — inspect, fetch, rotate.
//
// `getTestpayKey` (undocumented, but real — DigiMember uses it) returns a GET
// parameter that, appended to a checkout URL, unlocks TEST payments and opens
// the checkout form even for not-yet-approved products.
//
// The app does not need this command to work: in DEV every checkout link
// fetches and appends the parameter by itself (lib/digistore/testpay.ts) and
// caches it in `.dev/testpay.json`. This command exists to LOOK at that state,
// to refresh it by hand, and — the important one — to ROTATE the key:
//
//   node run.mjs ds24-testpay              # fetch/refresh + show the state
//   node run.mjs ds24-testpay --json       # the same, machine-readable
//   node run.mjs ds24-testpay --recreate   # rotate: the old key stops working
//
// Rotate before going live. The key is ACCOUNT-level: appended by hand to a
// LIVE checkout URL it would enable test purchases there too, and their IPNs
// grant real entitlements. Treat it like a secret — it lives in `.dev/`
// (gitignored, machine-local) and must never be put into `.env`, which
// deploy tooling copies to the production host.
//
// Env: DIGISTORE_API_KEY.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ds24Call, requireApiKey, parseArgs } from "./_client.mjs";

const args = parseArgs(process.argv.slice(2));
const apiKey = requireApiKey();

// Same file the app reads (lib/digistore/testpay.ts) — one state, two writers.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const stateFile = path.join(projectRoot, ".dev", "testpay.json");

let data;
try {
  // Without do_recreate the API returns the existing key; with it, a new one —
  // and the old key stops working everywhere it was pasted.
  data = await ds24Call("getTestpayKey", apiKey, args.recreate ? { do_recreate: "1" } : {});
} catch (err) {
  console.error(`✗ Digistore24 did not return a test-purchase key: ${err.message}`);
  process.exit(1);
}

const state = {
  userId: String(data?.user_id ?? ""),
  testpayKey: String(data?.testpay_key ?? ""),
  paramName: String(data?.get_param_name ?? ""),
  expiresAt: String(data?.expires_at ?? ""),
  fetchedAt: new Date().toISOString(),
};

if (!state.testpayKey || !state.paramName) {
  console.error("✗ getTestpayKey answered without a key/parameter name:");
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}

await fs.mkdir(path.dirname(stateFile), { recursive: true });
await fs.writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

if (args.json) {
  console.log(JSON.stringify({ ...state, stateFile, recreated: Boolean(args.recreate) }, null, 2));
  process.exit(0);
}

const show = (label, value) => {
  if (value === undefined || value === null || value === "") return;
  console.log(`  ${label.padEnd(18)} ${value}`);
};

console.log(args.recreate ? "Test-purchase key ROTATED" : "Test-purchase key");
show("Parameter", `${state.paramName}=${state.testpayKey}`);
show("Expires", `${state.expiresAt} (Digistore24 server time)`);
show("DS24 user", state.userId);
show("Stored in", path.relative(projectRoot, stateFile));

console.log(
  "\nIn DEV every checkout link of this app appends the parameter by itself —\n" +
    "click a plan card and the Digistore24 form opens in test-payment mode\n" +
    "(works for not-yet-approved products too). Two allowlists guard it, and\n" +
    "they answer different questions: WHEN it may exist is the environment gate\n" +
    "in lib/digistore/testpay.ts (never outside DEV; hard off: DS24_TESTPAY=off),\n" +
    "WHERE it may go is DIGISTORE_CHECKOUT_HOSTS in lib/digistore/config.mjs.\n" +
    "If a link arrives without the parameter, `node run.mjs logs` carries a\n" +
    "[testpay] line saying which of the two declined.\n" +
    "\nTreat the key like a secret, and rotate it before going live:\n" +
    "  node run.mjs ds24-testpay --recreate",
);
