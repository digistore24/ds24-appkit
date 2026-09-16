<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

## 2 · `first-run` — the first five minutes

**Do this as the customer, in order, and write down what you did not
understand.** Not what you would improve — what you did not understand. The
second list is short and it is the one worth acting on.

The walk:

1. Land on `/` as a stranger, and hold it to five questions: **what is this
   and what do I get, by the names the app uses; who is it for; what does it
   cost; why should I believe you; what do I click?** All five answered
   within one scroll — and two more looks: is there
   anything to *see* (a screenshot, a cover, a product image — three icon
   cards are not a visual), and does the primary button reach a real
   Digistore24 checkout rather than `/login` or a dead anchor?
2. Go to `/plans`. Is it clear what each plan gives you?
3. Buy one (test purchase — `setup-digistore` explains the cookie), land back
   through `/optin/[orderId]`.
4. **Stop on `/dashboard` and look at it as somebody who has just paid.** Does
   anything on this page confirm the purchase? Does anything say what to do
   next? Now **reload it** — is that still true?
5. Do the thing the app is for. Count the clicks and the guesses.

What to look for, and what the template already gives you:

| Question | Where the answer lives |
|---|---|
| Does the app say what to do first? | `<OnboardingChecklist>` on `app/dashboard/page.tsx` — steps derived from real state, `lib/onboarding/rules.ts` |
| Do the steps mean anything for THIS app? | the two shipped steps (buy a plan, top up) are a **blueprint** and are meant to be replaced |
| What should the steps say instead? | [`docs/onboarding.md`](../../../../docs/onboarding.md) — the activation event, and 3–5 milestones toward it |
| Does the purchase survive a reload? | it has to be visible in the app's state, not only in the toast (`docs/ux.md` §2) |
| Is every empty list explained? | `<EmptyState>` with a sentence and, where there is one, a button |

**The finding that is almost always there on a young app:** the checklist still
holds the two shipped steps, so the app's only advice to a new customer is "buy
something" — while the thing they bought sits behind a menu entry nobody
mentioned. That is ❌ HIGH, and the fix is three lines in
`app/dashboard/page.tsx`. *Choosing* what the steps should be — the activation
event, and whether this app wants a survey or a nudge around them — is the
skill **`user-onboarding`**; report the finding here and hand over there when
the user wants it built.

**Two more named findings, both on `/`:**

- **The home page is still the shipped placeholder — or a re-texted one.** The
  tell is structural, not verbal: the three-card grid with the template's
  key/cart/sparkles icons, no visual, no proof, no offer block. Swapped texts
  do not change the diagnosis — the page still has the shape of a README.
  Before a launch that is ❌ HIGH: the first page a stranger sees sells the
  template, not the product. Building the real page is the skill
  **`salespage`** (the reference is `docs/salespage.md`); report the finding
  here and hand over there.
- **The "pricing section" is the `/plans` table verbatim** — the catalog card
  reused as the offer, six checkmark bullets from the product registry and no
  argument around them. ⚠️ MEDIUM; the offer-block-versus-catalog reasoning is
  `docs/salespage.md` § 6, and the fix is `salespage` too.
