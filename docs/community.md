<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The community — rooms, embedded discussions, private messages

> **A MODULE, and a fresh app does not have it.** `node run.mjs module add
> community`, then `node run.mjs db-migrate` — it brings its own tables on its
> own migration chain (`node run.mjs module list` counts them). Then the switch below, which ships OFF. Needs template
> 0.19.0 or newer; `node run.mjs update` brings this text, not the code.
>
> ⚠️ **A missing community is not evidence of an old clone.** Every generated
> app starts without it. `node run.mjs module list` is the command that answers
> whether this one has it — the 404 an absent module gives is deliberately
> indistinguishable from the 404 a switched-off one gives, so the route cannot
> tell you.

Buyers who can talk to each other stay. That is the whole business case, and it
is also the reason this is the most dangerous thing in the template: a
community is the first place where **one customer's words are shown to
another**, where a room's membership is a list of who bought what, and where
one bad default discloses something nobody can take back.

So the module is split the way that risk demands. **The invariant half is
code** — who may enter, who may read, what a moderator may do, what nobody may
ever read — and it ships finished, switched off, identical in every app that installs it. **The
texture is yours**: which rooms, which discussions hang off which pages, gated
by which product. The skill **`community`** is how an app's agent builds its
own texture on this core; this file is what the core promises, and what it
deliberately does not.

Everything below lives under `modules/community/`, which is the module's whole
tree — the one exception is a thin one-line route declaration per page under
`app/`, because Next scans `app/` and nothing else (see
[`docs/modules.md`](modules.md)).

| The piece | Where |
|---|---|
| the manifest — what this module joins by declaring it | `modules/community/module.json` |
| the switch, and every knob | `config/community.json`, read through `isCommunityEnabled()` / `communityConfig()` (`modules/community/lib/config.ts`) |
| the pure core — every rule as a function, no I/O | `modules/community/lib/rules.ts` |
| the shell — every read and every write | **one file per domain** under `modules/community/lib/`: `profiles` · `groups` · `talk` · `embedded` · `messages` · `unread` · `live` · `feed` · `following` · `moderation` · `reports`, over five `_`-prefixed helpers. `manage.ts` is the BARREL — it names the module's 95 exports and holds no logic. It was one file of 5,902 lines; the layering, and why each helper file exists, is [`docs/modules.md`](modules.md) → *The community's layers* |
| the embed registry — **ships empty**, the app's own list | `modules/community/lib/embeds.ts` |
| the seam an impersonated session finds empty | `modules/community/lib/dm-actor.ts` |
| the one live endpoint | `modules/community/routes/live.ts` (declared at `app/api/community/live/route.community.ts`) |
| the tables · their migration chain | `modules/community/schema.ts` · `modules/community/drizzle/` |
| the member's pages · the operator's | `modules/community/pages/**` · `modules/community/admin/` |
| the only renderer of a post body | `modules/community/components/post-body.tsx` |
| the module's own claim about the running app | `modules/community/smoke.mjs` |
| what is stored about a person, per table | [`docs/data-protection.md`](data-protection.md) §14a–§14g |

### Why `manage.ts` is one big file, and stays one

It is the largest file in the template by a wide margin — around 5,400 lines,
five times the next-biggest thing in `lib/`. Splitting it by domain
(profiles / rooms / DMs / moderation / social / live) is the obvious idea, and
it has been measured rather than argued about (2026-08-07). It makes things
**worse**, for two reasons, and both are worth knowing before proposing it
again:

- 🚨 **It would widen the DM guard.** `dm-guard.test.ts` fails the build on any
  file outside a short allowlist that so much as NAMES `community_conversations`,
  `community_messages` or `community_member_blocks` — and the whole value of
  that list is that exactly ONE production file is on it. But those tables are
  used in **six** of the file's twelve sections, not one: the DM readers (78
  references), live answers (18), spam reports (17), the account-deletion scrub
  (6), following — where a block severs follows (6) — and unread (5). A split by
  domain therefore turns one allowlist entry into six. The guard would still
  pass, and it would be guarding much less.
- **The domains are mutually recursive.** Six call edges run backwards across any
  domain boundary, including three true cycles: `groups ↔ unread`
  (`accessibleGroupIds`/`unreadFor` against `grantedKeysFor`/`groupsFor`),
  `talk ↔ reports` (`guardSendBlock` against `discussionForViewer`), and
  `feed ↔ live` (`changedAt` against `feedSince`). Splitting produces circular
  imports; removing the cycles means rewriting the call graph, which is a
  behaviour change in the module whose failures are disclosures — not the file
  move it looks like from outside.

So the size is a cost that was chosen, not one nobody noticed. What keeps the
file navigable instead is its twelve banner-comment sections, in the order the
module grew: profiles, groups, talk, embedded discussions, live, the deletion
scrub, unread, direct messages, following, the friends feed, moderation, spam
reports.

## What the module guarantees, once it is installed

Four guarantees, each owned by a named file. They hold whatever an app builds
on top, because none of them is a policy — each is a shape the code has.

### 1. Private means private, structurally

Two members can write to each other. Those messages are readable by the two
participants and by **nobody else**: not a moderator, not the operator, not an
admin page, not any export but the participants' own, not an impersonated
session.

That is not a promise this file makes on the code's behalf. It is the code:

- **Every function that reads `community_conversations` or
  `community_messages` takes a PARTICIPANT's member id and puts it in the
  `WHERE` clause.** There is no unscoped reader, for anybody.
  `modules/community/lib/dm-guard.test.ts` walks the whole source tree and fails the
  build when a file outside a short allowlist so much as *names* either table,
  or when an exported reader appears without a participant to scope by. So a
  support view, an admin page or a "just for diagnostics" query is not a
  decision somebody may take badly — it does not compile past the test.
- **An impersonated session finds no DM surface at all.** One seam
  (`modules/community/lib/dm-actor.ts`), and its refusal is the same not-found a
  switched-off feature gives, so a support session cannot learn whether a
  member has any correspondence. Impersonation is defensible because it is
  recorded — and the record says an operator was in an account, not what they
  read. Reading somebody's mail leaves no second trace, so the capability was
  removed rather than logged.
- **A member decides who may write to them.** `blockMember()` is self-service,
  reversible, and makes new messages undeliverable in both directions — with
  the same neutral refusal an unknown or a closed account gets, because a
  refusal that can be told apart announces the block
  (`modules/community/lib/block-surface.test.ts` compares the causes against each
  other). A block touches nothing in the rooms, and it **severs follows in
  both directions by deletion**, inside the transaction that writes it.
- **Deletion empties the words and keeps the tombstone** — the survivor keeps
  their own side. Retention ships OFF (`dmRetentionMonths: 0`); the operator's
  opt-in is `node run.mjs community-prune`, bulk by age and never selective,
  because choosing *which* conversation to delete means knowing what is in it.

**The one exception, and its exact size.** With a spam report, a participant
may attach messages from their own conversation so a moderator sees the
pattern: the reported message plus ids the **reporter** chose, bounded by
`config/community.json` → `report.attachmentMax` (shipped 5, hard ceiling 10).
Each id is re-checked against that message's own conversation, and the act is
recorded as a `dmVisibility` row naming the exact ids — so *"who saw what of my
correspondence"* has an answer. Never a conversation view, never a neighbouring
message, never a "show more".

Add the impersonation carve-out — no DM surface at all — and that window is the
complete list of ways anything private is ever seen by a third party.

⚠️ **A DM report carries no anonymity promise, and the module does not pretend
otherwise.** A conversation has two participants; a report about one of them
came from the other by elimination. There is no way to report a private message
anonymously, and building one would be a promise the arithmetic breaks. Say
that to members rather than implying discretion the shape cannot deliver.

### 2. The kill switch is an edit and a deploy

`"enabled"` in `config/community.json`, read through `isCommunityEnabled()` —
never by re-reading the JSON. It ships OFF, and **a malformed file counts as
off**: the failure mode of this switch is member data flowing where nobody
decided it should, so every doubt falls towards closed.

While off, `/dashboard/community` and the operator's own
`/dashboard/admin/community` answer the same 404 a route that never existed
answers — for everyone, the operator included. **Every community page, server
action and route handler opens with that check, per request.** A nav entry is
cosmetics on it; a hidden button is not a permission.

**There is deliberately no runtime toggle and no admin setting.** Switching on
or off is an edit to the file and the next deploy, because **that deploy IS the
incident response**: a kill switch with three owners is none, and a switch a
compromised admin session can flip is not a switch. Two off-states, and they
differ on purpose (`communityOffReason()`):

| | |
|---|---|
| `disabledInConfig` | nobody decided to have one. Everything answers not-found, the operator included |
| `brokenConfig` | somebody typed something the module cannot read. Exactly one door stays open: the operator's diagnosis on `/dashboard/community` |

That second row is why an incoherent config is not silently repaired. A value
outside its bounds, a wrong type or an unknown key **switches the whole module
off until the next deploy** — including "let members post a bit more often"
typed under the wrong key name. It is the honest failure for a file whose
mistakes are disclosures, and the diagnosis page is the operator's only clue,
which is why it survives the state.

#### Absent and off are two states, and only one of them has tables

`node run.mjs db-migrate` creates this module's tables in an app that has
**installed** the module, and in no other. An app that never ran `module add
community` has none of them, and none of this module's code is in its bundle
either — its routes are only routes while it is installed.

⚠️ **This paragraph used to say the opposite, and the investigation behind it is
worth keeping** — it was correct about the mechanism and wrong about the
conclusion, which is the more instructive combination.

The finding was that migrations cannot be *skipped*. This project applies them
with `drizzle-orm`'s own migrator (`scripts/db/migrate.mjs` — deliberately not
`drizzle-kit`, whose reason is at the top of that file), and it applies a
migration only when the migration is *younger* than the newest one already
recorded:

```js
// node_modules/drizzle-orm/pg-core/dialect.cjs
if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis) { … }
```

So a community migration held back inside the core's chain is not deferred, it
is discarded: once any later core migration lands, it can never be applied by
the supported path. That is still true, and it is exactly why the module system
gives **every module its own journal table** (`__drizzle_migrations_community`)
rather than one shared list. The chains are independent, so installing this
module into an app whose core chain is years ahead still applies its `0000`.

The half that turned out to be wrong was the schema objection — *"a folder
generated from `schema-community.ts` would carry `users` and `media` DDL a
second time"*. Measured before the module system was built: drizzle-kit
registers the `pgTable` objects the **entry file exports**, and this module's
schema imports the core's tables for its foreign keys without re-exporting them.
So pointing a config at `modules/community/schema.ts` is the whole filter — the
generated SQL creates the module's tables and references the core's without
touching them. The rule that keeps it true is in `modules/boundary.test.ts`: a
module's schema must not re-export a core table.

What that costs an app that DOES install the module and then switches it off is
what the old paragraph described: a dozen or so empty tables, bytes in the
catalogue, no query and no index maintenance.

Note what none of this changes: the subject-access exports are unconditional by
design (`lib/privacy/export.ts`), because switching the module off deletes
nothing — a room is archived, never deleted, so an app that ran a community for
a year still holds the data and must still answer for it. **Uninstalling is a
decision about code while the tables are empty**; `node run.mjs module remove
community` looks in the database first and refuses if a single row is there,
because "I could not look" and "there is nothing there" must never be the same
answer.

### 3. Access is derived at read time, and stored nowhere

Groups (`community_groups`) carry exactly one access level each — `open`,
`plan`, `moderators`, `operator` — and only the operator creates them, at
`/dashboard/admin/community`.

- **`mayEnterGroup()` (`modules/community/lib/rules.ts`) compares the level against the
  viewer's role and the plans `hasPlan(memberId, "…")` answers for right now.**
  No membership rows, no cached boolean, no cleanup job — a refund closes a
  door with nothing to reconcile, and a lapsed plan removes activity with no
  job to run and nothing to invalidate.
- **A `plan` room needs ANY of its keys, never all.** A member mid-upgrade
  briefly holds two, or neither — Digistore24 delivers a plan switch as two
  events days apart, in either order.
- **Plan keys are validated when the group is SAVED** (`groupPlanProblems()`),
  against `config/digistore-products.json`. `hasPlan()` **throws** on a key it
  does not know, so an unvalidated key would not mean "no access" — it would
  take the page down for a paying member. For the embed registry there is no
  save, so **build time is write time**: `embeds.test.ts` runs the same
  validation over every declaration.
- **There is no roster.** No member list, no count, no "who is here" — presence
  in a plan-gated room IS purchase information, and the products this template
  is built for are routinely health-adjacent. A member becomes visible by
  posting, and by nothing else.
- **Archive, never delete.** A closed room keeps every word.

**Embedded discussions are the same access grammar, declared in code.** A
discussion can hang off a page rather than a room — the conversation about
lesson three, under lesson three — and the whole integration is one entry in
`modules/community/lib/embeds.ts` (Subject Key + access level + plan keys) plus
`<EmbeddedDiscussion subjectKey heading />` on the page. Two rules make it safe:
the **provenance** rule (the level comes from the declaration, never from a prop
and never from the request — a key nobody declared creates nothing, and "no such
discussion" is
the same refusal as "you are not entitled", so trying keys enumerates neither a
course's structure nor what is gated), and the **composition** rule (host page
and discussion each enforce their own gate server-side, so moving the component
to a differently-gated page cannot widen it). The Subject Key is the app's own
opaque slug and is **never rendered** — a key on screen is course structure
disclosed to whoever was reading the page.

⚠️ **That merge is byte-identical in what it ANSWERS, and not yet in how long
it takes to answer.** `grantedKeysFor()` awaits the entitlement lookup only for
a `plan`-gated declaration, so response latency still separates a declared
plan-gated key from an undeclared one — the content stays closed either way,
but the fact that a key exists and is gated is measurable with enough samples.
It is left open deliberately: closing it costs a database round trip on the
refusal path, and timing channels are `security-gateway`'s measurement rather
than a claim this file can make on its own. Say it that way to anybody asking,
rather than promising a property the code does not yet have.

🚨 **Rooms are rows, and rows do not travel with a deploy.** A group created on
a laptop does not exist in PROD until somebody creates it there — the trap
[`docs/content.md`](content.md) describes, applied here in full. That is a
decision, not an omission: groups are *operational structure*, managed per
environment through the running app's admin surface, which is why there is no
groups applier, and nothing counts them automatically any more. The
verification is a LOOK at the deployed app's admin area, and the skill
`community`'s `check` step owns it. An empty deployed community behind a clean
200 is the named failure.

### 4. The spam loop — and what it honestly cannot do

**The role says WHAT somebody is; the duty says WHERE they act.** A moderator
may remove a post, lock a thread, **read what was reported or mark a report
handled** only in a room a `community_group_moderators` row names them for —
and the queue lists nothing else, so it holds no doors that do not open. The role alone grants nothing — that is the whole
distinction between the third role and an admin (`requireOwner()` refuses a
moderator exactly as it refuses a member). The operator acts everywhere and
needs no row, which is also why an empty duty list on a room means "the
operator looks after it" rather than "nobody does".

Two kinds of report belong to no room at all — a direct message, and a post in
a discussion embedded on a page — and those keep the group-less answer
`mayModerate()` already gives: the operator, plus any moderator holding a duty
somewhere. That is one decision in one function rather than a second scoping
rule beside it.

🚨 **Authority is re-read from the DATABASE at the moment of the act, never
from the session.** Sessions are JWTs and carry the role somebody had when they
signed in, so an operator who takes the role away at eleven expects it gone at
eleven. Every act and every moderation page calls `moderationAuthority()`; a
`session.user.role === "moderator"` check is the bug this rule exists to
prevent.

- **Every act is one append-only audit row, written in the act's own
  transaction.** An act whose record failed to save would be a decision nobody
  can review. A lock and its later unlock are TWO rows: a trail recording only
  the current state answers "was this ever closed?" with silence. There is
  exactly one permitted `UPDATE` on that table (the account-deletion scrub
  emptying a reason written *about* the departing member), and
  `modules/community/lib/moderation-guard.test.ts` fails the build on a second.
- **A removal needs a reason, and the reason is the member's personal data.**
  It travels in both exports. The dialog says so before it is written.
- 🚨 **The automatic send-block is DERIVED from unconsumed reports and stored
  nowhere.** `sendBlock.threshold` distinct reporters (shipped 5) inside
  `sendBlock.windowHours` (24) silences a member's *writing*; reading is
  untouched. **Do not add the "missing" block table or column** — a stored flag
  would need a job to clear it, and a job nobody runs is a member silenced for
  ever by five taps. A test reads the schema and fails if `sendBlock` appears
  in it. The lift is one audited tap that **consumes** every counted report,
  which is why the judged set cannot re-trigger.
- **A report can weigh more than one, and the weight is computed rather than
  stored.** `weighting` ships **off**, where every reporter weighs exactly one
  and the threshold is the distinct count it has always been. Switched on, four
  things already in the database decide: how long somebody has been a member,
  how much live PURCHASED access they hold, how much they have reported, and how
  much they have BEEN reported — the last one subtracting, so a ring whose
  members report each other drives its own weight down. Each is capped, and the
  smallest cap is on "has reported", because it is the one signal a reporter can
  drive themselves.
  🚨 **None of it is stored**, deliberately: a saved score is a second truth that
  goes stale, and it would be a reputation number about a person sitting in a
  table waiting to be exported. The cost is real and is answered by the review
  list rather than hidden — a standing block can dissolve on its own when two
  reporters' subscriptions lapse, with nobody deciding anything.
  ⚠️ **"How much they pay" is counted as ENTITLEMENTS, not money.**
  `orders.amount` sits beside its own currency column and `CLAUDE.md` forbids
  summing across two of them; the alternative is an exchange rate this app has
  no business inventing.
- 🚨 **Two floors, and neither is enough alone.** Blocked needs the summed weight
  to reach the threshold **and** at least two distinct reporters. A single capped
  reporter (400) outweighs a threshold of 2 (200), so without the count one
  heavyweight could silence somebody alone — exactly what the config's floor of 2
  refuses to configure.
- **The post itself can be taken off the page, and that is a SECOND axis.**
  `postHide` ships **off**; switched on, a reported post disappears once enough
  weight agrees — for everybody but its author, who keeps seeing it with a
  sentence saying it is being looked at. It stays readable in the queue, and one
  tap puts it back.
  🚨 **It is not `deletedBy: "system"`** — that value already means "the account
  was deleted", AD-72 allows one deletion event per row (so a moderator could no
  longer remove the post *properly*, with a reason and a trail row), and a
  deletion cannot be taken back. A deletion is an event; a lock is a suspicion,
  and suspicions have to be reversible. So `hidden_at` is its own column, read
  only through `contentState()`.
  ⚠️ **It is an event stamp, not a standing derivation.** The threshold was
  crossed; that does not un-happen because a weight sank afterwards. It is
  cleared by an ACT — consuming the report, or lifting the block — and by nothing
  else, which is why it needs no job and therefore does not re-open the paragraph
  above. The failure direction is a suspected post staying hidden until somebody
  looks.
  ⚠️ **The cost, named:** replies under a vanished post read as answers to
  nothing, which is the very thing the deletion stub exists to prevent. The trade
  is deliberate — spam that is merely greyed out is still spam on the page.
- **Three lists an operator keeps, and they ARE a table.** A whitelist (never
  automatically silenced), a hand-set write block, and "this member's reports do
  not count". 🚨 **This is the deliberate opposite of the two paragraphs above,
  and the line is who decided**: a weight and a block are calculations over rows
  that exist anyway, so storing either would be a second truth; these follow from
  nothing, no derivation can recover them, and they have to survive a redeploy.
  They do not re-open AD-64 either, and the argument is its own wording — *a
  stored flag would need a job to clear it* — because a row a person writes and a
  person lifts needs none.
  ⚠️ **A report from somebody on the ignore list is still WRITTEN, at weight
  zero.** Refusing it would answer that member differently from everybody else,
  and a distinguishable refusal announces the list — after which they open a
  second account. The same call `canDeliverTo()` and `reportProblem()` already
  make. It also keeps the evidence: twenty ignored reports against one person is
  something a moderator wants to see.
- **Who is silenced right now is `/dashboard/community/blocks`.** Moderators read
  it; the operator also sets the lists there and on the rooms screen — through
  one component rendered twice, never two. It shows the automatic and the
  hand-set blocks side by side and says which is which, because one can dissolve
  on its own and the other cannot.
- **Nobody acts on a report they filed**, nor on a block whose counted reports
  include their own — those pass to another moderator or to the operator
  (`conflictOfInterest()`). The operator is never conflicted out: somebody must
  always be able to act, and they are the end of every escalation. The owner is
  never auto-blocked, and neither is anybody holding the moderator role;
  reports against them queue for the operator.
- **The floors, and why they are floors:** `threshold` has a **minimum of 2** —
  a 1 would arm a one-tap silencer and is refused, falling back to the default.
  `expiryDays` ships **null** (until lifted): v1 has no notification channel, so
  a silent expiry would un-silence a spammer with nobody told.
- **An expired-but-unlifted block writes no audit row, and that is correct.**
  Audit records **events**; derivation records **state**. Nothing happened when
  a report aged out of the window — the block simply stops being derivable — and
  a synthetic row saying otherwise would be a decision nobody took, sitting in
  the one table whose value is that every line in it was somebody's act.
- **Retention is `node run.mjs community-prune`.** Handled reports and trail
  rows age out; an **unhandled report is never pruned at any age**, because
  those rows *are* the send-block.

⚠️ **The report queue is v1's only notification channel, and this file states
it rather than leaving it to be discovered.** A new auto-block, a fresh report,
a member complaining — all of it surfaces on `/dashboard/community/reports` and
nowhere else. No mail, no push, no digest. An operator who does not open that
page does not learn. If that is not enough for your product, the digest recipe
below is the seam it is built on — and building it is your decision, not a gap
the template is apologising for.

⚠️ **The residual, stated rather than hidden: a patient sockpuppet farm can
cross any threshold.** Five accounts and a day is not a high wall, and no
number would be — the weighting raises it (a fresh free account weighs less
than a long-standing customer, and reports AGAINST somebody pull their own
weight down) without ever removing it. The module does not pretend otherwise, and the answer is
deliberately not an arms race — it is that the block silences *writing* rather
than access, that lifting it is one audited tap by a real person, that the
queue puts it in front of a moderator immediately, that reporting is itself
rate-limited, and that eligibility is frozen at report time so a farm cannot be
built retroactively. An operator seeing organised reporting has the trail to
prove it and the user administration to act on it. Whoever wants a higher wall
is asking for identity verification, and that is a product, not a knob.

### The floor under a free room

Everything above this line is **reactive**: somebody has to be bothered, and
somebody has to report. In a room gated on a purchase that is enough — the card
is the floor, and the loop only has to deal with people who are already inside
and already paid. In a room whose `accessLevel` is `open` there is no floor at
all: an account costs one typed address, and the loop's first move requires a
victim.

So `newMember` in `config/community.json` charges the **first** act instead of
answering the tenth. An account that is younger than `graceHours` **and holds no
purchased access** writes under tighter limits — `maxPostsPerDay`,
`maxLinksPerPost` (shipped at zero), `maxDmsPer10Min`. Derived at every write
from `users.createdAt` and `grants`, stored nowhere, gone the moment either
condition stops holding.

**It ships ON, and it is the only block in that file that does.** The two above
it — `weighting`, `postHide` — ship off because switching them on changes who
gets *silenced* in an app that is already running, and an operator who updates
and changes nothing is owed no surprise there. This one changes nothing for
anybody who has paid: the exemption is checked before the clock, so a buyer is
free in their first second. In an app that sells access to its community nobody
ever meets it; in one that gives a room away it is the only thing at the door.
A switch that ships off measures nothing and is never found, and that is the
whole argument.

Exempt, in the order the rule checks them: the block being off · an operator or
a moderator · **a member on the protect list** · anybody with a live purchase ·
anybody past the window. The protect list is not decoration — it is the human
override, and `docs/data-protection.md` §14g leans on its existing to call this
a restriction a person can lift.

**Four things this deliberately is not:**

- **Not a captcha, and there is no third party anywhere near the sign-in path.**
  The seam is one line in `app/login/actions.ts` before `sendLink()`, if an
  operator ever needs one. It stays a seam: a captcha is a new runtime
  dependency, a key, and a consent question in `data-protection.md` §13 that no
  app on this template has today.
- **Not `emailVerified`.** The obvious-looking signal, and the wrong one: the
  magic link is this template's default way in, so an account created that way is
  verified in the same second — the field would be set for every attacker and
  *unset* for a share of honest members (Google sign-in, password accounts, an
  address change that clears it). It would brake precisely the wrong people.
  `users.createdAt` is monotonic, cannot be manufactured retroactively, and is
  the same signal `reporterWeight()` already reads as `memberDays`.
- **Not an audit act.** *Audit records events; derivation records state* — the
  rule this file already applies to an expired-but-unlifted block. The grace has
  no moment of crossing: it is true from the first millisecond and false from
  `graceHours` or the first purchase, with nobody deciding anything. A row per
  refused attempt would be a request log in the one table whose worth is that
  every line is a human act, and its length would be attacker-controlled.
  `/dashboard/community/blocks` prints the **rule** instead — one sentence out of
  the config, no query, nobody named.
- **Not a pre-moderation queue.** An approval step makes the operator the
  bottleneck, which is the thing Epic 23 exists to avoid.

⚠️ **The residual, again and sharper than the one above.** The grace raises the
**latency** of an attack, not its cost: twenty accounts made today and used on
Wednesday walk through it untouched. It is also a property of the ACCOUNT, not
of the room, so it applies in a paid room too — where it is invisible, because
everybody there has bought something.

**A community with open rooms wants the other two switched on as well**, and
this is the copyable answer:

```jsonc
"weighting": { "enabled": true, "tenureMax": 100, "paidMax": 100,
               "reportsMadeMax": 50, "reportsAgainstMax": 75 },
"postHide":  { "enabled": true, "threshold": 2 }
```

The reasoning is one sentence: with weighting on, a fresh sockpuppet's report is
worth almost nothing (`memberDays` 0, `paidGrants` 0, and `reportsAgainst` pulls
down), which is the defence against a **reporting** brigade — the same signal as
the grace, pointed at the reporter instead of the writer. `postHide` then makes
a removal fast and fully reversible.

⚠️ Two warnings that go with that block. `postHide.threshold` must stay at or
below `sendBlock.threshold` or the config is refused and the community goes off
— so an operator who *also* lowers `sendBlock.threshold` to 2 has to keep the
pair coherent. And **neither of those two can be made automatic**: they are
app-wide switches while `open` is a property of one group, so an app can have
both kinds of room and the config cannot tell them apart. Making it able to
would mean parameterising both derivations per room, which is more work than
this whole section describes.

### What the brakes are, and what they are not

`posting.maxPer10Min` (20), `messaging.maxPer10Min` (10) and
`report.maxPer10Min` (20) are **noise and cost brakes, not security controls**.
What stops one member reaching another is the block, which the member sets
themselves.

🚨 **`newMember` is the exception in that sentence, and the reason it ships on.**
It is not a noise brake — it is the one thing in this file standing between a
free room and somebody who can type an address, and it is judged by what it costs
an attacker rather than by what it saves a host. Everything else here may be
relaxed on taste; that block is relaxed on a decision.

⚠️ **`posting.imagesMax` is in the same block and is NOT a brake** — it is how
many pictures one post may carry (three ships, ten is the hard ceiling), and `0`
switches member-uploaded pictures off for the whole community without switching
the community off. Every unreadable value falls back to three, which is the same
direction the brakes fall in: towards less. It is the one field in the file whose
value changes a FORM — the composer renders one upload slot per picture, up to
this number — so raising it is visible to members rather than only to the server.

⚠️ **They are in-memory and per process** (`lib/rate-limit.ts`). The template
ships as a single Node process, so one map is the whole picture — run several
instances behind a load balancer and each keeps its own counts, which
multiplies every limit by the number of instances. That is acceptable for the
deployment shapes this template ships with and it is a real limitation rather
than an oversight: a shared store means Redis or a table on the write path, and
neither belongs in a template that promises no new runtime dependency. Revisit
when the app is scaled out.

### What members write, and the one renderer that draws it

🚨 **A post is the first text this template stores that one person wrote for
another to read** — the app's first stored-XSS surface. Three rules hold it:

- **`modules/community/components/post-body.tsx` is the ONLY renderer of post bodies**,
  through the pure `postSegments()`: plain text with line breaks, plus links
  for `http(s)` URLs and nothing else. No HTML, no markdown. The scheme
  whitelist is the one XSS React's escaping does not stop.
  `modules/community/lib/render-safety.test.ts` fails the build if
  `dangerouslySetInnerHTML` appears anywhere in the community tree, and its
  allow-list is empty on purpose.
  ⚠️ **A discussion TITLE is member text too and does NOT go through it** — it
  is rendered as a plain heading, escaped by React and nothing more. Whoever
  gives titles formatting routes them through `postSegments()` in the same
  change.
- **`contentState()` is the only reader that INTERPRETS the deletion columns.**
  Three deletions, three different sentences on screen — the author's, a
  moderator's, and an account that was deleted. A boolean would make a
  moderation decision look like somebody changing their mind.
- **`lastActivityAt` is the module's one materialization**, written solely
  inside the transaction that writes a post. Not by an edit, not by a deletion
  — a deletion bumping a thread would resurrect it at the top of every list.

**A member is named by `displayNameFor()`, everywhere**: the profile name they
chose, else their account name, else a neutral stable placeholder. Never the
email, never blank. A profile shows nothing from billing —
`memberWithProfile()` does not select the address at all, which is a structure
rather than a filter — **do not write a query that undoes that.**
`canParticipate()` is the refusal every community WRITE
asks (`profileIncomplete`); reading never asks it, so a member may look around
before filling anything in.

**Following is one-sided, immediate and VISIBLE** — the row is the follow and
the row is also the visibility. There are deliberately **no follower counts
anywhere** (how many people follow somebody is a fact about *those* people, and
in a plan-gated community an aggregate over the graph starts describing who
bought what; `follow.test.ts` fails the build on one), and no "remove this
follower" — somebody who does not want to be followed blocks.

**The friends feed is derived at read time and stored nowhere**: one bounded,
indexed join of the people I follow against posts in rooms I may enter *right
now*, paged by the module's one cursor. 🚨 A room the viewer cannot enter
contributes **nothing** — not the post, not the room's name, not the thread's
title, not a gap in the order — because a feed that leaked gated activity would
turn a purchase into a broadcast. Direct messages never appear in any feed
(`feed-guard.test.ts` asserts the feed's code cannot name those tables), and
embedded discussions are out too: a Subject Key names course structure.

**That rule is about every surface, not only the feed.** A room the viewer
cannot enter contributes nothing to an **unread dot** and nothing to a **count**
either — a badge saying *3* is the same broadcast as a post, one number smaller,
and "there is activity somewhere you cannot see" is exactly the purchase
information *There is no roster* refuses. Whoever adds a counter asks the same
`mayEnterGroup()` question the reader asks, in the same statement.

⚠️ **A room card DOES say how much is in it — and that is not a hole in the rule
above, it is the rule read exactly.** Since 2026-08-17 a card carries "2
conversations · last one 47 minutes ago", and the thread list carries a post
count per conversation. What the paragraph above refuses is a number about a
room the viewer may NOT enter, and a count of the PEOPLE in one; neither is what
these are. A card only exists for a room `groupsFor()` returned, which is a room
this person may open in full one click further on — so its table of contents
tells them nothing the page itself would not. The **unread dot stays existence,
never a number**: "3 new" is pressure aimed at a member, where "12
conversations" describes a room. The whole argument, and the guard that keeps
the ids access-checked rather than merely intended, are
`modules/community/lib/activity.ts` and `activity-leak.test.ts`.

**The feed shows the authors' faces, and thirty of them cost ONE query.**
There are two doors onto an avatar and picking the wrong one is the mistake
worth naming: `avatarUrlFor(id, viewer)` is for a surface showing **one** person
(a profile page, the member's own preview card), and `avatarUrlsFor(ids, viewer)`
is for a **list** — one `media` statement for the whole page, keyed by media id.
Both ask `mayAccess()` before they call `mediaUrlFor()`, inside the same
function, so
no renderer can perform the second half without the first; an id with no entry
in the answer is the initial-based placeholder, and "no such row", "not for this
viewer" and "gone" are deliberately the same state. A list resolved through the
single door is thirty statements on the busiest page the module has, which is
why `avatar-batch.test.ts` **counts** them rather than asserting a shape.
⚠️ The live channel deliberately mints none: its answer is a signal the client
turns into a route refresh, so an address signed there would never be rendered.

### Pictures in a post — and why they are not a contradiction

A member may attach up to `posting.imagesMax` of **their own** pictures to a
post (three ships; `0` means this community is text and the composer offers no
field at all). They are called `images` throughout, never `attachments`: that
word is already taken in this module for the messages a reporter attaches to a
spam report, capped by `report.attachmentMax`, and two meanings of one word
inside one module is a defect waiting to be written.

🚨 **This does not soften the rule two sections down, and it is worth being
exact about why.** What that rule refuses is *"a URL a member typed that the app
then fetches"* — an SSRF and a tracking pixel at once. A post image is the
opposite shape at every step:

| | |
|---|---|
| **The bytes travel through the app** | `guardUploadEntry()` then `acceptUpload()`, per file, so the type is read from the first bytes rather than believed and the location data comes off. `direct` is deliberately absent — a presigned PUT cannot strip EXIF |
| **The app fetches nothing** | there is no member-typed address anywhere in the path. What is stored is an object in the operator's own bucket, and what is rendered is a signed address this server minted |
| **It is a rendered ELEMENT, never injected markup** | `post-body.tsx` is untouched and still renders plain text, line breaks and scheme-whitelisted links. The pictures are drawn BESIDE it, by `Figure`, from a list the server resolved |

So `render-safety.test.ts` stays satisfied rather than relaxed: its allow-list
is still empty, `postSegments()` still has exactly one consumer, and no
`dangerouslySetInnerHTML` appeared anywhere.

**Where the bytes go, and who may see them.** The key is
`community/post/<YYYY>/<MM>/<id>.<ext>` — this module's own namespace, which
`modules/boundary.test.ts` refuses to let it lie about — and the visibility is
`members`: any active session and nothing more. That is the narrowest of the
four that still works, and each alternative fails in its own direction: `owner`
shows the picture to nobody but its author, `entitled` binds it to a Product Key
the room may not have, `public` puts a member's photograph on an anonymous
bucket address. The room's own door is not this decision — a picture is only ever
reached through a post, and a post through a thread whose access is re-derived
per request; `members` is the floor, not the gate.

**Every picture needs a sentence saying what it shows, and the form asks for
it.** `Figure` takes `alt` or `decorative` and makes the omission a compile
error for a page author; a picture a MEMBER uploads is the one case a type cannot
reach, because the text arrives at runtime. So the description is required
(`communityImageAltInvalid` when it is missing, blank or over the cap) and it is
never derived — not from the filename, not from the post's own text. That is
also why the composer renders **one upload field per picture** instead of one
`multiple` input: each picture needs its own sentence, so the fields are pairs,
and `<MediaUpload>` stays the app's single file door with its structural test
untouched.

**Thirty posts cost ONE attachment query.** `postImagesFor(postIds, viewer)` is
the batch door — `community_post_media` joined to `media`, one statement for a
whole page — and it asks `mayAccess()` before it mints anything, in the same
function, exactly as `avatarUrlsFor()` does for faces. That is why the
attachments are a table rather than an `integer[]` on the post row: an array of
ids cannot be joined, so the cheaper-looking column would have made forty posts
forty statements. `post-images.test.ts` **counts** them.

**A hidden post's pictures do not travel.** Blanked on the same line as its
words, in the reader path itself rather than only in the query's `WHERE` — an
address left on a removed post is a picture still fetchable out of the page's own
payload, and a guarantee that lives in a filter is one a later edit takes away in
silence.

**A picture that cannot be stored fails the whole post.** The opposite of the
avatar card, which saves the name and reports the picture separately — and the
difference is that a post is one utterance. Publishing the words without the
pictures somebody attached to them leaves half a contribution in a room with no
way back, because editing a post does not take pictures. So the refusal keeps
their text in the composer, and anything the attempt already stored is removed.

**Two places pictures deliberately do NOT appear.** The friends feed renders the
words and not the pictures — a feed item is a pointer into a conversation, and
the pictures are where the conversation is. And a **private message cannot carry
one at all**: a room has a moderator and a report queue in it, a private
conversation has neither, so an unsolicited picture there would be the one
delivery nobody can review. The column does not exist on `community_messages`.

**What happens when the member leaves.** Which picture sat on which post is in
their Art. 15 answer as `communityPostImages`; the picture's own facts are in the
core's `media` section, because that is whose table it is. The objects and the
`media` rows go with the account through `deleteOwnedMedia()`, and
`community_post_media.media_id` is `set null` rather than `cascade` — deleting a
picture must not delete other people's threads. That chain is *measured* rather
than argued from two constants agreeing: see
`modules/community/lib/post-image-deletion.test.ts`, which reads the condition
the sweep really builds.

### Live — and the one cursor everything shares

`(createdAt, id)` is the module's one cursor, because a timestamp alone has no
total order. One endpoint answers "what is new since X for viewer Y"
(`modules/community/routes/live.ts`, POST), guarding itself like every route
under `app/api/`: enablement → `currentActiveUser()` → the per-scope access
check the full read uses, re-derived per answer.

**The transport is short-interval polling, and that is a decision rather than a
stopgap** — 5 s visible, 30 s hidden, both in `config/community.json` → `live`,
behind bounds. Every answer is a fresh request through the whole guard stack,
so a member who loses a plan mid-view stops receiving that discussion on the
next poll, which is exactly the hard part a long-lived stream would have to
solve while it is running.

Two properties to build against rather than around: **the cursor is opaque** —
store the token, echo it back, take the next one, and **never parse it**; and
**changes ride the answer
as row-state, never by omission** — so the client **upserts by id**, because a
row arriving twice is that row *changing*. The endpoint **writes nothing**: no
read marker (that is `acknowledgeRead()`'s, and only when the client says it
saw the content), no discussion row.

🚨 **A timestamp this module COMPARES holds milliseconds, and the column says so
(`precision: 3`).** Both consumers of these instants can only carry
milliseconds: a read marker is written from a JS `Date`, and the live cursor
token travels as `String(at.getTime())`. Postgres' default is *micro*seconds and
`defaultNow()` really fills them — so a column left at the default hands out an
instant that neither consumer can represent, and the comparison then reads the
truncated copy as OLDER than the row it was taken from.

Measured, before the precision existed: a message stamped `…:16.107735`, a read
marker naming that very message holding `…:16.107`, and `unreadMessagesFor()`'s
`>` answering *unread* — for ever, for every member with any private message at
all. Nothing leaked and no page broke; the module's one indicator simply stopped
meaning anything.

Two halves, and neither works alone. The columns on both sides of every such
comparison declare `precision: 3` (`community_messages.created_at`,
`community_posts.created_at`, `community_discussions.last_activity_at`,
`community_read_markers.last_read_created_at`, and the deletion timestamps the
cursor's second half reads) — which makes **equality** the normal case. And the
comparison that HAS an id on both sides breaks the tie with it:
`unreadMessagesFor()` compares `(created_at, id)`, so the marker's own message
counts as read while a second message inside the same millisecond does not. The
three room-side reads deliberately have no tie-break — a discussion row carries
`last_activity_at` with no post id beside it, so there is nothing to break a tie
*with*. `unread-parity.test.ts` holds all four reads against the one definition
(`hasUnread()`), and asserts the precision on the schema, because no JS fixture
can express a sub-millisecond instant.

**Whoever adds a table here with its own activity timestamp answers this
question in the same commit:** is this column ever compared against a marker or
a cursor? Then it is `precision: 3`.

## Which community shape belongs to which archetype

The archetypes are `build-app`'s (`references/archetypes.md`); this is the map
back. Every row assumes rooms are few and named after what happens in them — a
room per product is a directory, and directories are where communities go
quiet.

| Archetype | The shape that fits |
|---|---|
| **Content-Access** (courses) | **The flagship**: one plan-gated room for the course as a whole, plus a per-lesson **embedded discussion** on each unit's Subject Key — the same string the unit's activity and its companion already use. The room carries the cohort, the embeds carry the questions, and neither needs a second table |
| **Drip/Automation** | One plan-gated room per *cohort*, not per message. The value is "who else is on day nine" — an embedded discussion under the day's page if the days have pages, nothing at all if the product is mail only |
| **Membership** | Community IS the product. Two or three `open` rooms by topic for everybody with an active plan, one `plan` room where a higher tier is what is being sold, and private messages left on — this is the archetype where members reaching each other is the reason they renew |
| **Gated-Tool** | Usually **no rooms at all**. What buyers want is help with the tool, and that is one `plan` room or a single embedded discussion under the tool's own page — a forum around a tool is a support desk the operator did not decide to staff |
| **Usage/Tokens** | Same as Gated-Tool. Never gate a room on a token package: a balance is not an entitlement, `hasPlan()` answers `false` for one for ever, and a room keyed on it is a room nobody can enter |

Decide this once, before the pages — a room is a column decision (which product
key gates it) before it is a layout. The skill `community`'s `decide` step asks
it, records the answer in `docs/app.md`, and treats "none of it" as a real
answer that ends the conversation.

🚨 **The first row carries a legal consequence, and it is not obvious from
here.** *"The embeds carry the questions"* is, in German law, **Überwachung des
Lernerfolgs** — a contractual right to ask about the material is enough
(BGH 5 February 2026 – III ZR 137/25), and Digistore24's own product criteria
name forums and messenger groups outright. Put together with a paid course whose
learners are mostly not in the room, that is the fact pattern of
**Fernunterricht** (§ 1(1) FernUSG), which needs ZFU authorisation before the
product may be sold — § 7(1) makes the contract void without it, in B2B too. So
adding rooms to a course is a question for a lawyer as well as a product
decision. It is **not** a reason to leave members without a place to ask; it is
a reason to ask early: [`docs/compliance.md`](compliance.md) §6.5, skill
`compliance-check`.

## Recipe — a digest mail, on the cron seam

The report queue is the only channel the module ships (above). A weekly digest
— "three new posts in your rooms, one unread message" — is the usual first
thing an app adds, and it is a job, not a feature: an entry in
`lib/cron/jobs.ts` plus a block in `config/cron.json`.

```ts
// lib/cron/jobs.ts — one entry, beside the pruning jobs.
{
  id: "community-digest",
  describe: "Weekly digest of new community activity",
  async run({ now, settings }) {
    // 1. who is due — read the LAST SENT marker this job wrote, never
    //    "everybody with a plan": rule 1 is that a second run may not
    //    send a second mail.
    // 2. per recipient, derive what they may see AT SEND TIME with the
    //    same functions the pages use — mayEnterGroup(), hasPlan().
    //    A digest is a read surface; a cached "their rooms" list is a
    //    lapsed plan mailed a week late.
    // 3. send, record what was sent, and return one line of NUMBERS.
    return `recipients=${n} rooms=${r} skipped=${s}`;
  },
}
```

The four rules from that file's header, restated because a digest breaks each
of them differently:

1. **Safe to run twice** — sending is not idempotent unless the job *records*
   that it sent. A `lastDigestAt` per recipient is the whole mechanism.
2. **One line of numbers** — `cron_runs.lastDetail` is read by whoever asks
   whether the job works, and it must stay a table with no privacy question
   attached. No address, no member id, no text anybody typed.
3. **Throws on failure** — a swallowed error makes a broken digest look like a
   healthy one.
4. **Well under an hour** — that is the stale-lock window; batch by recipient
   and leave the rest to the next run.

🚨 **No DM content in a mail, ever — an unread count at most.** A digest is
delivered to an inbox the module does not control, it is stored on a mail
provider's disk, and it is read on whichever device holds that inbox. Putting
the words of a private conversation in one would defeat guarantee 1 through the
one door the code cannot guard. The same reasoning bounds a room digest to
titles and counts rather than post bodies, unless the operator has decided
otherwise and recorded it.

Everything else about jobs — the scheduler, the lock, `configuredNumber()`, why
a retention window is never `Number()` — is [`docs/cron.md`](cron.md).

## Recipe — richer post formatting

The shipped baseline is plain text with line breaks plus `http(s)` links, and
it is a floor rather than a placeholder: member text is this template's first
stored-XSS surface, and the smallest renderer is the one that can be reasoned
about.

**An upgrade happens INSIDE `postSegments()` and inside
`modules/community/components/post-body.tsx` — never beside them.** A markdown subset
(emphasis, lists, quotes, code spans) is a legitimate growth: extend the pure
segmenter, extend the component that draws its segments, extend
`render-safety.test.ts`'s expectations, and the one renderer stays one.

What never grows:

- **No raw HTML, no `dangerouslySetInnerHTML`, no sanitiser.** A sanitiser is a
  library whose CVEs become yours, guarding a hole the current shape does not
  have. The allow-list in `render-safety.test.ts` is empty on purpose.
- **No embedded images or iframes from member input.** A URL a member typed
  that the app then *fetches* is an SSRF and a tracking pixel at once.
  ⚠️ **A member's own UPLOADED picture is a different thing and is shipped** —
  see *Pictures in a post* above. It reaches the page as a rendered element from
  a bucket key this app minted, never as an address somebody typed, and nothing
  in this list moved to make room for it.
- **No scheme beyond `http(s)`.** `javascript:` executes on click, and an
  address carrying a bidi override never becomes a link at all, because there
  the URL is both target and visible text.

And if titles are to get formatting, they route through `postSegments()` in the
same change — today they are a plain escaped heading, and that asymmetry is
stated above rather than left to be discovered.

## Recipe — the SSE upgrade

Polling is the shipped transport and the deferred alternative is Server-Sent
Events. 🚨 **Deferred means do not build one now, and do not describe one as
something an app can switch on** — there is no flag, and a recipe is not a
feature. What follows is the shape an upgrade would have to take if a
measurement ever demands it, and the measurement is the first step.
It stays **additive** by construction: the endpoint's response shape is
the contract, so an SSE route is a second way to deliver the same answers, with
the same cursor currency and the same per-answer access re-checks. Nothing on
the page changes its model — store the token, echo it, upsert by id.

**When it is worth doing:** when an app is measurably constrained by request
volume — many members with rooms open all day, and a host bill or a latency
number that says so. Not before. The polling answer is a fresh trip through the
whole guard stack, which is the property a stream has to reproduce rather than
inherit.

**What an upgrade must not quietly drop:**

- the per-answer access re-check — a stream that authorises once, at connect,
  keeps a member in a room they left;
- the cursor as the one currency — a second ordering is a second definition of
  "new";
- the "writes nothing" rule — a channel that marks things read because it
  delivered them empties the inbox of a tab left open overnight.

⚠️ **A host that proxies responses may buffer them**, and a buffered SSE stream
is polling with extra steps and worse failure modes. Measure the deployed path
before committing to it; the shipped transport works everywhere precisely
because it asks nothing of the proxy.

## Recipe — the AI stays out until invited

**The default first, because it is the important half.** The community
registers **no content source**. The in-app assistant and the four `content_*`
tools she calls see nothing of it — not a post, not a room name, not a
discussion title, not a profile. That is a decision, not a gap, and a
structural test keeps it one: `modules/community/ai-boundary.test.ts` fails the
build if a file in `modules/community/lib/` reaches into the content-source layer, or a
file in `lib/content-source/` reaches into the community module.

### What opting in actually means

**What a chat tool returns is sent to the AI provider as part of the prompt.**
`docs/content-source.md` says it in those words, and here it has a sharper
consequence than anywhere else in the app: the community's content is *members
writing about themselves and about each other*. Registering a source over it
means your members' words leave your app for a third party — one you chose,
under their terms, in whatever country their servers are in — every time the
assistant searches while answering somebody.

That may be exactly what a product wants. It is never something to inherit from
a default. So the recipe below has five steps, and two of them are writing
things down.

### The recipe — public group content, and nothing else

"Public" here means **`open`-access groups**: rooms every active member may
enter. Not the open web — nothing in the community is ever session-less.

1. **One entry in `lib/content-source/sources.ts`.** The worked-example header
   in that file is the model; a second source is a second registry entry, never
   a second search implementation.

   ```ts
   const communitySource: ContentSource = {
     id: "community",
     label: "public discussions in the community",
     async search(query, viewer, limit) {
       // 1. signed-in members only — FR-185's floor. `viewer.role` arrives as
       //    null in chat-tool calls, deliberately, so never branch on it to
       //    include moderator- or operator-level rooms: those stay out.
       if (!viewer.memberId) return [];
       // 2. open-access groups only. A plan-gated room's posts belong in a
       //    source only behind the SAME hasPlan() check the room itself makes —
       //    mirroring the group's level, never widening it.
       // 3. read posts through the same lens the pages use: contentState(row)
       //    decides what is renderable, so a deleted, removed or scrubbed post
       //    contributes nothing. Do not resurrect scrubbed words into a prompt.
       // 4. hits link the DISCUSSION PAGE — url app-relative, anchor from
       //    lib/content-source/anchors.ts. Never a file, never a signed URL.
     },
     async get(ref, viewer) {
       // null for "no such discussion" AND for "not visible to this viewer" —
       // the two must be indistinguishable (types.ts on `get`).
     },
     async list(viewer) { /* the open rooms this viewer may enter */ },
   };
   ```

2. **Register it** — `CONTENT_SOURCES` grows to `[knowledgeSource,
   communitySource]`.

3. **Add the allowlist entry** in `modules/community/ai-boundary.test.ts`,
   naming the dated `docs/app.md` decision that authorised it. The test turns
   *"a recorded decision"* into a build-visible one; an entry there without a
   decision behind it is the one way to defeat this.

4. **Record the decision in `docs/app.md`**, under *Decisions worth
   remembering*, with the date and the reason — what is now sent, to which
   company, and why the product needs it.

5. **Update `docs/data-protection.md`** so it still tells the truth. The
   privacy policy is drafted from that file; a recipient that is not in it is a
   recipient the policy does not name.

Steps 3–5 are the recipe, not the paperwork after it. The same two-step —
*decide consciously, then keep the inventory honest* — is what
[`docs/content-source.md`](content-source.md) already demands of any
member-scoped source; this is that doctrine's sharpest instance.

**And the standing rules still apply, unchanged.** The gate is ONE function
called from both the source and the page — two `hasPlan()` calls that agree
today are two that can drift, and a source more permissive than its page turns
the assistant into an existence oracle: it tells a non-buyer that a room exists
and hands them a link that bounces them.

### What is never eligible

🚨 **Private messages. Not as a recipe, not as an option, not "advanced".**

The reason is not a policy laid over the code — it is the shape of the code.
Every function that reads a private conversation takes a **participant's**
member id and puts it in the `WHERE` clause (guarantee 1 above), and a content
source has no participant: it is called with a viewer, on behalf of a model,
inside somebody's chat turn. **There is no reader for it to call.** A source
that wanted DMs would have to grow one first — and the module's guard test
exists to fail the build on exactly that.

So the honest sentence is not "please do not", it is: *the thing you would need
does not exist, and the test is there to keep it from being built.*

The friends feed and member profiles are not recipe material either. A source
over those would be member-scoped personal data with no product justification —
the recipe is posts in open rooms, full stop.

## An app that already exists

**First: which "already exists" is this?** An app on template 0.19.0 or newer
simply does not have the module yet, and that is one command —
`node run.mjs module add community`, then `db-migrate`. Nothing below applies to
it. This section is about an app cloned **before** the module existed at all.

`node run.mjs update` moves **text**, never code. So such an app gets this file,
gets the skill — and the skill refuses itself via its `requires:` line rather
than describing code that is not there. That refusal is the honest answer, and
this section is the rest of it.

**What a hand-retrofit would actually involve**, so the size of it is visible
before somebody starts:

| Piece | What it is |
|---|---|
| the schema | `modules/community/schema.ts` plus its migrations — profiles, groups, moderator duties, discussions, posts, read markers, conversations, messages, blocks, follows, reports, the moderation trail |
| the guard layer | `modules/community/lib/rules.ts` — every access, refusal, cursor and state function, and the structural tests beside it that keep them the only ones |
| export & deletion parity | both subject-access exports and the account-deletion scrub, section for section, or a member's own download and the operator's command start describing different applications |
| the DM scoping | every read function taking a participant's id, and the guard test that refuses a reader without one |

🚨 **Two of these must not be hand-approximated.** The DM invariant (no
unscoped reader, anywhere, for anybody) and the account-deletion scrub of
member text are the two places where "nearly right" is a disclosure rather than
a bug. They are also the two that look smallest from outside.

**The honest recommendation: take a fresh clone and move the app's own code
into it.** The template's code is the customer's and nothing here overwrites
it, so a retrofit is not forbidden — but it is a rebuild of the
hardest-to-get-right code in the template, owned by whoever does it, and the
tests that make the invariants hold are part of what has to come across.

## Over the API — the rooms, for a member's own program

A mobile companion reads and writes the rooms through `/api/v1`
([`docs/api.md`](api.md)), on a per-member bearer key rather than a cookie.
Four endpoints: the room list, one thread with a page of its posts, the cursor
endpoint's bearer twin, and writing a post.

Because the module contributes routes to that surface, it declares
`"requires": ["api"]` — **a community is installable only in an app that also
has the API module.** `node run.mjs module check` says so on every run.

Four things about it are decisions rather than details:

- **One `liveAnswerFor()` behind two doors.** The browser polls
  `/api/community/live` with its cookie; the companion posts to
  `/api/v1/community/live` with its key. What differs is the two lines of
  authentication and nothing else — a second implementation of the answer would
  be a second opinion about who may read a room, which is the one thing this
  module cannot afford two of.
- 🚨 **No private messages, and the refusal is by NAME.** The bearer twin
  refuses a `conversation` scope with a sentence saying so. On the cookie twin
  the same scope answers `unavailable`, indistinguishable from "no such
  conversation", and that difference is deliberate: there the question is about
  one member's correspondence and any distinction is an oracle; here the
  question is what the API carries at all, which is nobody's private
  information. The allowlist in `lib/dm-guard.test.ts` did not grow for this
  surface — nothing under `/api/v1` may so much as name a DM table.
- **The cursor stays opaque.** Store it, echo it, never parse or construct one.
  That holds for a companion exactly as it holds for the web client (AD-70).
- **No moderation, no room creation, no roster.** The API is a member's door.
  An operator's acts stay in the web app, and the absent member list is absent
  here too, for the reason it is absent everywhere: presence in a plan-gated
  room is purchase information.

**There is deliberately no `coreExport` for this module.** The shared core
(`node run.mjs export-core`) carries pure decision code so a companion computes
the same answers as the app — and the community has nothing a companion needs to
compute. The cursor is opaque by design, and access is re-derived on the server
for every single answer, never cached or predicted by a client. A pure copy of
`lib/rules.ts` in a companion repo would be a file with no job, kept in step for
nothing. If a companion ever needs to render something before the server
answers, that is the moment to revisit this — not before.

---

## What this file refuses to promise

- **No operator read-access to private messages.** Not as a recipe, not as a
  support tool, not "just for diagnostics" — ever. The guard test exists to
  refuse the code that would provide it, and refusing it is the point.
- **No public or SEO-visible community.** Nothing here is ever ANONYMOUS. A
  discussion indexed by a search engine is a member's words republished by an
  app they trusted with them.
  ⚠️ That sentence used to read *"never session-less"*, and it had to be made
  more precise rather than deleted when the bearer surface arrived: `/api/v1`
  has no cookie session and cannot have one, and it is still not a way in
  without an account — a per-member API key is the same member, proven
  differently. What has not moved an inch is the rule underneath: every answer
  is derived for ONE named viewer, and there is no reader anywhere that answers
  without one.
- **No websocket server.** Polling ships, SSE is the deferred upgrade above,
  and a long-lived connection with its own auth lifetime is not something this
  template will grow quietly.
- **No AI moderation in the core.** A model deciding what a person may say is a
  product decision with a legal shadow, and it belongs to the app that wants
  it — recorded in `docs/app.md`, not inherited from a template.
- **No support-desk semantics.** Tickets, assignment, SLAs and "resolved"
  states are a different product; the report queue is a moderation queue and
  stays one.
- **No follower counts and no social-graph surface.** Not on a profile, not on
  a list, not on an operator page — in a plan-gated community an aggregate over
  the graph starts describing who bought what.
- **No notification centre and no push in v1.** The report queue and the unread
  indication are the answer; the digest recipe above is the seam if that is not
  enough.
- **No group roster.** No member list, no count, no "who is here" — presence in
  a plan-gated group is purchase information, and this is the refusal the
  module was designed around rather than one added at the end.
