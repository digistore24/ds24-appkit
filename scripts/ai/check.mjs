// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Checks the AI layer — which task runs on which model, whether the keys are
// there, and roughly what a call costs.
//
//   node run.mjs ai-check
//   node run.mjs ai-check --live                 make one real call per binding
//   node run.mjs ai-check --live --task chat     just that one
//   node run.mjs ai-check --live --url https://… a DEPLOYED app
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
// And a fourth that only happens when it is asked for: **`--live` makes one
// real call**, because the three above are answered off FILES and none of them
// can tell a working key from a revoked one. It costs money at the provider,
// so it is a flag an operator types and 🚨 never a gate — not in `make check`,
// not in `npm run test`, not in a deploy (NFR-64). The mechanics, the sentences
// and the reason it goes through the running app rather than calling a provider
// from here are in `scripts/ai/live.mjs`.
//
// Plain Node, no bundler, no TypeScript, no dependency — it has to run on
// Linux, macOS and in a Git Bash on Windows (CLAUDE.md, "Three systems").
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
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
// The `--live` half. Its own file because it is the only part of this command
// that talks to anything, and because every sentence it can print is worth
// testing on its own — `scripts/ai/live.test.ts`.
import { askApp, describeOutcome, describeSkip, planCost, probePlan } from "./live.mjs";
import { LIVE_PATH, PROBE_INPUT_TOKENS, PROBE_OUTPUT_TOKENS } from "../../lib/ai/probe.mjs";
import { diagnosticsCredentials } from "../dev/errors-remote.mjs";
import { rememberedPort } from "../dev/app-port.mjs";
import { hostOf, isLocalHost } from "../lib/host-env.mjs";
import { readEnvValue, setEnvValue } from "../lib/env-write.mjs";
import "../lib/env.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// ── The flags ───────────────────────────────────────────────────────────────
// Read before a line is printed, so a typo is a sentence rather than a wall of
// output followed by one. A missing value after `--task` or `--url` is a usage
// error (exit 2) and not a failed check — the shape `scripts/cron/run.mjs`
// uses for exactly the same two flags.
const argv = process.argv.slice(2);
const wantsLive = argv.includes("--live");

function flagValue(name) {
  const at = argv.indexOf(name);
  if (at === -1) return null;
  const value = String(argv[at + 1] ?? "").trim();
  if (!value || value.startsWith("--")) {
    console.error(`ERROR: ${name} needs a value.`);
    console.error(
      name === "--task"
        ? "  node run.mjs ai-check --live --task chat"
        : "  node run.mjs ai-check --live --url https://app.example.com",
    );
    process.exit(2);
  }
  return value;
}

const onlyTask = flagValue("--task");
const askedUrl = flagValue("--url");

if ((onlyTask || askedUrl) && !wantsLive) {
  console.error(`ERROR: ${onlyTask ? "--task" : "--url"} only means something with --live.`);
  console.error("  node run.mjs ai-check --live");
  process.exit(2);
}

if (onlyTask && !TASKS.includes(onlyTask)) {
  console.error(`ERROR: no task called "${onlyTask}". This app declares: ${TASKS.join(", ")}.`);
  process.exit(2);
}

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
  // 🚨 Said out loud, because the alternative is a `--live` run that ends in
  // red with nothing anywhere saying that no call was ever made. "The bindings
  // are wrong" and "the call did not go through" are different findings with
  // different fixes, and this is the line that keeps them apart.
  if (wantsLive) {
    console.error(
      "⏭ ai-check --live: NOT CHECKED — no call was made, and this is not a clean run.\n" +
        "  Every problem above has to resolve first; on a machine with no key at all that is\n" +
        "  the .env line each of those lines names. Put ONE of them in, restart the app\n" +
        "  (node run.mjs restart) and run `node run.mjs ai-check --live` again.",
    );
    console.error("");
  }
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

// ── 4. Does a call actually go through? ─────────────────────────────────────
//
// Everything above is read off files, and a file cannot tell a working key from
// a revoked one. This is the part that finds out, and it only runs when it is
// asked to — see the header, and `scripts/ai/live.mjs` for why it goes through
// the running app rather than calling a provider from here.

if (!wantsLive) {
  console.log("\n  A key that is PRESENT is not a key that WORKS, and nothing above can tell");
  console.log("  the difference. To find out, make one real call per binding:");
  console.log("\n      node run.mjs ai-check --live");
  console.log("\n  It says what it will cost before it costs it, and it needs the app running.");
  process.exit(0);
}

console.log("\nLive  (real calls — this spends money at the provider)\n");

// 🚨 `--url` means somebody else's app makes the call, with somebody else's
// keys: `"auto"` is resolved there, not here. So the plan below names the
// binding as DECLARED and the answer names the company that actually ran —
// printing this machine's resolution would be a confident sentence about a
// machine this command has never looked at.
const plan = probePlan(models, configured, { only: onlyTask, remote: Boolean(askedUrl) });

if (askedUrl) {
  console.log("  The app at that address makes the call with ITS keys, so a binding on");
  console.log("  \"auto\" is decided there. What ran comes back with the answer.\n");
}

for (const skipped of plan.notProbed) {
  console.log(`  · ${skipped.task} (${skipped.kind}) is NOT probed — ${skipped.why}.`);
}
if (plan.notProbed.length > 0) console.log("");

// 🚨 A count guard, and it fails rather than passes. "Nothing to call" produced
// by an empty task list or an empty provider list is a defect in this check —
// and a check with nothing to measure that ends in a tick is the exact failure
// this command exists to refuse.
if (plan.problem) {
  console.error(`  ✗ ${plan.problem}.`);
  console.error("\n  Nothing was called, and this is not a pass.");
  process.exit(1);
}

/**
 * Nothing was called, and the reason and the next move both get said.
 *
 * 🚨 **A skip here exits 1, and that is deliberately unlike the rest of this
 * project.** A rung that could not run leaves `security-check`'s exit code
 * alone, because nobody asked it to run that rung in particular. `--live` is
 * the opposite: it is a request to MEASURE, typed by hand, and a run that
 * measured nothing has not honoured it. Exit 0 there would be a green that
 * proves nothing — which is the exact confusion this flag exists to end. The
 * marker keeps the other half of the distinction: `⏭ NOT CHECKED` is never `✗`,
 * so "could not look" and "looked and found something" do not read alike
 * either. `node run.mjs cron --list` against an app that is not there exits 1
 * for the same reason.
 */
function reportSkip(reason, context = {}, { called = 0 } = {}) {
  const { line, then } = describeSkip(reason, context);
  console.error(`\n⏭ ai-check --live: NOT CHECKED — ${line}.`);
  console.error(`    → ${then}\n`);
  console.log(
    `  ${called} of ${plan.calls.length} binding(s) called. ` +
      (called === 0 ? "Nothing was measured." : "The rest was not measured."),
  );
}

if (plan.skip) {
  reportSkip(plan.skip);
  process.exit(1);
}

// ── What it will cost, before it costs it ───────────────────────────────────
const cost = planCost(prices, plan.calls);
console.log(
  `  ${plan.calls.length} call(s), ${PROBE_INPUT_TOKENS} in / ${PROBE_OUTPUT_TOKENS} out tokens each:\n`,
);
for (const [index, call] of plan.calls.entries()) {
  const also =
    call.alsoFor.length > 0 ? `  (also the binding for ${call.alsoFor.join(", ")})` : "";
  console.log(`    ${call.task}${also}`);
  console.log(`      ${call.provider}/${call.model}   ${cost.lines[index]?.text ?? ""}`);
}
console.log(`\n    total     ${cost.total}\n`);

// ── Which app, and with which secret ────────────────────────────────────────
// Three outcomes and only two of them ever send anything, exactly as
// `scripts/cron/run.mjs` resolves the same pair: the local advice ("restart
// it") is wrong three times over about a host somebody else runs.
let origin;
let secret;
// Named for what it is: the HOST somebody else runs. Not the same question as
// `probePlan`'s `remote` above — that one asks who resolves the binding (any
// `--url` does), this one asks whose advice is right. A `--url` at localhost is
// remote for the first and local for the second.
let remoteHost = null;

if (askedUrl) {
  const scoped = diagnosticsCredentials(process.env, askedUrl);
  if (scoped.reason) {
    // 🚨 Nothing has been sent and nothing has been written — in particular no
    // DIAGNOSTICS_SECRET has been generated into the local `.env`, which would
    // mint a value the deployed app has never heard of and guarantee a refusal
    // blamed on the wrong file.
    console.error(`ERROR: ${scoped.reason}.`);
    process.exit(1);
  }
  origin = askedUrl.replace(/\/+$/, "");
  secret = scoped.secret;
  const host = hostOf(origin);
  if (host && !isLocalHost(host)) remoteHost = { host, keyVar: scoped.keyVar };
} else {
  origin = `http://127.0.0.1:${rememberedPort() ?? 3000}`;
  secret = String(process.env.DIAGNOSTICS_SECRET ?? "").trim() || readEnvValue(".env", "DIAGNOSTICS_SECRET");
  if (!secret) {
    // Generated on first use exactly as CRON_SECRET is (scripts/cron/run.mjs),
    // and never overwriting a value that is already there — in STAGING and PROD
    // it belongs to the host's secret management.
    secret = randomBytes(32).toString("hex");
    setEnvValue(".env", "DIAGNOSTICS_SECRET", secret);
    console.log("  → DIAGNOSTICS_SECRET generated in .env (local development secret).");
    console.log("    The running app reads its environment at start, so it may need a");
    console.log("    restart before it accepts this:  node run.mjs restart\n");
  }
}

console.log(`  Calling ${origin}${LIVE_PATH} …\n`);

// ── The calls ───────────────────────────────────────────────────────────────
let called = 0;
let answered = 0;
let refusedForNow = 0;
let brokenCalls = 0;
let stopped = null;

for (const call of plan.calls) {
  const answer = await askApp({ origin, secret, task: call.task });

  if (answer.state === "skip") {
    // The door, not the provider. Everything after it would fail the same way,
    // so the sweep stops and says how far it got rather than repeating itself.
    stopped = answer;
    break;
  }

  called += 1;
  const body = answer.body;
  const said = describeOutcome({
    task: call.task,
    provider: body.provider ?? call.provider,
    model: body.model ?? call.model,
    outcome: body.ok ? "ok" : String(body.outcome ?? "providerFailed"),
    latencyMs: body.latencyMs,
    usage: body.usage,
    said: body.said,
  });

  console.log(`  ${said.mark} ${said.headline}`);
  if (said.then) console.log(`      → ${said.then}\n`);

  if (said.broken) brokenCalls += 1;
  else if (said.mark === "!") refusedForNow += 1;
  else answered += 1;
}

if (stopped) {
  reportSkip(
    stopped.reason,
    { origin, remote: remoteHost, status: stopped.status, detail: stopped.detail },
    { called },
  );
  // Broken or not, part of the sweep did not happen — see `reportSkip()`. The
  // findings that WERE made are printed above either way.
  process.exit(1);
}

// The second count guard, at runtime this time: a sweep that walked a non-empty
// plan and called nothing has neither a finding nor a reason, and that is a
// defect in this command rather than a clean bill.
if (called === 0) {
  console.error("  ✗ the plan named calls to make and none was made, with no reason given.");
  console.error("    That is a defect in this check. Please report it.");
  process.exit(1);
}

console.log(
  `\n  ${called} of ${plan.calls.length} binding(s) called: ${answered} answered, ` +
    `${refusedForNow} refused for now, ${brokenCalls} broken.`,
);
console.log("\n  Each of those is one row in ai_usage — task, provider, model, tokens,");
console.log("  latency, outcome, no member — because it went through runTask() like any");
console.log("  other call. They show up on /dashboard/admin/ai-costs with everything else.");

if (brokenCalls > 0) process.exit(1);
