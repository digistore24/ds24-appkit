<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The `docs/go-to-market.md` template

_Read from `go-to-market`, phase 5: the shape of the file that says how this
product gets sold. Copy it when creating the file, and keep it, so a second
round of marketing reads the same and argues with a record._

```markdown
# <App name> — how it gets sold

_What was decided about selling this, in plain words: what is promised, what it
costs and why, which channels are being used and which were turned down. The
finished copy lives under docs/marketing/ — this file is the decisions behind
it. docs/product-brief.md says what the product IS; docs/plan.md says what is
still to be built._

## Positioning

- **The one sentence:** <target audience> achieves <outcome> without <pain>
- **For:** <who this is for — and, in one line, who it is deliberately not for>
- **Instead of:** <what they do today, which is what the sentence competes with>

## The price, and why

- **Offer:** <what is bought: one purchase | subscription | by usage>
- **Price:** <amount and interval, as agreed on <date>>
- **Why this number:** <what it was anchored on — what the outcome is worth to
  the audience, what they pay for the thing they use today, why not half or
  double. The number is the easy part; this line is the one nobody
  reconstructs, and it is what stops the next session quietly picking another>
- **Amplifiers:** <bonus, guarantee, a real deadline — each one honest and
  actually deliverable, or the line stays empty>

## Channels

- **Chosen — <channel>:** <why it fits the reach that already exists, and the
  first concrete thing to do in it>
- **Chosen — <channel>:** <one or two at the start, never five>
- **Rejected — <channel>:** <date>: <why not, in the words it was said in: "no
  budget for ads until the page converts what it already gets", "there is no
  list yet", "affiliates once the refund rate is known">
- **Rejected — <channel>:** <date>: <the reason>

## The launch

- [ ] <preparation: the page is live, the checkout link was really clicked>
- [ ] <announcement: when, and where>
- [ ] <sales open: the deadline and the one call to action>
- [ ] <follow-up: reminder, the objection nobody answered, proof>
- [ ] <after: ask the first buyers, then the affiliate program>

## How it is measured

- **<visitors | checkout clicks | purchases | refund rate>:** <where it is read
  — the Digistore24 statistics, the host's own numbers> — <the number on <date>>

## What was tried, and what happened

- **<date> — <what was done>:** <what came of it, in numbers where there are
  any. A channel that produced nothing belongs here most of all, so the next
  round does not spend another month on it>
```

**Why the rejected channels have a section of their own.** A channel that was
considered and turned down leaves no trace anywhere else, so it comes back as a
proposal three sessions later from an agent with no way of knowing it was
settled — the same hole `docs/plan.md`'s *Not in the first version* closes for
scope. The rule the coach works by is that **a recorded "no" is an answer**, and
it can only reach what somebody wrote down. Date each one: a "no" to paid ads
before there was a converting page is not a "no" for ever.

**The price is here as a DECISION, never as the app's price.** What the app
charges lives in `config/digistore-products.json` and is rendered from there —
one price, one place. This file records the number that was agreed and the
reasoning nobody can read out of the config; if the two ever disagree, the
config is right and this file is out of date.

**And what is deliberately not in here.** No landing-page copy, no e-mail
sequence, no video script — those are files under `docs/marketing/`, and this
document would rot the moment somebody edited one of them. No invented
testimonials, member counts or results, not even as a plausible example: a
placeholder is written as one and marked. No funnel diagrams and no vocabulary
the operator has to learn — every line is a sentence they could read out loud,
or it does not belong in the file.
