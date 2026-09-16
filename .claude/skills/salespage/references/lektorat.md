<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The Lektorat — reading the copy before the operator does

A second reader, in a fresh context, reads the draft the way a stranger will,
against the list below, and returns a verdict: **freigegeben** or **zurück**.
No draft reaches the operator, and no revision reaches the page, without it.
The reasoning and the sources are `docs/salespage.md` → *The Lektorat*; this
file is the procedure and the list.

## How it runs

1. **Fresh eyes.** Where you can start a subagent, the Lektorat is one: it
   gets the paths below and nothing else — not your conversation, not your
   reasons, not the operator's remarks. Where you cannot, you are the
   Lektorat yourself: close the draft, read this file top to bottom, then read
   the draft **from disk**, sentence by sentence, and say in the hand-back that
   the reading was your own. Wait for the verdict inside the turn
   (`CLAUDE.md` → *Rules*: a turn ends with the result, never with an agent
   still working).
2. **What it gets.** The draft deck (`docs/marketing/salespage-<lang>.md`),
   the feature list (in the deck's head), `docs/marketing/voice.md`, and this
   file. For the honesty checks it also opens `config/digistore-products.json`
   and the gates the offer's button grants (`SKILL.md` step 5 names them).
   **No feature list, no reading**: when the Lektorat measures an existing
   page (step 0) and no list exists, it writes one first — out of the app, from
   the sources `SKILL.md` step 1b names (`nav.*`, `config/modules.json`,
   companion cards, activities, lesson pages, `config/ai-chat.json`), never
   from the page it measures, each row with WHERE the name stands
   — because 5.1 and 5.2 are comparisons, and a comparison without its other
   half passes everything. Measured 2026-09-16: a Lektorat without a list
   caught "Finn" unexplained five times and missed that Finn is the chat
   assistant while the card under the hand-in says "ein Coach".
3. **What it returns.** The table under *The verdict*, in the language of the
   draft, in the deck under `## Lektorat`. Then the writer fixes every *zurück*
   finding, and the Lektorat reads again. **Three rounds at most**; after the
   third, the open findings go to the operator as they stand, and the operator
   decides.
4. **When.** Before the draft is shown (step 3c), and after every revision
   round (step 3b) — the operator's remark changes one principle, the Lektorat
   checks that the page still holds all the others.

## The list — a criterion, a test, a class

Two classes. **Z (zurück)**: one finding sends the draft back. **H (Hinweis)**:
reported, fixed when cheap, never blocks. The verdict is *zurück* when any Z
finding stands.

### 1 · Verständlich (Hamburger Verständlichkeitskonzept)

| # | Criterion | Test | Class |
|---|---|---|---|
| 1.1 | **Einfachheit** — short sentences, common words, active voice | A sentence over ~20 words, a passive where the reader could act, a nominal construction ("die Durchführung der Übung") | H |
| 1.2 | **Unknown terms explained or gone** | Every word a stranger could not look up in a dictionary — a feature name, an internal label, a technical word — is explained at its FIRST mention or removed. "Finn" without "dein KI-Coach" is a finding | **Z** |
| 1.3 | **Gliederung** — one thought per paragraph, order attention → interest → trust → decision | A paragraph that carries two claims; a section in the wrong place; a heading that does not say what its section says | H |
| 1.4 | **Kürze** — nothing that does not serve the decision | A sentence that can go without the reader losing a reason to buy | H |
| 1.5 | **Scannable** (NN/g) — front-loaded, headings and bold carry the meaning | Read only the headings and bold words: does the reader still know what this is, for whom, what it costs, what to click? | H |

### 2 · Anschaulich und konkret (Made to Stick, specificity)

| # | Criterion | Test | Class |
|---|---|---|---|
| 2.1 | **Concrete over abstract** | "effektiv", "professionell", "umfassend", "hochwertig", "einfach" without a picture or a number beside them | H |
| 2.2 | **The pain is a scene, not a proof** | The problem section carries a number or a price → finding; it carries a moment the reader recognises → pass | **Z** |
| 2.3 | **Every benefit answers "so what?"** | A benefit line that names a feature but not what the reader can do afterwards | H |
| 2.4 | **Numbers are the app's own** | Every count (lessons, places, questions, days) is in the app's config, registry or content — never rounded up, never estimated | **Z** |

### 3 · Problem und Lösung (StoryBrand, Problem → Lösung)

| # | Criterion | Test | Class |
|---|---|---|---|
| 3.1 | **The problem is named in the customer's words** | Before the solution, in one place, as the customer would say it (the product brief's pain points) — not the vendor's diagnosis of the customer | **Z** |
| 3.2 | **The solution is named** — the product and what it does, by name | After the problem, the page says what this product does about it, calling the features by their names | **Z** |
| 3.3 | **What happens after the click** | The reader knows what they get first after paying (the first lesson, the login, the download) | H |

### 4 · The stranger's five (Grunt test)

| # | Criterion | Test | Class |
|---|---|---|---|
| 4.1 | **What is this, and what do I get — by name?** | Answered above the fold or within one scroll | **Z** |
| 4.2 | **Who is it for?** | Same | **Z** |
| 4.3 | **What does it cost?** | Price, or one click to it, honestly labelled | **Z** |
| 4.4 | **Why believe you?** | Real proof, a founder line, or an honest nothing — never a placeholder | **Z** |
| 4.5 | **What do I click?** | One primary action, repeated, the same words each time | **Z** |

### 5 · Namen (`docs/salespage.md` → *Names, not paraphrases*)

| # | Criterion | Test | Class |
|---|---|---|---|
| 5.1 | **Every feature by the name the app shows** | Compare against the feature list: a paraphrase ("Fragen", "Planen lassen") where a name exists | **Z** |
| 5.2 | **A name belongs to one feature** | For every name on the page, open the place the list's "where" column names: does THAT feature carry the name there? The assistant's name on a companion whose card says "ein Coach", a module label on another module | **Z** |
| 5.3 | **Every row appears** | A feature list row the page never mentions — the community, the game, the worksheets | **Z** |
| 5.4 | **The list is on the page, plainly** | One section (`docs/salespage.md` § 4) where a scanner reads every feature: its name, one line, the scope. Benefits that describe features without naming them, or two features merged into one line, do not count | **Z** |

### 6 · Stimme (`docs/marketing/voice.md`)

| # | Criterion | Test | Class |
|---|---|---|---|
| 6.1 | **Excluded constructions are absent** | Anything on the style sheet's exclusion list (antithesis, dash chains, exclamation marks, a word) anywhere on the page | **Z** |
| 6.2 | **Address and register hold** | du/Sie as decided, in every sentence, the FAQ included | **Z** |
| 6.3 | **Verbs the reader does** | Hero, problem section and benefits open on something the reader does, not on something that is the case | H |
| 6.4 | **Sounds like the sample** | Read the operator's sample, then the draft: would the operator's customers recognise the writer? | H |

### 7 · Die Headline (Copyhackers: unique, desirable, specific, succinct, memorable)

| # | Criterion | Test | Class |
|---|---|---|---|
| 7.1 | **Could a competitor put it over their product?** | Then it is a category, not this product's promise | **Z** |
| 7.2 | **Names the outcome for the audience** | Not the product category, not a pun | H |
| 7.3 | **Under ~10 words, one idea** | Two ideas or a subordinate clause | H |

### 8 · Ehrlich und erlaubt (the rules the page already has)

| # | Criterion | Test | Class |
|---|---|---|---|
| 8.1 | **Nothing invented** | A quote, a number, a guarantee, a result that has no file behind it (`docs/salespage.md` § 5) | **Z** |
| 8.2 | **No duration on access** | The ten Digistore24 words as stems, where the sentence names access (`legal-check` refuses them, but read anyway) | **Z** |
| 8.3 | **Every claim maps to the plan on the button** | A benefit the button's plan does not unlock (`SKILL.md` step 5) | **Z** |
| 8.4 | **Price from the registry, withdrawal right named** | A price retyped into prose; a missing "14 Tage Widerrufsrecht" | **Z** |

## The verdict

Written into the deck under `## Lektorat`, in the language of the draft:

```markdown
## Lektorat — 2026-09-16, Runde 1 — Urteil: zurück

Gelesen als Fremder, 41 Sätze. 3 × zurück, 4 Hinweise.

| # | Stelle | Kriterium | Befund | Vorschlag |
|---|---|---|---|---|
| 1 | Untertitel, Satz 2 | 1.2 unbekannter Begriff | „Finn" ohne Rolle — wer ist das? | „Finn, dein KI-Coach, schaut sie sich an" |
| 2 | Karte 2 | 5.2 Name wandert | „Finn liest deine Übung" — die Karte in der App heißt „Rückmeldung zu deiner Abgabe", „ein Coach", kein Name | „Ein Coach liest deine Übung" oder den Coach in der App benennen, dann hier |
| 3 | Block 1–5 | 6.3 Verb des Lesers | fünf Themenlisten, kein Satz, der etwas tut | „Du bindest die fünf Knoten, die halten." |
| 4 | Problem-Absatz | 2.2 Bild statt Beweis | „Ein Guide kostet 120 €" — Beweis | „Der Platz, von dem dir jemand beim Einpacken erzählt." |
| 5 | Karte 1 | 2.1 abstrakt | „effektiv lernen" | streichen oder „in deinem Tempo, alle 20 Lektionen ab Kauf" |
| 6 | FAQ 4 | 1.1 Satzlänge | 34 Wörter | zwei Sätze |
| 7 | Headline | 7.1 Wettbewerber-Test | „Der Online-Angelkurs" passt über jeden | „Vom ersten Wurf bis zum sicheren Fang" |

Freigegeben, wenn 1, 2 und 4 behoben sind; 3, 5, 6, 7 sind Hinweise.
```

Three things the verdict is not: a rewrite (it names the finding and one
possible fix, the writer writes), a taste note ("ich würde …" is not a
criterion — every row names its number), and a summary ("insgesamt gut" says
nothing a writer can act on). A round with zero findings is a measurement,
and it says so: *„0 × zurück, 0 Hinweise — gelesen als Fremder, n Sätze."*

## The other languages

The Lektorat reads the draft in the language it was written in — the
operator's. The other `messages/<code>.json` files are filled from the
**freigegebene** deck, never from an earlier draft, and get a shorter reading
(2.4, 5.1, 5.2, 8.1–8.4, plus: does it read like a native wrote it, and is
nothing added that the original does not say). A translation that improves on
the original is a finding — the original is what the operator approved.
