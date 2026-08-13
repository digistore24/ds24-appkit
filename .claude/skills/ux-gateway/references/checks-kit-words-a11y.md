<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

## 5 · `kit` — the design system

**If the app has `docs/design.md`, read it first.** That file is the look this
app chose — the four dials it turned (accent, radius, type and **elevation**,
the last one written as `flat` or `lifted`), the type pairing **including its
heading family**, page composition, the signature element — and this check
audits **against it**: a page that ignores the composition its own file names, a
hand-picked colour beside the chosen tokens, a heading face nothing in that file
names, a depth on a card the elevation line did not ask for, a second look
growing beside the first. It is a baseline, never a restyling licence — what
to change about the look is the skill `design`, not this gateway. An app
without the file is on the shipped default, which is a decision (see *What
counts as a finding* in `SKILL.md`).

⚠️ **Two of those lines are absent on purpose when the app kept the default,
and absence is an ANSWER here rather than a gap.** No elevation line means
`flat` and no heading line means the shipped Source Serif 4 — the file's own
bracket says everything unlisted keeps the shipped value. Reading a missing line
as "nobody decided" produces a finding about a decision that was made.

Mostly measured. Run `node run.mjs ux-check` and fold the findings in; then look
at the two things it cannot see.

`ux-check` settles: hard-coded palette colours, **a value written past a dial**
(an arbitrary `font-[…]` or `shadow-[…]`, a bare `shadow-lg`, a hex inside an
arbitrary value, the generated `font-heading` class, a shadow naming any custom
property other than the two elevation roles — each hit names the dial it
bypasses), raw `<button>`/`<input>`/`<select>`/`<textarea>`/`<table>` (a place you have
judged and want kept goes on `RAW_ELEMENT_EXCEPTIONS` in `scripts/ux/rules.mjs`
with its reason, and is then COUNTED in the green line rather than dropped —
needs template 0.27.0), pages
under `/dashboard` that nothing leads to — no menu entry and no link, which
since template 0.27.0 includes `[param]` pages — every token pair's contrast in **both**
modes, and **every token being defined in both blocks** rather than one. Each
comes with a file and a line, so each goes straight into the report. Its
**images with no `alt`** are check 8's — see there.

Both of the two token/dial findings are failures, not warnings: a value written
past a dial is the boundary `docs/design-system.md` §8 declares closed, and a
token in one block only breaks in whichever mode nobody was looking at. And each
green line names what it counted, so *nothing found* never reads like *nothing
looked at*.

What you still have to look at yourself:

- **Dark mode, by eye.** Tokens make it work; a `<div>` with a hand-picked
  shadow or an image with a white background still falls over. Switch the theme
  and look at every page you opened.
- **Small screens.** Resize to ~380 px. Tables that do not scroll, dialogs whose
  submit button sits under the keyboard, fixed widths that scroll the whole
  page — `docs/ux.md` §6. Roughly half of Digistore24's traffic is a phone, so
  this is not an edge case.

## 6 · `words` — is it written for the customer

- **Is anything visible not in both message files?** `i18n/messages.test.ts`
  catches a missing key, not a German sentence sitting in a `.tsx`. Grep for
  string literals in JSX.
- **Does any error reach a person as a code?** `lib/` returns codes and the
  Server Action translates them. A page rendering `selfDelete` is ❌ HIGH.
- **Is any identifier on a customer-facing page?** Order ids, member ids and
  product keys belong in support tools.
- **Does every empty state say something?** A heading and a blank space is not
  an empty state.
- **Read the five most important sentences out loud** — the plan names, the
  purchase confirmation, the two most common errors, the destructive dialog. If
  a sentence describes the database rather than the customer's situation,
  rewrite it.

## 7 · `access` — usable without a mouse

The legal position is one paragraph in `docs/ux.md` §5 and it decides how hard
to push: most operators here are micro-enterprises and exempt from the BFSG
today, in scope the year they grow. Report findings either way; let the severity
follow the app, not the statute.

Measured by `ux-check`: contrast in both modes, the focus ring at 3:1, icon
buttons with no name.

**Where the app carries interactive elements** (`ACTIVITIES` in
`modules/activity/activities.ts` — a game, a check, a graded exercise), this
check gets a second half that no command measures: **play every element with
the keyboard alone, to the final verdict.** A drag without a key path is the
naive way to build a game and a BFSG defect in a consumer product; a time
limit without an alternative is a wall. The verdict must reach a screen
reader (the panel announces through its live region — verify it does, and
that the game announces its own state through `announce()`). ❌ HIGH where
stuck: unlike a contrast ratio, there is no partial credit on "cannot finish
the exam without a mouse". The build-side rules are the five in the panel
header (`modules/activity/components/activity-panel.tsx`); the deeper audit is the skill
`learning-activities`, item `check`.

`ux-check` also measures **images with no `alt`** — but file that finding under
check 8 with the rest of what goes wrong with pictures. One fix should not
produce two findings in one report.

By hand, and every one of these is a real failure rather than a nicety:

- **Tab through one whole page.** Can you reach every control, and can you
  always see where you are? A focus ring that is invisible on one surface is
  ❌ HIGH — it is the only thing a keyboard user has.
- **Open a dialog with the keyboard, close it with `Esc`.** The kit does this;
  a hand-built overlay does not.
- **Is anything said with colour alone?** A red dot means nothing to a
  colour-blind customer and nothing at all to a screen reader.
- **Do the headings step down** (`h1` → `h2` → `h3`) rather than being picked
  for size? `<PageHeader>` gives you the `h1`.
- **Does every form field have a real `<Label htmlFor>`?** A placeholder is not
  a label — it disappears exactly when somebody needs it.
