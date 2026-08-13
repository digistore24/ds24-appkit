<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Content — how what this app ships reaches an environment

One sentence carries this whole page:

> **What is in the repo travels with every deploy. What is only on your
> machine — the local database, anything under `.data/` — does not exist in
> PROD until a command puts it there.**

This is the invariant behind a failure seen in the field: an agent builds a
course, the rows go into the local Postgres, the videos into the local media
store, every local gate is green — and the app goes live **empty**. Nothing
was wrong with the course. It just never left the machine, because rows and
stored files are not code: `git push` does not carry them, and no deploy hook
ever will.

So the rule that follows from it is a rule about **when**, not only about how:
**define content as repo files from day one, never only as rows in the local
database.** A course that exists as rows first and gets a transport later is one
where somebody has to reconstruct what the rows were supposed to be; a course
defined as files has a transport by construction. The migration hook creates the
TABLES on every deploy and fills none of them.

Each environment (DEV / STAGING / PROD — [`environments.md`](environments.md))
has its **own database and its own media store.** So for every piece of
content this app ships, there is exactly one question: *how does it reach the
environment that is about to serve it?* This page is the answer. Who AUTHORS
the content — you in code, or somebody else through an editing surface — is
the question one page over, [`content-authority.md`](content-authority.md),
and it comes first; this page is the transport under either answer.

## What travels by itself, and what does not

| | Travels with the deploy | Stays on your machine |
|---|---|---|
| Code, pages, constants (`content/course.ts` and friends) | ✓ | |
| Migrations (`drizzle/`) — the SCHEMA | ✓ | |
| `content/` files, `config/` files, `messages/` | ✓ | |
| Small media committed under `content/media/` | ✓ (bytes only — the row still comes from `content-apply`) | |
| **Rows** in the local database (courses, catalog entries, media rows) | | ✗ |
| The local seed (`node run.mjs db-seed`) | | ✗ — development-only, and it dies with the local database. It is not a loophole in any of this |
| Files in the local media store (`.data/media/`) | | ✗ |
| Large media staged in `.data/content-media/` | | ✗ |

Two commands close the right-hand column, a third does both of their jobs
without a production password, and a fourth proves any of them worked:

```bash
node run.mjs content-apply         # media rows + repo-leg bytes + appliers → one environment
node run.mjs content-media-sync    # staged bytes (.data/content-media/) → one environment's store
node run.mjs content-publish       # both of the above, through the running app
```

All three take `--env dev|staging|prod` (default: this machine's `APP_ENV`) —
the same axis as `ds24-sync`. **Nothing here runs by itself**: applying
content is a deliberate step, in DEV after you change content, and against
PROD as a named go-live step.

**The difference between the first two and the third is one line, and it is the
whole reason the third exists:**

| | needs | writes |
|---|---|---|
| `content-apply` + `content-media-sync` | `DATABASE_URL` + `MEDIA_S3_*` in your shell | directly |
| `content-publish` | `APP_URL_*` + `SETUP_KEY_*` in `.env` | through the running app |

They are siblings, not replacements. The shell pair works on any app; the third
needs that environment's setup surface switched on ([`setup-mcp.md`](setup-mcp.md)),
and that surface ships **off**. *The same act without the production password*
below is the long form.

What keeps that from being forgotten is `node run.mjs content-check`, and it is
the one check that sees what `smoke` cannot: **a course page over an empty table
is a clean 200.**

```bash
node run.mjs content-check --env prod    # green = every owner answered, nothing missing
```

⚠️ **It does not count anything itself, and that is the design.** The first
version did — it counted the appliers' rows from the core — and that was the
whole answer only while the core could see everything there was. The moment a
MODULE owned rows, it was answering a smaller question than its name while
showing a green tick. It was withdrawn rather than extended.

Now the question is asked of whoever owns the rows: the core answers for product
media and the appliers, and every module answers for its own by declaring
`presence` in its manifest ([`modules.md`](modules.md)). 🚨 **A module that
cannot answer is a failure, never a pass** — this command exists to catch an
environment that is empty, so "nothing to report" and "I could not look" must
never render the same.

It asks the ENVIRONMENT rather than a database, so `--env prod` needs no
production connection string in your shell. That the target's setup surface has
to be switched on ([`setup-mcp.md`](setup-mcp.md)) is not a new requirement:
checking a remote environment has always needed a door into it, and this is a
narrower door than the database.

**The same rule holds for the manifest, and it has three answers rather than
two.** A missing `content/media-manifest.json` is *reported*, not skipped: the
item is there with a sentence naming the file it looked for, it counts as a
legitimate state (`·`, exit 0) and it says `expected: null` — nothing here
declares a count. A manifest that IS there and names no file says `0 of 0`, a
different answer. And a manifest that cannot be read or understood — bad JSON,
or a top level that is not `{ "entries": [ … ] }` — is a **refusal**: the core
lands `unanswered` and the check is red. "I do not understand this file" is *"I
could not look"*, never *"there is nothing there"*.

The command also compares the two sides it can see, which no owner inside the
app can: **what THIS checkout declares against what that environment answered.**
Seven files here and no manifest there is one sentence carrying both numbers and
both sides, and a non-zero exit — a manifest that did not reach the environment
is precisely the question this command exists for. Two absences agree and say
nothing; an environment declaring *more* than this tree says nothing either,
because a checkout behind the deployed commit is somebody else's push.

### Product media is asked TWICE — the row, and then the bytes

A `media` row is not evidence that the file is there. `content-publish` writes
that row itself out of the `sha256` and `bytes` the manifest records, so an
apply against an empty bucket writes a perfectly good row over nothing at all —
and what that produces is a lesson whose media id resolves to an object that
does not exist. Measured: row present, bucket emptied, `content-check` answered
`✓ core product media: 1 of 1`, exit 0.

So each declared file is asked of both places that can answer:

| | |
|---|---|
| **is there a `media` row?** | one `select`, all paths at once — this is what the app serves FROM |
| **are the bytes there?** | one `head()` against this environment's store, per declared file **that has a row** |

A declared file with no row is already named, so no round-trip is spent on it.
The evidence line under the item says how many objects were really asked for —
`media store: 3 of 3 declared object(s) asked by HEAD, 3 present` — because a
tick with no number behind it is a claim rather than a measurement.

**The two failures are named apart**, since they are different repairs:

```
  ✗ core         product media: 0 of 1
      missing: kurs/cover.png (a media row, but no object in the store)
```

`(no media row)` is fixed by publishing; `(a media row, but no object in the
store)` means the bytes never landed or were deleted underneath the app, and
re-publishing is what puts them back (step B HEADs first, so nothing already
there is re-uploaded).

🚨 **And *the store did not answer* is a third state, neither of the other
two.** No store configured, wrong credentials, a bucket that is unreachable:
none of that is a statement about your content, and reporting it as a missing
object would turn every network hiccup into a false alarm about the product.
Such an item is marked `⏭`, never `✓`, it carries the reason, the closing line
counts it (`⏭ 1 thing(s) NOT checked`), and the verdict shrinks to *"nothing
missing among what was checked"* — **exit 0, because nothing was found wrong;
but nothing was proved either.** Read that line: a `⏭` over your product media
means the go-live question was not answered.

⚠️ **What this costs, and it is meant to.** One store round-trip per declared
file with a row, on every run of a command an operator runs before going live.
And an app whose bucket has lost an object goes from green to **red** — that is
the whole point, but it is a check that used to pass and now does not, and the
first reading of it is usually "the check broke". It did not: the object is
gone. Nothing else in this app looks. `content_media_confirm` measures a file at
the moment it ARRIVES over the staged leg (length and kind, then it removes what
is wrong); it cannot see anything that happened afterwards, and it never saw the
files the image carries at all.

And green still is not "it renders" — open a paid page and look.

## Media: one manifest, two legs, deterministic keys

Product media — lesson videos, worksheets, covers, subtitles — are declared
in **`content/media-manifest.json`**, one entry per file:

```json
{
  "entries": [
    { "path": "geburtsbeginn/wehen-atmung.mp4",
      "visibility": "entitled",
      "requiresPlan": "kurs_komplett" },
    { "path": "geburtsbeginn/cover.png",
      "visibility": "public",
      "alt": "A calm birth room, warm light" }
  ]
}
```

- **`path`** is `<topic-slug>/<file>.<ext>` — the grammar of
  `lib/content-media/rules.mjs` (lowercase, hyphens, extension from its
  allow-map). The bucket key is always `content/<path>` — **the same file
  lands at the same key in every environment.** That determinism is the whole
  trick: it is what lets code and appliers name a file by path and be right
  in DEV and in PROD, where upload keys
  (`<namespace>/<category>/<year>/<month>/<uuid>`) never can be, because a uuid
  row id exists once, in one database. The two key spaces cannot meet: `content`
  is a **reserved namespace**, so `storageKey()` refuses to build an upload key
  on this prefix rather than merely never happening to
  ([`visuals.md`](visuals.md) → *What the keys in your bucket look like*).
- **`visibility`** is `public` or `entitled` (+ `requiresPlan`, a Product Key
  from `config/digistore-products.json` — validated, because `hasPlan()`
  throws on an unknown key). `owner` does not apply: product media belong to
  the product, not to an account (`ownerId` stays null).
- **`alt`** is required for images — the same rule the upload endpoint
  enforces.

The **file** lives on one of two legs, the same split knowledge media use:

| Leg | Where | Travels how |
|---|---|---|
| shipped (≤ 10 MB) | `content/media/<path>` | with the repo; `content-apply` puts the bytes in the store |
| staged (large) | `.data/content-media/<path>` (gitignored) | `node run.mjs content-media-sync --apply` (bucket keys in your shell), or `node run.mjs content-publish --apply` (no bucket keys at all) |

`content-media-sync --apply` also records each staged file's `sha256` and
`bytes` back into the manifest (commit that change): the deployed server never
sees those files, and the recorded numbers are what lets a server-side
`content-apply` still assert an honest `media` row for them.

**Referencing a file from code** works by its deterministic key, not by a row
id. In a page or an applier:

```ts
const row = await db.query.media.findFirst({
  where: eq(media.storageKey, "content/geburtsbeginn/wehen-atmung.mp4"),
});
```

then `mayAccess()` → `mediaUrlFor(row)` exactly as
[`visuals.md`](visuals.md) says. (Where `content-authority.md` case 1 says
"the constant carries the media id", read: the constant carries the media
**path**, and the page resolves it this way — an id would be a different
value in every environment.)

## Rows: appliers — this app's own tables

The template cannot know your tables (`course_blocks` is yours, built from
[`courses.md`](courses.md)), so it runs a convention instead: any file under
**`scripts/content/appliers/*.mjs`** is executed by `content-apply`, inside a
transaction, and must export two functions:

**That folder ships with the app**, empty apart from its `_README.md` — so an
app that declares no content has an empty folder and `content-apply` says
*nothing to apply* and exits 0, while a folder that cannot be **read** stops the
run and names the absolute path it tried. Absent is therefore a defect (deleted
here, or not carried into a built output), never the ordinary state of a fresh
app.

**"Not carried into a built output" is the case an operator can hit without
deleting anything**, and it is covered: `content-check` runs the appliers inside
the app, so with `output: "standalone"` (off by default — [`DEPLOY.md`](DEPLOY.md))
the files have to be in the image. `next.config.ts` traces them for `/api/setup`,
and an installed module's own directory comes from its manifest rather than from
a list — the entry is there and says why.

```js
// scripts/content/appliers/course.mjs
import { COURSE } from "../../../content/course-data.mjs"; // your content file

export async function apply(sql, { mediaIdFor }) {
  let count = 0;
  for (const block of COURSE.blocks) {
    await sql`
      insert into course_blocks (id, slug, title, position)
      values (${crypto.randomUUID()}, ${block.slug}, ${block.title}, ${block.position})
      on conflict (slug) do update set
        title = excluded.title, position = excluded.position`;
    count += 1;
    for (const unit of block.units) {
      const blockId = (await sql`select id from course_blocks where slug = ${block.slug}`)[0].id;
      await sql`
        insert into course_units (id, block_id, slug, title, position, video_media_id, body)
        values (${crypto.randomUUID()}, ${blockId}, ${unit.slug}, ${unit.title},
                ${unit.position}, ${unit.video ? await mediaIdFor(unit.video) : null}, ${unit.body})
        on conflict (slug) do update set
          block_id = excluded.block_id, title = excluded.title,
          position = excluded.position, video_media_id = excluded.video_media_id,
          body = excluded.body`;
      count += 1;
    }
  }
  return count;
}

// Read-only: how many of this applier's rows exist? This is what
// `content-check` asks — the core's own presence contributor calls it, and an
// applier without it fails the whole core report by name.
export async function present(sql) {
  return (await sql`select count(*)::int as n from course_units`)[0].n;
}
```

### The third function is optional — `plan(sql)`

`apply()` writes and `present()` counts what is there. Neither can say what
**would** be created and changed, and that is the question somebody asks before
pointing a publish at production. So the convention has a third, **optional**
export:

```js
// Read-only. What a `content-apply` against THIS database would do.
export async function plan(sql) {
  return {
    created: 12,          // rows that are not there yet
    reasserted: 43,       // rows that are, and would be written over
    subjects: ["block-1", "lektion-1"],   // identifying slugs
    problems: [],         // what this applier already knows is wrong
  };
}
```

`created + reasserted` is the number of rows an `apply()` would write, and it is
worth keeping those two walks over the same list so the numbers cannot drift.

Four things to know:

- **It takes no helpers, and that is deliberate.** `apply()` gets `mediaIdFor`,
  which throws by name on a missing media row — so a planner holding it would
  fail on exactly the state a plan exists to describe. What the target's media
  store is still missing is answered once, for the whole app, by the media half
  of the report.
- 🚨 **Its absence is an ANSWER, not a defect.** An applier without one is
  reported as *"this applier does not say what it would change"*, with its
  label — never as `created: 0, changed: 0`. Zero and unknown are the two
  numbers an operator would act on differently. An applier written before this
  export existed still applies correctly; what it cannot do is say in advance
  what it would write.
- 🚨 **It runs inside a Postgres read-only transaction**, whose first statement
  is `set transaction read only`. An `insert`, `update` or `delete` inside a
  planner comes back as the database's own refusal, reported as that applier's
  problem — so "nothing was written" is a property of the transaction rather
  than a promise about the code. The transaction is then rolled back whichever
  way the planner ended.
- **Run `apply()` and roll it back instead?** No, and the reason is worth
  carrying: an applier is a plain `.mjs` and nothing constrains it to `sql` — it
  may `fetch()`, write a file or hold a lock for the length of a big upsert, and
  a rollback contains rows and nothing else. `apply()` also fails through
  `mediaIdFor()` for precisely the missing-media case the plan should be
  REPORTING. And under a rollback "read-only" becomes a word about the outcome
  rather than about the act.

**What asks for it: `content_publish`** in mode `plan`, over the setup surface
([`setup-mcp.md`](setup-mcp.md)) — so "what would publishing do to production"
is answerable without a production connection string in anybody's shell. The
worked example is `modules/courses/content/appliers/course.mjs`.

**And the same tool in mode `apply` asks for it again**, read-only and
immediately before it writes — which is what lets a re-run be *visible*. An
`apply()` returns one undivided count, so the first publish of five rows and the
second publish of the same five rows would otherwise be the same number. With a
planner, the first says *5 created* and the second *5 re-asserted*, and an
applier that has quietly started inserting instead of upserting shows up as a
`created` that never falls. An applier without one loses nothing but that: its
rows are counted, and the split is reported as **absent**, never as zero.

The rules that make this safe to run anywhere, any number of times:

- **Upsert by slug, never insert.** A slug survives a re-run and a re-seed
  ([`courses.md`](courses.md) → Subjects); `on conflict (slug) do update` is
  what makes every run *assert* the content instead of duplicating it.
- **Rows the content files define belong to the files** — every run re-writes
  them. Rows the files do not mention (a member's `unit_completions`,
  anything a customer created) are **never touched** — an applier updates
  what it names and deletes nothing.
- **An applier may own a PARTITION of a table rather than all of it.** One
  writer per row class (spine AD-82) is a rule about row CLASSES, so a table
  with a second lawful writer splits instead of picking a winner. Two shipped
  forms: `media`'s `content/` key prefix, and `courses`' `origin` column
  (`content` = the applier's, `operator` = the admin surface's). Whoever
  partitions writes the discriminator into `lib/content/writers.test.ts` **with
  an assertion beside it** — an entry there is a rule that gets checked, never
  an exemption. Two things a partitioned applier owes: it sets the
  discriminator explicitly on every row it writes, and it **refuses the run**
  when content claims a row from the other side. The `where` clause alone would
  make the collision silent — an upsert matching nothing still succeeds.
- **`mediaIdFor("topic/file.mp4")`** resolves a manifest path to that
  environment's `media.id` — it throws by name when the row is missing, which
  is how a typo fails the run instead of wiring a null.
- **A throw rolls the applier's transaction back whole** and fails the
  command loudly. Half-applied content is worse than none.
- **`present(sql)` is what `content-check` asks**, through the core's own
  presence contributor (`lib/content/applier-presence.ts`). An applier that
  does not export it makes the core's whole report *unanswered*, which is a
  failure rather than a pass. Zero rows while the applier exists is the red
  line — it is what a production database looks like when `content-apply` never
  ran against it.

### A MODULE can bring one

A module that brings the tables has to be able to bring the thing that fills
them, or its content reaches no environment but the one it was typed into. So
a manifest may declare a directory of its own:

```json
"appliers": "content/appliers"
```

and both commands find it. Three things to know:

- **The core's run first, then each installed module's, in install order.** An
  app's own tables are what a module's content may point at, never the other
  way round — a module cannot know about the app.
- **A module's applier is labelled with its id** (`courses:course.mjs`), so a
  run says which one it is talking about. The core's stays bare.
- 🚨 **A declared directory with no `.mjs` in it is REFUSED, not skipped.** A
  typo in the path would otherwise produce exactly the state this whole page is
  written against: `content-apply` finding nothing to run, and a later check
  calling that a clean pass, and the module still claiming its content reaches
  PROD. "I could not look" and "there is nothing there" are not the same
  answer.

Both commands ask **one** enumerator (`scripts/content/_appliers.mjs`) rather
than walking a directory each. They had a copy each, hard-coded to the core's
folder — which is why a module could make the claim above and have no way to
keep it, and why a file one command saw and the other did not would have been
an app reporting content as present after a run that never touched it.

When is an applier the right tool? Under [`content-authority.md`](content-authority.md):
**case 1** (you author in code) usually needs none — pages read your constants
directly, only the media manifest applies. **Case 2** (content tables + an
editing surface) needs one for the *initial fill* the agent produced locally;
after go-live, the editing surface writes into the live database and the
files' ownership ends where the operator's begins.

## Against PROD — the go-live step

**The route is `node run.mjs content-publish --env prod --apply`.** It needs
`APP_URL_PROD` and `SETUP_KEY_PROD` and nothing else — no production connection
string, no production bucket key — and it is the only one of the three that
carries the staged leg too. *The video that does not fit in the repo* below is
its long form; *The same act without the production password* is what it drives
underneath.

**The shell pair below is the fallback, and it is not deprecated.** Three
reasons it is still here, and they are the real ones: the setup surface ships
**off**, so an app that never switched it on has this route and no other; an app
that predates the surface has no other either; and the shell pair is what fills
an environment when the app there is not running yet. What it costs is the thing
the route above exists to avoid — a production connection string in a shell on
somebody's laptop.

Rows go into whatever database `DATABASE_URL` names; bytes go into the store
`--env` resolves. Against production that is the `user-create` procedure from
[`DEPLOY.md`](DEPLOY.md) plus the `MEDIA_S3_*_PROD` reference keys from
`.env.example`:

```bash
node run.mjs content-media-sync --env prod --apply     # staged bytes → prod bucket
DATABASE_URL="postgres://…prod…" node run.mjs content-apply --env prod
```

(The plain `MEDIA_S3_*` keys always mean *this machine's* environment and are
never edited to point elsewhere — the same contract as
`DIGISTORE_IPN_PASSPHRASE_PROD`.)

Two refusals are built in, and both exist because half a run is worse than
none: `--env prod` with no `MEDIA_S3_*_PROD` keys names every missing key
instead of falling back to the local store, and `--env prod` with a **local**
`DATABASE_URL` is refused outright — bytes in the prod bucket while the rows
land on your laptop is the reported bug rebuilt inside the fix.

Then open one real content page on the live app, with a real slug. **Whichever
route you took**, a green `content-check` proves the content is *there* and
nothing more; your eyes have to prove that it *renders* — and a 200 alone
proves neither.

### The same act without the production password

The two commands above put a production connection string in a shell on somebody's
laptop. There is a second way to run the same act, and it moves the connection
string out of the picture entirely: **`content_publish` in mode `apply`**, over
the setup surface ([`setup-mcp.md`](setup-mcp.md)). The repo stays on your
machine, the rows are in the environment, and the only thing that touches both
runs where the rows are.

It does the same three steps in the same order, on the app's own database handle
and the app's own media store:

| | | |
|---|---|---|
| **A** | the media rows the manifest declares, upserted on `storage_key` | without them `mediaIdFor()` throws by name and every applier that references a file fails |
| **B** | the files the image carries (`content/media/`) into that store | HEAD first: what is already there is skipped, which is what makes a re-run cheap |
| **C** | every applier, one transaction each, in enumeration order | the core's first — an app's own tables are what a module's content may point at |

Five properties, four of them inherited from the command above:

- **The whole run refuses rather than passing over anything — before it writes.**
  Every applier is enumerated, imported and checked for an `apply()` before the
  first transaction opens. The CLI above does it the other way round, and that is
  right *there*: it prints line by line to somebody watching a shell they control.
  A tool call is ONE act with ONE audit row, so a refusal found after the first
  applier committed is not a refusal — it is a partial run with an explanation.
- **A throw rolls that applier back whole** and the run carries on, exactly as
  here.
- **A long publish is bounded** — 25 seconds of wall clock, checked *between*
  appliers and never inside one (half an applier is what the per-applier
  transaction exists to prevent). A stopped run **names the appliers it never
  reached**; a retry is safe because every applier upserts.
  ⚠️ **That 25 is a bound, not a measurement**, and it is worth knowing which:
  nobody has yet timed how long Railway, Render, Fly or DigitalOcean actually
  let one request run. What they *document* (read 2026-08-12) is a third thing
  again — Railway closes a request after 5 min without data, Render allows
  100 min, **Fly and DigitalOcean document no value at all** for it; the only
  number under a minute anywhere is DigitalOcean's 30 s, and it stands in a
  **PHP** support article about `max_execution_time`. So nothing documented is
  below 25 s, and none of it has been measured against this app. The sources
  and the dates are on `PUBLISH_BUDGET_MS` in `lib/content/publish.ts`.
- **One append-only audit row**, and a *partial* publish says so in it rather
  than reporting the number it managed as a success.
- ⚠️ **The staged leg is not carried by the tool itself.** Files under
  `.data/content-media/` are on your machine and not in the image, so
  `content_publish` alone cannot place them — which is what the command in the
  next section is for.

### The video that does not fit in the repo — `node run.mjs content-publish`

A lesson recording is on the staged leg, so it is in no image and in no `git
push`, and the tool above cannot reach it. Getting it into production used to
mean `content-media-sync --env prod --apply`, which reads `MEDIA_S3_*_PROD` —
a production bucket credential, on a laptop. This command is the answer to that:

```bash
node run.mjs content-publish --env prod            # a dry run: what it would do
node run.mjs content-publish --env prod --apply
```

It needs **`APP_URL_PROD` and `SETUP_KEY_PROD`** and nothing else. No
`MEDIA_S3_*_PROD`, no `DATABASE_URL`.

**What travels where**, which is the point of the whole arrangement:

| | |
|---|---|
| the **bytes** | from your machine **straight to that environment's bucket**, at the deterministic key `content/<path>`, using a short-lived address the app minted |
| through the **app** | a manifest path, a length and the hash the manifest already records |
| through the **model** | nothing at all — this is a command your agent runs, not a tool it hands a file to |

**Four steps, and the order is load-bearing:**

1. **A pre-flight over the whole manifest.** Every declared file is checked
   against the two local legs *first*. One that is on neither refuses the run —
   before the first upload and before anything writes — naming **every** missing
   path rather than the first, and naming `node run.mjs content-media-sync` as
   where the staged leg is filled and where `sha256`/`bytes` get recorded. No
   tool could do this: the app cannot see your `.data/`.
2. **The uploads.** Per staged file: `content_media_url` mints an address (or
   answers *found*, and mints nothing, when the object is already there with the
   declared length), your machine PUTs the bytes to the bucket, and
   `content_media_confirm` reads back what landed and asserts the `media` row.
3. **`content_publish`** — plan, then with `--apply` its apply.
4. The sentence naming `node run.mjs content-check`, which is the exit condition.

🚨 **Steps 2 and 3 are in that order and not the other one.** An applier
resolves a lesson's video through `mediaIdFor(path)`, which throws BY NAME when
there is no `media` row — so uploads after appliers would fail every lesson
pointing at a staged file, and the throw that exists to catch a typo would be
catching the command instead.

**What the confirm step checks, and what it trusts.** It measures two things
against the object that actually landed: its **length** (`head()`, against the
number the manifest records — a disagreement is a refusal naming *both* numbers,
and the object is **removed**, because an object of the wrong length under a
deterministic key would be reported as present by `content-check` — that command
asks whether an object EXISTS, not whether it is the right one) and its
**kind** (the first sixteen bytes, sniffed — a `.png` renamed to `.mp4` is
refused on the same footing, and removed).

⚠️ **It does not verify the `sha256` of what landed, and nothing here says it
does.** That would mean reading the object back — the whole cost this path
exists to avoid. The recorded hash is your own claim about your own file,
computed on your machine by `content-media-sync`, and it is the same claim
`content-apply` already writes for exactly these entries.

Three more properties worth knowing:

- **Running it twice is the same as running it once.** A file already in the
  target's store with the declared length is reported as *found* and not
  uploaded again; the `media` row is still re-asserted, because rows the
  manifest defines belong to the manifest.
- **Nothing is retried silently.** A PUT that failed halfway leaves an object of
  the wrong length, and the confirm step removes it. The run stops, **names the
  files it never processed**, and does not run the appliers. The command is
  repeatable — you retry by running it again.
- **In DEV it usually cannot mint at all, and it says so by name.** The local
  media driver has no address anything but the app can reach, so
  `content_media_url` answers with the reason and the two ways on: fill this
  machine's own store with `content-media-sync`, or give the app an S3 driver
  ([`visuals.md`](visuals.md)). Never an empty answer that reads like "nothing
  to do" — and the audit row says the same thing, `refused` with the code
  `noUploadAddress`, rather than the `applied` it once read
  ([`setup-mcp.md`](setup-mcp.md) → *The record*).

**The shell path stays and is not deprecated.** The setup surface ships switched
off, and a surface that ships off cannot be the only way to fill an environment.
And the confirmation token that route asks for outside DEV proves the server was
consulted with this input at this moment — **not** that a human agreed, and not
that the plan you read a minute ago is still true.
