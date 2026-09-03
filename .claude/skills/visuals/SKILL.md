---
name: visuals
description: Makes an app something to look at rather than something to read — what the customer should SEE, the patterns available, image generation, customer uploads, and a check of what is already there. Use this when the user says "my app is only text", "there is nothing to look at", "I want pictures in it", "can it make images?", "customers should be able to upload a photo", "where do I put the PDF my buyers get?", "where do my videos go", "my video is too big to upload", or when they are about to build a page whose whole output is a block of text. For "this looks unfinished" ask which they mean — hand-built-looking pages are `ux-gateway`, pages that hand out only paragraphs are this one.
requires: 0.7.0
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Something to look at

Apps built on this template hand their customers paragraphs unless somebody
decides otherwise. That is what this skill is for — and the decision is always
the user's, never yours (`docs/guidance.md` → *How a skill works*: **anything the
customer will SEE is proposed, never assumed**).

**The reference is [`docs/visuals.md`](../../../docs/visuals.md).** Read it; do
not restate it here. It carries the catalogue of what to build instead of text,
the rules for asking a customer to produce something, and the recipes for the
things you write yourself.

## How to use this skill

| | What it does | Roughly |
|---|---|---|
| **1 · `plan`** | work out what THIS app should show, and agree it | 10 min |
| **2 · `pattern`** | build one entry from the catalogue | 20–60 min |
| **3 · `generate`** | let the app produce pictures — provider, price, charging | 15 min |
| **4 · `upload`** | let customers put pictures or files in | 20 min |
| **5 · `sell`** | put a file behind a purchase | 10 min |
| **6 · `check`** | is what is already there fast, readable and accessible | 10 min |

- If the user already said which one ("can it make images?", "they should be
  able to upload a photo"), **start that one and skip the menu**.
- Otherwise show the table, say that **`plan`** is where somebody who has not
  thought about it yet should start, and **wait**.
- "My app is only text" with nothing else → **`plan`**. It is ten minutes and it
  is usually the actual answer.

**There is deliberately no "run them all".** The inspecting skills
(`ux-gateway`, `security-gateway`, `performance-gateway`) open with one, because
running every check is always the right thing to do before a launch. Here it
would mean building four features nobody asked for — the opposite of this
skill's own first rule. `plan` is the default instead, and it is the item that
decides which of the others are even wanted.

**First, always:** `node run.mjs media-check`. It says whether this app can
store a file at all — and on a machine where it cannot, three of the six items
below are conversations about something that will fail at the last step.

## 1 · plan — what should this app show?

The same question `build-app` step 1b asks, for an app that is already built.

**Look before you ask.** `docs/app.md` says what this app does and what was
decided against; `docs/product-brief.md` may carry an `Output artifact:` line.
If a previous session already decided **No customer-facing visuals**, that is an
answer — say you found it and ask whether it still holds, rather than proposing
it again as if it were new.

Then read the app's own pages and find the **result surfaces**: the places where
a customer is handed something. The catalogue in
[`docs/visuals.md`](../../../docs/visuals.md) has a row for most of them — and
where it does not, say so and propose something rather than bending an entry to
fit. The catalogue is a starting point, not an inventory. Put them to the user as
a numbered menu with what each costs, and wait:

```
Your app hands customers three things. Two of them are text.

  1  the weekly report — a chart above the table          ✅  your own data   nothing
  2  the "your score: 73" page — a card they can show     ✅  your own data   nothing
  3  the daily message — a picture with each one              upload or AI    ~$0.05 each

  0  none of it — leave as it is

Give me numbers, or say "you choose" and I take the ones marked ✅.
```

Whatever is decided — including a `0` — goes into `docs/app.md` under
*Decisions worth remembering*, with the date and the reason. That entry is what
stops the same conversation happening again in three sessions.

🚨 **A `0` is written with the verbatim entry, and that entry has one home** —
[`build-app`'s menu for step 1b](../build-app/references/menus-1b.md) → *Step 1b*,
because this step and that one ask the same question and two copies of one entry
are two wordings waiting to disagree. It opens
`- **No customer-facing visuals.**`, and those three words are load-bearing: they
are what *Look before you ask* above stops on, and what anything else reading this
step back reads the refusal by. Write the sentence after them in the app's own
words; leave those three exactly as they are.

## 2 · pattern — build one

Take the catalogue entry, build it, and stay inside the design system: colours
from the tokens in `app/globals.css`, never a hand-picked class
(`CLAUDE.md` → **UI**). **If the app has `docs/design.md`, read it first** —
where its composition section already names a pattern for this page type,
build that one, in its place. The recipes in the reference are written that way, which
is why they are correct in light and dark without a `dark:` class anywhere.

Two things to get right, because they are what separates a chart from a
decoration:

- **It has an accessible name.** `role="img"` plus `aria-label`, or `<title>`
  and `<desc>` inside the SVG. Without one a screen reader announces "graphic"
  and the customer learns nothing.
- **The numbers stay.** A chart replaces nothing — it goes ABOVE the table. The
  chart answers "how is it going", the table answers "what exactly", and people
  who came for the second are not served by the first.

Then the usual: `node run.mjs start`, open the page, look at it in **both**
themes and at 380 px, `node run.mjs errors`.

## 3 · generate — let the app draw

Read [`docs/ai-providers.md`](../../../docs/ai-providers.md) → *Pictures* first;
this is the short path.

1. **Can this app draw at all?** `node run.mjs ai-check`. Anthropic and Mistral
   produce no images, so an app whose only key is one of theirs needs a second
   key — the command says which. Adding one does not disturb the assistant.
2. **What does it cost?** The same command prints it per picture. Say the figure
   out loud before anything is built; a vendor who discovers it on an invoice
   remembers it differently.
3. **Build the call** — `generateImage()` from `lib/media/generate.ts`. `alt` is
   required and is NOT the prompt; the reference says why.
4. **Charge for it**, if a customer triggers it: `spendTokens`, in the order
   check → work → charge (`docs/entitlements.md`). And show the price
   next to the button, not in the ledger afterwards.
5. **Offer three, not one.** The reference's rules for asking a customer to
   produce something are the difference between a feature people use and one
   they try once.

## 4 · upload — let customers put things in

`docs/visuals.md` → *Putting files in*. The endpoint exists
(`app/api/media/route.ts`) and so does the FIELD:
**`<MediaUpload>` (`components/ui/media-upload.tsx`) is the app's one file
input** — never build a second one, `components/ui/media-upload.test.ts` fails
the build on it. What a page adds is where the bytes go and a place to show the
result.

Two decisions to put to the user rather than make:

- **What may go in.** `config/media.json` → `mayUpload`, per role. A member
  uploads pictures and PDFs by default; archives are the operator's, because a
  customer who can hand every other customer a `.zip` is not a media feature.
- **How big, and therefore which of the two routes.** Through the app the limit
  is **10 MB** from a form on one of your pages and **50 MB** through
  `/api/media` — what a Server Action body and a route handler respectively
  carry, neither of them the per-kind number in `config/media.json`, which says
  what may be stored. A lesson recording does not fit either, and for that
  there is the direct route: `POST /api/media/upload-url` → `PUT` to the bucket
  → `POST /api/media/confirm`. It needs a CORS rule on the bucket (the
  reference has it) and it does **not** take pictures — location data comes off
  images, which needs the bytes in the app. Say which route the page is
  building before somebody tries a 400 MB file against the wrong one.

**Do not soften the checks.** The type comes from the file's bytes, not from
what the browser claimed, and location data comes off images on the way in.
Both are in `lib/media/`; neither is a place to save a few lines.

## 5 · sell — a file behind a purchase

The shortest item here, because it is one field: `visibility: "entitled"` plus
the Product Key, and `hasPlan()` decides. `docs/visuals.md` → *Selling a file*.

Worth checking with the user: **which plan**. An invented key is refused when
the item is written (`planProblem()` in `lib/media/config.ts`, called from
`createMedia()`), so it never reaches a page — but a key that EXISTS and is the
wrong plan is not refused by anything, and nobody notices until a buyer cannot
get their workbook. Read the key out of `config/digistore-products.json` with
the user rather than typing what sounds right.

## 6 · check — is what is there any good?

Not a full pass; that is `ux-gateway`. This is the media-specific half:

- `node run.mjs media-check` — the store, and what may go in.
- Every image on a page has alternative text. `components/ui/figure.tsx` makes
  that a compile error, so what to look for is images that do **not** go through
  it.
- Every image goes through `next/image`. A phone downloading a 4 MB photograph
  to show it at 200 px is the finding `performance-gateway` reports next.
- **No image scrolls.** `w-full h-auto`, crop with `overflow-hidden` — an image
  inside an `overflow-auto` container is a finding however big the file is,
  because a too-big picture is scaled, never panned.
- **Every diagram carries the customer's own data.** A flow diagram of how the
  app works is decoration — `docs/visuals.md` says so under the catalogue — and
  more than one diagram per app means at least one of them is.
- Both themes. A picture with its own light background sitting on a dark page is
  the thing nobody sees, because nobody switches while building.
- **No `<iframe>` at a video host without a consent gate in front of it.** That
  one is not taste, it is § 25 TDDDG — the reference has the recipe, and
  `compliance-check` audits it.

## The rules

1. **A "no" is an answer, and it gets written down.** `docs/app.md`, under the
   decisions, with the date. Arguing with a no is how people stop giving you one
   — and an unrecorded no is one somebody proposes again next session.
2. **Nothing here overrides the design system.** Colours from the tokens, and no
   fourth way of giving feedback (`CLAUDE.md` → **UI**).

Everything else this skill runs on — propose rather than decide, say the price
before it is spent, no decoration — is `docs/guidance.md` → *How a skill works* and the
catalogue in `docs/visuals.md`. Read them there rather than a second copy here.

## What comes next

- Built something new → `ux-gateway` looks at the whole experience, not just the
  media half.
- The app now spends money on pictures → `/dashboard/admin/ai-costs` shows what,
  grouped by task.
- Customers can upload → `compliance-check`, because an uploaded photograph is
  personal data and `docs/data-protection.md` is what a privacy policy is
  written from.
