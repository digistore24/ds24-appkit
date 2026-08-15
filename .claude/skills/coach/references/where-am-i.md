<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# "Where am I?" — the part no command can read

Part of the skill `coach`. **`node run.mjs journey --json` answers where the
project stands**; this file is what it cannot answer. Read it when the journey's
answer needs weighing — never instead of running the command, and never as a
second walk through the tree.

**The user does not always know where they are; the project does.** Almost every
step leaves a trace on disk, and the journey reads it — one row per step, with an
`evidence` phrase saying what it looked at. "Where did you get to?" is a question
the coach should rarely have to ask.

What is left over is judgement, and it is always one of four shapes: a file that
exists and is **thin**, a value that is present and still the **shipped** one, a
date measured against **another date**, and a fork that needs **one question**
before anybody is routed.

**And a recorded "no" is an answer.** The journey renders it as `declined`, with
the date where the skill that recorded it wrote one — so it is never re-proposed
and never hidden either: a refusal nobody can see is a refusal nobody can revoke.
Re-proposing the thing the vendor turned down in session one is how a coach
becomes something people skip.

## A file that exists and is thin

- **Is the brief THIN?** The `market-research` row reads `done` the moment
  `docs/product-brief.md` exists, and presence is all a file predicate can ask
  — the minimal brief `build-app` step 0 writes counts, with or without the
  research labels. What no predicate can ask is whether the user can say **in two
  sentences** what the app does. If they cannot, the step is `market-research`
  whatever the row says.
- **Is the assistant's handbook thin?** `content/knowledge/` ships five example
  files, so the `ai-chat-knowledge` row counts files BEYOND them — which means a
  handbook written by rewriting those five in place reads `open`, and a handbook
  of five thin files reads `done`. `node run.mjs kb-check` is the question about
  quality; no file predicate is.
- **Is `docs/app.md` behind the app?** Pages under `app/dashboard/` that it does
  not mention mean the last session did not write its entry — add it before
  building anything new (`build-app` step 4b holds the shape). The session
  greeting names anything of the app's own it does not find in there; the journey
  does not ask this at all.

## A value that is present and still the shipped one

- **`billingMode` still `"both"`.** The journey reads
  `config/digistore-products.json` and reports `open` while the value is the
  shipped `"both"`. What it cannot know is whether this app really sells both:
  where it does, `"both"` is the answer and the row is finished. Where it sells
  one of them, `build-app` (step 1) sets it, and the models themselves are
  **`billing-modes`**.
- **A placeholder home page with SWAPPED TEXTS.** The `salespage` row asks
  whether `app/page.tsx` still carries the shipped marker `features.authTitle`.
  A page that kept the placeholder's **structure** and swapped its texts has no
  marker left and reads `done` — and it is still the template selling the
  template, a spec sheet wearing marketing copy. Look at the page: an outcome
  headline, a real visual rather than three icons, ONE offer block with a working
  checkout. If it is the old shape retexted → **`salespage`**.
- **Payment: one row, three different failures.** The row asks for all three of
  `DIGISTORE_API_KEY`, `DIGISTORE_IPN_PASSPHRASE` and
  `DIGISTORE_IPN_DOMAIN_ID`, so it cannot say which is missing. A key but no ids
  on the products in `config/digistore-products.json` → the sync never ran, **or
  it ran and stopped at its own gate**: it refuses to CREATE anything until the
  run is repeated with `--create-new`, so "no ids" is as often an unanswered
  question as a forgotten command. ⚠️ An entry parked with `"sell": false`
  carries no ids by design and is not a finding at all. No passphrase → no IPN,
  so purchases arrive nowhere; both → **`setup-digistore`**.
  A product id for only *some* of the app's languages → the missing ones get an
  order form in the wrong language: re-run `node run.mjs ds24-sync`, read the
  list of what it would create and its warnings, then confirm with
  `--create-new`. Ids only under `dev` on an app about to launch → the PROD set does
  not exist yet → **`go-live`**.
- **Are the legal TEXTS written?** `node run.mjs legal-check` answers this, and
  it is the answer to quote. The routes `app/impressum` and `app/datenschutz`
  prove nothing — they ship — and so does the presence of `content/legal/*.md`;
  what is unwritten is the text, marked `<!-- ds24-appkit:placeholder -->` in
  those files. The journey reads that same marker, and `app/agb` / `app/widerruf`
  depend on the seller role → **`compliance-check`**.

## A date measured against another date

The four dated reports — `docs/reports/ux-*.md`, `security-*.md`,
`performance-*.md`, `operations-*.md` — have their date in the file **name**, and
that is all the journey reads: it never opens one, deliberately, so a customer's
own prose never runs in front of a session. Only the operating round carries a
clock (30 days, then `stale`). Everything else is yours to weigh:

- **A report older than the last big change is worth as much as none.** Compare
  its date against `git log -1 --format=%cd`. Older → **`security-gateway`**
  check `since` (§10), the recurring pass that reads only what changed and costs
  minutes rather than half an hour, which is the reason it happens at all; before
  a launch it is `all` again. The same comparison sends **`ux-gateway`** and
  **`performance-gateway`** round a second time, and **`operate`** is the one
  step that keeps coming back.
- 🚨 **An open CRITICAL or HIGH in the newest security report is the next step,
  whatever else says otherwise** — including the journey's own `next`. Read the
  newest `docs/reports/security-*.md`: it says which checks ran, what was found
  and what is still open. And where there is no report at all, that is the
  answer rather than a blank: the gateway has not run, and a diff against
  nothing is not a review (`security-gateway`, check `all`). A second scan on an
  app that has not changed costs a few minutes; a skipped one costs a live app
  with a hole in it.
- **`go-to-market` still writes nothing that proves it ran.** The journey says
  `unknown` with exactly that as its reason, and `unknown` is not `done` — do not
  infer it, ask, in one sentence.

## Three forks that need one question first

Each of these is a line somebody wrote, in one of two files, with no fixed place
for it — which is why the journey answers `unknown` and names the two places
rather than guessing. **A recorded answer is an answer**: say so and move on.

- **What the customer HOLDS.** An `Output artifact:` line in
  `docs/product-brief.md`; failing that, the decisions section of `docs/app.md`.
  Neither says anything and the app's pages hand out text → **`visuals`** (check
  `plan`). A brief that says "generates the copy" where the customer wanted a
  finished page is the commonest reason an app feels thin.
- **What the app DOES alongside them.** An `Alongside the customer:` line in the
  brief; failing that, the decisions section of `docs/app.md`. Neither says
  anything and the app's surfaces only store what the customer typed →
  **`build-app`** (step 1c) while the app is being built, or **`ai-companion`**
  (item `decide`) for one that already exists. That is the fork: the two are the
  same decision at two moments, and the journey's row asks only whether the
  `companion` module is installed.
- **Who authors the content.** A `Content authority:` line in `docs/app.md`;
  failing that, the decisions section there. No line, and the app carries content
  tables plus an admin CRUD only the operator ever edits → the fork in
  `docs/content-authority.md` was never decided. For a LIVE app, moving content
  into code is a migration — plan it, do not just delete tables. No journey row
  covers this one at all.

## Two rows that are neither a file nor a judgement

- **Does the machine work?** The session-start line `[Setup: ok]` /
  `[Setup: blocked — …]`, otherwise `node run.mjs doctor`. Blocked →
  **`setup-machine`**, before anything else. It is computed live rather than
  written down, which is why the journey's own row says "ask the greeting".
- **Is there a host at all?** `node run.mjs doctor --deploy` — is a hosting CLI
  installed and logged in? Nothing there and the app is meant to go online →
  **`setup-hosting`**.
