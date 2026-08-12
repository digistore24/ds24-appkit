<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The AI layer — one way to call a model, five companies behind it

Everything in this app that talks to a language model goes through one call, and
that call names a **task** rather than a model:

```ts
import { runTask, streamTask } from "@/lib/ai/run";

const answer = await runTask("chat", { system, messages, memberId });
for await (const event of streamTask("chat", { … })) { … }
```

Which company answers, which model, how many tokens and with what tuning is
configuration — `config/ai-models.json` — so an Operator changes it without
touching code. What every call consumed is written down, so the invoice is never
the first time anybody learns what the app is doing.

---

## The short version

| | |
|---|---|
| Entry point | `runTask(task, …)` / `streamTask(task, …)` — `lib/ai/run.ts` |
| Providers | OpenAI, Anthropic, Gemini, Mistral, OpenRouter |
| Keys | `.env`, one per provider. You need **at most one**. |
| Who runs what | `config/ai-models.json` |
| What it costs | `config/ai-prices.json` |
| Declared tasks | `lib/ai/task-rules.mjs` → `TASKS` |
| Check it | `node run.mjs ai-check` |
| Spend ceiling | **There is none.** See "Money" below. |

---

## Choosing a provider

You need **one**. Which one is your call, and the honest summary is that for
handbook answers and short generation tasks all five are adequate; the decision
is usually about the account you already have, where the data may go, and price.

**Put a key in `.env` and you are done.** The app ships bound to `"auto"` — a
rule rather than a company: *run on whichever key is here*, using that
provider's current default model. Nothing names Anthropic, or any of the other
four, until you decide to.

| | Key | Notes |
|---|---|---|
| **Anthropic** | `ANTHROPIC_API_KEY` | Explicit prompt caching, which is what makes the assistant's whole-handbook approach affordable. |
| **OpenAI** | `OPENAI_API_KEY` | The account most people already have. Automatic prefix caching. |
| **Gemini** | `GEMINI_API_KEY` | Generous free tier while you are still finding out whether your idea works. Implicit caching, up to 90% off a shared prefix. |
| **Mistral** | `MISTRAL_API_KEY` | European provider — the answer when a customer or a procurement rule asks where the data goes. |
| **OpenRouter** | `OPENROUTER_API_KEY` | One key, many models, and it reports the exact cost of each call. The answer if you want failover or to compare models without five accounts. |

Put the key in `.env`, run `node run.mjs ai-check`, and it will tell you what
this installation can reach and what one call would cost.

---

## Binding a task

`config/ai-models.json`, as shipped:

```json
{
  "default": { "provider": "auto", "model": "auto", "maxTokens": 2000 },
  "tasks": {
    "chat": { "provider": "auto", "model": "auto", "maxTokens": 4000 }
  }
}
```

And the same file once you have chosen a company:

```json
{
  "default": { "provider": "auto", "model": "auto", "maxTokens": 2000 },
  "tasks": {
    "chat": {
      "provider": "anthropic",
      "model": "claude-sonnet-5",
      "maxTokens": 4000,
      "providerOptions": { "cacheTtl": "1h", "thinking": { "type": "adaptive" } }
    }
  }
}
```

| Field | Meaning |
|---|---|
| `default` | Used by any declared task with no entry of its own. A task therefore works before you have configured it. |
| `provider` | One of the five, or `"auto"`. |
| `model` | The provider's own model id, exactly as they spell it. |
| `maxTokens` | Cap on the answer. It is a cost lever, which is why it lives here rather than in the feature. |
| `providerOptions` | Passed to that provider **verbatim**. The layer never reads it — except for `cacheTtl`, which is its own word (below). `{"thinking": …}` for Anthropic, `{"reasoning_effort": …}` for OpenAI, `{"generationConfig": …}` for Gemini. Not portable between providers — but neither is the model name. |

### `"auto"` — the shipped default

`"auto"` is not a sixth provider. It is a rule the layer resolves at read time:
**run on whichever of the five keys is in the `.env`**, using that company's
current default model (`PROVIDER_DEFAULT_MODELS` in
`lib/ai/providers/ids.mjs`). It exists because the alternative shipped a
decision nobody had made yet — a developer put a key in `.env`, everything they
could see said the key was right, and the AI stayed off because the file named
somebody else.

Four things are worth knowing about it:

- **`provider` and `model` travel together.** `"auto"` for the company means
  `"auto"` for the model, because a model id belongs to exactly one company.
  Pinning `claude-sonnet-5` beside `"provider": "auto"` is refused by
  `ai-check` rather than silently obeyed — it works for exactly as long as
  `auto` happens to land on Anthropic.
- **A name always wins.** Write `"anthropic"` and you get Anthropic, key or no
  key — an honest error, never a quiet substitution onto a company you did not
  choose. That is the line that keeps `auto` from becoming a surprise on an
  invoice, and it means "pin it" is always available.
- **Two keys is a choice you made.** With several present, `auto` takes the
  first in the order shown in the provider table, deterministically. If that is
  not the one you want, name it — that is the moment to.
- **The default models go stale.** A model retired by its vendor answers a 404
  on the first question. The fix is one line in `ids.mjs`, or a pinned `model`
  in this file. `node run.mjs ai-check` always prints which one is in use, and
  marks it `(via "auto")` so you can see you never typed it.

Move off `auto` as soon as you have chosen — a named binding is the one you can
tune, price and reason about. It is a good default, not a good permanent state.

**A binding is not portable and is not meant to be.** Switching provider means
changing `provider`, `model` and usually `providerOptions` together — all three
lines, in one edit. `ai-check` tells you when one of them is wrong, and that
includes the one people forget:

```
config/ai-models.json → tasks."chat".providerOptions."thinking": that is anthropic
vocabulary, and this task runs on mistral. Delete the line, or give mistral its own
equivalent — a request carrying a field a provider does not know comes back as an error.
```

It only says that about a key it can attribute to somebody else. Anything it has
never heard of travels untouched: five companies add parameters faster than a
template can track them, and the escape hatch would not be one if it were an
allowlist.

**`cacheTtl` is the exception to "verbatim".** It is a word this layer invented,
not a provider's parameter: `anthropic.ts` turns it into a `cache_control`
breakpoint, and every other adapter strips it before the request goes out. So a
task moved away from Anthropic with that key still in its binding *works* — it
just no longer buys anything, which is why `ai-check` names it too.

**Every task runs on every provider**, this one included. The assistant ships
on `"auto"` and needs no company in particular — bind `chat` to any of the
five, run `ai-check`, and she answers from there. What differs between the five
is what a cached prefix is worth, and that is `lib/ai/providers/blocks.ts`, not
the chat.

---

## Adding a task

Two steps, no migration.

**1. Declare it** in `lib/ai/task-rules.mjs`:

```js
export const TASKS = ["chat", "content.draft"];
```

Then add it to the union in `lib/ai/tasks.ts` as well — that is what makes
`runTask("content.draft", …)` compile and `runTask("contnet.draft", …)` not.
A test asserts the two lists agree, so you cannot forget the second half.

**2. Bind it** — optional. Without an entry it inherits `default` and works.

```json
"tasks": {
  "content.draft": { "provider": "mistral", "model": "mistral-small-latest", "maxTokens": 1500 }
}
```

Then call it:

```ts
const draft = await runTask("content.draft", {
  system: [
    { text: HOUSE_STYLE, cacheable: true },     // stable → cacheable
    { text: `Today is ${today}.` },             // varies → not
  ],
  messages: [{ role: "user", content: brief }],
  memberId,                                     // recorded, never sent
});
```

Two worked examples of what a task can be, neither of which ships:

- **Content generation** — a `content.draft` task on a cheap fast model, with
  your house style as the cacheable block. Charge the Member for it with
  `spendTokens` (`CLAUDE.md` → *Access*; the long form is
  [`entitlements.md`](entitlements.md)), and the margin
  between what you pay the provider and what you charge is visible as two
  numbers: the AI-costs page and the token ledger.
- **Moderation** — a `moderation.text` task on the smallest model there is,
  returning a yes/no. Cheap enough that the cost page will show it as a rounding
  error next to the assistant, which is the point of binding it separately.

---

## Working alongside your customer

`companion` is the third task that ships, and it is the only one whose *shape*
ships without a caller: `askCompanion()` in `modules/companion/companion.ts` is the
function — three lines binding this module to that task id — and what calls it
is the app you build. The prompt it sends is assembled one layer down, in
`lib/ai/customer-text.ts`, which is core code and is described under *Two things
the layer does* below. It exists as template code for
the same reason `image` does — an app that wrote its own would have to break the
leak guard or rebuild the abstraction, and its spend would land on your cost page
as `chat`, mixed in with support.

**What it is for:** reading what a customer submitted and answering about it,
walking somebody through a course or a challenge, checking a plan before they
commit to it, producing the thing they came for. **What to build with it** — the
catalogue, per app shape, with the four facts each pattern needs — is
[`ai-in-product.md`](ai-in-product.md); this section is the mechanics.

### The data rule, in the direction that applies here

The assistant sends **nothing** about the signed-in person — not their name,
balance, orders or role (`docs/ai-chat.md` → *What she can and cannot do*). That
rule is about **her**, it is a data-protection decision, and it stays.

A companion is the opposite case by construction: it is worthless unless it can
see the challenge day and the answer somebody wrote. So the rule for this side is
stated the other way round:

> **A call is given exactly the rows its call site names, one field at a time.**

That is why `about` is a list of labelled values rather than a member id. Neither
`modules/companion/companion.ts` nor `lib/ai/customer-text.ts` imports a
database, an entitlement function or a token function — and a test beside each
reads the file to prove it, because a call that could fetch for itself is a call
whose call site no longer names what it sends. `memberId` travels for the usage
row and for nothing else, exactly as `runTask` documents — it is not even a field
of the fenced request, because the request is the prompt and the member is the
ledger.

### A worked call

🚨 **Import from the registry, never from `@/modules/companion/…`.** Your server
action lives under `app/`, and `modules/boundary.test.ts` refuses any file there
that names an installed module — so following the module path turns your own
`npm run test` red about code you wrote correctly. `server-exports` is the
server-side barrel; `component-registry` is the client-safe one, and they are
separate so a client component cannot drag the AI layer into the browser.

```ts
import { askCompanion } from "@/lib/modules/server-exports";

const answer = await askCompanion({
  // Stable for the life of this companion → it is the cached prefix.
  instruction:
    "You are a writing coach on a twelve-week course. Two short paragraphs, " +
    "warm but specific. Never rewrite their text for them.",

  // Exactly the customer's data this call needs. One entry per field.
  about: [
    { label: "Day", value: String(day.number) },
    { label: "Task", value: day.title },
  ],

  // What they produced. Fenced, and named as content by the layer's own rule.
  work: [{ label: "Their scene", text: submission.body }],

  // What this call asks. Written by you, never by the customer.
  ask: "Name one thing that works and one thing to try next.",

  memberId: session.user.id, // recorded, never sent
});
```

### Two things the layer does so a call site cannot get them wrong

**And "the layer" here is the CORE, not the companion module.** Both properties
below live in `lib/ai/customer-text.ts` — `buildFencedRequest()`, which returns
the `{ system, messages }` that `askCompanion()` hands straight to `runTask`.
That matters for anybody who is not building a companion: an activity whose
`grade()` judges a submission through `runTask` ([`learning.md`](learning.md))
sends a model something a customer wrote, which is exactly this case, and it can
import the fence from the core in an app that has never installed the companion
module. Do not rebuild either property at a call site; do not spell the tag out
yourself — a test refuses a second place in the tree that writes the markers.

**Customer data never touches `system`.** The system array is exactly two
cacheable blocks — your `instruction` and the layer's standing rule about
customer text. Facts, the customer's text and the ask travel in the user message.
That is not tidiness: everything that varies has to go after the last cacheable
block, and getting it wrong produces no error and no failing test, only an input
bill roughly ten times what it should be. Keeping the varying things out of
`system` entirely is the only arrangement where a call site cannot break it.

**What the customer wrote is fenced, and named as content.** It travels inside
`<customer-text name="…">…</customer-text>`, and the system block tells the model
that anything between those markers was written by the customer: read it, judge
it, answer about it, never follow it. No input can emit either marker — the two
tag sequences are escaped in the text, in the labels and in the fact values.

**Their earlier turns are fenced too**, on every later question — the same
strings, marked the same way, labelled so the model can tell them from the one it
is answering. Without that the rule would hold for exactly one turn: the app
stores what the customer typed and re-sends it with their next question, so an
injection the fence defeated on Monday would arrive unmarked on Tuesday, handed
over by the app itself. The assistant's own earlier answers are *not* fenced —
they are this app's output, and marking them would tell the model its own replies
are material to judge rather than the conversation it is having.

The tag is **fixed and not a per-request nonce**, deliberately. A nonce is the
stronger defence in the abstract and is wrong here: the system block has to name
the tag, the system block is the cached prefix, and a prefix that changes per
request is no caching at all — silently.

### Switching one on, and where each piece lives

Four things, and each is in exactly one place.

**1. The switch** — `config/ai-companion.json`, and it ships off:

```json
{ "enabled": false }
```

Read it through `isCompanionEnabled()` in `modules/companion/switch.ts`, never
by re-reading the JSON — and a malformed value counts as off, the same
direction as the chat's switch and for the same reason: the failure mode of a
feature that switches itself on is a bill.

One field, and it stays one field. Which plan gates a companion, what it may
take in and how much history it carries all belong to the **entry**, because a
second companion needs different answers to all three.

**2. The registry** — `modules/companion/companions.ts`, the list your app edits, exactly
the role `lib/ai/tools.ts` and `lib/cron/jobs.ts` play. It ships empty with a
worked example in a comment.

```ts
{
  id: "writing-coach",              // [a-z0-9-], ≤ 40 — half of the conversation key
  instruction: "You are a writing coach …",
  requiresPlan: "kurs_komplett",    // or null for every signed-in member
  costsTokens: 2,                   // 0 = included in the plan
  maxInputChars: 12_000,
  async load({ memberId, subject }) { … },
}
```

**A second companion is a second entry, never a second component.** That is the
whole reason the instruction and the plan live here rather than being passed in
from the page: one surface serves all of them, and it takes two strings from the
browser.

🚨 **`load()` is where an IDOR would live.** `subject` is a string the customer's
browser sent — off a URL segment or a hidden field, and theirs to change. Every
read inside it must be scoped by `memberId`:

```ts
async load({ memberId, subject }) {
  const [row] = await db
    .select()
    .from(submissions)
    .where(and(eq(submissions.memberId, memberId), eq(submissions.day, subject)))
    .limit(1);
  if (!row) return null;   // also the answer for a row belonging to somebody else
  return {
    about: [{ label: "Day", value: subject }],
    work: [{ label: "Their scene", text: row.body }],
  };
}
```

Returning `null` for somebody else's subject is both the security answer and the
not-found answer — the same value, so nothing here can be used to find out which
ids exist.

**3. The surface** — one component, on any page:

```tsx
<CompanionPanel companionId="writing-coach" subject={day.slug} />
```

**4. The conversation** — you never name one. `modules/companion/actions.ts` composes
the key server-side from the companion it just looked up and the subject the
browser sent, so two subjects of one companion are two conversations and two
companions on one subject are two more. If the browser could send the whole key
it could name another companion's conversation and read its turns.

Turns are rows in `chat_messages` with a `conversation_id`; `NULL` is the
assistant's own conversation. They are in both subject access requests and they
go with the account, because they always did.

### What it costs, and in which order

`requiresPlan` and `costsTokens` are read by the shipped server action, which
asks in this order — and the order is the point:

```
signed in → feature on → companion known → plan held → under the rate limit
          → input sane → CAN THEY AFFORD IT → … the call … → CHARGE
```

Check → work → charge. Charging first bills for work that then fails; doing the
work with no check in front gives the answer away for free, because by the time
`spendTokens` throws the expensive part has already run.

The rate limit is the **chat's** bucket, deliberately: one member, one allowance
for causing model calls, one operator paying. A customer working hard with a
companion has fewer support questions left in the same ten minutes, and that is
the trade rather than an oversight.

### What it deliberately does not do

- **No streaming.** A companion answers in one go. When answers get long, the
  shape to reuse is the chat route's JSON-line stream, not a second protocol.
- **No length ceiling of its own.** The chat's 2000 characters is a brake on a
  typed question; a submission is not a question. It refuses a control character
  (which Postgres would reject *after* you had paid for the call) and nothing
  else.
- **No storage, no access check, no charge.** Who may use a companion is
  `hasPlan()`, what a use costs is `spendTokens()` in the order check → work →
  charge, and where the turns live is your surface's business.

---

## Pictures

`image` is a task like any other, and it is bound the same way — but two of the
five companies cannot do it, so it is the one task where the provider is not
interchangeable.

| | |
|---|---|
| **OpenAI** | yes — `gpt-image-2` |
| **Gemini** | yes — `gemini-3.1-flash-image` |
| **OpenRouter** | yes, and it reports what the call actually cost |
| **Anthropic** | no. Claude reads pictures and does not make them |
| **Mistral** | not through this template. It can, but only as an agent tool whose result arrives as a file to download afterwards — a different protocol rather than a different endpoint |

That is why `node run.mjs ai-check` says, when your only key is Anthropic's:

> Task "image" needs a provider that can produce image, and the key on this
> machine is for anthropic — which cannot. Add one of these to .env as well:
> `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`. Your other tasks
> keep running on the key you already have.

**At check time, not at your customer's first click.** A second key is fine —
the assistant keeps running on the first one.

### Making one

```ts
import { generateImage } from "@/lib/media/generate";

const [hero] = await generateImage({
  prompt: "a quiet kitchen table at sunrise, warm light, no people",
  alt: "A kitchen table in early morning light",
  visibility: "public",
  memberId,
});
```

You get a stored `media` row back — the picture is already in the bucket, and
`mediaUrlFor(hero)` is the address to put on a page. The whole media side is
[`docs/visuals.md`](visuals.md).

**`alt` is required, and it is not derived from the prompt.** No image API
returns a description of what it drew; a prompt reads *"photorealistic, 8k,
cinematic lighting"* and is a set of instructions to a machine, where
alternative text is a sentence for a person. Using one as the other would
produce accessibility that is technically present and useless — and worse than
missing, because nothing would then report it. Whoever asked for the picture
knows what it is for; that is the sentence to write.

### What it costs

Images are billed **per picture**, so their entry in `config/ai-prices.json`
carries an `image` rate in whole currency units — not per million like the token
rates beside it:

```json
"openai/gpt-image-2": { "image": 0.053, "input": 5, "output": 30 }
```

Both halves are charged where a model bills both. The figure is the vendor's own
price at the default quality; a larger size or a higher quality costs more, so
re-read their page before relying on it. `node run.mjs ai-check` prints it per
picture rather than per thousand tokens.

It lands on `/dashboard/admin/ai-costs` with everything else, grouped by task —
which is the point of tasks: *"pictures €12, the assistant €38"* tells an
Operator which feature to change, where *"gpt-image-2 €12"* does not.

### Charging your customer for it

The same three steps as any other metered work, in the same order:

```ts
const COST = 5;

// 1. CHECK — before anything expensive runs.
const account = await getTokenAccount(session.user.id);
if (!hasSufficientBalance(account?.balance ?? 0, COST)) {
  return { error: t("insufficientBalance") };
}

// 2. WORK
const [image] = await generateImage({ prompt, alt, ownerId: session.user.id });

// 3. CHARGE
await spendTokens({ amount: COST, note: "image generation" });
```

**Check → work → charge**, and the middle one is the expensive part —
charging first bills for a picture that may never arrive, and working with no
check in front gives it away. `generateImage()` deliberately does not charge:
that belongs in the Server Action, where a person is present and the price is
yours. `CLAUDE.md` → *Access* states the order; the rest is
[`entitlements.md`](entitlements.md).

---

## The one rule about prompts

**`system` is a list of blocks, and everything stable goes first.**

```ts
system: [
  { text: persona,  cacheable: true },   // never changes
  { text: handbook, cacheable: true },   // changes when you edit it
  { text: `Today is ${today}.` },        // changes daily  ← last
]
```

Prompt caching is a **prefix match**. One byte different before the last
cacheable block and the whole prefix is billed as fresh input. Nothing errors
when that happens — the answers stay correct, the bill goes up by roughly ten
times, and you find out on an invoice.

Three of the five providers pay you for getting this right:

| | What the flag buys |
|---|---|
| Anthropic | An explicit cache breakpoint. ~90% off reads. |
| Gemini | Implicit caching, on by default for 2.5+. Up to 90% off. Triggers on the shared prefix — the ordering **is** the mechanism. |
| OpenAI | Automatic prefix caching. Same ordering argument. |
| Mistral, OpenRouter | Whatever their upstream does. The ordering costs nothing and can only help. |

A prompt whose cacheable block sits *after* a varying one is refused outright,
by name, rather than quietly costing money. Below roughly 1,000–4,000 tokens
Gemini and OpenAI do not cache at all, and that is correct rather than a fault —
a short moderation prompt was never eligible.

---

## Tools — a task that looks things up before it answers

A task can hand the model tools and let it call them mid-answer. All five
providers speak function calling, so there is no capability flag and no
provider question — the entry point is:

```ts
import { streamTaskWithTools, type ServerTool } from "@/lib/ai/tool-loop";

for await (const event of streamTaskWithTools("chat", input, tools)) {
  // { type: "delta" } · { type: "tool", name } · { type: "done" }
}
```

A `ServerTool` is a wire definition (`{ name, description, inputSchema }`)
plus an `execute(input)` that runs in-process and returns what the model
reads. The assistant's tools are the four `content_*` tools, built in
`lib/ai/chat-endpoint.ts` over the shared `runTool` path — see
[`content-source.md`](content-source.md).

Four things worth knowing before you touch it:

- **The tool list must be byte-stable across requests** — a module constant,
  never rebuilt per request. Tool definitions sit inside the cached prefix on
  every provider (Anthropic renders them BEFORE the system blocks and caches
  both together), so a list that varies switches the ~10× discount off with
  no error anywhere. The first request after ADDING tools to a task rewrites
  the cache once — expected; do not misread the one-time `cache_write` spike.
- **One `ai_usage` row per round.** Each tool round-trip is its own provider
  call and records itself; a three-round answer is three rows under the same
  task. The bill is the table — the loop's final `done` event carries only
  the last round's usage.
- **`MAX_TOOL_ROUNDS` is 5**, and the final round forces a text answer
  (`toolChoice: "none"`) instead of cutting the conversation dead. Worst-case
  wall clock is rounds × the binding's `timeoutMs`.
- **Both directions are untrusted.** An executor re-validates its input (the
  schema is a hint to a model) and throws `ToolError("<code>")` for refusals —
  the model reads codes, never raw error messages, which stay in the log.

---

## Money

### The price table

`config/ai-prices.json`, per **million** tokens, yours to maintain:

```json
{
  "defaultCurrency": "USD",
  "updated": "2026-07-25",
  "models": {
    "anthropic/claude-sonnet-5": { "input": 3, "output": 15, "cachedInput": 0.3, "cacheWrite": 3.75 },
    "mistral/mistral-small-latest": { "input": 0.1, "output": 0.3, "currency": "EUR" }
  }
}
```

- The key is **`provider/model`**, never a bare model name — OpenRouter serves
  models whose names belong to other vendors.
- Only `input` and `output` are required. `cachedInput` falls back to `input`,
  `cacheWrite` to `input`, `thinking` to `output`.
- **An entry may name its own `currency`.** That is what keeps an installation
  drawing on providers who bill differently honest.
- `updated` is shown on the cost page, so you know when the numbers were last
  checked. **Nothing fetches prices** — a template whose correctness depended on
  five undocumented endpoints would break quietly.

**A model with no entry still works.** The call is made, the tokens are
recorded, and the cost is left **empty** rather than zero. The cost page counts
those calls separately and names the models responsible. A page reading "0.00"
for a month that cost real money is worse than one that says what it cannot
account for.

### Currency

One recommendation and no rules: **EUR for a German installation, USD for an
English one.** `ai-check` says so and accepts anything.

Nothing converts and no two currencies are ever added together. The currency
travels on each recorded call rather than on the installation, so a row stays
true after you edit the price table, and a provider that quotes its own cost —
OpenRouter, in USD — is recorded in the currency it quoted rather than
relabelled. Relabelling would be inventing an exchange rate, and an exchange
rate needs a source and a date, which is accounting policy and not something a
template may guess.

### The cost page

**`/dashboard/admin/ai-costs`** — "KI-Kosten" in the operator menu, owners only.
It reads `ai_usage` and writes nothing.

| | |
|---|---|
| Period | today · last 7 days · last 30 days · this month |
| Group by | task · provider and model · nothing |
| Over time | day · week · month · nothing |

The two groupings combine, so "cost per task per day" and "cost per model per
month" are the same page with different links. The view lives in the query
string, so it survives a reload and can be sent to somebody.

**Opening a group** — the "Calls" button on a breakdown row — narrows the list
of individual calls to that task, model or day. It narrows **only that list**:
the totals and the breakdown above stay the truth about the whole period, so a
figure you quoted keeps meaning the same thing after somebody clicks into a day.
Changing the period or the grouping clears it.

Five things about what it shows are decisions rather than details:

- **Days are your days.** Buckets and period boundaries are computed in
  `APP_TIME_ZONE` (default `Europe/Berlin`), not in UTC — otherwise a call at
  01:30 would be filed under the previous date and a daily total would disagree
  with an invoice by one night's traffic.
- **A day with no calls still gets a row**, marked as such. Dropping it makes a
  missing day look like a quiet one, which is backwards when you are hunting for
  the day something broke.
- **Cached share is a health check, not an accounting figure.** It is the only
  place a broken prompt prefix becomes visible: the answers stay correct and the
  input bill goes up roughly tenfold, with no error anywhere.
- **It states what it cannot say.** Calls it could not price (with the models
  responsible), failed calls with their outcomes, and tokens a provider billed
  without itemising are each counted separately and shown beside the total —
  never folded into it, and never rendered as a zero.
- **No member column, deliberately.** `ai_usage` carries the member the call was
  made for, and the page does not render it: a cost report is not a per-customer
  activity log, and adding one is the single change here that would need a
  paragraph in a privacy policy (`docs/data-protection.md` §10).

Rows older than 12 months are deleted automatically (`docs/cron.md`). ⚠️ A
pruned period reads as zero here rather than as unknown.

### There is no spend ceiling

Deliberately. A ceiling protects against a runaway by taking your app's AI
offline for real customers — the assistant included — and for an app whose owner
cannot debug a suddenly-mute product at 2am, that failure is worse than the bill
it prevents.

What you get instead is visibility: every call is recorded, the cost page shows
spend per day, and a runaway looks like thousands of rows sharing one outcome on
a day that is otherwise flat.

**If you want a hard stop, set a usage limit on your provider account.** All
five sell them, and that is the right place for a ceiling because it is where
the money actually crosses a boundary.

---

## What gets recorded

One row per model call in `ai_usage`: the task, the provider, the model, token
counts, latency, the outcome, and the member it was made for.

**No prompt, no answer, no text a member typed.** That is structural — there is
no column that could carry one. See `docs/data-protection.md` §10.

Two things are always true of a row and are worth knowing:

- **The provider and the model are always named**, including on a call that
  never reached a provider — one refused for a missing key, say. The binding is
  resolved before anything else, so the names are known, and they are usually
  the answer to "why is nothing working".
- **"No usage reported" is not "zero tokens".** A provider that says nothing is
  recorded as having said nothing, so an unmeasured call never looks free.

**Rows are deleted after 12 months, automatically** — a daily job the app runs
itself (`prune-ai-usage` in `config/cron.json`, see `docs/cron.md`). The window
is one number:

```json
"prune-ai-usage": { "enabled": true, "everyMinutes": 1440, "retentionMonths": 12 }
```

⚠️ That deletes **cost history**: a pruned period reads as zero on the cost page
rather than as unknown. Twelve months keeps a year-on-year comparison possible.
`node run.mjs db-prune-ai --dry-run` shows what a shorter window would remove —
and prices it — before you commit to it.

---

## When something fails

Every failure is a typed outcome, translated in both languages, recorded on the
row:

| Outcome | Usually means |
|---|---|
| `noCredential` | The key for that provider is missing or rejected. `ai-check` names it. |
| `unknownModel` | The model id is wrong, or that provider does not serve it. |
| `providerRefused` | Rate limit or overload at the provider. Try again shortly. |
| `providerUnreachable` | Network, or the request timed out. |
| `requestTooLarge` | The prompt is bigger than the model takes. |
| `providerFailed` | Anything else. The detail is in `node run.mjs logs`. |

A provider's own error text goes to the log and **never** to a Member — it can
quote the prompt back, and the prompt is theirs.

---

## Adding a sixth provider

Two answers, and the registry hides the difference from every call site.

- **It speaks the OpenAI shape and bills only for what it itemises** → a profile
  in `lib/ai/providers/openai-compat.ts`. Three lines: base URL, environment
  variable, quirks.
- **It does not** → its own file, like `anthropic.ts` and `gemini.ts`.

The rule behind the split is worth stating because it is the only thing that
decides which you need: **a native adapter exists where a provider bills for
something the compatible shape cannot express.** Anthropic bills a cache write
and needs an explicit breakpoint. Gemini bills thinking tokens the OpenAI shape
has no field for. Everyone else is a profile.

Then add the id to `lib/ai/providers/ids.mjs` and to the union in `types.ts`,
and register it in `registry.ts`. Nothing above that line changes — not a call
site, not a task, not the usage schema, not the cost page.

---

## The files

| File | What it is |
|---|---|
| `lib/ai/run.ts` | **The entry point.** `runTask` / `streamTask`. |
| `lib/ai/customer-text.ts` | **The fence that makes customer text content.** `buildFencedRequest()`, the `<customer-text …>` markers and the standing rule that names them. Core, and the import for any caller — a `grade()` as much as a companion. |
| `modules/companion/companion.ts` | The shape a product-side call takes — `askCompanion()`, this module's binding to the `companion` task id. |
| `modules/companion/companions.ts` | **The list your app edits.** One entry per companion; ships empty. |
| `modules/companion/config.mjs` | The **one** reader of the switch. `.mjs` because `scripts/ai/check.mjs` and `node run.mjs legal-check` need it too and neither can import TypeScript. |
| `modules/companion/switch.ts` | The typed shell over it: `isCompanionEnabled()`, `companionProblems()`, `companionOffReason()`. |
| `modules/companion/rules.ts` | Pure rules — the conversation key, the two input checks, the ceilings, the error codes. |
| `modules/companion/actions.ts` | The server action. Seven checks in the chat route's order, then check → work → charge. |
| `modules/companion/components/companion-panel.tsx` | The one surface. `<CompanionPanel companionId subject />`, N call sites. |
| `lib/ai/task-rules.mjs` | Declared tasks + binding resolution. Pure, shared with the check command. |
| `lib/ai/tasks.ts` | The same, with the union type the compiler enforces. |
| `lib/ai/pricing.mjs` | The cost arithmetic. Pure. |
| `lib/ai/prices.ts` | The price table, and which figure wins. |
| `lib/ai/usage.ts` | Writes the row, after the response. |
| `lib/ai/report.ts` | Reads it back — periods, buckets and the aggregations behind the cost page. |
| `app/dashboard/admin/ai-costs/` | The **KI-Kosten** page itself. |
| `lib/ai/providers/` | The five adapters, the contract, and the only file that reads a key. |
| `config/ai-models.json` | Who runs what. |
| `config/ai-prices.json` | What it costs. |
| `db/schema-ai-usage.ts` | The `ai_usage` table. |

**One rule for anyone extending this:** no vendor SDK and no provider key
outside `lib/ai/providers/`. `lib/ai/providers/leak-guard.test.ts` fails the
build if that stops being true — it is what keeps "the Operator chooses the
provider" a fact rather than an intention.
