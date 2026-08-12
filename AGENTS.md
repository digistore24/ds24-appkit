<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->
<!-- This file exists twice, byte for byte: CLAUDE.md and AGENTS.md. Different
     programs look for different names — Claude Code reads CLAUDE.md, Codex and
     Antigravity read AGENTS.md, OpenCode takes either. Editing one and not the
     other is how the two start disagreeing, so copy it across. -->

# Guardrails for this app

You (and every AI assistant) are building a **SAAS application with Digistore24
billing** on this template. Stay on the golden path. Don't rip out the base structure.

## What gets built here — without exception

**Always a SAAS application that bills through Digistore24. Never a single web
page.** That holds even when the user words it differently — a landing page has
no accounts, no protected area and nothing Digistore24 could bill.

**If the user asks for a plain web page, never just start building and never
silently refuse.** Say in one sentence what this template is for and ask what
people are supposed to *buy* and *use* afterwards — the page they want is almost
always the app's own sales page (`app/page.tsx` + `app/plans/page.tsx`), never a
project alongside. If there genuinely is no product behind it, say so openly.

**Test apps are exempt** — "always SAAS" applies to what the user **builds**, not
to what he **plays** with. "Hello World" or a small trying-out page MUST be built
immediately, with no product question and no lecture, **inside the app** as a page
under `app/` and never next to it. Once it runs, offer the bridge in one sentence
("should this turn into something you can sell? Then I'll start `build-app`") —
offer, never push.

Both rules, and the reasoning behind them, live in the skill **`build-app`**
(`.claude/skills/build-app/SKILL.md`, intro and *"Exception: test apps"*).

## First: meet the user where they are

The people working here are often **not developers**. **Anything unspecific on a
still-unchanged app** — "hello", "how do I start?" — and **anything that is a
short but concrete idea** ("an app for nutrition coaches") get the SAME answer:
greet briefly, say in one sentence what this template is, and **start the skill
`build-app`**. Two sentences are an idea, not a specification, and what they leave
open does not stay open — who pays, what the buyer walks away with, what it is
called, what it looks like otherwise get decided by you, silently, and reappear as
finished work nobody chose. `build-app` step 0 asks those once, together, and says
beforehand that it is going to. When in doubt, `build-app`.

> **Before the first file in this project is written or changed, a `node` command
> has answered in this session.** Either the greeting says
> `[Setup: ok — verified <date>]`, or you have run `node run.mjs doctor --json`
> yourself and it came back `"ok": true`. No building before that.

A hard precondition, not a courtesy: a machine without Node lets an entire app
come into being and gives way at the first command that runs any of it.

| What you see | |
|---|---|
| `[Setup: ok — verified <date>]` | the full checklist went through on this machine. Carry on |
| `[Setup: ok — not verified yet]` | nothing obvious is missing, but nobody has looked properly. Run `node run.mjs doctor` before building |
| `[Setup: blocked — …]` | skill **`setup-machine`** first — it installs what is missing and prepares the project |
| a command failing with "docker: not found", "npm not found" or "the database does not answer" | the same case: a setup problem, `setup-machine` — never a bug in the app |

🚨 **No greeting at all is the same case, and the most important one to recognise.**
Absence of a signal is never a signal: you MUST run `node run.mjs greet` before you
touch a file — it prints the same line on demand. **In Antigravity CLI that is not
the exception but the normal path**: it has no session-start event, so this app
ships it no greeting hook at all rather than one that looks wired and does nothing.

One more line can appear, `[Operations: …]` — what is open about RUNNING this app.
🚨 Its ABSENCE is a state, not an omission: silence means at least one check ran
and nothing is open at HIGH or CRITICAL. Every sentence it can say:
**[`docs/operations.md`](docs/operations.md)**. The greeting's three wirings:
**[`docs/troubleshooting.md`](docs/troubleshooting.md)**.

## What the skills assume you can do

Some of the playbooks below name a way of doing something rather than the thing
itself. Read those as capabilities, not as tool names:

| The text says | If you do not have it |
|---|---|
| *"ask the user"* / a multiple-choice question | Ask in plain prose and wait for the answer. Never assume one and carry on. |
| *"in Claude Code they can type `!`"* | That is a shortcut for running one command inline. Elsewhere: tell the user the command and ask them to paste the output back. |
| *"search the web"* | All four have this. If yours genuinely does not, say so rather than answering from memory — most of what it is used for is prices and current APIs. |
| *"open the page and look"* (`ux-gateway`) | See that skill: it says exactly what to do when there is no browser tool, and stopping is one of the options. |
| *"restart the session"* | Whatever ends and reopens your session in this folder. The point is that a changed `PATH` or a new `.env` is picked up. |
| *"the browser opens"* / *"open http://localhost:3000"* | Only true where the person is at THIS machine. Where they are not, the link is something you hand over and that address reaches their computer, not this one — [`docs/machine.md`](docs/machine.md). |

**One capability is not yours but the machine's: is the person at this screen?**
The greeting says so when the answer is no (`[Machine: no browser here …]`), and
three promises stop holding there without failing loudly: a link that opens
itself, a `localhost` address the user can reach, and work that is simply on their
disk when you are done — **[`docs/machine.md`](docs/machine.md)**.

**Everything measurable is a command, not a capability.** `node run.mjs ux-check`,
`doctor`, `smoke`, `errors`, `legal-check`, `ai-check`, `kb-check`, `greet` behave
identically in all four programs, because they are Node scripts and nothing else.
`node run.mjs help --json` lists every one of them.

**The skills are the method of this project, not an optional extra.** When a task
matches one of them — **The path** below names every one, in order — you MUST
**open that file and read it in full before you act**. Its frontmatter is a
trigger and never a summary you may work from. Claude Code and OpenCode read
`.claude/skills/`; Codex and Antigravity read the generated stubs in
`.agents/skills/`, which point at the same file.

## The path

<!-- journey:path start -->
**Prerequisite** — *(optional)* `setup-machine`

**1 Plan** — *(optional)* 1.1 `market-research`, 1.2 `design`, 1.3 `knowledge-intake` → 1.4 `build-app`

**2 Build** — 2.1 `build-app` → 2.2 `setup-digistore` → *(optional)* 2.2b `billing-modes`, 2.3a `visuals`, 2.3b `content-production`, 2.3c `courses`, 2.3d `learning-activities`, 2.3e `community`, 2.3f `ai-companion`, 2.3g `mobile-companion`, 2.3h `ai-providers`, 2.3i `ai-chat-knowledge`, 2.3j `user-onboarding` → 2.4 `salespage` → 2.5 `ux-gateway` → 2.6 `security-gateway` → 2.7 `performance-gateway` → 2.8 `compliance-check`

**3 Go live** — 3.1 `setup-hosting` → 3.2 `go-live` → *(optional)* 3.3 `setup-environments`, 3.4 `setup-monitoring`

**4 Run it** — 4.1 `operate` → *(optional)* 4.2 `go-to-market`

**Alongside** — `guardrails`, `coach`
<!-- journey:path end -->

**Experience comes before security on purpose**: its findings change the
interface, and a security pass run before those changes is a pass on an app
that no longer exists. It comes after the payment step because the moment it
exists to protect — a customer who has just paid, looking for proof that it
worked — is not there until there is a checkout.

*"Where am I / what comes next"* is `node run.mjs journey`. `coach` is for a
symptom, or a fork that cannot be measured.

## Where guidance lives

Five surfaces, and a fact belongs in exactly one of them — two copies drift, and the copy that is not the owner is the one nobody updates.

| | |
|---|---|
| **`CLAUDE.md`** | a line belongs here only if an agent that has read no other file would otherwise cause damage it cannot see. Every `##` section is at most 40 lines and ends in a bold link to the doc carrying its long form |
| **`SKILL.md` frontmatter** | says *when to start*, never *how it works* |
| **`SKILL.md` body** | the ORDER of the work — steps, decision points, hand-overs. Anything still true if the steps changed does not belong in it |
| **`references/*.md`** | what ONE step of ONE skill reads once. Linked from its own skill and nothing else, never from here |
| **`docs/*.md`** | the full form of one subsystem with more than one reader; the only place a fact appears in full |

**Whoever writes or changes a skill reads [`docs/guidance.md`](docs/guidance.md)
first.** It carries the contract every skill keeps: you run the commands, say where this
is going, no technical word unexplained, look before you ask, and anything the customer
will SEE is proposed and never assumed. It also holds the **one shape every dated report
takes** — the severity ladder, the four lines of a finding, and why *could not be checked*
is its own column. The four gateways and the operating round all write to that shape and
none of them restates it. A skill may **add** a column its domain needs, or make one of
them **stricter**, and then it says why in one sentence — what it may not do is drop one,
or keep a name while meaning something else by it.

## Rules

Each line below is a refusal. The conventions behind them — checkers, raw SQL,
dates — are **[`docs/conventions.md`](docs/conventions.md)**.

- **Sign-in is opt-in, not opt-out: the refusal is `authorized()` in `auth.config.ts`**, which returns true for every path outside `/dashboard` — so **any new route outside `/dashboard` is public until you protect it there.** ⚠️ The `matcher` in `proxy.ts` says where the proxy RUNS, not what is protected. `app/route-protection.test.ts` is the backstop: a page outside `/dashboard` is either protected or carries a line saying what guards it instead, so a forgotten route fails the build rather than a customer. The three things a new protected area needs and the public-by-design list: **[`docs/auth-setup.md`](docs/auth-setup.md)**.
- **IPN signature verification (SHA512) is mandatory.** Never switch off `lib/digistore/ipn.ts`, and set order status only through IPN events.
- **Access comes from the entitlement API.** What a Member may use is answered by `hasPlan(memberId, productKey)` / `entitlementsFor(memberId)` (`lib/entitlements/manage.ts`) — never by reading a billing table. See **Access** below.
- **No secrets in the code.** Read from `process.env` and add new variables to `.env.example`; the operator's Digistore24 credentials are read via `lib/digistore/settings.ts` — never from the database.
- **No mock/demo fallback** on Digistore API errors — throw errors.
- **Database changes only via migration.** `db/schema.ts` → `node run.mjs db-generate` → `node run.mjs db-migrate`; the file in `drizzle/` is checked in and never edited again after it has been applied. `db:push` only against an empty local DB, never against staging or production — [`docs/database.md`](docs/database.md).
- **Environments are binding: DEV / STAGING / PROD** (`APP_ENV`). In STAGING and PROD mail delivery is a start condition and the sign-in mails' sender must live on the app's own domain; the development sign-in (`lib/auth/dev-login.ts`) applies in DEV, on localhost, and only while no mail delivery is configured — never soften those three, it is an auth bypass. An unknown `APP_ENV` counts as production, and each environment sells its own Digistore24 product set.
- **Use the design system — never rebuild anything yourself.** No raw `<button>`, `<input>`, `<select>` or `<table>`, no hand-picked colour classes; what is missing gets fetched with `npx shadcn@latest add <component>`. See **UI**.
- **All visible text goes through i18n.** Every sentence lives in `messages/de.json` **and** `messages/en.json`. See **Languages**.
- **Messages always as a `Callout`** with one of its four intents, never with hand-picked colour classes. What must stay on screen is a `Callout`, what may drift past is a toast — three mechanisms, never a fourth. See **UI**.
- **Light and dark both count.** Every new piece of UI MUST be readable in both, which follows by itself as long as colours come from the tokens.
- **Tests are mandatory, and green is the commit condition rather than a courtesy** — nothing runs them for you after a push, so a red test that gets committed stays red until somebody looks. `.githooks/pre-commit` refuses on red, and a shipped test that fails is a finding about your change, never an obstacle to weaken or delete.
- **⚠️ A SKIPPED test is not a passed one.** `⏭ <file>: NOT CHECKED — <reason>` on stderr has exactly two legitimate causes — `node run.mjs agent-setup --apply`, and deleted example products emptying `config/digistore-products.json`. Anything else is a question nobody answered. Needs template 0.25.0
- **Call up the app yourself before you say "done", then ask the log.** Green tests are no proof that the page loads, and a page that loads is no proof that it rendered. See **Never ship a broken page** below.
- **Linux, macOS and Windows all count.** Every command in `run.mjs` and every script under `scripts/` MUST work on all three — a developer on Windows who cannot start the app has no way around it. See **Three systems**.
- **Commit your work — a finished change is a commit, every time.** Unfinished work too: `git commit --no-verify`, saying so in the message, and that is the flag's only legitimate use. Session artifacts (screenshots, throwaway scripts) live in `.dev/` or get deleted, never committed; at the end of a unit of work `git status` is empty and every commit was made on green. (`AGENTS.md` is generated from this file — never edit it.)
- **A checker that reads source as TEXT goes through `blankComments()`** (`scripts/lib/source-text.mjs`), and one that WALKS imports goes through `resolveImport()` (`scripts/lib/import-graph.mjs`) — never its own regex, never its own `@/` branch. Both refuse a further copy of themselves.
- 🚨 **Never write a bracketed arbitrary Tailwind class in prose — a comment is not a comment to Tailwind.** It scans every file here as RAW TEXT and emits a rule for anything that looks like a utility, so a class written to EXPLAIN that it is wrong becomes a real rule; measured, that took eight pages to 500 with typecheck and every test green. Say what the form is in words instead.
- **A type on a query is a claim, and raw SQL does not keep it.** ``sql<Date>`min(created_at)` `` is a string wearing a `Date`'s clothes — `db/sql-cast.test.ts` fails on it, and `new Date(value)` is not the way out.

## UI

The app ships with a finished design system. **There is nothing to design here — there
is something to use.** A hand-built button, table or colour makes the app not more
individual, only inconsistent: it tips over in dark mode and has no focus ring.

**A look of its own is not an exception to that rule — it is the skill `design`.**
The kit has **four dials and the list is closed**: **accent**
(`--primary`/`--primary-foreground`/`--ring`), **radius** (`--radius`), **type**
(`--font-app-sans`/`--font-app-heading`) and **elevation**
(`--elevation-raised`/`--elevation-overlay`). A dial is a **value, never a class** —
filled once in `app/globals.css` or `app/layout.tsx`, written into
`docs/design.md`, and never on a page as a `font-[…]`, a `shadow-[…]` or a bare
`shadow-lg`; 🚨 naming the role instead (`shadow-(--elevation-overlay)`) is the
sanctioned answer. Beyond the four the skill licenses nothing: no new component, no hex
class, no fourth feedback mechanism — and opening a fifth slot is a change made in the
TEMPLATE, never a decision an app makes about itself.

**The four rules that count:**

1. **Every action reports back — a `redirect()` is not an excuse.** Three mechanisms,
   never a fourth, picked by *where the result has to appear*: `<Callout>` for what must
   stay on screen, `useActionToast(state)` for a server action on the same page,
   `<FlashToast>` across a `redirect()`. **The message never travels in the URL** — the
   parameter carries a reference the receiving page looks up.
2. **Everything destructive asks first** — `<AlertDialog>`, naming *what* gets hit,
   confirm button `variant="destructive"` and never the accent.
3. **Every new page goes into the shell** under `app/dashboard/…`, one line in
   `NAVIGATION` (`components/app-shell.tsx`) plus its text in both language files, and
   its `<EmptyState>` in the same commit — empty is the state most customers meet first.
4. **Both modes, always.** Colours come from tokens, never from Tailwind palettes, and
   **every dial is set in BOTH blocks, not only `:root`** (`--radius` is the one
   deliberate exception — a corner does not change with the mode).
   `node run.mjs ux-check` fails on a token defined in one block only.

**The construction kit is `components/ui/`**, all shadcn/ui. Which component to reach for
instead of what, the mark and the five app icons, the dials in full and what is
deliberately NOT configurable: **[`docs/design-system.md`](docs/design-system.md)**. What the app owes the
person in front of it is [`docs/ux.md`](docs/ux.md), audited by `ux-gateway`.

## Languages

The app is bilingual (German, English) — **without a language prefix in the URL**.
The language comes from a cookie (toggle in the sidebar), on the first visit from
the browser; it is wired up in `i18n/`, and the texts live in `messages/de.json`
and `messages/en.json`.

**The rule: no visible text in the code.** Every sentence, label, placeholder and
error message belongs in *both* language files. Identifiers in the code, by
contrast, are **English** (`createUserAction`, `emailPlaceholder`) — the user never
sees them. `i18n/messages.test.ts` breaks the build when one language is missing a
key, a placeholder or an error code; it is the reason the second language does not
rot, and it is never switched off.

Two refusals follow from it. **Rule and database layers return codes, not
sentences** (`lib/users/rules.ts` → `"selfDelete"`) — only the Server Action
translates them, because a sentence that comes into being in `lib/` is always in
exactly one language. And **dates and prices are formatted, never spelled by
hand**: `useFormatter().dateTime(…)` or `formatPrice(def, locale)`, never
`toLocaleDateString("de-DE")`.

What is deliberately not translated, how to add a third language and the
formatting helpers in full: **[`docs/conventions.md`](docs/conventions.md)**.

## Never ship a broken page

**Before you tell the user that something is done, you MUST call the page up yourself.**
Without exception. Green tests and a successful build do NOT rule out an app that greets
the user with "Internal Server Error": `vitest` checks logic without rendering, and
`npm run build` compilability without a database or a real `.env`.

```bash
node run.mjs start                # DB + migrations + app
node run.mjs smoke                # calls EVERY page and reports server errors
node run.mjs errors               # what the log picked up — including on a 200
```

`smoke` finds the pages itself under `app/` and calls them in **two passes**: first
anonymously, then signed in, so the pages carrying the real queries get rendered
rather than counted as redirects. Its verdicts:

- **5xx** → error. Fix it, don't argue it away, don't pass it on as a "known issue".
- **307 to `/login` without a session** → correct, and says nothing about the page; the second pass is what renders it.
- **307 to `/login` *with* a session** → error. The session did not take.
- **307 anywhere else while signed in** → fine; a `hasPlan()` gate from the outside.
- **2xx** → fine.

**The second pass can be unavailable, and then it says so** — one line naming the reason. **Read that line**: "9 protected page(s) NOT checked" is not a pass.

**A 200 is not proof that the page rendered, and green means it loaded, not that it is
correct.** A bad date, a missing translation, a hydration mismatch and a promise nobody
awaited all answer 200 over a visibly broken page. That is what `node run.mjs errors`
is for, and it exits non-zero so it can gate a "done". `smoke` also skips dynamic pages
(`[id]`) and is signed in as ONE account and as nobody else, so for money, roles and
customer data a look at the page itself is part of the job — a gate needs a test or
your own eyes.

The deployed app answers both over `DIAGNOSTICS_SECRET`, and `node run.mjs health --url
https://…` asks them plus the database, the jobs, the media store and the last payment
notification (see **Local commands**). Errors that are not what they look like — a
hydration mismatch that is a browser extension, a sign-in broken by a second copy on
one machine, a fresh app whose first migration says "already exists" — are
**[`docs/troubleshooting.md`](docs/troubleshooting.md)**.

## Adding a feature

0. **Say what you are about to build, before you build it.** One or two sentences —
   what, for whom, and "done when …" in words the user can check ("a member sees their
   monthly PDF", not "implement report generation") — then **wait** for the OK. Trying
   things out is exempt. A feature too big for one session writes its plan down first,
   as a dated `Planned:` line in `docs/app.md`.
1. Extend `db/schema.ts` → `node run.mjs db-generate` → check the file →
   `node run.mjs db-migrate`; the migration belongs in the commit. Content the operator
   authors himself belongs in code, not tables:
   [`docs/content-authority.md`](docs/content-authority.md).
2. Build the protected page under `app/dashboard/…` and gate purchase-dependent content
   with `hasPlan(memberId, productKey)` — never on a billing table. A page deliberately
   OUTSIDE `/dashboard` needs its line in `app/route-protection.test.ts`.
3. Assemble the UI from `components/ui/`; `npx shadcn@latest add <component>` fetches
   what is missing.
4. **Texts in `messages/de.json` and `messages/en.json`** — both.
5. **Write tests** (`vitest`) for the new logic and rules.
6. `npm run typecheck && npm run test`, green, before the deploy.
7. **`node run.mjs start && node run.mjs smoke && node run.mjs errors`** — call the new
   page up yourself, signed in, then ask the log.
8. **`node run.mjs ux-check`**, then look at the page as the customer: empty state,
   actions that report back, readable in dark mode and at 380 px.
9. **One entry in `docs/app.md`** — the path, the access gate, the tables, the tests,
   and step 0's `Done when:` sentence, now checked rather than promised.

**CLAUDE.md describes the template, which every app gets; `docs/app.md` describes THIS
app, which nobody else has.** What is not in that file gets built a second time, and the
session greeting names anything of your own it does not mention: a page, a **table**, a
scheduled **job**. Two rules keep it worth reading: **quote the access gate, do not
describe it** (`hasPlan(memberId, "basis_monatlich")`, never "only for paying
customers"), and **write down what was decided *against*, and why** — the rejected
alternative cannot be read out of the code. The file's shape is
`.claude/skills/build-app/references/app-md-template.md`; dates and raw SQL, the
sharpest trap on the way, are **[`docs/conventions.md`](docs/conventions.md)**.

## Users & roles

The `users` table has a `role` field, and there are **three** (`lib/roles.ts` — the
canonical list, importable from a client component): `owner` is the SAAS operator and
everything `requireOwner()` guards; `moderator` is a member trusted to keep the
community's rooms clean and is **NOT an admin** (`requireOwner()` refuses them exactly
as it refuses a member); `member` is the ordinary customer and the default for self
sign-in. Only an operator hands out a role, and impersonation stays operator → member.

- **Securing admin areas:** server components MUST call `requireOwner()`
  (`lib/authz.ts`) as the first line, and **every Server Action starts with
  `requireOwner()`** too — an Action is an HTTP endpoint of its own and is not
  protected by the fact that the page is.
- **The Member's own page is `/dashboard/account`**, its actions open with
  `requireActiveUser()`, and none of them takes a user id from the form: the account
  acted on is always the session's own, which makes an IDOR impossible rather than
  merely unlikely. Build Member-facing settings there, never a second page.
- 🚨 **A role is re-read from the DATABASE at the moment of each act, never taken from
  the session** — a JWT carries what somebody was when they signed in, so
  `session.user.role === "moderator"` keeps working for hours after the role was taken
  away. Blocking (`users.blockedAt`) needs both halves for the same reason: the
  `signIn` callback stops a new sign-in, `requireActiveUser()` ends the running one.
- 🚨 **For impersonation, the record is the authorisation, not a log line.** The `jwt`
  callback rewrites the session only if the row in `impersonations` already names the
  caller as its operator — never write the row after the swap, never take a member id
  from the payload. It is narrow, visible, bounded at 30 minutes and recorded;
  automatic top-up is suppressed and the private-message surfaces are absent entirely.
- **A token package MUST NOT be handed out as a grant** — a balance is not an
  entitlement, and `hasPlan(memberId, key)` would answer `false` for such a row for
  ever. **Only manual grants can be revoked**, and that refusal lives in the `UPDATE`
  itself: purchased access ends by Digistore24 event only.

The first account becomes `owner` by itself **in DEV only**, so in STAGING and PROD the
operator creates theirs up front with `node run.mjs user-create --email … --role owner
--apply` (idempotent, dry run by default); `node run.mjs user-list` lists them. The
admin surface, the support page's three reasoned actions, the email-change flow,
passwords and impersonation in full: **[`docs/auth-setup.md`](docs/auth-setup.md)**;
what a moderator may actually do, and why private messages are private structurally:
**[`docs/community.md`](docs/community.md)**.

## Access — what a Member may use

Three functions, all in `lib/entitlements/manage.ts`, and nothing else:

```ts
import { hasPlan, entitlementsFor, planStartedAt } from "@/lib/entitlements/manage";

// One feature, one plan. A token package is a BALANCE, never an entitlement.
if (await hasPlan(memberId, "basis_monatlich")) { /* show it */ }
const owned = await entitlementsFor(memberId); // [{ productKey, source, accessUntil }]
// SINCE WHEN — what a week-by-week course unlocks against.
const startedAt = await planStartedAt(memberId, "kurs_komplett"); // Date | null
```

🚨 **Do not answer "since when" out of `entitlementsFor()`.** It is a
`DISTINCT ON (product_key)` — one row per key, chosen by purchase-beats-comp then
furthest `accessUntil`, never by age. `planStartedAt()` aggregates `min(created_at)` over
the ACTIVE grants for that key; `null` means no active grant, and an unknown key throws.

These read the app's own answer to "may this person use this", and they MUST NOT read a
billing table: a cancelled subscription keeps access to the end of the paid period. The
**event** decides — `on_payment` grants, `on_refund` and `on_chargeback` end it for
good, `on_payment_missed` suspends it reversibly, `last_paid_day` is how purchased
access normally expires, and `on_rebill_cancelled` does nothing at all.

**A Member can hold two plans at once**, because a plan switch delivers two events
days apart in either order — so always ask `hasPlan` per feature; `entitlements[0]`
is never "the plan". **A missed payment makes the plan disappear from both answers**
and is not an account closure: say "your access is paused", never nothing at all.
`accessUntil` MUST be rendered with an explicit `timeZone: "UTC"`, and `null` gets a
real sentence ("no end date").

Charging a prepaid balance is `spendTokens()` in the order **check → work →
charge** — `hasSufficientBalance()` first, because by the time the charge throws the
expensive part has already run — and it takes no member id, ever. That, the failure
modes, the upgrade mechanics and worked examples:
**[`docs/entitlements.md`](docs/entitlements.md)**.

## The AI assistant

Optional, off until switched on. The guide is
**[`docs/ai-chat.md`](docs/ai-chat.md)**; the skill that writes her handbook is
`ai-chat-knowledge`, and `node run.mjs kb-check` checks its format and prints what
one answer costs.

- **Two switches, both required.** `"enabled"` in `config/ai-chat.json` (a property
  of the PRODUCT) and a key for whichever provider her task resolves to (a property
  of the MACHINE). Always read them through `isChatEnabled()` in
  `lib/ai/chat-config.ts`, never by re-reading the JSON, and a malformed config
  switches her OFF. **Which model answers is not in that file** — that is a
  property of the TASK (`config/ai-models.json`).
- **She answers from `content/knowledge/` and from registered content sources.** No
  account data, no web — nothing about the signed-in person is ever sent to the API.
  She can LINK only to what she really looked up, enforced mechanically rather than
  by a prompt wish, and a source that would return member-scoped content into the
  chat is a deliberate, recorded decision.
- **`app/api/chat/route.ts` guards itself** with `currentActiveUser()` — `proxy.ts`
  matches `/dashboard` only, so **every** `app/api/` route is public until it
  protects itself.
- **One `ChatWindow`, two places** (the launcher and `/dashboard/chat`) with a
  different `variant` — never a second chat component for a second place.

## The knowledge corpus — what you know, before the handbook

Optional, and a layer under the assistant: existing material — videos, ebooks,
recordings — distilled into notes the handbook is written FROM. The guide is
**[`docs/knowledge.md`](docs/knowledge.md)**.

- **The corpus informs writing; it never answers at runtime.**
  `content/knowledge-sources/` is read by agents while writing, never by the app —
  no code under `app/`, `lib/` or `scripts/` may reference it
  (`scripts/knowledge-boundary.test.ts` fails the build).
- **The Licence Gate holds at intake.** Third-party material is distilled in the
  vendor's own words with the source cited — never stored verbatim; `_raw/` is for
  `own-content` and `licensed` sources only. The committed repo is already
  distribution, and the rule covers media files exactly as it covers text.
- **The chat offers only what the handbook offers**, so she can never invent a
  link; `node run.mjs kb-check` verifies every media reference before a release.

## Talking to a language model

Every model call goes through **one entry point**, and it names a TASK rather than
a model — `await runTask("chat", { system, messages, memberId })` from
`lib/ai/run`. Which of five companies answers (OpenAI, Anthropic, Gemini, Mistral,
OpenRouter) is `config/ai-models.json`, so the Operator changes it without touching
code. The guide is **[`docs/ai-providers.md`](docs/ai-providers.md)**, the skill is
`ai-providers`, and `node run.mjs ai-check` shows which task runs on which model,
whether the keys are there and what one call costs.

- **No call site ever names a provider, constructs a vendor client or reads an API
  key.** `lib/ai/providers/` is the only place that does, and
  `lib/ai/providers/leak-guard.test.ts` fails the build if that stops being true.
- **A task MUST be declared in code**: its id goes into `lib/ai/task-rules.mjs` AND
  the union in `lib/ai/tasks.ts`. Binding it in `config/ai-models.json` is optional
  — a declared task with no entry inherits `default` and works.
- **Every call is recorded in `ai_usage`** — task, provider, model, tokens,
  latency, outcome, member. No prompt and no completion is ever stored there; it is
  a numbers table, and recording never fails a call.
- **There is no spend ceiling, deliberately** — a ceiling takes the app's AI
  offline for real customers, and a hard stop belongs on the provider account.
- 🚨 **Customer-written text is FENCED, and the fence is the CORE's** —
  `buildFencedRequest()` in `lib/ai/customer-text.ts`, for every caller that sends
  a model something somebody else wrote. Only the work is fenced: anything you
  append or render around it reads as your app's own voice and must be words you
  wrote. Import it, never rebuild it.

## Scheduled jobs — work with no request behind it

Deleting data that has aged out, a nightly reminder, an overnight reconciliation.
The guide is **[`docs/cron.md`](docs/cron.md)**; `node run.mjs cron --list` says
what exists, when it last ran and what it said, and `--url https://…` asks the
DEPLOYED app the same question with no shell on the host.

- **A job is an entry in `lib/cron/jobs.ts`.** Nothing else. The schedule is
  `config/cron.json` (`everyMinutes`), the app runs it by itself while it is up,
  and `cron_runs` records what happened — no second list of jobs, no per-job
  endpoint to write. A MODULE brings its own, `cron` *and* `cronJobs` in its
  manifest, both or neither. 🚨 **Leaving a job OUT of `config/cron.json` is not
  "off"** — no entry means `JOB_DEFAULTS`, which is enabled and daily.
- **It must be safe to run twice.** The lock stops two instances taking one job,
  but a stale lock, a redeploy or an Operator pressing the button will still get
  you a second run. Deleting rows older than a cutoff is idempotent; sending a mail
  is not, unless the job records that it sent one — `claimSend()`, claim before you
  send. ⚠️ Give such a job an interval well UNDER its window: due-ness counts from
  the last FINISH, so a daily job on a UTC-day key drifts past midnight and skips a
  day in silence.
- **It returns one line of NUMBERS and throws on failure.** That line lands in
  `cron_runs.lastDetail`, so no address, no member id, no text anybody typed.
  Swallowing an error makes a broken job look like a healthy one.
- 🚨 **Operational reporting has exactly ONE producer, the job `ops-watchdog`**, and
  `lib/notify/reporter-guard.test.ts` fails the build on a second caller: a claimed
  key is spent for ever, so a second reporting job would either swallow the first
  one's finding or put two mails on one operator's morning. A check that could not
  be MADE is counted in every line it writes and never mails on its own.

## Content sources — the app's content, as something the assistant can look up

How the in-app chat searches what this app contains and points the member at the
page. The guide is **[`docs/content-source.md`](docs/content-source.md)**.

- **One registry, one interface — and TWO ways onto it.**
  `lib/content-source/sources.ts` is the list; a MODULE contributes by declaring
  `"contentSource"` in its manifest, so the core never names a module. Either way a
  second source is a second registry ENTRY, never a second search implementation,
  and 🚨 the contract stays in the CORE (`lib/content-source/types.ts`) so a module
  that breaks it fails `npm run typecheck` rather than a customer's first question.
- **One enforcement path.** Every tool runs through `runTool()` in
  `lib/ai/run-tool.ts` — the scope check, the plan gate and the token charging live
  there, in the call path. **No tool ever takes a member id**: the account is
  `ctx.memberId`, bound to the session before the handler runs, because every tool
  argument is written by a MODEL reading text somebody else may have authored.
- 🚨 **The gate is ONE function called from both the source and the page** — never
  two `hasPlan(memberId, key)` calls that agree today. A source more permissive
  than its page turns the assistant into an existence oracle: it tells a non-buyer
  that "Lektion 7" exists and hands them a link that bounces them. Nothing in the
  template can catch that; both halves are yours.
- **A media hit links the PAGE that shows the medium, never the file** — a signed
  URL expires and bypasses `mayAccess()`. And **visibility is the source's duty**:
  every method receives `viewer { memberId, role }`, and `get()` answers `null` for
  "missing" and "not visible" alike.

## Modules — what this app is made of

Most of this template is the core every app has. A few features are large enough
that an app wants them whole or not at all; those live under `modules/<id>/`, and
`config/modules.json` says which ones this app has. It **ships empty** — a fresh
app is the core and nothing else.

- 🚨 **Installed is not the same as switched on, and their 404s are
  indistinguishable.** Uninstalled, the route does not EXIST — Next never built
  one. Switched off, the route exists and the handler refuses. So a 404 here is
  never a diagnosis, and a missing feature is never evidence of an old clone.
- **`node run.mjs module list` is the one command that answers "what is this app
  made of"** — and nothing else does: a task id, a route or a config file can be
  present in an app that has no such module.
- 🚨 **A module's guidance lives in the CORE tree, never under `modules/`.**
  `node run.mjs update` addresses `CLAUDE.md`, `docs/*.md` and
  `.claude/skills/**` **by path**, so text under a module would be the one
  guidance a released app could never bring forward — and an app has to be able
  to READ about a module it does not have.

| module | to install | the full story | the playbook |
|---|---|---|---|
| community | `node run.mjs module add community` | [`docs/community.md`](docs/community.md) | `community` |
| courses | `node run.mjs module add courses` | [`docs/courses.md`](docs/courses.md) | `courses` |
| activity | `node run.mjs module add activity` | [`docs/learning.md`](docs/learning.md) | `learning-activities` |
| companion | `node run.mjs module add companion` | [`docs/ai-in-product.md`](docs/ai-in-product.md) | `ai-companion` |
| api | `node run.mjs module add api` | [`docs/api.md`](docs/api.md) | `mobile-companion` |

Then `db-migrate` — a module's tables are not there yet. The mobile companion
that talks to the `api` module is [`docs/mobile.md`](docs/mobile.md). Everything
else about the system — `remove` refusing while rows exist, the generated
registries, `slots`, what a manifest may declare — is
**[`docs/modules.md`](docs/modules.md)**.

🚨 **A `##` section in this file may condense only a subsystem present in a
pristine deploy.** A subsystem behind `module add` gets one row of that table and
nothing more: every session of every app pays for a section whether the module is
installed or not.

## Setting an environment up — your agent, over MCP

Code travels with a deploy; **rows do not**. The owner account, the rooms, the
courses each live only in the database they were made in. So your agent talks to
the **running app**, which does the work through the same code a page would use —
no production connection string in anybody's shell. `node run.mjs setup-check`
says where it stands; the guide is
**[`docs/setup-mcp.md`](docs/setup-mcp.md)**.

- **One switch, and it ships OFF.** `"enabled"` in `config/setup.json`, read
  through `isSetupEnabled()` — never by re-reading the JSON, and any unknown key
  or out-of-range value switches the whole surface off. The failure mode of this
  one is an open write endpoint on a production database, so every doubt falls
  towards closed. There is no runtime toggle: switching it on is a deploy, and so
  is switching it off.
- **Outside DEV every change is two acts** — a plan, then an apply carrying the
  one-time token the server issued. ⚠️ That stops a stale plan and a mistyped
  flag; it does **not** stop an agent calling both in a row. Whoever wants a
  human in the loop for production keeps the surface off there.
- **Every act is one append-only row** — key, operator, environment, tool,
  target, counts; never payload content. Read it on
  `/dashboard/admin/setup-audit`.

## Media — pictures, video, recordings and the files you sell

Anything the app puts in front of a customer that is not text goes through one
place, `lib/media/`. Its guide is **[`docs/visuals.md`](docs/visuals.md)**, and
`node run.mjs media-check` writes a throwaway object, reads it back, deletes it
and prints what may go in.

Six refusals, and every one of them fails **silently** when it is skipped:

- 🚨 **No SVG on this path** — it is a document that can carry script, and
  `lib/media/sniff.ts` refuses it at every door, for every kind, for every role.
  There is exactly one SVG in this app and it is not on this path: the operator's
  own logo under `public/brand/`, a build-time file that is never a `media` row
  ([`docs/visuals.md`](docs/visuals.md) → *There is exactly ONE SVG*). **A
  customer's SVG is still refused, always.**
- 🚨 **`mayAccess()` before `mediaUrlFor()`, in the same function.**
  `mediaUrlFor()` **grants nothing** — it is the step after the check said yes,
  and calling it without one is how a private file becomes public. `public` items
  come from the bucket; `owner`, `entitled` and `members` items are authorised by
  the server component **while it renders**.
- 🚨 **Every upload door calls ITS guard before it writes anything** —
  `guardUploadEntry()` and then `acceptUpload()`. The outer half is *is media on,
  is the store usable, has this member had their hourly share*; the inner half is
  *what are the bytes, may this role put that in, strip the metadata*. A door
  that calls only the second is an upload path with no rate limit and a kill
  switch that does nothing, which this template has already shipped once.
- **`<MediaUpload>` is the app's only file field.** A hand-built
  `<input type="file">` anywhere else fails the build. What a member may make
  their own is `owner` or `members`; a form may never choose `public` or
  `entitled`.
- **`MEDIA_DRIVER=local` stops the app from starting in STAGING and PROD**
  (`lib/env-guard.ts`): a local disk loses every file on the next redeploy and
  serves a customer's picture about half the time on two nodes.
- **Selling a file is a visibility and a Product Key**, not a feature:
  `visibility: "entitled"` plus `requiresPlan`, and `hasPlan()` decides. The key
  is validated when it is written, because `hasPlan()` **throws** on an unknown
  one — an unchecked value would take the page down rather than mean "no access".

## Content that must exist in PROD

**What is in the repo travels with every deploy. What is only on this machine —
the local database, anything under `.data/` — does not exist in PROD until a
command puts it there.** Each environment has its own database and its own media
store; `git push` moves neither rows nor stored files, and the migration hook
creates tables without filling them. The failure this prevents is real and
silent: a course built locally goes live EMPTY while every local gate stays
green, because an empty course page is a clean 200.

The full story is **[`docs/content.md`](docs/content.md)**; who authors content
(code, or rows through a surface) is decided first, in
**[`docs/content-authority.md`](docs/content-authority.md)**.

- **Define content as repo files from day one, never only as rows in the local
  database.** Constants in code where the vendor is the author; content files
  plus an idempotent applier under `scripts/content/appliers/` where tables are
  the right answer. Rows first and a transport later is how somebody ends up
  reconstructing what the rows were supposed to be.
- **Applying is a deliberate step, and PROD's is at go-live** —
  `node run.mjs content-publish --env prod --apply`, which needs `APP_URL_PROD` +
  `SETUP_KEY_PROD` and **no `DATABASE_URL` and no `MEDIA_S3_*_PROD`**. The shell
  pair (`content-media-sync`, then `content-apply --env prod`) is the
  **fallback**, not deprecated: it is what an operator has whose setup surface is
  switched off, and that surface ships off.
- 🚨 **`node run.mjs content-check --env prod` green is the exit condition** —
  the one check that sees what `smoke` cannot, because **an empty page is a clean
  200**. It counts nothing itself: each owner answers for its own rows, and a
  module that cannot answer is a **failure**, never a pass. Green still is not
  "it renders", which is your eyes.
- 🚨 **Product media is asked twice: a `media` row, then a `head()` for the
  bytes.** The row proves nothing — `content-publish` writes it out of the
  manifest's own numbers, so one over an emptied bucket read `✓ 1 of 1`. It costs
  one round-trip per declared file, and a lost object turns a green check red;
  intended. 🚨 **A store that did not answer is a THIRD state** — `⏭`, never a
  tick, with the reason and a count in the closing line: exit 0 there means
  nothing was found wrong, not that anything was proved.

## The salespage — the home page that sells

The route `/` **is** the app's salespage. What ships there is a placeholder
describing the template, and its structure does not carry for a real product —
re-texting its spec sheet produces a README wearing marketing copy. The skill
that replaces it is **`salespage`**; the reference is
**[`docs/salespage.md`](docs/salespage.md)**.

- **The offer block is not the `/plans` table.** `/plans` is the catalog (every
  product, compared); the salespage features ONE product and links to `/plans`
  for the comparison.
- **Nothing invented.** No made-up testimonials, member numbers, results or
  guarantees; a new product's honest proof is a founder story or no proof section
  at all. (UWG; `compliance-check` takes it seriously.)
- **One price, one place** — `formatPrice()` off the registry, and the buy button
  through `checkoutLinksFor()`, which says "checkout unavailable" instead of
  rendering a dead link.

## Plans & Digistore products

**One fork comes before every other billing question: whose Digistore24 account
gets paid.** The default — the operator is the only vendor — is fully built and is
what everything else assumes; the **platform** shape (the app's own users connect
*their* accounts) is NOT built and is not a setting. Do not build it "just in
case". Both shapes: **[`docs/digistore-integration.md`](docs/digistore-integration.md)**.

`config/digistore-products.json` is the **single source** — it feeds the plans
page *and* the sync script. **One price, one place: never a second price list in
the code**, and prices do not belong on the DS24 product at all (the API discards
`data[amount]`; `priceCents` travels with every `createBuyUrl` call). One
offering is one product **per language** and there is one product SET **per
environment** — [`docs/environments.md`](docs/environments.md).

What this app sells is `billingMode` in that same file
(`"subscriptions" | "tokens" | "both"`, read through `lib/billing-mode.ts`, never
by re-reading the JSON). Two rules make it safe to flip on a live app; the rest
is **[`docs/digistore-billing-modes.md`](docs/digistore-billing-modes.md)**:

- 🚨 **It is COSMETIC. It never decides access.** `hasPlan()`,
  `entitlementsFor()`, `consumeTokens()` and the IPN behave identically in every
  mode.
- **A mode may hide an empty thing, never a non-empty one.** Every call site is
  written `!sellsTokens() && balance === 0`, never `!sellsTokens()` alone.

**Leave `APP_URL` alone** — a non-local value switches off the development login
(`lib/auth/dev-login.ts`) and locks you out of your own app; the deployed domain
a locally-run `ds24-sync --env prod|staging` needs goes into `APP_URL_PROD` /
`APP_URL_STAGING`. **"Paid, but nothing happened in the app" has a command, not a
theory:** `node run.mjs ds24-purchase --order ABC12345`, and a *rejected* IPN is
`node run.mjs ds24-ipn-verify`.

## Local commands

Everything runs through `run.mjs` (`node run.mjs` on its own shows the overview).
Arguments go straight through — there is no `ARGS="…"` wrapping. **`node run.mjs
help --json` is the full inventory**, so the list below is the handful typed in a
normal session and never the set of commands that exist:

- `node run.mjs greet` — where this project stands and what to do next. Run it
  yourself whenever no greeting appeared — and **always, first, in Antigravity
  CLI**, which has no session-start event and so no hook.
- `node run.mjs doctor` — what has to be installed and what is missing here;
  `node run.mjs setup` gets the project ready without starting it.
- `node run.mjs start` / `stop` / `restart` / `logs` / `status` — the app and its
  database; occupied ports resolve themselves and a second start of **this**
  project aborts instead of doubling.
- `node run.mjs test` — TypeScript check + tests. `node run.mjs smoke` calls
  every page once and finds "Internal Server Error".
- `node run.mjs errors` — the errors that leave the status code at 200 (a bad
  date, a missing text, a hydration mismatch); `--url https://…` asks a DEPLOYED
  app the same question.
- `node run.mjs ux-check` / `security-check` — the countable halves of
  `ux-gateway` and `security-gateway`. Green means **counted**, not good.
- `node run.mjs db-generate` / `db-migrate` / `db-reset` — create a migration,
  apply it, or clear and reseed the local database (`db-reset` locally only).
- `node run.mjs update` — bring the **guidance** up to date, nothing else.

The npm scripts behind them remain usable; when in doubt name the `node run.mjs`
command — it works on all three systems. There is still a `Makefile`, but it only
forwards here; never point the user at `make`, it is missing on Windows.

**Which of these an app that is LIVE keeps owing, and how often**, is collected in
one place: **[`docs/operations.md`](docs/operations.md)**. Walking it is the skill
`operate`, which writes `docs/reports/operations-YYYY-MM-DD.md` every time —
**that report's NAME is the only state it creates**, and the greeting's
`[Operations: …]` line reads exactly that name, so a second place to write it down
would be a second truth to keep in step. What npm says on a customer's first
install, and which of it is real:
**[`docs/troubleshooting.md`](docs/troubleshooting.md)**.

## This app is a copy — keep its guidance current

The template this app came out of keeps being worked on. The code here is the
customer's and nobody changes it behind their back; **this file, `docs/` and
`.claude/skills/` are a different matter** — they are how you know what the app
can already do, and a six-month-old copy of them is how a shipped feature gets
rebuilt by hand, worse, beside the one that was already there.

```bash
node run.mjs update           # what would change — writes nothing
node run.mjs update --apply   # write it
```

Four properties, and knowing them is enough to use it correctly: **text only**
(`CLAUDE.md`, `README.md`, `docs/*.md`, `.claude/skills/**` — never `app/`,
`lib/`, `db/`, `config/`, `messages/`, `scripts/`, because a doc cannot collide
with a page somebody built and a `lib/` file can); **a file that was edited here
is left alone** and reported as `keep`, so house rules written into this file
survive — 🚨 do not "fix" that by overwriting them anyway; **a skill declaring
`requires:` above this app's version is refused**, because knowledge without its
code is worse than none; and **nothing is ever deleted**.

**Do not run `--apply` on your own initiative.** Show the user what would change,
say in a sentence what it is about, let them decide. The whole reasoning,
including what the update refuses and why, is in
**[`docs/updates.md`](docs/updates.md)**.

## Three systems

**This app has to run on Linux, macOS and Windows**, because Claude Code, Codex,
Antigravity and OpenCode all do — a developer on Windows who cannot start it has
no way around it. What has to be installed, where the per-system install commands
live, Docker-or-not for Postgres, and the full table of shell tools that are not
portable: **[`docs/machine.md`](docs/machine.md)** → *Three systems*.

Four refusals hold for anything you write here, and each of them breaks on
exactly one of the three systems while every gate stays green on the other two:

- 🚨 **Anything that starts, stops or finds a process is a `.mjs` script, never
  bash.** `spawn`, `process.kill` and `fs` behave the same everywhere; `pgrep`,
  `lsof`, `setsid`, `sed -i` and `openssl` do not. **Exactly one exception**, and
  it is the question the rule cannot answer — *is there a Node here at all?*: the
  `SessionStart` guard in `.claude/settings.json` asks it in shell, written
  `if ! command -v node …; then echo …; fi` rather than with `||`, so a shell
  that does not understand it prints **nothing** instead of a false warning.
- 🚨 **Never pass a `shell` option yourself** — that decision belongs to
  `scripts/lib/proc.mjs`, and `scripts/portability.test.ts` fails the build on a
  second one. `shell: true` beside an args array escapes nothing (Node 24's
  `DEP0190`).
- 🚨 **Split a file on `/\r?\n/`, never on `"\n"`.** Git for Windows checks text
  out with CRLF, and the `.env` matters most because it is gitignored — so
  `.gitattributes` never sees it. Go through `setEnvValue()` / `readEnvValue()`
  rather than parsing `.env` again somewhere else.
- 🚨 **Normalise before hashing** — `normalizeText()` from
  `scripts/dev/update-plan.mjs`. On Windows it is the difference between an
  update that works and one that silently refuses for ever.

## What the app stores about people

**[`docs/data-protection.md`](docs/data-protection.md)** is the inventory: every
table holding personal data, what reaches Digistore24 / the mail provider / the
host, what is pruned and after how long. `compliance-check` drafts the privacy
policy from it. **Keep it current when you add a table** — a privacy policy is
only as true as the list it was written from.

- **An access request is one command:** `node run.mjs data-export --email …`
  produces everything held about one person as JSON. It searches by **address,
  not by account** — the people most likely to ask are the ones who never got
  one. Do not "tidy" it into a member-scoped export, and do not strip the
  operator notes from it.
- ⚠️ **There is a second export — the member's own download from
  `/dashboard/account` — and neither may be gated on a feature switch.**
  Switching a module off DELETES nothing, so an app that ran one for a year would
  answer a subject access request with silence about data it still holds. A test
  compares the two section by section and fails the build when one grows a table
  the other lacks. **The only thing that may make a module's sections absent is the
  module being ABSENT** — and `node run.mjs module remove` refuses while its tables
  hold rows, so absent code and absent data are the same statement
  ([`docs/data-protection.md`](docs/data-protection.md) §14a).
- **Prose somebody wrote ABOUT a member is personal data** — operator notes, a
  removal reason, a report's reason. All of it is in both exports and all of it is
  emptied when that member deletes their account, while the **act** stays: a trail
  with a way to erase yourself out of it is not a trail.

## Which EU rules reach this app

**[`docs/compliance.md`](docs/compliance.md) is the map** — which regulation
applies from when, who is exempt, and what in *this* app triggers it. The skill
that walks it is `compliance-check`; `node run.mjs legal-check` reports what is
still missing. Three rules before you touch any of it:

- **The AI disclosure is law, not copy** (Art. 50(1) EU AI Act). It is a rule
  about a LIST of surfaces, and the list has two halves: `DISCLOSURE_SURFACES` in
  `lib/ai/disclosure.mjs` is the core's, and an installed module contributes its
  own. Any AI feature you add next MUST join whichever registry it belongs to, and
  mount `<AiDisclosure surface="…" />` above its transcript **unconditionally**.
- **This app needs no consent from anybody, and that is the shipped answer** — a
  purchase runs on Art. 6(1)(b), and everything it puts on the device is either
  strictly necessary or the direct result of somebody operating a switch. **Do not
  add a cookie banner.** Under § 25 TDDDG a banner where nothing tracking touches
  the device is a defect, not caution. Anything you add that writes to a device —
  `localStorage` included — joins the list in
  [`docs/compliance.md`](docs/compliance.md) § 2.
- **Deleting an account does not delete everything, and the dialog says so.**
  Orders are accounting records the law requires you to keep, so they stay with
  the member link `null`; a running subscription **warns and does not block** —
  refusing erasure because it is inconvenient is the violation.

## STOP criteria

For changes to billing logic, signature/auth checks, the export/deletion
of customer data or new external payment/data integrations: first read `guardrails`
and, when in doubt, involve a human.
