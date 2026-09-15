// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

import models from "@/config/ai-models.json";

import {
  AUTO,
  FALLBACK_BINDING,
  LAST_RESORT_PROVIDER,
  TASKS as TASK_IDS,
  bindingProblems,
  mergedBinding,
  resolveBinding,
} from "./task-rules.mjs";
import { PROVIDER_DEFAULT_IMAGE_MODELS, PROVIDER_DEFAULT_MODELS } from "./providers/ids.mjs";
import { TASKS, allBindings, isTaskId, taskConfigProblems, taskKind } from "./tasks";
import { PROVIDER_IDS } from "./providers/types";
import { PROVIDER_IDS as MJS_PROVIDER_IDS, PROVIDER_ENV_VARS } from "./providers/ids.mjs";

const ALL_PROVIDERS = [...PROVIDER_IDS];

describe("the two copies of each list agree", () => {
  it("TASKS is the same in the .ts and the .mjs", () => {
    // The .mjs holds the list the check command reads; the .ts holds the union
    // type the compiler enforces. They cannot be derived from one another, so
    // this is what stops them drifting.
    expect([...TASKS]).toEqual([...TASK_IDS]);
  });

  it("PROVIDER_IDS is the same in the .ts and the .mjs", () => {
    expect([...PROVIDER_IDS]).toEqual([...MJS_PROVIDER_IDS]);
  });

  it("every provider has an environment variable named for it", () => {
    for (const id of PROVIDER_IDS) {
      expect(PROVIDER_ENV_VARS[id]).toMatch(/^[A-Z0-9_]+$/);
    }
  });
});

// The three the TEMPLATE declares. Every assertion below about "the shipped
// tasks" walks this list, never `TASKS` itself — `TASKS` is the customer's list
// once they add one (reviewed 2026-09-15: a loop over `TASKS` demanding "auto"
// went red the moment a customer bound their own task to a named company).
const SHIPPED_TASKS = ["chat", "image", "companion"] as const;

describe("the shipped registry", () => {
  it("carries the three tasks the template ships", () => {
    // `chat` is the assistant and `image` is a picture — both have code in this
    // template that calls them. `companion` is the shape a product-side call
    // takes (`lib/ai/companion.ts`); what calls it is the app somebody builds
    // here, and it is bound anyway so its spend is separable from support's on
    // the cost page. Moderation and your own jobs are what the layer MAKES
    // POSSIBLE and live as worked examples in the docs — not here, because a
    // bound task nobody calls is a line `ai-check` complains about for ever.
    //
    // ⚠️ CONTAINS, never equals, and that is the whole shape of this test. It
    // SHIPS inside the customer's app, where a FOURTH task is the normal state
    // rather than a fault: declaring one is the documented way to use this layer
    // (CLAUDE.md → *Talking to a language model* — "A task MUST be declared in
    // code"). Measured 2026-09-15: a session that registered its app's own task
    // had to rewrite this assertion and one in `scripts/ai/live.test.ts` before
    // the suite it had just been told was the commit condition went green — a
    // shipped test going red over the product working as sold.
    //
    // The "and no more" claim is about the TEMPLATE, so it lives in the factory,
    // where `template/` is pristine by construction and nothing under it is a
    // customer's own work.
    for (const task of SHIPPED_TASKS) {
      expect([...TASKS], `the task "${task}" the template ships`).toContain(task);
    }
  });

  it("knows which kind of provider each task needs", () => {
    // The reason two of the five companies are not interchangeable here.
    expect(taskKind("chat")).toBe("text");
    expect(taskKind("image")).toBe("image");
    // `companion` has no entry in TASK_KINDS and must not need one — text is
    // what an unlisted task falls back to, which is what keeps adding an
    // ordinary task a one-line change.
    expect(taskKind("companion")).toBe("text");
  });

  it("recognises its own tasks and nothing else", () => {
    expect(isTaskId("chat")).toBe(true);
    expect(isTaskId("image")).toBe(true);
    expect(isTaskId("chatt")).toBe(false);
    expect(isTaskId(undefined)).toBe(false);
  });
});

describe("config/ai-models.json", () => {
  it("is structurally coherent", () => {
    // The same deal `lib/billing-mode.test.ts` makes: a second source of truth
    // is only safe while something checks it against the first. Credentials are
    // deliberately NOT checked here — a developer's machine legitimately has no
    // keys, and `node run.mjs ai-check` is where that is reported.
    expect(taskConfigProblems()).toEqual([]);
  });

  it("binds every declared task to a real provider and a named model", () => {
    for (const [task, binding] of Object.entries(allBindings())) {
      expect(PROVIDER_IDS, `task ${task}`).toContain(binding.provider);
      expect(binding.model.trim(), `task ${task}`).not.toBe("");
      expect(binding.maxTokens, `task ${task}`).toBeGreaterThan(0);
    }
  });

  it("ships every task on \"auto\", so one key in the .env is enough", () => {
    // The property a new app is judged on: a developer puts ONE of the five
    // keys in .env and the AI works. A company named here would be a decision
    // nobody had made yet, and it silently costs everybody who chose a
    // different one their whole AI layer.
    const raw = models as { default?: { provider?: string }; tasks?: Record<string, { provider?: string }> };
    expect(raw.default?.provider).toBe(AUTO);
    // The SHIPPED tasks only: a task this app declared and bound to a named
    // company is the ai-providers skill doing its job, not a regression.
    for (const task of SHIPPED_TASKS) {
      expect(raw.tasks?.[task]?.provider ?? AUTO, `task ${task}`).toBe(AUTO);
    }
  });

  it("pins no provider-specific option while the provider is \"auto\"", () => {
    // `thinking` is Anthropic's word, `generationConfig` is Gemini's. An option
    // belongs to one company, so one written down here is wrong the moment
    // `auto` lands on another — and a request carrying a field a provider does
    // not know comes back as an error, on a customer's first question.
    //
    // This is where the chat's `cacheTtl: "1h"` went. Nothing was lost: the
    // Anthropic adapter defaults to a one-hour window when the binding says
    // nothing (`cacheTtlFrom` in providers/anthropic.ts, asserted in its own
    // test), so the assistant's handbook is still billed once an hour rather
    // than once every five minutes. What changed is that the guarantee no
    // longer needs a line naming one company in a config that ships portable.
    for (const [task, binding] of Object.entries(allBindings())) {
      expect(Object.keys(binding.providerOptions), `task ${task}`).toEqual([]);
    }
  });
});

describe("resolveBinding", () => {
  const config = {
    default: { provider: "anthropic", model: "d-model", maxTokens: 100 },
    tasks: { chat: { provider: "openai", model: "c-model" } },
  };

  it("prefers the task's own entry", () => {
    expect(resolveBinding(config, "chat")).toMatchObject({
      provider: "openai",
      model: "c-model",
    });
  });

  it("inherits what the task does not state", () => {
    // maxTokens is not on the chat entry, so it comes from default.
    expect(resolveBinding(config, "chat").maxTokens).toBe(100);
  });

  it("falls back to the default for a task with no entry at all", () => {
    // A declared task with no binding WORKS. Adding a task is a one-line change
    // — the config is optional, the declaration is not.
    expect(resolveBinding(config, "somethingElse")).toMatchObject({
      provider: "anthropic",
      model: "d-model",
    });
  });

  it("falls back again when the config says nothing", () => {
    // The fallback is "auto"/"auto", so an app with no config at all still runs
    // on whatever key is present rather than on a company nobody chose.
    expect(FALLBACK_BINDING.provider).toBe(AUTO);
    expect(mergedBinding({}, "chat")).toMatchObject({ provider: AUTO, model: AUTO });
    expect(resolveBinding({}, "chat", ["mistral"])).toMatchObject({
      provider: "mistral",
      model: PROVIDER_DEFAULT_MODELS.mistral,
    });
    expect(resolveBinding(undefined, "chat").maxTokens).toBe(FALLBACK_BINDING.maxTokens);
  });

  it("still names a provider when the machine has no key at all", () => {
    // A binding is never left unresolved — half the app reads
    // `binding.provider` and none of it wants a null. Nothing is called: with
    // no key the chat is off and `ai-check` says which variable to set.
    expect(resolveBinding({}, "chat", []).provider).toBe(LAST_RESORT_PROVIDER);
  });

  it("obeys a named provider even when its key is missing", () => {
    // The line that keeps `auto` from being a surprise on an invoice: a
    // decision, once written down, is never quietly swapped for another
    // company — it produces an honest error instead.
    expect(resolveBinding({ default: { provider: "openai", model: "auto" } }, "chat", ["mistral"]))
      .toMatchObject({ provider: "openai", model: PROVIDER_DEFAULT_MODELS.openai });
  });

  it("merges providerOptions rather than replacing them", () => {
    const merged = resolveBinding(
      {
        default: { providerOptions: { cacheTtl: "1h", a: 1 } },
        tasks: { chat: { providerOptions: { a: 2, b: 3 } } },
      },
      "chat",
    );
    expect(merged.providerOptions).toEqual({ cacheTtl: "1h", a: 2, b: 3 });
  });

  it("refuses a nonsensical maxTokens rather than passing it on", () => {
    expect(resolveBinding({ default: { maxTokens: 0 } }, "chat").maxTokens)
      .toBe(FALLBACK_BINDING.maxTokens);
    expect(resolveBinding({ default: { maxTokens: -5 } }, "chat").maxTokens)
      .toBe(FALLBACK_BINDING.maxTokens);
    expect(resolveBinding({ default: { maxTokens: "many" } }, "chat").maxTokens)
      .toBe(FALLBACK_BINDING.maxTokens);
  });
});

describe("bindingProblems", () => {
  it("is silent on a coherent config", () => {
    expect(
      bindingProblems(
        {
          default: { provider: "anthropic", model: "m" },
          // The image task needs a company that draws. Naming one here is what
          // makes this config coherent rather than merely well-formed — see
          // the capability tests below.
          tasks: { image: { provider: "openai", model: "m" } },
        },
        ALL_PROVIDERS,
      ),
    ).toEqual([]);
  });

  it("catches a binding for a task that does not exist", () => {
    // Almost always a typo, and it silently does nothing — which is why it is
    // an error and not a warning.
    const problems = bindingProblems(
      { default: { provider: "anthropic", model: "m" }, tasks: { chatt: {} } },
      ALL_PROVIDERS,
    );
    expect(problems.join(" ")).toContain('tasks."chatt"');
    expect(problems.join(" ")).toContain("no such task");
  });

  it("catches an unknown provider and lists the real ones", () => {
    const problems = bindingProblems(
      { default: { provider: "cohere", model: "m" } },
      ALL_PROVIDERS,
    );
    expect(problems.join(" ")).toContain("cohere");
    expect(problems.join(" ")).toContain("anthropic");
  });

  it("accepts a named provider with no model, and uses that provider's default", () => {
    // This used to be an error. It stopped being one when a model id became
    // something the layer can supply: naming the company is the decision, and
    // its current general-purpose model is the obvious consequence.
    expect(
      bindingProblems(
        {
          default: { provider: "anthropic", model: "  " },
          tasks: { image: { provider: "openai", model: "  " } },
        },
        ALL_PROVIDERS,
      ),
    ).toEqual([]);
    expect(resolveBinding({ default: { provider: "anthropic", model: "  " } }, "chat", ALL_PROVIDERS))
      .toMatchObject({ provider: "anthropic", model: PROVIDER_DEFAULT_MODELS.anthropic });
  });

  it("refuses a model pinned to one company while the company is \"auto\"", () => {
    // The contradiction that would otherwise work until the day a second key
    // appears, then 404 on a customer's first question.
    const problems = bindingProblems(
      { default: { provider: AUTO, model: "claude-sonnet-5" } },
      ALL_PROVIDERS,
    );
    expect(problems.join(" ")).toContain("claude-sonnet-5");
    expect(problems.join(" ")).toContain(AUTO);
  });

  it("says which keys would do when \"auto\" has none to choose from", () => {
    // The message an Operator with an empty .env reads. It must not name one
    // company — any of the five ends the problem.
    const problems = bindingProblems({ default: { provider: AUTO } }, []).join(" ");
    for (const id of ALL_PROVIDERS) {
      expect(problems).toContain(PROVIDER_ENV_VARS[id]);
    }
  });

  it("names the environment variable when the key is missing", () => {
    // "no credential" does not tell somebody which line to add to .env.
    const problems = bindingProblems(
      { default: { provider: "mistral", model: "m" } },
      [], // nothing configured
    );
    expect(problems.join(" ")).toContain("MISTRAL_API_KEY");
    expect(problems.join(" ")).toContain("chat");
  });

  it("names a tuning option left behind by the previous provider", () => {
    // The one edit everybody makes: provider and model changed, providerOptions
    // forgotten. Anthropic's `thinking` reaches Mistral as a field it never
    // defined — an error on the customer's first message unless it is caught
    // here, in the command somebody runs right after making the change.
    const problems = bindingProblems(
      {
        default: { provider: "anthropic", model: "m" },
        tasks: {
          chat: {
            provider: "mistral",
            model: "m",
            providerOptions: { thinking: { type: "adaptive" } },
          },
        },
      },
      ALL_PROVIDERS,
    );
    expect(problems.join(" ")).toContain('providerOptions."thinking"');
    expect(problems.join(" ")).toContain("anthropic");
    expect(problems.join(" ")).toContain("mistral");
  });

  it("says of cacheTtl that it does nothing here, not that it breaks", () => {
    // It is ours and every adapter strips it, so the call works. What is wrong
    // is the belief: somebody set a cache window on a provider that has none.
    const problems = bindingProblems(
      { default: { provider: "openai", model: "m", providerOptions: { cacheTtl: "1h" } } },
      ALL_PROVIDERS,
    );
    expect(problems.join(" ")).toContain("does nothing");
  });

  it("leaves an option it has never heard of alone", () => {
    // providerOptions is the escape hatch. Five providers add parameters faster
    // than this template can track them, so an unknown key is somebody using
    // the hatch — not a mistake to refuse.
    expect(
      bindingProblems(
        {
          default: {
            provider: "openai",
            model: "m",
            providerOptions: { some_new_flag_from_last_tuesday: true },
          },
        },
        ALL_PROVIDERS,
      ),
    ).toEqual([]);
  });

  it("is silent about an option the bound provider owns", () => {
    expect(
      bindingProblems(
        {
          // On the TASK and not on the default. A `default.providerOptions` is
          // inherited by every task — including the image one, which runs
          // somewhere else — and the check would then be right to complain
          // about Anthropic vocabulary reaching OpenAI. Putting a company's
          // options beside the task bound to that company is the shape a real
          // config has, and the reason `mergedBinding` merges rather than
          // replaces.
          default: { provider: "anthropic", model: "m" },
          tasks: {
            chat: { providerOptions: { cacheTtl: "1h", thinking: { type: "adaptive" } } },
            image: { provider: "openai", model: "m" },
          },
        },
        ALL_PROVIDERS,
      ),
    ).toEqual([]);
  });

  it("counts an OpenAI option as understood by Mistral and OpenRouter", () => {
    // One request shape, three providers (openai-compat.ts). Being generous
    // here is deliberate: a false accusation blocks a config that works.
    expect(
      bindingProblems(
        {
          default: {
            provider: "openrouter",
            model: "m",
            providerOptions: { reasoning_effort: "low" },
          },
        },
        ALL_PROVIDERS,
      ),
    ).toEqual([]);
  });

  it("reports the provider problem and stops, rather than piling on", () => {
    // An unknown provider has no environment variable to be missing, so
    // complaining about both would send somebody chasing a second error that
    // disappears when they fix the first.
    // Scoped to the chat task: the default reaches both, and two tasks naming
    // the same bad provider would honestly be two problems.
    const problems = bindingProblems(
      {
        default: { provider: "openai", model: "m" },
        tasks: { chat: { provider: "cohere", model: "m" } },
      },
      ["openai"],
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("cohere");
  });
});

// ── Who can draw ────────────────────────────────────────────────────────────
//
// The check that makes the image task usable rather than merely present: two of
// the five companies produce no pictures, and without this the mistake reaches
// the first customer who presses the button, with the reason in a server log
// nobody is watching.

describe("a task whose provider cannot do the work", () => {
  it("refuses an image task bound by name to a company that draws nothing", () => {
    const problems = bindingProblems(
      {
        default: { provider: "openai", model: "m" },
        tasks: { image: { provider: "anthropic", model: "m" } },
      },
      ALL_PROVIDERS,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("anthropic");
    expect(problems[0]).toContain("cannot produce image");
    // And it says which ones would, because "not this one" is half an answer.
    expect(problems[0]).toContain("openai");
  });

  it("tells apart a machine with the WRONG key from one with NO key", () => {
    // The distinction is the whole value of the message. Somebody holding a
    // perfectly good Anthropic key should not be told to go and find a key.
    //
    // On an UNBOUND task it is a note rather than a problem — a code review
    // found that the shipped config gave the commonest single-key installation
    // a permanently red `ai-check` for a feature it may never use, and a gate
    // that is always red is a gate nobody reads.
    const notes: string[] = [];
    const wrongKey = bindingProblems({}, ["anthropic"], { notes });
    expect(wrongKey).toEqual([]);
    expect(notes.some((n) => /is for anthropic, which cannot/.test(n))).toBe(true);
    expect(notes.some((n) => /Nothing is wrong until your app asks/.test(n))).toBe(true);

    const noKey = bindingProblems({}, []);
    expect(noKey.some((p) => /no provider key at all/.test(p))).toBe(true);
  });

  it("makes it a real problem once somebody names the company", () => {
    // Writing a provider name is asking for it. Then the same situation is a
    // misconfiguration rather than a feature nobody wanted.
    const notes: string[] = [];
    const problems = bindingProblems(
      { default: { provider: "auto", model: "auto" }, tasks: { image: { provider: "anthropic", model: "x" } } },
      ["anthropic"],
      { notes },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("cannot produce image");
    expect(notes).toEqual([]);
  });

  it("names only the keys that would actually help", () => {
    // Listing all five for an image task would send somebody to Mistral, where
    // the same problem waits.
    const problems = bindingProblems({}, []);
    const imageProblem = problems.find((p) => p.includes('Task "image"'));
    expect(imageProblem).toBeDefined();
    expect(imageProblem).not.toContain("MISTRAL_API_KEY");
    expect(imageProblem).not.toContain("ANTHROPIC_API_KEY");
    expect(imageProblem).toContain("OPENAI_API_KEY");
  });

  it("is silent when the key on the machine can draw", () => {
    const notes: string[] = [];
    expect(bindingProblems({}, ["gemini"], { notes })).toEqual([]);
    expect(bindingProblems({}, ["openrouter"], { notes })).toEqual([]);
    // And says nothing at all — there is nothing to know.
    expect(notes).toEqual([]);
  });

  it("resolves an image task to an image model, never a text one", () => {
    // `"auto"` landing on a company's general-purpose model would make the
    // shipped binding the one combination that never works.
    const binding = resolveBinding({}, "image", ["gemini"]);
    expect(binding.model).toBe(PROVIDER_DEFAULT_IMAGE_MODELS.gemini);
    expect(binding.model).not.toBe(PROVIDER_DEFAULT_MODELS.gemini);
  });

  it("never resolves a binding to a null model", () => {
    // Every combination, including the ones nobody would write on purpose. A
    // null model is an unresolved binding, and half the app reads it.
    for (const task of TASKS) {
      for (const keys of [[], ["anthropic"], ["mistral"], ["openai"], ALL_PROVIDERS]) {
        const binding = resolveBinding({}, task, keys);
        expect(binding.model, `${task} with ${keys.join("+") || "no keys"}`).toBeTruthy();
      }
    }
  });
});
