<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The salespage — the home page that sells

> **Needs template 0.7.0 or newer** for the imagery half (`components/ui/figure.tsx`,
> `lib/media/`). Everything else in here runs on any copy of this template.

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
attention → interest → trust → decision. Every row is optional except the first
and the sixth: a page with no hero has no first impression, and a page with no
offer sells nothing. The skill puts this list to the user as a menu; nobody
gets all eight by default.

| # | Section | What it has to do |
|---|---|---|
| 1 | **Hero** | One outcome-headline for the named audience, a subline, the primary call to action — and a real visual |
| 2 | **Problem → promise** | Name the pain in the customer's words, then the change this product makes |
| 3 | **Benefits** | 3–5 outcomes, written fresh — never the registry's feature bullets |
| 4 | **What's inside** | The curriculum, the tool, the deliverables — read out of the app itself |
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

Three to five, each one sentence of outcome plus at most one of how. Written
**fresh, for this page** — the `features[]` strings in
`config/digistore-products.json` are checkout bullets ("12 Lektionen",
"Arbeitsblätter als PDF") and read like a packing list when promoted to
benefits. The translation is always the same move: feature → what the customer
can *do* afterwards → why that matters to them.

If icons are used, they must mean what they sit next to. The shipped page's
key/shopping-cart/sparkles trio describes sign-in, billing and readiness — re-
texting the cards while keeping those icons puts a shopping cart next to "your
personal coach". Choose per benefit, or drop the icons for numbers or images.

### 4 · What's inside

Concrete contents build more trust than adjectives: the five course blocks,
the three tools, the deliverables per module. **Read it out of the app** —
the course structure, `docs/app.md`, the actual pages — so the page can never
promise a module the app does not have. Cards or a numbered list; lesson cover
images if they exist make this the cheapest visual section on the page.

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
  immer", "lebenslang", "lifetime", "dauerhaft", "unbegrenzt". A one-off grant
  has no end date because no event ends it, which is not the same as a term the
  page may promise, and for a members' area it is a Digistore24 approval
  criterion rather than a matter of taste:
  [`docs/courses.md`](courses.md) → *Shape 1*.
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

1. **What is this?**
2. **Who is it for?**
3. **What does it cost?** (or: is the price one click away, honestly labelled)
4. **Why should I believe you?** (proof, or an honest founder story)
5. **What do I click?** (one primary action, repeated, reachable)

Plus the mechanical half: `node run.mjs smoke` and `node run.mjs errors` after
building, both themes, 380 px, and the buy button really reaches a Digistore24
checkout (in DEV it carries the test-payment parameter by itself).

A page that answers all five but looks like a settings screen fails the test
too — that is what section 1's visual rule is for.
