// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What jobs this app performs with a model, and how a job finds its model.
//
// ── The one idea ───────────────────────────────────────────────────────────
// A call names a TASK, never a model. That single choice is what makes two
// unrelated-looking things the same thing: an Operator can rebind `chat` to a
// different provider without touching code, AND the cost report has something
// meaningful to group by. A page that says "you spent €40 on Sonnet" does not
// tell anybody which feature to change; one that says "the assistant €38, draft
// generation €2" does.
//
// ── Declared in code, bound in configuration ───────────────────────────────
// The asymmetry is the point:
//
//   a task in TASKS with no binding   → falls back to the default and works.
//                                       Adding a task is a one-line change.
//   a binding naming a task not in TASKS → a typo, and `ai-check` fails on it.
//
// Adding is cheap; misspelling is loud.
//
// ── Why .mjs ───────────────────────────────────────────────────────────────
// `scripts/ai/check.mjs` has to validate the same bindings the app resolves,
// and the scripts here do not import TypeScript (CLAUDE.md → Three systems).
// One implementation, two readers. `tasks.ts` puts the types back on.

import {
  PROVIDER_CAPABILITIES,
  PROVIDER_DEFAULT_IMAGE_MODELS,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_ENV_VARS,
  PROVIDER_IDS,
  providerCan,
  providersThatCan,
} from "./providers/ids.mjs";

/**
 * The jobs this app performs.
 *
 * **Three ship, and they are not three of a kind.** Two have code in this
 * template that calls them: `chat` is the support assistant
 * (`app/api/chat/route.ts`) and `image` produces a picture
 * (`lib/media/generate.ts`). The third, `companion`, ships as the SHAPE a
 * product-side call takes — `modules/companion/companion.ts` is the function (the `companion` MODULE — this task id is core vocabulary and stays in TASKS whatever is installed), and what
 * calls it is the app somebody builds here. It is bound rather than merely
 * possible for one reason: what a companion costs has to be separable from what
 * support costs on the cost page, and grouping is by task id.
 *
 * Moderation and your own jobs are still what the layer MAKES POSSIBLE and stay
 * out of this list until something calls them — a bound task nobody calls is a
 * line `ai-check` complains about for ever. The worked examples are in
 * `docs/ai-providers.md` and in the `ai-providers` skill.
 *
 * Adding your own is two steps and no migration:
 *   1. add the id here
 *   2. optionally bind it in `config/ai-models.json` (it works without)
 */
export const TASKS = ["chat", "image", "companion"];

export function isTaskId(value) {
  return TASKS.includes(value);
}

/**
 * What each task needs a provider to be able to DO.
 *
 * ── Why a task has a kind at all ───────────────────────────────────────────
 * Because two of the five companies cannot draw. Without this, binding `image`
 * to Anthropic produces a config that looks entirely correct and fails at the
 * first customer who presses the button — and the reason lands in a server log
 * rather than in front of the person who wrote the binding. With it, the same
 * mistake is a line from `node run.mjs ai-check`, next to the misspelt
 * providers and the models pinned beside `"auto"`.
 *
 * A task with no entry is text, which keeps adding an ordinary task a one-line
 * change.
 */
export const TASK_KINDS = {
  chat: "text",
  image: "image",
};

export function kindOfTask(task) {
  return TASK_KINDS[task] ?? "text";
}

/**
 * "Whichever company this machine has a key for."
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The template used to ship bound to one company by name. That is a decision
 * nobody had made yet: a developer puts MISTRAL_API_KEY in their `.env`,
 * everything they can see says the key is correct — and the assistant stays
 * off, because the shipped binding names Anthropic. The app was right and
 * useless at the same time. `"auto"` moves the shipped default from *a company*
 * to *a rule*: run on the key that is actually here.
 *
 * ── What it does NOT do ────────────────────────────────────────────────────
 * It never overrides a decision. A binding naming a company is obeyed exactly
 * as written, key or no key — an Operator who wrote `"anthropic"` gets
 * Anthropic or an honest error, never a quiet substitution onto a company they
 * did not choose. Silently answering from somebody else's API would be a
 * surprise on an invoice, and this file's whole job is to keep those out.
 * `"auto"` is opt-in by being the shipped default, and one edit leaves it.
 */
export const AUTO = "auto";

/**
 * Where `"auto"` lands when this machine has no key at all.
 *
 * Something has to be named, because a binding is not allowed to be unresolved
 * — half the app reads `binding.provider` and none of it wants a null. Nothing
 * is called: with no key the chat is off (`isChatEnabled()`) and `ai-check`
 * says which variable to set. This is the value those messages are written
 * about, not a company that gets picked by default.
 */
export const LAST_RESORT_PROVIDER = "anthropic";

/**
 * The last resort for a KIND of work.
 *
 * `LAST_RESORT_PROVIDER` is the text answer and stays so. An image task cannot
 * use it: Anthropic has no image model, so a binding resolved to it would carry
 * `model: null` to an adapter — an unresolved binding, which is precisely what
 * naming a last resort exists to prevent.
 *
 * Nothing is called either way. With no key the task is refused and
 * `ai-check` says which variable to set; this is the value those messages are
 * written about.
 */
export function lastResortFor(kind) {
  if (providerCan(LAST_RESORT_PROVIDER, kind)) return LAST_RESORT_PROVIDER;
  return providersThatCan(kind)[0] ?? LAST_RESORT_PROVIDER;
}

/**
 * Sensible when a config says nothing. Never silently applied to a typo.
 *
 * Both halves are `"auto"`, so an app whose `config/ai-models.json` is missing
 * or empty still runs on whatever key is present. Anything the Operator writes
 * overrides it field by field.
 */
export const FALLBACK_BINDING = {
  provider: AUTO,
  model: AUTO,
  maxTokens: 2000,
  timeoutMs: 60000,
  providerOptions: {},
};

/**
 * Whose vocabulary a tuning option belongs to.
 *
 * This exists because of the one edit everybody makes: moving a task to another
 * company means changing `provider` and `model`, and `providerOptions` is the
 * field people leave behind. It was written for the OLD provider, and the new
 * one answers a request carrying a field it never defined with an error — on
 * the customer's first message, with the reason in a server log nobody is
 * watching. Named here instead, by `node run.mjs ai-check`, at the moment the
 * config is changed.
 *
 * **It is not an allowlist.** `providerOptions` stays the escape hatch (AD-13):
 * a key nobody here has heard of travels untouched, because five providers add
 * parameters faster than a template can track them. Only a key that is
 * demonstrably somebody ELSE'S is refused — and it is refused as a config
 * error, never quietly dropped, because an Operator who wrote `thinking` meant
 * to buy thinking and should not be told everything is fine.
 *
 * OpenAI, Mistral and OpenRouter share one request shape (`openai-compat.ts`),
 * so what one of them understands counts as understood by all three. Being
 * generous here is deliberate: a false accusation would block a config that
 * works, which is worse than missing one that does not.
 */
const COMPAT_FAMILY = ["openai", "mistral", "openrouter"];

export const OPTION_OWNERS = {
  // Ours, not a provider's — consumed by the Anthropic adapter and never sent
  // (`RESERVED_OPTION_KEYS` in lib/ai/providers/types.ts).
  cacheTtl: ["anthropic"],
  thinking: ["anthropic"],
  output_config: ["anthropic"],
  generationConfig: ["gemini"],
  safetySettings: ["gemini"],
  cachedContent: ["gemini"],
  reasoning_effort: COMPAT_FAMILY,
  response_format: COMPAT_FAMILY,
  safe_prompt: COMPAT_FAMILY,
};

/** The keys this layer consumes itself, so they never reach a provider. */
const RESERVED_OPTIONS = ["cacheTtl"];

/** Options in this binding that were written for a different company. */
export function foreignOptions(provider, providerOptions) {
  return Object.keys(providerOptions ?? {}).filter((key) => {
    const owners = OPTION_OWNERS[key];
    return owners !== undefined && !owners.includes(provider);
  });
}

function positiveInt(value, fallback, max) {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  if (value < 1 || value > max) return fallback;
  return value;
}

/**
 * What the config SAYS for one task, before `"auto"` is resolved.
 *
 * Split out from `resolveBinding` because the two questions have different
 * answers and different audiences: this one is about the file (and is what
 * `bindingProblems` judges, so a misspelt provider is still visible after
 * resolution has replaced it with a working one), the other is about this
 * machine.
 */
export function mergedBinding(config, task) {
  const base = { ...FALLBACK_BINDING, ...(config?.default ?? {}) };
  const entry = config?.tasks?.[task] ?? {};
  const merged = { ...base, ...entry };

  return {
    provider: merged.provider,
    model: merged.model,
    maxTokens: positiveInt(
      merged.maxTokens,
      FALLBACK_BINDING.maxTokens,
      200000,
    ),
    timeoutMs: positiveInt(
      merged.timeoutMs,
      FALLBACK_BINDING.timeoutMs,
      600000,
    ),
    // Provider-shaped tuning, merged so a task can add to the default's without
    // restating it. Never interpreted here (AD-13).
    providerOptions: {
      ...(base.providerOptions ?? {}),
      ...(entry.providerOptions ?? {}),
    },
  };
}

/**
 * Which company actually answers — `"auto"` turned into a name.
 *
 * The order is `PROVIDER_IDS`, and it only ever decides between keys that are
 * BOTH present, which is a situation the Operator created and can end by
 * naming one. Deterministic on purpose: "whichever happened to be first in the
 * `.env`" would make the same app answer from a different company after an
 * unrelated edit.
 *
 * A provider this file does not recognise is treated as `"auto"` rather than
 * passed through. The alternative is `isConfigured()` indexing the registry
 * with a typo — and that runs inside `isChatEnabled()` in the dashboard LAYOUT,
 * so it would take down every page under /dashboard rather than one feature.
 * The typo is still reported, by name, by `bindingProblems`.
 */
export function resolveProvider(
  provider,
  configuredProviders = [],
  kind = "text",
) {
  if (PROVIDER_IDS.includes(provider)) return provider;
  // `"auto"` picks among the keys this machine HAS, and for an image task it
  // picks among the ones that can draw. Falling back to a company that cannot
  // would make the shipped binding the one that never works — and the failure
  // would arrive at a customer rather than at the person who set the key.
  const capable = PROVIDER_IDS.filter(
    (id) => configuredProviders.includes(id) && providerCan(id, kind),
  );
  if (capable.length > 0) return capable[0];
  // No configured provider can do this kind of work. Rather than landing on one
  // that cannot, name the one this template would use if a key appeared — so
  // the binding is resolved, the model is not null, and `bindingProblems` can
  // say which key would make it work.
  return lastResortFor(kind);
}

/**
 * The binding for one task: which provider, which model, what limits.
 *
 * Pure — it takes the already-parsed config and the list of configured
 * providers rather than reading a file or `process.env`, so the app and the
 * check command resolve identically and the resolution is testable without
 * either.
 *
 * Two things are resolved here and nowhere else: `"auto"` becomes a company
 * (from the keys on this machine), and a model left to `"auto"` becomes that
 * company's default. A task with no entry inherits `default`, and `default`
 * itself falls back to FALLBACK_BINDING — so a config that is merely
 * INCOMPLETE still runs. A config that is WRONG is still refused, by
 * `bindingProblems` at check time rather than here at call time.
 */
export function resolveBinding(config, task, configuredProviders = []) {
  const merged = mergedBinding(config, task);
  const provider = resolveProvider(
    merged.provider,
    configuredProviders,
    kindOfTask(task),
  );

  // A model belongs to exactly one company, so a model pinned for somebody
  // else cannot travel with `"auto"`: it would reach the new provider as a
  // model id they have never heard of. The pin is reported by
  // `bindingProblems` and ignored here — a wrong model id is a failed answer,
  // where the provider's own default is a working one.
  const pinned = typeof merged.model === "string" ? merged.model.trim() : "";
  const usePinned =
    pinned !== "" && pinned !== AUTO && merged.provider !== AUTO;

  // The default model depends on what the task is FOR. A company's
  // general-purpose text model cannot draw, so `"auto"` on an image task has to
  // land on that company's image model — otherwise `"auto"`, the shipped
  // binding, would be the one combination that never works.
  const defaults =
    kindOfTask(task) === "image"
      ? PROVIDER_DEFAULT_IMAGE_MODELS
      : PROVIDER_DEFAULT_MODELS;

  // `ai_usage.model` is NOT NULL, and `run.ts` records a row even when the call
  // never reached a provider (AD-20) — so a null here loses exactly the row an
  // Operator needs when a binding is wrong. A provider with no model for this
  // kind gets a sentinel that reads correctly on the cost page instead.
  const fallbackModel = defaults[provider] ?? `(no ${kindOfTask(task)} model)`;

  return {
    ...merged,
    provider,
    model: usePinned ? pinned : fallbackModel,
  };
}

/**
 * Everything wrong with `config/ai-models.json`, as sentences naming the fix.
 *
 * `configuredProviders` is passed in rather than read from `process.env` here,
 * so this stays pure and so the check command can report on a machine other
 * than the one it runs on if it ever needs to.
 *
 * The whole point is WHEN this runs: at check time, naming the task and the
 * file — not at a customer's first request, where the same mistake surfaces as
 * a failed answer with the reason in a server log nobody is watching.
 */
export function bindingProblems(config, configuredProviders, { notes } = {}) {
  const problems = [];

  // A binding for a task that does not exist. Almost always a typo, and
  // otherwise a task somebody forgot to declare — either way it silently does
  // nothing, which is why it is an error rather than a warning.
  for (const task of Object.keys(config?.tasks ?? {})) {
    if (!isTaskId(task)) {
      problems.push(
        `config/ai-models.json → tasks."${task}": there is no such task. ` +
          `Declared tasks are: ${TASKS.join(", ")}. Add it to TASKS in lib/ai/task-rules.mjs, or fix the spelling.`,
      );
    }
  }

  for (const task of TASKS) {
    const declared = mergedBinding(config, task);
    const binding = resolveBinding(config, task, configuredProviders);
    const where = config?.tasks?.[task] ? `tasks."${task}"` : "default";
    const isAuto = declared.provider === AUTO;

    if (!isAuto && !PROVIDER_IDS.includes(declared.provider)) {
      problems.push(
        `config/ai-models.json → ${where}.provider: "${declared.provider}" is not a provider. ` +
          `Pick one of: ${PROVIDER_IDS.join(", ")} — or "${AUTO}" to run on whichever key is in the .env.`,
      );
      continue;
    }

    // A model id belongs to one company. Pinning one while letting the company
    // be chosen automatically is a contradiction the Operator cannot see the
    // consequences of: it works for as long as `auto` happens to land on the
    // right company and 404s the day a second key appears.
    const pinned =
      typeof declared.model === "string" ? declared.model.trim() : "";
    if (isAuto && pinned !== "" && pinned !== AUTO) {
      problems.push(
        `config/ai-models.json → ${where}: provider is "${AUTO}" but model is pinned to ` +
          `"${pinned}" — a model belongs to one company, so the two cannot both be right. ` +
          `Name the provider that model belongs to, or set model to "${AUTO}" and let it follow.`,
      );
      continue;
    }

    // Can this company do this KIND of work at all? Asked before the key is,
    // because "Anthropic cannot draw" is a different problem from "Anthropic
    // has no key", and telling somebody to add a key that would not help is
    // worse than saying nothing.
    const kind = kindOfTask(task);

    if (!providerCan(binding.provider, kind)) {
      const able = providersThatCan(kind);
      problems.push(
        isAuto
          ? `Task "${task}" needs a provider that can produce ${kind}, and the key on this ` +
              `machine is ${binding.provider}, which cannot. ${
                able.length === 0
                  ? "No provider in this template can."
                  : `Add one of these to .env instead: ${able
                      .map((id) => PROVIDER_ENV_VARS[id])
                      .join(", ")} — or leave the task unused.`
              }`
          : `config/ai-models.json → ${where}.provider: "${binding.provider}" cannot produce ` +
              `${kind}, and task "${task}" is a ${kind} task. ${
                able.length === 0
                  ? "No provider in this template can."
                  : `Use one of: ${able.join(", ")}.`
              }`,
      );
      continue;
    }

    // A kind whose provider has no default model. Only reachable if a
    // capability was declared without a model beside it — a mistake in this
    // repo rather than in an Operator's config, and one that would otherwise
    // travel as `model: null` to an adapter.
    if (!binding.model) {
      problems.push(
        `Task "${task}" resolves to ${binding.provider} with no model. ` +
          `PROVIDER_DEFAULT_${kind === "image" ? "IMAGE_" : ""}MODELS in ` +
          `lib/ai/providers/ids.mjs has no entry for it.`,
      );
      continue;
    }

    if (!configuredProviders.includes(binding.provider)) {
      const able = providersThatCan(kind);
      // Three different situations, and telling them apart is the whole value
      // of the message. "No key at all" and "a key that cannot do this" send
      // somebody to completely different places, and the second one used to
      // read as the first — which is worse than saying nothing, because it
      // tells a person with a working key to go and find a key.
      const haveButCannot =
        isAuto &&
        configuredProviders.length > 0 &&
        !configuredProviders.some((id) => providerCan(id, kind));

      // ── An unasked-for task is a NOTE, not a problem ────────────────────
      // `image` ships on `"auto"`, and two of the five companies draw nothing.
      // Without this, the commonest single-key installation there is — one
      // Anthropic key, this template's own default — got a permanently red
      // `ai-check` for a feature it may never use, and could only silence it by
      // buying a second key. A gate that is always red is a gate nobody reads.
      //
      // "Unasked-for" means the Operator has not NAMED a company: an entry
      // saying `"auto"` is the shipped default written out for discoverability,
      // not a decision. Write a provider name there and the same situation is a
      // real problem again, because then somebody asked for it.
      //
      // **It is downgraded only where there is somewhere to put it.** A caller
      // that passes no `notes` array — `taskProblems()` in `lib/ai/tasks.ts` is
      // one — has no channel for a note, and `notes?.push()` followed by
      // `continue` meant the condition was reported NOWHERE for that caller.
      // Silence is the one answer this function must never give, so without a
      // notes array it stays a problem.
      const downgraded = haveButCannot && isAuto && notes !== undefined;
      if (downgraded) {
        notes.push(
          `Task "${task}" would need a provider that can produce ${kind}, and the key on ` +
            `this machine is for ${configuredProviders.join(", ")}, which cannot. Nothing is ` +
            `wrong until your app asks for one — then add ` +
            `${able.map((id) => PROVIDER_ENV_VARS[id]).join(" or ")} alongside the key you have.`,
        );
      }

      // …and the `continue` that used to sit here skipped the `providerOptions`
      // check below for this task as well, which is a different fault with a
      // different fix and had nothing to do with the key situation.
      if (!downgraded)
        problems.push(
          haveButCannot
            ? `Task "${task}" needs a provider that can produce ${kind}, and the key on this ` +
                `machine is for ${configuredProviders.join(", ")} — which cannot. ` +
                `Add one of these to .env as well: ${able.map((id) => PROVIDER_ENV_VARS[id]).join(", ")}. ` +
                `Your other tasks keep running on the key you already have.`
            : isAuto
              ? `Task "${task}" runs on "${AUTO}", and this machine has no provider key at all. ` +
                `Add ONE of these to .env: ${(kind === "text"
                  ? PROVIDER_IDS
                  : able
                )
                  .map((id) => PROVIDER_ENV_VARS[id])
                  .join(", ")}.`
              : `Task "${task}" is bound to ${binding.provider}, but ${PROVIDER_ENV_VARS[binding.provider]} ` +
                `is not set. Add it to .env — or set the provider to "${AUTO}" to run on whichever key you have.`,
        );
    }

    // A leftover from the provider this task used to run on. Two different
    // wrongs, so two different sentences: one of them would be refused by the
    // provider, the other silently does nothing — and "it does nothing" is the
    // one somebody would otherwise keep for years, believing they bought it.
    for (const key of foreignOptions(
      binding.provider,
      binding.providerOptions,
    )) {
      const owners = OPTION_OWNERS[key].join(" / ");
      problems.push(
        RESERVED_OPTIONS.includes(key)
          ? `config/ai-models.json → ${where}.providerOptions."${key}": only ${owners} has that to set, ` +
              `and this task runs on ${binding.provider} — where the line does nothing. Delete it.`
          : `config/ai-models.json → ${where}.providerOptions."${key}": that is ${owners} vocabulary, ` +
              `and this task runs on ${binding.provider}. Delete the line, or give ${binding.provider} its own ` +
              `equivalent — a request carrying a field a provider does not know comes back as an error.`,
      );
    }
  }

  return problems;
}
