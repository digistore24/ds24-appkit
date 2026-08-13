<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Content production — from course plan to finished media

A course app without its videos is a table of contents. This file is the
reference for producing the media a course (or a landing page) still lacks —
lesson videos, voiceovers, worksheets, images — and the skill that walks it is
**`content-production`** (`.claude/skills/content-production/SKILL.md`).

**The boundary, so nothing gets built twice.** Material that already exists —
recordings, ebooks, webinars — is the intake's job
([`docs/knowledge.md`](knowledge.md), skill `knowledge-intake`): it catalogues
what is there and records which recording belongs to which lesson. Planning the
course itself is [`docs/courses.md`](courses.md). Delivering a finished file to
a paying customer is [`docs/visuals.md`](visuals.md). **This file covers the one
gap between them: media that do not exist yet.** When a corpus exists, its Gap
List names exactly which media are missing — produce those, never re-produce
what a note's `media:` line already records.

And a boundary the whole template keeps: **nothing here is app code.** The app
never reads `content/production/` at runtime, and no production tool is ever
imported by a page. Production happens BESIDE the app; only the finished file
enters it, through the media store like any other file.

## The script is the standard

There is no cross-tool text format for video — OpenTimelineIO describes edits
without rendering them, and every render API speaks its own JSON. So the stable,
tool-neutral artefact is **your own script file**, and the tools are backends it
gets compiled into: a Remotion composition for an animated explainer, an avatar
API payload for a generated presenter, word-for-word teleprompter text for a
camera. Change the script, regenerate the video — the script is what lives in
git, diffs, and survives a tool switch.

One file per video, under `content/production/<subject-slug>/` — the
**subject slug** is the same string the course unit, the activity and the
companion use ([`docs/courses.md`](courses.md) → *Subjects*): one vocabulary,
derived, never duplicated. Frontmatter is flat `key: value`, like a corpus note:

```markdown
---
title: Breathing techniques — lesson video
subject: wehen-atmung
kind: explainer            # talking-head | explainer | mixed
duration-target: 4min
language: de
status: draft              # draft | approved | produced
produced-media: —          # media path once delivered, e.g. wehen-atmung/lektion.mp4
---

## Scene 1 — why breathing decides the first hour

SAY: Wenn die erste Wehe kommt, entscheidet nicht die Kraft, sondern der Atem.
     In den nächsten vier Minuten lernst du das 4-7-8-Muster …

SHOW: calm title card, then an animated counter 4 → 7 → 8 breathing rhythm.

TEXT: 4 · 7 · 8

## Scene 2 — the pattern, step by step

SAY: …
SHOW: …
TEXT: —
```

The three channels per scene are deliberate, because they go to different
places: **SAY** is spoken word, written to be recorded verbatim (the same rule
`go-to-market` gives marketing scripts); **SHOW** is the picture — a stage
direction for a camera, a scene description for an animation; **TEXT** is
on-screen text, kept short because it is read, not heard. `—` marks an empty
channel. A talking-head script may be all SAY; an explainer needs all three.

Two rules carry over from the corpus, because a script is the vendor's content
too: the words are the **vendor's own** (a script assembled from a third-party
source is the Licence Gate's problem — [`docs/knowledge.md`](knowledge.md)),
and `status` is honest — `approved` means the vendor read it, `produced` means
the file exists and `produced-media:` names it. Scripts are committed; rendered
videos are NOT — they are far too big for a repo and belong in the media store.

## The two kinds of video, and the tool decision

| The vendor wants | Kind | The engine |
|---|---|---|
| a person talking to the camera — themselves, or a generated presenter | **talking head** | a camera or an avatar service |
| concepts explained with motion — diagrams, steps, numbers, UI | **explainer** | a programmatic renderer |
| both in one video | **mixed** | produce separately, cut together |

The recommended toolset below is a default, not a rule: **the developer picks
the tools, and another choice is as valid as these.** What matters is that the
choice — including a "no tools, I record everything myself" — lands in
`docs/app.md` under the decisions, with the date. Prices and tiers below were
checked **2026-08-04** and rot like all prices; say the current figure out loud
before anything is spent, never quote this file as if it could not have aged.

### Explainer videos: Remotion (recommended)

[Remotion](https://remotion.dev) renders video from React/TypeScript — a video
is code plus props, which makes it the one path where "video as text" is
literally true: the agent writes the composition, `npx remotion render`
produces the file locally, no account and no upload anywhere. Regenerating a
corrected or translated variant is editing the script and rendering again.

- **Licence** (checked 2026-08-04): free for individuals and for-profit teams
  of **up to 3 people**, commercial output included — which covers most vendors
  on this template. From 4 people it is "Remotion for Creators", $25 per seat
  per month. **Ask the team size once**, record the answer in `docs/app.md`,
  and on 4+ say the price before the first render.
- **Alternatives:** [Revideo](https://github.com/midrender/revideo) is MIT and
  has no licence question at all, with a far smaller ecosystem. Manim suits
  genuinely mathematical content and little else. Service tools (invideo AI,
  Pictory, Fliki) turn a script into stock-footage slideshows in minutes —
  fast, generic-looking, watermarked on their free tiers.

**The scaffold** lives in `content-studio/` at the repo root — a sibling of the
app, never inside it:

- Its own `package.json`. The app's dependencies stay untouched; nothing under
  `app/`, `lib/` or `scripts/` ever imports from `content-studio/`.
- One base composition that takes a parsed script (the scenes above) as props,
  styled with the app's own tokens — read the accent from `app/globals.css` (or
  `docs/design.md`) so course videos look like the product they belong to.
- Committed like the scripts; `content-studio/node_modules` is ignored like any
  other.

### Talking-head videos: two honest paths

**Path A — the vendor's own face: a camera plus Descript.**
[Descript](https://descript.com) is a transcript-led editor: record, and edit
the video by editing its text — filler words, failed takes and silences removed
by its agent ("Underlord"), captions included. It produces nothing from
nothing; the input is always a recording, and the script's SAY lines are the
teleprompter text. Free tier (2026-08-04): 60 media minutes/month,
watermarked export; Creator around $24–35/month for 4K and the full agent. It
has grown an **API and an MCP server** (open beta) — a session may be able to
drive it directly; treat that as an option to try, not a step to promise.

**Path B — no filming: a generated presenter via HeyGen.**
[HeyGen](https://heygen.com) turns script text into an avatar video — stock
presenters or a clone of the vendor from a short self-recording — with strong
German lip-sync. Free tier (2026-08-04): 3 videos/month, max 1 minute,
watermarked — enough to judge the quality, not to ship a course. Creator
$29/month; the **API is priced separately** (roughly $0.80–1.00 per rendered
minute) and is the scriptable path: the agent builds the payload from the
script's SAY lines. Alternatives: D-ID (cheapest API entry, visibly weaker
lip-sync), Synthesia (excellent quality, API gated behind enterprise contracts
— out of reach for a solo vendor).

**Both paths are legitimate products.** A vendor whose face IS the brand
records; a vendor who will never sit in front of a camera generates. One
question settles it, and an avatar presenting as the vendor is something the
vendor decides, never a default.

### Voiceover and audio

An explainer needs a voice, and there are two: the vendor records the SAY lines
(a phone in a quiet room beats no video shipped), or a TTS tool generates them.
An explainer with neither is a silent film with captions — legitimate as a
deliberate style, but never as the accidental result of nobody deciding.
The menu below was researched and priced on **2026-08-04** and rots like every
price in this file; say the current figure out loud before anything is spent.
HeyGen and Descript bring their own voices, so the talking-head paths need none
of this. And one boundary stands whatever is picked: the app's own AI layer
(`docs/ai-providers.md`) has no TTS task, and none should be invented for
production tooling — production runs beside the app, not through `runTask()`.

**edge-tts — the recommended free path.** A Python command-line tool
([PyPI, v7.2.8 as of March 2026](https://pypi.org/project/edge-tts/)) that uses
Microsoft Edge's online neural voices: no account, no API key, no cost, and the
quality is real neural TTS in all four languages this template plans for. The
caveat is said to the vendor before it is relied on: **it speaks to an
unofficial endpoint — it works today and can break or change without notice.**
One call per scene produces the audio AND word-timed subtitles together:

```bash
edge-tts --voice de-DE-KatjaNeural \
  --text "Wenn die erste Wehe kommt, entscheidet nicht die Kraft, sondern der Atem." \
  --write-media scene-1.mp3 --write-subtitles scene-1.srt
```

Good starting voices, one female/male pair per language (the full list is
`edge-tts --list-voices`, several hundred entries):

| Language | Female | Male |
|---|---|---|
| German | `de-DE-KatjaNeural` | `de-DE-ConradNeural` |
| English | `en-US-JennyNeural` | `en-US-GuyNeural` |
| French | `fr-FR-DeniseNeural` | `fr-FR-HenriNeural` |
| Spanish | `es-ES-ElviraNeural` | `es-ES-AlvaroNeural` |

The `Multilingual` voices (for example `de-DE-SeraphinaMultilingualNeural`)
speak all of these languages with one voice — the right pick when a course
ships in several languages and should sound like one narrator. Installing needs
Python ≥ 3.10 and no root anywhere: `pipx install edge-tts` or `uvx edge-tts`
where those exist (they handle the PATH), otherwise `pip install --user
edge-tts` — all three hold on Linux, macOS and Windows Git Bash alike.

**Piper — the offline path.** `pip install piper-tts`; voices are free ONNX
downloads from [huggingface.co/rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices)
(`de_DE-thorsten-medium`, `en_US-lessac-medium`, `fr_FR-siwis-medium`,
`es_ES-davefx-medium`, and more per language). Everything runs on the vendor's
machine — no network after the model download, no endpoint that can vanish.
The honest quality line: audibly below the cloud-neural voices; right for
drafts, for machines that must stay offline, and wrong for a flagship course
narration. It emits no word timestamps, so subtitles derive from the script
instead (next section).

**OpenAI TTS — paid, on an official contract.** `gpt-4o-mini-tts` costs about
**$0.015 per minute of audio** ($0.60/1M input tokens + $12/1M audio tokens);
~13 voices, and each of them speaks all four languages. Needs `OPENAI_API_KEY`
— the *API keys for production services* section below applies, and note the
overlap deliberately: the app's AI layer may already hold this key, but a TTS
render is production tooling billed to the same account, not an app feature.

**ElevenLabs — paid, the quality ceiling.** The best perceived voices of the
four, Multilingual v2/v3 at **$0.10 per 1,000 characters** via API. **The $5
per month Starter tier (≈30 minutes) is the minimum with a commercial licence —
the free tier is NOT licensed for monetized content**, and a course behind a
paywall is exactly that. `ELEVENLABS_API_KEY`, same key pattern as above.

**Pacing — the mistake that sounds like quality.** Whichever tool speaks, the
narration runs at normal speed: `--rate=+0%`, and it stays there. Slowing the
voice down "so people can follow" is the mistake that sounds right on a single
test line and turns a whole course sluggish — whoever wants slower delivery
writes shorter sentences, never a negative rate. Padding is a budget, not a
feeling: about 0.2 s before the voice and 0.3 s after it per scene — and the
TTS output brings head- and tail-silence of its own, which is trimmed (ffmpeg
`silenceremove`, around −40 dB) *before* any padding is added, otherwise the
two stack. A minimum scene duration (~5 s) keeps short panels readable without
stretching all the others. The check is arithmetic, not taste: gross words per
minute over the finished runtime, and the share of the runtime that is silence.
**≥ ~130 wpm gross and ≤ ~15 % silence is narration.** Measured on 2026-08-04
in a real production: −25 % rate plus ~1 s of padding per panel came out at
114 wpm gross with 24 % silence and felt sluggish in every video; the re-render
at normal rate with 0.2 s/0.3 s padding cut the runtime by 26 % and brought the
silence to ~15 % — with the voice, the pictures and the levels unchanged.

**Production is code.** The render script and the parameters it ran with —
voice, rate, padding, resolution — are committed like every other tool, in the
same commit as the media they produced. A production that exists only as
finished MP4s is a reconstruction job at the first correction: the sluggish
videos above had to have their slides recovered frame by frame from the shipped
files, because the source panels lived in a lost volume and the parameters
lived nowhere but in somebody's session. Source assets belong in the repo, or
must be reproducible from committed ones — never only in a Docker volume or a
local folder.

**Rendering the voice INTO the video.** With Remotion the audio track is part
of the composition, not an editing step afterwards: put the per-scene files
into `content-studio/public/`, mount each with `<Audio>` from
`@remotion/media` via `staticFile()`, and derive every scene's
`durationInFrames` from its audio file's measured length
(`getAudioDurationInSeconds`) — the pacing then follows the narration by
construction instead of by eye. One `npx remotion render` produces the MP4
**with** its sound; Remotion v4 bundles its own ffmpeg, so nothing has to be
installed for the mux (checked 2026-08-04).

### Subtitles — text becomes a track, off by default

The moment a video carries a voice track, the script's channels change meaning.
**SAY is spoken now — so it must not also be burned into the picture.** It
becomes a subtitle track instead: a WebVTT sidecar the viewer can switch on in
the player's own CC menu, and that stays OFF until they do. **TEXT keeps its
job** — the short on-screen emphasis (`4 · 7 · 8`) is a designed part of the
picture, not a transcript, and stays rendered into the video exactly as before.
A video without any audio track keeps working the old way; this section only
applies where a voice exists.

Getting the cues:

- **edge-tts writes them** — `--write-subtitles scene-1.srt` per scene, with
  real word timings. Scenes are rendered one file each, so shift every scene's
  cues by that scene's start offset before joining them, then convert the
  result to VTT (an SRT-to-VTT conversion is a header line and comma-to-dot
  timestamps — a dozen lines of script, no tool needed).
- **Tools without timestamps** (Piper, a recorded voiceover): one cue per SAY
  line, spread across its scene's measured audio duration. Coarser than word
  timing and entirely serviceable for narration.

Delivery — this is the one place where a subtitle is NOT "just another file":

1. The `.vtt` goes into the media store as `text/vtt` (it lives under the
   `file` kind, `config/media.json`), with the same `visibility: "entitled"`
   and the same `planKeys` as its video — the transcript of a paid lesson is
   paid content.
2. **Its address comes from `mediaUrlFor()` like every other file — and for
   `text/vtt` that answer is deliberately the app's own route, never a bucket
   URL.** A `<track>` fetch is CORS-restricted, unlike the video's `src`, and
   cannot follow a redirect to a foreign host; a bucket address in a track
   fails *silently* — the video plays, the CC menu stays empty, nothing logs.
   The app streams these few kilobytes itself (`lib/media/deliver.ts`).
3. The course page hands it to the player as a track:
   `<MediaPlayer … tracks={[{ src, srclang: "de", label: "Deutsch" }]} />`
   (`components/ui/media-player.tsx`). The component never renders a `default`
   attribute — that IS the off-by-default contract. The unit's schema column
   is `subtitleMediaId` ([`docs/courses.md`](courses.md)).
4. The label ("Deutsch", "English") is data like a product name, not an i18n
   message — it names the track's own language and does not translate.

One asymmetry to keep straight: the script's `language:` is a **production**
property. A course produced in de/en/fr/es does not add French or Spanish to
the app's `LOCALES` (`i18n/config.ts`) — the app UI's languages and the
languages of the media it delivers are independent decisions.

### Worksheets, images, covers

The short list, because the machinery exists:

- **Worksheets** are written as Markdown/HTML and printed to PDF — a print
  stylesheet in `content-studio/` is enough; no PDF library enters the app.
  Delivery to buyers is `docs/visuals.md` → *Selling a file*.
- **Images** — lesson covers, diagrams for scenes: the app can already generate
  pictures (`docs/ai-providers.md` → *Pictures*, billed per image), or the
  session produces SVG/PNG assets directly into `content-studio/assets/`.
  Remember: no SVG ever enters the media store (`docs/visuals.md`).

## API keys for production services

A service path (HeyGen, D-ID, a TTS) needs a key. It goes into `.env` — set
with the same care as every other secret, never into code or a script file —
plus a commented line in `.env.example` naming it as **production tooling the
app never reads** (for example `HEYGEN_API_KEY`). That comment is load-bearing:
`node run.mjs doctor` and the env guard know nothing about these keys, and the
next session should learn what they are from the file, not from guessing. Costs
sit on the vendor's account at that service — there is no meter in the app, so
say what a render costs before starting a batch, and start with ONE video, not
with all twelve.

## Into the app

A produced file follows the same road as any other media
([`docs/visuals.md`](visuals.md)); the production-specific steps are:

1. **Check the file before it moves.** Length roughly matches
   `duration-target`, and an `.mp4` has faststart — without
   `ffmpeg -movflags +faststart` the player downloads the whole video before
   the first frame (the same rule `kb-media-sync` enforces for knowledge
   media). Remotion's default output is fine; camera exports often are not.
2. **Declare it, then apply it** — produced media are PRODUCT content, and
   product content travels the manifest road ([`docs/content.md`](content.md)),
   never a hand upload into whatever store this machine points at: the file
   goes to `content/media/<topic>/<file>` (≤ 10 MB) or `.data/content-media/…`
   (larger — a lesson video is this leg), one entry in
   `content/media-manifest.json` with `visibility: "entitled"` plus the
   course's own `planKeys` — buying the course IS buying the videos, whichever
   of its products you bought it under. The subtitle `.vtt` travels the same
   way, with the same visibility and the same list as its video. Then `node run.mjs content-apply` (row + shipped bytes) and, for
   staged files, `node run.mjs content-media-sync --apply`. **This fills the
   environment you are in — PROD gets the same content at go-live via
   `--env prod`. ⚠️ Nothing proves it arrived — open the page and look.**
3. **Wire the unit** — by the file's PATH, resolved per environment, never by
   a copied row id (an id exists in one database only): in an applier,
   `videoMediaId` comes from `mediaIdFor("<topic>/<file>.mp4")` (worksheets:
   `worksheetMediaId`, subtitles: `subtitleMediaId`); constants-in-code apps
   look the row up on `media.storageKey` instead ([`docs/content.md`](content.md)).
   Then `node run.mjs smoke` and `node run.mjs errors`, and open one unit by
   hand — dynamic pages are skipped by `smoke`. Where a subtitle track was
   wired, switch it ON in the player's CC menu once: an empty CC menu on a
   page that should have one is the silent failure named under *Subtitles*
   above, and no automated check sees it.
4. **Close the loop in the script**: `status: produced`,
   `produced-media: <topic>/<file>.mp4`. A script that says `produced` while
   the unit shows nothing is the drift this line exists to catch.

A **marketing** video (the `go-to-market` script) ends elsewhere — on the
sales page or a social channel, not behind `hasPlan()`. Same production road,
different destination; hosting it on the app's own pages is the media store
with `visibility: "public"` (`docs/visuals.md` → *How a file reaches a
visitor*), and an embed from a video host needs the consent gate described
there.

## What this cannot do

Named here so nobody discovers it at the last step:

- **No service works without its account and the network** — and free tiers
  watermark. A watermarked video is a preview, not a lesson; say so before a
  vendor ships one.
- **Quality is the vendor's judgement.** A render that plays is not a lesson
  that teaches; the vendor watches every video before `status: produced`, and
  that review is a step, not a courtesy.
- **A long recording does not travel through the app, and does not have to.**
  The browser writes it straight to the bucket and the app reads back what
  landed; the ceiling is then the per-kind one in `config/media.json` (2 GB for
  video as shipped) rather than what a request body carries. It needs a CORS
  rule on the bucket before the first upload works —
  [`docs/visuals.md`](visuals.md) → *The ceiling, and the second way in* has it
  as copyable JSON, and `node run.mjs media-check` says whether the bucket
  answers your app's address.
- **An avatar of a real person needs that person's yes.** Cloning the vendor
  is their own decision to make at the service, under that service's terms;
  cloning anybody else is off the table.
