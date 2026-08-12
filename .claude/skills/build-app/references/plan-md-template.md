<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The `docs/plan.md` template

_Read from `build-app`, step 1f, and from `market-research`, phase 5: the shape
of the file that says what is still TO be built. Copy it when creating the file,
and keep it, so the list reads the same in every session._

```markdown
# <App name> — what is still to be built

_The agreed picture, in plain words. A line here is something the customer will
be able to DO — never a task, a file or a table. It moves to docs/app.md the
moment it exists and its tests are green, so what is left in this file is
always what is still ahead. docs/product-brief.md says what the product is;
this says what is not there yet._

## Settled before the first page

- **Sells:** <what a customer buys — docs/product-brief.md carries it in full>
- **For:** <who>
- **Archetype:** <from step 1>
- **Bills:** <one purchase | subscription | by usage>
- **Look:** <"docs/design.md — <the direction chosen>", or "the shipped look,
  decided <date>">

## What the customer will be able to do

- [x] sign in and find their own dashboard (built <date>)
- [ ] buy <the plan> and reach <what it unlocks>
- [ ] hand in <the thing> and get <the finished thing> back
- [ ] <one line per thing the customer will be able to do, in the order they
      will be built>

## Not in the first version (decided, not forgotten)

- **<the thing that was asked for>** — <date>: <why not, in the words it was
  said in: "the vendor writes those themselves", "it costs money on every use
  and is not wanted yet">
- **<the thing>** — <date>: <the reason>
```

**The last section is why this file exists twice over.** `docs/app.md`'s
*Decisions worth remembering* holds a declined **skill** — no custom identity,
no companion. Declined **scope** had nowhere to go: a feature the user said no
to while the end picture was being agreed left no trace at all, so it came back
as a proposal three sessions later, from an agent with no way of knowing it was
settled. The rule `coach` works by — **a recorded "no" is an answer** — can only
reach what somebody wrote down.

**And what is deliberately NOT in here.** No ids, no estimates, no acceptance
criteria, no file per heading, and no status vocabulary beyond the checkbox: the
`##` headings and the `- [ ]` lines are the whole structure, and the user never
has to learn a word for either. The audience is somebody whose whole promise is
*"say 'Build my app' and it happens"* (`README.md`) — every line is a sentence
they could read out loud, or it does not belong in the file.
