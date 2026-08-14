---
name: compliance-check
description: The EU compliance check for this app — works out which rules actually reach it (GDPR, TDDDG §25, EU AI Act, DDG §5, consumer law, plus BFSG/DSA where they bite), then fixes, writes the legal pages and reports. Use it before go-live, when somebody asks "do I need a cookie banner?", "does the AI Act apply to me?", "what do I have to put in my privacy policy?", "can my customers delete their account?", "am I allowed to sell this yet?", mentions an Impressum, a warning letter (Abmahnung) or a data protection authority, or after adding anything that processes personal data. NOT legal advice — it prepares, a lawyer decides.
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Compliance gateway — which rules reach this app, and what is still missing

This app sells to people in the EU. Before it does that for real, it gets
checked properly: **work out what applies → find what is missing → build it →
write the evidence → report.**

**This is not legal advice.** It prepares: it produces texts, records and code
so that a lawyer is reviewing something concrete instead of starting from
nothing, and it tells you which questions are genuinely yours to answer.

Two files carry the reasoning, and this skill **points at them rather than
repeating them** — two copies drift, and the copy in a skill is the one nobody
updates:

- **[`docs/compliance.md`](../../../docs/compliance.md)** — the map. Which
  regulation, from when, who is exempt, what in this app triggers it. **Read it
  first, every time.** Dates move; that file is where they are kept current.
- **[`docs/data-protection.md`](../../../docs/data-protection.md)** — the
  inventory. Every table holding personal data, every recipient, every retention
  window, read out of the code rather than remembered. A privacy policy is
  drafted from *that*, never from a checklist.

The standing rules for handling money, secrets and customer data live in
**`guardrails`**. Where this skill and that one disagree, `guardrails` wins.

## How to use this skill

Eight checks. You do not have to know which one you want.

| # | Check | What it looks at | Roughly |
|---|---|---|---|
| 1 | **`all`** | everything below, in order | 45–90 min |
| 2 | **`scope`** | which rules reach THIS app — six questions, then the rest follows | 10 min |
| 3 | **`pages`** | Impressum, privacy policy, and the terms — if they are yours | 20–30 min |
| 4 | **`ai`** | EU AI Act: your role, Art. 50 disclosure, Art. 4 literacy | 10–15 min |
| 5 | **`consent`** | § 25 TDDDG, marketing mail — and whether you need any at all | 10 min |
| 6 | **`rights`** | access, deletion, portability, objection — end to end | 10 min |
| 7 | **`evidence`** | the accountability pack (Art. 5(2)): records, TOMs, DPAs | 20–30 min |
| 8 | **`map`** | BFSG, DSA, Data Act, FernUSG — do they reach you yet? Judged elements sharpen the BFSG half and are half the FernUSG question | 5 min |

**How to dispatch:**

- If the user already said what they want ("do I need a cookie banner?", "write
  my Impressum"), **start that check and skip the menu.**
- Otherwise show the table, say that **`all`** is what you run before go-live,
  and **wait**. A number, a name or a description all count.
- **You run the commands** — through your Bash tool, and you report what came
  back. Never hand a command to the user; the people here are not developers.
- **Look before you ask.** Almost everything is on disk: `config/`, `db/`,
  `content/legal/`, `docs/`, and `node run.mjs legal-check`. Ask only what
  genuinely leaves no trace — and `scope` is where those questions live, so
  every other check can assume they are answered.

Start every check with:

```bash
node run.mjs legal-check
```

It reports what is still a placeholder, whether the AI notice is in place,
**whether the app promises how long access lasts and whether the buyer is told
who charged them** (the two Digistore24 platform rules — not law, and the only
two findings here whose consequence is an account rather than a fine), whether a
declared consent purpose has its wording, which evidence documents are missing,
and — the one nothing else can tell you — whether the retention jobs have
actually run.

## What counts as a finding

The ladder and the four-line `Where:` / `Why:` / `Fix:` / `Evidence:` format are
the shipped ones — [`docs/guidance.md`](../../../docs/guidance.md) → *One report
shape*. What each rung means here:

| | Severity | Meaning |
|---|---|---|
| 🚨 | **CRITICAL** | Unlawful right now, and somebody is affected. Personal data going somewhere with no basis, a deadline already passed. Stop and fix. |
| ❌ | **HIGH** | Fix before the app meets a customer. A missing Impressum, a missing privacy policy, an undisclosed AI. |
| ⚠️ | **MEDIUM** | Real, but it needs a second condition — a threshold you have not crossed yet, a feature you have not built yet. |
| ℹ️ | **LOW** | Hardening, or documentation that would help you later. |

**What counts as shown, here:** a file you have actually read or a command you
have actually run. Anything resting on an assumption goes into **Worth a look**
and is not counted — in this domain a confident wrong finding is worse than in
most, because it sends somebody to a lawyer with the wrong question and a bill.
And **Why** says what actually goes wrong, in plain words **and with the article
that says so** — not "GDPR non-compliance".

## 1 · `all` — the full pass

In this order. It is not arbitrary:

1. **`scope`** — everything else depends on its answers. Never skip it.
2. **`ai`** — the only check here with a deadline that has already passed
   (Art. 50, 2 August 2026). Cheap, and it either applies or it does not.
3. **`consent`** — decides whether check 3 has to describe a banner.
4. **`pages`** — the long one, and the one that needs the answers above.
5. **`rights`** — mostly verification: this template already implements them.
6. **`evidence`** — writes what is by then known, so it goes late.
7. **`map`** — five minutes, and it may change what the user does next quarter.

Then: one report, one summary, one honest list of what still needs a lawyer.

## 2 · `scope` — which rules reach THIS app

Read from disk first, and say what you found rather than asking about it:

| Question | Where the answer is |
|---|---|
| Is there a support **assistant**? | `config/ai-chat.json` (`enabled`) — she answers from `content/knowledge/` and is sent nothing about the person |
| Is there a **companion** — anything that reads, judges or advises on what a customer produced? | `config/ai-companion.json` (`enabled`) **and** the entries in `modules/companion/companions.ts`. `node run.mjs legal-check` reports the switch; each entry's `load()` is the list of customer data that call sends, and it is what §8a and the policy paragraph are drafted from |
| Which AI company receives data? | `node run.mjs ai-check` |
| Is there tracking? | grep `app/`, `components/` for analytics — the template ships none |
| Is there **ingested third-party material**? | `content/knowledge-sources/` — a rights question the Licence Gate at intake already governs (verbatim storage only for own or licensed content; third-party sources are distilled, source cited): [`docs/knowledge.md`](../../../docs/knowledge.md) |
| What personal data is held? | `docs/data-protection.md` |
| Is the HTTP API on? | `node run.mjs module list` (is the `api` module installed?) **and** `config/api.json`. ⚠️ Switched off is not the same as never used — the keys minted while it ran are still held and still in both exports (`docs/data-protection.md` §9) |
| **How** is it sold? | `config/digistore-products.json` (`billingMode`) — one-off, subscription or token balance |
| 🚨 **WHAT** is sold — is this teaching? | `billingMode` answers the billing FORM and says nothing about the OBJECT, and the object is what one German statute turns on. Read off disk and report together: `node run.mjs module list` (is `courses` installed? `community`? `activity`?), `config/course.json` → `shape` (shape 3 means a person judges what was handed in), `grep -n "passMark" modules/activity/activities.ts`, and `grep -rin "zertifikat\|certificate\|bescheinigung" content/ messages/ app/` for a promised certificate. **Paid teaching + learners mostly not in the room + the learning outcome monitored** is § 1(1) FernUSG, and then the product needs ZFU authorisation *before* it may be sold — [`docs/compliance.md`](../../../docs/compliance.md) §6.5. 🚨 **Weight them the right way round**: `community` and a human or model judgement CARRY the monitoring element, an auto-graded quiz does not. Report the combination; **never decide whether it applies** |

Then ask — and **only** these, in one message, because none of them leaves a
trace on disk:

1. **Who is the contracting party for the purchase — you or Digistore24 as
   reseller?** This decides whether AGB and the right-of-withdrawal notice are
   yours at all. It is in the Digistore24 contract, not in the code.
   The technical setup **hints** at the answer and is worth naming when you ask,
   so the user is not guessing from memory: selling through a reseller means a
   `DIGISTORE_SITEOWNER_ID` of 1 (Germany), 2 (USA), 3 (UK) or 4 (Ireland), and
   products that carry an approval status there; a **Direct Seller** sells on
   their own account, has no product approval at all, and is then normally the
   contracting party themselves. Offer that as evidence, never as the verdict —
   the contract decides, and this question is the one place in this skill where
   guessing wrong changes which legal texts the app has to carry.
   ⚠️ **The answer does not change the post-purchase notice, and that catches
   people out.** Whoever the contracting party is, the money is COLLECTED by
   Digistore24 and their name is what turns up on the buyer's statement — so
   the thank-you page and the purchase confirmation say so either way.
   `node run.mjs legal-check` refuses an app where either has lost the sentence
   or the mount; there are two surfaces because a signed-in buyer never sees
   the thank-you page at all.
2. **How many people work in the business, and what is the annual turnover?**
   Two thresholds hang off this and nothing else: BFSG (under 10 **and**
   ≤ €2m → exempt for services) and the DSA transparency report (under 50
   **and** ≤ €10m → exempt).
3. **Consumers or businesses?** BFSG and the consumer-law duties are about
   consumers.
4. **Are 20 or more people constantly occupied with automated processing?**
   § 38 BDSG — a data protection officer becomes mandatory.
5. **Which country's law applies — where is the business established?** This
   file is written for Germany. Austria, Switzerland and the rest of the EU
   share the GDPR and the AI Act but differ on the Impressum and consumer rules.
6. **Does the app do anything the map calls high-risk?** Scoring applicants,
   assessing creditworthiness, gating an essential service. If yes, say plainly
   that this skill's map stops there and the obligations are a different order
   of magnitude (`docs/compliance.md` §3.5).
7. **If there is a companion — what does it advise on?** Health, money or law
   makes it a **different risk conversation**, and not the same one as question
   6. Say so, mark it in the report and hand it to a person. Do **not** call it
   high-risk under Annex III on your own: for health it is Art. 9 special
   categories, for money it may be Annex III creditworthiness, and for law it is
   professional-liability ground the AI Act does not govern at all. Three
   different regimes wearing one word. **This skill's map stops here** — the
   same honest answer question 6 already gives.

Write the answers into the report. Every later check reads them from there
rather than asking again.

**If the answer to 5 is not Germany**, say so once and clearly: the GDPR, the AI
Act, the DSA and the Data Act are EU regulations and apply as written, but
§ 5 DDG, § 25 TDDDG, § 147 AO, § 257 HGB and § 38 BDSG are German statutes with
local equivalents. Do not silently produce a German Impressum for an Austrian
business.

## 3 · `pages` — Impressum, privacy policy, terms

**What already exists:** `content/legal/<slug>.<locale>.md` holds the text,
`app/<slug>/page.tsx` is the route, `components/site-footer.tsx` links whatever
is there. Impressum and privacy policy ship as placeholders that say so on the
page; AGB and Widerruf ship as nothing at all.

**Adding a page needs both halves.** Write the markdown in **both** languages
and create the route beside the two that exist:

```tsx
// app/agb/page.tsx
import { LegalPage, legalMetadata } from "@/components/legal-page";

export const generateMetadata = () => legalMetadata("agb");

export default function Page() {
  return <LegalPage slug="agb" />;
}
```

Remove the `<!-- ds24-appkit:placeholder -->` marker from a file when you fill
it in — that marker is what `legal-check` and the warning box on the page read.

### The Impressum — § 5 DDG

What to ask the user for, the repealed-TMG trap, and why a half-filled
Impressum is worse than the shipped placeholder are in
[`references/consumer-and-info-duties.md`](references/consumer-and-info-duties.md)
→ *The Impressum* — read that section before drafting the page.

### The privacy policy — Art. 13 GDPR

**Draft it from `docs/data-protection.md`, not from a checklist and not from a
generator** — that file was read out of the code. The list of things this app
actually does that a generic policy misses — processed-but-not-stored IP
addresses, the raw webhook bodies, the assistant/companion split and the rest —
is in [`references/gdpr.md`](references/gdpr.md) → *The privacy policy*. Read
that section in full before writing a word of the policy.

### AGB and Widerrufsbelehrung — only if you are the seller

Whether these are yours at all was settled by `scope` question 1. Who writes
the purchase terms when Digistore24 resells, why terms of USE of the app are
yours either way, and the § 356(5) / § 312j(3) BGB rules for the case where the
user *is* the seller are in
[`references/consumer-and-info-duties.md`](references/consumer-and-info-duties.md)
→ *AGB and Widerrufsbelehrung*.

## 4 · `ai` — the EU AI Act

Skip with one line if `config/ai-chat.json` **and** `config/ai-companion.json`
both say `"enabled": false` **and** the user has built no other AI feature. Ask
that last half; a feature they wrote themselves is in neither file.

### Art. 50(1) — the disclosure. Applicable since 2 August 2026

Check it, do not assume it:

```bash
node run.mjs legal-check      # reports it directly
```

Everything behind that command — where the notice lives and which tests guard
it, why the assistant and a companion are **not the same conversation**, the
bespoke surface `legal-check` cannot see, the provider-or-deployer question,
Art. 4 literacy and the risk class — is in
[`references/ai-act-and-tdddg.md`](references/ai-act-and-tdddg.md). Read it
before reporting anything for this check.

## 5 · `consent` — § 25 TDDDG and marketing

**Start from the shipped answer, which is "none needed", and try to disprove
it.** This app sets three cookies — session, language, theme — all strictly
necessary or set by the user's own click, and ships no analytics, no pixel, no
advertising SDK.

How to disprove it — the two greps (analytics tags, and the embedded video
that catches people out), how to judge a hit, the exact wording of the "no
consent banner needed" finding, and the four-step consent machinery with its
three load-bearing properties for anything that genuinely does need consent —
is in [`references/ai-act-and-tdddg.md`](references/ai-act-and-tdddg.md) →
*§ 25 TDDDG*. Run this check from that section.

## 6 · `rights` — what a person may demand

Mostly verification: this template implements them. Check each, and report the
one that is genuinely open.

The full verification table — which right, which article, where it lives in
this template and the command or test that proves it — plus the export-drift
guard, the deletion carve-out that must be in the privacy policy, the genuinely
open retention question and the one-month answer deadline are in
[`references/gdpr.md`](references/gdpr.md) → *Data-subject rights*. Work
through that table item by item; do not verify from memory.

## 7 · `evidence` — Art. 5(2), accountability

Being compliant is not enough; you have to be able to **show** it. Seven
documents, into `docs/compliance/`, **derived from the code rather than from a
template** — that is what makes them worth having and what a template cannot
do. Which seven, what goes into each and what to derive it from — plus the two
that get got wrong (the Art. 30(5) exemption that never applies to a SaaS, and
the 72-hour clock inside `datenpanne.md`) — are in
[`references/gdpr.md`](references/gdpr.md) → *The evidence pack*. Write them
from that section.

`node run.mjs legal-check` lists which of the seven are missing.

## 8 · `map` — what else could reach you

Five minutes, no building. Answer each with *reaches you / does not reach you
yet / and here is what changes it*, using the `scope` answers.
`docs/compliance.md` §6 has the detail.

The five regimes to answer for — BFSG with its micro-enterprise exemption and
what crossing it means, the DSA contact points that reach even a
micro-enterprise, the Data Act's reach into a SaaS, where NIS2 stops, and the
**FernUSG**, which is the only one of the five that can stop the product being
sold at all — are in
[`references/consumer-and-info-duties.md`](references/consumer-and-info-duties.md)
→ *The map beyond*.

⚠️ **The FernUSG one is not answered with "reaches you / does not reach you
yet".** The other four are thresholds; this one is a fact pattern about what the
app teaches and how it checks, so the answer is *these facts are present, and
here is who decides* — `scope`'s WHAT-is-sold row gathered them.

## The report

Into **`docs/reports/compliance-YYYY-MM-DD.md`**, always, even when everything
passes — "have we already done that?" needs an answer next month. Its shape — the
header above the tally, the sections in their order, the accepted register, the
spoken summary — is [`docs/guidance.md`](../../../docs/guidance.md) → *One report
shape*. Two sections are this skill's own, and they bracket the rest:

- **`## Scope` comes first**, before the findings: the seven answers, dated.
  Everything else in the report depends on them, which is why they are above and
  not in an appendix.
- **`## Still needs a human` comes last** — the honest list, drawn from the STOP
  section below. It is not `## Open`: `## Open` is work somebody here could do and
  has not, this is work nobody here may do at all.

`## Fixed in this run` is called **`## What was built`** here, because that is what
a fix looks like in this domain: files created, pages filled, purposes declared.

⚠️ **This skill has never named a `compliance-accepted.md` register**, unlike the
three gateways — an accepted risk here has only ever been a row in the report
itself, with the shared table and the shared rules. So a later run does not find
it by looking anywhere but the previous report, which is worth knowing before
somebody trusts a clean one.

## STOP — get a lawyer, not a better prompt

Prepare these, do not decide them:

- **AGB, the right of withdrawal, and anything about tax.**
- **Special categories of data** (health, beliefs, biometrics, trade union
  membership) — Art. 9, and a different regime.
- **Data about children.**
- **Anything the map calls high-risk under the AI Act** (`scope` question 6).
- **A companion that advises on health, money or law** (`scope` question 7).
  Three different regimes wearing one word — Art. 9, possibly Annex III, and
  professional liability the AI Act does not govern at all. Mark it, prepare
  what the app actually sends and stores, and hand the question over.
- 🚨 **A sectoral licence for what is being SOLD** — this list used to know none,
  and the one this template can walk into by itself is the **FernUSG**. A paid
  course whose learners are mostly not in the room and whose learning outcome is
  monitored — which a `community` room where members ask about the material
  already does — may be Fernunterricht, and that needs ZFU authorisation
  *before* the product may be sold at all; § 7(1) makes the contract void
  without it, in B2B too. Whether it applies here is a lawyer's call and an
  authority's; what this skill does is name the facts it found and hand the
  question over (`docs/compliance.md` §6.5).
- **A suspected data breach.** That has a 72-hour clock on it — go to
  `docs/compliance/datenpanne.md` and to a human, in that order.
- **Any app not established in Germany**, for the national statutes.

And say this once, plainly, at the end of every run: **nothing here is legal
advice.** What it produces is material for a review, and the review is worth
buying — it is cheaper than the letter that comes otherwise.

## Next step

After the compliance gateway: **`go-live`** (which runs `legal-check` in its
pre-flight), then **`go-to-market`**.

If `ux-gateway`, `security-gateway` and `performance-gateway` have not run yet,
they come first: a lawful app that leaks customer data is not a lawful app, and
one whose customers cannot find what they paid for is a refund queue with a
privacy policy on it.
