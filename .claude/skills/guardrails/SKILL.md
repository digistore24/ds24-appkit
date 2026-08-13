---
name: guardrails
description: Security and due-diligence rules for this Digistore SAAS. Read this before you change anything around money/billing, secrets/API keys, personal customer data (GDPR) or external systems. Names the stop criteria at which you should involve a human.
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Guardrails — before something goes wrong

This app processes **real money** and **real customer data**. Stick to the
following rules. They are the "golden path" — do not rip them out.

## Money & billing

- The **IPN signature verification (SHA512)** in `lib/digistore/ipn.ts` is mandatory.
  Never switch it off, loosen it or bypass it.
- Set the order status exclusively through IPN events (`mapEventToStatus`). It is
  the **financial record** — what somebody paid, and what became of that money.
  It is not the access rule; see **Access** below for that.
- **No mock/demo fallback** on API errors. Make errors visible, do not
  hide them.
- Preserve idempotency: purchases are unique via `ds24OrderId` — never book them
  twice. Digistore24 **retries an IPN until it receives `OK` with HTTP 200**, so
  a transient failure must fail loudly (throw → 500 → redelivery). Only a
  permanent one may be acknowledged with `OK`.
- 🚨 **And the retry replays the WHOLE handler.** The signature is verified; a
  timestamp and a nonce are not. What makes today's writes survive it is three
  UNIQUE constraints (`orders.ds24OrderId`, `invoices.ds24TransactionId`, the
  token ledger's `(accountId, ds24OrderId)`) — a property of those three paths,
  not of the webhook. **Anything you add beside them inherits nothing**: a mail,
  a module hook, a table of your own. Sending a mail is not idempotent unless
  the sender records that it sent one (`claimSend()`). The reasoning and the
  shape of a door-level dedup:
  **[`docs/digistore-integration.md`](../../../docs/digistore-integration.md)**
  → *Replay*.

## Attribution — whose payment is this?

- A token credit requires an **attributed `memberId`**. Never credit on the
  buyer email alone. An unattributed purchase is recorded and waits — it is
  credited when the buyer signs in, or when you attach it under
  `/dashboard/admin/purchases`.
- The buyer email is **not verified by Digistore24** — anyone can type anyone's
  address into a checkout. It is a fallback that must stay safe when the claim
  is a lie. The identity in `tracking[custom]` is the authenticated path.
- Attribution only ever **grants**, never revokes. Never clear
  `orders.memberId`; fill it only when it is null.
- Never weaken `parseCustom` to accept a member id without its checkout token.
  Half an identity is not a weaker identity — it is none.
- **Ask the entitlement API what a Member may use** —
  `hasPlan(memberId, productKey)`. It takes the signed-in Member as its first
  argument, so the scoping that a hand-written query keeps forgetting is built
  in. See **Access** below.

## Access — who may use what

`lib/entitlements/manage.ts` answers this, and it is the only thing that does.
**The three functions, which event does what to a grant, and why a Member can
hold two plans at once are `CLAUDE.md` → *Access*** — already loaded in this
session, so repeating them here would only be a second copy to keep in step.
The full reference, the failure modes and worked examples are
**[`docs/entitlements.md`](../../../docs/entitlements.md)**.

What belongs in a security review, and is nowhere else:

- **Never cache the answer as a boolean** on the user, in a session or in a JWT.
  A stored yes survives the chargeback that should have revoked it, and it
  survives it silently — the customer keeps the feature and no log says why.
  Derive it per request; it is one indexed query.
- **Never widen a gate to "has any entitlement".** `entitlementsFor()` is a
  list, and `.length > 0` is the shape that hands a token-package buyer a course
  they never bought. One feature, one `hasPlan(memberId, key)`.
- **A gate that exists in two places is two decisions.** When a page and a
  content source both answer for one feature, they call ONE function — two
  `hasPlan()` calls that agree today are the shape that turns the assistant into
  an existence oracle (`CLAUDE.md` → *Content sources*).

## By hand — what the Operator can do without a payment

`/dashboard/admin/users/<id>` lets an Operator move a customer's token balance
and hand out a plan nobody paid for. No card is charged, so it reads like an
edit — it is not. Both are money paths, both are `requireOwner()` on every
Server Action, and both refuse without a written reason.

- **A balance correction is a booking, never an edit.** `adjustTokens()`
  (`lib/tokens/account.ts`) writes a signed row into `token_ledger` inside a
  transaction that locks the account first, and the reason is stored with it.
  Never write `token_accounts.balance` directly and never "clean up" the
  journal: a balance without its bookings is a number nobody can explain, and
  the journal is what a disputed charge gets settled from. Two Operators
  correcting at once without that lock lose one correction *and* record a
  balance that was never true.
- **A manual grant is access somebody did not pay for.** `grantByHand()`
  (`lib/entitlements/manage.ts`) records who issued it, why, and until when —
  permanently, or through a chosen day. It refuses a token package outright: a
  balance is not an entitlement, so such a row would give nobody anything and
  no one could explain it afterwards.
- **A revocation cannot be undone.** `revokeGrantByHand()` closes the grant by
  stamping `ended_at`, and that column is terminal — no later payment, no
  second click, nothing clears it. The only repair for a revocation made in
  error is issuing a *new* manual grant, which is exactly why two identical
  manual grants are deliberately allowed. Do not build an "un-revoke".
- **What an Operator may never end by hand is a purchased entitlement.**
  `canRevokeGrant()` refuses anything whose source is a purchase, and the
  `UPDATE` repeats the condition rather than trusting a hidden menu entry.
  Purchased access ends by Digistore24 event (refund, chargeback, last paid
  day) and by nothing else; ended by hand instead, the refund the customer is
  owed has nothing left to close.
- **A reason that is blank does not count.** Both paths reject an empty note
  *and* one that only looks written — a zero-width space survives `trim()`, and
  a control character is accepted by JS and rejected by Postgres, which the
  Operator then reads as "unknown error". That note is the sole record of why
  money or access moved.

## A verdict is never reached in the browser

Where the app judges what a customer did — a quiz, a game, a graded exercise
(`modules/activity/`) — **the score, the pass and the completion come into being
on the server, and the solution never leaves it.** A submission from a
browser is data about an attempt, never the result of one.

This rule sits beside money because the failure is invisible the same way: a
quiz whose answers ship in the client bundle renders correctly, returns 200
and passes every test — and is worthless the day one buyer opens the dev
tools. `grade()` in the activity's registry entry is the only place a score
comes into being; `load()` sends the questions, never the expected answers;
a checkpoint verdict carries no score. The check that finds a breach is the
skill `learning-activities` (item `check`) and `security-gateway` §8 (`verdicts`).

## Secrets & API keys

- **Never** put API keys, passphrases or tokens into the code, the repo or logs.
- Configure via the `.env` (add new variables to `.env.example`) or the host's
  secret management. The operator's Digistore24 credentials
  (`DIGISTORE_API_KEY`, `DIGISTORE_IPN_PASSPHRASE`) are fetched into the `.env`
  by `node run.mjs ds24-connect`; they are read via `lib/digistore/settings.ts`. Do not
  build a UI for entering keys.

## Customer data & GDPR

- Only collect what is needed.
- **A purchase needs no consent, and asking for one is the mistake here.** It
  runs on Art. 6(1)(b) — performance of a contract. The thank-you page
  deliberately prompts for nothing. What *does* need consent is anything on top:
  tracking that touches the device (§ 25 TDDDG), a marketing mail (§ 7 UWG).
  Those go through `lib/consent/`, which records the purpose and the version of
  the text that was agreed to, and can be withdrawn again — see
  `docs/compliance.md`. Never invent a second consent store beside it.
- `orders.isGdprCountry` says whether Digistore24 placed the buyer in the EEA.
  It is a fact from the payload, not a permission.
- Do not pass buyer data on to third parties/external services without a clear
  purpose and a legal basis.

## Talking to a model about a customer's work

Every model call in this app goes through `runTask()`, and one shape of call
sends a third party something a **customer produced** rather than something the
app computed. That is the case these rules are about.

- **The assistant's rule is about HER, and it stays.** Nothing about the
  signed-in person is sent to the API — not their name, balance, orders, plan or
  role (`docs/ai-chat.md`). It is a data-protection decision, not a limitation
  waiting to be lifted, and it is what makes her safe to switch on for every
  member without a second thought.
- **A product-side call is given exactly the rows named at its call site, one
  field at a time.** Never a member id it resolves for itself, never a whole
  record. `askCompanion()` takes labelled facts and nothing else, and neither
  `lib/ai/customer-text.ts` (the core's fence, where the shape is defined) nor
  `modules/companion/companion.ts` imports a database, an entitlement function or a token
  function — a test beside each reads the file to keep that true. This is not tidiness: it is
  what makes the inventory in `docs/data-protection.md` §8a writable from the
  code instead of from an intention.
- **Text a customer wrote is content, never instruction — including the text
  they wrote last week.** The fence lives in the layer and is tested there —
  `lib/ai/customer-text.ts`, in the CORE, so every caller can import it and none
  has an excuse: a companion, an activity's `grade()` sending a submission to a
  model, whatever comes next. And
  it covers their earlier turns as well as the current one. Do not restate it per
  call site, and do not build a second path that skips it — a companion reads
  what somebody else wrote by design, which is exactly the surface where prompt
  injection pays. The half that gets missed is the second turn: an app that
  fences a submission and then re-sends it as bare history has a fence that
  lasts one question.
- 🚨 **A registry entry's `load()` is where an IDOR would live.** It receives the
  session's member id and a subject string the customer's browser sent. Scope
  every read by that member id, and return `null` for a subject that is not
  theirs — the same value as "no such subject", so nothing enumerates.
- **The disclosure comes before the customer writes**, not once there is a
  transcript. `<AiDisclosure surface="…" />`, above the transcript, and
  `node run.mjs legal-check` reports a surface that is switched on without one.
- **Never**: a call that takes a member id and fetches the context itself; a
  second consent store; a second disclosure mechanism; a second way to reach a
  provider.

## Signing in as a user

An operator can sign in as one of their customers from
`/dashboard/admin/users` — see **Users & roles** in `CLAUDE.md`. It is a
deliberate hole in this app's own access control, and four properties are what
keep it from being a back door. Do not remove any of them:

- **Narrow.** Only an owner, only onto a member. `canImpersonate()`
  (`lib/users/rules.ts`) refuses another owner outright — every guard in this
  app answers from `session.user.role`, so impersonating an owner would hand
  over every right that owner holds, including this feature. The refusal is in
  the rule, not in the menu: a request that never passed through the menu has to
  be refused identically.
- **Visible.** A banner on every page, in the root layout, that cannot be
  dismissed. If you make it conditional on a route, you have re-opened the gap
  it exists to close.
- **Bounded.** Thirty minutes, then it ends by itself.
- **Recorded.** One row in `impersonations`, written **before** the session
  changes.

**That ordering is the authorisation, not a log line.** `/api/auth/session`
accepts a POST from any signed-in user, and the body reaches the `jwt` callback.
The callback trusts nothing in it — it looks up the record row and rewrites the
session only if that row already names the caller as its operator. Write the row
after the swap, or believe a member id out of the payload, and any customer can
become any other, including you. `lib/impersonation/session.ts` says so at
length; `lib/impersonation/guard.test.ts` fails the build if either changes.

**The exit action is deliberately not `requireOwner()`.** While an impersonation
runs the session's role IS the member's, so an owner check on the way out would
lock the operator inside. It looks like an oversight and is not.

**Money stops at the customer's card.** An impersonated session may spend the
customer's token balance — that is what makes support useful — but automatic
top-up is suppressed (`lib/tokens/spend.ts`), because `createBillingOnDemand`
charges a stored payment method with nobody present to agree to it.

**Never build**: impersonation of an owner, a way to reach it other than the
user list, a chain (impersonating from inside an impersonation), a longer cap
without saying so in `docs/data-protection.md`, or an activity log of what was
done while inside — that last one is a surveillance log of a customer's own
data, and the changes that matter are already recorded elsewhere.

## Auth

- Auth protection is **opt-in, not opt-out**. The refusal is `authorized()` in
  `auth.config.ts`, and it returns true for every path outside `/dashboard` —
  so **any new route outside `/dashboard` is public until you protect it
  there.**
- 🚨 **The `matcher` in `proxy.ts` says where the proxy RUNS, not what is
  protected — adding a path to it protects nothing.** Four of its five entries
  are fully public and are listed only so a cookie sweep reaches them. A new
  protected area needs **three** things: the path in the matcher, the
  `/dashboard` prefix decision in `proxy()`, *and* `authorized()` taught about
  it. Which routes are public by design, and why the two lists stopped being
  the same one: **[`docs/auth-setup.md`](../../../docs/auth-setup.md)** →
  *Which routes are protected*.
- `app/route-protection.test.ts` is the backstop, and knowing what it does NOT
  do matters: it forces a DECISION per route — under `/dashboard`, or named in
  its `PUBLIC` list with the mechanism that guards it instead — and it never
  verifies that the guard WORKS. "Protected by the matcher" is a sentence it
  will accept and the code will not.
- `/account/confirm-email` is authenticated by its single-use token, not by a
  session — the mail is read wherever the inbox is. Do not "fix" it into
  `/dashboard`.

## STOP — involve a human here

Do **not** carry on alone, ask instead, when you are about to:

- fundamentally change the billing/payout logic or the price calculation,
- adjust or deactivate the signature/auth checks — **including anything in
  `lib/impersonation/`**, which rewrites the subject of a signed-in session,
- export, delete or send personal data to external systems,
- build a companion that **advises on health, money or law** — sending customer
  data to an external system is what a companion does by construction, and those
  three subjects are three different regimes (Art. 9 special categories, possibly
  Annex III, and professional liability the AI Act does not govern at all). The
  skill `compliance-check` prepares the question; a person answers it,
- connect a new external integration with access to payments or customer data,
- run database migrations that change existing order/user data,
- correct a token balance or hand out a plan for somebody you cannot account
  for — that is real money either way,
- take access away by hand. It cannot be undone, and it is the one Operator
  action with no way back.
