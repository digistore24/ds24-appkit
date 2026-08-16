<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# What this app stores about people

**This is not legal advice.** It is a factual inventory, written so that whoever
drafts your privacy policy — a lawyer, a generator, or the `compliance-check`
skill — is working from what the code actually does instead of guessing. Every
row below was read out of `db/` and `lib/`, not remembered.

Keep it current. A privacy policy is only as true as the list it was written
from, and this file is that list.

## 1. Accounts

| Where | What | Why it exists |
|---|---|---|
| `users` | email, name, profile image (OAuth only), role, sign-up date | The account itself. The address is also the sign-in credential. |
| `users.passwordHash` | a scrypt hash — **never** the password | Optional password sign-in. One-way; nobody, including the operator, can read it back. |
| `users.checkoutToken` | 10 random characters | Corroborates the member id inside the Digistore24 checkout. Not a credential, tied to no person beyond the account. |
| `users.blockedAt` | timestamp | When the operator blocked the account. |
| `accounts` | OAuth provider tokens (only if Google sign-in is enabled) | Lets Google sign-in work. |
| `sessions`, `verificationTokens` | Auth.js bookkeeping | Sign-in links and their single use. |

## 2. The address change

`email_changes` holds one row per Member with a change in flight: the member id,
**the address they asked to move to**, a SHA-256 of the confirmation token, and
two timestamps.

Two things about it worth saying out loud in a privacy policy:

- **The target address may belong to somebody else.** It is typed by hand, so a
  typo puts a stranger's address in this table — somebody who never used the app
  and never agreed to anything. That is why the row is deleted as soon as it
  expires (24 hours), and why expired rows anywhere in the installation are
  cleared on the next request rather than waiting for a scheduled job.
- **The token is stored hashed**, so a database dump yields no working
  confirmation links.

## 3. Purchases and billing

| Where | What |
|---|---|
| `orders` | buyer email, first and last name, amounts, currency, Digistore24 order/purchase ids, status, `is_gdpr_country`, and the member it belongs to once attributed |
| `subscriptions`, `invoices` | billing state and Digistore24-hosted invoice links |
| `token_accounts`, `token_ledger` | prepaid balance and every movement of it |
| `grants` | which plan a member holds, and where it came from |
| `ipn_events` | **the complete raw webhook body from Digistore24, buyer data and all** — kept for diagnosing a rejected or mis-signed webhook |
| `buy_url_cache` | checkout links; no personal data |

**`ipn_events` is pruned after 60 days, automatically.** It is the one store
here that exists purely for diagnosis, so it is the one with a short life. The
app deletes them itself — a daily job, `prune-ipn-log` in `config/cron.json`
(`docs/cron.md`), with `node run.mjs db-prune-ipn` still available for the case
where you want them gone and the app is down.

⚠️ **The retention promise in your privacy policy is only as true as that job.**
It runs by itself and it records every run, so `node run.mjs cron --list` is how
you check rather than assume. `last run: never` means the sentence you published
is not describing what your app does.

### Operator notes are personal data too

`grants.note` and `token_ledger.note` hold **free text the operator wrote about
a customer** — "comped, angry on the phone" — and `grants.granted_by` records who
wrote it. The app deliberately never shows **these** to the customer
(`lib/entitlements/leak-guard.test.ts` enforces it), and that is a product
decision about tone, **not** a data-protection exemption: a data subject asking
what you hold about them is asking about these too. Write them as if they will
be read out.

## 4. Sign-in security data

**IP addresses.** Failed password sign-ins are counted per originating IP
(`X-Forwarded-For`) to stop one password being tried across many accounts. The
address is held **in memory only, for fifteen minutes**, is never written to the
database, and is used for nothing else. Nothing is logged.

This still needs to appear in a privacy policy: an IP address identifies a
person, and "we do not store it" is not the same as "we do not process it". The
basis that normally fits is a **legitimate interest in securing the service**,
and the honest description is short — *"failed sign-in attempts are counted by
IP address for fifteen minutes to prevent password guessing; the address is held
in working memory only and is not stored."*

Sign-in attempts by *address* are counted the same way, as are requests to change
an address (see `lib/rate-limit.ts` for all of it).

## 4a. The app's own error window

**Redacted log lines.** A deployed app keeps the last **500 lines / 64 KB** of
its own `stderr` in working memory (`lib/diagnostics/capture.ts`), so that
`node run.mjs errors --url …` can report the errors an HTTP 200 hides. It is
never written to the database, never written to a file by this app, and it is
gone the moment the process ends — every deploy, crash-restart and
host-initiated recycle empties it.

**Every identifier of a KNOWN SHAPE is removed on the way in, and that half is
structural rather than a promise.** Each line is redacted before it enters the
buffer (`lib/diagnostics/redact.mjs`): email addresses, bearer tokens, this app's
own key prefixes, provider keys, long hex runs, UUIDs, connection strings and
long digit runs are replaced with a class marker. So the process does not hold
the original at any moment — a response cannot leak what was never kept. The
**host's own log keeps the full text**, unchanged: whoever has shell access on
the server sees everything, and only the remote reader gets the safe subset.

🚨 **What that does NOT cover: free text.** A name has no shape a pattern can
find — `Anna Schmidt` is two words — so a message that quotes what somebody
typed (a validation error, a database constraint naming a value) survives
redaction and is readable to whoever holds `DIAGNOSTICS_SECRET` for as long as
the line is in the ring. This is written down rather than fixed because it cannot
be fixed here: the answer is that **error messages do not quote customer input**,
which is a rule for whoever writes the message, not for the redactor. Read the
list above as *what is removed*, never as *nothing personal can be in there*.

Like the sign-in counters above, this still needs a sentence in a privacy
policy: an error message can carry an identifier for the instant it exists, and
*"processing without storing is still processing"*. The honest description is
short — *"the application briefly holds a redacted extract of its own technical
error output in working memory to diagnose faults; it is not stored and
identifiers are removed before it is retained."*

**Who can read it:** whoever holds `DIAGNOSTICS_SECRET`, which lives in the
host's secret storage and in the operator's own `.env` — nothing git-tracked
holds it. Without the secret the endpoint answers 404 with an empty body,
indistinguishable from a route that was never built, which is the shipped
state. `DIAGNOSTICS_CAPTURE=off` removes the collector entirely.

**Why it is in neither Art. 15 export.** It cannot be sliced per person: nothing
in it says which subject a line belongs to, so an export section for it would be
an empty section with a misleading heading. ⚠️ The reason is **that**, not "it
holds no identifier" — see the free-text paragraph above. The ring is a rolling
window in working memory that no request can address by person; that is what
makes the export answer honest, and it is the sentence to repeat if a regulator
asks.

**The health endpoint beside it holds nothing at all.**
`GET /api/diagnostics/health` (`lib/ops/health.ts`, behind the same
`DIAGNOSTICS_SECRET` and the same bodiless 404) answers two questions about the
app's own machinery: did the media store reply, and when did the last payment
notification arrive. What it returns is **counts, closed status codes and one
timestamp** — how many orders fell inside the activity window, how many
milliseconds the store took, the instant of the newest `ipn_events` row. No
email address, no order id, no member id, no bucket name, no connection string,
and never a caught error's message — the codes are a union declared in code
precisely so a driver error carrying a bucket URL cannot travel out on one. It
reads existing rows, stores nothing of its own and keeps no window, so unlike
§4a there is not even a transient extract to describe. It is therefore in
**neither Art. 15 export** and needs no line in a privacy policy of its own; the
underlying rows it counts are already covered by §3 (`orders`) and §12
(`ipn_events`).

🚨 **Whoever adds the NEXT diagnostics surface decides which of those two shapes
it is, and writes the answer into this section.** There are only two: it holds a
transient extract of somebody's data (the error window — a policy line, no
export), or it holds nothing of its own and only counts rows something else
already declares (the health endpoint — neither). A third shape is not a variant
to be invented in a route handler; it is a change to this document first.

## 5. Who else sees this data

An operator needs a data processing agreement with each of these. They are
processors acting on the operator's behalf, not independent controllers — except
Digistore24, whose role depends on your contract with them, **and the last row,
which is not a processor at all**: other customers are third parties, and a
disclosure to them is a disclosure, not a processing arrangement.

| Recipient | What reaches them |
|---|---|
| **Digistore24** | Everything about a purchase. Where they act as **reseller**, they are the buyer's contractual partner and a controller in their own right for parts of it — check your contract, it changes what your policy has to say. |
| **The mail provider** (Postmark or your SMTP host) | Recipient address and the content of every sign-in link, confirmation link and credential notice — and, where a feature uses the operator channel, the **operator's** own address and the operational message sent to it (§11a). That last one is the operator's data rather than a customer's, and it is listed because a processing agreement covers the address either way. |
| **The host** (Railway, Render, Fly, …) | Everything, by virtue of running the database and the app. |
| **An AI company** — only with the AI **assistant** switched on | What a member types into the chat, plus the handbook. No name, address, balance or purchase. **Which company it is, is the Operator's choice** (`config/ai-models.json`, five candidates, shipped as `"auto"` = whichever key is in the `.env`) — so this row cannot name one for you, and a privacy policy that guesses is wrong for most installations. `node run.mjs ai-check` says which it is. See §8. |
| **An AI company** — only with a **companion** switched on | What the customer wrote, plus the named facts that companion's entry passes it. This is content they PRODUCED, not only a question they asked, and it is the difference from the row above rather than a variation on it. It may be a **different company** from the assistant's — the binding is the `companion` task in `config/ai-models.json`, so an app can have two AI recipients. `node run.mjs ai-check` names both. See §8a. |
| **Your other customers** — only with the **community** switched on | A member's chosen name, their about text and their picture, plus their role badge — and, for a member who has set no profile, the name on their account as a fallback. **This is the only row here that is not a processor**, and it is the reason it must not be left out: everything above is somebody working on the operator's behalf under a contract, while this is a disclosure to other data subjects with no agreement behind it and no way to recall it. Never the email address, never purchases. Absent entirely while the module is off. See §14a. |

No analytics, no tracking pixels, no advertising SDKs ship with this template.
**If you add none, you need no cookie banner** — the only cookies set are the
session, the language choice and the theme, all strictly necessary or set by
your own action.

## 6. Retention — and the one question that was deferred to here

The 2026-07-21 PRD deferred a question to `compliance-check`: unattributed
purchases accumulate for ever, holding a buyer's email and name for people who
never became customers of the app. It framed this as two forces pulling opposite
ways — commercial record-keeping versus the right to erasure.

**For the purchase records themselves, they do not actually pull opposite ways.**
An order is an accounting record, and in Germany §147 AO and §257 HGB *require*
it to be kept (six to ten years depending on the document). The GDPR anticipates
exactly this: the right to erasure does not apply where processing is necessary
to comply with a legal obligation (Art. 17(3)(b)). So an unattributed purchase is
not a deletion problem during that period — it is a mandatory-retention case, and
deleting it on request would be the violation.

What genuinely remains open, and what an operator should decide with advice:

1. **What happens after the retention period.** Nothing in this app deletes an
   order, ever. That is correct for year one and wrong by year eleven.
2. **Whether the buyer's name is needed at all.** `buyer_first_name` and
   `buyer_last_name` come from Digistore24 and the app never uses them for
   anything. Data minimisation asks why they are stored — a fair answer may be
   "the invoice needs them", but it should be an answer, not an accident.
3. **Deletion is solved for the account, not for the aftermath.** A member
   deletes their own from `/dashboard/account` (Art. 17, no support ticket
   needed), and an Operator can delete one from the user list. Both cascade to
   sessions, chat transcripts, API keys, grants, pending address changes,
   consent records and impersonation rows — and both deliberately leave
   `orders`, `subscriptions`, `token_ledger` and `ai_usage` standing with the
   member link set to `null`, for the reason above. The dialog names both halves
   before the button, because "delete my account" reads as "delete everything"
   and here it is not.

   The refusal worth knowing: the **last remaining owner** cannot delete
   themselves. Not a GDPR problem — it is temporary and in their own hands
   (promote somebody, then leave) — but an app with no admin has no way back in.

   What is still open is the same thing as point 1: nothing deletes an order
   once its retention period has actually run out.

Everything else has a shape already: `ipn_events` 60 days, `email_changes` 24
hours, IP addresses fifteen minutes, sessions until they expire, and
`chat_messages` until the account is deleted (§8), `api_keys` likewise (§9).
`ai_usage` outlives the account with its member link removed (§10).

## 7. Answering a subject access request

Somebody writes and asks what you hold about them. You have **one month**
(GDPR Art. 15; Art. 20 adds the right to get it in a machine-readable form).

**Most of the time nobody writes, because they can help themselves.** A signed-in
member downloads their own copy from `/dashboard/account` — the same data, minus
the raw webhook payloads (see the review warnings below: those can carry a third
party's details, and a self-service download has nobody in between to redact
them, which Art. 15(4) cares about). That path is `lib/privacy/export.ts` →
`app/api/account/export/route.ts`. The two exports are held together by
`lib/privacy/export.test.ts`, which compares them section by section, so adding a
table to one and forgetting the other fails the build.

The command below is for the rest: somebody who never had an account, somebody
who asks by email, and the case where you need the payloads too.

```bash
node run.mjs data-export --email kunde@example.de
node run.mjs data-export --email kunde@example.de --out auskunft.json
```

It searches **by address, not by account** — deliberately. The people most
likely to ask are the ones who never got an account: a purchase made without
signing in leaves an order carrying their name and address and no member id at
all. An account-scoped export would have answered "we hold nothing about you"
while holding exactly that. Where an account does exist, both routes are
followed and merged.

**Read the file before you send it.** Four things in it need your eyes:

- **`webhookEvents[].payload`** is the raw body Digistore24 posted, and it can
  carry fields about *other* people — an affiliate, for instance. Third-party
  data has to come out before the file leaves your hands.
- **`grants[].note` and `tokenLedger[].note`** are what *you* wrote about this
  person. They belong in the answer — the app hides them from the customer's own
  screen as a matter of tone, and that is not an exemption from a legal request.
  Read them before they are read to you.
- **`communityPosts[].content` and `communityPosts[].removedReason`** — the
  first is text this member wrote for other members to read, and it is the
  larger free-text surface in the app; the second is what a MODERATOR wrote
  about them while removing a post, which is the `grants[].note` case with a
  sharper edge. Posts routinely name other members by their community display
  name; a removal reason routinely quotes what was said. Both need the same
  third-party pass as the payloads.
- **`chatMessages[].content`** is what they typed into the assistant **or into a
  companion** — the table holds both, told apart by `conversation_id` (§8a).
  Same redaction rule as the payloads, and the companion half is the larger
  case: people paste things into a chat box that nobody asked for, and a
  companion asks them to hand over a whole piece of work, which routinely names
  somebody else.

Deliberately not in the file: the password (a one-way hash nobody can read back,
and handing over a credential creates risk rather than satisfying a right),
OAuth tokens, and spent sign-in tokens. The file says so itself, in an
`aboutThisFile` block written to be forwarded along with it.

## 8. The AI assistant

Only relevant if the in-app chat is switched on — `config/ai-chat.json`
(`"enabled"`) plus a key for whichever provider her `chat` task resolves to.
**Name that company in your privacy policy**: it is the recipient of the data,
and with the shipped `"auto"` binding it is decided by which key is in the
`.env` rather than by anything in this file. `node run.mjs ai-check` says which
one it is. **It was the first feature in this
template that sends customer input to a third party outside the payment and mail
path, so it needs a paragraph in your privacy policy of its own.** It is no
longer the only one — a companion (§8a) sends more, and sends what the customer
wrote rather than what they asked.

| Where | What |
|---|---|
| `chat_messages` | every question a member typed and every answer she gave, with the member id and a timestamp |
| `chat_messages.links` | for an answer that pointed at content: the in-app page paths and page titles it linked to (`[link:/dashboard/…\|Lektion 3]`). Part of the row, and it travels with it everywhere below: the export, the deletion, the retention. **In the shipped template it holds nothing personal** — the paths are this app's own routes and the titles its own headings. ⚠️ It holds whatever a registered content source calls a hit, so an app whose content is titled by or after its members (a submission, an uploaded document, a discussion subject) puts THAT in here — check your sources' titles before repeating the first sentence in a privacy policy |

**What leaves the app, and what does not.** Each question is sent to the
provider bound to the `chat` task together with the previous few turns of the
same conversation and the handbook from `content/knowledge/`. Deliberately
**not** sent: name, email address,
balance, orders, plans, role — nothing about the person. That is why the
assistant is told she cannot see the account (`lib/ai/prompt.ts`), and it is
also the answer when a customer asks whether "the AI can see my data". It cannot.

What a *member* puts into the box is another matter, and it is the risk worth
naming in your policy: people paste order numbers, addresses and occasionally
things nobody asked for. That text is stored in `chat_messages` and was sent to
the API.

**Retention.** Transcripts are kept until the member's account is deleted, and
go with it (`on delete cascade` — unlike orders, which are accounting records
that must be kept). There is no automatic pruning; if you want one, it belongs
next to the IPN-log prune (`node run.mjs db-prune-ipn`) and is a decision to
make deliberately rather than to inherit.

**That company's own terms are yours to read.** All five candidates state that
API traffic is not used to train models, but the retention that applies to it is
set by *your* agreement with *them* — and four of the five (OpenAI, Anthropic,
Gemini, OpenRouter) are in the USA, so the transfer needs the usual basis
(standard contractual clauses, or the EU-US Data Privacy Framework where the
company is certified). Mistral is in France, which is the one case where no
third-country transfer arises at all. You need a data processing agreement with
whichever one you use, exactly as with the mail provider — `avv-register.md`
under `docs/compliance/` is where `compliance-check` writes the list down.

**Switching it off removes all of it.** An app that leaves `"enabled": false`
sends nothing, stores nothing and needs none of the above in its policy.

## 8a. A companion (an AI that reads what the customer wrote)

> **Why 8a and not 9.** The numbers in this file are referenced from eight places
> outside it. Renumbering would have to move every one of them by hand, and
> nothing checks that it happened.

Only relevant if a companion is switched on — `config/ai-companion.json`
(`"enabled"`) **and** at least one entry in `modules/companion/companions.ts`. It ships off
and the registry ships empty, so an app that has not built one has none of this.
`node run.mjs legal-check` reports the switch.

**This is not §8 with a different name, and the difference is the thing to put
in your policy.** The assistant answers questions out of a handbook and is told
nothing about the person. A companion is the opposite case by construction: it
reads what your customer **produced** — their submission, their draft, their
plan — and it is given named facts about them, because it is worthless without
them.

| Where | What |
|---|---|
| `chat_messages` | the same table as the assistant's transcripts, told apart by `conversation_id`: `NULL` is the assistant, a value is a companion's, keyed `<companion>:<subject>` |

That it is the same table is the reason there is no second rule anywhere: the
deletion cascade in §6 and both export paths in §7 carry companion turns
unchanged, because Story 13.2 added a column and not a table.

**What leaves the app.** Three things, and the second is what makes this section
necessary:

1. the companion's `instruction` from its entry — your words, not the customer's;
2. **the named facts that entry's `load()` returned, one field at a time** —
   this is the list of personal data that reaches a third party, and it is
   readable off the code rather than remembered, because the entry *is* the call
   site;
3. **the customer's own text**, fenced as content so the model treats it as
   material to answer about rather than as instruction.

Deliberately **not** sent: anything the entry did not name. There is no member
id in the call and no way for it to fetch more for itself — the rule is in
`guardrails`, and two files are written so a call site cannot break it:
`lib/ai/customer-text.ts` holds the fence and the "one field at a time" shape
(core, so any caller reaches it — an activity's `grade()` as much as a
companion), and `modules/companion/companion.ts` is the three-line binding that
hands the result to `runTask`.

**To whom.** The company bound to the **`companion` task** in
`config/ai-models.json` — which may be a **different company from the
assistant's**, because they are separate tasks. An app can therefore have two AI
recipients, and a privacy policy that names one may be naming the wrong one.
`node run.mjs ai-check` prints both. The third-country reasoning, the data
processing agreement and the "not used for training" question are the same as
§8's — read that paragraph against whichever company answers this task.

**How long.** The same as the assistant's, and for the same reason: turns are
rows in `chat_messages`, so they are kept until the account is deleted and go
with it (`on delete cascade`). **There is no automatic pruning**, and a policy
that promises a window it does not implement is worse than one that promises
nothing. If you want one, it is a `prune-` job in `lib/cron/jobs.ts` with a
`retentionMonths` in `config/cron.json`, on the pattern §10 describes for AI
usage — and `node run.mjs legal-check` then reports it if it has never run.

**What a customer hands over is bigger than what they type into a chat.** §7's
redaction note applies here with more force: a submission routinely names other
people, and a companion asks for a whole piece of work rather than a question.

**Switching it off removes all of it.** `"enabled": false` — the shipped state —
sends nothing, stores nothing, and needs no paragraph in your policy.

## 8b. Interactive elements — learning performance

An app built on this template can carry interactive elements — a learning
game, a check, an exercise (`modules/activity/`). What a member does on one is
stored in `activity_results`, and it should be named for what it is: **data
about a person's ability.** A score on a test says more about somebody than
their invoice address does, and an employer who paid for the course will
eventually ask for it — the answer to that request is the vendor's decision,
not an export default, which is why nothing in this template shares these
rows with anybody but the member themselves.

| Column | What it holds |
|---|---|
| `member_id` | whose performance this is (cascades on account deletion) |
| `activity_id`, `subject` | which element, on which unit — the app's own slugs |
| `state` | the resume point the server stored — the member's own work in progress |
| `score`, `max_score` | the verdict's numbers, `NULL` while nothing was judged |
| `passed` | the judgement — `NULL` is "not judged", which is not "failed" |
| `attempts` | finalised tries |
| `started_at`, `updated_at`, `completed_at` | when the first submission was recorded, the last write, and the first time they got through |

**Retention: until the account is deleted, like the transcripts (§8).** The
cascade removes every row with the member (`modules/activity/schema.ts` says why
it is `cascade` and not `set null`: this is not a financial record). Both
subject-access exports carry the table — the member's own download and
`node run.mjs data-export` — including `state`, because the server's record
of their work is their work.

## 8c. The course — progress, and what a member handed in

Only relevant if this app has the `courses` module (`node run.mjs module list`).
It stores two things about a person, and they are not of the same kind. How far
somebody got is a set of slugs and dates. What they handed in is **unpublished
prose a person wrote**, read by one other person and answered by them — not a
machine-written resume point, not a score. `docs/courses.md` keeps the two apart
deliberately and this file has to as well: a hand-in in an accompanied workshop
routinely names the member's own circumstances, their work, and other people.

| `courses_completions` | What it holds |
|---|---|
| `member_id` | whose progress this is (cascades on account deletion) |
| `unit_slug` | which lesson — the app's own slug, never a foreign key |
| `completed_at` | when they marked it done |

| `courses_submissions` | What it holds |
|---|---|
| `member_id` | who handed it in (cascades on account deletion) |
| `unit_slug` | which lesson it belongs to |
| `body` | **what the member wrote** — the text itself |
| `submitted_at` | when it arrived, or when it was last revised |
| `reply` | what the operator wrote back, addressed to this person |
| `replied_at` | when it was read and answered — `NULL` while it is still waiting |
| `replied_by` | **who** answered: the operator's or coach's account |

**Both subject-access exports carry the member's own rows** — the download from
`/dashboard/account` and `node run.mjs data-export` — including `body`, `reply`
and `replied_at`. The answer was written to this person and belongs to them.

⚠️ **`replied_by` is in neither of them, and that is a decision rather than an
omission.** It is the identity of a **third party**, and Art. 15(4) says the
right of access must not adversely affect the rights of others — in a workshop
with several coaches it would name somebody the member has never met. It is the
same reason the raw Digistore24 webhook bodies stay out of the member's own copy
(§4). The column is not secret: it exists so that the record of who read
somebody's text survives a coach leaving, which is why it is `set null` rather
than `cascade`.

**Retention: until the account is deleted, and then completely.** There is no
window and no archive. Both tables carry `member_id … on delete cascade`, so
every completion and every hand-in — answered or not — goes with the `users`
row; the reply leaves with the hand-in it was written on. `eraseFor()` in
`modules/courses/module.ts` empties `body` in the same transaction, immediately
before the cascade fires, so that a later change letting a hand-in outlive its
author cannot let the text outlive them with it. `courses.accountDeletionNote`
is the sentence a member reads above the delete button, and it says exactly
this.

## 9. The HTTP API

Only relevant if this app has the `api` module (`node run.mjs module list`) —
and then only once it is switched on, `config/api.json` (`"enabled"`). See
`docs/api.md`.

| Where | What |
|---|---|
| `api_keys` | one row per key a member issued to themselves: the name **they** typed ("my phone"), the audience, the scope, when it was created, when it expires, when it was revoked, and the day it was last used |

**The key itself is not in there.** The column holds a SHA-256 of it, and the
plaintext is shown exactly once, in the dialog that created it. Nobody can read
it back — not the operator, not a support screen, not
`node run.mjs data-export`. That is deliberate: a key acts with its owner's
rights, so an operator who could read one could act as that customer.

**The name is personal data**, in the same way `grants.note` is: it is free text
attached to an identified person, so it belongs in a subject access request and
in this list. It is usually the name of a device, which is more than it looks.

**It is in both exports, under the section key `apiKeys`** — the member's own
download from `/dashboard/account` and `node run.mjs data-export` alike
(`modules/api/privacy/sections.ts` and its raw-SQL twin `sections.mjs`; §7).
🚨 **This section is new, and its absence was a defect rather than a decision:**
while the API was part of the core, this file already called the name personal
data and neither export carried the table. Nothing compared the two claims. The
module manifest does — it refuses a module that declares `tables` without a
complete `privacy` block.

What travels is the row as described above **plus the key's prefix**, and what
does not is `token_hash`. The prefix is the fragment already shown on the
account page so a member can tell one row from another, and it is not enough to
be a key; the hash is the credential, and an access request routinely leaves
the building by mail. **⛔ Do not add `token_hash` to either export** — it is
the one real mistake available in that file.

Revoked and expired keys are in the export too: the question is what the app
holds about this person, and a revoked key is a row it still holds.

⚠️ **Neither export asks whether the API is switched on**, and that is the same
ruling §14 records for the community: `config/api.json` is a switch, an export
says what the app HOLDS, and an app that ran the API for a year before setting
`"enabled": false` still holds every key ever minted.

**`last_used_at` is written at most once a minute**, not per call. The question
it answers is "is this key still in use", and a minute's resolution answers it —
an exact value would be a usage log of when somebody works.

**What leaves the app.** Nothing. Unlike the assistant in §8, this surface
calls no third party: the customer's own program connects **to** your app, and
what it does with the answer is its owner's business — the same member the key
belongs to.

**Retention.** Keys go with the account (`on delete cascade`), like the chat
transcripts and unlike the orders. A revoked key keeps its row rather than being
deleted, so a member can still see that it existed and when they revoked it.

**An app that never had the module has none of this** — no table, no endpoint,
no keys, and nothing to write in its policy; the same goes for one that
installed it and left `"enabled": false` from the start. **Switching it off
afterwards is a different sentence and not this one:** it stops the endpoint,
it deletes nothing, and the keys minted while it ran are still held and still
answerable.

## 10. AI usage (the cost record)

Only relevant if a task uses a model — today that is the assistant (§8). See
`docs/ai-providers.md`.

| Where | What |
|---|---|
| `ai_usage` | one row per model call: which task, which provider, which model, token counts, how long it took, whether it worked, and the member it was made for |

**It holds no content.** No prompt, no answer, nothing a member typed. That is
structural rather than a promise — there is no column that could carry one. What
was said is stored where it belongs: `chat_messages` for the assistant (§8), your
own tables for anything you build.

**Why the member is on it at all.** So an Operator can see which customer's use
drives their AI bill — the number their own pricing depends on. It is the only
personal reference in the table, and it is what puts these rows in a subject
access request: they record a person's activity, with timestamps, even though
they say nothing about what that person said.

**The AI-costs page does not show it.** `/dashboard/admin/ai-costs` reports
spend by task, by model and by day, and has no member column at all — turning a
cost report into a per-customer activity log is not something the Operator asked
for, and it is the one addition here that would need a paragraph in a privacy
policy. The link stays on the row for the export and for the deletion rules
below; nothing renders it.

**Retention differs from the chat on purpose.** A chat transcript goes with the
account (`on delete cascade`); an AI-usage row **stays and loses its member
link** (`on delete set null`), like an order. What the Operator spent is their
own accounting record and does not stop being true when a customer leaves. An
export made after a deletion therefore correctly finds none.

**This is the first table that grows with USE rather than with customers** — one
row per model call, for ever, so it is the one with an automatic retention
window. **Rows are deleted after 12 months**, by a daily job the app runs
itself: `prune-ai-usage` in `config/cron.json` (`docs/cron.md`). Change the
window by changing `retentionMonths`; `node run.mjs db-prune-ai --dry-run` shows
what a different one would remove before you commit to it, and works with the
app stopped.

⚠️ **Pruning deletes cost history.** A period that has been pruned reads as
**zero** on the AI-costs page rather than as unknown. Twelve months is chosen so
a year-on-year comparison stays possible; shortening it is a data-minimisation
gain and an accounting loss, and it is the Operator's call which matters more.

**Nothing leaves the app because of this table.** It is written locally and read
locally. What does leave — the prompt itself — is §8's business, and which
company receives it is now the Operator's choice rather than a fixed one; the
answer lives in `config/ai-models.json`.

## 11. The scheduler's own record

`cron_runs` — one row per scheduled job: when it last ran, whether it worked,
and a one-line summary of what it did.

**It holds no personal data, and that is a rule rather than an observation.** A
job's summary line is a COUNT and a window ("412 rows older than 12 months"),
never a row, an address or anything a member typed. `docs/cron.md` states it
where whoever adds a job will read it, because a job that logged *which*
customers it touched would put personal data into a table that is otherwise free
of any privacy question.

It is worth a sentence in a privacy policy for the opposite reason to most of
this file: it is the **evidence** that the retention promises above are kept.
`node run.mjs cron --list` answers "is the 60-day deletion actually happening",
and without it the honest answer would be "probably".

## 11a. The send marker

> **Why 11a and not 12.** Same reason as 8a: the numbers in this file are
> referenced from outside it, and renumbering would have to move every reference
> by hand with nothing checking that it happened.

`notification_sends` — one row per operational message this app has already sent
its **operator** (`db/schema-notify.ts`). It exists because cron rule 1 says a
job must be safe to run twice, and a mail is only safe to send twice if the job
recorded that it sent one.

| Column | What it holds |
| --- | --- |
| `key` | what the message WAS, as a label: `ops-watchdog:2026-08-10:9f2a41c7` |
| `claimed_at` | when it was claimed |

**Two columns, and there is deliberately no third.** No recipient, no address,
no member id, no free text, no count. That is the whole design rather than an
economy: a table with nothing personal in it raises no privacy question, which
is why it appears in **neither** subject access route — not in
`node run.mjs data-export`, not in the member's own download — and why nothing
in `lib/privacy/` had to change when it arrived.

**What the shipped operator mail actually contains: counts and states.** The one
job in the core that sends one is `ops-watchdog` (`docs/cron.md`), and it carries
how many security findings are open, how many scheduled jobs failed or stalled,
whether the media store answered, whether payment notifications have stopped, and
how many of its four checks could not be made at all — plus at most one timestamp
per finding. Never a job id, a package, a path, a bucket, a member, an address or
a line somebody typed. So the mail is the operator's own data and a customer's
appears nowhere in it, which is why neither this table nor that message is in an
Art. 15 export: **neither holds an identifier to slice one out by.** The
operator's own address reaching the mail provider is covered in §2.

**The key never names a person, and half of that is enforced.**
`claimSend()` refuses a key that is not `^[a-z0-9][a-z0-9-]*(:[a-z0-9-]+)*$`
and at most 120 characters, which rules out an address and a sentence. It does
**not** rule out a UUID, so the rule is prose and the grammar is only its cheap
half — `docs/cron.md` states it where whoever writes a job will read it.

**There is no pruning job, and that is a consequence rather than an omission.**
Because a key names a piece of work and not a person, the row count is bounded
by (jobs × windows) — a daily digest is 365 two-column rows a year. **The day
that stops being true is the day a key names a person**, and that is precisely
what the rule above forbids.

What the mail itself does mean for a policy is one line in §5: the mail provider
sees the operator's address and the operational message. Nothing about a MEMBER
travels through this channel — a job's message is a count and a link
(`docs/cron.md`, rule 2 by extension).

## 12. Signing in as a user (operator access)

`impersonations` — one row every time an operator used **"sign in as this
user"** on somebody's account.

| Column | What it holds |
| --- | --- |
| `operator_id` | which admin it was. Survives that admin's deletion as `null` — this is evidence, and it does not stop having happened |
| `member_id` | whose account was entered. Deleted **with** the member (`on delete cascade`), because the row is that member's personal data |
| `started_at`, `expires_at`, `ended_at`, `ended_by` | when, until when it was allowed to run, when it actually stopped, and what stopped it |

**This is the section a customer's question lands in.** *"Has anyone from your
company been in my account?"* is a data-protection question with a specific
answer here, and it is the reason the feature is defensible rather than being a
back door: an operator can see what a customer sees, and the customer can find
out that they did.

**What it deliberately does NOT hold is what the operator did while inside.** No
page list, no actions, no keystrokes. That is a decision, not a gap: an activity
log of a support session is a surveillance log of the customer's own data. The
changes that matter leave their own records anyway — `token_ledger`, `grants`,
`email_changes`, `ai_usage`.

**What an operator can do while signed in as somebody** is everything that
person can do, with two carve-outs.

The first: an automatic token top-up is suppressed, so a support session can
never charge a customer's stored payment method (`lib/tokens/spend.ts`).
Anything they *do* spend is debited from the customer's balance and appears in
that customer's own ledger, under the customer's name — which is worth knowing
before you answer a question about a balance.

The second: **the private-message surfaces are not there at all.** No read, no
send, no report — they answer exactly what a switched-off feature answers, so a
support session cannot even establish whether that member has any
correspondence. The rooms are unaffected and behave as the member (§14e says
why the private half is different: what this section records is ACCESS, and
reading somebody's mail changes nothing, leaves no second trace and is
invisible to the one person it is about — so the capability was removed rather
than logged).

**Retention: 12 months**, then the rows are deleted by the scheduled job
`prune-impersonations` (`config/cron.json`). The same window as `ai_usage`.
Shortening it weakens the answer above; there is no legal obligation pulling the
other way, so it is yours to set.

**In a subject access request** it appears as `impersonations[]`, with the
operator's **address** rather than a generic "an administrator" — in a business
with more than one admin, the generic answer is no answer.

**If your installation must not have this capability at all**, set
`"enabled": false` in `config/impersonation.json`. The menu entry disappears and
the server action refuses. The record of sessions that already happened stays
readable, which is the point.

## 13. Consent records

`consent_records` — what a member agreed to, which wording they read, and when.
**Empty in an app that declares no purposes in `config/consent.json`, which is
what ships**, because this app needs consent from nobody: a purchase runs on
Art. 6(1)(b) and the three cookies it sets are strictly necessary or set by the
user's own click (§5). The table exists for the day the app grows something that
does need one — a marketing mail, an analytics tag.

| Column | What it holds |
| --- | --- |
| `purpose` | which question, as declared in `config/consent.json` |
| `granted` | `true` = agreed, `false` = refused **or** withdrawn |
| `text_version` | which version of the wording they read |
| `locale` | which language they read it in |
| `created_at` | when |

**It is append-only.** A withdrawal is a NEW row, never an edit of the old one —
Art. 7(1) asks you to be able to *demonstrate* that consent was given, and a row
you overwrote demonstrates nothing. So the current answer for a purpose is
simply its newest row, and refusals are kept alongside the agreements: a refusal
is the evidence that "no" was honoured, and it is what stops the dialog asking
again tomorrow.

**`text_version` is why a boolean was not enough.** Somebody who agreed to *"we
mail you when your invoice is ready"* has not agreed to *"we mail you offers
from our partners"*. Bump the version when you edit the sentence and every
consent given to the old one correctly counts as unasked again.

**No IP address, deliberately.** Consent logs in the wild routinely store one
"as proof"; it proves very little, this app stores none anywhere (§4), and
Art. 7(1) does not ask for one. Adding it would introduce a new category of
personal data in the name of data protection.

**Retention:** goes with the account (`on delete cascade`), like the chat
transcripts and unlike the orders. Once the person is gone, so is the processing
their consent permitted, and keeping the record would be keeping personal data
for its own sake.

It appears in a subject access request as `consents[]` — in both exports.

## 14. Uploaded and generated files

Only relevant once the app takes files — `config/media.json` decides who may
upload what. See `docs/visuals.md`.

| Where | What |
|---|---|
| `media` | one row per stored picture, video, recording or downloadable file: what kind it is, its media type, its size, **the filename the person chose**, the alternative text, and when it arrived. For a generated image also the prompt and which model made it |
| the bucket | the file itself. Object storage, outside this database — see §5 for the recipient |

**The filename is personal data.** Somebody typed it, and people name files
after themselves, their company or their customer. It is in both exports.

**Location and camera data are removed from uploaded images.** A photograph
taken on a phone carries where it was taken to within a few metres, and nobody
looking at the picture can tell it is there. JPEG, PNG and WebP are stripped on
the way in (`lib/media/exif.ts`).

**And an image format that cannot be stripped is not accepted**, which is what
keeps the sentence above true rather than approximately true. GIF is the case
that exists today: its metadata sits in Comment and Application Extension
blocks that `exif.ts` does not walk. Adding `image/gif` — or any other
unstrippable type — to `config/media.json` does not quietly widen what this
page promises: the type is dropped from the accepted list, an upload of one is
refused, and `node run.mjs media-check` names it. **Files already stored are
left alone**, so a config mistake never makes existing pictures unreachable.

**And the same sentence is why an image cannot take the direct route to the
bucket.** Since the browser may write large files straight to storage
(`docs/visuals.md`), there is a path on which the bytes never enter this
process — and stripping needs the whole file in hand. So that path refuses
`image` outright, and it refuses it at the object's own first bytes rather than
at what the upload form claimed: a file offered as a video and recognised as a
JPEG is removed from the bucket rather than recorded. The promise above
therefore holds for every stored image, not for most of them.

**And it holds for as long as the file is stored, not only for the moment it
was checked.** A presigned upload address stays writable until it expires, so
"we looked at the bytes" would be a statement about one instant if the address
pointed at the file the app later serves — push a JPEG onto it afterwards, and
the app would be hosting an unstripped photograph behind a row that says
`video/mp4`. It does not: the browser writes to a staging key, the app copies
the object it checked onto the delivery key, and a reused address reaches
something nothing reads and the nightly sweep removes.

**A file that arrives damaged is refused rather than stored half-stripped.** If
the walk cannot parse a JPEG, PNG or WebP it cannot promise anything about what
is left in it, so the upload is rejected with "that file looks damaged" instead
of being stored with its metadata possibly intact. That refusal is the reason
the promise on this page holds for every stored image and not merely for the
well-formed ones.

⚠️ **Video is not stripped, and a privacy policy written from this file must not
claim otherwise.** An MP4 can carry its recording location in a metadata atom.
Removing it means walking the atom tree and rewriting the offsets that depend on
it, and a half-done job is worse than none because the file then reads as
protected. If your app takes video from customers, either say so or do not take
it.

**Retention.** A file goes with the account that uploaded it — both the
visibilities that make an item a PERSON'S rather than the product's:
`visibility: "owner"` (what they uploaded for themselves) and
`visibility: "members"` (the face they showed other members, § 14a). Deleting an
account removes **the objects from the bucket as well as the rows** — a foreign
key cascade only reaches the database, and files left behind would be a deletion
request that was not honoured (`lib/media/manage.ts` → `deleteOwnedMedia()`,
whose set is `OWNED_MEDIA_VISIBILITIES` in `lib/media/rules.ts`).

Files that belong to the PRODUCT rather than to a person — a lesson cover, a
workbook you sell — stay when the operator account that uploaded them is
deleted. That is why the foreign key is `set null` and not `cascade`.

It appears in a subject access request as `media[]` — in both exports. The files
themselves are not in the JSON; the member downloads them from the app.

## 14a. The community profile

Optional twice over, and the two are worth naming separately because the export
below turns on the difference. The community is a **module**
(`node run.mjs module add community`), and the module then has a **switch**
(`config/community.json` ships `enabled: false`). An app that never installs it
has no such table; an app that installs it and never switches it on has the
table and nothing in it. Either way that is a property worth stating in a
privacy policy rather than glossing — this section describes something a lot of
installations simply do not have.

| Where | What |
|---|---|
| `community_profiles` | the name a member chose to appear under, the text they wrote about themselves, a reference to the picture they picked, and when the profile was created and last changed |

**One row per member at most** — the table is 1:1 with `users` and keyed by the
member id itself, so there is no separate profile identifier and no way for a
second profile to exist for one person.

**All of it is self-authored and member-facing by design.** Unlike an operator
note (§3), nothing here is written *about* somebody by somebody else: a member
types their own name and their own sentence, and the whole point of the table is
that other members see it.

**What a profile page shows, stated exactly** — an earlier version of this
section claimed "nothing from the account", and that was wrong in two ways
worth naming rather than quietly correcting:

| | |
|---|---|
| the chosen name, the about text, the picture | shown — that is the table |
| **the role** | **shown**, as a badge. A moderator is visibly a moderator; that is the point of the role existing |
| **the account name** | **shown as a fallback**, and only then. A member who has never opened the community has no row here, so the page falls back to `users.name` — which on a Google sign-in is the name that provider supplied. They never chose it *for the community*, and the way to change it is to set a profile name |
| the email address | **never.** `modules/community/lib/messages.ts` — the DM readers, since the shell was split by domain — does not select the column at all, so this one is structural rather than a rendering decision |
| purchases, balance, grants | never — nothing from the billing tables is joined |

The fallback is deliberate (a person needs *some* name beside their words), but
it is worth knowing when writing a privacy policy: on an app whose members
signed in with Google, switching the community on makes those account names
visible to other members.

**Deleted with the account.** The foreign key cascades: a person's own
description of themselves is not a record that outlives them, and there is no
retention obligation behind it — the opposite of `orders` (§3). The picture
itself is a `media` row and follows §14; deleting the picture leaves the
profile, because the avatar reference is `set null`.

It appears in a subject access request as `communityProfile`, in both exports —
and 🚨 **there are two ways for a community to be "off" here, only one of which
makes the section absent.** They have to be kept apart, because the export
behaves differently in each and a legal answer written from the wrong one is
wrong:

| The app's state | `communityProfile` in both exports |
|---|---|
| **the module is not installed** — `config/modules.json` does not list `community` | **absent entirely.** The tables were never created, so there is no processing to disclose. `module remove` refuses while these tables still hold rows, and that is what makes absent code and absent data the same statement (AD-65) |
| **installed, and `config/community.json` says `enabled: false`** | **present, always** — `null` for a member who never made a profile, the row for one who did. Never gated on that switch, because switching the community off deletes nothing (§14b) |

The absence in the first row is a decision rather than a gap: no heading says
"this application has no such thing", while `null` would say "we hold a profile
for you and it is empty" — and the first is the true answer for an app that
never had the module at all. **What that decision was never about is the
switch.** An earlier version of this paragraph said "absent entirely on an
installation where the community is switched off", which describes the second
row and is refused by a test; §14b sets out what happened and why.

## 14b. The community's rooms, and who looks after them

Two more tables arrive with the community, and they answer the privacy question
in opposite directions — which is why they are worth naming side by side rather
than as one row:

| Where | What | In an export |
|---|---|---|
| `community_groups` | a room's name, its description, its position in the list, which of the four access levels it has, the product keys a plan-gated room accepts, and whether it has been archived | the **row** is in neither export, deliberately — but the room's **name** travels as context on the sections that need it (see below) |
| `community_group_moderators` | which member has been asked to look after which room, and since when | **in both**, as `communityModeratorDuties` |

**A group holds no personal data at all, and that is a design property rather
than an observation.** There is deliberately no membership table: nobody's
presence in a room is recorded anywhere, so a room is the operator's own copy —
a name and a sentence they wrote — with no data subject at either end. Being in
neither export follows from that, and it is written down here because a
deliberate absence that is not written down reads later like an oversight.

⚠️ **One qualifier, because a privacy policy written from the line above would
otherwise be wrong.** The room's NAME does appear in both exports — beside a
moderator duty, beside each of the member's posts, and beside each thread they
started — because "you moderate group 8f41…" answers nothing anybody asked. The
name is the operator's own copy rather than another member's data, which is why
it may travel. What is in neither export is the room ROW: its description, its
access level, its product keys, its position, its archive state.

**Why there is no roster, and why it is not a missing feature.** Who is in a
room is never stored and never shown — no member list, no count, no "who is
here". Access is worked out at the moment of the read from the plans a member
holds right now, so the only trace of a room's population is the words people
chose to write in it. The reason is that **presence in a plan-gated room is
purchase information**: a list of who is in "Diabetes-Coaching Premium" is a
list of who bought it, and for a health-adjacent product that is a category of
data this app otherwise takes care never to hold (§15). A member becomes
visible in a room by posting in it, which is something they did on purpose.

**A duty, by contrast, is personal data with one clear subject.** "This app
asked me to look after these rooms" is a fact about the moderator, so the row
is in their own download and in the operator's report — with the room's name
beside it, because an id answers nothing anybody asked — and it goes with their
account: the foreign key cascades, like the profile above and unlike `orders`.

**Archiving is not deletion, and a privacy policy should not imply it is.** A
room is archived, never deleted: it disappears from every member surface and
keeps its rows, so that "what was said in there?" still has an answer. What
leaves with a person is what belongs to that person — their profile, their
duties, their words — not the structure they were written in.

**Neither is gated on the community switch, and that is a correction.** Both
used to be dropped from an export when `enabled` was `false`, on the argument
that a module which ships off should leave no trace. That argument is right
about the product and wrong about a disclosure: switching the community off
deletes nothing — a room is archived rather than deleted, by design — so an app
that ran one for a year and then switched it off still holds every row. An
access request is about the data, not about which features are currently
enabled, which is exactly the rule this document already applies to erasure
(§14c). The duties section is therefore always present, empty for the many
members who look after nothing.

**This governs the SWITCH and nothing else — the module being absent is a
different statement, and §14a's table is where the two are set side by side.**
An app that does not have the community at all (`config/modules.json` does not
list it) has no community tables, so it discloses no community sections; an app
that HAS it discloses them whatever `config/community.json` says. Neither
sentence is the other's exception: one is about code that was never installed,
the other about a feature that is installed and turned off.

**Two things about that correction are worth keeping, because they are what makes
it a rule rather than a fix.** First, **a test enforces it** — the no-gating
property is asserted rather than reviewed, so the argument cannot be re-made by
somebody who finds an empty section untidy. Second, the two exports had gated on
**different predicates**: `lib/privacy/export.ts` asked `isCommunityEnabled()`
while the command read a local `.enabled === true`, so one typo in
`config/community.json` made a member's own download and the operator's
`data-export` describe **different applications**. That is the sharper reason
neither export may consult a feature switch at all: two readers of one switch are
two chances to disagree about what an app holds.

## 14c. What members write to each other

| Where | What | In an export |
|---|---|---|
| `community_discussions` | a thread's title, who started it, when it was created and when something last happened in it | **in both**, as `communityDiscussions` — the threads this member started |
| `community_posts` | one row per post: the text, when it was written, whether it has been edited, and — if it is gone — when, by whom, and a moderator's reason | **in both**, as `communityPosts`, content and removal reason included |
| `community_post_media` | which of the member's own pictures sits on which post, and in what order. Three columns and no content: the picture itself is a `media` row (§14 — the object, the file name, the size, the description they wrote) | **in both**, as `communityPostImages` — the LINK plus the description. The picture's own facts stay in the core's `media` section, because that is whose table it is |

⚠️ **`community_discussions` used to be in neither export while its posts were
in both**, which is the asymmetry this document exists to prevent: a title is
the starter's own words — the account-deletion scrub empties it for exactly that
reason — so a table this app scrubs on Art. 17 has to be answerable on Art. 15.
A thread the member started is now its own section; the title of a thread
somebody ELSE started still travels only as context beside the member's own post
or read marker, because there it names what their row is an answer to.

**This is the first place this app stores text one person wrote for another to
read**, and a privacy policy should say so plainly: a post is visible to
everybody who may enter the room it was written in, and the app cannot take it
back out of the heads of the people who read it.

**Deletion here is different from everywhere else in this document, and the
difference is worth understanding before writing about it.** Elsewhere the rule
is simple — a person's own words go with their account (§14a, the chat
transcripts) while accounting records stay (§3). A post is a third case: it is
one turn in a conversation other people are still having, so removing the row
would turn every reply to it into an answer to nothing. So:

| When | What happens |
|---|---|
| the author deletes their own post | it disappears from every surface immediately, and a neutral note takes its place so the thread still reads |
| a moderator removes it | the same, with different wording — the two are deliberately distinguishable, because a moderation decision is not a member changing their mind |
| **the account is deleted** | the **text is emptied** — in the posts *and* in the titles of any threads they started — the rows stay as markers, and the author link is removed. What is left holds no personal data. **Their pictures go for real**: the `media` rows and the objects in the bucket, variants included, and `community_post_media.media_id` becomes NULL so the post keeps its shape without them |

⚠️ **A thread's TITLE is the starter's own words too**, and it is the piece that
is easiest to forget: the foreign key sets `created_by` to NULL by itself, so
without an explicit scrub the row would survive an erasure request with the
sentence intact and nobody's name on it — deleted in appearance, de-attributed
in fact. `scrubCommunityContentFor()` empties it in the same transaction,
and `modules/community/lib/deletion.test.ts` renders the WHERE clauses to prove which
rows each statement touches. A thread whose title has been scrubbed renders a
neutral heading, the same way an emptied post renders a neutral note.

**An author's own deletion does not immediately erase the text from the
database**, and that is a decision rather than an omission: a report about a
post has to be able to show a moderator what was reported, and deleting it
quickly is the obvious way to dodge one. The text is hidden from every reader
at once and is erased when the account is deleted. A person who wants their
words gone rather than hidden asks for deletion of their account, which is the
request this app answers completely.

**A post is in both subject access exports** (`communityPosts`) with its text —
including posts the author deleted themselves, because those are still their
words, and the request asks what is held rather than what is on screen.

⚠️ **A post may carry the member's own PICTURES, and they are a second kind of
personal data on the same row.** What a privacy policy has to say about them is
two sentences, and neither is optional: a picture a member attaches is visible to
everybody who may enter that room, and **its location data is removed before it
is stored** (`lib/media/exif.ts`, for JPEG, PNG and WebP — the three the composer
offers, and the reason the bytes travel through the app rather than straight to
the bucket). The picture itself is a `media` row at the `members` visibility, so
§14's rules for uploaded files apply to it unchanged: it goes with the account,
objects and narrower copies included, and it is in both exports as part of the
member's own media. What §14c adds is only the LINK — which picture sat on which
post — plus the sentence the member wrote to describe it, which is their own text
and belongs in the answer for the same reason a post's is.

**That deletion is measured rather than argued.** The tempting reasoning —
"`members` is in `OWNED_MEDIA_VISIBILITIES`, so the sweep reaches it" — is true
and is not evidence: it is a claim about two constants agreeing today.
`modules/community/lib/post-image-deletion.test.ts` reads the condition the
account sweep really builds and asserts that it names the visibility a post image
is really stored at, and `modules/community/schema.test.ts` refuses a
`media_id` foreign key that cascades. Whoever narrows either one gets a red build
rather than a member's photographs left in a bucket.

Everything here is absent on an installation that never installed the community
module — but note the one asymmetry, which is deliberate: **the erasure runs
whether the module is switched on or not, and so does the export (§14a).** An
app that ran a community and later set `enabled: false` still holds every row
written while it was on, and an erasure request is about the data, not about
which features are currently enabled.

## 14d. How far somebody has read

| Where | What |
|---|---|
| `community_read_markers` | one row per member and thread: how far they have read, and when they last did |

**Small, and worth naming rather than glossing.** It is not content, but it is
a record of activity: which discussions this person opened, and when. Anybody
writing a privacy policy from this file should say so in a sentence rather than
leave it under "technically necessary".

**What it deliberately does not hold**: no per-post read receipts, and nothing
about anybody else. A member cannot find out whether somebody read what they
wrote — the marker is the reader's own, visible to nobody but them and in their
own export. That is a decision, not a stage of one: read receipts change how
people write, and the app is not going to introduce that quietly.

**It moves only when the app is told to.** The marker advances when the browser
confirms that posts actually rendered — never as a side effect of a page being
prepared or of content being delivered, so a tab left open does not silently
mark things read.

Deleted with the account (cascade), and in both exports as
`communityReadMarkers`.

## 14e. What two members write to each other privately

| Where | What | In an export |
|---|---|---|
| `community_conversations` | one row per PAIR of members: the two participants and when the conversation started. No title, no subject, no last-message column | **in both**, as `communityConversations` — every conversation this member is in, with the other participant named |
| `community_messages` | one row per message: the text, who wrote it, when — and, if it is gone, when, by whom, and a moderator's reason | **in both**, as `communityMessages`, both directions, content included |

🚨 **Readable by its two participants and by nobody else, and that is a
property of the code rather than a promise in this file.** Every function that
reads either table takes the member id of a PARTICIPANT and puts it in the
WHERE clause; there is no unscoped reader anywhere in the application, for
anybody. Not for a moderator, not for the operator, not on an admin page, not
in a support tool. `modules/community/lib/dm-guard.test.ts` reads the whole source tree
on every test run and fails the build if a file outside a short, reasoned list
so much as names one of these tables.

Whoever writes a privacy policy from this file may therefore say plainly that
the operator cannot read private messages in the application. Three things
qualify that, and all three are worth saying in the same breath rather than
leaving to be discovered:

| | |
|---|---|
| **The subject access request** | `node run.mjs data-export --email …` answers a named person's request, and a conversation has two sides — so that file carries the OTHER participant's messages too. Running it puts a private correspondence in front of somebody who was not in it. It is answered by hand, for a request that was made, and the command's own output says so before the operator forwards anything |
| **A report** | when the moderation release ships, a participant can deliberately report a message. What a moderator then sees is the reported message and whatever the reporter chose to attach — rendered from the report rows, never from a query against the conversation. And in a conversation with exactly two people the reporter is identifiable by elimination; the interface says so rather than pretending otherwise |
| **The database itself** | anybody with the production database has the rows. That is true of every table in this document and is a hosting question, not an application one |

**An impersonated session gets nothing at all.** While an operator is signed in
as a member (§12), the private-message surfaces are not there — no read, no
send, no report — and they answer exactly what a switched-off feature answers,
so the operator cannot even learn whether that member has any correspondence.
The reasoning is in `modules/community/lib/dm-actor.ts`: impersonation is defensible
because it is recorded, and the record says an operator was in an account, not
what they read. Reading somebody's mail changes nothing and leaves no second
trace, so the capability was removed rather than logged.

**A member can decide who may write to them, themselves.** `community_member_blocks`
holds one row per direction, and a standing block makes new messages
undeliverable both ways. It changes nothing in the rooms: a blocked member's
posts are still visible to the blocker and the other way round, because a block
is about an inbox and not about a room.

⚠️ **The block is in the BLOCKER's export and in nobody else's**, and the
asymmetry is deliberate rather than an oversight. Somebody who is blocked meets
a refusal that is identical to every other undeliverable message — no such
account, a closed account, a block — and an export saying "X blocked you on the
3rd" would hand them by post exactly what that refusal is built not to say.
What they hold instead is the honest general answer: this app lets members
decide who may write to them, and does not disclose who has.

Private messages are the contrast worth naming beside it: those are in **both**
participants' exports, because both were already readers of every row. A block
is a decision one person took *about* another; a conversation is something two
people already have.

**Deletion follows §14c's doctrine, one room narrower.** The account deletion
empties the departing member's messages, sets the neutral marker and removes
the author link, all in the same transaction as the account itself — so the
surviving participant keeps their own side of the conversation and what they
wrote to is a tombstone rather than a hole. The row stays for the same reason a
post's row stays: remove it and every answer to it answers nothing. The
reasoning lives in `modules/community/schema.ts` beside the columns, and
`modules/community/lib/deletion.test.ts` renders each statement's WHERE clause to prove
which rows it touches.

⚠️ **Retention: kept until the account is deleted — and that is a setting, so
this sentence is only as true as `config/community.json`.** The shipped value
is `dmRetentionMonths: 0`, which means nothing prunes private messages by age.
An operator who wants a shorter life for them sets a number of months and runs
`node run.mjs community-prune` (dry run by default) — and, as with `ipn_events`
in §6, **the promise is only as true as the job that keeps it**: nothing
schedules this command, so a privacy policy claiming a six-month window needs
somebody's cron behind it.

The pruning is **bulk by age and cannot be anything else**. There is
deliberately no way to delete one conversation: choosing which one would mean
knowing what is in it, and an operator tool that reads private messages to
decide is the read access this whole section says does not exist.

**Nothing here exists on an installation that never switched the community on**
— and, as in §14c, the one asymmetry is deliberate: the erasure runs whether
the module is on or off. An app that ran a community and later switched it off
still holds every row written while it was on.

## 14f. Who follows whom

| Where | What | In an export |
|---|---|---|
| `community_follows` | one row per direction: who follows whom, and since when. No note, no state, no counter | **in both**, as `communityFollows` — this member's own two lists (whom they follow, who follows them) |

**The relationship IS the personal data**, and it has **two** subjects: a row
says something about the follower and about the followed. That is unusual in
this document, and here it is also the easy case — because a follow is
**visible to both by design**. The followed member sees the follower on their
own list from the moment the row exists, so neither side's export tells them
anything the app has not already shown them, and nothing is withheld between
them.

⚠️ **There is no way to follow somebody without appearing on their list.** No
private-follow setting, no hidden-watch flag, and nothing in the app that
quietly keeps track of a member without saying so. A privacy policy may state
that plainly — it is a property of the design rather than a default somebody
could change.

**What the app deliberately does not hold and does not show:**

| | |
|---|---|
| **No counts, anywhere** | no follower number on a profile, no total on a list, no aggregate on an operator page. How many people follow somebody is a fact about *those* people, and in a community with paid rooms a number over the graph starts describing who bought what |
| **No third-party view** | there is no reader anywhere for somebody else's lists and none for the graph. You get the relationships you are part of, never the picture |
| **No approval, and no "remove this follower"** | being followed is visible rather than approved. Somebody who does not want to be followed uses the block (§14e), which severs it |

**Deletion, three ways, and none of them needs a cleanup job:**

- **Unfollowing** deletes the row immediately. There is no "no longer
  following" marker — that would be a record of who once followed whom, which
  nobody asked this app to keep.
- **A block severs it**, in both directions, inside the same transaction that
  writes the block. Deleted, never hidden: a hidden row would still be in the
  follower's own export, which would disclose that a block exists — the one
  thing the neutral refusal is built not to say. Lifting the block brings
  nothing back.
- **Deleting an account** removes every row naming that person, in both
  directions, through the foreign keys. A follow has no words to tombstone; it
  is a relationship, and with either person gone there is nothing left for it
  to be about.

**The friends feed stores nothing.** The page showing "what my people wrote" is
a read-time join of these rows against posts the viewer may read at that
moment — no feed table, no copy, no per-follower delivery, no counter. It is a
new VIEW of data that is already inventoried above and adds no personal-data
surface of its own, which is why it has no entry of its own in this document.
Two things it deliberately does not show, both for the same reason: a room the
viewer cannot enter contributes nothing at all — not the post, not the room's
name, not the fact that something happened — and a discussion embedded in a
page of the app never appears, because the key such a discussion hangs on names
course structure.

## 14g. Moderation: what was done, and what was reported

| Where | What | In an export |
|---|---|---|
| `community_moderation_audit` | one row per act of moderation power: who did it, what, about whose content, their written reason, when — plus, for a DM visibility event, the exact message ids that became visible | **in both**, as two slices: `communityModerationActs` (what this member DID) and `communityModerationReceived` (what was done to their content) |
| `community_spam_reports` | one row per report: who reported, whose content, which post or message, their optional reason, any attached message ids, when — and whether it has been dealt with | **in both**, as `communitySpamReportsMade` and `communitySpamReportsReceived` |
| `community_member_standing` | at most one row per member, and only while they are on a list: protected from the automatic blocks, write-blocked by hand, or having their reports ignored — with the date of each | **in both**, as `communityMemberStanding`. It does **not** name the operator who set it, the same withholding as the audit trail's received slice |

**Two subjects per row in both tables**, and the slicing differs between them
in a way worth stating rather than leaving to be noticed:

| | |
|---|---|
| **The audit trail** | the received slice carries the act, the reason and the date — **but not which moderator acted**. No surface in the app ever showed a member that, and in a small community naming the moderator is naming a person to be angry at. What they get is everything they need to dispute the decision |
| **A spam report** | the received slice carries neither the reporter nor their reason. *A decision taken about you is owed to you; an accusation made about you is not, while it is unproven* — and a reason in a small community routinely identifies its author |

⚠️ **A removal reason is prose a moderator wrote about a member**, exactly like
`grants.note` (§3). It is in both exports, it is emptied when that member
deletes their account, and it should be written as if it will be read out —
because here it is. **The same holds for a spam report's reason**: prose one
member wrote about another, in both exports, and emptied when its author deletes
their account.

🚨 **A STANDING decision is exported as well as the act that made it, and the
two are not the same thing.** The audit trail holds "on 3 March an operator
stopped counting your reports"; the standing row holds "and they still do not
count". A member whose reports have quietly weighed nothing since March cannot
learn that from a trail they would have to read backwards, so the state travels
in its own section. The **weight** a report carried does not appear in either
export, and cannot: it is computed at the moment of a derivation and stored
nowhere — an accident of the derived design that happens to be the
privacy-friendly one.

🚨 **What is emptied is the TEXT; the ACT stays.** Who did what, and when, remains
in the trail with the author link removed — because who took a decision is the
record of that decision, and a trail with a way to erase yourself out of it is
not a trail.

**The one window into a private conversation, and its exact size.** When a
member reports a direct message, the moderator sees that message plus the
messages the REPORTER chose to attach — at most five by default, ten as a hard
ceiling, and never anything else. Not the messages around it, not the rest of
the conversation, not a link into it. Which ids became visible is recorded as
its own event with the ids in it, so *"who saw what of my correspondence"* has
an answer. The reporter is named as the actor of that event, because they are
the one who decided to show it.

⚠️ **In a conversation with two people, reporting is not anonymous, and the app
says so** — at the moment somebody is deciding whether to report, which is the
only moment the sentence is worth anything. The reported member can work out
who reported them by elimination, and no export or interface pretends
otherwise.

**The automatic silence is not stored anywhere.** When enough distinct members
report somebody inside the window, that member cannot write until a moderator
lifts it — but there is no "blocked" column and no block table: the state is
derived from the reports that have not yet been dealt with. So it lifts itself
as those reports age out, and one moderator action clears it. What IS recorded
is the moment it fell, and the moment it was lifted, as events.

**Reading is never taken away.** A silenced member still sees every room, every
conversation and every page they could see before. The measure is against
writing, and it is applied before anybody has judged the reports.

⚠️ **Retention: `node run.mjs community-prune`**, and the same warning §6 gives
for `ipn_events` applies — the promise is only as true as somebody running it.
Trail rows and **handled** reports age out after a year by default (`--days`).
An **unhandled** report is never deleted at any age, because those rows are
what the automatic silence is derived from: pruning one would lift a block
nobody decided to lift.

Everything here is absent on an installation that never installed the community
module — and, as in §14c, the erasure runs whether the module is switched on or
off, and so does the export (§14a).

## 15. What this app does not do

Worth stating, because a privacy policy that claims less is easier to keep true:

- No tracking, no advertising profiling, no cross-site measurement, and nothing
  sold or passed on for it.
- 🚨 **One qualification, and it is written here rather than left for somebody
  to discover: with the `community` module installed, this app DOES take an
  automated measure and DOES compute a score about a person.** Enough distinct
  reports inside a window silence a member's writing without anybody deciding
  it, and with `weighting` switched on those reports are weighted by how long
  the reporter has been a member, how much purchased access they hold, and how
  much they have reported and been reported. Both are described in
  [`community.md`](community.md) → *The spam loop*.
  ⚠️ **The first half of that has been true since the module shipped**, before
  any weighting existed — this bullet used to say otherwise, which was the
  clearest kind of privacy claim to get wrong: one that is comfortable.
  What holds instead, and what a policy may say: it suspends WRITING and never
  reading, so no purchased access is withdrawn; the score is computed at the
  moment of the derivation and stored nowhere, so there is no reputation record
  to disclose or correct; and there is a human in the loop by construction — the
  block appears in a moderators' review list, one audited tap lifts it, and
  `expiryDays` ships `null` precisely so that a person MUST act. Whether that
  clears Art. 22's "legal or similarly significant effects" is a lawyer's call
  on YOUR product, not this file's.
- No special categories of data (health, beliefs, and so on) — unless *your*
  product adds them, in which case this file needs a section you write.
- No data sold or passed on beyond §5.
- No password is ever readable, mailed, logged, or shown — including to the
  operator.

## The setup surface

Three tables behind `/api/setup`, the surface a developer's coding agent uses to
set an environment up ([`setup-mcp.md`](setup-mcp.md)). Empty in every app that
has not switched it on, which is the shipped state.

| Table | What it holds | Kept |
|---|---|---|
| `setup_keys` | one row per key an operator minted: their id, the name they gave it, a SHA-256 of the secret and its first characters. **Never the secret** — it is shown once and is unrecoverable. Personal data because the name is theirs and the row names its owner | until revoked and deleted; a revoked key keeps its row so "which one did I revoke" has an answer |
| `setup_confirmations` | a nonce per planned change: a token hash, which tool, and one hash of the call — the input, plus the SHA-256 of the uploaded bytes where the call carried a file. No content, no identifiers of members | expires in ~2 minutes; safe to prune at any age past that |
| `setup_audit` | one append-only row per act: which key, which operator, which environment, which tool, which target, how many rows | **24 months**, by the daily job `prune-setup-audit` |

**`setup_audit` is the one to read carefully.** It records **identifiers and
numbers, never the payload**: `target` is `member@example.com` or
`gruppe-einsteiger`, never what was said to them — on a **refused** act as well
as on a successful one, which is why a tool declares which of its input fields
may be written there rather than the trail taking whatever was posted. Two named
exceptions, both deliberate:

- **`role`**, when a tool wrote one — under the owner-promotion rule the role
  *is* the security question, and an audit that omits it is an audit of
  everything except the thing worth auditing.
- **`reason`**, when a tool demanded one — a written reason IS the
  accountability, and it belongs on the act.

**Both are recorded on a REFUSED act as well**, and that is a decision rather
than a side effect. The two tools that demand a reason are the two that touch a
person's access, one of them irreversibly — so a trail that kept the reason only
where the act succeeded was thinnest at exactly the acts somebody later demands
an account of. What makes it defensible: it is the same value and not a wider
class (the tool's own schema has already bounded it — `reason` at 500
characters, `role` at three literals), it reaches the member through both
exports, and it goes when they go. ⚠️ **The one branch that still records
neither is a refusal by the guard**: that happens before the input has been
validated at all, and what an unauthenticated stranger posted is not something
this trail repeats.

`subjectMemberId` names the member an act was ABOUT, which is what makes the
section sliceable per person: it appears in **both** Art. 15 exports as
`setupActs` — the member's own download and `node run.mjs data-export`.

**Empty means one of two things, and the row says which.** Every tool declares
whether an act of it is about a member at all (`subjectEmailField` in
`lib/setup/types.ts`; a tool that has not decided does not compile), and that
declaration is part of what `list_environment` reports. So a blank column on a
tool that declares one means *we looked and found nobody* — the address is still
there in `target` — and on a tool that declares none it means *this act was never
about a person*. Neither is silence.

🚨 **`reason` is emptied when that member deletes their account, and the ACT
stays** — the same rule § 14g states for a removal reason and a spam report:
prose somebody wrote about a member goes with them, while who did what and when
remains, its subject link set to `null`. It happens in the same transaction as
the delete. `target` is deliberately left as it stands: an address in a record
that outlives the account is the footing `orders.buyer_email` already keeps, and
a trail that says an act happened to nobody is not a trail.

**Twenty-four months, where everything else here keeps twelve**, and the
difference is the argument rather than an oversight: this is the only record of
writes made to a production database by an *agent* — no session, no browser,
nobody watching. The questions it answers arrive late (a billing dispute about
an entitlement given by hand, an audit, a customer asking who created their
account), and a year would end just before they do.

The window is `retentionMonths` on the `prune-setup-audit` job in
`config/cron.json`. ⚠️ **Zero is refused, not obeyed.** A trail deleted every
night is not a retention policy — it is the control switched off with something
policy-shaped left in the config. An operator who wants to keep everything
disables the job; the floor is one month.

Spent and expired confirmations go with every run and unconditionally: a
consumed nonce is arithmetic, not a record.
