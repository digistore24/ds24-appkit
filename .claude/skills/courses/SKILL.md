---
name: courses
description: Builds this app's course — picks which of the three shapes the vendor is really selling, then the lessons, the environment that serves them and the switch-on. Use this when the user says "build my course", "my customers should work through lessons", "sell a course", "a protected area with my lessons in it", "a week-by-week programme", "I deliver my course by e-mail and it is too much work", "they hand something in and I read it", or when build-app's Content-Access archetype hands over. For the media a lesson still lacks use `content-production`; for a quiz inside a lesson, `learning-activities`.
requires: 0.24.0
---

# Build this app's course

The commonest thing sold through Digistore24, and "build me my course" names
three different applications. **[`docs/courses.md`](../../../docs/courses.md) is
the reference — read it, do not restate it here.** This skill is the order the
steps have to happen in, and step 5 is the one that gets skipped.

## 0. Is there already a course?

`node run.mjs module list` says whether `courses` is installed;
`config/course.json` says whether it is switched on — and only that; each
course's own shape is in `content/course/<course-slug>/course.json`.

If it is there, this is a CHANGE, not a build: read `docs/app.md`, ask what
should change, and stop.

## 1. Which shape?

`docs/courses.md` → *Which shape is this vendor's course?* Read the vendor's own
words, top to bottom, first row wins:

| They say | Shape |
|---|---|
| "they buy it and work through it at their own pace" | `self-study` |
| "they must not get it all at once" | `drip` |
| "they hand something in and I read it" | `workshop` |

**One tie-break, and it overrides the order:** if they also hand something in
that a person reads, it is `workshop` — regardless of pacing. Reading it as
`drip` silently discards the half the vendor cares most about.

"It never ends" is none of these — see *When none of these fit* in the doc, and
hand over to the Membership archetype.

→ one line in `docs/app.md`.

## 2. Install it

```bash
node run.mjs module add api        # the course serves endpoints on its surface
node run.mjs module add courses
node run.mjs db-migrate
```

**The first line is not optional and not a formality.** `courses` declares
`requires: ["api"]`, so adding it alone is refused by name and changes nothing.
Say the cost out loud, and say it accurately: what arrives is an empty
`api_keys` table and one more section in every member's data export. **Nothing
the customer's own customers can see** — the API stays **off** in
`config/api.json`, and the App-keys card needs that switch *and*
`"selfService"`, both of which ship `false`. A course does not need either; a
mobile companion needs the first ([`docs/api.md`](../../../docs/api.md)).

🚨 **`config/course.json` holds only the SWITCH.** `shape` and `planKeys` belong
to the course itself, in `content/course/<course-slug>/course.json` — an app
holds several courses now, and a shape that lives in the app's config could only
describe one of them. Writing either of them here is not a harmless extra: the
switch file's reader knows exactly two keys, so an unknown one makes the whole
module answer `brokenConfig`, and the day somebody sets `enabled: true` every
course page and every `/api/v1/courses` route answers 404 at once.
**Leave `enabled` at `false`.** It ships off on purpose — a course whose pages
answer before it has lessons is an empty product behind a clean 200. Step 6
switches it on.

## 3. What is it sold as?

One entry in `config/digistore-products.json`, `kind: "one_time"` for all three
shapes unless the vendor says otherwise. Then the skill `setup-digistore`.

Put those keys in the COURSE's own file — `content/course/<course-slug>/course.json`
→ `planKeys`, a **list**. (Not `config/course.json`: that one holds the switch and
nothing else. See step 2.)

🚨 **It is a list because one offering is one Digistore24 product per billing
interval.** A course a vendor sells "monthly or yearly" is TWO registry entries,
and holding either one opens the course — so both keys go in. Naming only one
leaves the other half of your buyers on a page that renders with nothing on it:
their own gate passes, and every medium resolves to `null`, which the page shows
as "there is none". A clean 200 over a course they paid for.

The same list gates the lesson media (`planKeys` on the manifest entry), so buying
the course is buying its files, whichever product you bought it under.

🚨 **Two sentences about the sale itself, and neither is a matter of taste.**
The page selling it **must not say how long access lasts** — a one-off grant has
no end date because no event ends it, which is not a term anybody may promise
(`docs/courses.md` → *Shape 1*). And a paid course whose learners are mostly not
in the room and whose **learning outcome is monitored** may be
**Fernunterricht** under § 1(1) FernUSG, which needs state authorisation before
the first sale — without it § 7(1) makes every contract void, in B2B too. ⚠️ The
monitoring element is carried by a right to ask questions about the material, so
**installing `community` is what usually trips it**, not the quiz. Say that it
exists, name what is on disk, hand it to `compliance-check`, and never answer it
yourself: [`docs/compliance.md`](../../../docs/compliance.md) §6.5.

⚠️ `hasPlan()` **throws** on a key the registry does not know, so a typo here is
a 500 on the course page rather than a locked-out member. `node run.mjs
courses-check` names every unknown key at once rather than the first.

## 4. Write the content

**Ask the corpus first.** If `content/knowledge-sources/` exists, the vendor has
already told this app most of what an interview would ask — plan the course from
it (`docs/courses.md` → *Planning from a corpus*).

**You author FILES, not tool calls.** A course is a FOLDER, and one file per
block inside it:

```
content/course/<course-slug>/course.json    the course: title, shape, planKeys
content/course/<course-slug>/01-block.json  a block, with its lessons
```

The **folder name is the course's slug** — do not repeat it inside
`course.json`, which refuses a `slug` key. An app may hold several courses; each
folder is one, sold on its own. ⚠️ Lesson and block slugs are unique across the
whole APP, so a second course prefixes them (`kurs-b-woche-1`).

That is the one writer for a course's rows, and `content-apply` carries them
into whichever environment is asked for. The module's `courses_outline` setup
tool reads a remote environment and never writes; a lesson typed in through a
tool would be overwritten by the next apply.



```json
{
  "slug": "geburtsbeginn",
  "title": "Wenn es losgeht",
  "position": 1,
  "releaseAfterDays": 0,
  "units": [
    { "slug": "wehen-atmung", "title": "Atmen unter der Wehe", "position": 1,
      "body": "…", "video": "geburtsbeginn/wehen-atmung.mp4" }
  ]
}
```

- **`slug` is the route AND the Subject Key** — the same string a
  `<CompanionPanel>` or an `<ActivityPanel>` on that lesson uses. Lower-case
  ASCII, digits, single hyphens. Unique across the whole app.
- **`body` is the lesson's text, and it takes a small markdown subset** —
  `#` headings, `- ` bullet lists, `**bold**`, `*italic*` and links. Write it
  that way: prose typed as one wall renders as one wall. (Needs template 0.27.0.
  Before that the characters appeared on screen verbatim.) A `body` may be
  omitted entirely — a lesson that is only a video is a lesson.
- **`releaseAfterDays`** is shape 2's whole mechanism: days after the learner's
  access started. `0` everywhere is a self-study course.
- **`taskPrompt`** on a unit makes it a hand-in — shape 3 only.
- **Media by PATH**, never by id, and every path also goes into
  `content/media-manifest.json`. A media id exists once, in one database.
  Files over the ceiling in `config/media.json` stage in `.data/content-media/`.

Lesson media that do not exist yet: the skill `content-production`.

## 5. Get it into the environment — the step that gets skipped

**First, look at what is there.** Against an environment that already holds a
course, run this before anything writes:

```bash
node run.mjs courses-diff --env prod   # new · would change · untouched · only there
```

It reads that environment first and compares it against this repo's content
files with the same fingerprint the environment computed, so "which lesson
differs" is answered without downloading the course. It writes nothing and exits
0 whatever it finds. Two things to say to the user when you show them the output:
**publishing deletes nothing** — a lesson that exists only over there stays
exactly where it is — and a slug the operator authored on the admin surface is in
its own list, *would be refused*, because `content-apply` refuses the whole run
rather than writing around such a row. Details:
[`docs/courses.md`](../../../docs/courses.md) → *Where the rows come from — and how they reach PROD*.

### 5a. "There is already a beginners' course" — stop and ask

When that output carries a **same subject, different slug** section, do not
publish. The same title sits under two different slugs, so a publish would
create yours **beside** the one already there. The order of acts:

1. **Stop and ask, once, before anything is published** — not afterwards, and
   not per lesson. Put both choices to the user with their consequences:

   | They choose | Say this |
   |---|---|
   | **update the existing one** | the lessons your customers currently see are replaced by the ones in your files. Their progress is keyed by **slug**, so it survives — somebody who finished lesson three has still finished lesson three |
   | **a second one** | the existing blocks are untouched and their buyers stay where they are. ⚠️ **And**: inside one course the new blocks are visible to the **same** buyers. Selling them to a different set means a **second course** — its own folder under `content/course/`, its own `course.json` with its own `planKeys`. Say which of the two it is, do not leave it implied |

2. **Apply the answer by editing a slug in `content/course/*.json`.** 🚨 That is
   the whole mechanism, and it is worth saying to the user in their words: *you
   answer this by changing a name in one of your files, never by giving a
   command an extra option.* The applier writes those rows keyed by slug, from
   files in this repo, and it stays the only thing that writes them. There is no
   flag, and asking for one is asking for a second writer.
   - **update** → set the LOCAL slug to the TARGET's slug.
   - **a second one** → leave the local slug alone (or make it clearly distinct).
   ⚠️ Never the other way round: giving an existing lesson a **new** slug orphans
   the completions that pointed at the old one.
3. **Re-run `node run.mjs courses-diff --env <target>` and show the result.** The
   renamed entry moves out of *new* into *would change* or *untouched* — that
   movement is the proof the decision took effect, and it costs one command.
4. Then publish, below. Afterwards, **one line in `docs/app.md`** under the
   decisions: both slugs, which way it went, and why.

⚠️ **When the target row's `origin` is not `content`**, the update choice is not
available and you say so before offering it: renaming onto that slug does not
update it — `content-apply` refuses the **whole** publish before applying
anything. Two ways out: change the slug in the content file, or delete the
operator-authored row on the admin surface. The command reads this off the
payload and prints it; it is not a guess.

**Matching slugs are not a question.** An exact slug match is the operator
already having said *"this one"* — publish, and let the diff's *would change*
list speak.

**Then publish. There are TWO cases and both are this step** — the one where you
have the database in front of you, and the one where you do not. A course that
only ever got the first half is live and empty.

**Locally**, where the database and the store are on this machine:

```bash
node run.mjs content-media-sync --apply
node run.mjs content-apply
node run.mjs courses-check      # does the course add up: slugs, media, the key
```

**Into an environment you are not sitting in** — staging, production. The
`courses-diff` at the top of this step is act one of THIS order, not a separate
ritual: read the target, ask if 5a applies, then publish, then check:

```bash
node run.mjs content-publish --env prod            # a dry run: what it would do
node run.mjs content-publish --env prod --apply    # staged bytes first, then the publish
node run.mjs content-check  --env prod             # green is the exit condition
```

Then open a paid page and look. **Green is not "it renders"** — `content-check`
counts rows and files; whether a lesson reads as a lesson is your eyes.

That middle command does two things in that order: it puts the staged bytes into
that environment's store over a short-lived address the app minted, and then
calls the app's own **`content_publish`** setup tool — plan first, then apply.

**What it needs is `APP_URL_PROD` and `SETUP_KEY_PROD` in the `.env`, and nothing
else** — no production connection string, no production bucket key. That key is
minted per environment, by an owner, on that environment's own
`/dashboard/admin/setup-keys`, is shown once, and lives in the `.env`, which git
does not track. The surface itself is
[`docs/setup-mcp.md`](../../../docs/setup-mcp.md) — read it, do not restate it
here. Say the reason in the operator's own words: **the setup surface is a far
narrower door than the database** — it publishes what this repo declares and it
cannot run a statement — and it is the same door `content-check --env prod` has
always knocked on.

Three more things to say when you run it:

- it **refuses before it writes anything** if a declared file is on neither local
  leg, and names *every* missing one — the fix is `content-media-sync`, which is
  what fills `.data/content-media/` and records each file's `sha256`/`bytes`;
- running it twice is the same as running it once;
- it needs that environment's setup surface switched on — the skill
  `setup-environments` is what switches it on. Locally it usually cannot mint an
  upload address at all, because the local media driver has none; that is what
  the local pair above is for.

🚨 **Rows do not travel with a deploy.** A course built locally and pushed goes
live EMPTY while every local gate stays green, because an empty page is a clean
200. `docs/content.md` opens on that failure.

## 6. Now switch it on

`config/course.json` → `"enabled": true`, then restart. There is no runtime
toggle, deliberately: the deploy is the change.

## 7. Look at it

`node run.mjs smoke` cannot open a `[unit]` route, so open one by hand.
**Shape 2 or 3: sign in as a FRESH member and try to reach the last block.** It
must not render. `docs/courses.md` calls a programme that shows week ten early
"failed at the thing it was bought for".

## 8. Design, and where the pages live

Offer the skill `design` once, as a menu item, with its cost (nothing per use,
about fifteen minutes). Take a no as recorded.

⚠️ **Say where the pages are**: `modules/courses/pages/`. They are the app's
product surface and the vendor's to change — that is expected, and what it costs
is that an edited module file stops receiving fixes, the same price their own
`app/` pages already pay.

## 9. Write it down, then go live

One entry in `docs/app.md`: the shape, the product key, "content authority:
module (database)", the access gate **quoted as code**, and the two clock facts
a shape 2/3 vendor has to be told —

- a re-buy after a refund restarts the clock, deliberately;
- a purchase made without signing in starts at the CLAIM, not at the payment.

At go-live, **the publish itself is step 5** — do that first, in the order it
gives. What belongs here is the proof that it arrived:

```bash
node run.mjs content-check --env prod             # green is the exit condition
```

⚠️ `content-check` asks the environment over its setup surface, so that surface
has to be switched on there (`docs/setup-mcp.md`) — it needs no production
connection string. And green is not "it renders": open a paid page and look.

## Hand over

`learning-activities` (a check inside a lesson) · `ai-companion` (a coach beside
it) · `community` (a discussion under each lesson, keyed by the unit's slug) ·
`salespage` · `go-live`.
