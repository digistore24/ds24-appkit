<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Copy examples — the moves, worked

The rules live in `docs/salespage.md`; these are worked examples of applying
them. Everything here is a pattern to imitate with THIS app's facts — never a
sentence to copy through.

## Headlines — outcome for the audience, not category

The move: *[audience] gets [outcome] — without [pain]*, then compress until it
sounds like a person said it.

| Reads like a category | Reads like an outcome |
|---|---|
| "Der Online-Angelkurs" | "Vom ersten Wurf zum sicheren Fang" |
| "Meal planning software" | "Weeknight dinners, decided by Tuesday" |
| "Ein Kurs über Buchhaltung" | "Deine Steuererklärung ohne Angstschweiß" |

Test: could a competitor put the same headline over their product? Then it is
a category, not a promise — sharpen until it could only be this one.

## Feature → benefit — the translation table

The move: feature → what the customer can *do* afterwards → why that matters.
The registry's `features[]` are the left column; the page gets the right one.

| Checkout bullet (registry) | Page benefit |
|---|---|
| "12 Video-Lektionen" | "In fünf Blöcken vom Gerätekauf bis zum ersten eigenen Angeltrip — in deinem Tempo" |
| "KI-Coach inklusive" | "Stell jede Anfängerfrage sofort — statt drei Foren zu durchsuchen" |
| "Arbeitsblätter als PDF" | "Jeder Block endet mit einer Checkliste, die du ans Wasser mitnimmst" |
| "Einmalzahlung" | "Einmal zahlen, kein Abo, keine Folgekosten" |

🚨 **The last row is where this table used to break its own rule.** Its benefit
half promised that what you buy once you may use for all time — and a worked
example is copied rather than read, so the promise travelled into real pages.
The forbidden sentence is not reproduced here for the same reason. **No sales
sentence puts a duration on access to a members' area**: not "für immer", not
"lebenslang", not "lifetime", not "dauerhaft", not "unbegrenzt" — nor the five
others Digistore24 names ([`docs/courses.md`](../../../../docs/courses.md) →
*Shape 1*). **`node run.mjs legal-check` refuses them**, matched as stems and
only where the sentence also names access — so write the page, then run it, and
believe it: it caught "Einmal kaufen, dauerhaft nutzen" in a real app. A one-off
purchase has no end date because no event ends it, which is a fact about the
grant and not a term anybody may promise; the reasoning, and the Digistore24
rule behind it, are [`docs/courses.md`](../../../../docs/courses.md) →
*Shape 1*. Say what is actually true — paid once, no subscription — which is
the half that sells anyway.

The left column still has its place: as the value-stack lines *inside* the
offer block, where somebody deciding wants the packing list.

## FAQ — objections, not documentation

Source them from the brief's pain points and from what a skeptic would ask
before paying. The recurring six, to adapt:

1. Is this for complete beginners? (competence fear)
2. How much time does it take? (effort fear)
3. How long do I keep access? (loss fear — and the one whose honest answer is
   easiest to overshoot: there is no subscription and nothing to cancel, which
   is the reassurance. A number of years, or "für immer", is the rule under
   *Feature → benefit* broken in question form)
4. What if it is not for me? (risk — the withdrawal right, stated plainly)
5. Do I need special equipment / prior knowledge? (hidden-cost fear)
6. How is this different from free YouTube videos? (the real competitor)

Answers are two or three honest sentences. An answer that turns back into a
sales pitch teaches the reader to stop believing the section.

## Honest proof for a product with no customers yet

- **Founder story**: "Ich habe zehn Jahre Angelkurse am Wasser gegeben — das
  hier ist der Kurs, den meine Teilnehmer immer mitnehmen wollten." Two
  sentences of credential, one of motive. No invented titles.
- **Real numbers only**: years of practice, students taught offline, real
  Digistore24 ratings once they exist. Never "500+ zufriedene Kunden" on a
  launch day.
- **A marked placeholder** — `[echtes Kundenzitat einsetzen]` — is fine in a
  draft and forbidden on a live page. If launch comes first, the section is
  omitted, not faked.

## Guarantee wording — name what exists

- Statutory: "14 Tage Widerrufsrecht — ohne Angabe von Gründen." Free to say,
  true by law for this checkout, reads as risk reversal.
- A house guarantee ("30 Tage Geld zurück") only if the vendor decided it and
  it is on file with the product at Digistore24 — the page reports promises,
  it does not create them.
