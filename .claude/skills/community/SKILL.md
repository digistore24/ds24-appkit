---
name: community
description: Gives an app a place where its members meet — this app's own rooms, discussions hanging under its pages, gated on what people actually bought; also whether to have one at all, and an audit. Use this when the user says "my buyers should talk to each other", "I want a forum for my members", "can my customers message each other", "my people sit at home alone", "my people feel alone in the course", "move my Facebook group somewhere of my own", "who moderates this?", "add a community", or when a membership product has nothing in it but content. For WHO pays for what use `setup-digistore`; for the privacy audit of what members write, `security-gateway` and `compliance-check`.
requires: 0.19.0
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# A place for members

Buyers who talk to each other stay. That is the whole business case — and a
community is also the first place where one customer's words are shown to
another, where a room's membership is a list of who bought what, and where one
bad default discloses something nobody can take back.

So the risky half is already built and identical in every app that installs
it: who may enter, who may read, what a moderator may do, what nobody may ever
read. **What this skill builds is the texture** — which rooms, which discussions
under which pages, gated on which product.

⚠️ **The community is a MODULE, and a fresh app does not have it.** Installing
it is step 2a below (`node run.mjs module add community`, then `db-migrate`) —
one command, not a version. Do not read its absence as an old clone.

The reference is [`docs/community.md`](../../../docs/community.md) — what the
core guarantees, which shape fits which archetype, the recipes, and what it
refuses to promise. **This skill does not repeat it.** Where a fact is needed,
that file is named and the conversation moves on.

## How to use this skill

Four items. You do not have to know which one you want.

| # | | What it does | Roughly |
|---|---|---|---|
| 1 | **`decide`** | should this app have a community at all — and which shape | 10 min |
| 2 | **`build`** | switch it on, create this app's rooms, hang a discussion under a page | 30–60 min |
| 3 | **`gate`** | who gets into which room, on which product key | 15 min |
| 4 | **`check`** | the community that already exists: four failures no other gate finds | 20 min |

**How to dispatch:**

- If the user already said what they want ("a room for my course buyers", "put
  a discussion under lesson three"), start that item. Do not show the menu
  first.
- Otherwise show the table, say that **`decide`** is where somebody who has not
  thought about it starts, and **wait**.
- *"My buyers should talk to each other"* with nothing else: **`decide`**.
- **You run the commands** — through your Bash tool, not by telling the user to
  type them. That is the rule for the whole template.

**There is deliberately no "run them all."** The inspecting skills
(`ux-gateway`, `security-gateway`) open with one, because running every check
before a launch is always right. Here it would mean building rooms nobody asked
for — the opposite of this skill's own first item.

## First, always

Look before you ask (`docs/guidance.md` → *How a skill works*):

| Where | What it answers |
|---|---|
| `docs/app.md` → *Decisions worth remembering* | was a community already decided — **including a "no"** |
| `docs/product-brief.md` | did the product ever promise members each other |
| `config/community.json` → `"enabled"` | is it already on |
| `node run.mjs module list` | is the module installed at all — the FIRST question, and the only thing that answers it |
| `modules/community/lib/embeds.ts` | which discussions already hang under pages (empty is the shipped state, not a defect) |

**A decision already taken is reported, not proposed again** — for or against.

🚨 **A recorded "no community, deliberately, because…" ENDS this skill.** Not a
summary and a fresh menu: say what was decided and when, and stop. The reasons
people say no here are good ones — nobody to moderate it, a product where
buyers must not meet each other, a launch too small to fill a room — and none
of them expires because a new session started.

## 1 · `decide` — should it, and which shape?

⚠️ **Not having a community is the normal state, not a defect and not an old
clone.** `node run.mjs module list` is what says whether this app has the
module; if it does not, that is step 2a and nothing here is blocked. The one
case that genuinely ends the skill is an app whose tree has no
`modules/community/` at all — cloned before the module existed. Say so then,
and that `node run.mjs update` brings guidance but never code.

Read the app's archetype (`docs/app.md`, or `docs/product-brief.md`), take the
matching row from
[`docs/community.md`](../../../docs/community.md) → *Which community shape
belongs to which archetype*, and put it as a numbered menu — the Step-1d
grammar from `build-app`, with all three answers offered **in** the menu:

> Your buyers all work on the same thing alone. What should they have?
>
> 1. one room for everybody who bought — the cohort in one place
> 2. a discussion under each lesson/day — questions where the question comes up
> 3. both: the room for the cohort, the discussions for the detail
> 4. rooms **and** private messages, so members can also reach each other directly
> 5. you choose — I take what fits your product
> 0. none of it — no community, and I write down why
>
> A community costs no money per use. What it costs is **attention**: somebody
> has to read the report queue, and rooms nobody tends go quiet or go bad.

Say the attention cost out loud before they answer. It is the honest price of
this feature and the one nobody budgets for.

- **numbers** → exactly those get built
- **"you choose"** → the archetype's row from the reference, no further question
- **`0`** → nothing gets built, and it goes into `docs/app.md` under *Decisions
  worth remembering*, with the date and the reason

Write the outcome into `docs/app.md` either way — the chosen shape with the
rooms it implies, or the `0` with its reason. **When** matters: this is a
column decision (which product key gates which room) before it is a layout, so
it is asked once, before the pages, not again on every page afterwards.

## 2 · `build` — this app's community on the module

Five steps, in this order.

**a. Install the module.** `node run.mjs module add api` **first** — the
community serves endpoints on the HTTP API's surface and declares
`requires: ["api"]`, so adding it on its own is refused by name and changes
nothing. Say that to the user as a cost rather than a footnote: the `api_keys`
table and the App-keys card on `/dashboard/account` arrive with it, and the API
itself stays switched off in `config/api.json` until somebody decides otherwise
([`docs/api.md`](../../../docs/api.md)).

Then `node run.mjs module add community` and
`node run.mjs db-migrate` — it brings its own tables on its own migration
chain, and they are not there until that second command has run. ⚠️ **How many
is not written here on purpose**: it said "twelve" while the manifest listed
thirteen, and a number in prose beside a list that grows is a sentence that
goes quietly wrong. `node run.mjs module list` counts them, and
`modules/community/module.json` names them. Skip it and every
step below acts on a feature the app does not have: the routes do not exist,
the config switch changes nothing, and the first page answers the same 404 an
absent route answers. `node run.mjs module list` is the check.

**b. The switch.** `config/community.json` → `"enabled": true`, then read it
back through `isCommunityEnabled()` — never by re-reading the JSON. It ships
off, a malformed file counts as off, and switching on is this edit plus the
next deploy: there is no runtime toggle and no admin setting, because that
deploy IS the incident response. While you are in the file, leave the brakes
alone unless asked; an unknown key or an out-of-range value there switches the
**whole module** off until the next deploy.

⚠️ **Three blocks in that file are about spam. Two ship OFF, one ships ON —
mention them once and move on unless the user asks.** `weighting` makes a report
from a long-standing paying member weigh more than one from an account made this
morning; `postHide` takes a reported post off the page automatically while it
waits to be judged. Neither is needed to open a community, and switching either
on is a decision about how the rooms are policed rather than about whether they
exist. What they do, and the two floors no setting can configure away, is
[`docs/community.md`](../../../docs/community.md) → *The spam loop*.
Needs template 0.31.0.

🚨 **The third is `newMember`, and it is the one that is already on.** Those two
are reactive — somebody has to be bothered and report — and that is enough only
where a purchase is the price of entry. `newMember` limits an account that is
new **and** holds no purchased access, which in an app selling access to its
community is nobody, and in one with an `open` room is everybody at the door.
Leave it alone unless the user asks; if they do, or if this app will have an open
room, the section is [`docs/community.md`](../../../docs/community.md) → *The
floor under a free room*. Needs template 0.34.0.

**c. The rooms — created in the RUNNING app, not in code.** Start the app
(`node run.mjs start`) and create them at `/dashboard/admin/community` as the
operator: a name, a description, one access level, and for a `plan` room the
product keys.

⚠️ **Say this to the user in plain words, because it is the trap:** rooms are
**rows**, and rows do not travel with a deploy. Every group created here exists
on this machine and nowhere else — the deployed app needs the same rooms
created in ITS admin area, by hand, at go-live. That is deliberate (rooms are
operational structure, per environment), there is no applier and no command
that counts another environment's rooms, and item 4's fourth hunt is the check
that catches it.

**d. The discussions that hang under pages** — one declaration and one
component, and nothing else:

```ts
// modules/community/lib/embeds.ts — the only place a Subject Key and its access
// level are ever written down. Ships empty.
{ subjectKey: "kurs:wehen-atmung:lektion-3",
  accessLevel: "plan",
  planKeys: ["course_complete"] }
```

```tsx
// the lesson page, after its own guard. Nothing else is required of it.
<EmbeddedDiscussion subjectKey="kurs:wehen-atmung:lektion-3" heading={t("discussion")} />
```

The Subject Key is **the app's own opaque slug** — the same string that unit's
activity and its companion already use. Never pass an access level or a plan
key as a prop: the declaration decides, the request never does. And never
render the key — an embedded discussion draws its heading from the host page.

**e. Members need a name before they can write.** `canParticipate()` refuses a
write with `profileIncomplete` while a member has no display name — deliberate,
because a magic-link account has none and every post would otherwise carry a
placeholder somebody else picked. Reading never asks it. If the app has an
onboarding checklist, "choose how you appear to other members" belongs in it
(`user-onboarding`).

**Then the template's own routine, and it is not optional:**

```bash
node run.mjs start
node run.mjs smoke     # every page, anonymous and signed in
node run.mjs errors    # what a 200 hides
```

Then open the community yourself as the operator **and** — through
impersonation or a second account — as a member who has not bought the gated
product. A page that loads is not a page that gates.

Finish with **one entry in `docs/app.md`**: the rooms, the embeds, and the
access gate quoted as code (`hasPlan(memberId, "course_complete")`), never as
prose.

## 3 · `gate` — who gets into which room

One access level per room, and `hasPlan()` is the only answer to access —
never a billing table.

- **`open`** — every active member. **This is first-class, not a missing
  gate.** A membership product's main room is usually open, and dressing it up
  in a plan key nobody checks is worse than saying "everybody who is in".
  ⚠️ **It is also the one level with no floor under it**, because an account on
  this template costs a typed address and everything else in the spam machinery
  waits for somebody to complain. The shipped answer is `newMember` in
  `config/community.json` — on out of the box, invisible to anybody who has
  bought something. Before you create the first open room, read
  `docs/community.md` → *The floor under a free room*, and say to the operator in
  one sentence what it does and what it does not (it delays an abusive signup, it
  does not make one expensive). Needs template 0.34.0.
- **`plan`** — product keys from `config/digistore-products.json`. 🚨 **Never
  invent a key.** They are validated when the group is saved
  (`groupPlanProblems()`) because `hasPlan()` **throws** on a key it does not
  know — a typo'd or retired key would not mean "no access", it would take the
  page down for a paying member. A `plan` room needs ANY of its keys, never
  all: a member mid-upgrade briefly holds two, or neither.
- **`moderators`** — the back room for people with a duty. The role alone is
  not the duty: a moderator acts only in rooms a
  `community_group_moderators` row names them for, assigned in the same admin
  surface. An empty duty list means the operator looks after that room.
- **`operator`** — notes to self, effectively. Rarely what somebody wants.

Embeds use the same four levels, in the declaration. The host page's own gate
and the discussion's gate **compose** — neither delegates to the other — so an
`open` embed on a paid lesson page is legal, and is almost always a decision
nobody actually made.

If the app sells token packages: a balance is not an entitlement. `hasPlan()`
answers `false` for a token package for ever, so a room keyed on one is a room
nobody can enter.

## 4 · `check` — the community that already exists

Four hunts, in this order. Each says what it reads.

1. **The ungated embed.** Read every declaration in `modules/community/lib/embeds.ts`
   and open the page each one sits on. Does the discussion's access level match
   what the page's own content demands? An `open` embed under a lesson gated on
   `course_complete` means anybody signed in reads what buyers wrote about
   material they did not buy. ❌ HIGH when the levels disagree and nobody
   decided it; ℹ️ when the page itself is open.
2. **The leaking profile.** Read what the profile page and the member card
   actually **select**, not what they display — `memberWithProfile()` does not
   select the email at all, and a new query written since is free to have
   undone that. Nothing from billing, no purchases, no account data, no email.
   Then request a profile with no session: it must answer nothing.
   🚨 CRITICAL on an email or a purchase reaching a profile surface.
3. **The dead report queue.** A report has to reach somebody who reads it — the
   queue is v1's **only** notification channel, so nothing else will tell them.
   Check that rooms with traffic have a moderator duty assigned (or that the
   operator has accepted the job), that `/dashboard/community/reports` renders,
   and file one test report end to end — then handle it, so the queue is left
   as you found it. ❌ HIGH on a room with traffic, no duty and an operator who
   has never opened the page.
   ⚠️ **Then open `/dashboard/community/blocks` too, and this is a second
   question rather than the same one twice.** The queue asks "what is waiting to
   be judged"; that page asks "who is silenced right now" — and somebody can be
   silenced with an empty queue, because a block is derived from reports a
   moderator has already stopped looking at. ❌ HIGH on a member silenced longer
   than a few days that nobody has looked at. Needs template 0.31.0.
4. **The dev-only rooms** — the content-in-PROD trap. Rooms are rows and rows
   do not travel with a deploy, so the deployed app can serve a clean 200 over
   an empty community. **Be honest about how this is checked: there is no
   command that counts another environment's rooms** (`node run.mjs content-check` does, because this module answers for its own rooms through `presence` — see `docs/modules.md`; the first version of that command counted only applier rows,
   applier rows and manifest files; groups are deliberately not
   content-as-code). So: open the deployed app's `/dashboard/admin/community`
   as its operator and LOOK — or have the operator look and report back. Do the
   same for the member's `/dashboard/community`. 🚨 CRITICAL on an empty
   deployed community for an app that sells one.
5. **The free room with no floor.** Read `config/community.json`: does any group
   have `accessLevel: "open"` (check `/dashboard/admin/community`), and does
   `newMember.enabled` say `true`? Everything else in this module's spam
   machinery is reactive — somebody must be bothered and report first — and in a
   room where an account costs one typed address that loop needs a victim before
   it starts. ❌ HIGH on an open room with `newMember` switched off and an
   operator who did not decide that. ℹ️ if every room is gated on a plan: the
   grace exempts anybody with a live purchase, so it never fires there and the
   setting is moot. While you are in the file, say what the other two are for —
   an app with open rooms usually wants `weighting` and `postHide` on as well,
   and `docs/community.md` → *The floor under a free room* carries the block to
   copy and the two warnings that go with it.
   ⚠️ Say the limit out loud rather than selling it: this raises the LATENCY of
   an abusive signup, not its cost. Accounts made today and used on Wednesday
   walk through. Needs template 0.34.0.

Findings in the house shape (🚨/❌/⚠️/ℹ️ · Where · Why · Fix · Evidence), and
the verdict goes dated into `docs/reports/` **every time** — a solo `check`
too. Anything that produces a verdict writes it down; "have we already done
that?" needs an answer next month.

## The rules

- **A "no" is an answer, it is written down, and it stops this skill.** Not
  negotiated, not asked again next session.
- **The private messages are the module's hardest line, and nothing here
  softens it.** Readable by the two participants and by nobody else — not a
  moderator, not the operator, not an admin page, not an impersonated session,
  not any export but the participants' own. **Never build a DM reader**: a
  support view, an admin page, a "just for diagnostics" query — the shipped
  guard test refuses it, and refusing it is the point.
- **Nothing of the community reaches an AI provider unless the operator
  decides it does — and private messages never do.** The module registers no
  content source, and a structural test keeps it that way
  (`modules/community/ai-boundary.test.ts`). Public group content can be wired
  in deliberately: the recipe, and the two things it must be recorded in, are
  [`docs/community.md`](../../../docs/community.md) → *Recipe — the AI stays
  out until invited*. 🚨 **Private messages are never eligible** — not as a
  recipe, not as an option: every DM read function demands a participant's
  member id, and a content source has no participant, so there is nothing for
  one to call.
- 🚨 **Rooms attached to a paid COURSE change what the course is, legally.** A
  contractual right to ask questions about the material is *Überwachung des
  Lernerfolgs*, and together with lessons the learner works through alone that
  is **Fernunterricht** (§ 1(1) FernUSG) — which needs ZFU authorisation before
  the product may be sold, and without it § 7(1) makes every contract void, in
  B2B too. Say this once, plainly, when a course is what the rooms hang off; do
  **not** talk the user out of the rooms and do **not** answer the question
  yourself — hand it to `compliance-check`
  ([`docs/compliance.md`](../../../docs/compliance.md) §6.5).
- **Never add a member list, a member count or a "who is here".** Presence in a
  plan-gated room IS purchase information, and this template's products are
  routinely health-adjacent. Same for follower counts.
- **The gate lives in the declaration or the group row, never in a prop.** A
  gate the browser sends is no gate.
- **`guardrails` wins.** This work stores what one customer wrote for another
  to read, and it decides who sees whose purchases; where anything here
  disagrees with that skill, it is wrong.

## What comes next

- **Built one** → **`ux-gateway`**: there are new surfaces a paying customer
  meets — posting, reporting, an empty room — and its keyboard and small-screen
  checks now have something to check.
- **Then** → **`security-gateway`**: the community is the app's largest
  personal-data surface, and its IDOR hunt covers every one of the new routes,
  the embeds and the live channel.
- **Before go-live** → **`compliance-check`**: what members write is personal
  data, and `docs/data-protection.md` §14a–§14g is what the privacy policy is
  drafted from.
- **A recorded `0`** → nothing. The decision is written down; say so and stop.

Name whichever of these has not run, and offer to start it.
