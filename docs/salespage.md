<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The salespage — the home page that sells

The home page (`app/page.tsx`, the route `/`) is not a brochure next to your
product — it **is** your product's salespage. It is the page a stranger lands
on, the page an ad or a social post links to, and the page that decides whether
anybody ever sees the app behind it. `/plans` answers "which plan"; `/` has to
answer the four questions that come before that: *what is this, who is it for,
why should I believe you, and what do I do next.*

**What ships at `/` is a placeholder, and its structure does not carry.** The
shipped page — a badge, a headline and a spec sheet of what the template
already does — describes the *template* to a developer. Swapping its texts
produces a page that still has the shape of a README: it proves nothing and it
sells nothing, whatever the words say. That is the single most
common weak point of apps built here, and it is why building the real page is
a skill (**`salespage`**) rather than a text edit.

The skill proposes; this file is the reference it builds from. Nothing in here
overrides `CLAUDE.md` § **UI** (kit only, tokens only, both modes) or
[`docs/ux.md`](ux.md).

---

## The section inventory

A salespage is built from a small set of sections in a deliberate order —
attention → interest → trust → decision. Every row is optional except the
first, the fourth and the sixth: a page with no hero has no first impression, a
page that does not list what the buyer gets has sold an idea, and a page with no
offer sells nothing. The skill puts this list to the user as a menu; nobody
gets all eight by default.

| # | Section | What it has to do |
|---|---|---|
| 1 | **Hero** | One outcome-headline for the named audience, a subline, the primary call to action — and a real visual |
| 2 | **Problem → promise** | Name the pain in the customer's words, then the change this product makes |
| 3 | **Benefits** | 3–5 outcomes, written fresh — never the registry's feature bullets |
| 4 | **What you get** | Every feature by the name the app shows, one line each — the feature list written out, none left out |
| 5 | **Social proof** | Real quotes, numbers, or a founder story — never invented |
| 6 | **Offer block** | ONE purchase decision: value stack, price, guarantee, buy button |
| 7 | **FAQ** | The objections, answered before they are raised |
| 8 | **Final CTA** | The last band before the footer repeats the one action |

`<PublicHeader />` stays at the top and `<SiteFooter />` at the bottom — the
footer carries the legal links, and a public page is where § 5 DDG needs them
most (the reasoning is in `components/site-footer.tsx`).

### 1 · Hero — the five-second test

The headline names the **outcome for the audience**, not the product category:
"Vom ersten Wurf zum sicheren Fang" beats "Der Online-Angelkurs". The subline
says what it is and for whom. The primary button goes to the offer block
(`#offer` / `#preis`), not to `/login` — a stranger has nothing to sign in to.
A secondary link may go to `/plans` or the curriculum.

**A hero needs a real visual.** A lucide glyph in a tinted square is an icon,
not a picture; a page whose only imagery is three icons reads as unfinished
whatever its copy says. In order of preference:

1. **A screenshot of the app doing its thing** — free, honest, and proof at
   the same time. Take it from the running app (both themes if it sits on a
   theme-aware page).
2. **Existing product imagery** — a course cover, the app icon at size,
   photography the vendor owns. Apps routinely have these behind the paywall
   (`content/knowledge-media/`, lesson covers, `public/`) while `/` shows
   icons; inventory before generating anything.
3. **A generated image** — the `visuals` skill (item `generate`) owns that
   path, including what one picture costs. Product mood, not stock-photo
   people.

Every image goes through `<Figure>` (`components/ui/figure.tsx`) or
`next/image` with real alternative text, and it must work on the dark
background too — a picture with its own white canvas glows at night.

### 2 · Problem → promise

Two or three sentences, in the customer's own words — the product brief's pain
points (`docs/product-brief.md`) are usually quotable nearly verbatim. Then the
turn: what changes with this product. This is the section that makes a visitor
feel *found* rather than *targeted*; skip it only when the hero already carries
the pain in its subline.

### 3 · Benefits — outcomes, not features

Three to five, each one sentence of outcome plus at most one of how, and each
hung on a feature by its name ("Finn, dein KI-Coach, beantwortet …"). Benefits
**do not replace section 4**: an outcome is why somebody wants the feature, the
list is what they buy, and a page that has only the first has described a
feeling. Written
**fresh, for this page** — the `features[]` strings in
`config/digistore-products.json` are checkout bullets ("12 Lektionen",
"Arbeitsblätter als PDF") and read like a packing list when promoted to
benefits. The translation is always the same move: feature → what the customer
can *do* afterwards → why that matters to them.

If icons are used, they must mean what they sit next to. The shipped page's
key/shopping-cart/sparkles trio describes sign-in, billing and readiness — re-
texting the cards while keeping those icons puts a shopping cart next to "your
personal coach". Choose per benefit, or drop the icons for numbers or images.

### 4 · What you get — every feature, by name

The section a buyer scans to answer *what do I get for the money*. It is the
feature list (*Names and voice* below) written out: **one line per row, every
row** — the name in bold as the app shows it, what the reader does with it in
one short sentence, and the scope in numbers where the app has one:

> **Köder-Duell**: acht Situationen am Wasser, du wählst den Köder.
> **Finn, dein KI-Assistent**: beantwortet deine Fragen aus dem Kurs.
> **Community**: drei Räume, in denen du mit anderen Käufern sprichst.

Plain, not clever: a name and a sentence, no paraphrase in place of the name,
no two features merged into one line so the list looks shorter, none dropped
because it seemed minor. The course's blocks or the tool's categories may
follow as their own part, with cover images if they exist — they are *inside*
one feature, not a substitute for the list. **Read it out of the app** — so the
page can never promise a module the app does not have, and never forgets one
it has.

Measured 2026-09-16: asked to make a page "sell", a session moved the price up
and put the audience into the subline — and left eleven features described as
three benefits, the community, the game and the course review not mentioned at
all. The operator's words: *"Ich hätte mir zumindest gewünscht, dass er das,
was die App kann, auf den Punkt bringt und aufführt. Also simpel die
Funktionen."* The list came one round later, after the complaint.

### 5 · Social proof — the section with a hard rule

> **Never invent testimonials, review counts, member numbers or results.**
> Mark placeholders explicitly (e.g. `[insert real customer quote]`) — and a
> placeholder MUST NOT go live: unlaunched proof is a section to omit, not to
> fake. Invented reviews are a legal problem (UWG — misleading commercial
> practices; `compliance-check` is the skill that takes that seriously), and
> one discovered fake costs more trust than ten real quotes buy.

What a brand-new product can use honestly, in order of strength:

1. **Real customer quotes** — with permission, name or initials.
2. **Numbers that exist** — "500 members", "4.8 on Digistore24" — only when
   they are real and checkable.
3. **The founder story** — who built this and why they are credible. A new
   product's honest substitute for reviews, and often stronger than weak ones.
4. **Nothing** — omitting the section is a valid answer and beats thin proof.

### 6 · The offer block — not the `/plans` table

`/plans` is a **catalog**: every product, grouped, priced, compared — the page
for somebody who already wants to buy and needs to pick. The offer block is a
**decision**: the one product this page has been arguing for, presented once,
with everything that de-risks saying yes. Reusing the plans table here is the
most common shortcut and it shows — a narrow card with six checkmarks carries
no argument.

What the block holds:

- **The value stack**: what is included, each line something section 4 already
  made concrete. This is where "12 Lektionen" belongs — under a promise, not
  instead of one.
- **The price**, rendered with `formatPrice()` from `lib/digistore/products.ts`
  off the registry entry — **never retyped into prose or a message file**. One
  price, one place (`config/digistore-products.json`); a price written twice is
  the one that is wrong after the next change. One-off purchases say so ("pay
  once, no subscription") — against subscription fatigue that is itself a
  selling point. 🚨 **What they must not say is how LONG access lasts** — "für
  immer", "lebenslang", "lifetime", "dauerhaft", "unbegrenzt" and five more
  ([`docs/courses.md`](courses.md) → *Shape 1* has all ten and the reason). A
  one-off grant has no end date because no event ends it, which is not the same
  as a term the page may promise, and for a members' area it is a Digistore24
  approval criterion rather than a matter of taste. **`node run.mjs legal-check`
  refuses the wording**: the ten as stems, so "dauerhaft nutzen" is caught
  although the criteria spell it "dauerhafter", and only where the sentence also
  names access, so a generous FEATURE ("unbegrenzt viele Notizen") stays
  allowed. The sweep is exhaustive rather than a sample: **every language file
  (`messages/*.json`), the product registry (`config/digistore-products.json`)
  and every page**. The registry is in that list because its `features[]` and
  `tagline` never travel through the i18n files, so a "dauerhafter Zugang"
  written there would walk past any check that only reads translations. Write what is true — "pay once, no subscription", "as long as your
  plan runs".
- **An honest risk-reversal.** EU consumer law gives most digital purchases a
  14-day withdrawal right — *naming* it costs nothing and reads as a
  guarantee. A money-back promise beyond that is the vendor's decision to
  make, never yours to invent. What is promised here must match what is on
  file at Digistore24.
- **The buy button.** For the signed-out visitor the link comes from
  `checkoutLinksFor()` (`lib/digistore/checkout.ts`) — the same cached,
  blocker-aware path `/plans` uses, so a half-configured app says "checkout
  unavailable" instead of rendering a dead link. `app/plans/page.tsx` is the
  worked example, including the signed-in click-time variant.
- **A quiet link to `/plans`** when more than one product exists — the
  comparison lives there.

If the app sells several products, the offer block still features **one**
(usually the `highlight` entry) and sends the comparison shopper to `/plans`.
Two featured offers on a salespage is a choice presented as an argument.

### 7 · FAQ

Five to eight real objections — "is this for beginners?", "how long do I have
access?", "what if it is not for me?" — sourced from the product brief's pain
points, `docs/marketing/` if `go-to-market` ran, and the withdrawal/refund
facts. The component is shadcn's accordion (`npx shadcn@latest add accordion` —
the usual rule: fetch what is missing, never hand-build a fold-out). Answers
are honest and short; an FAQ that oversells is section 5's rule broken in
question form.

### 8 · Final CTA

One short band: the promise in one line, the same buy button (or an anchor to
the offer block). Somebody who scrolled past the offer while reading the FAQ
should not have to scroll back up to say yes.

---

## Names and voice — settled before the first sentence

Two things decide whether a page *sells* or *reports*, and neither is in the
section inventory, because both cut across every section. Both were measured
missing, twice, in September 2026: on one page the assistant was named Lia in
`config/ai-chat.json` and "der Insel-Assistent" everywhere on `/`, the search
the app ships was never mentioned, and after eight revision rounds the
operator replaced the whole text with one from another tool. The next day a
second app's "Werkstatt-Helfer" was "der KI-Helfer" on its page. Neither page
told a buyer what they *get*; both told them what the product is *about*.

### Names, not paraphrases

The app's features have names — the ones the app itself shows: the navigation
labels (`nav.*` in `messages/<code>.json`), module and page titles, the
assistant's `name` in `config/ai-chat.json`, the courses' titles. **The page
calls every feature by its name** and never describes the activity where the
name belongs: not "Fragen" for the assistant, not "Planen lassen" for the
planner, not "Lesen" for the guide. A buyer meets these names in the app on
day one; a page that used other words has sold something else.

So the first thing written is not a headline but the **feature list** — on
every run, whatever the complaint was: "it does not sell" is answered from the
list as much as "it reads like a report". One row
per feature — the name as the app shows it, what it holds (read out of the
app: the categories, the course blocks, the tools), and the scope in numbers
where the app's config or registry holds one (lessons, places, questions per
plan, what a top-up costs). The list is shown to the operator and confirmed;
from then on it is the page's vocabulary, every row appears on the page at
least once, and section 4 is that list written out.

**Where the rows come from** — the app, not the page being replaced (a page
that forgot a feature passes its gap on): every buyer-visible entry of `nav.*`,
every module in `config/modules.json` and the pages it gives a buyer, every
companion's card title, every learning activity's title, what a lesson page
carries (a worksheet, a task to hand in), the community's rooms, the
assistant's `name`. A row is left out only with its reason (owner-only, not
in the plan on the button). Measured the same day: a list taken from `nav.*`
and the old page had eleven rows and still missed the five worksheets. The test at the end:
**a stranger can say what they get, by name** — not only what it is about.

**A name is not an explanation.** The names are the app's, and a stranger has
never seen the app. So **every term that is not common knowledge is either
explained where it first appears or left off the page**: "Finn, der KI-Coach,
liest deine Übung" — never "Finn liest deine Übung" as the first mention; "die
Einstufung" only with what it does ("ein kurzer Test, der dir sagt, wo du
anfängst"); an internal label ("Montage-Übung", "Plan-Check") with its one-line
meaning, or not at all. The test is the stranger's: every word on the page
they could not look up in a dictionary is explained on the page. Measured
2026-09-16: a page opened with "Finn schaut sie sich an" and never said who
Finn was; the version it replaced at least had "der Assistent Finn".

**And a name belongs to the feature that carries it in the app — only that
one.** Each row of the feature list cites where the app shows the name (a menu
label, a card title, a config field). A feature with no name on its own page
has none on the salespage either, until the operator gives it one — in the app
first. What the operator says in the chat does not replace the reading:
measured the same day, the operator confirmed "Finn antwortet drauf", and the
page carried the assistant's name onto two companions whose cards say "ein
Coach" and "Plan-Check".

### The voice — the operator's, written down

The page speaks in the operator's voice, not in yours. Yours, measured, is a
report: statements about a problem, prices as evidence, subordinate clauses
and dashes, a headline built on an antithesis. Marketing copy does four things
differently, and all four are checkable sentence by sentence:

- **Verbs the reader does.** "Entdecke", "erlebe", "frag", "stell zusammen" —
  not "Am Ende des Tages weißt du, wo du hättest angeln sollen." A statement
  about the reader's problem is a diagnosis; an imperative is an invitation.
- **The pain is a picture, not a proof.** "Der Platz am Ufer, von dem dir
  jemand beim Einpacken erzählt" makes the reader *feel* the problem; "Ein
  Guide kostet 120 € am Tag, die Angelkarte 40 €" *proves* it. No number in
  the problem section — the numbers go where they sell: the feature list and
  the offer block.
- **Short main clauses.** One thought per sentence; a dash is a sign the
  sentence wants to be two.
- **No construction the operator excluded.** An antithesis ("Weißt du vorher,
  was die Alten wissen, wird dein Tag ein anderer") is a writer's device; once
  the operator has said "no antitheses", it is out of every section, not out
  of the one they pointed at.

None of that says *which* voice this operator has — du or Sie, playful or
plain, long or short — and no file in the project does either. So before the
first draft, **one question**: a text they wrote themselves (a mail, a post,
their old site) or a page they want to sound like. From the answer you write
the **style sheet**, `docs/marketing/voice.md`: five to eight lines — address,
sentence length, what the page does instead of proving, words the operator
uses, words and constructions that are out — and show it before the copy. It
is the file every later writer reads (`go-to-market` writes the mails and
posts in the same voice) and the file every revision is checked against.

### The Lektorat — a second reader, before the operator

The writer cannot read their own draft as a stranger: measured 2026-09-16, a
writer read a page three times against the feature list and the style sheet
and handed over "Finn schaut sie sich an" without ever saying who Finn was.
So the draft gets a **second reader in a fresh context** — a subagent where
the program has one, otherwise the writer after closing the draft and reading
it back from disk — who reads it against a fixed list and returns
**freigegeben** or **zurück** with one row per finding. The list, the classes
(what sends a draft back, what is only a note), the verdict format and the
three-round limit are in the skill's
[`references/lektorat.md`](../.claude/skills/salespage/references/lektorat.md).
The draft itself is a file, `docs/marketing/salespage-<lang>.md`, so that the
reader reads what the page will say and not what the writer remembers saying.

What the list measures, and where it comes from:

- **Verständlich** — the four dimensions of the Hamburger
  Verständlichkeitskonzept (Langer, Schulz von Thun, Tausch, 1970s; the
  German-language standard since the 1980s): Einfachheit, Gliederung/Ordnung,
  Kürze/Prägnanz, anregende Zusätze. Plus NN/g's web reading: users read at
  most a quarter of the words, so the page must be concise, scannable and
  free of hype — headings and bold words carry the meaning on their own.
- **Anschaulich** — *Made to Stick* (Heath): concrete over abstract, credible
  through what is checkable, a feeling and a scene rather than a claim. The
  specificity rule of conversion copy: "4 hours to 15 minutes" beats "save
  time".
- **Problem, dann Lösung** — the oldest rule of the trade (Problem → Agitate →
  Solve; StoryBrand's customer-as-hero): the problem in the customer's words,
  in one place, before the product; then the product by name and what it does
  about it; then what happens after the click.
- **Der Fremde** — StoryBrand's grunt test (what do you offer, how does it
  make my life better, how do I buy) widened to the five questions above.
- **Namen, Stimme, Headline** — this file's own rules, and the Copyhackers
  headline scale (unique, desirable, specific, succinct, memorable), of which
  one half is a test any reader can run: could a competitor use it?
- **Ehrlich und erlaubt** — § 5, § 6 and `legal-check`, read once more by
  somebody who did not write the sentence.

A verdict is not a rewrite and not a taste note: every row carries a
criterion number, the writer writes the fix. Sources: Wikipedia, *Hamburger
Verständlichkeitskonzept*; NN/g, *Concise, Scannable, and Objective* and *How
Users Read on the Web*; Heath & Heath, *Made to Stick*; Miller, *Building a
StoryBrand*; Copyhackers, *The Great Copy Debate: Clear vs. Clever*.

### When the text comes back

A page comes back three or eight times, and the rounds are where the measured
page was lost: the headline was rewritten eight times, twice back to a version
already discarded; the problem paragraph was never touched; an instruction
("einfache Sätze, keine Antithesen") was broken two minutes later. Each round
answered the *sentence* the operator pointed at. Each looked like progress.

The rule: **feedback names a principle, and a principle is applied to every
section.** So a revision round has a fixed shape —

1. Say the principle behind the remark in one line, and write it into
   `voice.md` (a construction that is out goes onto the exclusion list there).
2. Re-read every section against it — not the one the remark was about — and
   change what breaks it.
3. Hand back a table, not a page: section by section, changed or unchanged,
   and *why* the unchanged ones stand. A round in which only the headline
   moves is the failure mode; the table makes it visible.
4. Keep the discarded variants in the same note, with the reason. A headline
   the operator turned down is never proposed again.

And when the operator writes a line themselves, it goes in as written — the
measured page's final headline was the operator's own.

---

## Where every fact comes from

The page is written **from the project, not from imagination** — every claim
has a file it can be checked against:

| The page needs | It lives in |
|---|---|
| Audience, pain, core message | `docs/product-brief.md` (from `market-research`) |
| What the app actually does | `docs/app.md`, the app's own pages |
| Product names, prices, intervals | `config/digistore-products.json` — via `formatPrice()`, never retyped |
| Finished marketing copy | `docs/marketing/` — if `go-to-market` already ran, transplant, do not rewrite |
| Look, type, composition | `docs/design.md` — if it exists, the page follows it |
| Imagery already owned | `public/`, course covers, `media` rows with `visibility: "public"` |
| Course structure for section 4 | the app's course tables / content, `docs/app.md` |
| Withdrawal/guarantee facts | what is actually on file at Digistore24 — never invented |

Two text rules that are easy to break on exactly this page:

- **Page copy is i18n copy.** Headlines, benefits, FAQ — every visible sentence
  goes into `messages/de.json` **and** `messages/en.json`
  (`i18n/messages.test.ts` fails on a missing key). The one exemption stays the
  registry's product copy (`name`, `tagline`, `features`) — that is checkout
  text, on file at Digistore24 in one language per product, and it is also why
  it must not be promoted to page copy: the page could no longer translate it.
- **Kit and tokens only.** The salespage is the app's shop window, not an
  excuse for a hand-built one — `Card`, `Badge`, `Button`, `Figure`,
  `Accordion`, colours from `app/globals.css`, readable in both modes and at
  380 px. `node run.mjs ux-check` measures the measurable half.

---

## The stranger test

The finished page is checked the way `ux-gateway` checks it — as somebody who
has never heard of the product, five questions, answered above the fold or
within one scroll:

1. **What is this — and what do I get, by the names the app uses?** Every
   feature-list row, in one place (§ 4) — not the three the writer liked best.
2. **Who is it for?**
3. **What does it cost?** (or: is the price one click away, honestly labelled)
4. **Why should I believe you?** (proof, or an honest founder story)
5. **What do I click?** (one primary action, repeated, reachable)

Plus the mechanical half: `node run.mjs smoke` and `node run.mjs errors` after
building, both themes, 380 px, and the buy button really reaches a Digistore24
checkout (in DEV it carries the test-payment parameter by itself).

A page that answers all five but looks like a settings screen fails the test
too — that is what section 1's visual rule is for.
