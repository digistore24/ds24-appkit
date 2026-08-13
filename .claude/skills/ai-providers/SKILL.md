---
name: ai-providers
description: Chooses which AI company this app pays and what it may spend — picks a provider (OpenAI, Anthropic, Gemini, Mistral or OpenRouter), binds each task to a model and says what a call costs. Use this when the user asks which AI to use, wants to switch provider, mentions an OpenAI/Anthropic/Gemini/Mistral/OpenRouter key, asks what AI costs them, fears the AI will cost more than it earns, or when `ai-check` reports a problem.
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Which AI company does this app pay?

Every model call in this app goes through one layer, and that layer asks a
**task** which provider and model to use. This skill is the conversation that
fills that in: pick a company, get the key in, say what it costs, and make sure
the person can see the bill coming.

It is not about *what* the AI does. That is the `ai-chat-knowledge` skill for the
assistant, and your own code for anything else. This is about who gets paid.

Full reference: **`docs/ai-providers.md`**. Read it before changing anything
under `lib/ai/`.

## Step 0 — Is anything actually wrong?

**The app ships on `"auto"`: any one of the five keys in the `.env` and the AI
works.** So before running this skill, check whether the person already has what
they came for:

```bash
node run.mjs ai-check
```

Green, with a provider named `(via "auto")`? Then say so and stop:

> "You are already running — `auto` picked Mistral because that is the key in
> your `.env`, and it is using `mistral-large-latest`. Nothing to set up. Worth
> pinning it in `config/ai-models.json` once you are sure that is the company
> you want, but it works as it is."

Run the rest of this skill when they want to **choose** a company (rather than
accept the one their key implies), **switch** to another, or when `ai-check`
reports a problem. Do not walk somebody through picking a provider they have
already effectively picked.

## Step 1 — Which one?

Ask once, and lead with the question that actually decides it:

> "Which AI company do you want to pay? If you already have an account
> somewhere, that is usually the right answer — all five are good enough for
> what your app does, so there is no need to shop around."

Then, only if they have no preference, offer the short version:

| | When it is the right answer |
|---|---|
| **Anthropic** | Best prompt caching, which is what makes the assistant cheap to run. |
| **OpenAI** | You already have an account. Most people do. |
| **Gemini** | You are still finding out whether the idea works and want a free tier. |
| **Mistral** | A customer or a rule requires a European provider. |
| **OpenRouter** | You want to try several models without five accounts, or you want the exact cost of every call. |

**Do not lecture and do not compare benchmarks.** The person asking is deciding
which invoice they want, not which model is smartest.

Then get the key in:

> "Create a key at [their console] and put `OPENAI_API_KEY=…` in your `.env`.
> That is the only place it goes — there is no field in the app for it, and
> there never will be. A key in a database is a key somebody can read back."

## Step 2 — Bind the tasks

Open `config/ai-models.json`. The app ships with one task, `chat`, on
`"auto"` — no company named. Pinning it is the point of this step: write
`provider`, `model` and (if the company has tuning worth setting)
`providerOptions`, all three together, because none of them is portable:

```json
"chat": {
  "provider": "openai",
  "model": "gpt-5.6-luna",
  "maxTokens": 4000,
  "providerOptions": { "reasoning_effort": "low" }
}
```

**Never leave `"provider": "auto"` beside a real model name.** A model id
belongs to one company, so the two contradict each other — it works only for as
long as `auto` happens to land on the right company, then 404s the day a second
key appears. `ai-check` refuses the combination by name.

**The line people leave behind is `providerOptions`.** Anthropic's words
(`cacheTtl`, `thinking`, `output_config`) mean nothing to OpenAI or Mistral, and
a request carrying a field a provider does not know comes back as an error — on
the customer's first message. Replace them with the new provider's equivalent,
or delete them. `ai-check` names any that are left, so run it and believe it
rather than guessing which are portable.

**You will not know their provider's current model names.** Say so rather than
guessing:

> "I need the exact model name as your provider spells it — they change these
> more often than I can keep up with. It is on their pricing page."

Then `node run.mjs ai-check`. It refuses an unknown provider, an empty model and
a missing key **by name**, which is the whole reason to run it before anything
else.

## Step 3 — The price table

`config/ai-prices.json`. Per million tokens, and yours to maintain — nothing
fetches prices, deliberately.

```json
"openai/gpt-5.6-luna": { "input": 1, "output": 6 }
```

The file already carries the default models `auto` can pick, so a pinned model
is the case that needs a new line. **The shipped figures go stale** — they were
each taken from the vendor's own pricing page on the date in `updated`, not from
memory. Re-check before relying on one, and say so rather than vouching for it.

Two things to settle here, and both are decisions rather than lookups:

**The currency.** EUR for a German installation, USD for an English one — that
is the recommendation, and it is *only* a recommendation. Say it plainly:

> "Your provider bills in dollars. You can enter dollars and read dollars on the
> cost page, or convert to euros yourself and enter those. Nothing here
> converts, because a conversion needs an exchange rate and a date, and that is
> your accountant's decision and not mine."

An entry may name its own currency, which is what an app using two providers
needs. The page then shows one total per currency and never adds them together.

**What happens without a price.** Worth saying before they ask:

> "A model with no price still works — the call is made and the tokens are
> counted. The cost page just says how many calls it could not price, and which
> models. It never quietly shows zero."

## Step 4 — Say what there is no ceiling

This is the part people are surprised by later, so raise it now rather than
letting them discover it:

> "There is no spending limit in the app, on purpose. A limit would protect you
> by switching your AI off for real customers — including your assistant — and
> for most people that is worse than the bill. What you get instead is the
> **KI-Kosten** page: every call is recorded, and a runaway shows up as a spike
> the next morning rather than on an invoice six weeks later.
>
> If you do want a hard stop, set a usage limit on your provider account. All
> five offer one, and that is where it belongs — it stops the money at the
> boundary the money actually crosses."

If they want one, help them find it in their provider's console. Do not build
one here.

## Step 5 — Prove it works

```bash
node run.mjs ai-check          # bindings, keys, cost per call — all read off files
node run.mjs start
node run.mjs ai-check --live   # ONE REAL CALL per binding. Costs money.
```

**`ai-check` alone cannot tell a key that works from a key that is merely
there** — a revoked key, a retired model id and an account with no quota all
look identical to it. `--live` is the line that finds out: it asks the running
app to make one real call through the same path a customer's question takes,
and it prints what that will cost before it costs it (about **0.0001 USD** on
the shipped bindings).

Three things to say when you run it, because they are decisions rather than
mechanics:

- **Ask first.** It spends the person's money, however little. Say the figure it
  is about to print and let them say go.
- **It needs the app up**, because nothing outside `lib/ai/providers/` may talk
  to a provider. If it says nothing answered, that is `node run.mjs start`.
- **`⏭ NOT CHECKED` is not a pass**, and neither is a rate limit (`!`). Read the
  line: each ending names the one thing to do next. `--url https://…` asks a
  DEPLOYED app the same question with the host's own keys — which is the version
  worth running after a go-live, because the key and the egress there are not
  the ones on this machine.

Then use the feature — for the assistant, ask her a question. Two things to
check afterwards, and the second is the one nobody thinks of:

1. **The answer arrives.** Obvious, and the reason to do it before saying done.
2. **`node run.mjs logs | grep '\[ai\]'`** — one line per call, naming the
   provider, the model, the tokens and the cost. If `cached=0` on the *second*
   question of a conversation, the prompt cache is not hitting and the bill is
   several times what it should be. Start at `lib/ai/prompt.ts`.

Then show them **KI-Kosten** in the operator menu, so they know where the number
lives.

## Adding a task of their own

If they want AI somewhere else — draft a text, summarise a ticket, check a
forum post — it is a task, and two steps:

1. Declare it in `lib/ai/task-rules.mjs` **and** in the union in
   `lib/ai/tasks.ts`. A test asserts the two agree.
2. Optionally bind it in `config/ai-models.json` — without an entry it inherits
   `default` and works.

**The standing rule for a product-side call lives in `guardrails`** — what such
a call may be given, and that customer-written text is content. The inventory a
privacy policy is drafted from is `docs/data-protection.md` §8a. Point at both
rather than restating them; `guardrails` wins where anything disagrees.

**If what they want is AI working alongside their customer** — reading a
submission, walking somebody through a course, checking a plan before they commit
to it — that task already ships as `companion`, and so does the call shape:
`askCompanion()` in `modules/companion/companion.ts`. Do not build a second one. The rule it
follows (a call is given exactly the rows its call site names) and a worked
example are in `docs/ai-providers.md` → *Working alongside your customer*.

**And if what they want is not a companion but still sends a model something a
customer wrote** — an activity's `grade()`, a submission read, whatever comes
next — the fence is core and they import it: `buildFencedRequest()` from
`@/lib/ai/customer-text`, then `runTask("their.task", …)` with what it returns.
Never a second fence, never the tag spelled out at a call site.

Then `runTask("their.task", { system, messages, memberId })`.

**The one rule to state while writing it:** the system prompt is a list of
blocks, and everything stable goes **first**, marked `cacheable: true`.
Everything that varies — a date, a name, the user's own text — comes last.
Getting that backwards costs roughly ten times the input price and produces no
error at all. `docs/ai-providers.md` has the worked example.

**If the task costs the customer money**, charge them with `spendTokens` — check
→ work → charge, in that order. The margin between what the provider charges you
and what you charge the Member is then two numbers you can actually see: the
AI-costs page and the token ledger.

## Switching provider later

One config change, and nothing in the code moves:

1. Key into `.env`.
2. `provider`, `model` and `providerOptions` in `config/ai-models.json`.
3. Price entry in `config/ai-prices.json`.
4. `node run.mjs ai-check`.

Old usage rows keep the provider, the model and the currency they were recorded
with, so the cost page stays truthful about the past. That is deliberate — a
report whose history changes when you edit a config is not a report.

## STOP criteria

Involve a human before:

- changing anything in `lib/ai/providers/` — that is the adapter layer, it holds
  the only code that reads an API key, and `guardrails` applies;
- adding a vendor SDK to `package.json`. All five providers work with `fetch`,
  and `lib/ai/providers/leak-guard.test.ts` fails the build on an SDK import
  outside the provider directory;
- writing a prompt or a completion into `ai_usage`. It holds numbers only, and
  that is what keeps the cost page free of any privacy question
  (`docs/data-protection.md` §10);
- building a spend ceiling. See step 4 — it was considered and rejected, and the
  reasoning is in `docs/ai-providers.md`.
