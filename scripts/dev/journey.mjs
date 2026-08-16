// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The project's path — the thirty steps, once, as DATA.
//
// A customer's project moves through a path: an idea, an app, a checkout, the
// four gates, a host, and then the operating round that never ends. Every step
// has a skill behind it, most of them leave a trace on disk, and a handful are
// only ever offered when there is a REASON for them.
//
// That path was written down in FOUR places — the bullet list and the arrow
// chain in `CLAUDE.md`, the table in `README.md`, the greeting's own sentence in
// `scripts/dev/session-start.mjs`, and a twenty-two-row look-first table that
// stood in `.claude/skills/coach/SKILL.md`. Four tellings of one list is a list
// that is wrong in three of them, and nothing anywhere could compare them: prose
// cannot be held against prose.
//
// Past tense on the fourth of them, deliberately: coach's table is GONE. What
// took its place is `coach/references/where-am-i.md`, which runs
// `node run.mjs journey --json` and then covers only the four shapes of judgement
// no predicate can read — a file that exists and is thin, a value that is present
// and still the shipped one, a date against another date, a fork that needs one
// question. That is the intended end state of this file: the derived tellings
// shrink to what they alone can say.
//
// 🚨 **The bug that motivated this file, and it is the small kind that proves
// the point.** `session-start.mjs` printed the path as a single arrow chain and
// the chain OMITTED `operate` — so the phase that begins the day the app goes
// live and does not end was missing from the one line every session reads,
// while `CLAUDE.md`, the README and coach all had it. No gate could see that:
// every one of the four files was internally consistent, well written and
// green. What was missing was a machine-readable ORIGINAL for them to be
// derived from. That chain is now DELETED rather than corrected — the greeting
// imports this file, so the class of fault is gone and not just the instance.
//
// So this file is that original, and nothing else. It is:
//
//   · **data, not prose** — `trace` is an object rather than a callback, which
//     is what lets one row be rendered into a table AND evaluated by a command.
//     A predicate written as a function can be run; it cannot be printed.
//   · **a `.mjs` and not a `.json`** — JSON holds no comments, and half of what
//     is worth knowing about these thirty rows is WHY a particular file proves a
//     particular step done. This repo argues its decisions in place.
//   · **split at one seam** — `journeyFacts()` does every disk read there is,
//     `journeyState()` is pure. Same seam as `./operations.mjs`, for the same
//     reason: the pure half can be tested against hand-built fixtures, so the
//     state machine is measured rather than described.
//
// Three things derive from it, and nothing restates it:
//
//   · `node run.mjs journey` — the human view, `--json`, and `--next`
//     (`./journey-render.mjs` formats, `./journey-cli.mjs` prints)
//   · the session greeting's `[Journey: …]` line, which REPLACED the arrow chain
//     above rather than becoming a fifth copy of it — `./session-start.mjs` now
//     holds no list of steps that anybody CAN forget to update
//   · `coach`, which reads the `--json` shape instead of walking the disk itself
//
// The data was proven complete before any of them was written, and the order was
// deliberate. `scripts/docs-coverage.test.ts` is where that proof lives — every
// skill folder appears here exactly once, every `requires` mirrors the skill's
// own frontmatter, every module id resolves to a manifest that names the skill
// back, and the one row with no skill at all is named there by hand.
//
// Plain Node, no dependency, ESM — Linux, macOS and Git Bash on Windows
// (CLAUDE.md → Three systems).
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readEnvValue } from "../lib/env-write.mjs";
import { blankComments } from "../lib/source-text.mjs";
import { installedModules } from "../modules/installed.mjs";
import { versionAtLeast } from "./update-plan.mjs";

// Resolved from THIS file, never from the cwd — the mistake
// `scripts/ds24/_approval.mjs` records. Anything that reads the journey runs
// from wherever the agent happened to open the project.
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const DAY = 24 * 60 * 60 * 1000;

/**
 * The phases, in order, with the numbers the user sees.
 *
 * `voraussetzung` and `daneben` carry no number on purpose: one comes before the
 * path and the other runs alongside all of it, and numbering either would make
 * the path read as six steps instead of four.
 *
 * ⚠️ **The English titles are the ones that get PRINTED.** Terminal output of
 * the scripts here is deliberately untranslated (CLAUDE.md → Languages: the
 * greeting and `run.mjs` output are English whatever the app's language is), so
 * `en` is what a command renders and `de` is for prose a human writes — a
 * `docs/` page, a report, a sentence in a skill.
 */
export const PHASES = [
  {
    id: "voraussetzung",
    num: null,
    title: { de: "Voraussetzung", en: "Prerequisite" },
    blurb: {
      de: "Läuft die Maschine? Nur nötig, wenn etwas fehlt.",
      en: "Does the machine work? Only needed when something is missing.",
    },
  },
  {
    id: "planen",
    num: 1,
    title: { de: "Planen", en: "Plan" },
    blurb: {
      de: "Was wird verkauft, an wen, und wie sieht es aus.",
      en: "What is being sold, to whom, and what it looks like.",
    },
  },
  {
    id: "bauen",
    num: 2,
    title: { de: "Bauen", en: "Build" },
    blurb: {
      de: "Die App selbst, die Kasse, und die vier Tore davor.",
      en: "The app itself, the checkout, and the four gates in front of it.",
    },
  },
  {
    id: "live",
    num: 3,
    title: { de: "Live gehen", en: "Go live" },
    blurb: {
      de: "Ein Server, eine Domain, ein echter Testkauf.",
      en: "A server, a domain, one real test purchase.",
    },
  },
  {
    id: "betrieb",
    num: 4,
    title: { de: "Betrieb", en: "Run it" },
    blurb: {
      de: "Die Phase, die mit dem Livegang beginnt und nicht endet.",
      en: "The phase that begins the day it is live and does not end.",
    },
  },
  {
    id: "daneben",
    num: null,
    title: { de: "Daneben", en: "Alongside" },
    blurb: {
      de: "Gilt neben allem anderen — nie erledigt, nie offen.",
      en: "Applies alongside everything else — never done, never open.",
    },
  },
];

/**
 * The states a row can be in. Written out because the ORDER below is the whole
 * of this file's logic, and it is easier to argue against a list than against a
 * chain of `if`s.
 *
 * · `done`                  the trace says so
 * · `stale`                 a recurring row whose report is past its window
 * · `declined`              a recorded "no" — an ANSWER, not an absence
 * · `blocked`               the row needs a module this app does not have
 * · `needs-newer-template`  the row's code is not in this copy at all
 * · `unknown`               nothing recorded anywhere — a `kind: "ask"` row, or a
 *                           `kind: "note"` row whose notebook holds no such line
 * · `open`                  none of the above
 */
export const JOURNEY_STATES = [
  "done",
  "stale",
  "declined",
  "blocked",
  "needs-newer-template",
  "unknown",
  "open",
];

// ── The trace vocabulary ────────────────────────────────────────────────────
//
// A trace is the predicate that proves a step done, expressed as DATA. The
// vocabulary is closed — ten kinds, and an eleventh is a decision somebody makes
// here rather than an object somebody invents at a call site:
//
//   { kind: "file",   path }                    the file exists
//   { kind: "report", prefix, maxAgeDays? }     docs/reports/<prefix>-YYYY-MM-DD.md
//   { kind: "env",    keys, notValue? }         every key set in the .env
//   { kind: "json",   path, pointer, notValue? } a dotted pointer into a config
//   { kind: "dir",    path, beyond, deep? }     entries beyond the shipped ones
//   { kind: "routes", paths }                   every one of these routes exists
//   { kind: "module", id }                      that module is installed
//   { kind: "placeholder", path|paths, markers } the shipped markers are GONE
//   { kind: "note",   path, label }             a filled-in `<label>` line in the notebook
//   { kind: "ask",    why }                     nothing on disk answers this
//
// 🚨 **`note` is the tenth, and it was added because two rows had no way to tell
// a recorded YES from a recorded NO.** `visuals` and `user-onboarding` are decided
// in prose — an `Output artifact:` line and an `Activation:` line in
// `docs/app.md` — and both were `ask` rows whose `declined` marker was *the string
// the positive answer is written with*. So an app that had answered read
// `declined | you said no`. The four vacuous predicates below said "done" where
// nothing had happened; these two contradicted what the user had decided, which is
// worse, and in the one output built to be trusted.
//
// It is a kind rather than a modifier on `file` because it asks a different
// question and answers a different ladder: `file` reads EXISTENCE off
// `facts.exists`, `note` reads a LINE off `facts.text` and has an `unknown` in it.
// Two ladders under one kind is worse than a tenth kind. And `label` rather than
// `marker` on purpose: `declined.marker` and `placeholder.markers` mean *is this
// string here*, where a `label` is the name of a slot and the ANSWER is what
// follows it — so presence alone is never enough (`noteValue()`).
//
// **`notValue` is the one extension, and it belongs to the two kinds that read a
// VALUE rather than an existence** (`env` and `json`). It means: the value must
// be there AND must not contain this string, case-insensitively. Both of its
// uses are the same shape of question — a value that ships filled in with a
// placeholder, where "present" proves nothing. `APP_URL` ships as a `localhost`
// address, `config/ai-models.json` ships every binding as `"auto"`, and
// `config/digistore-products.json` ships `billingMode: "both"`.
//
// 🚨 **`beyond` is not optional on a `dir` row — it is the whole predicate**, and
// an empty `beyond` is a CLAIM: *this folder does not exist in a fresh app.* Two
// rows made that claim about folders the template ships (`content/` with three
// folders in it, `app/dashboard/` with four) and therefore read `done` on an
// untouched clone. A row that says "done" where nobody did anything is a lie the
// user reads in the journey output, and this file's whole purpose is that they
// can trust it. So: list what SHIPS, always, and leave `beyond: []` only where
// the folder itself is created by the step (`content/knowledge-sources/`).
//
// **`deep: true` walks the folder and counts FILES rather than immediate
// subfolders.** One row needs it and the reason is the shape of what it asks
// about: the assistant's handbook lands as files INSIDE the four shipped section
// folders (`content/knowledge/00-onboarding/…`), so an immediate-subfolder count
// can never see it. It is a modifier on an existing kind rather than a tenth
// kind, because the question — *is there anything here beyond what shipped* — is
// the same one.
//
// 🚨 **`ask` is the honest escape hatch and it has to stay countable.** A step
// that genuinely leaves nothing on disk says so, with the reason written out —
// `setup-machine` is the clean example, because the answer really is computed
// live (the greeting's `[Setup: …]` line) and no file could hold it. The moment
// `ask` becomes the easy answer it is the default, and a path where every row
// answers "I do not know" is a path nobody can be routed along.
// `scripts/docs-coverage.test.ts` caps it at six, and the direction to move that
// number is DOWN: `go-to-market` was the ninth and is now a `file` row, because
// the skill writes `docs/go-to-market.md` at the end of its run; `visuals` and
// `user-onboarding` were the seventh and eighth and became `note` rows, because
// the line they were asking about was in `docs/app.md` all along. (`visuals`
// still is one. `user-onboarding` moved on to `placeholder` once `build-app`
// began writing that line itself — see its row.)
//
// **One row is settled by a LATER row instead of by a trace of its own —
// `impliedBy`, and there is exactly one.** It is not a tenth kind and it is not
// an escape from "every row needs its own trace"; the argument for the single
// use is on step 3.1, and a test asserts that it stays single.

/**
 * The rows, in path order.
 *
 * One row per folder under `.claude/skills/` — exactly one, in both directions,
 * and a test says so by name rather than by count. **Plus exactly one row that
 * names no skill at all**: phase 1's own deliverable, `docs/plan.md`. See its
 * comment for why it has to exist and why `skill` may be `null` only there;
 * `scripts/docs-coverage.test.ts` names that one permitted exception rather than
 * skipping nulls, so a typo cannot become a silent hole.
 *
 * `startedBy` is the field that goes with a null `skill`: a row still has to say
 * WHO performs it, or `next` names a step nobody can start. Read it through
 * `performerOf()` and never by reaching for `skill` directly.
 *
 * `requires` is **mirrored** from each skill's own frontmatter and is never
 * decided here: a skill that needs code this copy does not carry is refused by
 * `node run.mjs update` on exactly that value, and two opinions about it would
 * eventually disagree. Nine of the thirty have no `requires:` at all.
 *
 * `handsTo` is the arrow chain — the DEFAULT next skill, not the only one. It is
 * what the four prose tellings drew with `→`, and having it as a field is what
 * makes "the chain skips a step" a thing a test can notice.
 *
 * `impliedBy` names a row whose being `done` answers THIS row as well. Exactly
 * one row carries it (3.1), the argument is written on that row, and
 * `settleImplied()` is the one pass that reads it — a field with one use is a
 * decision, a field with five is a loophole.
 */
export const JOURNEY = [
  // ── Prerequisite ──────────────────────────────────────────────────────────
  {
    skill: "setup-machine",
    phase: "voraussetzung",
    step: null,
    title: { de: "Maschine vorbereiten", en: "Get the machine ready" },
    what: "Installs what is missing — Node, git — and prepares the project.",
    // Offered when something is MISSING, never because it has not been run. On a
    // machine that already works it is noise, and the greeting says which case
    // this is before anybody has to ask.
    optional: true,
    recurring: false,
    requires: "0.20.0",
    module: null,
    // The greeting's `[Setup: …]` line is the answer, and it is computed live by
    // `doctor` rather than written down — so there is no file to look at, and
    // pretending otherwise would be worse than saying "ask".
    trace: { kind: "ask", why: "the greeting's [Setup: …] line answers this, not a file" },
    declined: null,
    alsoFrom: [],
    handsTo: "build-app",
  },

  // ── 1. Plan ───────────────────────────────────────────────────────────────
  {
    skill: "market-research",
    phase: "planen",
    step: "1.1",
    title: { de: "Idee schärfen", en: "Sharpen the idea" },
    what: "Interviews the operator and researches the market, then writes the product brief.",
    optional: true,
    recurring: false,
    requires: null,
    module: null,
    // The minimal brief `build-app` step 0 writes counts as well — presence
    // answers this row, with or without the research labels (coach §1).
    trace: { kind: "file", path: "docs/product-brief.md" },
    declined: null,
    alsoFrom: [],
    handsTo: "design",
  },
  {
    skill: "design",
    phase: "planen",
    step: "1.2",
    title: { de: "Aussehen wählen", en: "Choose the look" },
    what: "Turns the four dials once — accent, radius, type, elevation — and writes the choice into docs/design.md.",
    optional: true,
    recurring: false,
    requires: "0.25.0",
    module: null,
    trace: { kind: "file", path: "docs/design.md" },
    declined: { file: "docs/app.md", marker: "No custom identity" },
    alsoFrom: [],
    handsTo: "build-app",
  },
  {
    skill: "knowledge-intake",
    phase: "planen",
    step: "1.3",
    title: { de: "Material sichten", en: "Take stock of the material" },
    what: "Distills existing videos, ebooks and recordings into the corpus the handbook is written from.",
    optional: true,
    recurring: false,
    requires: "0.10.0",
    module: null,
    // The corpus folder is created by the intake itself and is absent in a fresh
    // app — so its presence, not its size, is the signal. How GOOD the corpus is
    // is `node run.mjs kb-check`'s question and no file predicate can answer it.
    trace: { kind: "dir", path: "content/knowledge-sources", beyond: [] },
    declined: null,
    // Reachable while building (the material turns up later) and while running
    // it (a second year of webinars).
    alsoFrom: ["bauen", "betrieb"],
    handsTo: "ai-chat-knowledge",
  },
  {
    // 🚨 **Phase 1's deliverable, and the only row that names no skill.**
    //
    // Without it phase 1 held nothing binding: all three rows above are
    // `optional: true`, so `currentPhase` — "the earliest phase with a
    // non-optional row not done" — answered `bauen` on a fresh clone, and the
    // whole planning phase was invisible to the one user it exists for. The
    // definition is right; the DATA was incomplete.
    //
    // No skill owns it because two write it: `build-app` step 1f, or
    // `market-research` phase 5 when the research ran first. Inventing a
    // thirty-first skill folder to own a file two existing skills already write
    // would be a folder nobody opens. So `skill` is `null` and `startedBy` says
    // who to start — the honest split, and `performerOf()` is how anything reads
    // it. There is EXACTLY ONE row like this and a test names it.
    skill: null,
    startedBy: "build-app",
    phase: "planen",
    step: "1.4",
    title: { de: "der Plan", en: "the plan" },
    what:
      "what this app is going to be, written down — each line something the " +
      "customer will be able to DO",
    // ← the reason this row exists at all. See the block above.
    optional: false,
    recurring: false,
    requires: null,
    module: null,
    // Never in the template itself: `.claude/skills/build-app/references/
    // plan-md-template.md` is the shape, and the file appears the moment
    // somebody agrees the picture. `docs-coverage.test.ts`'s GENERATED map is
    // what stops the link to it reading as dangling here.
    trace: { kind: "file", path: "docs/plan.md" },
    declined: null,
    alsoFrom: [],
    handsTo: "build-app",
  },

  // ── 2. Build ──────────────────────────────────────────────────────────────
  {
    skill: "build-app",
    phase: "bauen",
    step: "2.1",
    title: { de: "App bauen", en: "Build the app" },
    what: "The entry point: archetype, data model, the pages the customer will use.",
    optional: false,
    recurring: false,
    requires: null,
    module: null,
    // The four shipped areas are `beyond`; a module's parking spot under
    // `app/dashboard/` is excluded by `journeyFacts()` rather than listed here,
    // because the folder stays on disk when the module is not installed and
    // would otherwise read as a page somebody built (session-start.mjs carries
    // the measured version of that mistake).
    trace: { kind: "dir", path: "app/dashboard", beyond: ["account", "admin", "billing", "chat"] },
    declined: null,
    alsoFrom: [],
    handsTo: "setup-digistore",
  },
  {
    skill: "setup-digistore",
    phase: "bauen",
    step: "2.2",
    title: { de: "Bezahlung anschließen", en: "Connect payment" },
    what: "Fetches the API key, creates the products and registers the IPN connection.",
    optional: false,
    recurring: false,
    requires: "0.30.0",
    module: null,
    // All three, not just the key: a key with no passphrase means purchases
    // arrive nowhere, which is the failure coach routes to this skill.
    trace: {
      kind: "env",
      keys: ["DIGISTORE_API_KEY", "DIGISTORE_IPN_PASSPHRASE", "DIGISTORE_IPN_DOMAIN_ID"],
    },
    declined: null,
    alsoFrom: [],
    handsTo: "salespage",
  },
  {
    skill: "billing-modes",
    phase: "bauen",
    step: "2.2b",
    title: { de: "Abrechnungsmodell", en: "Billing model" },
    what: "Sets up subscriptions, prepaid tokens with auto top-up, and subscription self-service.",
    optional: true,
    recurring: false,
    requires: "0.14.0",
    module: null,
    // `billingMode` ships filled in as `"both"`, so the pointer alone is TRUE in
    // a fresh app and this row used to read `done` where nobody had decided
    // anything. `notValue` is the same judgement coach's own row already makes —
    // *"still `both` on an app that sells one of them"* — expressed as the one
    // predicate rather than as a second opinion somewhere else.
    trace: {
      kind: "json",
      path: "config/digistore-products.json",
      pointer: "billingMode",
      notValue: "both",
    },
    declined: null,
    alsoFrom: [],
    handsTo: null,
  },

  // ── 2.3 — the SHELF ───────────────────────────────────────────────────────
  //
  // Ten things an app may want and most apps do not. They share one step number
  // with a letter each, because they are one decision point rather than ten
  // steps: nothing here is reached by finishing the one before it.
  //
  // 🚨 Every one of them is `optional: true`, which in this file means exactly
  // what coach means by it — **offered when there is a REASON, never because it
  // has not been done yet.** A shelf that gets offered in order is a checklist,
  // and a checklist is what makes somebody build a mobile app for a product
  // nobody has bought yet.
  {
    skill: "visuals",
    phase: "bauen",
    step: "2.3a",
    title: { de: "Was der Kunde sieht", en: "What the customer sees" },
    what: "Decides and builds what the customer actually receives: images, video, files behind a purchase.",
    optional: true,
    recurring: false,
    requires: "0.7.0",
    module: null,
    // 🚨 **The recorded YES and the recorded NO were the SAME STRING, and the yes
    // lost.** This was `{ kind: "ask" }` with
    // `declined: { file: "docs/app.md", marker: "Output artifact" }` — but
    // `**Output artifact:**` is exactly what the notebook carries when step 1b was
    // ANSWERED (`build-app/references/app-md-template.md` → *The product*). So an
    // app whose `docs/app.md` says *"Output artifact: a finished sales page with a
    // hero image"* was told **"you said no to visuals"**. Measured, both rows:
    // `declined | you said no` on an app that had decided yes.
    //
    // So the trace now reads the ANSWER as an answer. Nothing new is opened for it:
    // `docs/app.md` was already in `facts.text` for the `declined` check.
    //
    // ⚠️ **The notebook only, not the brief.** `docs/product-brief.md` may carry the
    // same line, and `build-app` step 1b reads it — but it reads it in order to
    // CONFIRM it and then records the confirmed answer in `docs/app.md` (step 4b).
    // So the notebook is the record and the brief is upstream of it; a brief-only app
    // reads `unknown` here, which is the honest column, and coach's
    // `references/where-am-i.md` is where "look in the brief too" lives — that file
    // exists for exactly the judgements a predicate should not fake.
    //
    // **`declined` came back only once the FORMAT could carry it**, and the detour
    // is the point. It stood at `null` for a while, and that was a finding rather
    // than an omission: step 1b's recorded no had no load-bearing string. 1e's did —
    // `design`'s entry opens `- **No custom identity.**`, and
    // `design/references/menu.md` says in as many words that those three words are
    // the marker — where 1b's opened `- **No pictures in the challenge messages.**`,
    // and "challenge messages" is whatever the app's own archetype calls them.
    // Inventing a marker here would have been this file deciding a format the skills
    // do not write. So the fix was one line where the entry is authored: it now opens
    // with the fixed `- **No customer-facing visuals.**` and the app's own sentence
    // follows, in BOTH places that write it — `build-app/references/menus.md` step 1b
    // and `visuals` step 1, which asks the same question for a built app.
    trace: { kind: "note", path: "docs/app.md", label: "Output artifact:" },
    declined: { file: "docs/app.md", marker: "No customer-facing visuals" },
    alsoFrom: [],
    handsTo: null,
  },
  {
    skill: "content-production",
    phase: "bauen",
    step: "2.3b",
    title: { de: "Medien produzieren", en: "Produce the media" },
    what: "Produces the media a course still lacks: lesson scripts, video tooling, voiceover, subtitles.",
    optional: true,
    recurring: false,
    requires: "0.15.0",
    module: null,
    // `content/` ships with three folders in it — `knowledge/` (the assistant's
    // handbook), `knowledge-media/` and `legal/` — so an empty `beyond` read
    // `done` on every fresh clone. Listed the way `build-app`'s row lists the
    // four shipped dashboard areas: what ships is named, and a folder of the
    // operator's own is what answers the row.
    trace: {
      kind: "dir",
      path: "content",
      beyond: ["knowledge", "knowledge-media", "legal"],
    },
    declined: null,
    alsoFrom: [],
    handsTo: null,
  },
  {
    skill: "courses",
    phase: "bauen",
    step: "2.3c",
    title: { de: "Kurs", en: "Course" },
    what: "The course itself: blocks, lessons, progress and the purchase gate.",
    optional: true,
    recurring: false,
    requires: "0.24.0",
    module: "courses",
    trace: { kind: "module", id: "courses" },
    declined: null,
    alsoFrom: [],
    handsTo: null,
  },
  {
    skill: "learning-activities",
    phase: "bauen",
    step: "2.3d",
    title: { de: "Interaktive Elemente", en: "Interactive elements" },
    what: "What a course's customer DOES — exercises and checks, judged on the server.",
    optional: true,
    recurring: false,
    requires: "0.9.0",
    module: "activity",
    trace: { kind: "module", id: "activity" },
    declined: null,
    alsoFrom: [],
    handsTo: null,
  },
  {
    skill: "community",
    phase: "bauen",
    step: "2.3e",
    title: { de: "Community", en: "Community" },
    what: "A place for members: rooms, discussions under the pages they belong to, private messages.",
    optional: true,
    recurring: false,
    requires: "0.19.0",
    module: "community",
    // Installed is not the same as switched on, and this row asks the first
    // question only — `config/community.json` ships OFF and stays the module's
    // own business (CLAUDE.md → Modules).
    trace: { kind: "module", id: "community" },
    declined: null,
    alsoFrom: [],
    handsTo: null,
  },
  {
    skill: "ai-companion",
    phase: "bauen",
    step: "2.3f",
    title: { de: "KI-Begleiter", en: "AI companion" },
    what: "The app working alongside its customer while they work, not only delivering to them.",
    optional: true,
    recurring: false,
    requires: "0.8.0",
    module: "companion",
    trace: { kind: "module", id: "companion" },
    declined: null,
    alsoFrom: [],
    handsTo: null,
  },
  {
    skill: "mobile-companion",
    phase: "bauen",
    step: "2.3g",
    title: { de: "App fürs Handy", en: "Mobile companion" },
    what: "Asks first whether a native app is wanted at all, then switches the HTTP API on and ships the companion.",
    optional: true,
    recurring: false,
    requires: "0.11.0",
    module: "api",
    trace: { kind: "module", id: "api" },
    declined: null,
    alsoFrom: [],
    handsTo: null,
  },
  {
    skill: "ai-providers",
    phase: "bauen",
    step: "2.3h",
    title: { de: "KI-Anbieter wählen", en: "Choose the AI provider" },
    what: "Picks the AI company, gets the key in, binds tasks to models and sets the prices.",
    optional: true,
    recurring: false,
    requires: null,
    module: null,
    // 🚨 There is no `config/ai.json` in this template — the file is
    // `config/ai-models.json` and its `default.provider` ships as `"auto"`,
    // which means *run on whichever key is in the .env* and is precisely the
    // state this skill exists to replace with a named company. So the trace is
    // the real path, the real pointer, and `notValue` for the shipped value.
    trace: {
      kind: "json",
      path: "config/ai-models.json",
      pointer: "default.provider",
      notValue: "auto",
    },
    declined: null,
    alsoFrom: [],
    handsTo: null,
  },
  {
    skill: "ai-chat-knowledge",
    phase: "bauen",
    step: "2.3i",
    title: { de: "Assistentin einrichten", en: "Set the assistant up" },
    what: "Switches the in-app assistant on, gives her a name and writes her handbook.",
    optional: true,
    recurring: false,
    requires: "0.10.0",
    module: null,
    // 🚨 **The switch is the wrong question.** `"enabled"` in
    // `config/ai-chat.json` ships as `true`, so a pointer at it read `done` on
    // every fresh clone — for a step whose work is a HANDBOOK. Coach's row asks
    // it properly: *"on but with a thin `content/knowledge/` →
    // ai-chat-knowledge"*, so the switch is the precondition and the corpus is
    // the answer.
    //
    // `deep` because the handbook's files land INSIDE the shipped section
    // folders (`00-onboarding/`, `10-reference/`, `20-howto/`), so an
    // immediate-subfolder count would never see one. The five files the template
    // ships as the example handbook are named in `beyond`.
    //
    // ⚠️ What this deliberately does NOT catch: a handbook written by rewriting
    // those five files in place and adding none. That reads `open`, which is the
    // safe direction — offering a step somebody already took costs a sentence,
    // while claiming a handbook exists where none was written is the failure this
    // row was changed to remove. *How good* a handbook is stays
    // `node run.mjs kb-check`'s question and is no file predicate at all.
    trace: {
      kind: "dir",
      path: "content/knowledge",
      deep: true,
      beyond: [
        "00-onboarding/welcome.md",
        "10-reference/account.md",
        "10-reference/plans-and-credit.md",
        "20-howto/cancel-a-subscription.md",
        "20-howto/set-a-password.md",
        "90-glossary.md",
      ],
    },
    declined: null,
    alsoFrom: [],
    handsTo: null,
  },
  {
    skill: "user-onboarding",
    phase: "bauen",
    step: "2.3j",
    title: { de: "Erste Sitzung des Kunden", en: "The customer's first session" },
    what: "Designs the END USER's first session on purpose instead of inheriting the blueprint's.",
    optional: true,
    recurring: false,
    requires: "0.4.0",
    module: null,
    // 🚨 **This was a `note` row on `docs/app.md`'s `Activation:` line, and
    // `build-app` writing that line is exactly what took the question away from
    // it.** Step 1f now asks for the activation event and step 4b writes it into
    // the product block, so the line is there on every app this template builds —
    // and a `note` row would have read `done` for all of them while the dashboard
    // checklist was still the shipped blueprint. A predicate that answers "done"
    // where nothing happened is the fault the four vacuous rows above were fixed
    // for; moving the trace is how that fault is not merely avoided but relocated
    // to the question that is still open.
    //
    // **What is still open is the checklist**, so that is what the row asks now:
    // are the shipped blueprint steps GONE from `app/dashboard/page.tsx`? The
    // markers are the message keys the two steps render with, and the choice
    // between them is the usual one — `onboardingPlanDone` is exclusive to the
    // plan step, while `onboardingTokensTitle` is shared with the offer card two
    // blocks up (`page.tsx`, the `offer` empty state). Both are listed anyway:
    // `some(marked) → open`, so an app that replaced one step and kept the other
    // stays open, and an app that kept the offer card reads open although its
    // steps are its own. That is the safe direction, the same one the knowledge
    // row takes — an onboarding wrongly called unfinished costs a conversation,
    // one wrongly called finished costs the customer their first five minutes.
    //
    // 🚨 **The marker may not be the comment.** `THIS IS THE BLUEPRINT` stands
    // right above those steps and reads like the obvious marker; `facts.text`
    // runs source through `blankComments()`, so it is never there and the row
    // would read `done` for every app, for ever. Same trap the salespage row
    // documents one screen down, from the other side.
    //
    // `declined` stays `null`: this step has no refusal of its own to record. The
    // nos `user-onboarding` writes are nos to PATTERNS (no survey, no
    // gamification), never to having a first session at all.
    trace: {
      kind: "placeholder",
      path: "app/dashboard/page.tsx",
      markers: ["onboardingPlanDone", "onboardingTokensTitle"],
    },
    declined: null,
    alsoFrom: [],
    handsTo: null,
  },

  {
    skill: "metrics",
    phase: "bauen",
    step: "2.3k",
    title: { de: "Kennzahlen", en: "Metrics" },
    what: "The onboarding funnel, return by cohort and split tests, counted in this app's own database.",
    optional: true,
    recurring: false,
    requires: "0.33.0",
    module: "metrics",
    // Deliberately right after 2.3j: this measures what `user-onboarding`
    // built, and its own playbook hands back to that skill. ⚠️ It sits in
    // **bauen** although the READING only makes sense once there are customers
    // — because the half that has to happen here is the half nobody can add
    // later: the `track()` calls at the moments they describe. The funnel fills
    // from the day it is switched on and has no history before it, so a step
    // placed in phase 4 would be a step that can only ever measure the future.
    trace: { kind: "module", id: "metrics" },
    declined: null,
    alsoFrom: [],
    handsTo: null,
  },

  // ── 2.4 onwards — the gates, in the order their findings allow ─────────────
  {
    skill: "salespage",
    phase: "bauen",
    step: "2.4",
    title: { de: "Verkaufsseite", en: "Salespage" },
    what: "Turns the placeholder home page into a page that sells THIS product.",
    optional: false,
    recurring: false,
    requires: "0.7.0",
    module: null,
    // 🚨 The marker is `features.authTitle` and not `home.features.` — that
    // string is what is really in `app/page.tsx`, and it is the ONLY marker
    // left since the three lucide icons beside it were removed. It is read the
    // way `findPlaceholderHome()` in `scripts/ux/rules.mjs` reads it, comments
    // blanked: the page's own note ABOUT the marker contains the marker, so a
    // raw text search would report a rewritten page as still the placeholder.
    trace: { kind: "placeholder", path: "app/page.tsx", markers: ["features.authTitle"] },
    declined: null,
    alsoFrom: [],
    handsTo: "ux-gateway",
  },
  {
    skill: "ux-gateway",
    phase: "bauen",
    step: "2.5",
    title: { de: "Erlebnis prüfen", en: "Check the experience" },
    what: "Looks at the app the way a paying customer does, fixes what has to be fixed, writes a dated report.",
    optional: false,
    recurring: false,
    requires: "0.4.0",
    module: null,
    // The report's NAME is the date — no file is opened. Same contract the
    // greeting's operational line keeps for the operating round.
    trace: { kind: "report", prefix: "ux" },
    declined: null,
    alsoFrom: [],
    handsTo: "security-gateway",
  },
  {
    skill: "security-gateway",
    phase: "bauen",
    step: "2.6",
    title: { de: "Sicherheit prüfen", en: "Check security" },
    what: "Scans the app for holes, fixes what has to be fixed and writes a dated report.",
    optional: false,
    // Recurring without a window on purpose: a report older than the last big
    // change is worth as much as none, and "the last big change" is not a number
    // of days. The recurring pass is the skill's own §10 (`since`).
    recurring: true,
    requires: null,
    module: null,
    trace: { kind: "report", prefix: "security" },
    declined: null,
    alsoFrom: ["betrieb"],
    handsTo: "performance-gateway",
  },
  {
    skill: "performance-gateway",
    phase: "bauen",
    step: "2.7",
    title: { de: "Geschwindigkeit prüfen", en: "Check performance" },
    what: "Measures where the app is slow, fixes it, measures again and writes a dated report.",
    optional: false,
    recurring: false,
    requires: null,
    module: null,
    trace: { kind: "report", prefix: "performance" },
    declined: null,
    alsoFrom: ["betrieb"],
    handsTo: "compliance-check",
  },
  {
    skill: "compliance-check",
    phase: "bauen",
    step: "2.8",
    title: { de: "Rechtliches", en: "Legal" },
    what: "Works out which EU rules reach this app, writes the legal pages and the evidence pack.",
    optional: false,
    recurring: false,
    requires: null,
    module: null,
    // 🚨 **The ROUTES prove nothing: they ship.** `app/impressum/page.tsx` and
    // `app/datenschutz/page.tsx` are in the template, so a `routes` predicate
    // over them is TRUE in every app that ever existed — this row read `done` on
    // an untouched clone, for the one gate with a regulator on the other end.
    //
    // What is actually unwritten is the TEXT, and it says so in a marker
    // designed to be read: `content/legal/*.md` ship carrying
    // `<!-- ds24-appkit:placeholder -->`, which is the same string
    // `lib/legal/pages.ts` and `node run.mjs legal-check` look for. So the
    // predicate is the marker, over the four files, and it agrees with the
    // command by construction rather than by coincidence.
    //
    // `app/agb` and `app/widerruf` depend on the seller role and are not part of
    // it — coach's row says the same.
    trace: {
      kind: "placeholder",
      paths: [
        "content/legal/impressum.de.md",
        "content/legal/impressum.en.md",
        "content/legal/datenschutz.de.md",
        "content/legal/datenschutz.en.md",
      ],
      markers: ["ds24-appkit:placeholder"],
    },
    declined: null,
    alsoFrom: ["betrieb"],
    handsTo: "setup-hosting",
  },

  // ── 3. Go live ────────────────────────────────────────────────────────────
  {
    // 🚨 **The row that made phase 4 unreachable.** Its trace is an honest `ask`,
    // so its state was permanently `unknown` — an OPEN state — and phase 3
    // therefore never cleared: `currentPhase` could not become `betrieb` from ANY
    // facts at all, so an app that had been running for a year was still being
    // told it was going live. `impliedBy` below is the fix, and the state machine
    // carries no special case for it (`settleImplied()`).
    skill: "setup-hosting",
    phase: "live",
    step: "3.1",
    title: { de: "Server einrichten", en: "Set the server up" },
    what: "Picks a host, installs its CLI, creates the app and its managed Postgres, sets every secret.",
    optional: false,
    recurring: false,
    requires: "0.14.0",
    module: null,
    trace: { kind: "ask", why: "node run.mjs doctor --deploy answers this, not a file" },
    // 3.1 cannot be measured directly — no file says "a host was chosen". But 3.2
    // proves a non-localhost APP_URL, and you cannot be live without a server. So
    // a done 3.2 answers 3.1. Narrow on purpose: this is the only row where a
    // LATER step's evidence settles an earlier one, and it must not become a
    // general escape from "every row needs its own trace".
    impliedBy: "go-live",
    declined: null,
    alsoFrom: [],
    handsTo: "go-live",
  },
  {
    skill: "go-live",
    phase: "live",
    step: "3.2",
    title: { de: "Live gehen", en: "Go live" },
    what: "Puts the app online and proves that a real purchase really unlocks access.",
    optional: false,
    recurring: false,
    requires: "0.15.0",
    module: null,
    // `APP_URL` is always SET — it ships as a localhost address — so presence
    // proves nothing here and `notValue` is what carries the question.
    trace: { kind: "env", keys: ["APP_URL"], notValue: "localhost" },
    declined: null,
    alsoFrom: [],
    handsTo: "operate",
  },
  {
    skill: "setup-environments",
    phase: "live",
    step: "3.3",
    title: { de: "Umgebung füllen", en: "Fill an environment" },
    what: "Sets an environment up over the app's own surface — accounts, plans, media, rooms — with no production password in a shell.",
    optional: true,
    recurring: false,
    requires: "0.20.0",
    module: null,
    trace: { kind: "ask", why: "content-check --env prod answers this" },
    declined: null,
    alsoFrom: ["bauen", "betrieb"],
    handsTo: null,
  },
  {
    skill: "setup-monitoring",
    phase: "live",
    step: "3.4",
    title: { de: "Überwachung", en: "Monitoring" },
    what: "Decides what tells the operator it broke, instead of a customer — then wires it up.",
    optional: true,
    recurring: false,
    requires: "0.23.0",
    module: null,
    trace: {
      kind: "ask",
      why: "a provider package in package.json plus wiring in instrumentation.ts",
    },
    // 🚨 **The marker is what the skill really writes, and it was not.** This row
    // carried `marker: "No monitoring"` — a string that appears nowhere in this
    // tree. `setup-monitoring` § *Write the decision down — including "none"*
    // writes `- Monitoring: none, deliberately, decided <date> — <reason>`, so the
    // row could never read `declined` and a recorded refusal to monitor was
    // re-proposed for ever. `journey.test.ts` now carries the needle: a notebook
    // holding the real entry reads `declined`.
    declined: { file: "docs/app.md", marker: "Monitoring: none" },
    alsoFrom: [],
    handsTo: null,
  },

  // ── 4. Run it ─────────────────────────────────────────────────────────────
  {
    skill: "operate",
    phase: "betrieb",
    step: "4.1",
    title: { de: "Betriebsrunde", en: "The operating round" },
    what: "The recurring round: safety, hidden errors, jobs, content, reach — read off the app, written into a dated report.",
    optional: false,
    // The only row whose done-ness EXPIRES on a clock. Thirty days is
    // `MAX_ROUND_AGE` in `./operations.mjs` and the number is argued there; it is
    // restated as data here rather than imported, because the greeting's line
    // and this row are two readers of one habit and neither owns the other.
    recurring: true,
    requires: "0.23.0",
    module: null,
    trace: { kind: "report", prefix: "operations", maxAgeDays: 30 },
    declined: null,
    alsoFrom: [],
    handsTo: null,
  },
  {
    skill: "go-to-market",
    phase: "betrieb",
    step: "4.2",
    title: { de: "Vermarkten", en: "Go to market" },
    what: "Positioning, channels, launch plan, content.",
    optional: true,
    recurring: true,
    requires: null,
    module: null,
    // 🚨 **This was the last row that could not be answered, and the answer was
    // to give the step an artifact rather than to keep asking.** It used to be a
    // `kind: "ask"` — *"go-to-market writes nothing that proves it ran"* — while
    // every other station in this template writes something down. The skill's
    // phase 5 now writes `docs/go-to-market.md`: the positioning, the price and
    // why, the channels chosen AND the ones turned down with the reason, the
    // launch plan. Which is also the file that stops next session's agent
    // re-deciding a price somebody already argued about.
    //
    // `recurring: true` stays, and a `file` trace has no window — so once it
    // exists this reads `done` for ever, exactly as `security-gateway`'s report
    // does. Marketing coming round again is a statement about the ACTIVITY, and
    // "how long is a launch plan still current" is not a number of days.
    //
    // Never in the template itself: the file belongs to the customer's app, and
    // `docs-coverage.test.ts`'s GENERATED map is what stops the mention of it in
    // the skill reading as a dangling link.
    trace: { kind: "file", path: "docs/go-to-market.md" },
    declined: null,
    alsoFrom: ["planen"],
    handsTo: null,
  },

  // ── Alongside ─────────────────────────────────────────────────────────────
  {
    skill: "guardrails",
    phase: "daneben",
    step: null,
    title: { de: "Leitplanken", en: "Guardrails" },
    what: "The rules that hold around money, secrets and customer data, whatever else is being built.",
    optional: false,
    recurring: false,
    requires: null,
    module: null,
    trace: { kind: "ask", why: "rules that apply alongside everything; never done, never open" },
    declined: null,
    alsoFrom: [],
    handsTo: null,
  },
  {
    skill: "coach",
    phase: "daneben",
    step: null,
    title: { de: "Wegweiser", en: "The coach" },
    what: "Works out where the project stands, names the one next step, and routes a symptom to the skill that fixes it.",
    optional: false,
    recurring: false,
    // Mirrored, not decided here: the skill's own text now opens on
    // `node run.mjs journey --json` — a command that does not exist in an older
    // copy — so its frontmatter carries `requires: 0.26.0` and this restates it.
    requires: "0.26.0",
    module: null,
    trace: { kind: "ask", why: "a router; never done, never open" },
    declined: null,
    alsoFrom: [],
    handsTo: null,
  },
];

// ── Reading the list ────────────────────────────────────────────────────────

/**
 * Everything `journeyFacts()` answers — the shape the pure half reads.
 *
 * Written as a typedef rather than left to inference so that a `.ts` caller (and
 * every test) gets the field names checked. A fact that is not in here is one
 * `journeyState()` cannot see.
 *
 * @typedef {object} JourneyFacts
 * @property {number} now the clock, always passed in — nothing here reads `Date.now()`
 * @property {string|null} version this app's `package.json` version, `null` when unreadable
 * @property {Record<string, boolean>} exists per path: is it there at all
 * @property {Record<string, string|null>} text per path: the content, comments blanked for source
 * @property {Record<string, unknown>} json per path: the parsed config, `null` when absent or broken
 * @property {Record<string, {entries: string[], moduleOwned: string[]}|null>} dirs per path: what is in it (the folders — or, for a `deep` row, the file paths), and which entries are a module's parking spot
 * @property {Record<string, string>} env per key: the value, `""` when unset
 * @property {string[]} reportNames the file NAMES in `docs/reports/` — never their content
 * @property {string[]|null} modules the installed module ids, `null` for "I could not look"
 */

/** One row, the state it is in, and why. @typedef {(typeof JOURNEY)[number] & { state: string, evidence: string }} JourneyRow */

/**
 * Which phase a skill belongs to, or `null` for a name that is not a row.
 *
 * ⚠️ The falsy guard is not defensive noise: one row's `skill` IS `null`, so
 * `phaseOf(undefined)` would otherwise find the plan row and answer `"planen"`
 * for every name that is not a skill at all.
 */
export function phaseOf(skill) {
  if (!skill) return null;
  return JOURNEY.find((row) => row.skill === skill)?.phase ?? null;
}

/**
 * Which skill PERFORMS a row — its own, or the one that writes its deliverable.
 *
 * Every caller that wants to say *"shall I start this"* asks this and never
 * `row.skill`, because the plan row has no skill of its own and would render as
 * a step with nothing behind it. `null` is impossible for a row of this list and
 * is the honest answer for anything else handed in.
 */
export function performerOf(row) {
  return row?.skill ?? row?.startedBy ?? null;
}

/**
 * The rows of one phase, in step order.
 *
 * `JOURNEY` is written in step order, so this is a filter and never a sort — a
 * comparator over `"2.3a"` and `"2.10"` is a second opinion about the order, and
 * the list above is the first one.
 */
export function rowsFor(phase) {
  return JOURNEY.filter((row) => row.phase === phase);
}

// ── The pure half ───────────────────────────────────────────────────────────

/** `docs/reports/<prefix>-YYYY-MM-DD.md`, plus the `-2` a second one that day gets. */
function reportPattern(prefix) {
  return new RegExp(`^${prefix}-(\\d{4}-\\d{2}-\\d{2})(?:-\\d+)?\\.md$`);
}

/**
 * The newest report date for one prefix, as `YYYY-MM-DD`, or `null`.
 *
 * PURE: it is handed the file NAMES and never opens one. The name is the datum —
 * every gateway writes its date into the stem, and opening a report would put a
 * customer's own prose into a code path that runs in front of a session.
 *
 * The round trip through `Date` is not pedantry: the pattern accepts any
 * four-two-two, so `ux-2026-13-45.md` matches and is not a date. And `now`
 * bounds the future — a mistyped `2126` would otherwise silence a row for a
 * century — with the newest overall as the fallback, so a report written on a
 * machine an hour ahead of UTC still counts.
 *
 * ⚠️ `./operations.mjs` answers this same question for the one prefix its line
 * cares about. Two copies is one too many, and unifying them belongs in the step
 * that makes the greeting read this file — not in a drive-by edit to a module
 * whose own tests pin its behaviour.
 */
export function newestReportDate(names, prefix, now = Date.now()) {
  const pattern = reportPattern(prefix);
  const days = (Array.isArray(names) ? names : [])
    .map((name) => pattern.exec(String(name ?? ""))?.[1] ?? "")
    .filter((day) => {
      if (!day) return false;
      const at = Date.parse(`${day}T00:00:00.000Z`);
      // Written out rather than as one expression: `toISOString()` THROWS on an
      // invalid date, and this runs in front of somebody's session.
      return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === day;
    })
    .sort()
    .reverse();

  const today = new Date(now).toISOString().slice(0, 10);
  return days.find((day) => day <= today) ?? days[0] ?? null;
}

/**
 * The states that mean "somebody still has to do this".
 *
 * ⚠️ `needs-newer-template` and `declined` are deliberately NOT in it. One is
 * impossible in this copy and the other has been answered — routing somebody at
 * either is how a path stops being believed.
 */
const OPEN_STATES = new Set(["open", "unknown", "stale", "blocked"]);

/** A dotted pointer into a parsed config, or `undefined`. */
function pointerValue(value, pointer) {
  let at = value;
  for (const key of String(pointer ?? "").split(".")) {
    if (at === null || typeof at !== "object") return undefined;
    at = at[key];
  }
  return at;
}

/** Is this value there at all, and not the placeholder `notValue` names? */
function valueAnswers(value, notValue) {
  if (value === undefined || value === null || value === "" || value === false) return false;
  if (notValue === undefined) return true;
  return !String(value).toLowerCase().includes(String(notValue).toLowerCase());
}

/**
 * The entries of a `dir` row's folder that are NOT what shipped, or `null` for
 * "no such folder".
 *
 * PURE, and the single reading of `beyond`. `null` and `[]` are deliberately two
 * answers: an absent folder and a folder holding only what the template put
 * there are the same STATE (`open`) and two different sentences.
 *
 * A module's parking spot under the folder never counts —
 * `app/dashboard/community/` stays on disk when the module is not installed, and
 * announcing it as a page somebody built is a mistake this template has already
 * made once (`journeyFacts()` decides which entries those are).
 */
function ownEntries(trace, facts) {
  const dir = facts.dirs?.[trace.path];
  if (!dir) return null;
  const beyond = new Set(trace.beyond ?? []);
  return (dir.entries ?? []).filter(
    (entry) => !beyond.has(entry) && !(dir.moduleOwned ?? []).includes(entry),
  );
}

/** Every path a `placeholder` row asks about — one, or a list. */
const placeholderPaths = (trace) => trace.paths ?? (trace.path ? [trace.path] : []);

/**
 * The `placeholder` files that EXIST, each with whether it still carries a marker.
 *
 * PURE. Two decisions live in this shape:
 *
 * · **A missing file is not a rewritten one**, so an empty answer means `open`
 *   (`salespage` pins that: no `app/page.tsx` must never read as `done`).
 * · **A file that is not there does not BLOCK either**, which is why the list is
 *   filtered rather than required whole. `compliance-check` asks about four legal
 *   texts in two languages; an app that dropped a locale would otherwise be
 *   permanently open on a page it does not have.
 */
function placeholderFiles(trace, facts) {
  return placeholderPaths(trace)
    .map((path) => ({ path, text: facts.text?.[path] }))
    .filter(({ text }) => typeof text === "string")
    .map(({ path, text }) => ({
      path,
      marked: (trace.markers ?? []).some((marker) => text.includes(marker)),
    }));
}

/**
 * What a `note` row's label has written after it, or `null`.
 *
 * PURE, and the single reading of `label`. `null` is *there is no such line* —
 * either because the notebook is not there or because it holds no line naming this
 * slot. Both are the same STATE (`unknown`) and two different sentences, which is
 * why `evidenceOf()` asks `facts.text` itself rather than trying to read two
 * answers out of one `null` (the same split `ownEntries()` keeps).
 *
 * `includes` rather than an anchor, because the line comes with the notebook's own
 * furniture around it — `- **Output artifact:** …` under *The product*, a bare
 * `Activation: …` under *Decisions worth remembering*. The `**` is stripped off
 * what follows so the ANSWER is quoted and not the markdown.
 */
function noteValue(trace, facts) {
  const text = facts.text?.[trace.path];
  if (typeof text !== "string") return null;
  const label = String(trace.label ?? "");
  const line = text.split(/\r?\n/).find((entry) => entry.includes(label));
  if (line === undefined) return null;
  return line
    .slice(line.indexOf(label) + label.length)
    .replace(/\*+/g, "")
    .trim();
}

/**
 * Is what follows a label an ANSWER, or the notebook's own unfilled slot?
 *
 * 🚨 **The vacuity guard of the `note` kind, and it belongs to the kind rather
 * than to a row.** `docs/app.md` is copied from
 * `build-app/references/app-md-template.md`, whose every unanswered slot is
 * `<…>` — `- **Output artifact:** <what the customer ends up holding — …>`. A
 * predicate that only asked *is the label there* would read `done` on a notebook
 * created and never filled in, which is the exact shape of the four predicates
 * fixed above. Tested structurally (`<` in first position) and not as a `notValue`
 * string: the placeholder's WORDING is somebody else's to reword, its bracket is
 * the format.
 */
const isAnswered = (value) => typeof value === "string" && value !== "" && !value.startsWith("<");

/**
 * What the trace says: `"done"`, `"stale"`, `"open"` or `"unknown"`.
 *
 * PURE, and the only place a trace kind is interpreted. A kind this function
 * does not know answers `"unknown"` rather than throwing — a row somebody adds
 * with a typo in its kind must not take a greeting down.
 */
function traceState(row, facts) {
  const trace = row.trace ?? {};

  switch (trace.kind) {
    case "file":
      return facts.exists?.[trace.path] ? "done" : "open";

    case "routes":
      return (trace.paths ?? []).every((path) => facts.exists?.[path]) ? "done" : "open";

    case "report": {
      const newest = newestReportDate(facts.reportNames, trace.prefix, facts.now);
      if (!newest) return "open";
      if (!trace.maxAgeDays) return "done";
      const at = Date.parse(`${newest}T00:00:00.000Z`);
      // A name that is not a date got filtered out above, so this is a real day.
      return facts.now - at > trace.maxAgeDays * DAY ? "stale" : "done";
    }

    case "env":
      return (trace.keys ?? []).every((key) =>
        valueAnswers(facts.env?.[key], trace.notValue),
      )
        ? "done"
        : "open";

    case "json": {
      const parsed = facts.json?.[trace.path];
      // A config that could not be read is not a config that says no — but there
      // is nothing to report it as here either, so it reads as open and the
      // command that reads a config for real is the one that complains about it.
      if (parsed === null || parsed === undefined) return "open";
      return valueAnswers(pointerValue(parsed, trace.pointer), trace.notValue) ? "done" : "open";
    }

    case "dir": {
      // Asked through the helper so that whatever RENDERS this row can name the
      // entries it counted without keeping a second copy of the rule.
      const own = ownEntries(trace, facts);
      return own !== null && own.length > 0 ? "done" : "open";
    }

    case "module":
      // `null` is "I could not read the module list", and that is deliberately
      // not the same answer as "it is not installed" — the same distinction
      // `module remove` refuses on.
      if (facts.modules === null || facts.modules === undefined) return "unknown";
      return facts.modules.includes(trace.id) ? "done" : "open";

    case "placeholder": {
      const present = placeholderFiles(trace, facts);
      // No file at all is not a file somebody rewrote. Answering `done` for an
      // absence is how an absence becomes an achievement.
      if (present.length === 0) return "open";
      return present.some(({ marked }) => marked) ? "open" : "done";
    }

    case "note": {
      const value = noteValue(trace, facts);
      // 🚨 **No line is `unknown`, never `open`.** A decision recorded nowhere may
      // still have been made — `visuals` can be settled in `docs/product-brief.md`,
      // and an operator who thought about their onboarding without writing it down
      // still thought about it. Turning *I could not look* into *you have not done
      // it* is the mistake `operate` keeps two columns to avoid, and this row is
      // held to the same rule.
      if (value === null) return "unknown";
      // A slot standing there unfilled is different: the notebook exists, the line
      // exists, and nobody answered it. That IS measurable, so it is `open` — the
      // one state these two rows could never reach before.
      return isAnswered(value) ? "done" : "open";
    }

    case "ask":
    default:
      return "unknown";
  }
}

/**
 * Every row with its state, plus the one next step.
 *
 * PURE — no `fs`, no clock of its own (`facts.now` is the clock), no mutation of
 * `JOURNEY`: every row is copied.
 *
 * 🚨 **The precedence below is the load-bearing logic of this file, and it is
 * written out because each rung is a decision that reads as arbitrary until the
 * failure behind it is named.**
 *
 *  1. **`needs-newer-template` beats everything.** A row whose code is not in
 *     this copy must NEVER render as "open", or the user is routed at a feature
 *     that cannot exist — they would be told to run a skill, and then find
 *     nothing of it. `node run.mjs update` refuses the TEXT on the same value;
 *     this refuses the STEP.
 *  2. **`declined` beats `open`.** A recorded "no" is an ANSWER, not an absence.
 *     This one distinction is what turns coach's rule — *"a recorded 'no' is an
 *     answer; say so and move on"* — into something a command enforces instead
 *     of a paragraph an agent is asked to remember. Re-proposing the thing
 *     somebody turned down in session one is how a coach becomes something
 *     people skip.
 *  3. **`done` / `stale` from the trace.** The disk is asked before anything is
 *     inferred: almost every step leaves a trace, and reading it is cheaper and
 *     truer than asking.
 *  4. **`blocked` when the row needs a module this app has not installed.**
 *     After the trace, because a module row's trace IS the module question.
 *  5. **otherwise `open`** — or `unknown` for a `kind: "ask"` row, because
 *     "nobody has recorded this" and "this has not happened" are not the same
 *     claim and must not print as one.
 *
 * Then ONE derived pass over the finished rows, `settleImplied()`: the single
 * `impliedBy` row is answered by a LATER row's evidence. It runs after every
 * state exists — it has to, because it reads another row's answer — and before
 * `currentPhase` and `next`, which are what it was added to unstick.
 *
 * @param {Partial<JourneyFacts>} [facts] what `journeyFacts()` answered
 * @returns {{ rows: JourneyRow[], currentPhase: string|null, next: JourneyRow|null }}
 */
export function journeyState(facts = {}) {
  // Copied, never annotated in place: `JOURNEY` is a module-level constant and a
  // second caller must see it as the first one did.
  const rows = JOURNEY.map((row) => {
    const state = stateOf(row, facts);
    // The EVIDENCE is computed here and not by whatever prints it, for the reason
    // the seam exists at all: it is derived from the facts, and a renderer that
    // had to re-read them would be a second reader of the disk. So the pure half
    // answers `{ state, evidence }` and the human view, the `--json` shape and
    // the greeting all quote the same sentence.
    return { ...row, state, evidence: evidenceOf(row, facts, state) };
  });

  // The one row a later step settles. After every state, before `currentPhase`.
  settleImplied(rows);

  // Only the NUMBERED phases are a path. `voraussetzung` comes before it and
  // `daneben` runs alongside it — `guardrails` and `coach` are `optional: false`
  // and never done, so counting them would pin `currentPhase` at "alongside"
  // for ever and make `next` the coach, always.
  const numbered = PHASES.filter((phase) => phase.num !== null).map((phase) => phase.id);
  const outstanding = (row) =>
    row.optional === false && OPEN_STATES.has(row.state) && numbered.includes(row.phase);

  const currentPhase = numbered.find((id) => rows.some((row) => row.phase === id && outstanding(row)))
    ?? null;

  // 🚨 ONE row, never a list. Coach's rule 1 is "name one next step, not a
  // catalogue", and a function that returns an array is one whose callers will
  // print all of it.
  const next = rows.find(outstanding) ?? null;

  return { rows, currentPhase, next };
}

/** One row's state, in the precedence `journeyState()` documents. */
function stateOf(row, facts) {
  // 1. The code is not here at all.
  //
  // An unreadable `package.json` answers `null`, and then this rung is SKIPPED
  // rather than applied: refusing every versioned row because one file could not
  // be read would hide twenty-one of the thirty steps, which is the opposite of
  // what this rung is for.
  if (row.requires && facts.version && !versionAtLeast(facts.version, row.requires)) {
    return "needs-newer-template";
  }

  // 2. A recorded "no".
  if (row.declined) {
    const text = facts.text?.[row.declined.file];
    if (typeof text === "string" && text.includes(row.declined.marker)) return "declined";
  }

  // 3. What the disk says.
  const traced = traceState(row, facts);
  if (traced === "done" || traced === "stale") return traced;

  // 4. A module this app does not have.
  if (row.module && Array.isArray(facts.modules) && !facts.modules.includes(row.module)) {
    return "blocked";
  }

  // 5. Open — or honestly unknown.
  return traced;
}

/**
 * `impliedBy`, applied: a row answered by a LATER row rather than by a trace.
 *
 * 🚨 **There is exactly one such row and that is the whole design.** 3.1
 * (`setup-hosting`) cannot be measured — nothing on disk says a host was chosen
 * — so it was permanently `unknown`, `unknown` is an OPEN state, and phase 3
 * therefore never cleared for ANY app: `currentPhase` could not become `betrieb`
 * however live the app was. 3.2 proves a non-localhost `APP_URL`, and you cannot
 * be live on a real domain without a server, so a done 3.2 answers 3.1.
 *
 * Three properties hold it in place, each with the failure it prevents:
 *
 *   · **Only an UNANSWERED row is implied** (`OPEN_STATES`). That one line is
 *     where `needs-newer-template` beats the implication — a row whose code is
 *     not in this copy must never read `done`, or the user is told a step is
 *     behind them that their app cannot even perform — and where `declined`
 *     beats it, because a recorded "no" is an answer of its own. A row whose own
 *     trace already said `done` or `stale` keeps what it measured.
 *   · **The target's state, never its facts.** This pass reads `rows`, so it
 *     inherits every rung of `stateOf()` for free and cannot grow a second
 *     opinion about what "live" means.
 *   · **The evidence names the target and never a VALUE.** `go-live`'s proof is
 *     `APP_URL`, and the journey prints the KEYS of the `.env` and never their
 *     contents (see the `env` case in `evidenceOf()`); a sentence quoting the
 *     domain would be that rule broken in the one place nobody would look for
 *     it. And it is never a bare "done": a row the user did not do themselves
 *     owes them the reason it is ticked.
 *
 * Mutates the COPIES `journeyState()` just made — never `JOURNEY` itself, which
 * is a module-level constant a second caller has to see as the first one did.
 */
function settleImplied(rows) {
  for (const row of rows) {
    if (!row.impliedBy) continue;
    if (!OPEN_STATES.has(row.state)) continue;
    const target = rows.find((entry) => entry.skill === row.impliedBy);
    if (!target || target.state !== "done") continue;
    row.state = "done";
    // First letter down: the titles are headings ("Go live") and this reads them
    // mid-phrase. The FIRST character only — the idiom `journey-render.mjs`
    // keeps for the same reason, and a whole-string `toLowerCase()` would come
    // back wrong the day a title names Digistore24.
    const what = String(target.title?.en ?? "").replace(/^(.)/, (c) => c.toLowerCase());
    // Short enough for the one column it prints in (the renderer folds at 51
    // characters and a wrapped clause reads as a second row's evidence).
    row.evidence = `${target.step} ${what} is done — impossible without this`;
  }
  return rows;
}

// ── The evidence: WHY a row is in the state it is in ────────────────────────
//
// One short phrase per row, derived from the same facts the state came from.
// Three of them are not free text and are quoted here so a later edit has to
// argue with a sentence rather than with a formatting choice:
//
//   · `needs-newer-template` says **`needs a newer template — node run.mjs
//     update`** and NEVER anything that reads like "open". Sending a user at a
//     feature whose code is absent is the failure that field exists to prevent.
//   · `blocked` NAMES `node run.mjs module add <id>`. A step that cannot start
//     is worth one line only if the line says what would let it.
//   · a module list that could not be read says **"could not look"** and never
//     "not installed" — `operate` keeps *checked* and *could not be checked* in
//     two columns and this line is held to the same rule.

/** At most `n` items, with the rest as `+N more`. The `describeUnwritten()` idiom. */
function few(items, n = 2) {
  const shown = items.slice(0, n);
  const rest = items.length - shown.length;
  return shown.join(", ") + (rest > 0 ? ` +${rest} more` : "");
}

/** A JSON value as something short enough for one column. */
function short(value) {
  if (typeof value === "string") return `"${value}"`;
  if (value === null || typeof value !== "object") return String(value);
  return Array.isArray(value) ? `${value.length} entries` : "set";
}

/**
 * The date on the line that carries a `declined` marker, or `""`.
 *
 * A skill that records a "no" is asked to date it, and where it did the journey
 * shows the date so the refusal can be REVOKED rather than merely respected.
 * Where it did not, the phrase stands without one — never with today's date,
 * which would be this command inventing a fact about a decision.
 */
function declinedDay(row, facts) {
  const text = facts.text?.[row.declined?.file];
  if (typeof text !== "string") return "";
  const line = text.split(/\r?\n/).find((entry) => entry.includes(row.declined.marker)) ?? "";
  return /(\d{4}-\d{2}-\d{2})/.exec(line)?.[1] ?? "";
}

/**
 * Why this row is in this state, in one phrase. PURE.
 *
 * Never empty: a row with nothing to say about itself renders as a blank column,
 * and a blank column reads as "nothing was looked at".
 */
function evidenceOf(row, facts, state) {
  const trace = row.trace ?? {};

  // ⚠️ This exact sentence, and short enough to fit one line: the version it
  // needs is in `row.requires` and in the `--json` shape, and a phrase that wraps
  // is one whose second line reads `update` on its own.
  if (state === "needs-newer-template") return "needs a newer template — node run.mjs update";

  if (state === "declined") {
    const day = declinedDay(row, facts);
    return day ? `you said no, ${day}` : "you said no";
  }

  if (state === "blocked") {
    return `the ${row.module} module is not installed — node run.mjs module add ${row.module}`;
  }

  // The one `unknown` that is not an `ask`: the module list itself was
  // unreadable. Said as "could not look", which is a different claim from "not
  // installed" and must never print as one.
  if (trace.kind === "module" && state === "unknown") {
    return "could not look — config/modules.json is unreadable";
  }

  switch (trace.kind) {
    case "file":
      return state === "done" ? trace.path : `no ${trace.path} yet`;

    case "routes": {
      const missing = (trace.paths ?? []).filter((path) => !facts.exists?.[path]);
      return missing.length === 0
        ? (trace.paths ?? []).join(", ")
        : `${missing.join(", ")} missing`;
    }

    case "report": {
      const newest = newestReportDate(facts.reportNames, trace.prefix, facts.now);
      if (!newest) return `no docs/reports/${trace.prefix}-*.md yet`;
      const days = Math.floor((facts.now - Date.parse(`${newest}T00:00:00.000Z`)) / DAY);
      const age = Number.isFinite(days) ? `, ${days} days ago` : "";
      return state === "stale"
        ? `docs/reports/${trace.prefix}-${newest}.md${age} — past its ${trace.maxAgeDays}-day bound`
        : `docs/reports/${trace.prefix}-${newest}.md${age}`;
    }

    case "env": {
      const keys = trace.keys ?? [];
      // 🚨 The KEYS, never the values: two of the three rows reading the .env read
      // an API key and an IPN passphrase, and a journey that prints them writes a
      // credential into whatever the user pastes their terminal into.
      if (state === "done") return `set in .env: ${few(keys, 1)}`;
      const stale = keys.filter(
        (key) => facts.env?.[key] && !valueAnswers(facts.env?.[key], trace.notValue),
      );
      if (stale.length > 0) return `${few(stale, 1)} still says ${trace.notValue} in .env`;
      return `not set in .env: ${few(keys.filter((key) => !facts.env?.[key]), 1)}`;
    }

    case "json": {
      const parsed = facts.json?.[trace.path];
      if (parsed === null || parsed === undefined) return `${trace.path} cannot be read`;
      const value = pointerValue(parsed, trace.pointer);
      if (value === undefined) return `no ${trace.pointer} in ${trace.path}`;
      return state === "done"
        ? `${trace.pointer}: ${short(value)}`
        : `${trace.pointer} is still ${short(value)}`;
    }

    case "dir": {
      const own = ownEntries(trace, facts);
      if (own === null) return `no ${trace.path}/ yet`;
      if (own.length === 0) return `${trace.path}/ holds only what shipped`;
      return `${own.length} of your own in ${trace.path}/: ${few(own)}`;
    }

    case "module":
      return state === "done"
        ? `the ${trace.id} module is installed`
        : `the ${trace.id} module is not installed`;

    case "placeholder": {
      const paths = placeholderPaths(trace);
      const present = placeholderFiles(trace, facts);
      // One path is named in full; a LIST is named by file name and its folder,
      // because four full paths is a line that pushes the whole column off the
      // screen and the folder is the same for all of them anyway.
      const one = paths.length === 1;
      const folder = `${paths[0].split("/").slice(0, -1).join("/")}/`;
      if (present.length === 0) return one ? `no ${paths[0]} yet` : `nothing written yet in ${folder}`;
      if (state === "done") {
        return one
          ? `${paths[0]} is your own now`
          : `${folder} ${present.length} written, none still the template`;
      }
      const marked = present.filter((file) => file.marked).map((file) => file.path.split("/").pop());
      return one
        ? `${paths[0]} is still the template`
        : `${folder} ${few(marked, 1)} still the template`;
    }

    case "note": {
      // 🚨 **It has to say WHICH of the two it found, in the user's own words.** The
      // defect this kind replaced printed "you said no" over a recorded yes, and it
      // survived because the sentence never quoted what it had read. Quoting the
      // line makes the direction visible in the output itself — a yes that was read
      // as a no would now print the yes beside the word.
      //
      // Never an `.env` value: this reads `docs/app.md` and nothing else, and the
      // only path a `note` row may name is its own.
      const value = noteValue(trace, facts);
      if (typeof facts.text?.[trace.path] !== "string") return `no ${trace.path} yet`;
      if (value === null) return `no ${trace.label} line in ${trace.path}`;
      if (!isAnswered(value)) return `${trace.label} in ${trace.path} is still unanswered`;
      // Wrapped by the renderer rather than clipped here: what the user decided is
      // a sentence they wrote, and half of it is worse than two lines of it.
      return `${trace.label} ${value}`;
    }

    case "ask":
    default:
      // The `why` is written into the row precisely because nothing on disk
      // answers it. Printing it is the honest column.
      return trace.why ?? "nothing on disk answers this";
  }
}

// ── The impure half ─────────────────────────────────────────────────────────

/** Never throws: a missing file is a fact, not an error. */
function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Never throws either. `null` is "no such directory". */
function readDir(path) {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch {
    return null;
  }
}

/**
 * Is this folder a module's parking spot rather than somebody's page?
 *
 * Next scans `app/` and nothing else, so a module's routes have to live there
 * physically as `page.<id>.tsx` — which is a route exactly while the module is
 * installed. The folder stays behind when it is not, and a folder full of
 * suffixed declarations is not a page anybody built.
 *
 * 🚨 **Asked of the folder, never listed.** A hard-coded `"community"` gave the
 * right answer for the wrong reason and only for the module somebody had thought
 * of; the next module to park a `/dashboard/…` area would have been announced to
 * the customer as a page they built and forgot to write down. A customer who
 * builds their own `app/dashboard/community/page.tsx` in an app WITHOUT the
 * module is still their own page, and gets counted.
 */
function isModuleParkingSpot(path) {
  const entries = readDir(path);
  if (!entries) return false;
  let suffixed = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (isModuleParkingSpot(join(path, entry.name))) suffixed++;
      continue;
    }
    if (/^(?:page|route|layout)\.tsx?$/.test(entry.name)) return false;
    if (/^(?:page|route|layout)\.[a-z0-9-]+\.tsx?$/.test(entry.name) && !entry.name.includes(".test."))
      suffixed++;
  }
  return suffixed > 0;
}

/**
 * Every file under a folder, as paths relative to it, `/`-separated.
 *
 * ⚠️ Joined with `"/"` and never with `path.join()`: the `beyond` list of a
 * `deep` row is written once, in this file, with forward slashes — deriving the
 * comparison from the platform separator would make the same row answer
 * differently on Windows, which is the class of fault `scripts/portability.test.ts`
 * exists for. Bounded rather than unbounded: the folders this is asked of hold a
 * handbook, and a depth cap is cheaper than a symlink loop in front of a session.
 */
function filesUnder(root, prefix = "", depth = 0) {
  if (depth > 4) return [];
  const found = [];
  for (const entry of readDir(join(root, ...(prefix ? prefix.split("/") : []))) ?? []) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...filesUnder(root, rel, depth + 1));
    else found.push(rel);
  }
  return found;
}

/** Source is read with its comments blanked; prose is read as it stands. */
const isSource = (path) => /\.(?:tsx?|mjs|js|jsx)$/.test(path);

/**
 * Every disk read the journey needs, as ONE object.
 *
 * **The only impure function here**, and the seam a later reader joins: a new
 * trace kind is one collector and one `case` in `traceState()`, and nothing
 * above it changes. Same contract as `operationalFacts()` in `./operations.mjs`.
 *
 * 🚨 **It never throws.** Every reader answers a state instead of raising, and
 * `installedModules()` — which refuses a malformed list on purpose, because
 * guessing "no modules" makes an app forget tables it still holds — is caught
 * here and answers `null`, which `traceState()` reads as *I could not look*
 * rather than as *not installed*.
 *
 * What it reads is derived from `JOURNEY` itself rather than from a list kept
 * beside it: a row that names a new file gets that file read the day it lands.
 *
 * @param {string} [root] the app root — only tests and other roots pass one.
 * @param {{ now?: number }} [options]
 */
export function journeyFacts(root = PROJECT_ROOT, { now = Date.now() } = {}) {
  const at = (path) => join(root, ...String(path).split("/"));

  const exists = {};
  const text = {};
  const json = {};
  const dirs = {};
  const env = {};

  const needText = (path) => {
    if (path in text) return;
    const raw = readText(at(path));
    // A checker that reads SOURCE as text goes through `blankComments()` and
    // never its own regex (CLAUDE.md → Rules). It matters here: `app/page.tsx`
    // explains its own placeholder marker in a comment, so a raw search finds
    // the marker in a page that was rewritten weeks ago.
    text[path] = raw === null ? null : isSource(path) ? blankComments(raw) : raw;
  };

  for (const row of JOURNEY) {
    const trace = row.trace ?? {};
    if (row.declined) needText(row.declined.file);

    switch (trace.kind) {
      case "file":
        exists[trace.path] = readText(at(trace.path)) !== null || readDir(at(trace.path)) !== null;
        break;
      case "routes":
        for (const path of trace.paths ?? []) {
          exists[path] = readDir(at(path)) !== null || readText(at(path)) !== null;
        }
        break;
      case "report":
        // Nothing per prefix to collect: the whole listing is read once below,
        // and picking the newest name out of it is `newestReportDate()`'s pure
        // job rather than a filter applied while the disk is open.
        break;
      case "env":
        for (const key of trace.keys ?? []) {
          // The `.env` first — that is where every one of these values lives on
          // a developer's machine — then the real environment, which is where
          // they live on a host that keeps its secrets in its own store.
          env[key] = readEnvValue(at(".env"), key) || process.env[key] || "";
        }
        break;
      case "json": {
        const raw = readText(at(trace.path));
        try {
          json[trace.path] = raw === null ? null : JSON.parse(raw);
        } catch {
          // Unparseable is the same answer as absent for this file's purposes:
          // no config here says yes.
          json[trace.path] = null;
        }
        break;
      }
      case "dir": {
        const entries = readDir(at(trace.path));
        if (entries === null) {
          dirs[trace.path] = null;
        } else if (trace.deep) {
          // FILES, relative to the folder and always with `/` — the `beyond` list
          // is written that way once and must not read differently on Windows.
          // No parking-spot question: a `deep` row asks about content somebody
          // WROTE, and nothing about a module's routes lands in one.
          dirs[trace.path] = { entries: filesUnder(at(trace.path)), moduleOwned: [] };
        } else {
          dirs[trace.path] = {
            entries: entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
            moduleOwned: entries
              .filter(
                (entry) =>
                  entry.isDirectory() && isModuleParkingSpot(join(at(trace.path), entry.name)),
              )
              .map((entry) => entry.name),
          };
        }
        break;
      }
      case "placeholder":
        for (const path of placeholderPaths(trace)) needText(path);
        break;
      case "note":
        // No new disk read in practice: `docs/app.md` is what every `note` row and
        // every `declined` marker names, and `needText()` reads a path once.
        needText(trace.path);
        break;
      default:
        // `module` needs the list below, `ask` needs nothing at all.
        break;
    }
  }

  // The reports directory is absent in a fresh app, and that is the ordinary
  // state rather than an error: every gateway creates it the first time it has
  // something to write.
  const reportNames = (readDir(at("docs/reports")) ?? [])
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  let version = null;
  try {
    version = JSON.parse(readFileSync(at("package.json"), "utf8")).version ?? null;
  } catch {
    /* then no row is refused for needing newer code — see stateOf() rung 1 */
  }

  let modules = null;
  try {
    modules = installedModules(root);
  } catch {
    /* a refused list is "I could not look", never "no modules" */
  }

  return { now, version, exists, text, json, dirs, env, reportNames, modules };
}
