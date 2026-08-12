---
name: salespage
description: Builds the app's own salespage — replaces the placeholder home page with one that actually sells THIS product — headline, a real visual, honest proof, ONE offer block with a working checkout, an FAQ. Use this when the user says "build my salespage", "my homepage is weak", "the start page still shows the template", "the landing page looks empty", "make the home page sell", or when build-app, `setup-digistore` or `go-to-market` hands over. "Visitors do not buy" has two answers — no traffic is `go-to-market`, a page that does not convert the traffic it gets is this skill.
requires: 0.7.0
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
  an improvement pass: do step 5's stranger test first, report what fails, and
  propose only the sections that would fix it.
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
| the app's own pages / course content | section 4's concrete contents |

Then **inventory the imagery the app already owns**: `public/`, the app icon,
course or lesson covers, `media` rows with `visibility: "public"`. Apps
routinely keep every picture behind the paywall while `/` shows three icons —
what exists decides whether the hero needs anything generated at all.

Ask the user only what no file answers — typically: is there any real proof
yet (customers, numbers, a story), and is there a house guarantee beyond the
statutory withdrawal right. Two questions, one sentence each.

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
  4  What's inside — your 5 course blocks, with their cover images               ✅
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

## Step 3 — Write the copy

Draft every section's text before touching the page, following
`docs/salespage.md` → *Where every fact comes from*. The two rules that break
on exactly this page:

- **Both language files.** Every visible sentence goes into `messages/de.json`
  **and** `messages/en.json` under a `home.*` key. The only exemption is the
  registry's product copy — which is also why registry `features[]` must not be
  promoted to page copy.
- **Nothing invented.** No testimonials, numbers or guarantees that do not
  exist — placeholders are marked and never go live. The worked feature→benefit
  and headline examples are in
  [`references/copy-guide.md`](references/copy-guide.md).

Show the user the headline and the offer-block wording before building — those
two carry the sale, and they are cheaper to change as text than as a page.

## Step 4 — Build it

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
stranger test from `docs/salespage.md`: *what is this, who is it for, what
does it cost, why believe you, what do I click* — five answers within one
scroll. Click the buy button once: in DEV it carries the test-payment
parameter by itself, and a button that does not reach a Digistore24 checkout
form is a finding, not a detail. If a browser tool is available use it;
otherwise ask the user to open the page and say what they see
(`CLAUDE.md` → *What the skills assume you can do*).

## Step 6 — Write it down, hand over

One entry in `docs/app.md`: the sections built, where the copy came from, and
what was decided against (no proof section yet, no FAQ — with the reason).
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
