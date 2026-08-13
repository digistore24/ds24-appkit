<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Setting an environment up — your agent, over MCP

Your code travels with every deploy. **Your rows do not.** A course you built on
your laptop, a community room you created, the owner account you signed in
with — all of that lives in the database of the environment it was made in, and
`git push` moves none of it ([`environments.md`](environments.md)).

Until now the answer was a shell command with the production connection string
in it. This is the other answer: your coding agent talks to the **running app**
and asks it to do the work.

```
your agent  →  scripts/mcp/server.mjs  →  https://your-app/api/setup  →  the database
```

The server never opens a database connection of its own. Every write goes
through the same code a page in the app would use — same transactions, same
guards, same refusals.

---

## The short version

| | |
|---|---|
| Getting it | already wired — a fresh clone ships the MCP server registered for all four programs |
| Switch | `"enabled": true` in `config/setup.json` — **ships off**, and switching it on is a deploy |
| Key | one per environment, minted on `/dashboard/admin/setup-keys`, shown once, stored in `.env` |
| Environments | `development` · `staging` · `production` — each with its own key |
| Check it | `node run.mjs setup-check` (`--live` really calls a read tool) |
| Every act | one row in the audit trail, readable on `/dashboard/admin/setup-audit` |

---

## Why this is not `/api/v1`

🚨 **This is the app's THIRD delivery layer, and the only one that takes ids.**
Pages serve a human on a session. `/api/v1` serves a member's own program and
**never** accepts a member id, which is exactly what makes an IDOR impossible
there ([`api.md`](api.md)). This one serves the operator's agent and **does**
accept ids, because acting on somebody else's row is the whole job.

So it deliberately does not live in `modules/api/`: one `memberId` parameter over
there would break that surface's entire security story, and the two would then be
one codebase with two contradictory rules about the same word.

## What it can do

The surface is **enumerated**: a capability that is not a listed tool does not
exist. Ask your agent to run `list_modules` against an environment and it will
tell you what that environment actually has.

These are the **core's**, and every app has them — an installed module adds its
own below.

| Tool | |
|---|---|
| `list_modules` | which modules are installed **there**, and how each switch stands |
| `list_environment` | which environment, which template version, migrations, media store |
| `user_upsert` | create or update a user by email |
| `user_list` | who exists, optionally by role |
| `grant_by_hand` | give somebody a plan by hand — needs a written reason |
| `grant_revoke` | end a manual grant — **irreversible**, needs a written reason |
| `media_upload` | put a local file into that environment's media store |
| `content_presence` | does that environment hold what it should — each owner answers for its own rows |
| `content_publish` | mode `plan`: what publishing this repo's content into that environment would do, and it writes nothing. Mode `apply`: it publishes — media rows, the files the image carries, then every applier |
| `content_media_url` | mint a short-lived address for writing **one declared product-media file** straight into that environment's store — or answer *found*, and mint nothing, when it is already there |
| `content_media_confirm` | read back what landed at that key, and assert that file's `media` row |
| `list_acts` | what this surface has done there lately |

⚠️ **`content_presence` and `content_publish` take no argument at all — their
input schema is EMPTY.** What gets published is what the repo declares, applier
by applier; a tool that could be pointed at a table, a slug or a statement is the
general-purpose one SECURITY.md §8 refuses, and an empty schema is how that
refusal is expressed rather than merely intended.

**Media never travel through the model.** You give the tool a **path** on your
machine; the MCP server reads that file and posts the bytes to
`/api/setup/media`. A base64 field would put a video into the transcript, the
context window and the bill — so there is none, and no tool's schema has one.

**The last two are a stronger form of that, not a repeat of it.** Neither reads
a local file at all: the bytes go from your machine **straight to the bucket**,
so `scripts/mcp/server.mjs` needs no branch for them — **and the operator needs
no bucket credential of their own**, which is the property that makes filling a
production store something an agent can do at all. What reaches the app is
a manifest path, a length and a hash. You do not call them by hand — 
`node run.mjs content-publish` is the flow that uses them in the right order
([`content.md`](content.md)).

Five things about that pair:

- **They place declared product media and nothing else.** Their only field is a
  `path`, and a path `content/media-manifest.json` does not declare is refused.
  So the key space they can reach is the closed set the repo declares, never one
  a caller names — the same line SECURITY.md §8 draws around a SQL tool.
- **Why the bytes do not go through `media_upload`.** They cannot. That tool's
  key is DERIVED by `storageKey()`, which *throws* on `content` — a reserved
  namespace, because the applier route owns that prefix — so a file uploaded
  through it lands where no lesson can resolve it. And the multipart door
  buffers the whole part against a 50 MB route ceiling, which a lesson recording
  does not fit through.
- **Two acts, two audit rows, deliberately** — where a whole publish is one. The
  mint is where a writable capability was handed out; the confirm is where a row
  was written, minutes and a large upload later. NFR-58 says one row per *act*,
  not one per file.
- **What the rows carry:** the manifest **path** as the target (an identifier,
  the same class as an email or a slug), and `rows` — `0` for the mint, `1` for
  the confirm. 🚨 No address, no signature, no query string, no token, no bucket
  name. The trail is identifiers and numbers; a signed URL in it would be a
  writable capability sitting in a table.
- **A bad landing is refused *and undone*.** A length that disagrees with the
  manifest is a refusal naming both numbers, and the object is removed; so is one
  whose first bytes are not the kind its extension implies. An object of the
  wrong length under a deterministic key is worse than none — `content-check`
  would HEAD it and call the file present. ⚠️ The confirm step does **not**
  verify the `sha256` of what landed, and says so: that would mean reading the
  object back, which is the whole cost this path exists to avoid.

**A plan writes nothing, and Postgres is what says so.** `content_publish` in
mode `plan` asks every applier this app ships what a `content-apply` against
*that* environment would create and change, and asks the media store what it is
still missing. Each applier's `plan(sql)` runs inside a transaction whose first
statement is `set transaction read only` ([`content.md`](content.md)), so a
write inside one is refused by the database rather than by our good intentions —
and it is reported as that applier's problem instead of taking the report down.
An applier that has no `plan(sql)` is reported as *"does not say what it would
change"*, never as *"nothing to do"*: those are two different answers and only
one of them means the environment is fine.

**And `mode: "apply"` publishes.** Three steps, in an order that is not
stylistic: the media rows the manifest declares, then the files the image
carries into that environment's own store (HEAD first, so a re-run copies
nothing), then every applier — each inside its own transaction, the core's first
and then each installed module's. Without the rows first, every `mediaIdFor()` in
every applier throws by name ([`content.md`](content.md)).

Four things worth knowing before you point it at production:

- **The whole run refuses rather than passing over anything, and it refuses
  BEFORE it writes.** Every applier is enumerated, imported and checked for an
  `apply()` first; only then does the first transaction open. A refusal found
  after the first applier committed would not be a refusal — it would be a
  partial run with an explanation.
- **A throw rolls THAT applier back whole**, is named in the answer, and the run
  carries on to the next one. What committed stays committed.
- **A long publish is bounded** by a 25-second wall clock, checked *between*
  appliers and never inside one. When it runs out the run stops and the answer
  **names the appliers it never reached** — never a bare "Done". A retry is safe:
  every applier upserts, so the second run creates less.
- **The exit condition is `node run.mjs content-check --env <env>`**, and the
  answer names it with the environment filled in. Green there means the rows and
  the files are *present* — not that the page renders. That is your eyes, on one
  real content page with a real slug.

🚨 **What the confirmation token does NOT buy.** It proves the server was
consulted with *this* call at *this* moment — the input, and at the media door
the bytes as well (see *the two-act rule* below) — and nothing else. It does
**not** prove a human agreed — an agent calls plan and apply in a row, which is what an
agent does — and it does **not** prove the plan's report is still true. The
shell path (`node run.mjs content-apply`) stays and is not deprecated: an
operator whose setup surface is switched off still has it, and a surface that
ships off cannot be the only way to fill an environment.

**A module brings its own**, and they belong under the same sentence as the
table above — so they are named rather than left to be discovered:

| Tool | | From |
|---|---|---|
| `community_group_upsert` | create or update a room, so the rooms you designed locally can exist in production | `community` |
| `community_group_list` | which rooms that environment has, and how each is gated | `community` |
| `courses_outline` | the course it holds — every block with its lessons, each lesson carrying a **fingerprint** so you can see WHICH one differs from your files without downloading any of them, and each row carrying the `origin` that says whose row it is | `courses` |

A module that is not installed contributes nothing — the same statement
`node run.mjs module list` makes about its commands.

⚠️ **`courses_outline` reads and does not write, and that is not an omission.**
A course's blocks and lessons belong to the applier route, from
`content/course/*.json` in the repo, keyed by slug — one writer per row class
(spine AD-82; [`content-authority.md`](content-authority.md)). `content-apply`
**re-asserts every block and every lesson on every run**, so a lesson typed
through a tool would be silently overwritten by the next publish; no such tool
exists, and `content_publish` triggers that applier rather than becoming a second
author of a row it owns.

**That is the general rule and not one tool's quirk: a module's setup tools are
READS.** Whoever adds a module writes a reader for the rows the repo owns and a
writer only for rows no applier claims.

## What it deliberately cannot do

Read this before asking why something is missing. Each of these is a decision,
not a gap:

- **No SQL, no schema changes.** One general-purpose tool would make every other
  control here decoration. Schema travels with your code, in `drizzle/`,
  reviewed, applied by the deploy hook.
- **No `owner` outside DEV.** `user_upsert` refuses `role: "owner"` in staging
  and production. Making somebody an operator stays something a human does on
  `/dashboard/admin/users`. See *Why* below.
- **No deleting members.** Erasure already has its own paths — the member's own
  account page, `node run.mjs data-export` for a subject access request.
- **No reading private messages.** The community's private conversations have no
  reader outside the participants, anywhere in this app, and this surface is not
  an exception.
- **Nothing outside the database.** Not your code, not `config/`, not `.env`.
  Those travel through git and your host's secrets, both of which have review.

## Environments, and the two-act rule

Every call names the environment it is for, and **the app checks that against
its own** — if they disagree it refuses. You cannot write to production
believing you are on staging.

⚠️ **The claim is compared against the three literals `development` | `staging` |
`production`, and never normalised through `appEnv()`** — that helper maps
anything it does not recognise to `production`, so normalising here would wave a
garbled claim through on exactly the environment this protects. And an **absent**
`APP_ENV` on the app's side is refused rather than resolved: `appEnv("")` is
`development`, so a deployed host that lost the variable would otherwise be handed
every DEV relaxation, including `role: "owner"`.

In **staging and production**, changing anything takes two steps:

1. your agent asks for a **plan** — what would change, against the real database
2. it applies that plan with a one-time token the server issued, valid ~2 minutes

In **development** a change applies in one step.

**What the token is bound to:** your key, the tool, the environment, the exact
input the plan was made with — and, at the door that carries a file, **that
file**. Change any of them and the apply is refused; the token is not spent, so
the answer is simply to plan again.

🚨 **The file half is not symmetry, it is the point of the rule at the one door
where the input is a label.** `media_upload` takes a `path` on *your* machine
which the app never opens; what actually lands in the store arrives beside it as
bytes. Bound to the input alone, the second act confirmed the label: a plan
reading *"hero.png (70 bytes) would be stored as public"* could be applied, with
its own token and the same `path`, carrying a completely different file — and the
app stored that one, `200 created: 1`. Measured, and closed. ⚠️ One
consequence you may meet: your agent reads the file once for the plan and again
for the apply, so a file that **changes on disk in between** is now refused
rather than uploaded. That is the rule working; plan again.

> ⚠️ **A token minted for an upload cannot be used on the plain `/api/setup`
> door.** It never worked there — that door carries no bytes, so `media_upload`
> refused it anyway — but it used to *spend* the token first, which cost you the
> plan. Now it is refused before anything is spent.

> ⚠️ **What the two-act rule is and is not.** It stops a stale plan and a
> mistyped flag. It does **not** stop an agent that simply calls both steps in a
> row, because that is what an autonomous agent does. If you want a human in the
> loop for production, do not rely on this — keep the surface switched off there
> and do those changes on the pages yourself.

## The key

Minted on `/dashboard/admin/setup-keys` by an owner, **in the environment it
acts on**, and shown exactly once. Put it in `.env`:

```bash
SETUP_KEY=ds24setup_…            # this machine's environment
SETUP_KEY_STAGING=ds24setup_…
SETUP_KEY_PROD=ds24setup_…
```

🚨 **Never in a file git tracks.** The shipped wiring contains the command and
nothing else; the key belongs in `.env`, which is gitignored. The
destination is configuration too — `APP_URL`, `APP_URL_STAGING`, `APP_URL_PROD`
— and never something a tool call can name, because a request carries your key
to whatever host it is pointed at.

The key's owner is re-checked in the database on **every** call. Revoking one
takes effect on the next request.

### The first key, on a fresh production database

A key is minted by an owner — and a freshly deployed production database has no
owner yet (the "first account becomes owner" rule is development-only, on
purpose: the first visitor to a live app may be a customer). So the first one is
bootstrapped through your host:

```bash
node run.mjs setup-bootstrap --env prod
```

It creates the first owner and one short-lived key, writes the key straight into
`.env` without printing it — so it never reaches your agent's transcript — and
**refuses once an owner exists**. Mint a proper key on the page straight
afterwards.

⚠️ **Once an owner exists, that refusal used to leave exactly one way on: the
admin page, in a browser.** An agent working without one stopped there — and so
did `node run.mjs content-check`, which `CLAUDE.md` makes the exit condition for
content. `node run.mjs smoke` walks straight into it, because it recommends
`user-create --role owner` for its signed-in pass. The other half of the path:

```bash
node run.mjs setup-key                    # dry run: says what it would do
node run.mjs setup-key --apply            # mints, writes .env, prints nothing
```

Needs template 0.27.0.

It mints for an owner who **already exists** and never creates one — creating
the first owner stays the bootstrap's act, with the bootstrap's guard. Same two
conditions otherwise: the secret is written with `setEnvValue()` and never
printed, and the key is recorded against a named owner. `--email` picks which
owner when there is more than one (it refuses to guess), `--name` labels the row
on `/dashboard/admin/setup-audit`, `--days` shortens the default 30.

🚨 **It needs `DATABASE_URL`, and that is the point rather than a limitation.**
Whoever holds a connection string does not need a setup key at all — the surface
exists so an agent can change an environment *without* one in a shell. So this
command hands nobody a new privilege; it removes a detour on the one machine
where the detour cannot be walked. On a deployed environment nothing changes:
you do not have that database, and the admin page is still the way in.

## Where the wiring lives

You do not write it. The template ships the server registered for all four
programs, from one source (`scripts/dev/agent-configs.mjs`):

| Program | File |
|---|---|
| Claude Code | `.mcp.json` |
| Codex CLI | `.codex/config.toml` |
| Antigravity CLI | `.agents/mcp_config.json` — its own file, not a block in a settings file |
| OpenCode | **`opencode.json`** at the repo root — *not* `.opencode/` |

`node run.mjs agent-setup` prunes the three you do not use, and puts them back
byte for byte if you change your mind.

⚠️ **Three of the four gate on trust or approval**, each differently, and until
you clear it the server is simply absent — no error, no tools:

- **Claude Code** asks you to approve the server; a cloned repo cannot
  pre-approve itself.
- **Codex** ignores the whole `.codex/` layer until you trust the project.
- **Antigravity CLI** asks once whether you trust this workspace, and then asks
  again per tool: an MCP tool nobody has ruled on defaults to *Ask*.
- **OpenCode** has no gate.

⚠️ **Antigravity's file has a schema of its own, and two of its rules are the
kind that fail without an error.** There is no `type` field — the transport is
whichever key is present, `command` for stdio or `serverUrl` for HTTP, and the
`url` / `httpUrl` spellings the rest of the MCP world accepts are refused. And
it does not expand shell variables, where Claude Code does. Neither matters for
the server shipped here, which names a command and nothing else; both matter the
moment somebody adds a second one.

## Why `owner` is refused outside DEV

The agent driving these tools reads text other people wrote — community posts, a
member's own name, a support mail. Any of it can contain instructions. During
such a call your key is valid, the tool is allowed, and the audit row is
written: every control says yes.

That is why the one irreversible escalation is not in the surface at all.
Everything else it can do is visible, reversible or both.

## The record

Every act — applied, planned or refused — writes one **append-only** row: which
key, which operator, which environment, which tool, which target, how many rows.
Never what was written.

**Two named exceptions carry payload content, and both are deliberate:** `role`,
because the role IS the security question this trail exists to answer, and
`reason` on the two grant tools, because a written reason is the accountability
and a trail of unexplained grants is a list rather than a record.

🚨 **Both are kept on a REFUSED act too.** A refused `grant_revoke` used to hold
no reason at all, although the tool would not run without one — so the trail was
thinnest at the irreversible act somebody is most likely to be asked about
later. By the time a tool refuses, its input has been through `validateInput()`:
the reason is the tool's own declared string, bounded by its own schema. ⚠️ The
guard's refusal keeps writing neither, for the same reason it writes no
`target`: nothing there has been validated, and a stranger does not get to
choose what these columns say.

🚨 **Every act also records WHO it was about**, as a member id and not as an
address — `subject_member_id`, the column both Art. 15 exports slice the
`setupActs` section with. Each tool declares whether it acts on a member and
which of its own fields carries the address (`subjectEmailField`), the app looks
the id up on every path including the refusals, and a tool that has not decided
does not compile. `grant_revoke` is the one that names a GRANT rather than a
person: the member is read out of that grant's row, in `plan` as well as in
`apply`. An empty column is therefore an answer — *this tool is about no
person*, or *we looked and nobody has that address*, and `target` still holds
what was asked for.

🚨 **A refused act names its target too, and that is the row that most needs
one.** A refusal reaches `dispatch.ts` as a thrown error rather than as a result,
so it used to record WHAT happened and never to WHICH thing —
`contentMediaLengthMismatch` without the file, out of a course with forty of
them. Every tool therefore declares which of its own input fields names the
subject of an act (`targetField` in `lib/setup/types.ts`), and a tool with
nothing to name — `content_publish` takes no input at all — declares that
instead. So an empty `target` is somebody's answer rather than a lost
identifier, and a tool that has not decided does not compile. ⚠️ The one branch
that deliberately writes none is a refusal by the **guard**: it happens before
the input has been validated, and what a stranger posted is not something this
trail will repeat.

⚠️ **The upload's checksum is deliberately NOT in the trail, and that is a
judgement rather than an omission.** A SHA-256 is an identifier and not payload
content, so the rule above would allow it. Two things settle it the other way:
the digest of the stored object is already on that file's `media` row, so a
second copy in the audit would be a second truth to keep in step — and the two
are not even the same number (the media row hashes what was *stored*, after the
EXIF and PNG text chunks came off; the confirmation binds what *arrived*). What
the trail owes is which act happened to which thing, and `target` — the manifest
path — says that. Adding a column would also be a migration on the one table
that has no update path by construction.

🚨 **`dispatch.ts` is the trail's only writer.** A tool never calls `recordAct()`
itself — a tool that recorded its own act could record a different one, or none.

Two readers, and both are the point:

```bash
node run.mjs setup-check --live    # the last ten acts, per environment
```

…and `/dashboard/admin/setup-audit` for the whole trail. ⚠️ A refused call with
a key that does not exist is in there too, shown as `no key` — that is the row
you most want, and it is the reason the key reference on that table is nullable.

An audit trail nobody reads is not a control. If you switch this on for
production, look at that page occasionally.

**Four states, and all four are readable from the row alone.** A publish is the
largest single act this surface can perform, so the row's honesty about *part of
it* is the difference between a trail and a reassurance:

| What happened | `outcome` | `code` | `rows` |
|---|---|---|---|
| nobody ever published | *(no row at all)* | | |
| refused before any write | `refused` | the refusal's code | 0 |
| published whole | `applied` | *(empty)* | everything |
| published **in part** | `applied` | `contentPublishPartial` | **what actually committed** |

Without that last line a run where the third applier threw would be recorded as
`applied` with a plausible number, and the trail would say the publish
succeeded. The `code` column is the one that carries it — an identifier, never a
sentence and never a path — because `outcome` is a three-value database enum and a fourth value
would be a schema migration for a refinement of `applied` rather than a peer
of it.

🚨 **A refusal a tool ANSWERS with is a refusal, and the tool has to say so.**
Most refusals arrive here as a thrown error carrying a code. Five do not: a tool
may hand back an ordinary result instead, because a refusal that is an *answer*
can carry things an exception cannot — which file it was about, and a payload
the caller acts on. `content_media_url` is the clearest: told the driver cannot
mint an address, it names the two ways forward, and `node run.mjs
content-publish` branches on that rather than on an error.

For a while those five were recorded as **successes** — `applied` or `planned`,
no code, no rows — because the trail could not tell an answer that refused from
one that worked:

| tool | refuses when |
|---|---|
| `user_upsert` | `ownerPromotionRefused` — an owner is not made through this surface outside DEV |
| `grant_by_hand` | `notFound` — no account has that address here |
| `media_upload` | `badRequest` — the call came through the door that carries no bytes |
| `content_media_url` | `noUploadAddress` — this environment's media driver cannot mint one |
| `content_publish` | `appliersUnreadable` — the appliers could not be enumerated, which is *"I could not look"* and never *"there is nothing there"* |

What fixed it is a **declaration and not a guess**: a refusing tool sets
`SetupResult.refused` to its code, and `dispatch.ts` writes `outcome: refused`
with that code. It is deliberately not inferred from `created === 0` — a
`user_upsert` of somebody who already holds that role changes nothing either,
and it is an honest `applied`. ⚠️ A plan that refused also hands back **no
confirmation token**: a token is a capability with two minutes on it, and minting
one for an act the tool has just declined offers a second act that will decline
identically.

⚠️ **What the rows written before that say now.** Nothing was rewritten and
nothing can be. In an app that has been running, a row from one of those five
tools reading `applied`/`planned` with no code and `rows: 0` is *either* a
refusal *or* an honest act that changed nothing — the row does not hold the
difference, and a migration that picked one would replace a known gap with an
invented answer. So the reading is one-directional and worth knowing: for those
five tools, before this change, **refusals were under-counted and successes
over-counted**, and only among rows with `rows: 0`. Every other tool, and every
row since, is exact.

**It is kept 24 months**, then the daily `prune-setup-audit` job removes what is
older — longer than anything else this app keeps, because it is the only record
of what an agent did to a production database and those questions arrive late.
The window is `retentionMonths` in `config/cron.json`; setting it to `0` is
refused rather than obeyed, because a trail deleted nightly is the control
switched off wearing a policy's clothes. To keep everything, disable the job.

## Switching it on

```json
// config/setup.json
{ "enabled": true }
```

Read only through `isSetupEnabled()` (`lib/setup/config.ts`), never by
re-reading the JSON. ⚠️ **Any unknown key, wrong type or out-of-range value
switches the whole surface off** — the failure mode here is an open write
endpoint, so every doubt falls towards closed. Keys beginning with `_` are
comments.

While it is off, every `/api/setup` path answers **404 with an empty body**,
before it reads a byte of your request — exactly like a route that was never
built. A 404 that first complained about your Content-Type would have told you
the route is there. That is deliberate: from outside, "switched off" and "not
deployed" must look the same. `node run.mjs setup-check` is what tells them
apart.

There is no runtime toggle and no admin setting. Switching it on is a deploy —
which means turning it **off** is a deploy too, and that is the point: a switch
living in the database is one that whoever reached the database can turn.
