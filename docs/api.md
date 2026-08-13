<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The HTTP API — your app as a backend for your own programs

This app can expose a REST surface under `/api/v1`: your **own** programs —
typically a mobile app, see [`docs/mobile.md`](mobile.md) — sign in, get a
key, and then read and write on a member's behalf, with exactly the rights
that key carries.

It is a **module** (`modules/api/`), so a fresh app does not have it at all —
and once installed it still ships **switched off**. Installing it is a
command; turning it on is a decision that your product HAS an external client,
and the skill `mobile-companion` walks through both.

---

## The short version

| | |
|---|---|
| Getting it | `node run.mjs module add api`, then `node run.mjs db-migrate` |
| Endpoints | `/api/v1/…` — plain JSON over HTTPS, see the table below |
| Authentication | `Authorization: Bearer ds24api_…` — one key per member |
| Getting a key | `POST /api/v1/auth/token` (email + password), or the **App keys** card on `/dashboard/account` |
| Switch | `"enabled": true` in `config/api.json` — installed is not switched on |
| Errors | `{ "error": "<code>", "detail": "…" }` — the code is the contract, the sentence may change |
| Check it | `node run.mjs api-check` (`--live` mints a temporary key and really calls `/api/v1/me`) — the module brings the command, so it exists only once installed |

---

## Installing it

The surface lives in `modules/api/` and a fresh app is the core and nothing
else ([`docs/modules.md`](modules.md)):

```bash
node run.mjs module list        # is "api" installed?
node run.mjs module add api
node run.mjs db-migrate         # its own migration chain brings `api_keys`
```

`config/api.json` is **not** part of that tree and does not move — it is the
operator's file, and it stays in `config/` where every other switch is.

The **App keys** card on `/dashboard/account` arrives with the module rather
than being wired in: the module fills the core's `account` slot
(`lib/modules/slots.ts`), so the account page imports nothing of the API's and
the card fetches its own rows. Uninstalled, that slot renders nothing at all.

## Switching it on

```json
// config/api.json
{
  "enabled": true,
  "requiresPlan": null
}
```

Read it only through `isApiEnabled()` / `apiConfig()`
(`modules/api/api/config.ts`), never by re-reading the JSON. A malformed file
counts as **off** — the failure mode of this switch is an open endpoint, so
every doubt falls towards closed. `requiresPlan` names a Product Key from
`config/digistore-products.json` when the API itself is a paid feature; `null`
means every member. A token package is refused here for the usual reason: a
balance is not an entitlement.

While the API is off, every `/api/v1` path — the token endpoint included —
answers **404**, as if it did not exist. That is the shipped state, and the
deploy test asserts it against a real boot.

**Two different states answer that 404, and they are not the same thing.**
Not installed means the route genuinely does not exist: the files under
`app/api/v1/**/` are named `route.api.ts`, and such a file is a route only
while `api.ts` sits in Next's `pageExtensions` — which is exactly while the
module is installed. Next itself answers, and no handler of ours runs.
Switched off means the module IS there and the handler answers 404 on the
feature switch. From outside the two are deliberately indistinguishable; from
inside, `node run.mjs module list` is what tells them apart.

## Getting a token

**The password grant.** A program posts email and password once and stores the
key it gets back:

```
POST /api/v1/auth/token
Content-Type: application/json

{ "email": "member@example.com", "password": "…",
  "name": "My phone", "scope": "read", "lifetimeDays": 90 }
```

`201` answers `{ id, name, scope, expiresAt, secret }` — **`secret` is the
key, shown exactly once.** The table stores a SHA-256; nobody can read it
back, so a lost key is replaced, not recovered. Defaults when omitted: scope
`read`, lifetime 90 days. `lifetimeDays: null` means no expiry. Every sign-in
failure is the same `401` — wrong password, unknown address and blocked
account are indistinguishable on purpose; only `429` (rate limited) stands
out. On top of the sign-in's own limits, minting is metered per origin
(`TOKEN_MINT_LIMIT`): a credential factory deserves a narrower door than a
read.

**Members without a password** (magic-link sign-in only) cannot use this
endpoint — deliberately, not accidentally. They create a key on
`/dashboard/account` under **App keys** and paste it into their program, or
set a password there first. A device-code flow was considered and rejected
for v1: it needs a pending-authorization table, polling endpoints and a
user-code screen, and the dashboard card already covers the case.

**No refresh tokens.** Keys are long-lived and revocable; rotation is
"create a new one, revoke the old one". Scopes are `read` and `write`, and a
`read` key cannot reach any endpoint that changes data or spends money — the
refusal lives in the call path (`guardApi`), never in what is merely listed.
Per-domain scopes were considered and rejected for v1; the upgrade path is a
`scopes` column, not a redesign.

## The endpoints

Every date is an ISO-8601 string. **`accessUntil` is rendered pinned to
`timeZone: "UTC"`**, exactly like the dashboard — including on a mobile client,
which is where a device's own zone is least predictable. Why, and what it costs
when it is not: [`entitlements.md`](entitlements.md) → *`timeZone: "UTC"` is
load-bearing*.

| Endpoint | Method | What it answers |
|---|---|---|
| `/api/v1/auth/token` | POST | sign in → key (above) |
| `/api/v1/me` | GET | `{ id, email, name, role, createdAt }` |
| `/api/v1/me` | PATCH ✎ | rename yourself: `{ "name": "…" }` (`null` clears). Email has **no** endpoint — an address changes by mail confirmation only (`docs/auth-setup.md`), and that flow cannot ride a bearer key |
| `/api/v1/entitlements` | GET | `{ entitlements: [{ productKey, source, accessUntil }], paused: […] }` — from `grants`, never a billing table; `paused` is what a missed payment suspended, so the app can say "paused" instead of nothing |
| `/api/v1/tokens` | GET | `{ balance }` — zero for an account that never bought tokens |
| `/api/v1/tokens/ledger` | GET | `{ entries: […], capped }` — the member's own bookings; operator adjustments come back with `label: null` |
| `/api/v1/billing` | GET | `{ nextPaymentAt, orders: [{ …, invoices: […] }] }` — read-only; `rebillingStopUrl`/`renewUrl` are Digistore24's own self-service pages, billing state changes THERE and arrives back via IPN |
| `/api/v1/chat` | GET / DELETE ✎ | the assistant's transcript / clear it |
| `/api/v1/chat/messages` | POST ✎ | ask the assistant — the same NDJSON stream as the web chat (`{"type":"delta"}` lines, plus `tool` and `link`, then `done` or an in-stream `error`), from the same pipeline, drawing on the same per-member rate ceiling |
| `/api/v1/media` | GET / POST ✎ | own uploads / upload (`multipart/form-data`, field `file`; answers the media domain's codes). **The body ceiling is 50 MB** — `routeCeilingBytes()`, or the kind's own limit where that is lower; above it, `tooLarge` naming the number |
| `/api/v1/media/{id}` | GET | one item — `307` to a signed URL on the cloud driver; 404 for missing AND forbidden alike, deliberately |

✎ = needs a `write`-scope key.

### What a MODULE adds to this surface

The rows above are the core's, and they are there whenever the `api` module is.
Two modules contribute rows of their own, and **their endpoints exist exactly
while THEY are installed** — the declaration files under `app/api/v1/` are named
`route.courses.ts` and `route.community.ts`, so the same switch a module's pages
ride on decides these too.

Both modules therefore declare `"requires": ["api"]`: a course or a community
is installable only in an app that also has the API. `node run.mjs module add
courses` in an app without it is refused by name, and `node run.mjs module
check` says the dependency out loud on every run. That is a real cost — the
`api_keys` table and the App-keys card arrive with it — and it is the price of
the module owning its own handlers instead of the core learning about courses.

| Endpoint | Method | What it answers | Module |
|---|---|---|---|
| `/api/v1/courses` | GET | the course's shape: blocks, lessons, what has opened, what this member ticked off. **Structure only** — no lesson text and no media ids, exactly as the overview page resolves no media | `courses` |
| `/api/v1/courses/units/{slug}` | GET | one lesson: text, task prompt, media **ids**, this member's own hand-in. `403` while the block has not opened | `courses` |
| `/api/v1/courses/units/{slug}/completion` | POST ✎ | `{ "done": true \| false }` — tick a lesson off, idempotent both ways | `courses` |
| `/api/v1/courses/units/{slug}/submission` | POST ✎ | `{ "body": "…" }` — hand work in, for the accompanied workshop | `courses` |
| `/api/v1/community/groups` | GET | the rooms this member may enter. A room they may not is **absent**, never a locked entry — presence in a plan-gated room is purchase information | `community` |
| `/api/v1/community/discussions/{id}` | GET | one thread and a page of its posts (`?page=` a number or `last`, the default) | `community` |
| `/api/v1/community/live` | POST | the cursor endpoint's bearer twin — `{ "scopes": [ … ] }`, the same answer shape the web app polls | `community` |
| `/api/v1/community/discussions/{id}/posts` | POST ✎ | `{ "content": "…" }` — write into a room. Text only | `community` |

🚨 **Media never travel as an address.** A lesson hands back `coverId`,
`videoId`, `subtitleId`, `worksheetId`, and the client fetches
`/api/v1/media/{id}` for each — which asks `mayAccess()` for that viewer and
answers 404 for missing and forbidden alike. A signed URL returned from a list
would expire *and* bypass that check, which is how a paid worksheet becomes a
public one.

⚠️ **The surface carries no private messages, and the `conversation` scope is
refused by name** rather than left out. On the web app's own cookie-based twin
of this endpoint, a conversation the viewer is not in comes back in the same
neutral scope state every other refusal uses — deliberately indistinguishable
from one that does not exist, because there the question is about one member's
correspondence and any distinction is an oracle. Here the question is what this
API carries at all, which is nobody's private information, so it is answered
plainly. Nothing under `/api/v1` reads, writes, lists or counts a direct
message.

**Absent on purpose, on the same reasoning:** every authoring and moderation
surface. No endpoint creates a block, a lesson, a room or a moderation act — a
mobile companion is a viewer and a participant, and content is set up in the web
app (`docs/mobile.md`).

**A module's refusals are MAPPED, never forwarded.** `COURSES_ERROR_CODES` and
`COMMUNITY_ERROR_CODES` are i18n keys a page turns into a German or English
sentence for a person; this surface answers a program from the closed English
vocabulary above, with the cause in `detail`. So "the hand-in is empty" is a
`badRequest` and "this discussion is locked" is a `forbidden`. A module code
with no mapping answers `internal` and names it — a refusal nobody planned,
dressed as "your request was bad", sends the reader the wrong way.

**There is deliberately no token-spend endpoint.** The price of an operation
is computed in code (`spendTokens`, CLAUDE.md) — an endpoint taking an amount
from the wire would hand the price to the caller. Paid API operations charge
internally, the way a charging chat tool does.

### The chat stream's line types

One JSON object per line. Unknown types are ignored by design, which is what
makes new ones additive:

| Line | Meaning |
|---|---|
| `{"type":"delta","text":"…"}` | a piece of the answer |
| `{"type":"tool","name":"…"}` | she is looking something up — the NAME only, never the input |
| `{"type":"link","marker":"…"}` | a page THIS answer may link to |
| `{"type":"done"}` | the answer is complete and stored |
| `{"type":"error","code":"…"}` | a code from `lib/ai/rules.ts` |

**`link` is the whitelist for `[link:path|label]` markers in the text**, and
a client that renders them needs it. Two properties are guaranteed and worth
building on: every `link` line arrives strictly BEFORE the `delta` that carries
its marker, and a marker that never appeared in a `link` line is one the model
made up. `GET /api/v1/chat` returns the same set per stored message, as
`links` (`null` for a question and for anything written before the feature) —
so a reloaded transcript renders exactly what the live stream did.

A client that ignores `link` lines shows the marker as literal bracket text —
the same degradation `[media:…]` already has there. What it must NOT do is
render a marker it never saw whitelisted: that is the whole control, and
without it a model can point your users at anything it can spell.

**The marker, and the three rules a client implements it by.** A marker is
`[link:<path>|<label>]` — nothing else is one:

- **Match the WHOLE string, never a part of it.** Compare the complete marker
  as it appears in the text against the complete string from the `link` line.
  Matching on the path alone, or on a prefix, is the one mistake that undoes
  the feature: the label would then be free text, and a model that gets to
  write the label over a whitelisted destination can put any pretext it likes
  on a real link. The label is composed on the SERVER from the content's own
  title, and whole-string matching is the only reason that guarantee survives
  the trip to your client.
- **Render the label as one text node.** Do not parse markup inside it, do not
  translate it, do not shorten it. It is already bounded (120 characters) and
  already free of control, zero-width and bidi characters — because the server
  refused to compose a marker that was not.
- **The path is app-relative and safe to route on, but do not re-derive it.**
  It carries `A-Z a-z 0-9 _ - /` plus at most one `#slug`, so it can never be
  an absolute URL, another host, a `javascript:` scheme, a traversal or a query
  string. Navigate to it inside your app; never turn it into an outbound link
  and never concatenate it onto a base URL you chose.

A marker that parses but is not in the whitelist is not an error and not
something to log loudly — it is the model having invented one, and the correct
behaviour is to leave it on screen as the bracket text it is.

## The envelope, and what a client may rely on

Success bodies are plain JSON, no wrapper. Errors are:

```json
{ "error": "planRequired", "detail": "This account's plan does not include the API." }
```

`error` is stable and English — match on it. `detail` is a courtesy for the
developer reading a network tab and may change wording at any time. The codes
(`modules/api/api/rules.ts`): `apiDisabled` `badRequest` `forbidden` `internal`
`notFound` `originForbidden` `planRequired` `rateLimited` `scopeReadOnly`
`unauthorized` — appended to, never renamed. They are deliberately **not** in
`i18n/messages.test.ts`'s registry: that registry is for the codes a MEMBER is
shown in their own language, and the caller here is a program that matches on
the string. The media endpoints answer the
media domain's own codes (`lib/media/rules.ts`) in the same envelope shape,
and the chat stream carries the chat codes (`lib/ai/rules.ts`) — one refusal
vocabulary per domain, shared with the web app by construction.

`/api/v1` is **additive**: new fields and new endpoints may appear at any
time, nothing documented here is removed or retyped. A breaking change would
be a new `/api/v2` folder beside this one, not an edit to v1.

## ⚠️ Every route guards itself

**`proxy.ts` protects `/dashboard` and nothing else. Everything under
`app/api/` is PUBLIC until it protects itself.** For the v1 surface that
protection is `guardApi()` (`modules/api/api/guard.ts`), called as the **first
line** of every handler:

```ts
export async function GET(request: Request): Promise<Response> {
  const g = await guardApi(request);           // ← first line, always
  if (!g.ok) return g.response;
  // g.memberId, g.scope, g.role — proven, never from the request
}
```

It checks, in order: origin (DNS-rebinding guard) → feature switch (404 when
off) → failed-auth limit → the bearer key, audience-bound (`ds24api_` only —
a key with a foreign marker never reaches the database) → per-member call limit
→ `requiresPlan`/`hasPlan()` → write scope where the handler asked for it.
Every flavour of "no key" is one identical 401; the reasons live in the
server log only. **Never hand-roll those checks in a route** — a handler that
asks four of the eight questions looks exactly like one that asks all eight.

The prefix is only the cheap half of the audience check: behind it the key's
own `audience` column has to say `api` too, so a credential cannot widen by
being pasted somewhere else. **A second key-bearing surface added later gets
its own audience, never this one.**

Two invariants ride on that, and they are the surface's whole security story:

- **No endpoint ever takes a member id.** The account read or written is the
  key's owner, bound by `authenticate()` before the handler runs — the same
  guarantee `spendTokens` gives a Server Action. An id in a query string or
  body is ignored by construction.
- **`modules/api/routes/guard-presence.test.ts` fails the build** on any v1
  handler that does not call `guardApi` (the token endpoint is the named
  exception — its caller has no key yet; its protection is the password check
  plus the mint meter). The middleware footgun is structural, not a review item.

## Adding an endpoint

Deliberately a section, not a skill — it is five steps, and the last is the
one that keeps the surface honest:

1. **Put the logic in `lib/<domain>/`**, split rules/manage like everything
   else. The endpoint must stay a thin caller — if the web page and the API
   cannot share the function, the function is in the wrong place.
2. **Write the handler as `modules/api/routes/<name>.ts`**: `runtime =
   "nodejs"`, `dynamic = "force-dynamic"`, `guardApi()` first line —
   `{ scope: "write" }` for anything that changes data, spends money or sends
   mail. Serialize every `Date` to ISO at the boundary.
3. **Declare the route in one line**: `app/api/v1/<name>/route.api.ts`, doing
   nothing but `export { GET } from "@/modules/api/routes/<name>"`. Next scans
   `app/` and nothing else, so the declaration has to live there physically —
   and the `.api.` in its name is what makes it a route exactly while the
   module is installed. It holds no logic; `modules/boundary.test.ts` fails
   the build on a handler written into that file instead.
4. **Answer `apiError(code, detail?)`** from the existing vocabulary; extend
   `API_ERROR_CODES` only for a genuinely new kind of refusal.
5. **Write the colocated test** beside the handler in `modules/api/routes/`:
   guard-first (a refused request reaches no query), the response shape, and —
   for anything member-scoped — that a `memberId` in the request changes
   nothing. `guard-presence.test.ts` picks the new file up by itself.

## No CORS, on purpose

No `/api/v1` response carries `Access-Control-Allow-Origin`, so a **browser**
on another origin cannot call this API — the browser has the cookie surface,
and a cookie-bearing cross-origin API is a CSRF story this app refuses to
start. Native apps and servers are not subject to CORS and simply work. The
`Origin` header IS still checked when present (DNS-rebinding guard,
`modules/api/keys/http.ts`) — absent is fine, foreign is 403.

## Limits, and one caveat worth knowing

Per member: 120 calls/min across all keys (metering per key would let anybody
multiply their own ceiling by minting more). Per origin: 30 failed
authentications / 15 min, 10 token mints / 15 min. Chat and media draw on the
same per-member buckets as the web app — one member, one ceiling, regardless
of the door.

**One size ceiling, named rather than inherited: 50 MB on an upload body**
(`ROUTE_HANDLER_BODY_LIMIT_BYTES` in `lib/media/rules.ts`). It is not the
per-kind number in `config/media.json`, which says what may be STORED and is
2 GB for video — this door reads the whole body into the process before
anything is checked, so it is what the app is willing to buffer. It is not
`bodySizeLimit` either: that is a Next **Server Action** setting and a route
handler never sees it. Anything larger goes the direct-to-bucket way
(`docs/visuals.md`), which `/api/v1` deliberately does not expose — a
three-request upload over a bearer-key surface is its own decision with its own
shape.

⚠️ All of it counts **in process memory**: behind a load
balancer every limit multiplies by the instance count. Known, accepted, and
the same trade the sign-in limits already make — a Redis-backed limiter is
the upgrade path if it ever matters.

## What this is not

Rejected for v1, each on purpose — reread the reason before building one:

- **OAuth / device-code flow** — disproportionate machinery; the dashboard
  card covers the passwordless case.
- **Refresh tokens** — long-lived revocable keys, rotation by replacement.
- **Per-domain scopes** — `read`/`write` mirrors what the dashboard can do;
  the upgrade is a column, not a redesign.
- **A token-spend endpoint** — the price is computed in code, never taken
  from the wire.
- **CORS headers** — see above; browsers use the cookie surface.
