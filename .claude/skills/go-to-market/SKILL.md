---
name: go-to-market
description: Brings a finished SAAS product to market — positioning, price, channels that fit the reach they already have (including Digistore affiliates), a launch plan and ready-made copy — landing page, e-mail sequence, social posts, video scripts. Use this when the app is done and is meant to be sold, and when the user asks "what should it cost", "which channel", "how do I get people to the page", or says "nobody is buying" — no traffic is this skill, a page that does not convert is `salespage`.
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# From product to market (go-to-market)

Goal: win the first paying customer — with a **simple, concrete** plan and
**ready-made content** the user can put to work right away. Build on the
`docs/product-brief.md` (from `market-research`) if it exists.

Work through this step by step. Ask (AskUserQuestion), propose, deliver
something finished.

## Phase 1 — positioning & price

- **Core message** in one sentence: "[target audience] achieves [outcome] without [pain]."
- **Offer & price:** what exactly is being sold (course, membership, tool access)?
  One-off purchase or subscription? Name a price anchor (oriented on the target
  audience). For a subscription, possibly a yearly discount. The billing runs
  through Digistore (`setup-digistore`).
- **Offer amplifiers:** bonus, guarantee, scarcity (use them honestly).

## Phase 2 — channels (matched to the reach)

Ask about the existing reach and pick **1–2 channels** (not all of them at once):
- **Own list / community** — the fastest way, if it exists.
- **Social (organic)** — short-form video/posts; good for building reach.
- **Digistore affiliates** — partners sell for a commission. `createBuyUrl`
  supports affiliate commissions; a marketplace listing brings reach without an
  audience of your own. For many Digistore vendors the most important lever.
- **Content/SEO** — medium-term, if search intent exists.
- **Paid ads** — only with a budget and a clean funnel; not for the very first start.

## Phase 3 — launch plan (simple)

A lean sequence instead of a big launch:
1. **Preparation:** landing page + checkout link (`setup-digistore`) live, opt-in page checked.
2. **Announcement:** 2–3 touchpoints before sales open (list/social).
3. **Open sales:** clear deadline/CTA.
4. **Follow up:** reminder, resolve objections, social proof.
5. **After the launch:** collect feedback, roll out the affiliate program.

## Phase 4 — create content (ready to use)

Produce concrete content and put it under `docs/marketing/`:
- **Landing page copy:** headline, subheadline, problem, benefits/features, social proof,
  price, FAQ, clear CTA (linking the Digistore checkout).
- **E-mail sequence:** 3–5 mails (announcement → benefit/story → social proof →
  last chance). Subject lines included.
- **Social posts:** 5–10 short posts/hooks for the chosen channel.
- **Video scripts:** at least
  - one **short-video script** (30–60 s) following the pattern **hook → problem →
    solution → proof → CTA**, with scene/spoken text;
  - optionally a **VSL/explainer script** (2–3 min) for the landing page.
  Write spoken text the user can record word for word; keep it concrete and in
  the language of the target audience.

Adapt the tone to the target audience. Do not invent false claims/
testimonials — mark placeholders (e.g. "[insert real customer quote]").

**One thing to do once, when this phase is finished:** if `app/page.tsx` still
carries a weaker page than this document — the template's placeholder, or a
salespage without the real headline and the real promise — the visitor reads
the weaker version. Getting it onto the page is the skill **`salespage`**: it
transplants the copy from `docs/marketing/` rather than rewriting it, and it
builds the sections (hero with a real visual, offer block, FAQ) that a copy
document alone does not give the page. The video is different — a script
written here is not a file yet: **producing** it (tool choice, rendering, a
talking head) is **`content-production`**, and giving the finished file
somewhere to live and a player is **`visuals`** (check `upload`).

## Phase 5 — measure, iterate, write it down

Name 2–3 simple metrics (visitors → checkout clicks → purchases) and how to see
them (Digistore statistics). Recommend one small improvement per week.

**Then write the decisions into `docs/go-to-market.md` — this is the last step of
the run, not optional bookkeeping.** Everything above happened in a conversation,
and a conversation is gone when the session is: the price and the reasoning
behind it, the channel that was chosen, the two that were turned down and why.
Without the file, the next session re-asks all of it — or, worse, quietly picks
a different price and a channel somebody already ruled out. A launch plan is a
plan, so it belongs in `docs/`, beside `docs/plan.md`, and not in
`docs/reports/`, which is where a dated verdict goes.

The shape is
[`references/go-to-market-md-template.md`](references/go-to-market-md-template.md).
It holds the positioning, the price **with** the reasoning, the channels chosen,
the channels rejected with the reason and the date each, the launch plan, the
metrics with today's number, and what was tried and what came of it. The
ready-made content of phase 4 stays under `docs/marketing/` — that is the copy,
this is what was decided about it.

⚠️ **Marketing comes round again, and so does this file.** A second push rewrites
it rather than starting a second one beside it: a decision that changed is dated
in place, and a channel that produced nothing moves into *What was tried* so the
next round does not spend another month on it. And the price in this file is a
record of a decision — what the app charges is
`config/digistore-products.json`, rendered from there and never retyped.

## Principles

- **One channel, one offer, one clear CTA** — focus beats breadth at the start.
- **Use the reach that is already there**, before building new reach.
- **Honest marketing** — no made-up results/reviews (a legal matter, too).
- Next step after the launch: look at the metrics, sharpen the offer/content.
