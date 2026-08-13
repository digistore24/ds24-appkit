<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# `code` — the check recipes

Part of the skill `security-gateway`, check 2 (`code` — access control).
SKILL.md holds the file list and the dispatch; this file holds the per-surface
recipes. Severities and the format of a finding are defined in SKILL.md.

### Protection is opt-in, and that is the trap

What guards a page is **`authorized()` in `auth.config.ts`**, and it returns
true for every path outside `/dashboard`. **A route outside `/dashboard` that is
not on the list below is public by accident, not by design.**

🚨 **Do not subtract the `matcher` — it is not a list of protected paths.**
`proxy.ts` matches five entries and four of them are fully public; they are
there so a cookie sweep reaches the pages a signed-out person opens
([`docs/auth-setup.md`](../../../../docs/auth-setup.md) → *Which routes are
protected*). An earlier version of this recipe said "subtract the matcher", and
that is the one sentence that would make this check miss the thing it exists to
find: somebody who believes a matcher entry protects a page adds one, and an
audit that subtracts the matcher then agrees with them and looks away. Subtract
`/dashboard`, and nothing else.

Public on purpose, and this list is exhaustive: the home page, `/login`,
`/plans`, `/optin/*`, `/account/confirm-email`, the legal pages
(`/impressum`, `/datenschutz`, and `/agb` / `/widerruf` where they exist),
`/api/ipn`, `/api/healthz`, `/api/readyz`, `/api/cron`.

The legal pages are public **because they have to be** — § 5 DDG wants the
Impressum easily reachable, and a privacy policy behind a sign-in cannot be read
by the person deciding whether to sign in. Do not "fix" them into `/dashboard`.

So: list every route in `app/`, subtract everything under `/dashboard`, subtract
that list. What is left is a finding — **HIGH**, and **CRITICAL** if it renders
customer data. When a route is public on purpose, it goes into the list above in
the same change, or the next audit reads it as an accident.

⚠️ **`app/route-protection.test.ts` is not a substitute for this check.** It
forces a DECISION per route — under `/dashboard`, or named in its `PUBLIC` list
with the mechanism that guards it instead — and it says of itself that it never
verifies the guard WORKS. A route parked in `PUBLIC` with a reason that names no
real mechanism passes it and is exactly what this check is looking for.

`/account/confirm-email` is authenticated by its single-use token, not by a
session, because the mail carrying it is read on whichever device holds the
inbox. Putting it behind `/dashboard` breaks the feature for exactly the person
it exists for. Leave it.

### IDOR — reaching another member's data

Every query on a customer-owned table needs an ownership condition. The column
is **`memberId`** — on `orders`, `grants`, `subscriptions`, `tokenAccounts`,
`chatMessages`, `apiKeys`, `impersonations`. `userId` exists only on the Auth.js
`accounts` and `sessions` tables and is **not** an ownership column; grepping
for it finds nothing and proves nothing.

Read every server action and every route handler and ask one question: *does
this query say whose row it is?* A `where eq(orders.id, id)` with an id from the
form and no `memberId` is a **CRITICAL**.

**A server action is an HTTP endpoint.** The button only rendering for a
signed-in member is cosmetics; anybody can POST to the action directly. So every
action re-checks `auth()` itself — `app/plans/actions.ts` is the pattern to
copy. An action that trusts the page that rendered it is a **HIGH**.

**Admin actions need `requireOwner()`** (`lib/authz.ts`), inside the action, not
in the page. Everything under `app/dashboard/admin/` is in scope.

### Entitlement, not billing tables

What a member may use is answered by `hasPlan(memberId, productKey)` from
`lib/entitlements/manage.ts`. A hand-rolled query over `orders` or
`subscriptions` is a finding — **HIGH**, and not a stylistic one: those tables
answer a different question, and a cancelled subscription that still has paid
time left reads as "blocked" there. See `docs/entitlements.md`.

No cached access booleans either — not a flag on the user row, not a claim in
the session. Entitlement is derived per request; a stored yes survives the
chargeback that should have revoked it.

### The assistant's tools

Go through `lib/ai/tools.ts` tool by tool — above all when the app has
registered tools of its own beyond the four shipped `content_*` tools. What a
tool returns is read, and acted on, by a model; what it takes as arguments is
written by one. See `docs/content-source.md`.

- **No tool takes a member, user or account id as an argument.** The account is
  `ctx.memberId`, proven by the session. Arguments are written by a model
  reading text somebody else may have authored — an id among them is an IDOR
  with a language model holding the pen. **CRITICAL.** `lib/ai/tools.test.ts`
  checks the obvious spellings; read the schemas yourself for the ones it
  cannot guess.
- **`readOnly: true` is a lie on anything that writes, charges, mails or calls a
  paid API.** It is the boundary a read-only runner is measured against
  (`lib/ai/run-tool.ts`), so a wrongly-flagged tool is a read-only caller that
  can spend somebody's balance. **HIGH.**
- **Every argument is re-validated in the handler.** `inputSchema` is a hint to
  a model, not a check — treat `args` exactly like a `FormData`. **HIGH.**
- **No operator capability is exposed.** No tool blocks a user, adjusts a
  balance, grants a plan, deletes a record, sends mail or places an order.
  Anything `requireOwner()` guards belongs nowhere in that file. **CRITICAL.**
- **No tool returns a secret** — no API key, no `passwordHash`, no other
  member's data. And member-scoped content flowing into the chat is a
  recorded decision (`docs/app.md`), never a default. **CRITICAL.**

### The community, if it is installed and switched on

The community is a MODULE, so ask first whether this app has it at all:
`node run.mjs module list`. An app without it has no community routes and no
community tables, so there is nothing here to check — skip the section.

Installed, check `config/community.json` next. If `"enabled"` is false, the whole
surface answers not-found — and **that is itself a check**: walk `/dashboard/community`,
`/dashboard/admin/community`, one discussion URL, one server action in
`modules/community/pages/**/actions.ts` and `POST /api/community/live`. Anything
but a not-found in that state is 🚨 **CRITICAL** — the switch is this module's
incident response, and a switch that leaves a door open is not one.

Switched on, this is the app's largest personal-data surface, and the IDOR hunt
above covers **every** one of its routes. Five probes on top of that read, each
of them a thing no other gate catches:

- **A non-participant reading a private message.** Every read of
  `community_conversations` / `community_messages` takes a participant's member
  id and puts it in the `WHERE` clause. Read the calls in the app's own code:
  a conversation id from a URL with no participant scoping is 🚨 **CRITICAL**.
  The shipped `modules/community/lib/dm-guard.test.ts` refuses a new unscoped reader —
  so **a finding here almost always means somebody added an allowlist entry or
  weakened that test.** Check its allowlist and its git history before
  believing a clean read.
- **A non-entitled member reading a gated discussion — by embed.** Every
  declaration in `modules/community/lib/embeds.ts`: request the discussion for a
  Subject Key the member is not entitled to, and for one nobody declared. Both
  must give the **same** refusal; a distinguishable "no such discussion" turns
  Subject Keys into an enumerable table of contents. ❌ **HIGH**. And check no
  page passes an access level or a plan key as a prop — a gate the browser
  sends is no gate: 🚨 **CRITICAL**.
- **The live channel.** `POST /api/community/live` with a cursor for a scope
  the viewer may not enter, and with no session at all. It must re-derive
  access per answer, not per connection, and it must write nothing. An answer
  carrying rows from a room the caller cannot enter is 🚨 **CRITICAL**.
- **Activity leaking out of a space the viewer cannot enter.** The friends feed
  (`/dashboard/community/feed`) and every unread indicator: a room the viewer
  may not enter contributes nothing — not a post, not the room's name, not a
  thread title, not a count, not a gap in the ordering. An indicator that lights
  up is a second, cheaper access path into a paid room: ❌ **HIGH**, and 🚨 when
  it reveals content.
- **An impersonated session.** Start one and open the community: the rooms work
  as the member, and the private-message surfaces are **absent** — the same
  not-found a switched-off feature gives. Anything readable there is 🚨
  **CRITICAL**: the impersonation record says an operator was in an account, not
  what they read.

Two more reads while you are in the module, both of them the kind of thing that
gets added by a well-meaning session:

- **A member list, a member count, a "who is here", or a follower count**
  anywhere — profile, room, operator page, export. Presence in a plan-gated
  room IS purchase information. ❌ **HIGH**, and the shipped
  `modules/community/lib/follow.test.ts` should have refused the counter, so check
  whether it was weakened.
- **Moderation authority taken from the session.** `session.user.role ===
  "moderator"` anywhere is ❌ **HIGH** — a JWT carries the role somebody had
  when they signed in, and every act must call `moderationAuthority()`, which
  re-reads the database.

The reference for all of it is [`docs/community.md`](../../../../docs/community.md).

### Signing in as a user, if it is on

Check `config/impersonation.json`. This feature deliberately rewrites the
subject of a signed-in session, so it **will** look like an auth bypass on first
reading. It is a legitimate, bounded support feature — the description is in
`guardrails`. What you are auditing is whether it is still bounded. Each of
these is a finding:

- **The `jwt` callback believes the update payload.** `/api/auth/session` takes
  a POST from any signed-in user and its body reaches that callback.
  `lib/impersonation/session.ts` must look the record up by id and rewrite the
  session only when `row.operatorId === token.sub`. A `token.sub =` fed from
  anything in the payload is a full account takeover — any member becomes any
  other, including an owner. **CRITICAL.**
- **The record is written after the session changes**, or not at all. The row
  *is* the authorisation, not a log line. Reordering it removes the check.
  **CRITICAL.**
- **An owner can be impersonated.** `canImpersonate()` must refuse
  `target.role === "owner"` in the rule, not merely by hiding the menu entry.
  **HIGH.**
- **The exit action calls `requireOwner()`.** This one is inverted: during an
  impersonation the session's role *is* the member's, so an owner check there
  locks the operator inside a customer's account. Its absence is correct.
- **The switch fails open.** A malformed `config/impersonation.json` must count
  as off. **HIGH.**
- **The banner is conditional on a route.** It belongs in the root layout, on
  every page including the public ones. **MEDIUM.**
- **Automatic top-up is not suppressed** during an impersonation
  (`lib/tokens/spend.ts`) — a support click would charge a customer's card.
  **HIGH.**

`lib/impersonation/guard.test.ts` asserts several of these against the source
text. If it has been deleted or weakened, that is the finding.

### Input, output, and the four fingerprints

- **Validate every input.** Server actions and route handlers take
  `FormData`/JSON from the network. Required fields, types, limits — `zod` is
  already a dependency. Missing validation on anything that reaches the database
  is **HIGH**.
- **Drizzle only.** Queries go through Drizzle (parameterized). A template
  literal inside `sql\`\`` carrying a user value is SQL injection — **CRITICAL**.
  `db/sql-cast.test.ts` guards part of this.
- **No `dangerouslySetInnerHTML`.** The assistant's answers are markdown, and
  `lib/ai/markdown.ts` parses them into React elements precisely so that no HTML
  is ever interpreted — the comment at the top of that file says so. If anyone
  has "improved" it with a markdown library plus `dangerouslySetInnerHTML`, that
  is **CRITICAL**: the text comes from a language model that read the
  customer's own handbook and the customer's own messages, and prompt injection
  into a DOM sink is the whole attack. Same for any place foreign text is
  rendered — buyer names, product titles, chat content.
- **Compare secrets in constant time.** Any token, API key, HMAC or signature
  compared with `===`, `!==` or `strcmp` is a timing side channel — the value
  becomes guessable byte by byte. The template does this correctly in
  `lib/digistore/ipn.ts`, `modules/api/keys/keys.ts` and `lib/credentials/hash.ts`
  (`crypto.timingSafeEqual`, after a length check). A new comparison that does
  not is **HIGH**.
- **Random that is not random.** `Math.random()` or `Date.now()` as the source
  of a token, key, password or invite code is guessable. `randomBytes` /
  `randomUUID` from `node:crypto`. **HIGH.**
- **Do not log secrets or personal data.** Tokens, passwords, API keys, buyer
  addresses in `console.log` — **MEDIUM**, **HIGH** if it is a live credential.
- **Never pass server-side values into client components.** A `"use client"`
  component receiving an env value as a prop ships it to the browser.
  **CRITICAL** if it is a secret.
