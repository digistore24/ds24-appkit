---
name: knowledge-intake
description: Turns a pile of existing material — videos, webinar recordings, ebooks, PDFs, YouTube links — into the app's knowledge corpus: rights-clean distilled notes, and a gap list of what is still missing. Use this when the user says "I have a course / an ebook / two years of webinars", "my material is sitting in files", "my stuff is in the folder next to the app", "can the assistant know my content?", "import my videos", "capture my knowledge first", "may I use somebody else's video or ebook?", or when the handbook is about to be written and the material is still in files. The handbook itself is `ai-chat-knowledge` — this skill produces what it is written from.
requires: 0.10.0
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Knowledge intake — from a pile of media to a corpus

Most vendors do not start from nothing: there is a course already taught, an
ebook already written, years of recorded webinars. That knowledge is dark — an
agent cannot read a video, and nobody retypes an ebook. This skill turns it
into the **corpus**: `content/knowledge-sources/`, one folder per topic, one
distilled note per source, committed with the app. Agents read it while
writing — the handbook, a course plan, a companion's instructions. The app
itself never reads it at runtime, and nothing you do here changes a single
answer by itself: answers change when handbook pages are written from it.

**What this skill is not:** it does not write the assistant's handbook — that
is **`ai-chat-knowledge`**, and the corpus is what that skill writes FROM. And
it does not plan a course — that is [`docs/courses.md`](../../../docs/courses.md),
whose *Planning from a corpus* section reads what this skill leaves behind.

Full reference — the note format, the two delivery legs, the graph, the
runtime boundary: **[`docs/knowledge.md`](../../../docs/knowledge.md)**. Read
it before step 1. It is the single copy of the rules; this skill is the
process that walks them.

**You run the commands and you write the notes.** Through your Bash tool,
reporting what came back — never "run this and tell me what it says". The user
brings the material and the judgement; you bring the format.

One honesty rule holds through every step: **wherever you take a lesser path —
no captions, no unzip tool, no Python — say which path you took and name what
would improve it. A skipped optional step is reported as skipped, never as
done.**

## Step 0 — Is a corpus what they actually want?

Look before you ask — most of the answer is on disk:

- `content/knowledge-sources/` — does a corpus already exist, and for which topics?
- `config/ai-chat.json` — is the assistant switched on yet?
- `docs/app.md` — is a course planned or built? Was the assistant decided on?

Then route:

- They want the **assistant answering customers' questions** and there is no
  pile of existing material → hand over to **`ai-chat-knowledge`** directly. A
  handbook can be written from an interview alone; a corpus is worth building
  when material already exists.
- They want **course structure** — modules, lessons, order → that is
  [`docs/courses.md`](../../../docs/courses.md). If material exists, this
  intake comes first: the doc's *Planning from a corpus* section plans from
  what you are about to build.
- A **corpus already exists** and new material arrived → skip to step 2, run
  the loop for the new sources only, then refresh the Gap List (step 7).

If it is genuinely the intake, take the inventory:

> "What material exists? Videos, webinar recordings, ebooks, PDFs, slide
> decks, old blog posts — roughly how much of each, and where does it live:
> files on disk, YouTube, a course platform?"

One theme at a time, summarised back. The inventory decides how the steps
below run — and if it contains videos without captions or transcripts, make
the graph offer (step 6) early, because its Whisper transcription is one of
the ladder's rungs.

## Step 1 — The Topic Map

Before any file is opened, name the territory:

> "If you drew your knowledge as five to ten topic areas — the chapters of the
> book you would write — what would they be called?"

Propose the map back as a numbered list ("you choose" is a valid answer — then
the proposal stands). Once agreed, turn each area into a **topic slug** and
create `content/knowledge-sources/<topic-slug>/`.

Slugs are lowercase `a–z 0–9 -`, hyphens only between runs — `wehen-atmung`,
never `Wehen & Atmung`. That grammar is deliberate: chosen once, the slug
becomes the media namespace below and, when a course gets built, the stem of
its subject slugs — one vocabulary flowing through corpus, courses and
companions, derived rather than duplicated.

The map is also the measuring stick: step 7's Gap List is this map compared
against the notes that exist.

## Step 2 — Per source: the Licence Gate first

Now the loop, source by source: **gate → get the text out → distill → place
the media.** The gate is asked ONCE per source, before anything is stored:

> "Is this your own content, licensed to you for distribution, or somebody
> else's?"

| Answer | What may happen |
|---|---|
| **own content** or **licensed** | verbatim material (a full transcript, chapter text) may be stored under `content/knowledge-sources/<topic>/_raw/`; the media file itself may be placed for delivery (step 5) |
| **third-party** | NO verbatim storage. The note is a distillation in the user's own words with the source cited in frontmatter (`licence: third-party-summarised`); the file is neither committed nor uploaded, and the note gets **no `media:` entry** — an undeliverable source stays unsuggested |

Why this early: the corpus is committed, and a repo is already distribution
the moment it is pushed to a host or shared with a collaborator. The rule
covers media files exactly as it covers text — a recording the user may not
deliver gets a note about what it teaches, never the bytes. When they are not
sure, write `licence: unknown` and treat it as third-party until they settle
it.

## Step 3 — Getting the text out

**PDF, Markdown, plain text:** read directly. Nothing to prepare.

**EPUB** is ZIP + XHTML — an unpack, not a tool dependency. Try in order and
report which rung worked:

1. `unzip book.epub -d book/` or `bsdtar -xf book.epub -C book/` where one of
   them exists.
2. On Windows 10 and later, `tar -xf book.epub` unpacks zip natively — Git
   Bash ships neither of the first two reliably, `tar` it does have.
3. None of that works → ask the user to export it once, naming the exact
   command: `ebook-convert book.epub book.txt` (Calibre).

**Video and audio — the Transcript Ladder.** Cheapest first, and it never
dead-ends:

1. **Existing captions.** YouTube captions are fetchable for most public and
   unlisted videos, and auto-captions are good enough — the note is a
   distillation, not a transcript deliverable, so caption quality is not the
   bar it sounds like.
2. **A transcript the user already has.** Webinar platforms often produce one.
   Vimeo enters the ladder here, not at rung 1 — it has no generally
   fetchable transcripts.
3. **Local Whisper transcription via the graph tool** — only where Python is
   there AND the step-6 offer was accepted (make the offer now if it has not
   been made — a video that needs transcribing is the natural moment). It
   costs wall-clock time, roughly real-time on CPU. **Say so before starting,
   never after:**

   > "Transcribing this 2-hour video locally will take about two hours — a
   > long lunch. Shall I start it, or would you rather talk me through the
   > video instead (it is often faster)?"

4. **Narration.** You interview the user through the content — "what do
   minutes 0–10 establish?" — and distill as you go. Always available, no
   tool at all. For the user's OWN videos this is often faster *and*
   better-distilled than a raw transcript, because they already know what
   matters: offer it as a real recommendation, not a consolation prize.

Whichever rung it was, say so in the summary and name the remedy for a higher
one — "no captions on this one; a transcript export from your webinar
platform would let me work from the full text next time".

## Step 4 — Distill: write the note whole

One note per source, into its topic folder, written in one piece —
frontmatter, body and links together:

```markdown
---
title: Breathing techniques webinar
topics: wehen-atmung
source-kind: video
source: webinar-2025-03-atmung.mp4
licence: own-content
status: distilled
ingested: 2026-08-03
media: wehen-atmung/atemuebung.mp4
---

The webinar establishes the 4-7-8 pattern before anything else …
Related: [[geburtsbeginn]].
```

Flat `key: value` only — no YAML lists, no nesting. The key table with every
allowed value is in [`docs/knowledge.md`](../../../docs/knowledge.md) → *The
corpus*; that table is the format's whole definition — no validator checks it,
the convention is the contract. `media:` appears only after step 5 placed a
file; leave it out for sources with nothing deliverable.

Three writing rules:

- **The body is the user's knowledge, distilled** — what the source teaches,
  in their own words, not a transcript dump. Verbatim material belongs in
  `_raw/`, and only for gate-passed sources.
- **`[[wikilinks]]` are written while distilling, never as a separate pass.**
  Where a note leans on another topic or note, link it inline — the links are
  the human navigation through the corpus, and where the graph runs they
  become its edges.
- **Read the note back** in two sentences: "this note now says X and links to
  Y — did I lose anything that matters?"

## Step 5 — Place the media that may be offered

For every gate-passed source whose file could itself be handed out, ask —
never assume:

> "Should the assistant be able to hand this file to a signed-in customer —
> the recording itself, not only what it teaches?"

If yes:

1. **Check the name against the standard before placing.** A media path is
   `<topic-slug>/<file>.<extension>` — exactly two segments, lowercase
   `a–z 0–9 -`, one extension dot, extension one of
   `mp4 webm mp3 ogg wav jpg jpeg png webp pdf`. Rename first:
   `Webinar Teil 1.MP4` becomes `webinar-teil-1.mp4`.
2. **Up to 10 MB** → `content/knowledge-media/<topic-slug>/<file>`, committed
   with the app.
3. **Larger** → stage it in `.data/knowledge-media/<topic-slug>/<file>`, then:

   ```bash
   node run.mjs kb-media-sync            # dry run — what would be copied
   node run.mjs kb-media-sync --apply    # copy what is missing
   ```

   Report what it says. It refuses names the grammar refuses, copies only
   what is missing (running it twice is the same as once) — and it reminds
   you about **faststart** whenever an `.mp4` moves. Take that seriously:
   without `ffmpeg -movflags +faststart` the player downloads the whole video
   before the first frame plays.
4. **Record the resulting path in the note's `media:` frontmatter.** That
   entry is where the handbook's file offers later come from — a file whose
   path no note records is a file nobody remembers to offer.

Both legs answer at the same session-gated URL, so moving a file between them
later changes no text. Once handbook pages carry the markers,
`node run.mjs kb-check` proves every reference before a release — that check
comes with the handbook, not with the intake.

## Step 6 — The graph — offer it, never require it

Check whether Python ≥ 3.10 is on the machine (`python3 --version`; on
Windows usually `python --version`). Then OFFER — never install unasked:

> "Optional: a knowledge graph over the corpus. It buys a coverage report
> (the best source for the gap list), structure queries, the teaching-order
> answer course planning wants, and local Whisper transcription for videos
> without captions. It costs: one Python tool installed on your machine, and
> an LLM pass over the corpus that runs on this session's own model — it
> takes a while and costs what the session costs. Skipping costs nothing —
> everything else here works without it. Want it?"

**Accepted** → the recipe is in [`docs/knowledge.md`](../../../docs/knowledge.md)
→ *The optional graph*: `uv tool install graphifyy` (or pipx — the PyPI
package is `graphifyy`, the CLI it installs is `graphify`), then
`graphify install --project` (the tool writes its own project skill — this
template deliberately ships none), then run it **over the corpus only**
(`content/knowledge-sources/`). Commit `graphify-out/`, and **exclude it from
your agent program's context loading** — `.claudeignore` in Claude Code, or
whatever ignore mechanism the program provides: a rebuilt graph must not
invalidate the session's prompt cache.

**Declined, or no Python** → report the step as skipped, name what would
enable it (Python ≥ 3.10), record the decision in `docs/app.md` under the
decisions — a rejected option nobody wrote down gets proposed again — and
carry on. The next step works either way; refusing costs capability nothing,
only convenience.

## Step 7 — The Gap List — on both paths

- **With the graph:** read `graphify-out/GRAPH_REPORT.md` — isolated nodes,
  thin clusters and dangling wikilinks are the gaps, already named.
- **Without it:** compare the step-1 Topic Map against the notes that exist —
  a topic folder with no notes, a topic many notes link to that nobody wrote.

Present the list. For each entry there are three honest answers: the user
records or writes something new (best — and where that is a video or worksheet
still to be made, the skill `content-production` carries the production, script
to finished file), you research it on the web (step 8's rules apply), or it
stays open — an open gap named is worth more than a thin note written to close
it.

## Step 8 — Web research is quarantined

For each gap the user wants filled by research: search, then write the note
as in step 4 — but quarantined:

- `source-kind: web`
- `status: needs-review`
- the source URLs in the `source:` frontmatter

The reason to say out loud: **nothing with `status: needs-review` ever
reaches the handbook** — handbook writing treats such a note as nonexistent.
That boundary is what lets the research be bold at intake time without
laundering unverified claims into customer-facing answers. You never flip the
status: the user reads the note, corrects it, and sets `status: distilled`
themselves — the flip IS their review.

## Done — and what keeps it alive

Commit the corpus: the topic folders and notes, `content/knowledge-media/`,
and `graphify-out/` where it was built. `.data/knowledge-media/` stays out —
it is gitignored staging. Then report honestly: the topics, notes written per
topic, which ladder rungs were taken and why, media placed per leg, what was
skipped, and the Gap List as it stands.

The corpus is a living asset, and one loop keeps it that way: **new source →
new note → refreshed Gap List → refreshed handbook pages.** Two
counter-signals from the reference are worth repeating: a ballooning handbook
is failure, not progress — compression is the job; and a rising note count is
not a health signal — the Gap List *closing* is the number that means
something.

Next: **`ai-chat-knowledge`** — the handbook the assistant answers from is
written FROM this corpus, and it is the reason the corpus exists. Offer to
start it now. Where step 0 said courses, the same notes feed
[`docs/courses.md`](../../../docs/courses.md) → *Planning from a corpus*
instead — offer that path there.
