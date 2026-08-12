---
name: design
description: Gives this app a look of its own — either FROM THE USER'S OWN BRAND (a logo file, a CSS file, their website, a hex code) or, when there is none yet, from a mood and two or three references. It owns the four dials — accent, corner radius, type, elevation — plus the header logo and the app icons. Use this when the user says "hier ist mein Logo", "übernimm mein Branding", "das sind meine Farben", "use my brand colours", "make it match my website", "here is our style guide", "it looks generic", "it looks like every other app", "give it its own look", "I want a custom design", "change the colours", "change the font", or when build-app step 1e hands over.
requires: 0.25.0
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# A look of its own

Every app built on this template ships the same way: warm grey, petrol accent,
Figtree with Source Serif 4 headings, quiet shadows, a letter tile where a logo
should be. That is a deliberate default, not a defect — and it is also why two
apps built by two strangers look like the same product. This skill is the one
place that changes it.

**What "design" means here is narrow on purpose.** The kit stays the kit
(`CLAUDE.md` § **UI**: *there is nothing to design here — there is something to
use*). This skill turns the **four dials** the kit already has slots for —
**accent**, **radius**, **type** and **elevation** — plus the mark and the way
pages are composed from the existing components, and writes them down so every
later page follows them. **The list of four is closed**
([`docs/design-system.md`](../../../docs/design-system.md) §8): this skill never
builds a component, never writes a hex class, never opens a fifth slot and never
adds a fourth feedback mechanism.

**The decision is the user's, never yours** (`docs/guidance.md` → *How a skill works*).
You propose; they pick, decline, or say "you choose".

## Step 0 — Is there already a look, and which way in?

Three things to check before anything else. Any of them can answer the whole
question:

- **`docs/design.md` exists** → this app already chose. Read it, say what it
  holds in two sentences, and ask what should change. A change is edited
  **there first**, then applied — the file is the app's visual identity, and a
  page restyled past it is how the identity stops being one.
- **`docs/app.md` records a "no"** (*No custom identity* under the decisions)
  → that is an answer. Say you found it and ask in ONE sentence whether it
  still holds. If yes, stop.
- **An experiment** ("just show me", a test app) → skip the whole skill, same
  boundary as everywhere else.

Only if none of those answered it, there is a number to take — or a menu to ask.

**Coming from `build-app` step 1e, the number is already there.** That step asks
this menu itself and hands the answer over; which branch each row lands on is the
table in [`references/menu.md`](references/menu.md). Take the number and go.
Asking again is the second question the handover exists to remove, and a user
made to answer the same menu twice stops believing the first answer counted.

**Entered on its own** — `coach` routes *"it looks generic"* here, and somebody
may simply have said "change the colours" — ask it yourself. **The menu lives in
[`references/menu.md`](references/menu.md): read it and present it as it
stands**, with the three answers it may come back with. That file is its only
home, which is why this step and `build-app` step 1e cannot drift apart.

**A `0` answered here never reaches Step 2**, so record it here: the shipped look
stays, and the entry goes into `docs/app.md` exactly as
[`references/menu.md`](references/menu.md) → *The recorded no* writes it. It is
an answer, and it is not negotiated.

**Branch C — one narrow thing.** *"Make it green", "a serif headline"* — that is
the whole request, and it is not Step 1A with a missing file. Do the matching
slice of Step 3 and nothing besides: no references, no package menu, no second
round. Then update or create `docs/design.md` with just that decision, so the
next page follows it. **Branch C does not pass through Step 2** — there is
nothing to propose to somebody who has already named it.

## Step 1A — Their own brand

**Read [`references/own-brand.md`](references/own-brand.md) before this step.**
It carries the input table in full, where to look inside a stylesheet and in
what order, the three refusals, and the exact shape the result is put back to
the user in.

The short version: ask what they have, read a stylesheet YOURSELF before running
anything (a person knows which of two blues is the brand), then let the command
do the arithmetic:

```bash
node run.mjs brand colors --css brand.css        # or --url https://… or --hex "#1F6F4A"
node run.mjs brand icons  --logo path/to/logo.svg
```

Both are dry runs; `--apply` writes. The colour is contrast-checked in **both**
modes before anything is written — their hue is never changed, the lightness
moves only as far as readability needs, and the command prints by how much and
why. **Repeat that to them in words**, including when the move was large: it
says so itself, and a large move honestly named is what makes the small ones
believable.

Then Step 2.

## Step 1B — No brand yet: ground it

A look that fits comes from the product, not from a palette generator. Two
sources, in this order:

1. **Ask the user for 1–3 apps or sites they admire** — or that their
   customers already use. Most vendors here are not designers and may have
   none; then name 2–3 well-known products from the app's own category
   yourself (`docs/app.md` → *The product* says what that category is) and say
   why you picked them.
2. **Look at how those present themselves — a mood check, not a competitive
   audit.** Hard budget: **two or three web searches, no more.** What you take
   from them, and all you take:

   | Take | Never take |
   |---|---|
   | the mood, in 2–4 words ("calm, clinical", "loud, playful") | exact hex codes |
   | the layout pattern per page type — card grid, table, hero-result | their fonts (licensed, and theirs) |
   | density — spacious or compact | copy, wording, taglines |
   | ONE signature-element idea (a numbered ritual, a big result figure) | screenshots or assets into the project |

⚠️ **That table is about products the user ADMIRES.** It is not about their OWN
brand: there, taking the exact hex code and the actual logo file is the entire
point, and that is Step 1A above. Applying this table to somebody's own company
is the mistake it is written here to prevent.

No web search in this program? Say "judged from training data, not looked up"
and carry on — the menu below works either way
(`CLAUDE.md` → *What the skills assume you can do*).

## Step 2 — Propose, then wait

**Branch A:** there is nothing to invent. Put the derived package to them in the
shape `references/own-brand.md` prescribes — their original quoted back, every
adjustment named with its number and its reason — and wait for one sentence.
One round, then work.

**Branch B:** put **two or three named identity packages** to the user as a
numbered menu. Each row is one coherent direction and fills **all four dials**:
an accent hue, a radius, a type pairing from
[`references/tokens.md`](references/tokens.md), and that pairing's elevation as
**one word** — `flat` or `lifted` — plus the mood it serves. Derived from
Step 1B, not invented fresh. Mark ONE row ✅:

```
This app can keep the kit's default look, or take one of its own.
None of these costs anything to run — it is about fifteen minutes of work.

  1  "Klinik"   — deep teal accent, Inter + Source Serif 4, sharper corners,
                  flat. Calm and clinical, like the two references you named ✅
  2  "Werkbank" — amber accent, IBM Plex Sans, the shipped radius, lifted.
                  Tool-like, dense, numbers first
  3  keep Figtree, recolour only — one colour on the shipped type, flat

  0  keep the shipped look (petrol on warm grey, Figtree)

Give me a number, or say "you choose" and I take the one marked ✅.
```

🚨 **The elevation is that one word and nothing more.** It rides inside the row
it belongs to, and there is **no second menu, prompt or step about shadows** —
opening one turns this skill into the design conversation that rule 4 and the
"do not negotiate" paragraph below both exist to prevent. `flat` is what ships,
so a row that says nothing has said `flat`.

Three answers, all valid:

- **A number** → exactly that package, Step 3.
- **"you choose"** → the ✅ row, no further question.
- **`0`** → nothing changes, and it is **written into `docs/app.md`** under
  *Decisions worth remembering*. The verbatim entry is in
  [`references/menu.md`](references/menu.md) → *The recorded no*, beside the
  menu it answers — one owner, so the two places that record it cannot drift.
  🚨 The words `No custom identity` are the marker Step 0 and `build-app` step
  1e read back: keep them exactly.

**Do not negotiate a `0`**, and do not open a second round of options after a
number — a design conversation that keeps going is the failure mode of this
skill. One menu, one answer, then work.

## Step 3 — Write it down, then apply it

**The file comes first.** Create `docs/design.md` — this app's visual identity,
the file every later page follows. Its shape is
[`references/design-md-template.md`](references/design-md-template.md).

Then apply it:

1. **Tokens:** `--primary`, `--primary-foreground`, `--ring` (and `--radius`
   if chosen) in **both** blocks of `app/globals.css` — `:root` and `.dark`.
   Branch A: `node run.mjs brand colors … --apply` did this. Branch B: by hand,
   or `--hex` with the colour you agreed.
   The exact edits are [`references/tokens.md`](references/tokens.md).
2. **Type:** the wiring in that same file, if the pairing changed — the package
   is installed first, and `next/font/local` points at a file inside it.
3. **Elevation:** `--elevation-raised` and `--elevation-overlay`, in **both**
   blocks, and only when the chosen row says `lifted`. The two value sets are
   the *The elevation* section of
   [`references/tokens.md`](references/tokens.md) — copy them from there rather
   than inventing a shadow, and never write one as a class on a page.
4. **Measure:** `node run.mjs ux-check` — **it must be green.** `--primary` is
   a surface AND a text colour, and the mode you were not looking at is the
   one that breaks. A red pair is fixed by adjusting lightness, never by
   accepting the finding.

## Step 4 — The mark and the icons

**This is work, not a parting remark.** An app wearing somebody's colours and
the template's placeholder icon is a rebrand people notice as unfinished.

- **Branch A:** `node run.mjs brand icons --logo <file> --apply` renders all
  five icon files, copies the mark to `public/brand/` and fills in
  `config/brand.json`. Then look at the sidebar and at `/login`.
- **Branch B:** there is no logo, so the letter tile stays — and it now carries
  the chosen look by itself. Say once that a real mark is one command away when
  they have one, and move on.
- **Dark mode is a question, not an assumption.** A dark wordmark disappears on
  the dark background. Ask for a second file; if there is none, say plainly that
  the mark reads in light mode only and offer the letter tile as the honest
  fallback rather than shipping an invisible logo.
- **Then look at the icons.** The maskable one is a separate picture with ~20 %
  padding, and 192 + 512 must both exist or Chrome refuses to install the app
  while saying nothing useful. The file table with the exact sizes is
  [`docs/design-system.md`](../../../docs/design-system.md).

## Step 5 — Look at it

A recolour that was never seen is a guess. The shipped pages make this cheap —
`/`, `/plans`, `/login` and the dashboard carry the tokens and the type from
minute one:

```bash
node run.mjs start
```

Open `/`, `/login` and the dashboard. **Both themes, and once at ~380 px.**
`/login` is where the mark is largest and it is the page a customer meets before
anything else. If a browser tool is available, use it; if not, `ux-gateway`
explains how to offer the Playwright MCP server — or ask the user to open the
page and say in one line whether it is what they picked. Then
`node run.mjs errors`.

One confirmation sentence from the user closes the step. If they want it
adjusted, adjust `docs/design.md` first, then the tokens — same order as always.

## The rules

1. **The file is the identity.** A later page follows `docs/design.md`; a
   change goes into `docs/design.md` first. Two looks in one app is worse than
   the default look.
2. **Tokens only, kit only.** No hex classes, no new components, no second
   feedback mechanism, nothing that overrides `CLAUDE.md` § UI or
   `docs/ux.md`. `ux-check` green is the floor, in both modes.
3. **A "no" is an answer** and goes into `docs/app.md` with the date — same as
   every other declined menu in this template.
4. **The budgets are hard.** Two or three searches, one menu, one signature
   element. This skill is fifteen minutes, not an afternoon.
5. **The mark and the icons are this skill's work** (Step 4), not something to
   name and leave. Five icon files, one picture, replaced together — the one
   people forget is the home-screen icon, and it is the one their customers
   look at every day.

## What comes next

- Inside `build-app` (step 1e) → hand back to **`build-app` step 2** (the data
  model). The pages built from step 3 onward follow `docs/design.md`.
- Standalone, on an app that already has pages → offer **`ux-gateway`**
  (check `kit`): it audits the pages against `docs/design.md` as the baseline,
  and it is the pass that catches a page the recolour left behind.
- If `/` is still the shipped placeholder, say so once: a recoloured
  placeholder is still a placeholder — building the page that sells is the
  skill **`salespage`**, and it follows `docs/design.md` from its first line.
