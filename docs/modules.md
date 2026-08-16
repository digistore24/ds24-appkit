<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Modules — what this app is made of

Most of this template is the **core**: accounts, roles, billing, entitlements,
media, the design system. Every app has it.

Some features are large enough that an app either wants them whole or not at
all — a community, an in-app assistant. Those are **modules**. A module is a
complete feature with its own pages, tables, texts and guidance, living under
`modules/<id>/`, and an app either has it or does not.

> **Six modules exist, and a fresh app has none of them.**
>
> | | | | |
> |---|---|---|---|
> | **`activity`** | what a course's customer DOES, judged on the server | `module add activity`, then `db-migrate` | [`docs/learning.md`](learning.md) · skill `learning-activities` |
> | **`companion`** | the app working alongside its customer while they work | `module add companion` — no table, so no migration | [`docs/ai-in-product.md`](ai-in-product.md) · skill `ai-companion` |
> | **`api`** | the HTTP API a customer's own programs talk to | `module add api`, then `db-migrate` | [`docs/api.md`](api.md) · the companion app itself: [`docs/mobile.md`](mobile.md) · skill `mobile-companion` |
> | **`community`** | a place for members: rooms, discussions, private messages | `module add community`, then `db-migrate` — its own tables | [`docs/community.md`](community.md) · skill `community` |
> | **`courses`** | the course itself: blocks, lessons, progress, and the purchase gate in front of them — and, for the accompanied workshop, the hand-in, the operator's queue to answer it in, and a daily digest job that mails them the COUNT and names nobody. 🚨 **Do not build a reply surface or a hand-in notification by hand** | `module add courses`, then `db-migrate` — and it ships switched OFF until the content is written | [`docs/courses.md`](courses.md) · skill `courses` |
> | **`metrics`** | the onboarding funnel, return by cohort, and split tests — counted in this app's own database, server-side, with no pixel and no cookie. 🚨 **Its own playbook opens by arguing you should not install it**: for most apps the return rate is one SQL query over tables the app already has | `module add metrics`, then `db-migrate` — its switch is `modules/metrics/config.json`, not `config/`, and it ships OFF until the funnel names real milestones | [`docs/metrics.md`](metrics.md) · skill `metrics` |
>
> **Every module has a page and a playbook, and its manifest names both**
> (`docs`, `skill`) — so `node run.mjs module list` prints them beside the id
> and nobody has to guess which of thirty docs belongs to the module they just
> heard of, and `scripts/modules/manifest.test.ts` opens BOTH files against the
> tree so a renamed doc or a retired skill fails the build rather than sending
> somebody after a file that is not there. See *What a module joins by declaring
> itself*.
>
> The community is the biggest of them by an order of magnitude — a dozen-plus
> tables, as many data-protection sections, its own pages, its own admin tree,
> its own polling transport — and it is the one that proves every seam at once.
> [`docs/community.md`](community.md) is its reference.

## What a module joins by declaring itself

A dozen places in the app used to be hand-edited lists that a feature had to
remember to join. A module joins them from its manifest instead:

| It declares | And joins |
|---|---|
| `summary` | the line `node run.mjs module list` prints after the id — see below |
| `docs` + `skill` | the same list's second line: this module's page in `docs/` and the skill that builds on it. Pointers INTO the core tree, never guidance shipped from the module — see *Where a module's guidance lives* |
| `config` | printed there as the module's **switch**, because installed and switched on are two questions. ⚠️ **The file is named for the FEATURE and not always for the module**, so it is read off the manifest and never guessed from the id: `courses` switches in `config/course.json`, `companion` in `config/ai-companion.json` (reported 2026-08-12 — the first reflex reaches for `config/courses.json` and finds nothing there). `module list` prints the path for **every** module in the tree, dormant ones included, and `module add` names it again after an install; those two are the answer, and a guessed path is not |
| `schema` | `db/schema.ts`, through one generated line that never changes |
| `messages` | the text catalogue, merged per locale in `i18n/request.ts` |
| `errorCodes` | the union check — a code with no text is a build failure |
| `publicRoutes` | `PUBLIC` in `app/route-protection.test.ts`, with the same "say what guards it" bar |
| `requires` | other modules this one cannot run without. `loadModules()` REFUSES an arrangement naming a module whose dependency is missing, and **both `add` and `remove` check it BEFORE they write** — `module add courses` without `api` names the missing one and changes nothing, `module remove api` under an installed `courses` names the dependant and changes nothing. 🚨 That ordering is the whole of it and it was wrong once: `add` used to write `config/modules.json` first and meet the registry's refusal afterwards, exiting 1 with the module already in the list and no generated file rewritten — an error message over a half-changed app, which is worse than no refusal at all. ⚠️ **It costs something specific and `module check` says so on every run**: the factory can only test k+2 profiles while modules are independent, so a dependency widens the profile that tests it — `scripts/modules/profiles.test.ts` builds each single as the transitive closure of `requires` rather than as the module alone. Declared rather than refused, because an undeclared dependency is worse: it becomes a cross-module import nobody wrote down. Two modules use it — `courses` and `community`, both on `api`, because they serve endpoints on its surface ([`docs/api.md`](api.md) → *What a MODULE adds to this surface*) |
| `commands` | `node run.mjs`, under a name that must start with the module's id |
| `navAreas`, `tablePrefix` | the greeting's inventory of what shipped |
| `cron` + `cronJobs` | the scheduler — `CRON_JOBS` and `JOB_IDS`, through two generated halves. **Both fields or neither**: the bodies cannot be imported where the names are needed ([`docs/cron.md`](cron.md) → *A MODULE can bring a job*) |
| `smoke` | the `node run.mjs smoke` sweep — and a claim that could not run counts as a failure |
| `outputFileTracingIncludes` | the build's file tracing, with globs that must stay inside the module. It is the only way to ADD to it, not the only source: `appliers` below produces an entry of its own, and both are merged into the core's rather than laid over them |
| `privacy` | BOTH Art. 15 exports — and a module declaring `tables` without a complete block does not ship |
| `privacy.accountNotes` | the two sentences on `/dashboard/account`: what of this module's data is in the member's download, and what disappears when they delete their account. Message KEYS in a namespace the module owns, so the text is translated like everything else. The core cannot write them, because only the module knows what it stores |
| `entry` | the server registry, which is what account deletion walks |
| `disclosure` | the AI-transparency registry `node run.mjs legal-check` walks |
| `slots` | a card on a page the CORE owns — see below |
| `components` | `lib/modules/component-registry.ts` — what the APP's OWN pages import from this module, and the only legal way to reach it — see below |
| `serverExports` | `lib/modules/server-exports.ts` — the same for the app's own SERVER code (`askCompanion()` and `track()` are the shipped ones). **Two barrels, not one**: importing any name from a barrel pulls its whole graph, so a client component reaching for a hook would drag a module's server code — and its keys — into the browser |
| `setup` | the setup/MCP surface `app/api/setup` serves — this module's own tools, so an agent can configure and fill it without a shell ([`docs/setup-mcp.md`](setup-mcp.md)). Every tool name starts with the module's id, and none may shadow a core tool's; the rule lives in `lib/setup/registry.test.ts` rather than the manifest, because the collision is between tool NAMES in TypeScript, not between module ids |
| `presence` | `node run.mjs content-check` — this module's answer to *"does this environment hold what it should"*. **Required for a module with `tables`**, on the same bar `privacy` clears: a module that holds rows must be able to say whether an environment HAS them, or the check answers a smaller question than its name while showing a green tick. ⚠️ A module that cannot answer counts as a **failure**, never a pass. 🚨 **It COUNTS, and the file it imports decides whether it may.** The core composes this file into `lib/modules/presence-registry.ts`, which the content plan reaches — and `lib/content/applier-plan.test.ts` asserts over that whole closure that a plan can call nothing which WRITES an object. So a contributor that imports its module's `lib/manage.ts` for one counting helper drags the media store's `put`/`copy`/`remove` onto the plan's path: exactly what `community` shipped, and every app that installed it had a permanently red `npm run test` (reported 2026-08-12). Two rules meet here and both hold — the contributor stays a THIN CALLER (`lib/setup/module-boundary.test.ts` refuses a `@/db` import in it, spine AD-81), so the query goes in a NARROW file of the module's own `lib/` that imports `@/db` and the module's schema and nothing else. `modules/community/lib/room-counts.ts` is the worked example, and `scripts/modules/presence-purity.test.ts` asks it of every module in the tree, installed or not |
| `content` | the two rows below — it is what says WHICH of them this module owes. **Required for a module with `tables`**, on the same bar `privacy` and `presence` clear, and there are exactly two answers. `"authored"`: the rows come from the REPO, so `appliers` is **required** — content that cannot be applied exists only where it was typed. `"collected"`: the rows come from the people using the app, so it owes no transport. ⚠️ And on a `collected` module a declared `appliers` is **refused**, which is the half only a discriminator can say: those rows are posts, keys and a learner's own answers, and an applier there would upsert over them on every `content-apply`. That is why the duty could not simply be hung on `tables` — three of the four table-owning modules are `collected`, and requiring a transport of them would refuse three correct modules. A module with **no** `tables` declares nothing here, and doing so anyway is refused as a promise about rows it does not have |
| `contentSource` | `lib/content-source/sources.ts` — what the in-app assistant may search inside this module ([`docs/content-source.md`](content-source.md)). A `.ts` file whose default export is a `ContentSource`, because it reads the module's own tables and therefore runs where the database is. 🚨 The contract stays in the CORE, so a default export that does not keep it fails `npm run typecheck` naming the module rather than a customer's first question. Deciding NOT to declare it is a decision too, and the community module has taken it — `modules/community/ai-boundary.test.ts` refuses the coupling structurally, because what a chat tool returns is sent to an AI provider and posts are the largest personal-data surface here |
| `appliers` | the module's own content, upserted into whichever environment it is pointed at. ⚠️ **Two callers drive the same appliers, not one**: the shell pair (`node run.mjs content-apply`) and the setup tool `content_publish` since Story 34.3 — so an applier that is not idempotent, or that assumes it runs from a checkout, breaks on the path nobody was thinking of. Whether it ARRIVED is the `presence` row above; WHETHER IT IS OWED is the `content` row above it — this field is required of a module declaring `"content": "authored"`, and refused on a `"collected"` one. A module that brings tables it authors must be able to fill them, or its content exists only where it was typed ([`docs/content.md`](content.md) → *A MODULE can bring one*). It is also a **tracing** declaration: the directory is traced for `/api/setup` under `output: "standalone"`, derived from this field so that no core file ever names a module |

The generated files (`db/schema-modules.ts`, `lib/modules/messages.ts`,
`lib/modules/registry.ts`, `lib/modules/nav-registry.ts`,
`lib/modules/gate-registry.ts`, `lib/modules/slot-registry.ts`,
`lib/modules/component-registry.ts`, `lib/modules/server-exports.ts`,
`lib/modules/setup-registry.ts`,
`lib/modules/presence-registry.ts`,
`lib/modules/content-source-registry.ts`,
`lib/modules/account-notes-registry.ts`, `lib/modules/cron-registry.ts`,
`lib/modules/cron-ids.mjs`) — **fourteen** of them — are
**checked in, not built** — the deploy contract
is `npm ci && npm run build` on four hosts, and nothing in it runs a generator.
`node run.mjs module sync` rewrites them; a test compares them against the
manifests byte for byte, so one that stopped matching fails the build rather
than shipping.

🚨 **The order matters, and the second half is the part people get wrong: edit a
`modules/<id>/module.json` by hand and you must run `node run.mjs module sync`
yourself.** `add`, `remove` and `sync` are the only three commands that write
those files (`scripts/modules/generate.mjs` → `writeGenerated()`), and
`package.json` has no `prebuild` and no `postinstall` — deliberately, because a
generator that wrote during a customer's build would be a build that edits its
own source tree.

So a hand-edited manifest leaves the registries describing the app as it was.
⚠️ **`npm run build` will not tell you** — it builds the stale registries quite
happily. The only thing that says so is `npm run test`
(`scripts/modules/generated.test.ts`), which is also why `CLAUDE.md` makes green
the commit condition. If you changed a manifest and are not sure: run `module
sync` again. It is idempotent and costs a second.

### `slots` — the one thing that is not simply additive

Everything else in that table adds to a registry. A card on `/dashboard/account`
does not: the page is the core's, and a member expects **one** page for "my
account". Giving each module its own page instead would answer the mechanical
question by making the product worse.

So the core names the PLACES (`SLOT_NAMES` in `lib/modules/slots.ts`) and a
module fills one:

```json
"slots": { "account": "components/account-card.tsx" }
```

Three rules, and they are what make it safe to hand a module a piece of somebody
else's page:

1. **The component fetches its own data.** It is handed the viewer
   (`{ memberId, role }`) and nothing else. A page that loaded a module's rows
   and passed them down would be the core knowing what filled the slot — the hub
   coming back wearing a prop.
2. **An empty slot renders `null`.** Not an empty wrapper: the page is a
   `gap`-spaced column, and an empty child renders a gap. An app with no module
   gets exactly the page it had before slots existed.
3. **A slot is not a permission.** Being rendered means the page had a place, not
   that the viewer passed a check. Whatever the card shows, it decides for
   itself — the same duty a content source has.

⚠️ **A slot name that does not exist is a TYPECHECK error, by name.** The
registry is generated and typed against `SlotName`, so a typo in a manifest
fails `npm run typecheck` rather than producing a card that renders nowhere.
The other direction — a slot name no page renders any more — has no compiler
behind it, so `scripts/modules/slots.test.ts` reads the tree and refuses it.

### `components` — the one registry YOUR pages write against

`slots` is a module putting something on the core's page. `components` is the
other direction: **the app's own page rendering something the module brought.**
A seam module — `activity`, `companion` — ships a panel and expects a page you
wrote to render it.

```tsx
import { ActivityPanel, CompanionPanel } from "@/lib/modules/component-registry";
```

🚨 **Never `@/modules/activity/components/activity-panel`.** Your page lives
under `app/`, `modules/boundary.test.ts` §1 scans that tree, and it fails any
file there naming an installed module — everything the core needs from a module
comes through a generated registry. So the module declares what it offers:

```json
"components": { "ActivityPanel": "components/activity-panel.tsx",
                "useActivity":   "components/activity-panel.tsx" }
```

and `module sync` writes the barrel. ⚠️ **This was broken and shipped that
way.** `docs/learning.md` and `docs/ai-in-product.md` told you to import the
module path, so following the template's own instructions turned *your*
`npm run test` red about a page you had written correctly — with no registry to
import from instead. Nobody hit it because the four modules moved under
`modules/` after the last run that had one installed.

🚨 **And it happened a second time, on the server-side twin, for the same
reason.** `metrics` shipped with no `serverExports` at all while its skill and
`docs/metrics.md` prescribed `import { track } from "@/modules/metrics/lib/track"`
— installable and not usable, reported from the field on 2026-08-16 and
reproduced here. The declaration is what closes it, but nothing in this repo
could have SEEN it: `modules/boundary.test.ts` §1 returns early when no module is
installed, and the template installs none. What sees it now is
`scripts/modules/reachability.test.ts` — a file inside a module that no
declaration and no core route file reaches is either dead code or an interface
the app is meant to import and cannot. `lib/track.ts` was the second, and it was
the only one in 196 files.

Two rules:

1. **The names are global.** `<ActivityPanel>` is what a page writes, so it
   carries no module prefix — and two modules claiming one name is refused when
   the list is loaded, not discovered as a duplicate export in a generated file
   the customer is told never to edit.
2. **The barrel is client-safe, and every file in it opens with `"use client"`**
   (`scripts/modules/components.test.ts` holds it). A server-side export here
   would be dragged into the browser by any client component importing a hook
   from the same barrel — `askCompanion()` is the one that will be proposed, and
   it needs the server-side registry instead.

### Where a module's guidance lives — in the CORE, and not in the module

A module brings its pages, its tables, its texts and its commands. It does **not**
bring its own `CLAUDE.md` fragment, `docs/` page or skill: `docs/community.md`
and `.claude/skills/community` sit in the core tree and ship in every app,
including the ones that will never install the community.

That looks inconsistent with everything above and is the only arrangement that
works, for two reasons:

- **An app has to be able to learn about a module it does not have.** The
  table naming the six modules is how an agent finds out the community
  exists and is one command away. Guidance that arrived *with* the module would
  only be readable by somebody who already knew to install it.
- **`node run.mjs update` addresses guidance by PATH.** The manifest it reads
  covers `CLAUDE.md`, `README.md`, `docs/*.md` and `.claude/skills/**`; text
  under `modules/` is not in it. A module's own guidance would be the one piece of
  guidance in the app that a released app could never bring up to date — which is
  exactly the failure the update channel exists to prevent.

A skill that describes a feature whose code this app is too old for already has
its answer, and it is a version rather than a location: `requires:` in the
skill's frontmatter.

> There used to be a `guidance` field in the manifest for this. It was validated,
> declared by no module and read by nothing, and it is **gone** — a manifest key
> that promises a mechanism nobody built is worse than no key, because the next
> person to find it assumes the mechanism. Whoever wants module-local guidance
> changes the update channel first; `scripts/modules/manifest.mjs` carries the
> reasoning beside the list of legal keys, and `manifest.test.ts` fails if the key
> comes back.

## The list, and why it is refused rather than guessed

`config/modules.json` says which modules this app has:

```json
{ "installed": [] }
```

It **ships empty** — a fresh app is the core and nothing else.

⚠️ **This is not a feature switch, and it fails in the opposite direction.**
Every other config file here resolves an unreadable value to OFF —
`isCommunityEnabled()`, `isApiEnabled()`, `isChatEnabled()` — because they
answer *"should this run"*, and for that question every doubt must fall towards
closed.

This file answers *"what is this app made of"*. A doubt that falls to "nothing"
there does not close a door, it hides a room: the schema barrel would export no
module tables and the subject-access export would emit no module sections, so an
app holding a year of community posts would answer an Art. 15 request with
silence about data it demonstrably still has.

So a malformed list **throws**. A build that stops is a person reading an error;
a build that quietly forgets a module is a regulator reading an incomplete
export.

## Looking at what you have

```bash
node run.mjs module list    # what this app is made of
node run.mjs module check   # is the arrangement coherent?
```

`list` distinguishes two states that look the same from the outside: a module
that is **installed**, and one whose code is **present but not installed** —
in the tree and doing nothing, with no routes, no tables and no texts. In a
fresh app that is all of them:

```
Present but not installed (5):

  activity   1.0.0  —  what a course's customer DOES — exercises and checks, judged on the server
  api        1.0.0  —  the HTTP API a customer's own programs talk to, on per-member bearer keys
  community  1.0.0  —  a place for members: rooms, discussions under the pages they belong to, …
  companion  1.0.0  —  the app working alongside its customer while they work, …
  courses    1.0.0  —  a course whose blocks and lessons live in tables: self-study, week by week, …

  Their code is in the tree and does nothing: no routes, no tables, no texts.

Adding one, taking one out — by id, one module at a time:

  node run.mjs module add activity
  node run.mjs db-migrate         activity brings 1 table, which is not there yet
  docs/learning.md              render <ActivityPanel> — activity has no page of its own
  node run.mjs module remove <id> nothing is installed here, so there is nothing to take out
```

**That third line is not a command, and that is the point.** A module bringing a
COMPONENT and no route of its own — `activity` and `companion` — is installed,
migrated, switched on and still shows nothing until one of your own pages renders
its panel. Reported 2026-08-12 by somebody who did every printed step and
reasonably concluded the module system was broken. It is derived from the
manifest (`components`, with no `app`, `nav` or `slots`), so a fifth module of
that shape is covered the day it lands. Needs template 0.27.0.

**The sentence after the id is the module's own `summary`**, and the manifest
requires it — one English line, at most 110 characters so it does not wrap into
the next module's row. It is required for the same reason a `commands` entry
needs a `help` line: this list is the ONE command that answers *what is this app
made of*, and it used to answer with four bare ids, leaving the reader to open
four manifests to find out what any of them was. It is also the only place an
app learns what a module it does **not** have would give it.

**Under it comes where to read more** — `docs` and `skill` from the same
manifest, plus `config` under the label **switch**. An *installed* module gets
one more line saying what it brought: tables, route subtrees, text namespaces,
commands, scheduled jobs, **menu entries of its own**, and a card in a core
page's slot. Whether that is one menu entry or two is inside the module's
`nav.ts`, which is TypeScript and unreadable from a bare-Node script — so the
list says that there ARE some and never how many, because a number this command
would have to guess at is worse than the plain fact.

> 🚨 **The switch is NAMED, never read.** Three of the four modules keep an
> `enabled` field, so peeking at it from here would be four lines — and it
> would be a second implementation of a question the app answers with
> `isCommunityEnabled()`, which also returns false for a config with one
> unknown key in it. Two answers that disagree on the day somebody makes that
> typo is exactly the confusion this command exists to clear up.

### "I installed the community and there are no menu entries"

That is the expected state, and it is neither a bug nor an old clone. Only
`community` declares `nav` at all — `api` and `community` each put a card on
`/dashboard/account`, and `activity` and `companion` are seams your own pages
are built on, so they have nothing to link to until you build it. And the
community's two entries carry a `featureKey`, which means they stay hidden
until the module is switched **on**:

```bash
node run.mjs module add community
node run.mjs db-migrate                 # its own tables
#   config/community.json → "enabled": true
node run.mjs restart                    # no runtime toggle, deliberately
```

Installed and switched on are two questions ([`docs/community.md`](community.md)
argues why the off state is the module's kill switch), and the list says so
under the installed block rather than leaving the reader to find out from an
empty menu.

The two commands at the bottom carry a **real id** taken from the lists just
printed, not `<id>`: this output is routinely the first thing anybody reads
about modules, and a placeholder is one more thing to work out before the
command runs.

`check` reads every manifest, including the dormant ones. A dormant module's
manifest is read by nothing at build time, so a broken one would otherwise be
discovered by whoever installs it, probably in a hurry. `list` is deliberately
softer about the same fault — it prints *"its manifest is broken; `module check`
says how"* beside the id and carries on, because a command whose whole job is to
say what is in the tree must not die on one bad file.

## Adding one, and taking one out

```bash
node run.mjs module add <id>        # make this app one that has it
node run.mjs db-migrate             # its tables are not there yet
node run.mjs module remove <id>     # see the gate below
```

One module at a time — `add` and `remove` take a single id, and
`node run.mjs module list` is what says which ids there are.

`add` validates the manifest **before** the id reaches `config/modules.json` — a
broken one in that list would break every command that reads the arrangement,
including the one that explains what is wrong — and rewrites the generated
registries in the same breath. The list and the generated files belong in one
commit.

> **The modules are the ones in your tree, and there is no way to add another.**
> `module add` takes an id that is already under `modules/`, which is the set
> this template shipped you. There is no download, no registry and no archive
> format: an app is composed from what it was cloned with.
>
> This template did once install a module from a URL (`module add --from
> https://…`), with its own downloader, tar reader and pre-flight check. It is
> **gone** — the whole channel, not merely the flag — because we do not offer
> modules for installation and a channel nobody publishes into is an unused way
> into a customer's app, running with their database and their `.env`. Whoever
> wants that back is adding a distribution channel, not restoring a flag.

### 🚨 `remove` looks in the database first

Uninstalling makes the **feature** absent. It does not make the **rows** absent.
A module that ran for a year leaves its tables behind with everything members
wrote in them, and an app that no longer knows about them cannot name them in a
subject access request — a worse position than having no module system at all.

There is no code-level fix for that, only a product decision:

> **A module is chosen before the first row is written, never after.**

So `remove` refuses unless it can prove the module is empty:

| | |
|---|---|
| no `DATABASE_URL` | **refused** — "I could not look" and "there is nothing there" must never be the same answer |
| database unreachable | **refused**, same reason |
| every table empty | removed, and the tables and the module's migration journal are dropped |
| any row at all | **refused**, with the counts, and the two lawful ways forward named |

The two ways are: keep it installed and switch it **off** in its own config —
that is what the switch is for, the code is inert and the exports keep answering
— or `--drop-data`, which deletes the rows. That second one *is* erasure: it is
irreversible, and it is a decision somebody takes rather than a step inside an
uninstall. It records what was deleted and when, in numbers only.

The journal is dropped with the tables, and that is not tidiness: without it a
module re-installed later would have its own `0000` counted as already applied,
and its tables would never come back — silently.

**The backstop:** `node run.mjs module check` reports tables whose prefix
belongs to a module that is *not* installed. That is the case the gate cannot
cover — somebody edited `config/modules.json` by hand, or restored an old copy —
and it is an alarm rather than a silence.

> ⚠️ **Both halves of this page needed `DATABASE_URL`, and nothing gave it to
> them.** `scripts/modules/cli.mjs` read `process.env.DATABASE_URL` without
> loading `.env` — every other database-touching script in `scripts/` does, this
> one did not — and the two consequences were invisible in opposite directions:
> `remove` always took the *I could not look* path and refused, so three of the
> four rows in the table above were unreachable in every app; and `check`'s
> database half is written `if (process.env.DATABASE_URL)`, so it did not refuse,
> it **skipped, and said nothing** — the backstop this paragraph calls an alarm
> was the silence, in every app, from the day it was written.
>
> It took running the command against a real database to see it, which nothing
> did until the factory's module deploy profile. `scripts/lib/env.test.ts` now
> asks the question of every script in the tree instead of the ones somebody
> remembered.

`prune`, which would delete an uninstalled module's source files, is still
absent: it only makes sense once a module can be fetched back.

## Trying a combination

**Install what you need and run the tests — a module being installed never makes
this app's suite red.** If it does, the test is wrong and not your app: five
assertions here used to pin the *shipped* state (`MODULE_SLOTS` is empty,
`installedModules()` is `[]`, …), all five of which are true of the template and
false of every app that followed this page's own instructions. The claim about
the shipped state belongs to whoever ships, and it is checked there.

What proves a combination actually holds is
`scripts/modules/profiles.test.ts`, and it needs no installation at all:

| | |
|---|---|
| **k+2 profiles** | none, each module alone, all of them together |
| **How** | `loadModules(root, ids)` takes the list instead of reading `config/modules.json`, so a profile is a pure computation over the real manifests — no temporary tree, no checked-in file rewritten, no database, milliseconds |
| **Why not every subset** | no module imports another it has not declared (`modules/boundary.test.ts` §3), and every check here is over a SET — a collision is a duplicate anywhere in the profile, the text merge is a reduction over all of them. So the all-of-them profile contains every pair's interaction |

That last row is what the whole file rests on. Five things only become checkable
once two real modules are present, and every one of them was previously measured
against fixtures called `a` and `b`:

- the five cross-module refusals in `loadModules()` — one table, one route
  subtree, one nav feature key, one message namespace, one command, each claimed
  twice. A fresh app validates a list of length zero, so all five were dead code.
- **the text merge**, which is the one that already went wrong: see *Settled by
  the community's move* below. A shallow spread is correct against one module and
  against every fixture, and deletes another module's `errors` block the moment a
  second REAL one is installed.
- **two cards in one slot** — `api` and `community` both fill `account`, with two
  real components and two import aliases that must not shadow each other.
- **a gate against its own manifest.** A module's `gate.ts` cannot read
  `module.json` (it runs in front of every request, so no `fs`), so its subtree
  list is a hand-written copy — and the miss that shipped once was exactly a copy
  that had one subtree too few. `guardableSubtrees()` in `lib/modules/gate.ts` is
  what both halves compare against, and it says why `api/` subtrees are excluded.
- **a module's table prefix against the CORE's tables.** `loadModules()` compares
  modules to each other and the manifest validator sees one module at a time;
  nobody compared a module against the core. A module called `ai`, `chat` or
  `token` would take `ai_`, `chat_` or `token_` as its prefix and quietly claim
  `ai_usage`, `chat_messages` or `token_ledger` — after which `module check`
  reports a core table as that module's orphan and `remove --drop-data` offers to
  drop it.

## Two readers, one file

| | |
|---|---|
| `lib/modules/installed.ts` | the app — bundled, because a path resolved against `process.cwd()` breaks under `output: "standalone"` |
| `scripts/modules/installed.mjs` | `next.config.ts`, `run.mjs` and everything under `scripts/` — they run before a bundler exists |

`lib/modules/installed.test.ts` feeds the same inputs to both and fails the
build when they disagree. That clamp is not ceremony: two readers of one
question drifted once already in this app, and
[`docs/data-protection.md`](data-protection.md) carries what it cost.

## Settled by the community's move — how a module's menu entry is named

This section used to be an open question, and it was left open deliberately:
"decidable, but not decidable *well* against no module at all". The community
was the first module with a menu entry, so it is what settled it.

**`nav` and `errors` are the two namespaces the CORE owns and every module
merges INTO** (`lib/modules/messages-merge.ts`) — the alternative, a shell that
resolves a fully qualified key per module entry, would have made the entry's
label the only text in the app that is addressed differently from every other.
The rule that makes a shared namespace safe is the one the manifest already
carries: **a module's key there must start with its own id**, so `community` and
`communityAdmin` are its to write and nobody else's.

⚠️ That rule was not written speculatively. The companion's move spread module
texts flat (`{...a, ...b}`), and two modules sharing `errors` meant one module's
block deleted the other's outright — eight refusals would have rendered as raw
keys. Nothing found it but the state *"two modules installed"*; with one module
a flat spread is trivially correct.

**`lib/ai/nav-labels.ts` reads the module navigation** rather than carrying a
hard-wired list — the second half of the same decision, and the sharper half.
The assistant may not name a menu entry whose route does not exist, and the
"chat" argument does not transfer: switching the assistant off removes *her*,
where switching a module off leaves her running with a door she would still be
pointing at. So a module's entry is named to a member only while that module is
installed **and** switched on.

## The community's layers — what a big module looks like inside

The community is the largest module and the one to read first before writing
anything that size. Its shell was **one file of 5,902 lines** — eleven domains,
96 exported functions — and it is now one file per domain over five small
helpers. Worth knowing before you build something that size:

**The domains, and what they own**

| | |
|---|---|
| `profiles.ts` | the member's face: display name, avatar, the participation profile every write path resolves |
| `groups.ts` | the operator's rooms and the doors a member sees |
| `talk.ts` | discussions and posts |
| `embedded.ts` | a conversation hanging off a page instead of a room |
| `messages.ts` | direct messages — every reader takes a participant id |
| `unread.ts` | one writer, one read, no second path |
| `live.ts` | "what is new since X", for one scope |
| `feed.ts` | the friends feed, derived at read time and stored nowhere |
| `following.ts` | one-sided, immediate, visible on the other person's list |
| `moderation.ts` | the authority is re-read, every act writes its own record |
| `reports.ts` | a spam report is decided once, then frozen |

**The five `_` files are not a junk drawer.** Each one exists because a helper
had several consumers, and two of them exist because it was in a CYCLE:

| | |
|---|---|
| `_change-stamp.ts` | `CHANGED_AT` and its param binder — the SQL twins of `changedAt()`, which lives in the pure `rules.ts`. **Broke Live ↔ Feed.** |
| `_blocks.ts` | `sendBlockFor()` / `guardSendBlock()` — a guard about BLOCKING, which had been filed under spam reports. **Broke Talk ↔ Reports and DM ↔ Reports.** |
| `_access.ts` | which plan keys and which rooms a viewer really has |
| `_paging.ts` | `pageOffset()`, wanted by four domains |
| `_post-images.ts` | store, judge, attach, discard — one subject, four functions, plus the media slot they share |

🚨 **`manage.ts` is a BARREL and the export list in it is named, never
`export *`.** The domain files export more than the old single file did:
helpers that were private inside it must now be visible to their siblings. A
`export *` would hand every one of them to the rest of the app, and what a
barrel exports is what somebody eventually imports. The list is exactly the
surface the module had before the split — 95 names — so a helper reaching the
outside is something somebody typed.

⚠️ **Two things hold this, because neither is held by the compiler.**
`modules/community/lib/layering.test.ts` fails on an import cycle — a cycle does
NOT fail `npm run typecheck` and does not fail a test, because ES modules hoist
function declarations, so `a → b → a` simply runs and goes wrong later. And
`_shell-files.mjs` owns the list of shell files, because a dozen guard tests
read the shell as TEXT: when `manage.ts` became a barrel they were briefly
reading a file that contains only re-exports, which is green by emptiness.

## What a module is not

- **Not a feature switch.** A module that is installed can still be switched
  off — `config/community.json` keeps doing exactly what it always did, and the
  community is now a module *and* has that switch. The two questions are
  separate and stay separate: **installed** answers "does this app have a
  community at all", **enabled** answers "should it run". They also fail in
  opposite directions on purpose — an unreadable switch means OFF, an unreadable
  module list is refused outright.
  ⚠️ Their 404s look identical and are not the same thing. Uninstalled, the
  route does not EXIST (Next never built one). Switched off, the route exists
  and refuses. `node run.mjs module list` is what tells them apart; nothing
  else does. So a 404 here is never a diagnosis — **and a missing feature is
  never evidence of an old clone.** An app that answers 404 on `/community` may
  have the module and have it switched off, or may never have had it, and both
  are ordinary states of a perfectly up-to-date app.
  ⚠️ **And a module's absence does not always LOOK like absence.** The
  `companion` task id stays in `TASKS` whatever is installed — it is core
  vocabulary, argued in `modules/boundary.test.ts` under the five refusals — so
  `node run.mjs ai-check` lists that task in every app, including the ones that
  have no companion. Reading a list of tasks, routes or config files is
  therefore never an answer to *what is this app made of*; `module list` is.
  **And the switch file lives in the CORE's `config/`, where it stays whether the
  module is installed or not** — `config/api.json`, `config/community.json`,
  `config/ai-companion.json` and `config/course.json` are in a fresh app that has
  none of them. It is the
  second thing in this system that looks like a leak and is not: `remove` refuses
  while rows exist and names *keep it installed and switch it OFF* as the way
  forward, so a switch that vanished with an uninstall would take that way out
  with it. `modules/boundary.test.ts` §1c derives that set from the manifests and
  writes each one down with its
  reason and holds the thing that actually matters — a module's declared switch
  file must EXIST, because every one of these readers resolves an unreadable file
  to OFF and a missing one would make the module installed, migrated and silently
  inert.
- **Not a second app.** Everything ships as one Next.js app, one process, one
  URL. `npm ci && npm run build`, `npm run start` and `npm run db:migrate` are
  the whole deploy contract and modules do not change it.
- **Not something you uninstall after use.** A module is chosen before the first
  row is written. Removing one later is a decision about *data*, not about code.
