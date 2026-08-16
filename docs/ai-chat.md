<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The AI assistant

An in-app chat that answers questions about **your** app out of a handbook you
write. She is off until you switch her on, she has a name and a picture, and she
costs money per answer — this file is about all three.

The skill that writes the handbook is **`ai-chat-knowledge`**. Ask Claude Code
for it; this document is the reference behind it.

## Two switches, and why they are different kinds of thing

| Switch | Where | What it decides |
|---|---|---|
| `"enabled"` | `config/ai-chat.json` | Does this **product** have an assistant? Travels with the repo, the same answer in DEV, STAGING and PROD. |
| the provider's key | `.env` (in STAGING/PROD the hoster's secrets) | Can **this machine** talk to the company that answers for her? |

Both have to hold. `isChatEnabled()` in `lib/ai/chat-config.ts` is the one
answer, and the page says which of the two is missing rather than showing a
chat box that fails on the first message.

**Which key** is up to you: she ships on `"auto"`, so **any one** of
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY` or
`OPENROUTER_API_KEY` in the `.env` is enough, and she runs on that company's
current default model. `node run.mjs ai-check` names which one she picked. See
[`docs/ai-providers.md`](ai-providers.md).

**She runs on any of the five**, and pinning her to one is one edit to
`tasks.chat` in `config/ai-models.json`: `provider`, `model` and
`providerOptions` together — the third is the one people forget, and it is not
portable between companies. Once you name a company, that is the key she needs
and no other: a named binding is obeyed exactly as written, so a key for
somebody else leaves her switched off with the notice naming the provider she is
bound to. `node run.mjs ai-check` says both things in one screen.

```json
{
  "enabled": true,
  "name": "Lia",
  "avatar": "/share/chat.png",
  "requiresPlan": null,
  "cacheTtl": "1h",
  "maxHistoryTurns": 12,
  "maxMessagesPer10Min": 20
}
```

- **`name`** is a proper noun and is deliberately **not** translated, like the
  app name. Give her a short one people can type.
- **`avatar`** is a path under `public/`. A 256×256 portrait ships at
  `public/share/chat.png` — replace it with your own; the file name is yours to
  change as long as the config follows. It is **her face on the button** as well
  as in the bubbles, so it is square, it is cropped to a circle, and it wants to
  read at 48 pixels: a picture whose subject is far away becomes a smudge in the
  corner of the screen.
- **`requiresPlan`** is `null` for "every signed-in member". Set it to a product
  key and the chat becomes part of that plan:

  ```ts
  if (await hasPlan(memberId, "basic_monthly")) { /* the chat is open */ }
  ```

  It must be a `kind: "subscription"` or `"one_time"` product. A token package
  cannot gate it — a balance is not an entitlement, `hasPlan()` answers `false`
  for one for ever, and `lib/ai/chat-config.test.ts` fails the build rather than
  letting you lock out the customers who paid.
- **A malformed field switches the chat OFF.** That is the opposite direction
  from `billingMode()`, which falls back to showing everything, and the reason
  is the failure mode: a wrong billing mode hides a card, a chat that switches
  itself on because a field was unreadable spends money per visitor.

## The handbook

Markdown under `content/knowledge/`, one topic per file, four sections:

```
content/knowledge/
  00-onboarding/…    the first way through the app
  10-reference/…     feature by feature
  20-howto/…         task by task
  90-glossary.md     the words your product uses oddly
```

Every file opens with frontmatter. This is the whole format:

```markdown
---
section: onboarding | reference | howto | glossary
title: Cancel a subscription
summary: Where the cancel link is and what happens to your access.
updated: 2026-07-24
---

## The steps

1. …
```

Rules the checker enforces (`lib/ai/frontmatter.mjs`, one implementation for the
app and the command line alike):

- `section` must be one of the four. There is no fifth.
- `title` and `summary` are **required**. The summary is not decoration: it is
  what the model reads in the table of contents to decide which document answers
  the question. A file without one gets found by accident or not at all. Both
  are for HER and are never shown to a customer — `content/knowledge/` is not
  served anywhere, and the persona forbids her to name a document, precisely
  because nobody could open it.
- `updated` is optional, and an ISO day if present.
- **No `# ` in the body.** The title comes from the frontmatter; a second H1
  competes with it. Start at `## `.
- A file or folder starting with `_` or `.` is skipped — somewhere to park a
  draft.

**The handbook is single-language.** Write it in yours. She answers in the
reader's, whichever that is — the language instruction is per request, the
handbook is not. That is also why translating it would be wasted work: it would
double the cached prefix for no gain.

**Where the content comes from when there is more than you can type** — a
recorded course, an ebook, two years of webinars — is its own layer: a
knowledge corpus under `content/knowledge-sources/`, distilled once and
written from. It never reaches the model at runtime; the handbook stays what
she reads. The whole story — corpus, transcript ladder, media suggestions —
is [`docs/knowledge.md`](knowledge.md).

Check it any time:

```bash
node run.mjs kb-check
```

It names the file and the line for every format problem, counts the sections,
and prints what one answer costs at the current size.

## How the handbook reaches the model — and the one rule that matters

The **whole handbook** is sent on every question, as a **cached prompt prefix**.
No search, no embeddings, no vector database.

That sounds wasteful and is the opposite. Prompt caching is a prefix match: the
API hashes the request from the start up to a breakpoint, and a hit costs about
a **tenth** of normal input. The handbook is the same bytes for every user of
your installation, so after the first message of the hour it is nearly free —
and unlike a search index it cannot hand back the wrong paragraph.

The request is assembled in `lib/ai/prompt.ts` as three blocks:

| # | Block | Cached? |
|---|---|---|
| 0 | Who she is, what she must not do, and this app's menu | yes |
| 1 | The handbook | yes ← **the breakpoint sits here** |
| 2 | Language and date | never |

**The rule: everything that varies goes after the last cacheable block.** The
date varies. The language varies. A name, a balance, a session id — all vary.
Put any of them in block 0 or 1 and the cache stops hitting: nothing errors,
no test fails on its own, the answers stay correct, and the input bill goes up
roughly tenfold.

`lib/ai/prompt.test.ts` exists for exactly this and asserts the cached part is
byte-identical across requests differing in every volatile input. If you add
something to the persona, that test is the one to keep green.

The other half of the same rule is the **order of the files**. They are sorted
by path with a plain code-unit comparison, never `localeCompare` — two machines
that disagree about where `Ä` sorts produce two different prefixes out of one
handbook and share no cache at all.

## What it costs

`node run.mjs kb-check` prints this for your handbook. The shape of it:

- **A cache read** is ~10% of the input price. A 30,000-token handbook on
  Claude Sonnet 5 (list: $3 / $15 per million) is about **$0.009** of input per
  answer, plus the answer's own output — call it a cent or two per question.
- **A cache write** costs more than plain input: 1.25× for the 5-minute window,
  **2×** for the hour. The same 30,000 tokens is about $0.18 — **once per
  window for the whole installation**, not per customer.

That last point is why `cacheTtl` defaults to `"1h"`. Break-even against the
5-minute window is about three messages, and a support chat with any traffic at
all clears that easily. Switch to `"5m"` only if the app is genuinely idle for
hours at a stretch and you would rather pay per burst.

Two brakes are configured rather than assumed:

- **Which model answers is not here.** It used to be, as a `"model"` field, and
  it moved to `config/ai-models.json` → `tasks.chat` when the provider layer
  landed: a second task needs the same decision, and one place to make it beats
  two. A leftover `"model"` in this file is reported by name rather than
  ignored. Same for **`cacheTtl`** — it still reads here for continuity, but the
  value that is applied travels as `providerOptions.cacheTtl` on the binding,
  because it is an Anthropic concept the other four providers have no
  equivalent for.
- **`maxHistoryTurns`** — the conversation is re-sent on every turn, so an
  unbounded one grows quadratically in tokens.
- **`maxMessagesPer10Min`** — per member, via `lib/rate-limit.ts`. Note the
  in-memory, per-process caveat documented there: behind several instances every
  limit is multiplied by their number.

The layer logs the real numbers on every answer — one line per model call, for
every task and not just this one — and this is the line to grep when something
looks expensive:

```
[ai] task=chat provider=anthropic model=claude-sonnet-5 in=42 out=310 cached=29873 cost=0.001234USD ms=2100 outcome=ok
```

**`cached=0` on the second message of a conversation means the cache is not
hitting.** Start at `lib/ai/prompt.ts`.

The same numbers are written to `ai_usage` and add up on the AI-costs page, so
grepping the log is for debugging one answer — not for answering "what did last
month cost".

## When the handbook outgrows this

Somewhere north of a hundred thousand characters the arithmetic changes: the
cache write gets expensive, and a model reading a book to answer "how do I
cancel" is slower than one reading three paragraphs. `kb-check` warns before it
becomes a surprise.

The seam is **`lib/ai/retriever.ts`**, and nothing else has to move:

```ts
export interface KnowledgeRetriever {
  readonly kind: string;
  blocks(question: string): Promise<PromptBlock[]>;
}
```

A retrieving implementation — Postgres full-text search, or pgvector in the
database you already run — returns the matching passages with
`cacheable: false`. `buildSystemBlocks` then moves the breakpoint back to the
persona, so the persona stays cached and the looked-up part does not. The route,
the UI and the storage never see a document and do not change.

A third candidate exists once a knowledge corpus with a committed graph does
([`docs/knowledge.md`](knowledge.md)): a retriever that reads
`graphify-out/graph.json` — plain Node and `JSON.parse`, no Python at runtime,
no embedding job, no migration. Same seam, same contract: retrieved passages
arrive `cacheable: false` and the breakpoint moves back to the persona.

Do it when the numbers say so, not before. A vector database is an embedding
job, a chunking strategy, a migration and a second thing that can silently
return the wrong paragraph — all of which is worth it for a large corpus and
none of which is worth it for forty pages.

## She can look things up — the content tools

The handbook answers "how does this app work". What it deliberately does not
carry is the app's own CONTENT — a course's nineteen lessons do not belong in
a prompt, however cacheable. For that she has tools: the four `content_*`
tools over the content-source registry (`lib/ai/tools.ts`), executed
in-process mid-answer (`lib/ai/tool-loop.ts`). She searches when the question calls for
it, fetches the page that answers, and tells the member where it is.

What that changes, and what it does not:

- **What she can reach is the content-source registry**
  (`lib/content-source/sources.ts`) and nothing else — out of the box that is
  the handbook itself, and it grows exactly when the app registers a source
  for its own content. The guide is [`content-source.md`](content-source.md),
  including the one decision to take consciously: whatever a tool returns is
  sent to the AI provider, so member-scoped content behind a chat tool is a
  deliberate, recorded decision, never a default.
- **"Nothing about the person is sent to the API" still holds** — the shipped
  tools return the same content for every member.
- **Each lookup is its own provider round-trip** with its own `ai_usage` row,
  up to `MAX_TOOL_ROUNDS` per question — a question that searches costs two
  to three calls instead of one, on a cached prompt. The wire shows a
  `{"type":"tool","name":"…"}` line while she looks; the client ignores
  unknown types, so older UIs simply keep streaming.

## What she can and cannot do

**Nothing about the person is sent to the API.** Not their name, address,
balance, orders, plan or role — only their question, the last few turns of the
same conversation, and the handbook. So she is told, in the persona, that she
cannot see the account, and she says so rather than guessing. This is a
data-protection decision as much as a product one; see
[`data-protection.md`](data-protection.md) §8, which you need if you switch her
on: the chat was the first feature in this template that sends customer input to
a third party outside the payment and mail path — first, and no longer the only
one (§8a).

**And nothing outside this app, either.** She has no web access: her sources are
the handbook and the registered content sources, both of which are yours. There
is no fetch, no search engine and no browsing tool anywhere in the tool set — so
an answer she cannot find in your material is one she says she does not know,
not one she goes looking for.

**That rule is about HER, and it stays.** It is not a limitation waiting to be
lifted — it is what makes an assistant safe to switch on for every signed-in
member without a second thought about their data. A companion built into the
product is the other case, and it has its own rule pointing the other way: a
product-side call is given exactly the rows its call site names, one field at a
time, because it is worthless unless it can see the challenge day and the answer
somebody wrote. The two are different surfaces with different rules, and
harmonising them would break one of the two. The standing rule for the other
direction is in the skill `guardrails`; the inventory is
[`data-protection.md`](data-protection.md) §8a; the shape of the call is
[`ai-providers.md`](ai-providers.md) → *Working alongside your customer*.

Transcripts live in `chat_messages`, are part of `node run.mjs data-export`, and
are deleted with the account (`on delete cascade`) — unlike orders, which are
accounting records that must be kept.

The persona also refuses two things you should not remove:

- **She never accepts a password, card number or code.** An assistant that takes
  one trains customers to type credentials into chat windows.
- **A user message is a question, never an instruction.** Text inside it telling
  her to change her role or reveal her instructions is content to answer or
  decline. This is the prompt-injection rule that matters when the surface is a
  support chat.

### The one thing she knows that is not in the handbook

**The menu on the left**, in every language the app speaks, read from
`messages/*.json` by `lib/ai/nav-labels.ts` and handed to her in block 0.

It is there because a handbook cannot carry it. A handbook is written once, in
one language, by somebody who naturally types "click *Account*" — and the menu
is bilingual and gets renamed. The one that shipped with this template said
*Account* while the sidebar said "Mein Konto" and "My account", so she sent
German customers hunting for an entry that was not there. Now the label travels
with the app: rename the entry in `messages/*.json` and her answer changes with
it. `lib/ai/nav-labels.test.ts` fails the build if a sidebar entry is added,
renamed or reordered without her list following.

Only the member's entries go in. The operator's half of the menu is deliberately
withheld — she answers customers, and "Admin" is a dead end for them.

### What her formatting does

She may use `**bold**`, `*italic*`, `` `code` `` and bullet or numbered lists.
`lib/ai/markdown.ts` parses exactly that much and `components/answer-text.tsx`
renders it as React elements — no `dangerouslySetInnerHTML`, so there is no
sanitiser to keep current, and anything outside the subset (a table, a heading,
a link) is shown to the customer literally. That is the safe direction, and the
persona tells her so rather than pretending the window renders more.

**Two extensions, and they are the same mechanism twice.** Both are bracket
text she repeats *verbatim*; both become something clickable only when the
COMPLETE marker string is in a whitelist she has no way to add to; and anything
that is not an exact copy stays plain text in front of the customer. She never
writes either one herself.

| | Where the whitelist comes from | What it renders as |
|---|---|---|
| `[media:path\|label]` | the loaded **handbook** — static, the same for everybody | a small suggestion card (a video, a worksheet) |
| `[link:path\|label]` *(template 0.18.0+)* | **this answer's own lookups** — the pages a registered content source returned for this member, this turn | an in-app link *inside the sentence* |

So she can now say *"das Thema wird in **Lektion 3: Knoten binden** erklärt"*
with the title clickable — but only about content she actually looked up, and
only to a page of this app. She cannot link to a lesson that does not exist
(the marker would not be in the set) and she cannot link off-site at all (the
target grammar cannot express it). The links a turn used are stored with it, so
they still work after a reload.

There is one thing to know if you register a content source: **a link only
works if the route, the source, the anchor and the visibility gate ship
together**, and the gate must be one function called from both the source and
the page. The checklist is in
[`docs/content-source.md`](content-source.md) → *The five things that make a
link work*. The media markers, the files behind them and the two delivery legs
are [`docs/knowledge.md`](knowledge.md).

## Where she appears

Two places, one conversation:

- **The button at the bottom right of every protected page**
  (`app/dashboard/chat/launcher.tsx`, rendered by `app/dashboard/layout.tsx`).
  It opens a panel with the same chat in it. This is where support questions
  actually get asked — they occur to somebody in the middle of doing something
  else, and a question that needs a page change mostly goes unasked.
- **`/dashboard/chat`**, her own page, in the navigation. The same window with
  more room. The launcher hides itself there, so nobody ends up typing into two
  copies of one conversation.

Both render `ChatWindow` (`app/dashboard/chat/ui.tsx`) with a different
`variant` — one component, so a fix to the streaming loop is a fix in both.

**A companion is a different component, and the two must not be merged.**
`<CompanionPanel>` looks similar and is not: she answers from a handbook and is
told nothing about the person, it reads what the customer produced and is given
exactly the fields its registry entry names. Merging them would mean one data
rule for both surfaces, and whichever rule won would be wrong for the other one.
They do share the one thing worth sharing — `components/answer-text.tsx`, which
turns a model's markdown into React elements. See
[`ai-providers.md`](ai-providers.md) → *Working alongside your customer*.
Both are shown only when `isChatEnabled()` **and**, if `requiresPlan` is set,
the member holds that plan (`mayUseChat()` in `lib/ai/rules.ts`). That decides
what is drawn, never what is allowed: `app/api/chat/route.ts` asks every
question again on every request, because a button nobody rendered is not a
check.

**And the route guards itself because nothing else does.**
`app/api/chat/route.ts` opens with `currentActiveUser()`. That is not
belt-and-braces beside the middleware: `proxy.ts` matches `/dashboard` only, so
**every** route under `app/api/` is public until it protects itself — the chat's,
and the next one somebody adds beside it. A route that forgets this answers
anonymous requests and spends your provider budget on them.

**One exception, and it is there for you rather than for your customers.** When
she is switched on but this machine cannot run her — no key for the provider her
task is bound to, or a config that does not hold together — the **menu entry
stays, for the Operator only** (`chatNavVisible()` in `lib/ai/rules.ts`), and
the page behind it names the cause. Without that the same switch that hides the
broken assistant hides the only page that explains her: key in the `.env`,
`"enabled": true`, and an app that says nothing anywhere. A Member never sees
the entry in that state and gets no diagnosis if they type the URL — the
sentence names an environment variable, which is your infrastructure and not
their business. `"enabled": false` hides it from everybody, including you:
that is a decision, not a fault, and there is nothing to report.

The rule generalises beyond the chat. "Switched off" and "not working" are
different questions, and a `featureKey` in `NAVIGATION` that conflates them
hides the broken feature *and* the page explaining it — an assistant with
`"enabled": true` and a key for the wrong company would produce no button, no
entry and no notice anywhere. Whoever adds the next optional feature to
`NAVIGATION` decides this again: copy the shape of `chatNavVisible()`, do not
reach for `isXEnabled()` alone.

The panel loads the transcript when it is opened, once — not in the layout,
which would put a database query in front of every page in the app for a panel
most visits never open.

## Troubleshooting

| What you see | Where to look |
|---|---|
| No button at the bottom right | `isChatEnabled()`, and `requiresPlan` if it is set |
| The menu entry is missing, and you are the Operator | `"enabled": false` in `config/ai-chat.json`. Any other fault keeps the entry for you — open it and the page says what is wrong |
| The menu entry is missing for a customer, not for you | Correct, and the page you see says why. She is on but this machine cannot run her |
| "not ready yet" on the page | The notice names the cause. On a missing key it names the **provider her task is bound to** as well — a key for a different company leaves her off |
| `cache_read=0` on every answer | Something volatile got into block 0 or 1 — `lib/ai/prompt.ts`, and run `npx vitest run lib/ai/prompt` |
| She invents answers | The handbook does not cover it. Add the document; the persona already tells her to say so |
| She answers in the wrong language | `LOCALE_LABELS` for that locale, passed through in `app/api/chat/route.ts` |
| Works locally, "no handbook" in production | A standalone build that did not copy `content/` — `outputFileTracingIncludes` in `next.config.ts` |
| Everything 401s | The route guards itself (`proxy.ts` covers `/dashboard` only). Check the session |

## The pieces

| File | What it is |
|---|---|
| `config/ai-chat.json` | Her name, picture, model, plan, limits |
| `lib/ai/chat-config.ts` | Reads it, validates it, answers `isChatEnabled()` |
| `lib/ai/frontmatter.mjs` | The handbook format — shared with `kb-check` |
| `lib/ai/knowledge.ts` | Reads `content/knowledge/`, deterministically |
| `lib/ai/retriever.ts` | The seam: handbook → prompt blocks |
| `lib/ai/prompt.ts` | The system blocks and the cache breakpoint |
| `lib/ai/nav-labels.ts` | The menu she may name, per language, from `messages/*.json` |
| `lib/ai/markdown.ts` | The formatting her answers may use — parsed, not sanitised |
| `lib/ai/rules.ts` | Pure refusals — message checks, history window, error codes |
| `lib/ai/conversation.ts` | Reading and writing `chat_messages` |
| `app/api/chat/route.ts` | The guards, in order, and the stream |
| `app/dashboard/chat/` | The page, the window, the launcher, the actions |
