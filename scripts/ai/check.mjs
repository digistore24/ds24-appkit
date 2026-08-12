// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Checks the AI layer — which task runs on which model, whether the keys are
// there, and roughly what a call costs.
//
//   node run.mjs ai-check
//
// Three jobs, and the third is the one you cannot get anywhere else:
//
//  1. **Bindings.** `config/ai-models.json` against the declared tasks and the
//     five providers. `npm run test` fails on the same structural problems, but
//     it says "expected [] to equal [...]"; this says which task, which field
//     and what to put there.
//  2. **Keys.** Whether THIS machine can actually reach the provider each task
//     is bound to. Deliberately not part of the test suite — a developer's
//     machine legitimately has no keys, and a red build for that would train
//     people to ignore it.
//  3. **Money.** What one call would cost at the prices on file. The point is
//     that somebody choosing between two models sees the order of magnitude at
//     the moment they choose, rather than on an invoice six weeks later.
//
// Plain Node, no bundler, no TypeScript, no dependency — it has to run on
// Linux, macOS and in a Git Bash on Windows (CLAUDE.md, "Three systems").
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  PROVIDERS_REPORTING_COST,
  PROVIDER_CAPABILITIES,
  PROVIDER_ENV_VARS,
  PROVIDER_IDS,
  providersThatCan,
} from "../../lib/ai/providers/ids.mjs";
import {
  AUTO,
  TASKS,
  bindingProblems,
  kindOfTask,
  mergedBinding,
  resolveBinding,
} from "../../lib/ai/task-rules.mjs";
import {
  estimateMicros,
  formatMicros,
  priceFor,
  priceKey,
  recommendedCurrency,
} from "../../lib/ai/pricing.mjs";
// Every surface in this app that talks to a person — the core's assistant plus
// whatever an installed module declares. The hint below asks it "is anything
// beyond support switched on?" instead of naming a feature.
//
// ⚠️ It used to import `lib/ai/companion-config.mjs` directly, and that file
// moved into `modules/companion/` — which left this script with a dangling
// import, so `node run.mjs ai-check` died with ERR_MODULE_NOT_FOUND before
// printing a line. Nothing caught it: a `scripts/` command is not something a
// test imports. Two things changed as a result. This reads the registry rather
// than a module's file, so the next module move cannot break it; and
// `scripts/imports.test.ts` now walks every relative import under `scripts/`,
// so the next dangling one is a red test rather than a dead command.
import { DISCLOSURE_SURFACES } from "../../lib/ai/disclosure.mjs";
import "../lib/env.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The shape of a call the estimate is quoted for. Stated, never implied. */
const SAMPLE_INPUT_TOKENS = 1000;
const SAMPLE_OUTPUT_TOKENS = 500;

function readJson(...parts) {
  const path = join(ROOT, ...parts);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`✗ ${parts.join("/")} could not be read: ${error.message}`);
    process.exit(1);
  }
}

/**
 * The same read, for a file that may legitimately not be there yet.
 *
 * `readJson()` above refuses to continue without `ai-models.json`, and that is
 * correct — every answer this script gives depends on it. A companion switch is
 * different: an app that has never wanted one has no such file, and that is not
 * an error to stop on. Missing, unreadable and malformed all come back `null`,
 * which the one caller reads as OFF — the fail-closed direction `isChatEnabled()`
 * already uses for the assistant.
 */
function readJsonIfPresent(...parts) {
  try {
    return JSON.parse(readFileSync(join(ROOT, ...parts), "utf8"));
  } catch {
    return null;
  }
}

const models = readJson("config", "ai-models.json");
const prices = readJson("config", "ai-prices.json");

const configured = PROVIDER_IDS.filter((id) => Boolean(process.env[PROVIDER_ENV_VARS[id]]?.trim()));

// ── 1. Providers on this machine ────────────────────────────────────────────

console.log("Providers\n");
for (const id of PROVIDER_IDS) {
  const has = configured.includes(id);
  const can = (PROVIDER_CAPABILITIES[id] ?? []).join(" + ");
  console.log(
    `  ${has ? "✓" : "·"} ${id.padEnd(11)} ${(has ? "key set" : PROVIDER_ENV_VARS[id] + " not set").padEnd(30)} ${can}`,
  );
}

if (configured.length === 0) {
  console.log(
    "\n  No provider is configured on this machine. Add ONE of the keys above to\n" +
      "  .env — any one of them is enough, and the tasks below ship on \"auto\",\n" +
      "  so whichever you pick is the one they run on. Nothing else to change.",
  );
}

// ── 2. Tasks and their bindings ─────────────────────────────────────────────

const defaultCurrency =
  typeof prices.defaultCurrency === "string" && prices.defaultCurrency.trim() !== ""
    ? prices.defaultCurrency.trim()
    : "USD";

console.log(`\nTasks  (estimate per call: ${SAMPLE_INPUT_TOKENS} in / ${SAMPLE_OUTPUT_TOKENS} out)\n`);

const unpriced = [];

for (const task of TASKS) {
  const declared = mergedBinding(models, task);
  const binding = resolveBinding(models, task, configured);
  const bound = Boolean(models?.tasks?.[task]);
  const price = priceFor(prices, binding.provider, binding.model);
  // What the file says, when that is not what runs. An Operator reading
  // "mistral" here has to be able to see that they never typed it.
  const via = declared.provider === AUTO ? `  (via "${AUTO}")` : "";

  const kind = kindOfTask(task);

  // An image call is not priced like a text call: it is billed per picture, and
  // quoting it as "1000 in / 500 out" would be an estimate of the wrong thing.
  const estimate = price
    ? kind === "image"
      ? `${formatMicros(Math.round((price.image ?? 0) * 1_000_000), price.currency)} per picture`
      : formatMicros(
          estimateMicros(price, SAMPLE_INPUT_TOKENS, SAMPLE_OUTPUT_TOKENS),
          price.currency,
        )
    : PROVIDERS_REPORTING_COST.includes(binding.provider)
      ? `${binding.provider} reports the real cost of every call — no estimate needed`
      : "no price on file";

  // A provider that reports its own cost needs no price on file — and telling
  // somebody to add one would be telling them to write down a worse copy of
  // the invoice. `costOf()` prefers the reported figure either way.
  if (!price && !PROVIDERS_REPORTING_COST.includes(binding.provider)) {
    unpriced.push(priceKey(binding.provider, binding.model));
  }

  console.log(`  ${task}  (${kind})`);
  console.log(
    `    provider   ${binding.provider}${via}${bound ? "" : "  (inherited from default)"}`,
  );
  console.log(`    model      ${binding.model}${via}`);
  if (kind === "text") console.log(`    maxTokens  ${binding.maxTokens}`);
  console.log(`    per call   ~ ${estimate}`);

  // The one thing a key alone does not tell you. Said here, beside the task, so
  // it is answered at the moment somebody wonders — the problems block below
  // repeats it as an error only when it is actually wrong.
  if (kind !== "text") {
    const able = providersThatCan(kind);
    console.log(`    needs      a provider that can produce ${kind}: ${able.join(", ")}`);
  }
}

// ── 3. Money ────────────────────────────────────────────────────────────────

console.log("\nPrices\n");
console.log(`  currency   ${defaultCurrency}`);
console.log(`  updated    ${prices.updated ?? "— (add an \"updated\" date so you know when to re-check)"}`);
console.log(`  entries    ${Object.keys(prices.models ?? {}).length}`);

// The recommendation, and never more than that (FR-42a). A provider bills in
// what it bills in; refusing a currency would only push somebody into entering
// a hand-converted number with no rate and no date attached to it.
const locale = (process.env.DEFAULT_LOCALE ?? "de").slice(0, 2);
const recommended = recommendedCurrency(locale);
if (defaultCurrency !== recommended) {
  console.log(
    `\n  Note: for a "${locale}" installation, ${recommended} is the usual choice.\n` +
      `  This is a recommendation only — nothing converts, and a provider bills\n` +
      `  in what it bills in. Keeping ${defaultCurrency} is a perfectly good answer.`,
  );
}

if (unpriced.length > 0) {
  console.log(
    `\n  ${unpriced.length} model(s) in use have no price on file:\n` +
      unpriced.map((key) => `    ${key}`).join("\n") +
      `\n  Calls still work and are still recorded with their token counts — but\n` +
      `  the AI-costs page will count them separately instead of pretending they\n` +
      `  were free. Add them to config/ai-prices.json.`,
  );
}

// ── Verdict ─────────────────────────────────────────────────────────────────

const notes = [];
const problems = bindingProblems(models, configured, { notes });

// ── The AI you pay for, used only for support ───────────────────────────────
// A note, never a problem, and the exit code stays 0. An app that genuinely
// wants no companion is not broken, and a check that calls it broken is a check
// people learn to skip.
//
// It keys on the SWITCHES the disclosure registry already names — each surface
// carries its `configFile` and its own `isOn()` — and deliberately not on a scan
// of the tree for call sites. A scan would answer "found" in every generated app
// for ever, because the template itself ships a companion server action; the
// hint would go silent with nothing ever going red. A switch is also the better
// half to ask about: an empty registry is a state of completion, a switch is a
// decision, and this note is about a decision nobody has made.
//
// Reading the registry rather than one module's predicate is what makes this
// hint true in an app whose companion is not installed at all: with the module
// absent there is no surface beyond `chat`, which is exactly the state the note
// describes. It also means the note keeps working for the NEXT module that adds
// an AI surface, without this file learning its name.
//
// The shipped template answers "off" — the companion is a module and ships
// absent — so on any machine with a key this note fires on the template itself.
// That is the observation, not a defect.
const beyondSupport = DISCLOSURE_SURFACES.filter((surface) => surface.id !== "chat").some(
  (surface) => surface.isOn(readJsonIfPresent(...surface.configFile.split("/"))),
);

if (configured.length > 0 && !beyondSupport) {
  notes.push(
    "You are paying for a model, and this app uses it only to answer support questions.\n" +
      "    An app can also work ALONGSIDE its customer — read what they submitted, walk them\n" +
      "    through a course, check a plan before they commit to it. That is the `companion`\n" +
      "    MODULE: `node run.mjs module add companion`, then askCompanion() from a server\n" +
      "    action. The shape and a worked example are in docs/ai-providers.md → Working\n" +
      "    alongside your customer.",
  );
}

console.log("");
if (problems.length > 0) {
  console.error("Problems:\n");
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error("");
  process.exit(1);
}

// Not failures. A task nobody has bound, on a key that cannot do its kind of
// work, is a feature that has not been asked for yet — and a gate that goes red
// for one is a gate people learn to ignore.
if (notes.length > 0) {
  console.log("Worth knowing:\n");
  for (const note of notes) console.log(`  · ${note}`);
  console.log("");
}

console.log("✓ Every task you have bound is bound to a provider you have a key for.");
console.log("\n  There is no spend ceiling in this template, deliberately — a ceiling");
console.log("  protects against a runaway by taking your app's AI offline for real");
console.log("  customers. If you want a hard stop, set a usage limit on your provider");
console.log("  account, which is where the money actually crosses a boundary.");
