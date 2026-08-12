<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

## 8 · `visuals` — is there anything to look at?

**What this check is for.** An app can pass every check above and still hand its
customers paragraphs. That is not an accessibility failure or a wording failure;
it is the product being one step short of what somebody paid for. This check
finds it in an app that already exists — `build-app` step 1b is where it is
decided for one that does not.

**Read `docs/app.md` FIRST, and read it properly.** Its *Decisions worth
remembering* section may already say "no pictures in the messages, deliberately,
because …". If it does, that is not a finding — it is an answer, and reporting
it anyway is how this gateway teaches people to stop writing decisions down.
Say you found it, and move on.

Then walk the app's **result surfaces**: the places where a customer is handed
something. Not every page — a settings form is a settings form.

*(This check audits against [`docs/visuals.md`](../../../../docs/visuals.md) rather
than `docs/ux.md`, which has nothing to say about pictures. And `Figure`,
`generateImage()` and the catalogue all arrived with template 0.7.0 — on an
older copy the rows that name them never fire, and the rest applies unchanged.)*

| Severity | What | Why |
|---|---|---|
| ⚠️ MEDIUM | A result surface whose whole output is prose, and nothing in `docs/app.md` says that was chosen | The fix is a catalogue entry, named — see below |
| ❌ HIGH | An image with no alternative text and no `decorative` | A screen reader reads the filename instead |
| ⚠️ MEDIUM | An image that carries its own light background, seen in dark mode | Switch the theme and look; nobody does this while building |
| ⚠️ MEDIUM | An image not going through `next/image` | A phone downloading four megabytes to show two hundred pixels, on somebody else's data plan. Note it here and leave the number to `performance-gateway`, which measures what it costs — one fix, one finding |
| ⚠️ MEDIUM | An image that scrolls — a picture inside an `overflow-auto` container | A too-big picture is scaled to the container's width (`w-full h-auto`, crop with `overflow-hidden`), never panned. Sideways scrolling is for tables (`docs/ux.md` → *Small screens*) |
| ⚠️ MEDIUM | A diagram identical for every customer — a flow chart of the app's own process, boxes and arrows beside a form | Decoration wearing a chart's clothes (`docs/visuals.md` → *What NOT to do*). Remove it, or replace it with the customer's own data; at most one survives, and only where somebody must understand a sequence before they act |
| 🚨 CRITICAL | An `<iframe>` at a video host with no consent gate in front of it | It contacts Google or Vimeo before the visitor agreed to anything — § 25 TDDDG. `compliance-check` reports the same thing from the legal side |
| ❌ HIGH | A generated image with an empty `alt` | It should be impossible — `generateImage()` requires one, so somebody has written a row by hand |

**The fix names the entry, not the problem.** "Add an image" is not a finding
anybody can act on. [`docs/visuals.md`](../../../../docs/visuals.md) has a row per
app shape — *a chart above the table*, *a result card instead of a number*, *the
message with a picture* — and the fix quotes the one that applies:

```
⚠️ MEDIUM — the monthly report is a table and nothing else
Where:    /dashboard/reports
Why:      a customer opening it monthly cannot see at a glance whether the
          month was good. The numbers answer "what exactly"; nothing answers
          "how is it going".
Fix:      docs/visuals.md → *What to build instead of a wall of text*, the row
          "a report as a table" → a bar chart above it. The table stays.
Evidence: page renders 1 heading, 1 table, 0 images or charts.
```

Some of it is countable — `grep -rn "<img" app components` for pictures outside
`Figure`, `grep -rn "youtube.com\|player.vimeo.com" app components` for the
embed, `grep -rn "overflow-auto\|overflow-x-auto" app components` and then
looking at what sits inside each hit (a table is right, an image is the
finding) — and the rest is opening the pages and looking, in both themes.

**Where this check does NOT go:** decoration. A stock photograph on a settings
page is not a finding fixed — `docs/visuals.md` says why, under the catalogue.

## 9 · `alongside` — does anything come back?

**What this check is for.** An app can pass every check above and still hand its
customers a form. Check 8 asks whether there is anything to look at; this one
asks whether anything comes **back**. The case it was written from: a customer
writes three paragraphs about their day into a paid challenge, and the app
replies *"saved"*. Nothing reads it, nothing returns tomorrow, and the
subscription is paying for a text box. This check finds it in an app that
already exists — `build-app` step 1c is where it is decided for one that does
not.

**Two commands first**, and neither needs a browser. Their findings are already
measured, so they go straight into the report with a command as evidence:

```bash
node run.mjs legal-check    # a companion switched on and undisclosed
node run.mjs ai-check       # a key configured, the layer called from nowhere but support
```

`legal-check` settles the disclosure — which surface, which language, and what is
missing. `ai-check` settles the whole-app observation at the bottom of the table.

**Read `docs/app.md` FIRST, and read it properly.** Its *Decisions worth
remembering* section may already say "no AI companion, deliberately, because …".
If it does, that is not a finding — it is an answer, and reporting it anyway is
how this gateway teaches people to stop writing decisions down. Say you found it,
and move on. `docs/product-brief.md` is the second place to look and the first in
time: an `Alongside the customer:` line there says what was decided when the
product was worked out.

**That silence is per SURFACE, never per app.** A "no" recorded against a
companion on the daily message says nothing about a submission page built three
sessions later — read the entry for what it actually decided. Taken as a
blanket, the first recorded "no" switches this check off for ever.

**And it silences ONE row — the ⚠️ MEDIUM one below, and nothing else.** A
decision not to build a companion says nothing about one that WAS built: if a
companion exists and the customer is not told, or it is given away ungated and
unmetered, those stay findings no matter what `docs/app.md` says. This is the
reading that gets got wrong, so it is written out rather than implied.

Then walk the app's **work surfaces**: the places where a customer hands
something over — a submission, an answer, a photo, a plan. **Not every form.** A
settings page, an address, a payment method, a support message: the customer is
not handing over their *work* there, and a confirmation is the right answer.

*(`askCompanion()`, `<CompanionPanel>`, `config/ai-companion.json` and the
catalogue all arrived with template **0.8.0** — on an older copy the three rows
that name them never fire, and the work-surface row applies unchanged, back to
0.4.0. That row is also the one that matters most on an old app: it needs no
companion code at all, only a page and a `docs/app.md`. Which is why the
`requires:` on this skill stays at 0.4.0 — bumping it would withhold all nine
other checks from an app on 0.6.0 over one row it could not use anyway, and
withhold precisely the row it could.)*

| | Severity | What |
|---|---|---|
| ❌ | **HIGH** | A companion is switched on and the customer is not told a model reads what they write. `node run.mjs legal-check` names it and names the fix. **The most severe finding this check raises** |
| ❌ | **HIGH** | A companion whose registry entry has `requiresPlan: null` **and** `costsTokens: 0` — every signed-in visitor spends the vendor's money on it, once per use, for ever |
| ⚠️ | **MEDIUM** | A surface takes a customer's work and returns nothing but a confirmation, and nothing in `docs/app.md` says that was chosen |
| ℹ️ | **LOW** | A provider key is configured and nothing outside the support chat calls the AI layer. `ai-check` prints it under *Worth knowing* — a whole-app observation, **one line, once**, and it does not fire on an app with no key |

**The disclosure row is quoted, never re-derived.** The fix is
`<AiDisclosure surface="companion" />` on the page the customer writes into, plus
*"`node run.mjs legal-check` says which surface and which language"* — and
nothing about the message key or the wording rule. One copy of that rule exists,
in `lib/ai/disclosure.mjs`, precisely because it had been written twice; a third
copy in a skill would be the same mistake in prose. It is ❌ HIGH and not
🚨 CRITICAL deliberately: `compliance-check` owns Art. 50 and its own ladder puts
an undisclosed AI at HIGH, and two reports of the same week contradicting each
other is worse than one being a notch low.

**The gating row's evidence is a file and a line** — the two fields in the
entry, read out of `modules/companion/companions.ts`. A companion gated by a **token
package** is a different thing and not this check's: `companionProblems()`
already refuses that config, because `hasPlan()` answers `false` for a balance
for ever.

**The fix names the entry, not the problem.** *"Build a companion"* is not
something anybody can act on.
[`docs/ai-in-product.md`](../../../../docs/ai-in-product.md) has a row per app shape
— quote the one that applies:

```
⚠️ MEDIUM — the daily challenge takes an answer and gives back "saved"
Where:    app/dashboard/challenges/[day]/ui.tsx:74, actions.ts:31
Why:      a customer writes three paragraphs about their day and the app
          replies with a toast. Nothing reads it, nothing comes back
          tomorrow, and the subscription is paying for a text box.
Fix:      docs/ai-in-product.md → 2.1 "the companion that walks a course or a
          challenge with them" → a companion on the submission, gated by
          hasPlan(memberId, "coach_monatlich"). The stored answer stays.
Evidence: the action inserts one row and returns { ok: true }; the page renders
          the list and the form and nothing else.
```

Some of it is countable — the two commands above, and reading
`modules/companion/companions.ts` — and the rest is opening the pages, signing in as a
member and **doing the thing the app is for**. `node run.mjs ux-check` measures
nothing for this check, deliberately: whether a surface takes a customer's
*work* or a *setting* is a question about what the app is for, and a scan for
"an action that inserts a row and returns `{ ok: true }`" matches every settings
form in the app — which is the **passing** state of check 4. A check that fires
on the thing another check requires is not a weak check, it is a wrong one.

**Where this check does NOT go:** settings, addresses, payment methods, support
messages — a confirmation is the correct answer to those. And it does not go
near **building** anything; see STOP in `SKILL.md`.

**`ai-companion` → `check` looks at one companion — the one somebody is building
or has just built — and fixes it. This walks the whole app and finds the surfaces
where there is no companion at all**, which is the case that has nothing for
`ai-companion` to be pointed at yet. So the ⚠️ MEDIUM row is this check's alone,
and on the two companion rows this check **hands over rather than duplicates**:
report it, name the fix, and send the user to `ai-companion` → `check` for the
instruction, the `load()` scoping, the ceiling and the cost — four things a UX
gateway has no business judging.
