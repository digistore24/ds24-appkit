<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The interface — what your customer actually meets

`CLAUDE.md` § **UI** says which component to reach for. This file is the other
half: what the app has to *do* for the person in front of it, and where this
template already does it for you.

The skill that checks an app against this is **`ux-gateway`**. The measurable
part of it is one command:

```bash
node run.mjs ux-check
```

That command settles contrast, the design system, missing names and pages that
nothing leads to — in no menu AND linked from no page, `[param]` pages
included. It cannot settle whether the first five minutes make sense —
that is the skill's job, and yours.

---

## 0. What a page is built from, per archetype

Every archetype's pages are the same handful of kit components, arranged
differently. Reach for these before inventing a layout — and if the app has a
`docs/design.md`, its composition section refines this table for THIS app:

| Archetype | The page usually is | Reach for |
|---|---|---|
| Content-Access | a lesson and its progress | a `<Figure>` cover, the progress bar, a `<Card>` around the lesson body |
| Drip/Automation | today's message and the trail behind it | the message first, then the history as `<Card>`s — never the archive first |
| Gated-Tool | the RESULT, not a form | the result in a `<Card>` **above** the input form, never below it |
| Membership | a profile and a standing | `<Avatar>`, `<Badge>` for the standing, `<Table>` for the history |
| Usage/Tokens | a balance and its story | the balance as a number first, the chart (`lib/ai/report.ts` has the shape) above any table |

The rule behind all five rows: **the thing the customer came for sits above
the fold and above the form.** A page that opens with settings and buries the
result is the layout mistake this table exists to prevent.

---

## 1. The first five minutes

**The most expensive screen in your app is the first one after a purchase.** The
customer has just paid, and they are looking for one thing: proof that it
worked, and what to do next. An overview that greets them with three status
cards and no instruction gets read as "this is broken", and that reading is
where refunds come from.

The template ships the answer as a component:

```tsx
<OnboardingChecklist
  steps={[
    { id: "plan", done: owned.length > 0, title: t("planTitle"), href: "/plans" },
    { id: "project", done: projects > 0, title: t("projectTitle"), href: "/dashboard/projects/new" },
  ]}
/>
```

`app/dashboard/page.tsx` is the blueprint, with the queries behind it. Two
steps ship — buy a plan, top up a balance — and **they are meant to be
replaced** the moment your app does something of its own. Leave them and the
app's only advice to a new customer is "buy something".

How to choose what the steps *say* — the activation event they lead to, and
the rest of the first-session patterns (survey, wizard, sample data, the
comeback nudge) — is [`onboarding.md`](onboarding.md); the skill that walks it
is `user-onboarding`. This section owns the mechanics, that file owns the
content.

Three properties, and all three are load-bearing:

- **A step is done because the state says so.** There is no `onboarding_steps`
  table, no `dismissedAt` column and no cookie, and none of them is missing. A
  stored tick is a second copy of a truth the database already holds, and the
  copy is the one that goes wrong — the customer who buys on another device,
  the refund that takes the plan away again, the operator who grants access by
  hand. The reasoning is written out in `lib/onboarding/rules.ts`.
- **There is no dismiss button, and there must not be one.** The card leaves by
  being finished. A step that is not done is a thing the customer has not got to
  yet, and hiding it hides the only place the app says so.
- **A step that goes back to undone brings the card back.** A refund really did
  change what they hold. That is correct, and it is the case a stored tick gets
  silently wrong.

**Empty is not the same as broken, and the app has to say which.** Every list
that can be empty gets an `<EmptyState>` (`components/ui/empty-state.tsx`) with
a sentence and, where there is one, a button. A blank area is the second most
common way an app reads as faulty when it is merely new.

---

## 2. Every action reports back

The three mechanisms and when to use which are in `CLAUDE.md` § **UI**, rule 1.
They are not repeated here. Three things that file cannot say from where it sits:

- **The place feedback goes missing is the page boundary.** The code that knows
  something worked ends by sending the person somewhere else, and the page they
  land on says nothing. That is what `<FlashToast>` exists for, and it is the
  one people forget because it works on their machine, where they know what
  they just did.
- **A toast is not an acknowledgement of anything important.** It is gone in
  four seconds and it does not survive a reload. Anything the customer might
  come back to check — an access that was unlocked, a payment that went
  through — has to be readable in the app's *state* afterwards, not only in a
  message at the time. That is the whole reason the onboarding checklist ticks
  a step rather than the dashboard printing "thanks for your purchase".
- **The message never travels in the URL — the purchase is the worked
  example.** `<FlashToast>`'s query parameter carries a *reference* (an id),
  never the sentence itself: a URL carrying the sentence is a URL anybody can
  hand somebody else to make your app say whatever they typed. So
  `app/optin/[orderId]/page.tsx` redirects to `/dashboard?purchase=<id>`, and
  `app/dashboard/page.tsx` resolves that id through
  `purchaseNoticeFor(memberId, id)` — scoped to whoever is signed in — before
  naming the plan that was unlocked or the tokens that were credited. Copy
  that shape for any message that has to survive a `redirect()`.

---

## 3. Nothing is a dead end

Every screen answers "what now?". The ones that habitually do not:

| The screen | What it must not do |
|---|---|
| An empty list | end. `<EmptyState>` with the action that fills it |
| A plan that is paused (missed payment) | say nothing. `pausedKeys()` — "your access is paused", never a blank where the plan was |
| A balance of zero | offer nothing. The way to top up belongs on the page that reports the shortfall |
| A failed action | show a code. `lib/` returns codes, the Server Action translates them — `CLAUDE.md` § **Languages** |
| A gated page a customer may not see | 404. Say what unlocks it, and link to it |
| A destructive dialog | be ambiguous. Name *what* gets deleted, and make the confirm button `variant="destructive"` |

**The paused plan is the one worth testing by hand.** A missed payment makes the
plan disappear from `hasPlan()` and `entitlementsFor()`, which to the customer
looks exactly like an account closure, and is not one.

---

## 4. Words

Everything visible goes through `messages/de.json` and `messages/en.json` —
that rule, and the traps under it, are in `CLAUDE.md` § **Languages**.
What that file does not cover is what the sentences say:

- **Write what the customer sees, not what the code does.** "Grant revoked" is a
  column name. "Your access to Basis has ended" is a sentence.
- **An error says what to do next**, or it is a dead end with punctuation.
- **Never show an identifier to a customer.** Order ids, member ids and product
  keys belong in support tools, not on the account page.
- **Say the number.** "Your access ends on 3 August" beats "your access will end
  soon", and it is the same query.

---

## 5. Usable without a mouse

**Where this stands legally, in one paragraph:** the BFSG (European
Accessibility Act) has applied since 28 June 2025 and points at WCAG 2.1 AA —
but § 3(3) exempts micro-enterprises offering a service, which is fewer than 10
people **and** turnover or balance sheet total up to €2 million. Most operators
of this template are out of scope today and in scope the year they grow. The map
is `docs/compliance.md` § 6.1, and `compliance-check` is the skill that asks the
questions. Everything below is worth doing either way — it is the difference
between an app a person with a broken mouse can use and one they cannot.

What this template already gives you, as long as you use the kit:

- focus rings on every interactive element, from the shadcn primitives
- a keyboard-navigable sidebar, dialogs that trap focus and close on `Esc`
- token pairs measured against WCAG AA in **both** modes — `node run.mjs ux-check`

What you have to do yourself:

- **Name every icon-only button.** `aria-label`, or a `<span className="sr-only">`
  beside the icon. Without it a screen reader says "button" and stops.
- **Never say a thing with colour alone.** A red dot means nothing to a
  colour-blind customer and nothing at all to a screen reader. Use `<Badge>`
  with a word in it.
- **Give every image an `alt`** — `alt=""` when it is decoration, which is a
  decision and reads as one.
- **Keep the tab order the reading order**, and never remove an outline without
  putting a visible replacement in its place.
- **Respect `prefers-reduced-motion`** on anything that moves for longer than a
  transition.

**One thing this template does not meet, said plainly rather than left to be
discovered:** WCAG 1.4.11 asks for 3:1 on the visual boundary of a control, and
the shipped `--input` border on `--background` is well under that, as most
shadcn defaults are. `ux-check` does not fail on it, because a check that is red
on a fresh clone is a check everybody learns to ignore. It **does** fail on the
focus ring, which is the one a keyboard user cannot work without. If you are
inside the BFSG, darkening `--input` is one of the first things to do.

---

## 6. Small screens

Roughly half of a Digistore24 buyer's traffic arrives on a phone, and the
checkout return lands there too. Four things break and they are always the
same four:

- **Tables.** A `<Table>` does not wrap. Put it in a container that scrolls
  (`overflow-x-auto`), or render cards below `sm:`.
- **Dialogs.** A form in a `<Dialog>` on a 360 px screen needs its own scroll,
  or the submit button ends up under the keyboard.
- **Fixed widths.** `w-[720px]` is a horizontal scrollbar on the whole page.
  `max-w-` and a grid instead.
- **Images.** An image never scrolls — it scales to the width of its container
  (`w-full h-auto`, crop with `overflow-hidden`). The `overflow-x-auto` that is
  right for a table is wrong here: it hands the customer a scrollbar instead of
  a picture.

The shell itself is handled: below `md:` the sidebar becomes a `<Sheet>`.

### The icon on the home screen

The same phone can keep the app: `app/manifest.ts` makes it installable, and
`components/install-app.tsx` offers it — once in the dashboard from the second
visit, and permanently as *"Als App installieren"* under the user's name. Both
render nothing wherever installing is impossible or already done.

Three things to know before touching any of it:

- **The notice gets one showing, and that is not laziness.** On iOS there is no
  way to detect that the app is already installed while somebody is browsing in
  Safari. A notice that could return would return to people who already have the
  icon, which is why the permanent home is the menu entry.
- **On iPhone the installed app signs in separately** — it has its own cookie
  store, and the sign-in link from an email opens Safari instead. The install
  text says so; do not shorten it away. [`docs/mobile.md`](mobile.md) →
  *First: an icon, or an app?* has the full trap.
- **It is a `Callout`, and it is not sticky.** `AppShell`'s header is
  `sticky top-0 z-30`, and a second sticky element on that edge is the collision
  `components/impersonation-banner.tsx` documents.

---

## 7. Turning a dial without breaking it

The look has **four** dials and the list is closed — the accent, the radius, the
type and the elevation. Each is a named slot whose value is set once in
`app/globals.css` or `app/layout.tsx` and **never appears as a class on a page**;
where each one lives, and why opening a fifth is a change made in the template
rather than in an app, is [`design-system.md`](design-system.md) §8. Colour is
only the first of them, and the one with the trap `ux-check` exists to measure:

**`--primary` is a surface AND a text colour.** It is the button, and it is the
active menu item. A brand colour light enough to look right as a button can be
unreadable as a word on white — and the mode you were not looking at is the one
that breaks. `node run.mjs ux-check` measures both roles in both modes and tells
you the ratio. It measures the other three from the other side: a `font-[…]`,
a `shadow-[…]`, a bare `shadow-lg`, a hex in an arbitrary value or a shadow
naming any custom property but the two elevation roles is a value written past a
dial, and each hit says which dial it went past.

---

## 8. What the command settles, and what it cannot

```bash
node run.mjs ux-check
```

| It settles | It cannot |
|---|---|
| contrast of every token pair, light and dark | whether the wording is clear |
| the focus ring at 3:1 | whether the first five minutes make sense |
| every token defined in **both** blocks, not one | whether a flow has a dead end |
| a value written past a dial — `font-[…]`, `shadow-[…]`, a bare `shadow-lg`, a hex in an arbitrary value, `font-heading`, a shadow naming any variable but the two elevation roles | whether the empty state says the right thing |
| hard-coded colours and hand-built elements | whether the look somebody chose is the right one |
| icon buttons with no name, images with no `alt` | anything that needs the app running |
| pages under `/dashboard` that nothing leads to — no menu entry AND no link, `[param]` pages included | |
| a file whose raw TEXT compiles to a broken CSS rule — a `var()` whose first argument is not a custom-property name, a `url()` the bundler cannot resolve | whether a THIRD reader exists; two have been measured |

A green run means the countable things are counted. **It is not a verdict on the
app.** The verdict is `ux-gateway`, which reads the pages, runs the app and
writes a dated report into `docs/reports/`.

### Why the raw-text row is here at all

That last row is the only one whose failure you meet as **every page answering
500** — Tailwind reads every file in the app as raw text, comments included, and
turns a class written to EXPLAIN a mistake into a real rule
([`conventions.md`](conventions.md) → *Never write a bracketed arbitrary Tailwind
class in prose*). It has been guarded since it happened, by
`scripts/tailwind-raw-text.test.ts` under `npm run test`. The reason it is in
this command too: after a 500 nobody runs the test suite, they run `ux-check`,
and a finding that arrives only from the place nobody goes to in that moment
arrives late.

**It is not a second check.** The scanner, the tree walk and the needle are
`scripts/ux/tailwind-raw-text.mjs`; the test file and this command call the same
functions, so the two can never disagree. And the green line says *against the
two readers that have been measured* rather than "nothing can break" — that
honesty is load-bearing, because a third reader has not been ruled out.
