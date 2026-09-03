<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Step 3 — the same question, once per surface

_Read from `build-app` step 3, and from nothing else._

## Step 3 — the same question, once per surface

**One question per result surface, asked while you build it:** wherever a page
hands the customer a RESULT, ask once whether it is a result to look at. Not a
menu this time — Step 1b already settled what this app shows. This is the
smaller, per-page version of it, and it exists because Step 1b decides the
product while this decides a page nobody thought about at the time.

**And one question per surface that takes work IN, asked the same way:**
wherever a page takes a submission, an answer, a photo or a plan from the
customer, ask once whether they should get back more than a confirmation that it
was saved. Not a menu — Step 1c already settled what this app does. This is the
page nobody thought about at the time.

Ask it **while that surface is built**, not later. The gateway that audits this
afterwards is `ux-gateway`, and a question deferred to it is a question asked
after the customer has already used the page.

A page that returns nothing but paragraphs is a decision, and so is a page that
answers work with nothing but "saved" — so make both visible: either put
something there, or note in `docs/app.md` why not.
[`docs/visuals.md`](../../../../docs/visuals.md) is the reference for the first
(what the store can hold, how a picture gets on a page, what one generated image
costs) and [`docs/ai-providers.md`](../../../../docs/ai-providers.md) → *Working
alongside your customer* for the second.
