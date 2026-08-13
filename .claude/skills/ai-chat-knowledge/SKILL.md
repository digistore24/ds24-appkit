---
name: ai-chat-knowledge
description: Builds the handbook for the app's in-app AI assistant — interviews the user about the questions their customers actually ask, then writes the answers she is allowed to give. Use this when the user wants the AI chat, mentions an assistant/support bot, says "my customers should be able to ask me questions and get MY answer", "how do I know she won't say something I never said", or when the chat is switched on but answers "I do not know". Also the place to switch the chat on and give her a name.
requires: 0.10.0
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The assistant's handbook — write it, then test it

The app can carry an in-app assistant. She answers **only** from a handbook you
write into `content/knowledge/`; there is nothing else behind her. So this skill
is not about switching a feature on — that is one line — it is about producing
the handbook, because an assistant with a thin one is worse than none at all:
she answers confidently and wrongly, and the customer believes her.

**You write the files. Not the user.** They know the product; you know the
format. Interview, then write.

**What this skill is not:** it is not how an app works alongside its customer on
their own work — reading what they submitted, walking them through a course,
producing the thing with them. That is a different feature with the opposite data
rule, and it is the skill **`ai-companion`**, with
[`docs/ai-in-product.md`](../../../docs/ai-in-product.md) behind it.

Full reference — format, caching, cost, privacy: **`docs/ai-chat.md`**. Where
existing material — a course, an ebook, recorded webinars — should feed the
handbook, [`docs/knowledge.md`](../../../docs/knowledge.md) is the reference
for the corpus it gets distilled into, and Step 2b below is where this skill
reads it.

## Step 1 — Is the chat wanted here at all?

Ask once, plainly. It costs money per answer, and it was the first feature in
this template that sends customer input to a third party — first, and no longer
the only one: a companion sends what the customer *produced* (see `guardrails`,
and `docs/data-protection.md` §8 for her, §8a for that).

> "Shall your app get an assistant that answers your customers' questions out of
> a handbook we write together? She costs a cent or two per answer and she can
> be switched off again at any time."

If yes, settle two things in the same breath:

- **Her name.** Short, easy to type, a proper noun — it is not translated. The
  default is `Lia`. Let them pick.
- **Who may use her.** Every signed-in member (`"requiresPlan": null`), or only
  a plan. If a plan, it is a `kind: "subscription"` or `"one_time"` key from
  `config/digistore-products.json`; access is then answered by
  `hasPlan(memberId, "basic_monthly")` from `lib/entitlements/manage.ts` — the
  entitlement API, never a billing table. A token package cannot gate her; a
  balance is not an entitlement.

Then set it in `config/ai-chat.json` and tell them what still has to happen:

```json
{ "enabled": true, "name": "Lia", "requiresPlan": null }
```

> "One thing I cannot do for you: the key. Until it is in your `.env`, the page
> shows a notice instead of a chat."

**Any one of the five keys does.** She ships on `"auto"`, so
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY` or
`OPENROUTER_API_KEY` — whichever they already have an account for — is enough,
and she runs on that company's current default model. There is no company to
choose first.

**If they want to choose one deliberately, hand over to the `ai-providers` skill
and come back.** That is the conversation about which invoice they want — accounts
they already have, where the data may go, what it costs — and it does not belong
in the middle of writing a handbook. `node run.mjs ai-check` names the key this
installation actually needs.

## Step 2 — Interview: what do people actually ask?

**If `content/knowledge-sources/` exists, read it first — that is Step 2b —
and interview only around what it does not answer.**

Use `AskUserQuestion`, one theme at a time, and summarize back after each. Do
not invent the answers — a handbook you made up is exactly the failure this
skill exists to prevent.

1. **Who is asking?** Paying customers, trial users, people who bought once?
   What do they already know when they arrive?
2. **The real questions.** "What do people write to you about? The last ten
   support mails are the best possible source — the boring, repetitive ones
   especially." Push for concrete questions, not topics.
3. **Where people get stuck.** The step in the first hour that goes wrong. This
   is the onboarding section, and it is the one nobody thinks to write.
4. **The words.** Terms this product uses in its own way, and terms customers
   use for the same thing. Both go in the glossary.
5. **The edges.** What must she NOT answer? Refunds, legal questions, anything
   promising a price. Note it — it goes in the handbook as a "send them to
   support" line.

If the user has documentation, a FAQ page or a help centre already, read it
first and interview around the gaps instead of asking them to repeat it.

## Step 2b — A corpus exists: write from it, ask around it

This step gates itself: no `content/knowledge-sources/`, no step — the
interview above is the whole path, exactly as before. And if there is no
corpus but there IS a pile of existing material — a course already taught, an
ebook, years of webinar recordings — hand over to **`knowledge-intake`**
first: it distills that material into the corpus, and it ends by sending you
back here.

With a corpus on disk, the notes become the source and the interview becomes
the follow-up:

- **Read the notes, topic by topic.** One folder per topic, one distilled
  note per source; the format and every frontmatter key are defined in
  [`docs/knowledge.md`](../../../docs/knowledge.md) → *The corpus* — read
  that, do not guess. The notes are the user's knowledge in their own
  recorded words: write the handbook pages FROM them — their wording, their
  emphasis, their examples — instead of asking the user to repeat what they
  already put there.
- **A note with `status: needs-review` does not exist.** You MUST treat it
  exactly as if the file were not on disk — nothing unverified ever reaches a
  customer answer. Only the user flips that status: they read the note,
  correct it, and set `status: distilled` themselves — the flip IS their
  review, and it is never yours to make. If a needs-review note covers
  something the handbook needs, name it and ask them to review it now; do not
  write around the barrier.
- **Interview only around the gaps.** Run Step 2's five themes against what
  the notes already answer and ask about the rest: the questions customers
  ask that no note covers, the edges near money and support, the words. A
  question the corpus answers is a question you do not ask.
- **Compress — the corpus is unbounded, the handbook is curated.** The corpus
  may hold two years of webinars; the handbook is sent whole with every
  answer, so its size is the feature's running cost. The corpus's breadth is
  input, never a target: select for what customers actually ask — Step 2's
  themes are the selection lens — and `node run.mjs kb-check` is the hard
  wall: it prints what one answer costs at this size and refuses a handbook
  past its budget. A ballooning handbook is failure, not progress.
- **Notes can carry files as well as knowledge.** Where a topic's notes have
  a `media:` entry, the handbook page written from them can offer the file
  itself — the rules are in Step 3, beside the other writing rules.

## Step 3 — Write the files

One topic per file, four sections, frontmatter on every one:

```
content/knowledge/
  00-onboarding/…      the first way through the app
  10-reference/…       feature by feature: what it is, what it does
  20-howto/…           task by task: the steps for one thing
  90-glossary.md       term by term
```

```markdown
---
section: howto
title: Cancel a subscription
summary: Where the cancel link is and what happens to your access.
updated: 2026-07-24
---

## The steps

1. …
```

What separates a handbook she answers well from one she does not:

- **The `summary` is load-bearing.** It is what she reads to decide *which*
  document answers a question. "Information about billing" finds nothing;
  "where the cancel link is and what happens to your access" finds itself.
- **Write the answer, not the feature.** The three steps that cancel a
  subscription beat a description of the billing page.
- **Do not spell out the menu labels.** Write "open your account page from the
  menu on the left", never "click *Account*". She is handed this app's menu
  separately, in every language it speaks, read from `messages/*.json` — so she
  names the entry the reader is actually looking at. A label typed into a
  handbook is a copy in one language that goes stale on the first rename, and
  the handbook shipped with this template proved it: it said *Account* while the
  sidebar said "Mein Konto" and "My account", and she sent German customers
  hunting for an entry that was not there.
- **Say what does NOT happen.** "Cancelling does not delete your account" is the
  sentence that stops the second support mail.
- **One topic per file.** Two topics in one file means half of it is retrieved
  for the wrong question.
- **No `# ` in the body** — the title comes from the frontmatter. Start at `## `.
- **One language, yours.** She answers in the reader's language regardless.

**When a page offers a file.** Where the topic's corpus notes carry a
`media:` entry (Step 2b), the page written from them can hand the file itself
to the customer — as a suggestion card in the chat (the chat only; a
companion renders no markers). Four rules:

- **Frontmatter and body both carry the path.** The page's frontmatter gets
  `media:` with the path(s), comma-separated — the same dialect as the corpus
  note — and the body gets the marker at the exact spot the suggestion
  belongs, never appended as a footer:

  ```markdown
  ---
  section: howto
  title: The breathing exercise
  summary: The 4-7-8 pattern, step by step, with the practice video.
  updated: 2026-08-03
  media: wehen-atmung/atemuebung.mp4
  ---

  ## When the waves come faster

  Switch to the 4-7-8 pattern …
  [media:wehen-atmung/atemuebung.mp4|The breathing exercise as a video (4 min)]
  ```

  `node run.mjs kb-check` cross-checks the two per page — a path in the
  frontmatter with no marker in the body, or the other way round, is a red
  gate.
- **The label is the user's words, in the app's language.** No `|`, `]` or
  line break inside it, and no spaces around the `|` — the same check refuses
  what the grammar refuses.
- **The whole marker must occur verbatim, and that is the security model.**
  The renderer whitelists complete markers exactly as they stand in the
  handbook: she may repeat what is written here, and she can never construct
  a link of her own. So the label you write IS the only label she can ever
  show — a vague label is permanently vague, and changing one is a handbook
  edit followed by `node run.mjs kb-check`, never a prompt tweak.
- **Only media every signed-in member may see.** Delivery is session-gated,
  not plan-gated: whoever is signed in can open the file, whatever the chat's
  own `requiresPlan` says. Paid material belongs in the media store behind
  `hasPlan()` (`docs/visuals.md`), never behind a marker. And a source whose
  corpus note has no `media:` entry — the Licence Gate said no, or the user
  chose not to deliver the file — gets no marker and stays unsuggested.

The template ships six example files. Read one before you write, then **replace
them** — they describe the template, not the user's product.

## Step 4 — Check the format and the cost

```bash
node run.mjs kb-check
```

It names the file and the problem for anything malformed, counts the sections,
and prints what one answer costs at this size. Then:

```bash
node run.mjs test
```

## Step 5 — Ask her three real questions

**This step is not optional, and it is the one that finds the gaps.** A handbook
that passes `kb-check` can still be useless.

```bash
node run.mjs start
```

Open `/dashboard/chat` and ask:

1. Something the handbook covers → the answer must be right, and it must NOT
   name a document, a title or a file. The customer cannot open any of them —
   `content/knowledge/` is never served — so "you will find that in *Getting
   started*" is a broken link written out in words. If she cites, the persona in
   `lib/ai/prompt.ts` was changed; put the rule back.
   Where the handbook carries media markers, make this first question one
   whose answer should offer the file: the suggestion card must appear where
   the marker stands — the card is her handing over what you wrote, not a
   citation. A marker showing as literal text in square brackets means what
   she repeated differs from the handbook — compare character for character
   and run `node run.mjs kb-check`.
2. Something a customer would ask that you did **not** write down → she must say
   she does not know. If she invents an answer instead, the handbook is
   contradicting itself somewhere; find it.
3. Something adjacent to money or access → she must be careful and point at
   support.

Every gap you find goes back into the files. Repeat until all three behave.

Finally, look at the server log once (`node run.mjs logs`) for the line
`[chat] … cache_read=…`. On the **second** message it must be greater than zero.
Zero means the handbook is being re-billed in full on every question — that is a
cost bug, and `docs/ai-chat.md` says where to look.

## Important rules

- **She may only say what is written down.** Every sentence she is expected to
  produce has to exist in a file — or in a registered content source, which
  she can search on demand: the handbook is her cached prompt, and the four
  `content_*` tools reach whatever `lib/content-source/sources.ts` registers
  (out of the box, the handbook again — harmless and simple). An app whose
  REAL content should be findable by her registers it as a source instead of
  copying it into the handbook; `docs/content-source.md` walks through it.
  There is no other source — no account data, no web.
- **Never write a URL, a path or a Markdown link into the handbook** in the hope
  she will pass it along. She is told not to reproduce one, and the window would
  show it to the customer as the literal characters you typed. Where you want to
  send somebody, name the menu entry — she is given the sidebar labels in every
  language the app speaks. *(On template 0.18.0 and newer there is one more way,
  and it is still not handbook work: a lesson she found through a registered
  content source arrives with a ready-made link marker and becomes clickable in
  her sentence. That comes from the source's `url` + `anchor` —
  `docs/content-source.md` — with nothing to write here and nothing to switch
  on.)*
- **She never sees the customer's account.** Balance, orders, plan and address
  are deliberately not sent to the API. So a question like "how many tokens do I
  have?" is answered with *where to look*, and the handbook must say where.
- **Nothing about money or access is decided by her.** She explains; the app
  decides, through `hasPlan()` / `entitlementsFor()`. A handbook sentence that
  promises access is a support incident waiting to happen.
- **Every extra file costs money on every answer.** The whole handbook is sent
  each time (cached, so cheaply — `docs/ai-chat.md`). Write what people ask
  about, not everything that is true.
- **Switching her off is legitimate.** `"enabled": false` and she is gone,
  including from the menu. An app whose handbook nobody maintains is better off
  without her.
- **Read `guardrails` before touching what she may access.** Her scope is a
  security question, not a content one.

## Next step

The handbook is content and stays alive: revisit it whenever the product gains a
feature or support answers the same question twice. Otherwise the path
continues as usual — **`ux-gateway`** → **`security-gateway`** →
**`performance-gateway`** → **`compliance-check`** (which needs
`docs/data-protection.md` §8 for the privacy policy, because the assistant sends
customer input to Anthropic) → **`go-live`** → **`go-to-market`**.
