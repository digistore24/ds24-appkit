// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The `--live` half of `node run.mjs ai-check`: what would be called, what it
// costs, and one sentence per way it can end.
//
// ── What `--live` adds, and why it is not the default ──────────────────────
//
// `ai-check` on its own answers three questions off files: which task runs on
// which model, whether the keys are THERE, and what a call would cost. What it
// cannot answer is the one somebody actually has at that moment — **does a call
// go through**. A key that is present and revoked, a model id that no longer
// exists, an account with no quota and a firewall that eats outbound HTTPS all
// look identical to a check that reads a `.env`.
//
// `--live` answers it the only honest way: by making one real call. That costs
// money at the provider and needs a key, so it is a decision an operator makes
// by typing the flag — never a gate. 🚨 **It must never be added to
// `make check`, to `npm run test` or to a deploy** (NFR-64): a paid,
// network-dependent step in the chain everybody runs is a brake, and a brake is
// what somebody eventually takes out, taking the intent with it.
//
// ── The one rule this file exists to keep ──────────────────────────────────
//
// **It does not call a provider. It asks the running app to.** Everything that
// names a company, builds a client or reads a key lives in `lib/ai/providers/`
// and nowhere else (CLAUDE.md → *Talking to a language model*); a script with
// its own HTTP call would be a second way to reach a model, agreeing with
// `runTask()` until somebody changes a header, and writing no `ai_usage` row at
// all. So the transport below talks to `POST /api/diagnostics/ai`, which calls
// `runTask()` — the same path a customer's question takes, priced and recorded
// the same way.
//
// ── "Could not look" and "nothing there" never look alike ──────────────────
//
// Every ending has its own sentence AND its own action. The four groups:
//
//   · no key on this machine    → nothing was called, and the `.env` line to add
//   · the app is not reachable  → nothing was called, and the command to run
//   · the door refused          → nothing was called, and which secret to set
//   · a call was made           → one line per outcome, each with its own fix
//
// Plain Node, no bundler, no TypeScript, no dependency — Linux, macOS and Git
// Bash on Windows (CLAUDE.md → *Three systems*). Nothing here runs at import
// time.
import { LIVE_PATH, PROBE_INPUT_TOKENS, PROBE_OUTPUT_TOKENS, PROBE_TIMEOUT_MS } from "../../lib/ai/probe.mjs";
import { PROVIDER_ENV_VARS, PROVIDER_IDS, PROVIDERS_REPORTING_COST } from "../../lib/ai/providers/ids.mjs";
import { AUTO, TASKS, kindOfTask, mergedBinding, resolveBinding } from "../../lib/ai/task-rules.mjs";
import { estimateMicros, formatMicros, priceFor, priceKey } from "../../lib/ai/pricing.mjs";

// ── the plan ────────────────────────────────────────────────────────────────

/**
 * What `--live` would call, before anything is called.
 *
 * **One call per distinct provider+model, not one per task.** The question is
 * whether this app can reach the companies it is bound to; two tasks that
 * resolve to the same model would ask it twice and bill twice for one answer.
 * The tasks sharing a binding are named on the line rather than dropped, so
 * nobody reads the shorter list as tasks having been skipped.
 *
 * **Image tasks are never called.** A picture is billed per picture — cents
 * rather than a fraction of one — and a probe that draws one to prove a key
 * works is a probe nobody runs twice. They are listed with the reason.
 *
 * 🚨 The three count guards are failures, not passes. Zero known providers,
 * zero declared text tasks, or a walk that produced no call while both of those
 * were non-empty, all mean this check measured nothing — and a check that
 * measured nothing must never be the one that says "fine".
 *
 * ⚠️ **`remote` is not a detail.** With `--url` the call is made by an app
 * somewhere else, and `"auto"` is resolved against the keys THAT machine has —
 * so the keys in this `.env` decide nothing and must not be used to print a
 * provider name that the host may never pick. In that mode the plan names the
 * binding as it is DECLARED (`auto` stays `auto`) and the answer names the
 * company that actually ran. Resolving it here would produce a confident,
 * wrong sentence about somebody else's machine.
 *
 * @param {object} models `config/ai-models.json`
 * @param {string[]} configured providers with a key on this machine
 * @param {{only?: string|null, remote?: boolean}} [options]
 * @returns {{problem: string|null, skip: string|null,
 *            calls: {task: string, provider: string, model: string, alsoFor: string[]}[],
 *            notProbed: {task: string, kind: string, why: string}[]}}
 */
export function probePlan(models, configured, { only = null, remote = false } = {}) {
  const empty = { calls: [], notProbed: [] };

  if (PROVIDER_IDS.length === 0) {
    return { ...empty, skip: null, problem: "no provider is known to this app at all — lib/ai/providers/ids.mjs is empty" };
  }

  const asked = only ? [only] : [...TASKS];
  const textTasks = asked.filter((task) => kindOfTask(task) === "text");
  const imageTasks = asked.filter((task) => kindOfTask(task) !== "text");

  const notProbed = imageTasks.map((task) => ({
    task,
    kind: kindOfTask(task),
    why: "billed per picture, not per token — a probe that draws one costs real money",
  }));

  if (textTasks.length === 0) {
    return {
      ...empty,
      notProbed,
      skip: null,
      problem:
        only === null
          ? "no text task is declared at all — lib/ai/task-rules.mjs declares none, so there is nothing a live call could exercise"
          : `${only} produces ${kindOfTask(only)}, and nothing else was asked for — there is no text task left to call`,
    };
  }

  // Asked AFTER the count guards on purpose: "you have no key" is a skip, and a
  // skip may only be reported once it is clear the check itself is sound.
  //
  // Only for a LOCAL run: with `--url` the keys are the host's and this
  // machine's `.env` says nothing about them. And locally the usual way a
  // keyless machine gets an answer is the binding check further up in
  // `check.mjs`, which refuses `"auto"` with no key by name — this is the gate
  // for a configuration that has nothing to complain about and still no
  // credential to call with.
  if (!remote && configured.length === 0) {
    return { ...empty, notProbed, skip: "noKey", problem: null };
  }

  const byBinding = new Map();
  for (const task of textTasks) {
    const binding = remote
      ? mergedBinding(models, task)
      : resolveBinding(models, task, configured);
    const key = priceKey(binding.provider, binding.model);
    const seen = byBinding.get(key);
    if (seen) {
      seen.alsoFor.push(task);
      continue;
    }
    byBinding.set(key, {
      task,
      provider: binding.provider,
      model: binding.model,
      alsoFor: [],
    });
  }

  const calls = [...byBinding.values()];
  if (calls.length === 0) {
    return {
      ...empty,
      notProbed,
      skip: null,
      problem: `${textTasks.length} text task(s) and ${configured.length} configured provider(s) produced no call at all — that is a defect in this check, not in the app`,
    };
  }

  return { problem: null, skip: null, calls, notProbed };
}

// ── the money, said before it is spent ──────────────────────────────────────

/**
 * What the plan costs, at the prices on file.
 *
 * Priced at the probe's CAP (`lib/ai/probe.mjs`), never at the answer somebody
 * hopes for. Three states per call and they are kept apart:
 *
 *   · a price on file            → the figure
 *   · a provider that reports    → no estimate needed, it invoices the real one
 *   · neither                    → "no price on file", and the total says so
 *
 * A total that quietly treated an unpriced model as zero would be the same
 * defect this whole command exists to refuse: an unknown printed as a nothing.
 *
 * @param {object} prices `config/ai-prices.json`
 * @param {{provider: string, model: string}[]} calls
 * @returns {{lines: {label: string, text: string}[], total: string, unpriced: string[], hostDecided: number}}
 */
export function planCost(prices, calls) {
  const lines = [];
  const unpriced = [];
  let micros = 0;
  let currency = null;
  let hostDecided = 0;

  for (const call of calls) {
    const label = priceKey(call.provider, call.model);

    // A binding another machine resolves has no price here, and inventing one
    // from this `.env`'s keys would be a confident figure for a call this app
    // is not the one making. The answer names the company that ran.
    if (call.provider === AUTO || call.model === AUTO) {
      hostDecided += 1;
      lines.push({ label, text: "decided on the host — the answer names what actually ran" });
      continue;
    }

    const price = priceFor(prices, call.provider, call.model);

    if (price) {
      const one = estimateMicros(price, PROBE_INPUT_TOKENS, PROBE_OUTPUT_TOKENS);
      micros += one;
      currency ??= price.currency;
      lines.push({ label, text: `~ ${formatMicros(one, price.currency)}` });
      continue;
    }

    if (PROVIDERS_REPORTING_COST.includes(call.provider)) {
      lines.push({ label, text: `${call.provider} reports the real cost of every call` });
      continue;
    }

    unpriced.push(label);
    lines.push({ label, text: "no price on file — the invoice is the only figure" });
  }

  const unknown =
    (unpriced.length > 0 ? [`${unpriced.length} model(s) with no price on file`] : []).concat(
      hostDecided > 0 ? [`${hostDecided} decided on the host`] : [],
    );

  const total =
    micros > 0
      ? `~ ${formatMicros(micros, currency ?? "USD")}` +
        (unknown.length > 0 ? `, plus ${unknown.join(" and ")}` : "")
      : unknown.length > 0
        ? `unknown — ${unknown.join(" and ")}`
        : "~ nothing measurable at the prices on file";

  return { lines, total, unpriced, hostDecided };
}

// ── one sentence per ending ─────────────────────────────────────────────────

/**
 * The outcomes a call can come back with, each with its own words.
 *
 * 🚨 **Every entry says something different, and that is the assertion**, not a
 * matter of taste. `noCredential` and `providerRefused` arrive from statuses one
 * apart (401 and 429, `codeForStatus()` in `lib/ai/providers/types.ts`) and send
 * an operator to two different places: one to their provider account's key page,
 * the other to wait a minute. Collapsed into "the call failed" they become a
 * command that costs money and answers nothing.
 *
 * `mark` follows this project's ladder: `✗` is broken and fails the command,
 * `!` is a real answer that says nothing is wrong with the configuration —
 * a rate limit clears by itself, and failing the command over one would train
 * people to re-run it until it goes green.
 *
 * @type {Record<string, {mark: string, broken: boolean, says: string, then: string}>}
 */
export const OUTCOMES = {
  ok: {
    mark: "✓",
    broken: false,
    says: "answered",
    then: "",
  },
  // ⚠️ **Two causes, one code, and the sentence says so rather than picking
  // one.** The layer raises `noCredential` both when there is no key for that
  // company at all (`registry.ts` refuses before a request is built) and when
  // the provider answered 401/403 — measured, on a real app with an empty
  // `.env`. Naming only "revoked" would send somebody looking for a bad key
  // where there is no key, so both are named and the Providers block printed
  // further up is where the answer is.
  noCredential: {
    mark: "✗",
    broken: true,
    says: "no key for that provider, or the account rejected the one there is (401/403)",
    then:
      "Those two arrive as one outcome. The Providers block above says which of the five keys " +
      "are SET on this machine — if the company on this line has none, that is the answer (for " +
      "a deployed app, look in the host's secrets). If it does have one, the account will not " +
      "take it: check it has not been revoked, expired or scoped away from this model. Either " +
      "way the app reads its environment at start:  node run.mjs restart",
  },
  unknownModel: {
    mark: "✗",
    broken: true,
    says: "the provider does not serve this model (404)",
    then:
      "The key works; the model id does not. Correct \"model\" for this task in " +
      "config/ai-models.json — or set it to \"auto\" and let the layer pick that provider's " +
      "current default — then run this again.",
  },
  providerRefused: {
    mark: "!",
    broken: false,
    says: "the provider refused for now — rate limit or overload (429/503)",
    then:
      "Nothing is wrong with the key or the model: this one clears by itself. Wait a minute and " +
      "run it again. If it never clears, the account has no quota for this model — check the plan " +
      "and any spend limit on the provider account.",
  },
  providerUnreachable: {
    mark: "!",
    broken: false,
    says: "no answer at all — network, proxy or timeout",
    then:
      `The app could not reach the provider from where IT runs, within ${Math.round(PROBE_TIMEOUT_MS / 1000)}s. ` +
      "Check outbound HTTPS from that machine, and any proxy or firewall in front of it. On a " +
      "deployed app that is the host's egress, not your laptop's.",
  },
  requestTooLarge: {
    mark: "✗",
    broken: true,
    says: "the provider called the request too large (413)",
    then:
      `A ${PROBE_INPUT_TOKENS}-token probe was too large, so this is not about your prompts: the ` +
      "model id in config/ai-models.json is almost certainly not a model that takes a chat " +
      "request at all.",
  },
  providerFailed: {
    mark: "✗",
    broken: true,
    says: "the provider failed in a way this layer could not classify",
    then:
      "Ask the app what it logged — the provider's own words go to the log and never into a " +
      "response:  node run.mjs errors   (or --url https://… for a deployed app)",
  },
};

/**
 * The outcome of one call, as the command prints it.
 *
 * An outcome this file has never heard of gets its own sentence too, rather
 * than the nearest one: a sixth provider that grows a seventh error code must
 * not be reported as `providerFailed` by a lookup that silently defaulted.
 *
 * @param {{provider: string, model: string, task: string, outcome: string,
 *          latencyMs?: number, usage?: object|null, said?: string}} call
 * @returns {{mark: string, broken: boolean, headline: string, then: string}}
 */
export function describeOutcome(call) {
  const known = OUTCOMES[call.outcome];
  const where = `${call.task}  ${call.provider}/${call.model}`;
  // Seconds once it is long enough that milliseconds stop being readable — a
  // timeout reported as "60000 ms" is a number somebody has to count digits in.
  const took = !Number.isFinite(call.latencyMs)
    ? ""
    : call.latencyMs >= 10_000
      ? ` after ${Math.round(call.latencyMs / 1000)}s`
      : ` in ${call.latencyMs} ms`;

  if (!known) {
    return {
      mark: "✗",
      broken: true,
      headline: `${where} — the app reported "${call.outcome}", which this command does not know${took}`,
      then:
        "That outcome is newer than this check. Add it to OUTCOMES in scripts/ai/live.mjs with " +
        "the action it deserves, and look it up in docs/ai-providers.md → When something fails.",
    };
  }

  if (call.outcome === "ok") {
    const usage = call.usage ?? null;
    const tokens = usage
      ? `${usage.inputTokens ?? 0} in / ${usage.outputTokens ?? 0} out tokens`
      : "no token counts reported (which is not the same as zero)";
    const said = call.said ? `, said "${call.said}"` : "";
    return {
      mark: known.mark,
      broken: false,
      headline: `${where} ${known.says}${took} — ${tokens}${said}`,
      then: "",
    };
  }

  return {
    mark: known.mark,
    broken: known.broken,
    headline: `${where} — ${known.says}${took}`,
    then: known.then,
  };
}

// ── the endings where nothing was called at all ─────────────────────────────

/**
 * Why no call was made, and what the person in front of it does about it.
 *
 * 🚨 Each of these is a SKIP: nothing was measured, and the command says so in
 * those words. None of them is a tick and none of them is silence — the failure
 * this whole story exists to prevent is a run that could not look reporting the
 * same thing as a run that looked and found nothing wrong.
 *
 * @param {string} reason
 * @param {{origin?: string, remote?: {host: string, keyVar: string}|null,
 *          status?: number, detail?: string}} [context]
 * @returns {{line: string, then: string}}
 */
export function describeSkip(reason, context = {}) {
  const { origin = "", remote = null, status = 0, detail = "" } = context;

  switch (reason) {
    case "noKey":
      return {
        line: "no provider key on this machine, so there was nothing to call",
        then:
          `Put ONE of these in .env — any one is enough, the tasks ship on "auto":\n` +
          PROVIDER_IDS.map((id) => `      ${PROVIDER_ENV_VARS[id]}=…   (${id})`).join("\n") +
          "\n    Then:  node run.mjs restart  &&  node run.mjs ai-check --live",
      };

    case "appDown":
      return {
        line: `nothing answered at ${origin}${detail ? ` (${detail})` : ""}`,
        then: remote
          ? `Check the address, and that the app at ${remote.host} is deployed and up.`
          : "The live check asks the RUNNING app to make the call, because nothing outside\n" +
            "    lib/ai/providers/ may talk to a provider. Start it first:  node run.mjs start",
      };

    case "doorClosed":
      return {
        line: `${origin} answered 404 — the diagnostics door is closed or the secret does not match`,
        then: remote
          ? "From outside, three things look the same on purpose: that host has no " +
            `DIAGNOSTICS_SECRET, the ${remote.keyVar} in this .env is a different value, or that ` +
            "app was deployed before this endpoint existed. Set the same secret in the host's " +
            "secrets and in this .env, and redeploy."
          : "The app reads its environment when it STARTS, so a DIAGNOSTICS_SECRET added or\n" +
            "    changed since then is not the one it is comparing against — and this command\n" +
            "    puts one in the .env if there was none. Restart it:  node run.mjs restart",
      };

    case "doorLimited":
      return {
        line: `${origin} answered 429 — this door meters what it spends`,
        then:
          "That is the endpoint's own spend meter, not the provider's. It allows a dozen calls a\n" +
          "    quarter of an hour per caller. Wait, then run it again.",
      };

    case "taskRefused":
      return {
        line: `the app refused the task: ${detail || "no reason given"}`,
        then:
          "Name a task the app declares — `node run.mjs ai-check` lists every one of them, and\n" +
          "    only text tasks can be probed.",
      };

    default:
      return {
        line: `${origin} answered ${status || "something unexpected"}${detail ? ` (${detail})` : ""}`,
        then:
          "The app answered, but not with an outcome. Ask it what it logged:\n" +
          "    node run.mjs errors" +
          (remote ? "  --url <address>" : ""),
      };
  }
}

// ── the transport ───────────────────────────────────────────────────────────

/**
 * One probe, asked of the running app.
 *
 * Never throws: every transport failure comes back as a `skip` with its reason,
 * because the caller — not the transport — decides what a failure means. The
 * same shape `ask()` in `scripts/health/probes/_transport.mjs` keeps, and the
 * two rules that go with it are kept here for the same reasons:
 *
 *   · `redirect: "manual"` — a followed 307 hands back somebody else's 200 and
 *     carries the bearer token there.
 *   · `AbortSignal.timeout(…)` — a hung request in a command nobody is watching
 *     the network for is indistinguishable from a hung command.
 *
 * `fetch()` and nothing else: `curl` is not on every machine.
 *
 * @param {{origin: string, secret: string, task: string, timeoutMs?: number}} options
 * @returns {Promise<{state: "called", body: Record<string, any>}
 *                 | {state: "skip", reason: string, status?: number, detail?: string}>}
 */
export async function askApp({ origin, secret, task, timeoutMs = PROBE_TIMEOUT_MS }) {
  const url = `${String(origin).replace(/\/+$/, "")}${LIVE_PATH}`;

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ task }),
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // "TypeError: fetch failed" names no host, and the first thing anybody wants
    // to know is which one — so the address goes in front of the transport's own
    // words, exactly as `_transport.mjs` does it.
    const name = String(error?.name ?? "") || "the request failed";
    const said = String(error?.cause?.message ?? error?.message ?? "").trim() || "no further detail";
    return { state: "skip", reason: "appDown", detail: `${name}: ${said}` };
  }

  if (response.status === 404) return { state: "skip", reason: "doorClosed", status: 404 };
  if (response.status === 429) return { state: "skip", reason: "doorLimited", status: 429 };

  if (response.status === 400) {
    const body = await response.json().catch(() => ({}));
    const known = Array.isArray(body?.known) ? ` — known: ${body.known.join(", ")}` : "";
    return {
      state: "skip",
      reason: "taskRefused",
      status: 400,
      detail: `${body?.error ?? "refused"}${known}`,
    };
  }

  if (response.status !== 200) {
    return { state: "skip", reason: "doorFailed", status: response.status };
  }

  const body = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof body.ok !== "boolean") {
    return {
      state: "skip",
      reason: "doorFailed",
      status: 200,
      detail: "the answer was not the shape this command understands",
    };
  }

  return { state: "called", body };
}
