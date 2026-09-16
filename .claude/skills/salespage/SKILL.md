---
name: salespage
description: Builds the app's own salespage — replaces the placeholder home page with one that actually sells THIS product — headline, a real visual, honest proof, ONE offer block with a working checkout, an FAQ. Use this when the user says "build my salespage", "my homepage is weak", "the start page still shows the template", "the landing page looks empty", "make the home page sell", "the text reads like a report", "it does not sound like me", or when build-app, `setup-digistore` or `go-to-market` hands over. "Visitors do not buy" has two answers — no traffic is `go-to-market`, a page that does not convert the traffic it gets is this skill.
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The salespage — make the home page sell

The home page (`app/page.tsx`) **is** the app's salespage, and what ships there
is a placeholder that describes the template, not your product. Re-texting it
is how apps end up with a README wearing marketing copy; this skill replaces
its structure.

**The reference is [`docs/salespage.md`](../../../docs/salespage.md).** Read it
before step 2; do not restate it here. It carries the section inventory, where
every fact comes from, the offer-block-versus-`/plans` reasoning, the imagery
rules and the honesty rules. What lives in this skill is only the path.

The decision is the user's, never yours (`docs/guidance.md` → *How a skill works*:
**anything the customer will SEE is proposed, never assumed**).

## Step 0 — Is there already one?

- **`docs/app.md` records a salespage decision** → read it, say what it holds,
  ask in one sentence what should change. A recorded "no real salespage yet, on
  purpose" is an answer — say so and stop.
- **`app/page.tsx` is no longer the shipped placeholder** (the three
  `home.features.*` keys are gone from the page — that is the marker, whatever
  the page renders them as) → somebody already built one. This run is
  an improvement pass, and it runs the same path as a first build, only
  shorter: **step 1b first, whatever the complaint** — "it does not sell" as
  much as "it reads like a report" — then the Lektorat (step 3c) reads the
  page AS IT IS against that list, then step 5's stranger test. Propose what
  fixes the findings; a page on which a feature-list row is missing gets
  section 4 in the proposal, marked ✅, every time. Every copy change, even a
  subline, goes through the deck (step 3) and the Lektorat (3c) before it is
  built; every later round follows step 3b. Measured 2026-09-16: on "sie
  verkauft nicht" a session skipped all three, moved the price and the
  audience up, and left eleven features unnamed until the operator wrote
  *"simpel die Funktionen — die hast du nur umschrieben und nicht einmal alle
  aufgeführt"*.
- **An experiment / test app** → skip the whole skill, same boundary as
  everywhere else.

Worth saying once when the hand-over comes early: the page needs the product
brief and real products to be written *from*. Before `setup-digistore` has run,
prices and checkout links do not exist yet — build the page after payment is
connected, not before.

## Step 1 — Gather, don't ask

Almost everything this page needs is on disk. Read, in this order:

| | For |
|---|---|
| `docs/product-brief.md` | audience, pain, core message |
| `docs/app.md` | what the app really does, decisions already made |
| `config/digistore-products.json` | products, prices, the `highlight` entry |
| `docs/design.md` (if it exists) | tokens, type, composition the page must follow |
| `docs/marketing/` (if `go-to-market` ran) | finished copy — transplant it, do not rewrite it |
| `docs/marketing/voice.md` (if it exists) | the operator's voice — every sentence follows it |
| `config/ai-chat.json` → `name` | the assistant's NAME — the page says "Frag Lia", never "der Assistent" |
| `nav.*` in `messages/<code>.json`, module and page titles | the names the app gives its features — the page's vocabulary |
| the app's own pages / course content | section 4's concrete contents |

Then **inventory the imagery the app already owns**: `public/`, the app icon,
course or lesson covers, `media` rows with `visibility: "public"`. Apps
routinely keep every picture behind the paywall while `/` shows three icons —
what exists decides whether the hero needs anything generated at all.

Ask the user only what no file answers — typically: is there any real proof
yet (customers, numbers, a story), is there a house guarantee beyond the
statutory withdrawal right, and — unless `voice.md` exists — a text they wrote
themselves or a page they want to sound like. Three questions, one sentence
each.

## Step 1b — The feature list and the style sheet, before any sentence

Two things no file holds ready, and the page fails without both — measured
twice in September 2026, `docs/salespage.md` → *Names and voice*:

- **The feature list.** One row per feature: the name **as the app shows it**
  and WHERE (`nav.*`, a card title, the assistant's `name` — the row cites the
  place), what it holds, read out of the app, and the scope in numbers where
  config or registry has one. Read the APP, not the page you replace: every
  buyer-visible `nav.*` entry, every module in `config/modules.json` and its
  pages, every companion card, every activity, what a lesson page carries
  (worksheet, task), the community's rooms — a row left out says why. A feature with no name on its own page gets
  none here, and a name never moves to another feature — not even when the
  operator says so in the chat. Show it and have it confirmed. From then on
  the page calls every feature by that name — "Frag Lia", "Wochenplaner",
  never "Fragen" and "Planen lassen" — every row appears on the page at
  least once, and **section 4 lists them all, plainly**: name, one line,
  scope (`docs/salespage.md` § 4).
- **Unknown words are explained or left out.** A stranger has never seen the
  app: the first mention of a name carries its role ("Finn, dein KI-Coach"),
  an internal label carries its one-line meaning or stays off the page.
- **The style sheet.** From the operator's sample, write
  `docs/marketing/voice.md`: five to eight lines — address, sentence length,
  what the page does instead of proving, words they use, words and
  constructions that are out. Show it before the first sentence of copy.
  The sample was given for its voice: putting its sentences on the page is
  a question to the operator, not a default.

Both worked in [`references/copy-guide.md`](references/copy-guide.md).

## Step 2 — Propose the sections, then WAIT

Put the section plan to the user as a numbered menu — the inventory is
`docs/salespage.md`, the menu names what each section would say **for this
app** and where its content comes from. Mark the recommended rows ✅. Example
shape:

```
Your home page still sells the template. For <product> I would build:

  1  Hero — "<outcome headline draft>", with <the cover image you already have>  ✅
  2  Problem → promise — from the brief's pain points                            ✅
  3  Benefits — 3 outcomes (not the checkout bullets)                            ✅
  4  What you get — all <n> features by name, one line each (the list above)  ✅
     plus your 5 course blocks, with their cover images
  5  Social proof — you have no reviews yet: founder story, or leave it out
  6  Offer block — <highlight product> at <price>, withdrawal right named,
     buy button on the real checkout                                             ✅
  7  FAQ — 6 objections from the brief
  8  Final CTA band                                                              ✅

  0  none of it — the page stays as it is

Give me numbers, or say "you choose" and I take the rows marked ✅.
```

Three answers, all valid: **numbers** → exactly those; **"you choose"** → the
✅ rows, no further question; **`0`** → nothing is built, and it goes into
`docs/app.md` under *Decisions worth remembering* with the date — an
unrecorded no is one somebody proposes again next session.

**Do not negotiate a `0`**, and do not reopen the menu after an answer.
Rows 1, 4 and 6 are the page's spine (`docs/salespage.md` → *The section
inventory*): when the numbers leave out 4, say in one sentence that a page
without the list of what the buyer gets has sold an idea, and ask once.

## Step 3 — Write the copy

Draft every section's text before touching the page, following
`docs/salespage.md` → *Where every fact comes from*. The two rules that break
on exactly this page:

- **Every language file.** Every visible sentence goes into each
  `messages/<code>.json` — the list is `LOCALES` in `i18n/config.ts` — under a
  `home.*` key. The only exemption is the
  registry's product copy — which is also why registry `features[]` must not be
  promoted to page copy.
- **Nothing invented.** No testimonials, numbers or guarantees that do not
  exist — placeholders are marked and never go live. The worked feature→benefit
  and headline examples are in
  [`references/copy-guide.md`](references/copy-guide.md).

And the four that `docs/salespage.md` → *The voice* names because a measured
page broke all of them: verbs the reader does; the pain shown, not proved — no
number before the offer block; short main clauses; nothing `voice.md`
excludes. The draft is a file, not a message: `docs/marketing/salespage-<lang>.md`
in the operator's language, the feature list at its head, then the sections in
page order. Read it once against the feature list (every name present, every
count the app's own), once against `voice.md` (every sentence), and once as a
stranger (every term not common knowledge explained at its first mention, or
removed) — then hand it to the Lektorat.

## Step 3c — The Lektorat, before the operator reads a word

A second reader in a fresh context — a subagent where you have one, otherwise
you, after closing the draft and reading it back from disk — reads the deck
against [`references/lektorat.md`](references/lektorat.md): understandable
(short sentences, unknown terms explained or gone), concrete (a scene, not a
proof; numbers the app's own), problem named then solution named, the
stranger's five, names, voice, headline, honesty. It writes its verdict into
the deck under `## Lektorat`: **freigegeben** or **zurück**, one row per
finding — place, criterion number, finding, one possible fix. You fix every
*zurück* row and it reads again; three rounds at most, then the open rows go
to the operator as they stand. Measured 2026-09-16: without this reader a
page reached the operator that opened with "Finn schaut sie sich an" and never
said who Finn was — the writer had read it three times and not seen it.

Show the user the headline and the offer-block wording before building — those
two carry the sale, and they are cheaper to change as text than as a page —
together with the Lektorat's verdict and its open Hinweise, in one line each.

## Step 3b — When the text comes back

Feedback names a **principle**, and a principle is applied to **every
section** — never a new sentence for the one they pointed at. The measured
page turned its headline eight times in 44 minutes, twice back to a discarded
version, never touched its problem paragraph, and broke "keine Antithesen"
two minutes after hearing it. Each round:

1. The principle in one line, written into `voice.md` (an excluded
   construction goes onto its exclusion list).
2. Every section re-read against it; what breaks it changes.
3. The Lektorat reads the revised deck again (step 3c) — the operator's
   remark changed one principle, the reader checks that the page still holds
   all the others.
4. The hand-back is a table — section, changed or unchanged, why — not a page,
   with the Lektorat's verdict under it.
5. Discarded variants stay listed with their reason and never come back; a
   line the operator wrote goes in as written.

## Step 4 — Build it

The page is built from the **freigegebene** deck — every `home.*` string in
every `messages/<code>.json` is a line of it, the other languages translated
from it and read once more (`references/lektorat.md` → *The other languages*).
Replace `app/page.tsx`'s content section by section — the worked TSX recipes,
kit-only and token-only, are in
[`references/sections.md`](references/sections.md). The rules that hold
throughout:

- Kit components and tokens only; what is missing gets fetched
  (`npx shadcn@latest add accordion` for the FAQ). No hand-built fold-outs, no
  hex classes.
- Images through `<Figure>` / `next/image`, with real alternative text, working
  in both themes.
- The buy button through `checkoutLinksFor()` — `app/plans/page.tsx` is the
  worked example, blockers included. Never a hand-assembled Digistore24 URL.
- The price through `formatPrice()` off the registry — never retyped.
- `/plans` stays as it is. The offer block features ONE product and links to
  `/plans` for the comparison when more than one exists.
- If `docs/design.md` exists, the page follows it — its composition and
  signature element apply here like on every page.

## Step 5 — Verify

```bash
node run.mjs ux-check
node run.mjs start
node run.mjs smoke
node run.mjs errors
```

Then look at `/` yourself — both themes, once at ~380 px — and run the
stranger test from `docs/salespage.md`: *what is this and what do I get, by
the names the app uses; who is it for; what does it cost; why believe you;
what do I click* — five answers within one scroll. Click the buy button once: in DEV it carries the test-payment
parameter by itself, and a button that does not reach a Digistore24 checkout
form is a finding, not a detail. If a browser tool is available use it;
otherwise ask the user to open the page and say what they see
(`CLAUDE.md` → *What the skills assume you can do*).

**Every claim in the offer block and the benefit tiles maps to what the plan
on THAT button grants.** Read `config/digistore-products.json` and the gates —
`requiresPlan` in `config/ai-chat.json`, `requiresPlan` in
`modules/activity/activities.ts`, the courses' `planKeys`, a room's plan — and
strike every benefit the button's plan does not unlock. Nothing checks this
for you (`legal-check` scans forbidden words, not coverage). Measured
2026-09-15: *"jede Lektion hat einen KI-Helfer"* and *"Geschäftsidee
einreichen und sofort KI-Feedback"* on a page selling the course, while both
were gated on the membership — the customer caught it, the page had not.

## Step 6 — Write it down, hand over

One entry in `docs/app.md`: the sections built, where the copy came from,
that the voice is in `docs/marketing/voice.md` and the approved deck with its
Lektorat in `docs/marketing/salespage-<lang>.md`, and what was decided against (no proof section yet, no FAQ — with the reason).
Then name the next step: **`ux-gateway`** (check `first-run`) audits the page
as a stranger next; **`go-to-market`** comes after go-live for the traffic
that lands on it.

## STOP — read `guardrails` first

- **Price and offer wording are on file at Digistore24.** The page renders the
  registry; changing what is sold or what it costs is `setup-digistore` /
  `billing-modes`, never a page edit.
- **No invented claims, testimonials, numbers or guarantees** — a marked
  placeholder never goes live. When the user asks for proof that does not
  exist, name the honest alternatives (`docs/salespage.md` § 5) and stop.
