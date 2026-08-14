<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Courses — the three shapes, and how to build each one

The online course is the commonest thing sold through Digistore24, and "build
me my course" names three different applications. The difference is not in the
tables — all three store units and results. It is in **two decisions**: *when
does a unit become visible*, and *who answers what the learner produced*. Both
are columns before they are screens, so settle them **before the data model**
(`build-app` Step 2), not after the pages. A third decision comes before
either: **who authors this content** — a course only the developer himself
maintains keeps its blocks and units in code and needs none of the content
tables below, only the state tables
([`docs/content-authority.md`](content-authority.md)).

This file is a specification to build from, not code to copy. Every schema
block below is written to be pasted into a `db/schema-*.ts` file — **and
re-exported from `db/schema.ts`**, because `drizzle-kit` reads only that
barrel: skip the `export * from "./schema-courses";` line and
`node run.mjs db-generate` produces an *empty* migration and the first page
dies on a missing table. Then the nine steps of `CLAUDE.md` → *Adding a
feature* apply to every page here — the `NAVIGATION` entry, the texts in
both `messages/*.json`, vitest for the rules. Every pointer names real,
shipped, tested code in this template to use as the model. What already has its own reference
is pointed at, not restated: files behind a purchase are
[`docs/visuals.md`](visuals.md), access is [`docs/entitlements.md`](entitlements.md),
scheduled work is [`docs/cron.md`](cron.md), migrations are
[`docs/database.md`](database.md) — and lesson media that do not exist yet are
produced via [`docs/content-production.md`](content-production.md) (skill
`content-production`).

🚨 **One legal question comes before all three shapes, and it is the only one in
this file that can stop the product being sold.** A paid course whose learners
are "ausschließlich oder überwiegend" not in the room, and whose learning
outcome is *monitored*, is the fact pattern of **Fernunterricht** under
§ 1(1) FernUSG — and that needs state authorisation before the first sale, with
§ 7(1) making the contract **void** without it, in B2B too. ⚠️ **The monitoring
element is cheaper to trigger than it sounds**: a contractual right to ask
questions about the material carries it, so the `community` module does and an
auto-graded quiz does not. Shape 3 carries it most plainly of all, because there
a person judging what was handed in IS the product. Do not answer it from this
file and do not answer it yourself: the elements, the consequence, what
Digistore24 asks for and who decides are
[`docs/compliance.md`](compliance.md) §6.5, and the skill is
`compliance-check`.

## The module, and the one file you set

The course is a MODULE — `node run.mjs module add courses`, then `db-migrate`.
A fresh app does not have it, and `node run.mjs module list` is what says so.

### A course is a folder, and an app may hold several

```
content/course/<course-slug>/course.json    title, summary, position, shape, planKeys
content/course/<course-slug>/<block>.json   its blocks, with their lessons
```

The **directory name is the course's slug** — the segment in
`/dashboard/course/<course>/<lesson>` — and it is not repeated inside
`course.json`: two places to write it are two places to write it differently,
so a `slug` key there is refused rather than ignored.

🚨 **`shape` and `planKeys` belong to the COURSE, not to the app.** An app with
a self-study primer and an accompanied workshop needs both shapes at once, and
two courses sharing one key list would be one course in two halves. What stays
in `config/course.json` is the question that really is about the installation —
is the course surface running here at all. A leftover `shape` there is reported
as an unknown field rather than obeyed: a value nobody reads is one somebody
believes they set.

⚠️ **Lesson and block slugs stay unique across the whole APP**, not per course.
That is not carried over by accident: `courses_completions.unit_slug`,
`courses_submissions.unit_slug`, an activity's `subject` and a companion's
conversation all key on the bare string, so a `woche-7` in two courses would
merge two learners' states into one. A second course prefixes its slugs
(`kurs-b-woche-7`) — the same convention *Subjects* below already described.

Its switch is **`config/course.json`**, and it ships OFF. That is not caution:
the commonest reason it is off is the window between installing the module and
writing the content, and a course whose pages answer before it has lessons is an
empty product behind a clean 200. Switch it on AFTER `content-apply`.

Two directions, on purpose:

| | |
|---|---|
| `enabled` unreadable | **OFF** — every course route answers the document a route that never existed answers |
| `shape` unusable | **BROKEN, and never a default.** `self-study` is the most permissive shape, so a drip course whose config went unreadable would open week ten on day one. The operator gets a diagnosis page naming the bad value; a member gets the 404 |

`node run.mjs courses-check` reads the switch, the product key, the slugs and
the media your content names. Whether an ENVIRONMENT holds the course is a
different question and a different command — `content-check`
([`content.md`](content.md)).

🚨 **Two origins, one column.** Every block and lesson row says where it came
from — `courses_blocks.origin` / `courses_units.origin`, `content` or
`operator` — and that column is what makes two lawful writers possible instead
of two writers fighting over one row (spine AD-82).

| `origin` | Whose row it is |
|---|---|
| `content` | the applier's. It came from `content/course/*.json` through `node run.mjs content-apply`, keyed by slug, and every run re-asserts it |
| `operator` | the admin surface's. It was made in ONE environment, travels with no deploy, and no applier ever touches it |

The applier writes `content` and nothing else: each `on conflict` carries
`where courses_*.origin = 'content'`, so it cannot reach the other half. And
when a content file claims a slug an `operator` row holds, the run **refuses**
and names slug and file — it does not write around it. Skipping quietly would
apply the file's lessons onto a block the operator owns, which is a half-applied
course rather than a skipped row. `lib/content/writers.test.ts` holds both
halves: the applier's SQL is read, and the module ships no mutating setup tool.

The module's setup tools (`courses_outline`) **read** — an agent can ask a
remote environment what it holds without a production connection string, and
that is all.

What it answers carries, per block, its `unitCount`, and per lesson a
`fingerprint`: 64 hex characters over that lesson's own content — slug, title,
body, task prompt and, per media slot, **which file sits in it** — so an agent
preparing a publish can see **which** lesson differs from its files without
downloading the course. Same content in two environments, same string; a changed
body moves exactly that lesson's, and so does a video swapped for another video.
It is a comparison key and never a secret, and no lesson text goes over this
surface either way.

⚠️ **What identifies the file is its storage key, not its media id.** A media id
exists once, in one database, so hashing one would make DEV and PROD disagree
about a lesson that is identical in both. The key
`content/<topic>/<file>.<ext>` is what `content-apply` looked the row up under,
so the repo composes it from its own manifest path and the environment reads it
off the row — two sides, one string, and neither of them sends it: what travels
is the digest.

🚨 **The payload also says which version of the fingerprint it computed**
(`fingerprintVersion`), and that matters exactly once: right after a template
update, when this repo has moved and the environment has not. The two versions
are not comparable, so every lesson reads as differing — `courses-diff` says so
in its own paragraph above the lists instead of letting you read it as a course
that changed overnight. Deploy the environment and the report goes quiet again.
Publishing in that state is not wrong; the applier upserts by slug and writes
the same rows either way.

### Before you publish: what would actually change

`node run.mjs courses-diff --env prod` reads that environment **first** and then
compares it against this repo's content files — with the same fingerprint, so
there is one definition of "changed" rather than two that agree today. It writes
nothing, anywhere, in either place, and it exits 0 whatever it finds: it is a
preview, not a gate. Four lists come out, blocks and lessons each:

| | |
|---|---|
| **new** | here and not there — a publish would create it |
| **would change** | in both, and the content differs. A block also says which of its four applied fields moved |
| **untouched** | in both, and it does not |
| **present in the target only** | there and not here. 🚨 **Publishing will not delete it** — no applier deletes anything. The list separates the rows the applier owns (`origin` `content` — the repo used to carry them) from the operator's own, which no applier ever touches |

A fifth list is the one worth knowing about: **would be refused**. A content file
whose slug is held by a row this applier does not own does not "change" that row
— `content-apply` refuses the **whole run** and writes nothing at all. The two
ways out are the applier's own: change the slug in the content file, or delete
the operator-authored row on the admin surface.

Two refusals are worth recognising, and neither is an empty course. *The setup
surface is off there, or that app predates it* — switching it on is a deploy
([`setup-mcp.md`](setup-mcp.md)). And 🚨 *that environment has no `courses` module
installed*: an app without the module and an app with it and no lessons both hold
zero lessons, and reading the second as "all your lessons are new" would propose
a publish into a database with no `courses_units` table.

Needs template 0.24.0.

### There is already one under a different slug

A sixth section appears only when there is something in it: **same subject,
different slug**. The two rows have never met — `courses-diff` matches by slug in
both directions, because slug is what the applier upserts on — so a block the
operator published as `kurs-grundlagen` and a block this repo calls `grundlagen`
are simply one *new* row and one *only there* row, and a publish would create the
second course beside the first without anybody being asked.

That section is **not a difference. It is a question**, and the command does not
ask it: it prints the pair and both consequences, and the asking belongs to the
agent, in the conversation, where a person is present. It is also where the two
answers stop being symmetrical:

| The operator chooses | What actually happens |
|---|---|
| **update the existing one** | the agent sets the LOCAL slug to the TARGET's slug in `content/course/*.json`, and the applier's upsert-by-slug does the rest. The lessons customers currently see are replaced by the ones in the files — and **their progress survives**, because `courses_completions` and `courses_submissions` key on `unit_slug`, never on a content row's id ([`content-authority.md`](content-authority.md)). Somebody who finished lesson three has still finished lesson three |
| **a second one** | the local slug stays distinct. The existing rows are untouched, their buyers stay where they are, and the new block's `position` decides where it appears among them |

🚨 **The answer is expressed in the repo's slugs and never as a parameter.**
There is no `--update`, no flag and no tool argument saying "this one" — the
applier is the only writer of those rows, keyed by slug, from files in the repo
(spine AD-82). A flag would be a second writer with a second opinion about which
row is meant, and it would live outside the repo where nothing records it.

⚠️ **The rename goes one way only.** The LOCAL file's slug is changed to match the
TARGET; never the reverse. Giving an existing lesson a **new** slug orphans every
completion that pointed at the old one — the state tables key on the slug, which
is exactly what makes the update direction safe.

⚠️ **And "a second one" does not mean "sold separately" in this app.** Measured
against the tree rather than assumed: `config/course.json` holds **one** `shape`,
**one** `planKeys` list and **one** `enabled`, and `courses_blocks` is flat — so a
second set of blocks is served by the same pages and gated by the same list, and
it is visible to exactly the **same** buyers as the first.

🚨 **`planKeys` being a list does NOT make this a second course.** It answers a
different question — *which products unlock THIS course* — and it exists because
one offering is one Digistore24 product per billing interval, so a single course
sold monthly and yearly names two keys. Selling a second course SEPARATELY would
need a course row above `courses_blocks`, its own list, and the module's gate to
pick one per block; no part of this is that, and the agent says so rather than
letting it be implied. A capability that is absent must not read like one that is
present.

When the target row's `origin` is not `content`, the update choice is not
available at all, and the report says so instead of offering it: renaming onto
that slug does not update the row — `content-apply` refuses the **whole** publish
before applying anything, with the same two ways out as the *would be refused*
list. And when that app is old enough not to send `origin`, the report says the
question was **not compared** rather than answering it — "I could not look" and
"the applier owns it" are different sentences.

**The matcher is deliberately dumb, and that is a decision to keep rather than an
approximation to improve.** Two titles are the same subject when they are the
same string modulo case and whitespace — no edit distance, no stemming, no
`includes()`. The failure modes are not symmetric: a **missed** pair costs a
question that was not asked, and the operator publishes a second block whose
deletion is one act; a **wrong** pair gets an operator to answer "update", renames
a slug onto the wrong row, and replaces the lessons customers were working
through. `includes()` alone would pair *"Grundlagen"* with *"Grundlagen für
Fortgeschrittene"* — a beginners' course and an advanced one — which is precisely
that case. Everything past the dumb rule is the agent's judgement, in the
conversation.

Whichever way it goes, **one line in `docs/app.md`** under the decisions: both
slugs, which way it went, and why. Three sessions later that line is the only
thing that says the alternative was considered.

Needs template 0.24.0.

## Which shape is this vendor's course?

Read the vendor's own words, top to bottom — the first row that matches wins:

| The vendor says | Shape | What decides it |
|---|---|---|
| "they buy it and work through it at their own pace" | **1 — Self-study course** | everything open at once; the order is shown, never enforced |
| "they must not get it all at once" | **2 — Week-by-week programme** | unlocking relative to the purchase date |
| "they hand something in and I read it" | **3 — Accompanied workshop** | a submission per learner, and a person at the other end |
| "it never ends" | **none of these** | see *When none of these fit*, at the end |

One tie-break, and it overrides the top-to-bottom order: **if they also hand
something in that a person reads, it is shape 3 — regardless of pacing.**
Shape 3 contains shape 2's unlocking, so "week by week AND they submit" is a
workshop, and reading it as shape 2 silently discards the half the vendor
cares most about.

The shapes share their foundations, so the shared parts are written once:
shape 3 unlocks exactly like shape 2 and says so, and every shape gates with
the same one call. A vendor reads one section; so should the agent building
for them.

**And before interviewing the vendor about content: does this app have a
knowledge corpus?** If `content/knowledge-sources/` exists, the vendor has
already told it most of what the interview would ask — plan the course from
it (see *Planning from a corpus*, at the end of this file).

## Where the rows come from — and how they reach PROD

Two questions come before the first table below, and each has its own page:

1. **Who authors the content?** [`content-authority.md`](content-authority.md).
   When the vendor writes every word themselves (the usual case), the blocks
   and units are **not tables at all** — they are constants in the repo, the
   schemas below become their types, and only the state tables
   (`unit_completions`, `submissions`) are created. Content in the repo
   travels with every deploy by itself.
2. **How does it reach an environment?** [`content.md`](content.md). Whatever
   the authority answer, this rule is absolute: **a row inserted into the
   local database and a video put into the local media store do not exist in
   PROD.** A course built as hand-inserted local rows dies with the local
   database — the app goes live with empty pages while every local gate stays
   green. Content that does live in tables is written as content files plus
   an idempotent applier (`scripts/content/appliers/` — upsert by slug, which
   is what "a slug survives a re-seed" is for), and the media are declared in
   `content/media-manifest.json`. **Two commands carry them**, and which one
   you reach for is decided by whether the database is on this machine:
   `node run.mjs content-apply` where it is, and
   `node run.mjs content-publish --env prod` where it is not — that one asks
   the running app over its setup surface, so it needs neither a production
   connection string nor a production bucket key. `node run.mjs content-check
   --env prod` is then what proves it arrived: every owner answers for its own
   rows ([`content.md`](content.md)).

Media are referenced **by path, never by row id** — `videoMediaId` is wired
per environment (an applier's `mediaIdFor("topic/file.mp4")`, or a lookup on
`media.storageKey` for constants), because a media row's id exists once, in
one database.

---

## Shape 1 — the self-study course

**What for.** A finished course — videos in blocks that build on each other,
worksheets to download — bought once and worked through at the learner's own
pace. The vendor's requirements, in their terms: *the order must be
recognisable* (guide, do not force), *you should see where you stopped*, *the
worksheets are part of it, not a second mail*, and access that does not run
out.

**The schema.** Two tables the agent creates per app (model for the file:
`db/schema-digistore.ts`; path: `docs/database.md`):

```ts
export const courseBlocks = pgTable("course_blocks", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  slug: text("slug").notNull().unique(),        // "geburtsbeginn" — see Subjects below
  title: text("title").notNull(),
  position: integer("position").notNull(),      // the visible order
});

export const courseUnits = pgTable(
  "course_units",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    blockId: text("block_id").notNull()
      .references(() => courseBlocks.id, { onDelete: "cascade" }),
    slug: text("slug").notNull().unique(),      // "wehen-atmung" — the unit's subject
    title: text("title").notNull(),
    position: integer("position").notNull(),
    // The video and the worksheet are media rows (docs/visuals.md). The
    // worksheet is visibility "entitled" + planKeys — the SAME list the course
    // itself is sold under, so buying the course IS buying the files, whichever
    // of its products you bought. Both
    // nullable: a unit may be text-only (put its text in `body`), and the
    // FK's `set null` keeps a deleted media row from leaving a dangling id.
    videoMediaId: text("video_media_id")
      .references(() => media.id, { onDelete: "set null" }),
    worksheetMediaId: text("worksheet_media_id")
      .references(() => media.id, { onDelete: "set null" }),
    // The video's subtitle sidecar (a `text/vtt` media row) — rendered as a
    // track that is OFF until the viewer switches it on; the production story
    // is docs/content-production.md → Subtitles. One column because a unit's
    // video is in one language (scripts are one-per-language); a video that
    // needs SEVERAL subtitle languages is the extension, as a child table
    // (unitSlug, srclang, mediaId), not more nullable columns here.
    subtitleMediaId: text("subtitle_media_id")
      .references(() => media.id, { onDelete: "set null" }),
    // A unit without a video still needs somewhere for its content.
    body: text("body"),
  },
  (t) => [index("course_units_block").on(t.blockId, t.position)],
);

// "You should see where you stopped" needs a source — this is it. One row
// per unit a member finished; progress is COUNT over it against the unit
// total, derived at read time, never stored as a number.
export const unitCompletions = pgTable(
  "unit_completions",
  {
    memberId: text("member_id").notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    unitSlug: text("unit_slug").notNull(),
    completedAt: timestamp("completed_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.unitSlug] })],
);
```

**The pages.** Two, under `/dashboard` — which `authorized()` in
`auth.config.ts` already protects (the layout adds `requireActiveUser()`).
A course area OUTSIDE `/dashboard` needs the three edits `CLAUDE.md` →
*Rules* names — do not build one without reading that first.

- `/dashboard/course` — the blocks in order, each with its units and the
  learner's progress, derived from `unit_completions` at read time. The model
  is the onboarding pair — pure rules in `lib/onboarding/rules.ts`
  (`progress()`, `nextStep()`), rendering with `role="progressbar"` in
  `components/onboarding-checklist.tsx`. **Copy the shape, not the
  component**: the shipped checklist is wired to onboarding copy and hides
  itself once everything is done — right for onboarding, wrong for a course
  overview.
- `/dashboard/course/[unit]` — the video (`components/ui/media-player.tsx`,
  with the unit's subtitle track passed via `tracks` when `subtitleMediaId`
  is set), the worksheet (`components/ui/media-download.tsx`), and what comes
  next. Dynamic pages are skipped by `node run.mjs smoke` — open one by hand
  with a real slug before calling it done.

**The access rule** — one gate for the whole course, quoted into
`docs/app.md` as code, never as prose:

```ts
if (!(await hasPlan(memberId, "course_complete"))) redirect("/plans");
```

No per-unit gate. This shape's defining property is that nothing stands
between the units.

**Ordering and unlocking.** **None — deliberately.** The order is the
`position` column and a visible sequence; the vendor wants to guide, not to
force. If the vendor says "they must not get it all at once", you are in
shape 2 — do not bolt a lock onto this one.

**The product.** One registry entry, `kind: "one_time"`
(`config/digistore-products.json`, skill `setup-digistore`). Access from a
one-off purchase has no `last_paid_day` event, so it does not expire on its
own — the grant simply has no end date. (A refund still ends it.)

🚨 **Do not write "lifetime" into the sales copy — write what is true: pay
once, no subscription.** Two reasons, and the second is the sharper one:

1. **The grant has no end date; that is not the same as a promise.** Nothing in
   the app ends it, but a refund does, and so does the vendor shutting the
   product down. A page that promised otherwise has made a claim the code never
   made.
2. **Digistore24 refuses the wording.** Its product criteria forbid promising
   members' areas "lebenslangen" access and name ten words to avoid —
   *lifetime, lebenslanger, unlimitierter, dauerhafter, unbegrenzter,
   unbefristeter, unbeschränkter, permanenter, auf unbestimmte Zeit, für
   immer* — while allowing access to be **limited to at most two years**. Their
   reason is the one that costs money: an offer that is gone after 24 months can
   oblige the vendor to refund the full price. ⚠️ These criteria bind whoever
   sells through the reseller **Digistore24 GmbH**; check your own contract
   before treating the two years as universal.

The same rule, on the page that has to keep it: [`docs/salespage.md`](salespage.md)
→ *The offer block*.

**Blueprint pointers.**

| Model | For |
|---|---|
| `db/schema-digistore.ts` | the shape of a schema file |
| `components/onboarding-checklist.tsx` | progress that is derived, not stored |
| `docs/visuals.md` → *Selling a file* | the worksheets behind the purchase |
| `docs/entitlements.md` | what `hasPlan()` answers, and what it does not |

**Interactive elements.** *Needs template 0.9.0 or newer — `node run.mjs
update` brings the text, not the code.* A game or a self-check per block —
recipes A and B in [`docs/learning.md`](learning.md), which also maps every
element back to its shape. The element's `subject` is the **unit's slug**
(`"wehen-atmung"`), the same string a `<CompanionPanel subject=…>` on that
unit would use.

**A lesson video is not limited by what a form can carry.** The browser writes
it straight to the bucket and the app checks what landed afterwards — the video
slot's ceiling is the per-kind one in `config/media.json` (2 GB as shipped),
not the 10 MB the other three slots have.
[`docs/visuals.md`](visuals.md) → *The ceiling, and the second way in* is the
whole mechanism, including the CORS rule the bucket needs before the first
upload works.

**What this shape cannot do.** A certificate with
evidentiary weight — a look back over the course is fine, a document that
claims to prove competence is a promise the vendor has to keep. ⚠️ It also feeds
the question at the top of this file: courts read a course's **whole
self-presentation** — "Lehrgang", "Akademie", "Absolventen", a certificate —
when deciding whether it is Fernunterricht
([`docs/compliance.md`](compliance.md) §6.5). A vendor who wants one is asking a
licensing question as well as a design one.

**Expose it to AI.** *Needs template 0.16.0 or newer.* This exact schema is
the worked example in [`docs/content-source.md`](content-source.md) — one
registry entry and the AI chat can search the lessons and deep-link
`/dashboard/course/<slug>#<anchor>`. Render the anchors from day one
(`lib/content-source/anchors.ts`); that doc walks through it.

---

## Shape 2 — the week-by-week programme

**What for.** A programme where the point *is* the pacing: the learner gets
week 1 now and week 9 in nine weeks, because getting it all at once defeats
the product. The vendor's requirements: *week by week, not negotiable*, *see
which week you are in and what comes next — but not what is in week ten*, and
*a late joiner starts at week one*.

**The schema.** One table; the learner's start date is **not** in it:

```ts
export const programWeeks = pgTable("program_weeks", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  slug: text("slug").notNull().unique(),        // "woche-7"
  title: text("title").notNull(),
  position: integer("position").notNull(),
  // Days after PURCHASE until this week opens: 0, 7, 14, …
  releaseAfterDays: integer("release_after_days").notNull(),
  videoMediaId: text("video_media_id"),
  subtitleMediaId: text("subtitle_media_id"),   // as in course_units above
});
```

The start date is the learner's grant — never a second table that could
disagree with it, and the entitlement layer answers it in one call:

```ts
import { planStartedAt } from "@/lib/entitlements/manage";

const startedAt = await planStartedAt(memberId, "course_complete");
// null = no ACTIVE grant for that key. Not "no such product" — an unknown
// key throws, exactly as hasPlan() does.
```

Do **not** reach for `listGrantsFor()` instead: that is the Operator's read,
it carries the operator's `note`, and the same file forbids it on member
surfaces.

> 🚨 **This used to say something else, and the something else was wrong.**
> The instruction here was to widen `ENTITLEMENT_COLUMNS` with the grant's
> `createdAt` and then take *"the earliest `grantedAt` among the grants
> `entitlementsFor()` returns"*. That reader is a `DISTINCT ON (product_key)`
> — it returns exactly **one** row per key, chosen by purchase-beats-comp and
> then furthest `accessUntil`, never by age. "The earliest among them" is
> vacuous over a single row, and the date it carries belongs to whichever
> grant won a contest about something else. A learner who bought, refunded and
> bought again had their clock started on the wrong grant, silently, and the
> only symptom was a week that opened on the wrong day. `planStartedAt()`
> aggregates `min(created_at)` over the active grants for that key instead.

**Which grant, when there are two:** the earliest of the *currently active*
ones, which is what the call above returns. A re-buy after a refund therefore
restarts the clock, deliberately; and for a purchase made without signing in
and claimed at first sign-in, the clock starts at the claim, not at the
payment — say both to the vendor once, in `docs/app.md`. A late joiner starts
at week one *by construction*, because their grant is younger.

**A paused grant reads `null`, and that is not week one.** A missed payment
suspends the grant, so it is not active and the clock has no start — say
"your access is paused" (`suspendedKeysFor()`, `pausedKeys()`), never
silently render the first week again.

**The unlocking rule — this IS the shape.** A week is visible when

```
now >= startedAt + releaseAfterDays
```

computed **on every read**, relative to the **purchase**, never to the
calendar. That is the same mechanism `grants.accessUntil` already uses — a
comparison against the clock at read time — and it means **unlocking needs no
cron job at all**. A scheduled job (`lib/cron/jobs.ts`, `docs/cron.md`) enters
only if the vendor wants a *message* sent when a week opens; getting this
wrong is how a simple product acquires a scheduler.

**Write the failure down before building:** a programme that renders week ten
early has failed at the thing it was bought for. The locked weeks show their
titles and their opening dates — never their content. Check it the way a
buyer would: sign in as a fresh member and try to reach week ten.

**The pages.** `/dashboard/programme` (every week: open, current, or locked
with its opening date) and `/dashboard/programme/[week]` (the open week's
content; a locked slug redirects to the overview — it does not 404, and it
does not render).

**The access rule.** The same single gate as shape 1, plus the week rule
above. Both quoted into `docs/app.md`. One case the plain gate gets wrong for
a subscription product: a **suspended** grant (a missed payment) makes
`hasPlan()` answer false, and the bare redirect sends a paying customer to
the purchase page. Ask `suspendedKeysFor()` first and say "your access is
paused" — `CLAUDE.md` → *Access* is emphatic about this. And when the
payment resumes, the clock never stopped: the missed weeks are simply open.
That is the honest default — name it to the vendor rather than letting them
discover it.

**The product.** `kind: "one_time"` is this shape's default too — a
programme ends, and a one-off price matches a product with an end. A
subscription only if the vendor insists, and then say what it means: a
cancellation's `last_paid_day` ends access mid-programme, locked weeks and
all.

**Blueprint pointers.**

| Model | For |
|---|---|
| `lib/cron/jobs.ts` | IF a weekly message is wanted — its header carries the four rules for a job |
| `docs/entitlements.md` | reading the grant the start date comes from |
| `CLAUDE.md` → *Access* | the compare-on-read pattern this rule copies |

**Interactive elements.** *Needs template 0.9.0 or newer.* A self-check
closing each week — recipe B in [`docs/learning.md`](learning.md); `subject`
= the week's slug (`"woche-7"`).

**What this shape cannot do.** Moving one learner's start date without an
operator action — there is nothing to edit but the grant. A fixed calendar
cohort ("we all start on March 1st") — that is a different product with
different tables, not a variant of this one. And a manual grant whose
`accessUntil` ends before the programme does: cap the opening dates the
overview shows at the grant's own end, or the page promises "week 10 opens
on 3 October" to somebody whose access ends in August.

---

## Shape 3 — the accompanied workshop

**What for.** A programme where the product is that **a person reads what the
participants hand in**. Weekly impulse, weekly task, a submission — and the
vendor reads it. Some vendors are explicit that no machine may touch their
participants' texts; that is a product requirement, not a budget constraint,
and this shape honours it by construction.

**The schema.** Weeks exactly as in shape 2, plus the submissions:

```ts
export const submissions = pgTable(
  "submissions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    // The participant. Every read of this table is scoped by memberId —
    // this is where an IDOR would live, and a submission is somebody's
    // unpublished writing.
    memberId: text("member_id").notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weekSlug: text("week_slug").notNull(),
    text: text("text").notNull(),
    submittedAt: timestamp("submitted_at").notNull().defaultNow(),
    // The vendor's reply, written by a person on the operator surface.
    reply: text("reply"),
    repliedAt: timestamp("replied_at"),
  },
  (t) => [
    uniqueIndex("submissions_member_week").on(t.memberId, t.weekSlug),
    index("submissions_member").on(t.memberId),
  ],
);
```

`cascade`, like `chat_messages`: this is the participant's own writing, and
it leaves with their account. **The unique index makes the submit an
upsert**, not an insert: resubmitting before the reply replaces the text and
updates `submittedAt`; once `repliedAt` is set, refuse with a sentence — the
reply answers a specific text, and silently swapping that text out from
under it breaks the one promise this shape makes.

It is personal data, and naming it in `docs/data-protection.md` is the
smaller half: **wire it into BOTH subject-access exports the day the table
exists** — `lib/privacy/export.ts` (the member's own download) and the
`data-export` command. Their parity test only fails when ONE of them grows a
table the other lacks; both missing `submissions` stays green, and an app
answers an Art. 15 request without the most personal content it holds.

**The submission is not an "interactive element", and keeping the two apart
is deliberate.** `activity_results.state` is a machine-written resume point;
this table holds **prose a person reads**. Nobody grades it, nothing is
metered, and the reply is typed by the vendor — all three are the product.
Do not "unify" them.

**The access rule.** The same gate and week rule as shape 2, in both
places: **the page, and the submit action** — a Server Action is an HTTP
endpoint of its own (`CLAUDE.md` → *Rules*). Before the upsert, the action
repeats `requireActiveUser()`, `hasPlan()`, the week-open rule, and checks
that `weekSlug` names an existing week — a client that POSTs `"woche-10"`
early, or after a refund, or with an invented slug, must be refused by the
action itself, not merely un-linked from the page.

**The pages.** The participant's week page carries the task, the submission
form, and — load-bearing — the **arrived** state: a participant who handed in
their first text ever must see that it reached a person
(`<Callout variant="success">`, and the reply rendered when it comes). The
vendor's reading surface is **shipped by the module** — see *The answering
surface* below rather than building a second one.

### The answering surface — the module ships it

**Do not build the list-and-reply pages by hand.** The `courses` module carries
them, and they are two routes under the operator's course area:

| Route | What it is |
|---|---|
| `/dashboard/admin/course/submissions` | the queue: what is waiting, oldest first, plus the twenty most recently answered |
| `/dashboard/admin/course/submissions/<id>` | one hand-in: the task, what the member wrote, and the box to write back in |

Reached from the course's setup page, and from nowhere else — it has no
navigation entry of its own, because it is the operator's work queue rather than
a section of the app. `requireOwner()` guards both pages **and** the reply
action independently; a `member` and a `moderator` are redirected to
`/dashboard` by each of them, and with the course switched off every one of the
three answers what a route that never existed answers.

**Rewriting a reply is allowed. Moving `replied_at` is not.** The freeze belongs
to the MEMBER: their text is what an answer refers to, and a text that changes
under its answer makes the answer a lie. Nothing refers to the reply, so
correcting a typo in front of a paying customer breaks nothing — and the surface
asks first, because there is no version history and there is not to be one (a
history of what a coach wrote ABOUT a member is a second body of member-adjacent
prose with its own retention question). `replied_at` and `replied_by` stay where
they landed, written through `coalesce` inside the one UPDATE, so two operators
answering at the same moment cannot overtake each other. An **empty** reply is
refused rather than treated as an undo — `replied_at` is the condition the
member's freeze hangs on, and nothing in this module can set it back to null.

🚨 **What it deliberately does NOT have, and adding any of it is not an
oversight to fix:**

- **no search over all hand-ins** — no search field, no filter argument;
- **no export of "all the replies"** — what a member wrote is in THEIR subject
  access request, and an operator-wide export would be a second body with its
  own retention and deletion question, and no occasion;
- **no member list for the course.** The queue lists HAND-INS, never people:
  somebody who has handed nothing in appears nowhere, and there is no route from
  a member to their course progress. **Who is working through which lesson is
  purchase information** — the same reasoning with which the community has no
  roster ([`compliance.md`](compliance.md) §1,
  [`data-protection.md`](data-protection.md) §14b);
- **no archive.** The answered list is capped at twenty rather than paged: a
  browsable body of somebody else's prose is the export above, wearing a
  different name.

`modules/courses/lib/no-roster.test.ts` reads the data layer as text and fails
on a reader that grows a `memberId` parameter — the writer's is exempt, because
storing the session's own account in the statement is a security control rather
than a lookup.

⚠️ **Two queries, not one, and the index is the reason.**
`courses_submissions_waiting` is an ordinary btree on
`(replied_at, submitted_at)`, and Postgres orders an ASC btree NULLS LAST. The
one query this surface suggests — `ORDER BY replied_at ASC NULLS FIRST,
submitted_at ASC` — asks for the opposite null order, which that index cannot
serve: the plan becomes a sort over the whole table and the index built for this
list goes unused. Waiting and answered are therefore two statements, joined in
JS, each an ordered index scan. Whoever "simplifies" them into one has removed
the index, not a query.

**Text a member typed is never rendered as markup.** Its renderer is
`modules/courses/components/member-text.tsx` — paragraphs and line breaks, and
deliberately not the community's post renderer, which also turns `http(s)` runs
into anchors: a clickable foreign link written by a member on the screen of the
one account that may do everything is a phishing surface.

**A lesson body is the OPERATOR's text, and it does get markdown** — a small
subset: `#` headings, `- ` bullet lists, `**bold**`, `*italic*` and markdown
links, whose target must be `http(s)`, `mailto:`, `tel:` or a path inside the
app — anything else keeps its text and loses its link. It goes
through the core's `lib/legal/markdown.ts` and `components/legal-body.tsx`, the
same pair the legal pages use, because both parse to DATA and never to a string
of markup — there is no `dangerouslySetInnerHTML` on either path and therefore
no sanitiser to keep current. Two writers reach that column and both are the
operator: the admin form behind `requireOwner()`, and a repo content file
applied with a `SETUP_KEY`. A third would re-open the question of whether links
belong here.

⚠️ **The two are not interchangeable, and the difference is who typed the
text.** Whoever adds a text surface to this module decides that first:
member-written prose gets `member-text.tsx`, operator-written prose gets the
markdown pair. Reaching for the wrong one is how a member's link ends up
clickable on an owner's screen.

Two scanners hold the line, and neither covers the other's ground:
`modules/courses/lib/render-safety.test.ts` fails the build on the raw-HTML
escape hatch anywhere in this module's three rendering directories, and
`modules/courses/pages/guard.test.ts` claim 3 additionally scans the two CORE
files by name — a scan of this module alone would keep saying "no markup here"
while the file actually rendering the lesson sat one import away and unread.

**The responding path is a person, first-class.** Build the human path at
full length: submissions listed, read, replied to, the reply reaching the
participant. An AI companion that drafts or answers
(`docs/ai-in-product.md` §2.1) is an *option some vendors want* — offer it
the way `build-app` Step 1c offers everything, as a menu item with its cost,
and take a "no" as recorded in `docs/app.md`. It is never the default of this
shape and never what the human path is a fallback from: for these vendors, a
text only a machine has read is a text nobody has read.

**Unlocking.** Exactly shape 2's rule — read it there. Everything about
`releaseAfterDays`, the grant as start date and the no-cron argument applies
unchanged.

**Blueprint pointers.**

| Model | For |
|---|---|
| `modules/courses/pages/submissions/` | the reading surface — **already built**; edit it, do not rebuild it |
| `lib/digistore/ipn.test.ts`, `buyUrl.test.ts` | the shape of the tests |
| `modules/courses/cron.ts` | the daily digest — **the module brings it**; it ships OFF, and the section below says how to switch it on |

**Interactive elements.** *Needs template 0.9.0 or newer.* At most an
optional self-check per week — recipe B in [`docs/learning.md`](learning.md),
whose recipe C draws the line this shape lives on: the check judges its own
questions, **never the submitted text**.

### The daily digest — and it ships off

The dot in the sidebar has one property: it is only there while the operator is
already in the app. So the module also brings a scheduled job,
`courses-digest` (`modules/courses/cron.ts`), which once a day counts what is
waiting and mails the operator the number. The full entry is in
[`docs/cron.md`](cron.md) → *`courses-digest`*.

**What the mail contains: a count and a link to the queue.** It names **nobody**
— no name, no address, no member id, no lesson title, not a word anybody handed
in, and not the date of any single hand-in. A mail is delivered to an inbox this
app does not control and read on whichever device holds it, and who is working
through which lesson is purchase information: a waiting list in a mail would be
the roster this module deliberately does not have, in the one channel no code
here can guard. `modules/courses/lib/cron-boundary.test.ts` holds that
mechanically.

**How to switch it on.** One entry in `config/cron.json` —
`"courses-digest": { "enabled": true, "everyMinutes": 720 }`. It ships disabled
because a job that mails must not start on its own, and leaving it out of that
file is *not* off (a job with no entry inherits enabled-and-daily). Twelve hours
for a once-a-day mail is deliberate: the send marker is keyed to the UTC day, so
a shorter interval means every day is attempted twice and none is skipped when
the run drifts across midnight — the second attempt reports `already notified
today` and mails nothing ([`docs/cron.md`](cron.md) → *`courses-digest`*). Two further
conditions are not this module's: mail delivery has to be configured
(`node run.mjs mail-setup`) and `config/notifications.json` has to allow operator
mail. Without either, the job still runs, still counts, and reports why it sent
nothing — a state you can read in `node run.mjs cron --list`.

**What this shape cannot do.** Notify the vendor of a new submission without
mail delivery configured (`node run.mjs mail-setup`) — and the notice is a daily
digest, never one mail per hand-in: a mail per hand-in is a timestamp per
hand-in, which is one step nearer to naming its author. Grade automatically —
by design, in this shape.

---

## When none of these fit

Some vendors will tell you, in so many words: *it should not look like a
course — it is not a course, it never ends, and that is exactly the value.*
Believe them. Three signals, any one of which means you are not building a
course:

- **No beginning and no end.** Nothing to work through, nothing to complete,
  no progress to show — a progress bar on a membership is a promise it will
  be over.
- **A library, not a sequence.** The member arrives with a question and needs
  to *find* the answer — search and topics, not `position` columns.
- **Cancellation must be easy and visible.** The product is a subscription
  relationship; hiding the exit destroys the trust it runs on.

That vendor gets the **Membership** archetype (`build-app` Step 1):
`hasPlan()` on a subscription product, self-service cancellation through the
`billing-modes` skill, and surfaces built around finding rather than
following. Applying a course shape to it is not a smaller mistake than
applying the membership shape to a course — it is the same mistake in the
other direction.

---

## Subjects — the one convention all shapes share

Every unit, week and block carries a **slug**: stable, `[a-z0-9-]`, chosen
once and never derived from a database id (a slug survives a re-seed; an id
does not). The slug is the `subject` everywhere the unit is referred to — the
route segment, an activity's result row, a companion's conversation. One
lesson, one string, and its coach and its game share coordinates without
either knowing the other exists.

Which is why the uniqueness the schemas enforce per table is not enough on
its own: **slugs are unique across every subject-bearing table in one app.**
`activity_results` and a companion's conversation key on the bare string, so
a `"woche-7"` that exists in two products merges two learners' states into
one. An app selling a second course prefixes per product
(`kurs-a-wehen-atmung`) — and extends shape 1's schema with a scoping column
and a second gate key, which is a deliberate step, not a copy of the first
course's tables.

**A lesson page can carry its own discussion, on the same idea.** The question
about the breathing exercises belongs under the breathing exercises, not in a
general room where nobody finds it again — so a unit's slug becomes a Subject
Key, and the page gets one declaration and one component. It is deliberately
cheap: nothing else is asked of the page, the discussion enforces its own access
level server-side on top of whatever gate the page already has, and it updates
itself while somebody is reading. The recipe, the two rules that keep a Subject
Key from becoming a door, and the transport are in
[`docs/community.md`](community.md) → ***3. Access is derived at read time, and
stored nowhere***. (It needs the community switched on; that is one line in
`config/community.json` and a deploy.)

---

## Over the API — the course, for a member's own program

A mobile companion reads the course through `/api/v1`
([`docs/api.md`](api.md)), on a per-member bearer key rather than a cookie: the
outline, one lesson, ticking a lesson off, handing work in.

Because the module contributes routes to that surface, it declares
`"requires": ["api"]` — **a course is installable only in an app that also has
the API module.**

Three properties are the whole design, and each is a failure prevented:

- **The outline carries structure and no content.** Block and lesson titles, the
  order, what has opened, what this member ticked off — and no lesson text, no
  media ids, not even the task prompt. One request that returned bodies would
  hand week ten to somebody in week one, past every check the lesson endpoint
  makes.
- 🚨 **The unlock rule is re-applied at every lesson door**, exactly as it is in
  every Server Action. The outline saying a block is shut tells a *separate* HTTP
  request nothing, and a rule enforced in one of two places is enforced nowhere.
  A locked lesson answers `403`; a member with no entitlement at all answers
  `404`, because they must not learn the course exists.
- **Media travel as IDS.** A lesson hands back `coverId`, `videoId`,
  `subtitleId`, `worksheetId`; the client fetches `/api/v1/media/{id}`, which
  asks `mayAccess()` for that viewer. A signed URL in the lesson's own answer
  would expire and would bypass that check — the failure `lib/media.ts` is
  written around.

**`rules.ts` already travelled**, and now it has a matching transport: this
module's `coreExport` copies the pure arithmetic into a companion repo
(`docs/mobile.md`), so the app and the companion compute the same unlock and
progress answers from the same code rather than from two implementations that
agree today.

**No authoring over the API.** Blocks, lessons, media slots and the operator's
reply queue have no endpoints and are not getting any: content is set up in the
web app, and a companion is a viewer and a participant.

---

## Planning from a corpus

An app whose vendor went through the knowledge intake already carries the
course's raw material: a corpus under `content/knowledge-sources/`, one folder
per topic, distilled notes inside ([`docs/knowledge.md`](knowledge.md)). When
it exists, plan from it instead of interviewing the vendor from zero — the
corpus is the interview, already answered. Four derivations, in order:

- **Subjects derive from topic slugs.** The corpus's topic slugs are the stem
  the subject slugs above are built from: topic `wehen-atmung` → unit slug
  `wehen-atmung`, or `kurs-a-wehen-atmung` when a second product forces the
  prefix. Never invent a second vocabulary beside the corpus's — one string
  flows from corpus through course to activities and companions, derived, not
  duplicated.
- **Structure is read from the topic folders.** Each topic folder is a module
  candidate, its notes are the lesson candidates — and the `[[wikilinks]]`
  between notes say what leans on what. Where the optional graph exists, ask
  it for teaching order: `graphify path "<basics>" "<goal>"` answers "what has
  to come before what" from the corpus's own links, which is exactly the
  `position` column's question.
- **Lesson media come from the corpus notes' `media:` references.** A note
  that carries `media: wehen-atmung/atemuebung.mp4` has already placed that
  file on one of the two delivery legs — which recording belongs to which
  lesson is recorded, not remembered, so wiring a lesson's video starts from
  that list rather than from a folder hunt. Mind the gate, though: knowledge
  media are open to **every signed-in member** by design, so a video that only
  buyers may see goes through the media store with `visibility: "entitled"`
  ([`docs/visuals.md`](visuals.md)) — the corpus note then points at the
  master file, not at the delivery.
- **A lesson companion names its subject's handbook pages.** The companion's
  instruction points at the handbook pages written for that topic — the same
  distillation the chat answers from, so the course and the chat cannot tell a
  learner two different stories.

And the fifth derivation is the one that is NOT in the corpus: **the media the
Gap List says are missing.** A topic with a note but no recording, a unit whose
`videoMediaId` has nothing to point at — that is production work, not planning
work, and it has its own reference and skill:
[`docs/content-production.md`](content-production.md) / `content-production`.
Offer it once the course skeleton stands, the same way `build-app` offers
everything — a menu and a wait, never a default. The same holds for a course
planned WITHOUT a corpus: units exist, media do not, and the honest next
sentence to the vendor is "the lessons are empty — shall we produce them?"
