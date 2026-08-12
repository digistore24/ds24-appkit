<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The app's own content — who authors it, how it reaches PROD, how it is found

_Read from `build-app`, step 2 (before the first content table) and step 3 (when
a page renders that content). The rules stay in the skill itself — decide the
authorship before `db-generate`, never only INSERT content into the local
database, reference media by path and never by media id, and put the access
check in ONE function. What follows is what each of them means._

## Step 2 — who authors the content

- **Before the first content table, settle who authors the content** — when the
  developer IS the author, the content lives in code, not in tables, and gets
  no admin UI; only customer STATE gets tables. The fork is
  [`docs/content-authority.md`](../../../../docs/content-authority.md) — decide it
  before `db-generate`, and record the answer in `docs/app.md` (the coach
  reads it back as the `Content authority:` line).

## Step 2 — how that content reaches PROD

- **And settle, in the same breath, how that content reaches PROD** — because
  the answer is never "by itself": each environment has its own database and
  its own media store, and a deploy carries the repo and nothing else. Content
  in code travels with every deploy; content in tables is written as content
  files plus an idempotent applier (`scripts/content/appliers/`, upsert by
  slug) from the FIRST table on — **never only INSERTed into the local
  database**, which is how a finished course goes live with empty pages while
  every local gate stays green. Product media are declared in
  `content/media-manifest.json` and referenced **by path, never by media id**
  (an id exists in one database only). The transport rules and the applier
  convention are [`docs/content.md`](../../../../docs/content.md); the go-live
  The proof is `node run.mjs content-check --env prod`; an empty page is a
  clean 200, so nothing else will tell you.

## Step 3 — the anchors a page gives its blocks

- **A page that renders the app's CONTENT (a lesson, an article) gives its
  blocks and media stable anchors from day one** — `id={slugifyAnchor(slug)}`
  / `id={mediaAnchor(path)}` from `lib/content-source/anchors.ts`, plus
  `scroll-mt-20`. It costs one attribute now; it is what lets the AI chat
  deep-link straight to the passage later
  ([`docs/content-source.md`](../../../../docs/content-source.md)).

## Step 3 — the ONE access function

- **And if that content is ever going to be searchable by the assistant, put
  its access check in ONE function from the start** — `mayReadUnit(memberId,
  slug)` in `lib/<area>/rules.ts`, called by the page now and by the content
  source later. On template 0.18.0 and newer she can also LINK to a page she
  looked up, so a source that is more permissive than its page would tell a
  non-buyer that "Lektion 7" exists and hand them a link that bounces them
  back — and on any version it tells them the lesson exists. Splitting the check into two
  `hasPlan()` calls that agree today is how that happens; there is no test that
  catches it, because both halves live in your app. The full checklist is
  [`docs/content-source.md`](../../../../docs/content-source.md) → *The five
  things that make a link work*.
