---
name: content-production
description: Produces the media a course or page still lacks — lesson scripts, animated explainers (Remotion), talking-head video (a camera plus Descript, or HeyGen), a TTS voice track in de/en/fr/es (edge-tts free by default) and subtitles. Use this when the user says "create my course content", "I need videos for my lessons", "can you produce the videos?", "make an explainer video", "I want a talking-head video", "give the videos a voice", "add subtitles", "my lessons have no videos yet", or when a course exists whose units have no media. Material that ALREADY exists is `knowledge-intake`; delivering an existing file is `visuals`.
requires: 0.15.0
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Content production — make the media the course still lacks

A vendor whose course exists but whose lessons are empty does not have a
content problem, they have a production problem — and production is work an
agent can carry: write the scripts, set up the tools, render what can be
rendered, and hand over cleanly what needs a human in front of a camera.

**The reference is [`docs/content-production.md`](../../../docs/content-production.md).**
Read it before step 1; it holds the script format, the tool assessments with
their prices and licences, the recipes and the delivery road. This file is the
process that walks it, not a second copy of it.

**You run the commands and you write the scripts.** Through your Bash tool,
reporting what came back. The vendor brings the knowledge and the judgement;
you bring the format, the tools and the patience.

## Step 0 — Is production what they actually need?

Look before you ask:

- `content/knowledge-sources/` — is there a corpus? Then most raw material
  already exists: notes carry `media:` lines for recordings that are already
  placed, and the Gap List names what is missing. **Produce the gaps; never
  re-produce what a note already records.**
- `docs/app.md` — is there a course, and which shape? Which units exist, and
  which have an empty `videoMediaId`?
- `content/production/` — has this skill run before? `status:` lines say where
  it stopped.

Then route honestly:

- A pile of existing videos/ebooks that were never imported → **`knowledge-intake`**
  first; producing what exists is waste.
- No course planned yet → [`docs/courses.md`](../../../docs/courses.md) with
  `build-app`; scripts want units to belong to.
- The file exists and only needs to reach a buyer → **`visuals`** (check `sell`).
- Units without media, or a landing page without its video → this skill, step 1.

## Step 1 — The production plan

From the course structure (and the corpus, where one exists) list what is
missing, per unit, as a numbered menu — kind, rough effort, rough cost — and
**wait**:

```
Your course has 8 units. 5 have no video, none has a worksheet.

  1  wehen-atmung — explainer (~4 min)          render, no per-video cost
  2  geburtsbeginn — talking head (~3 min)      your camera, or ~$3 avatar
  3  …
  7  worksheets for all 8 units (PDF)           written + rendered here

  0  none of it — leave the course as it is

Give me numbers, or say "you choose" and I plan videos for the 5 empty
units plus the worksheets.
```

The chosen plan — including a `0` — goes into `docs/app.md` under *Decisions
worth remembering*, with the date. Do not negotiate a `0`.

## Step 2 — Write the scripts

One file per video, `content/production/<subject-slug>/`, in the format the
reference defines — frontmatter plus SAY / SHOW / TEXT scenes. The slugs are
the course's subject slugs, never a new vocabulary. Write SAY to be recorded
word for word, in the vendor's language and tone; where a corpus note covers
the topic, distill from it instead of inventing.

Read each script back in two sentences and get a real yes before
`status: approved` — the vendor's review is the step, not a courtesy. An
approved script is worth having even if production stops here: it is the one
artefact every later tool consumes.

## Step 3 — The toolset: recommend, then set up on request

Per kind, say the recommendation in two sentences — current price and licence
included, checked against the reference (its figures carry a date; verify
before quoting) — then ask, and **wait**:

> For the explainer videos I recommend **Remotion** — video rendered from
> code, free for you at your team size, no account needed. For their voice
> I recommend **edge-tts** — Microsoft's neural voices in German, English,
> French and Spanish, free, no account; one caveat said now rather than
> later: it uses an unofficial endpoint and can stop working without notice
> (paid fallbacks exist from ~$0.015/min). If you also want a talking head:
> your own camera with **Descript** to edit (free tier: 60 min/month), or a
> generated presenter via the **HeyGen API** (roughly $1 per rendered
> minute). Shall I set that up — or would you rather use other tools?

The voice menu in full — edge-tts, Piper offline, OpenAI TTS, ElevenLabs,
with prices, voices per language and the licence caveats — is the reference's
*Voiceover and audio*; quote from there, never from memory. HeyGen and
Descript bring their own voices, so a pure talking-head plan needs none of it.

- **Yes** → set it up: the Remotion scaffold in `content-studio/` (own
  `package.json`, base composition fed by the script, styled from the app's
  tokens — the recipe is in the reference), and for a service path ask for the
  API key and put it in `.env` plus a commented line in `.env.example`. Prove
  each tool with one small render before relying on it.
- **Yes to a voice** → check Python first (`python3 --version`; on Windows
  usually `python --version`), then install without root and without asking
  twice about what was already agreed: `pipx install edge-tts` or
  `uvx edge-tts` where those exist, else `pip install --user edge-tts` — and
  prove it with ONE short sample **in the vendor's own language**, played to
  them, before any batch. No Python, or a declined install → say what would
  enable it, record the decision in `docs/app.md`, and carry on — videos
  without a voice track are still videos.
- **Other tools** → their choice is as valid as the default; help set those up
  and record the choice in `docs/app.md`.
- **No tools** ("I record everything myself") → an answer; record it, and step
  4 becomes handover only.

**Remotion's licence question is asked ONCE**: free up to a 3-person for-profit
team, $25/seat/month from 4 — team size and answer into `docs/app.md`.
**Costs are said before they are spent**: a service render is billed on the
vendor's account at that service, so quote the figure and start with ONE video,
never the whole batch.

## Step 4 — Produce

Per script, the recipe from the reference:

- **Explainer** → generate the voice first where one was agreed: one audio
  file per scene from the SAY lines (edge-tts also writes the subtitle
  timings in the same call — `--write-subtitles`), scene lengths derived from
  the audio, `<Audio>` in the composition, ONE render that comes out with its
  sound. Build the `.vtt` from the per-scene timings (the recipe is the
  reference's *Subtitles* section). **With a voice on the track, SAY is heard,
  not shown** — it becomes the subtitle file, off until the viewer switches it
  on; only the short TEXT channel stays in the picture. Then watch the result
  yourself before showing it — length against `duration-target`, text legible,
  tokens not clashing in either theme, and the narration audible, in the right
  language, in sync.
- **Talking head, own camera** → hand over cleanly: the SAY lines as
  teleprompter text, what to check on the take (sound first, light second),
  and where to put the file (`.data/` staging, never the repo). If they use
  Descript, the script text is also the edit's spine.
- **Talking head, avatar** → build the payload from SAY, render ONE, show it,
  and only then batch the rest. A watermarked free-tier render is a preview —
  say so.
- **Worksheets / images** → write, render to PDF via `content-studio/`,
  generate or draw covers where the plan says so.

Report per item which path ran and what was skipped — a lesser path taken is
said out loud, never presented as the full one.

## Step 5 — Into the app

The delivery road is the reference's *Into the app* section: faststart
checked, then the manifest road from
[`docs/content.md`](../../../docs/content.md) — the file to
`content/media/<topic>/…` (≤ 10 MB) or `.data/content-media/…` (a lesson
video), one entry in `content/media-manifest.json` with
`visibility: "entitled"` + the course's own `planKeys` list, then
`node run.mjs content-apply` and, for staged files,
`node run.mjs content-media-sync --apply`. Units are wired **by path**, never
by a copied row id: `mediaIdFor("<topic>/<file>.mp4")` in an applier for
`videoMediaId` / `worksheetMediaId`. A subtitle `.vtt` goes in the same way
(`text/vtt`, same visibility and plan as its video) and is wired into
`subtitleMediaId`; the page passes it to `<MediaPlayer>` as `tracks` — its
address comes from `mediaUrlFor()` like every file, and for `text/vtt` that
is deliberately the app's own route (the reference says why a bucket URL in a
`<track>` fails silently). Then `node run.mjs smoke`, `node run.mjs errors`,
and one unit opened by hand — where a subtitle was wired, switch it ON in the
player's CC menu once: it must be off by default AND selectable, and no
automated check sees an empty CC menu.

**Say the environment sentence out loud once, because it is the failure that
stays silent:** everything this step filled is THIS machine's database and
store. PROD gets the rows and bytes at go-live — `content-media-sync --env
prod --apply`, `content-apply --env prod`, and `content-check --env prod` is what proves it arrived.**
green as the exit condition (go-live §5 carries the step). A course finished
locally and never applied to production goes live empty, with every local
gate green.

Close each script: `status: produced`, `produced-media:` filled. One entry in
`docs/app.md` for what was produced and with which tools.

Marketing videos take the same road to a different door — the sales page or a
channel, not behind `hasPlan()`; the script for those comes from
**`go-to-market`** and the hosting rules from `docs/visuals.md`.

## What comes next

- A course whose units now carry videos and asks nothing back →
  **`learning-activities`** (a check or game per block).
- Everything produced and wired → **`ux-gateway`** before launch; a video
  page has empty states and dark-mode traps like any other.

Offer to start the one that fits.
