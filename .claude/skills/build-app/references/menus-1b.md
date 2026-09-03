<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Step 1b — the menu, the confirmation and the recorded no

_Read from `build-app` step 1b, and from nothing else. The rule — three answers,
a `0` that is an answer and is not negotiated, skipped for an experiment — stays
in the skill; this is the wording._

## Step 1b — what the customer gets to SEE

The confirmation when `docs/product-brief.md` already answers it:

> "The brief says: *a finished sales page with a hero image*. So each page needs
> one picture — generated (~$0.05) or uploaded. Generated?"

The menu:

```
What should your customer get to see?

  1  a picture with every challenge message     ✅   upload or AI      ~$0.05 each
  2  "how far you have come" as a bar           ✅   your own data     nothing
  3  a welcome video on the start page               embed             nothing
  4  a picture the participant uploads themselves    upload            storage

  0  none of it — text only

Give me numbers, or say "you choose" and I take the ones marked ✅.
```

**Two archetypes have a single ✅**, and for them this is one row rather than a
menu — ask it as a yes/no and move on. The ✅ column is the starting point, not
the whole list: add a row when this particular app obviously wants one (a
participant uploading their own picture, say). What you must not do is drop the
step because the list is short.

The recorded no — the entry for `docs/app.md` under *Decisions worth
remembering*. **It opens with a fixed sentence and the app's own words follow**,
the way Step 1e's entry does:

```md
- **No customer-facing visuals.** Decided on <date>: no pictures in the challenge
  messages — the vendor writes them themselves and has no picture material. If it
  comes back, the way in is `docs/visuals.md` → *Putting files in*.
```

🚨 **The string `No customer-facing visuals` is load-bearing** — it is the marker
that says pictures were declined rather than forgotten, and it is read back as
one: the skill `visuals` stops on it in its own Step 1 and does not propose the
step again. The sentence after it is this app's own, because "challenge messages"
is whatever its archetype calls them — write that in the app's words and leave
those three exactly as they are. **The date goes on that same line**, as it does in
Step 1e's entry: a refusal is read back so it can be REVOKED, and a reader that
finds no date beside the marker reports the "no" without one.

That entry is the whole reason to ask rather than to assume: without it the
same suggestion arrives again in three sessions, and somebody spends the
conversation a second time.

### The three answers, for this step

- **Numbers** → exactly those, and nothing else.
- **"you choose"** → the ✅ rows, no further question. Offer it in the menu
  itself every time; somebody who trusts the suggestion should not have to read
  four rows to say so.
- **`0`** → text only, and **write it into `docs/app.md`** under *Decisions
  worth remembering* — the verbatim entry is the one above.

**Two things not to do here.** Do not ask what a picture should *look* like —
that is the customer's business, at the moment they use the app, not a decision
to make at build time. And do not turn a `0` into a negotiation: it is an
answer, and a skill that argues with it teaches people to stop answering.

**Skip this step entirely for an experiment.** Same boundary as the SAAS rule in
`CLAUDE.md`: somebody trying the template out gets the small thing they asked
for, without a menu.
