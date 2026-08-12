<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Which EU rules apply to this app

**This is not legal advice.** It is a map: which regulation reaches an app built
on this template, from when, what it actually demands, and who is exempt. It was
written against the code in this repository, so it can say what *this* app
triggers rather than what software in general might.

Use it to know which questions are yours. Answer the ones with money, liability
or a signature attached with a lawyer.

Two companion files, and neither repeats the other:

- **[`data-protection.md`](data-protection.md)** — the factual inventory. Every
  table holding personal data, everything that reaches a third party, every
  retention window. A privacy policy is drafted from *that* file, not this one.
- **`docs/compliance/`** — the evidence pack for your app, written by the skill
  `compliance-check`. Records of processing, TOMs, deletion concept, processor
  register, AI register.

Dates below are as of **July 2026**. Where something is still in negotiation it
says so — building today on a rule that is not law yet is how you end up with
two migrations.

---

## 0. The question that changes several answers: who sells?

In many Digistore24 setups **Digistore24 is the reseller** — it is the buyer's
contractual partner, and it then carries the parts of the deal that belong to a
seller: the invoice, VAT, the right of withdrawal inside the checkout, the
consumer information at the point of sale.

That does **not** make your obligations disappear. It moves them:

| | You are the seller | Digistore24 is the reseller |
|---|---|---|
| AGB for the purchase | yours | Digistore24's |
| Right of withdrawal at checkout | yours | Digistore24's |
| Invoice, VAT | yours | Digistore24's |
| **Impressum on your app** | **yours** | **yours** |
| **Privacy policy for your app** | **yours** | **yours** |
| **Terms of USE of the app** | **yours** | **yours** |
| **Controller for the data in your database** | **yours** | **yours** |

Read your Digistore24 contract before you let a generator decide this for you.
The two rows people get wrong are the last two: whoever takes the payment does
not thereby become responsible for the account, the chat transcripts or the
token ledger sitting in *your* Postgres.

---

## 1. GDPR

Applies to every app here. There is no small-business exemption from the GDPR
itself — the thresholds people remember (20 employees, 250 employees) belong to
two narrow duties inside it, not to the regulation.

### 1.1 You need a legal basis per purpose, not one for the app

| What the app does | Basis that normally fits |
|---|---|
| Account, sign-in, delivering what was bought | Art. 6(1)(b) — performance of a contract |
| Keeping the order record | Art. 6(1)(c) — legal obligation (§ 147 AO, § 257 HGB) |
| Counting failed sign-ins by IP, rate limits | Art. 6(1)(f) — legitimate interest in securing the service |
| The in-app assistant, as part of the paid product | Art. 6(1)(b) |
| A companion reading what the customer submitted, as part of the paid product | Art. 6(1)(b) — the same reasoning, and it carries further: reading their work IS the thing they bought |
| Analytics, tracking, marketing mail | **Art. 6(1)(a) — consent**, and § 25 TDDDG on top (§ 2) |

**A purchase needs no consent.** This is the single most common mistake in this
space, and it is why this template's thank-you page prompts for nothing: asking
for consent where a contract is the basis makes the processing look revocable
when it is not, and it trains people to click past the one dialog that will
later matter.

### 1.2 What the person may demand, and what this app answers with

| Right | Article | Where it is answered |
|---|---|---|
| Information (what do you hold?) | 15 | `node run.mjs data-export --email …`; the member's own download on `/dashboard/account` |
| Rectification | 16 | the account page; the Operator's user page |
| Erasure | 17 | account deletion — **with the carve-out below** |
| Restriction | 18 | blocking the account; otherwise by hand |
| Portability (machine-readable) | 20 | the same JSON export |
| Objection | 21 | relevant once you add anything on legitimate interest |
| No automated decision alone | 22 | this app makes none — see `data-protection.md` §13 |

**You have one month** (Art. 12(3)), extendable by two with reasons.

**The erasure carve-out is real and it runs the other way from what people
expect.** An order is an accounting record that German law *requires* you to
keep — six to ten years, § 147 AO and § 257 HGB — and Art. 17(3)(b) exempts
exactly that from erasure. Deleting an order on request would be the violation.
So account deletion in this app cascades to sessions, chat transcripts, API
keys, grants and impersonation records, and deliberately leaves `orders` and
`ai_usage` standing with their member link set to `null`. It runs through
`deleteOwnAccount()`, which **takes no id at all** — the account deleted is
always the session's own, which is what makes deleting somebody else's by
mistake impossible rather than merely unlikely.

A running subscription does not stop the deletion either: the dialog **warns
and does not block**. Refusing erasure because it is inconvenient is the
violation — and billing that continues at Digistore24 with no account behind
it is exactly what the warning exists for, which is why that one loud sentence
stays in the dialog.

Say that in your privacy policy in plain words. "We delete everything" is a
promise you cannot keep and did not need to make.

### 1.3 The paperwork — Art. 5(2) is the reason it exists

Accountability means you must be able to *show* compliance, not merely achieve
it. Six documents carry it, and `compliance-check` writes them into
`docs/compliance/` from what the code actually does:

| Document | Article | Note |
|---|---|---|
| Record of processing activities (VVT) | 30 | The exemption in Art. 30(5) almost never applies — it falls away as soon as processing is *regular*, which a SaaS is by definition |
| Technical and organisational measures (TOM) | 32 | This template documents unusually well: scrypt password hashes, SHA-512 IPN signatures, rate limits, `requireOwner()`, no IP storage |
| Deletion concept | 5(1)(e), 17 | The windows live in `lib/cron/jobs.ts`; `node run.mjs cron --list` is the proof they run |
| Processor agreements (AVV/DPA) | 28 | One per recipient — host, mail provider, AI company, Digistore24 |
| Data breach procedure | 33, 34 | **72 hours** to the authority. Write the procedure before you need it |
| Data protection impact assessment (DSFA) | 35 | Usually **not** required for this template's shape; it becomes a question if you add profiling, scoring or special-category data |

Two more that are about people rather than paper:

- **A data protection officer** is required under § 38 BDSG once **20 or more
  people** are constantly occupied with automated processing — or, regardless of
  headcount, if a DSFA is required or you process data commercially for transfer.
- **Third-country transfers** (Art. 44 ff.) arise the moment a processor sits
  outside the EEA. For this template that is routinely the AI company and often
  the host. Standard contractual clauses, or the EU-US Data Privacy Framework
  where the company is certified.

---

**Learning performance is personal data of its own weight.** Where the app
judges what a member did (`activity_results`), it holds data about a
person's *ability* — inventoried field by field in
`docs/data-protection.md` §8b, carried by both subject-access exports,
deleted with the account. A privacy policy for an app with judged elements
names it.

---

**A community changes what kind of data this app holds, in two ways that a
policy written for a plain SAAS app does not cover.** Both are inventoried in
`docs/data-protection.md` §14a–§14e; what belongs HERE is which rules they
reach:

- **Members write things about themselves and to each other.** A profile, a
  post, a private message — the app becomes a processor of content its own
  operator did not author, and it can no longer take a published sentence back
  out of the heads of the people who read it. Art. 15 and Art. 17 both bite
  harder: the exports carry that content, and account deletion has to reach it
  (§14c, §14e).
- **⚠️ Participation itself is personal data.** Presence in a plan-gated room
  discloses a PURCHASE — a member list for "Diabetes-Coaching Premium" is a
  list of who bought it, which is special-category-adjacent in exactly the
  products this template is built for. The app is designed around that: there
  is no roster, no member count, no "who is here" anywhere, and a member
  becomes visible in a room only by posting in it, which is a thing they chose
  to do. **Do not add a member list.** If you do, say so in your privacy
  policy and read Art. 9 first.

**Private messages are the sharpest line in the module** and worth a sentence
in a policy rather than a gesture: readable by their two participants and by
nobody else, enforced by scoped queries and a structural test rather than by
convention, refused even to an operator's own support session. The exceptions
— a subject access request, a participant's own report — are bounded and named
in §14e.

## 2. TDDDG § 25 — reading or writing on the device

The TTDSG was **renamed TDDDG on 14 May 2024**; the substance did not change.

§ 25(1): storing information on a user's device, or reading information already
there, requires **consent** — cookies, `localStorage`, `sessionStorage`, device
fingerprints, all of it.

§ 25(2) exempts what is **strictly necessary** for a service the user explicitly
asked for. There is **no legitimate-interest route here** — unlike Art. 6 GDPR,
you cannot balance your way into it. Either the exception applies or you ask.

**As it ships, this app needs no consent banner.** It touches the device in
**four** places, and every one of them is either strictly necessary or the direct
result of somebody operating a switch:

| What | Where | Why § 25(2) covers it |
|---|---|---|
| the session | cookie `authjs.session-token` | strictly necessary — without it there is no signed-in service to ask for |
| the language | cookie `NEXT_LOCALE` | the user picked it in the sidebar |
| the theme | `localStorage`, next-themes | the user picked it with the toggle |
| the home-screen offer | `localStorage` key `ds24:pwa:v1` (plus a per-tab `sessionStorage` marker that counts a visit once) | it holds "not now" and how often this device has been here, so the notice appears once instead of on every page. Written only as a result of the user's own click, no identifier, never sent anywhere |

That last one is deliberately on the DEVICE rather than on the account, and the
reason is the feature itself: a home-screen icon exists on one device. Somebody
who dismisses the notice on their laptop must still meet it on their phone, and
a column on `users` would silence it exactly where it matters. It is asserted:
`components/install-app.test.ts` fails when a second key appears, or when the
key stops being named in this document.

There is no analytics, no pixel, no advertising SDK — `data-protection.md` §5
states it and means it.

**A banner without tracking is itself a defect.** It trains people to click
"accept" reflexively and it asks for permission you neither need nor use. Do not
add one until you have added something that requires it.

The moment you add analytics: consent must be as easy to refuse as to give
(equally prominent buttons, no pre-ticked boxes), withdrawable at any time
(Art. 7(3)), and the tag must not fire before it is given. `lib/consent/` in
this app records which purpose and which version of which text was agreed to —
a boolean "accepted: true" proves nothing a year later.

Concretely: **declare the purpose in `config/consent.json`**, read it through
`lib/consent/config.ts` and never by re-reading the JSON, and record the answer
with `recordConsent()`. The table is **append-only** — a withdrawal is a NEW row,
never an edit, because the question a supervisory authority asks is what somebody
agreed to *at the time*. And `textVersion` is the load-bearing field: bump it
whenever the wording changes, and every consent given to the old sentence
correctly counts as unasked again. The retention and the table's own shape are in
`data-protection.md` §13.

**In negotiation, do not build on it:** the Digital Omnibus would move the
cookie rules out of the ePrivacy Directive into a new Art. 88a GDPR and drop the
consent requirement for some first-party measurement. That half of the package
was still being negotiated in July 2026 and would not bite before 2027.

---

## 3. EU AI Act

The one this template was silent about until now, and the one with a deadline
inside the next release cycle.

### 3.1 The dates that matter here

| From | What |
|---|---|
| 2 Feb 2025 | **Art. 4 — AI literacy.** Already in force |
| 2 Aug 2025 | Governance, penalties, general-purpose model rules |
| **2 Aug 2026** | **Art. 50 — transparency.** Applies now |
| 2 Dec 2027 | Standalone high-risk systems (Annex III) — **deferred** by the AI Omnibus |

The **AI Omnibus** was adopted by Parliament on 16 June 2026, approved by the
Council on 29 June 2026 and signed on 8 July 2026. It pushed the **high-risk**
deadlines back. It **expressly did not touch Art. 50** — anyone who read
"the AI Act was delayed" and concluded that the chatbot rule moved read the
wrong half.

### 3.2 Are you a provider or a deployer?

The Act splits obligations between the **provider** (who develops a system, or
has one developed, and puts it on the market under their own name) and the
**deployer** (who uses one under their own authority).

Calling an API is not automatically one or the other:

- Embedding a model **as it comes**, without changing its purpose → you are a
  **deployer** of that system.
- Building a product around it under **your own name**, with **your own system
  prompt** and **your own intended purpose** → you are a **provider** of the AI
  system you built, and the model behind it is a component.

**This template lands in the second case for most apps.** The assistant has a
name you chose, a persona in `lib/ai/prompt.ts`, a handbook in
`content/knowledge/` and a purpose you defined — that is a system you offer, not
somebody else's system you happen to use. Assume provider until an advisor tells
you otherwise, because the provider duties are the larger set and assuming the
smaller one is the expensive mistake.

Fine-tuning on your own data, or repurposing a system to something its provider
did not intend, puts you in the provider role beyond argument (Art. 25).

### 3.3 Art. 50 — say that it is a machine

**Art. 50(1)** — a system that interacts with people must be designed so those
people are informed they are dealing with an AI, **at the latest at the first
interaction**, clearly and distinguishably. The exception is where it is
*obvious* to a reasonably observant person.

**Do not lean on that exception here.** An assistant with a human name, a
portrait and a warm tone is precisely the case where it is not obvious.

In this app the notice is one line per surface — `chat.disclaimer` and
`companion.disclaimer` in `messages/de.json` and `messages/en.json` — rendered
by `components/ai-disclosure.tsx` at the top of each, above the transcript, in
every variant. It mounts unconditionally: a notice rendered only "once there
are messages" is one the first interaction never sees, and the first
interaction is precisely when Art. 50(1) demands it.
`lib/ai/disclosure.test.ts` fails the build if either language
stops naming it as an AI, because the realistic way it disappears is not
deletion but a friendlier rewrite, and `node run.mjs legal-check` reports a
surface that is switched on and has no notice.

**A companion owes the notice earlier than the assistant does, and the wording
says so.** "At the latest at the first interaction" is easy to satisfy for a
chat, where the interaction is a question somebody chose to ask. For a companion
the interaction *is* the customer handing over a piece of their work — so the
notice has to be readable **before they write**, not once there is a transcript,
and it says what happens rather than only what it is: a model reads what you
write here.

**Art. 50(2)** — providers of systems that generate synthetic audio, image,
video or text must mark the output in a machine-readable way. This bites if you
build a *content-generating* feature; a support answer to the person who asked
the question is not published synthetic content. The technical marking has its
own transitional period, and **its end date was still moving through 2026** —
the Commission proposed February 2027 and the political agreement shortened it.
Look up where it landed before you
build a generator.

**A companion is inside this question the moment it drafts something the
customer publishes** — a sales page, a post, a chapter. Reading somebody's work
and answering them about it is not that; writing text they then put their name
on may well be. This map stops here: look up where the date landed, and ask an
advisor about the marking rather than assuming either answer.

**Art. 50(4)** — deployers publishing AI-generated text on matters of public
interest, and deepfakes, must disclose it.

**Whatever AI feature you add next, this applies to it too.** The rule is not
"the chat carries a notice"; it is "anything in this app that talks to a person
as a machine says so" — a rule about a *list* of surfaces, and the list is
`DISCLOSURE_SURFACES` in `lib/ai/disclosure.mjs`. Register the new surface
there: adding it to that registry is what makes the test and `legal-check`
notice when its notice goes missing.

🚨 **The list has TWO halves, and both are walked.** `DISCLOSURE_SURFACES` is the
CORE's half — the assistant. **An installed module contributes its own**, through
the `disclosure` field in its manifest; `modules/companion/disclosure.mjs` is the
shipped example. A module declares its own surfaces because only the module knows
it has any, and the core cannot enumerate a feature that is not installed. What
neither half may do is leave one out: `lib/ai/disclosure.test.ts` and
`node run.mjs legal-check` walk **both**, so a module that ships a transcript
without a notice fails the build rather than a regulator's reading.

Each surface mounts `<AiDisclosure surface="…" />` above its transcript,
**unconditionally** — never behind a switch, a role or a "first visit" flag.

**Both surfaces are the same conversation about roles.** §3.2's reasoning —
assume provider until an advisor tells you otherwise — applies at least as
strongly to a companion: it runs on the vendor's own instruction, for the
vendor's own purpose, on the vendor's own subject.

### 3.4 Art. 4 — AI literacy

In force since 2 February 2025, with the penalty regime live from August 2026.
You must ensure a sufficient level of AI competence among the people who operate
AI systems on your behalf.

There is no prescribed curriculum. What is expected is **documented measures
proportionate to the role**: what training, for whom, when, and some check that
it landed. If you are a solo operator this is short — but "short" is not the
same as "absent", and the document is the whole point.

`compliance-check` writes `docs/compliance/ki-kompetenz.md` for it.

### 3.5 Risk class

Nothing this template ships is high-risk. The Annex III categories are
employment, creditworthiness, education, essential services, law enforcement,
migration and justice. **If your app scores applicants, assesses credit or gates
access to an essential service, you have left this map** — the obligations
change completely and the deadline is 2 December 2027.

Prohibited practices (Art. 5) have applied since February 2025: social scoring,
emotion recognition at work or school, manipulative techniques exploiting
vulnerability.

---

## 4. DDG § 5 — the Impressum

The **TMG was replaced by the DDG on 14 May 2024**. Provider identification is
now § 5 DDG; a template still citing § 5 TMG is citing a repealed act.

Required, easily recognisable, directly reachable and always available: name and
legal form, address (**no PO box**), email **and** a second fast contact route,
register and number where applicable, VAT ID under § 27a UStG where held,
supervisory authority for regulated trades, authorised representatives.

§ 18(2) MStV adds a responsible person for journalistic-editorial content — a
blog on your marketing pages can reach this.

**The app is a separate digital service from your marketing site.** It needs its
own Impressum, linked from every page. That is what the footer is for.

**On the pages, the footer LINK is the whole answer — do not copy the
Impressum's text into page footers.** "Easily recognisable, directly
reachable" is satisfied by a link named Impressum, one click away, on every
page; an inlined copy is a second copy that drifts. The one place the
*content* has to travel along is **the mails** (`lib/email.ts` puts it below
the footer links automatically): a mail sent in the course of business is a
business letter, and the recipient holds no footer to click — see
[`docs/auth-setup.md`](auth-setup.md) → *What the mails look like*. Two
surfaces, two rules; neither transfers to the other.

---

## 5. Consumer law

Relevant where **you** are the seller; where Digistore24 resells, the checkout
duties are theirs (§ 0).

- **Right of withdrawal**, 14 days. For digital content it lapses early only
  with the consumer's express consent *and* their acknowledgement that they
  thereby lose it (§ 356(5) BGB). Digistore24's checkout collects this when it
  is the seller.
- **The order button** must be labelled unambiguously — "zahlungspflichtig
  bestellen" or equivalent (§ 312j(3) BGB). A button reading "Weiter" is not a
  contract.
- **Terms of use of the app** are yours regardless of who takes the money. What
  the subscription covers, what happens on non-payment, what you may do with the
  account — none of that is in Digistore24's purchase terms.

---

## 6. The map — what else can reach you

Not built into this app, because whether they apply depends on facts no file in
this repository knows. `compliance-check` asks for them.

### 6.1 Accessibility — BFSG / European Accessibility Act

**In force since 28 June 2025.** The standard is EN 301 549, which points at
**WCAG 2.1 level AA**.

**The exemption that decides it for most operators here:** § 3(3) BFSG —
*"Absatz 1 gilt nicht für Kleinstunternehmen, die Dienstleistungen anbieten oder
erbringen."* A SaaS is a service, so a micro-enterprise offering one is out of
scope. Micro-enterprise means **fewer than 10 people** and **turnover or balance
sheet total of at most €2 million**.

Note what that means going the other way: **cross either threshold and you are
in**, with your whole customer-facing interface — sign-up, checkout, the app —
measured against WCAG 2.1 AA. That is a project, not a checkbox, and it is worth
knowing about a year before it applies to you rather than a week after.

The exemption is for *services*. It does not extend to products.

**Interactive elements raise the stakes here** (`modules/activity/` — a game, a
check, a graded exercise). A page of text can fail WCAG gracefully; an exam
a keyboard cannot finish is not degraded, it is closed. If the app carries
elements, the keyboard-only playthrough in `ux-gateway` §7 and the skill
`learning-activities` (item `check`) are the audits — and they are worth
running even inside the § 3(3) exemption, because "your paying customer
cannot take the test" is a refund and a review long before it is a statute.

### 6.2 Digital Services Act

Applies to intermediary services. An app that merely stores its own customers'
data for them is at the edge of this; one that lets users publish or share
content to others is a **hosting service** and inside it.

Two duties reach **every** intermediary, micro-enterprises included:

- a **contact point for users**, which may not be a chatbot alone, and a stated
  language;
- a **contact point for authorities**.

Terms-of-service transparency about content moderation follows if you moderate.
**Annual transparency reports start at 50 employees and €10 million turnover** —
below both, you are out of that one.

### 6.3 Data Act

Applicable since 12 September 2025. The part that reaches a SaaS is Chapter VI:
**switching between data processing services** — contractual terms, notice
periods, and helping a customer move their data out. Relevant if you sell to
businesses who will ask about exit.

### 6.4 NIS2

Sectoral and size-gated. A small SaaS is normally outside it. If you sell into
critical infrastructure, ask.

---

## 7. What this app already does for you

Not a substitute for the checks — a starting position, and better than most:

- **No tracking, no profiling, no automated decision-making, no advertising
  SDK.** The cleanest possible starting point under § 25 TDDDG.
- **The data inventory exists and is current** —
  [`data-protection.md`](data-protection.md), written from the code.
- **A subject access request is one command**, and the member can produce their
  own from `/dashboard/account`.
- **Retention runs by itself**: IPN payloads 60 days, AI usage 12 months,
  impersonation records 12 months, address changes 24 hours, IP addresses 15
  minutes and never stored. `node run.mjs cron --list` proves it — *"last run:
  never"* means the sentence you published is not describing your app.
- **Passwords are never readable**, by anybody, including you.
- **Operator access to a customer account is recorded** and the customer can be
  told — `data-protection.md` §12. And where the app has a community, that
  access stops at the private messages: the support session finds no
  direct-message surface at all, which is a stronger statement than a log entry
  (§14e).
- **The AI assistant is sent nothing about the person** — no name, address,
  balance or purchase history. That is about **her**. A companion is the other
  case and is given exactly the fields its entry names, one at a time; the
  standing rule is in the skill `guardrails` and the inventory is
  `data-protection.md` §8a.

The gaps are the honest half of the same list, and `compliance-check` walks
them: the legal pages ship as placeholders until you fill them, nothing deletes
an order once its retention period ends, and whether you are a micro-enterprise
is something only you know.

---

## 8. Where the work happens

```bash
node run.mjs legal-check    # what is still missing or still a placeholder
```

The skill **`compliance-check`** is the guided path: it works out which of the
above reach your app, fixes what can be fixed in code, writes the evidence pack
into `docs/compliance/` and leaves a dated report in `docs/reports/`.

**None of it is legal advice, and none of it makes a lawyer unnecessary** for
the AGB, the right of withdrawal, tax questions, special categories of data, or
any app that has left this map at § 3.5.
