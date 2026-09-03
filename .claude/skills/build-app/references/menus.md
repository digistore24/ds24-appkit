<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The menus — one file per step

_Read from `build-app`. Each step's verbatim menu, its confirmation wording and
the `docs/app.md` entry that records a no live in their own file, so that step
1b reads 1b's page and not 1c's as well — measured: this file used to hold all
of them and was read whole, 16 k characters, nine times in nine field runs, for
one step each time._

| Step | File |
|---|---|
| 1b — what the customer gets to SEE | [`menus-1b.md`](menus-1b.md) |
| 1c — what the app DOES alongside the customer | [`menus-1c.md`](menus-1c.md) |
| 1d — what the customer DOES, and how it is judged | the skill `learning-activities`, item `decide` |
| 1e — how should it look | below, and [`menus-look.md`](menus-look.md) only on the fall-through |
| 3 — the same question, once per surface | [`menus-3.md`](menus-3.md) |

## Step 1e — how should it look?

**First: this step is a precondition, and usually there is nothing to ask.** The
look belongs to phase 1 of the path, so `design` has normally already run by the
time `build-app` does. Two files answer the question outright, in this order:

| Read | What a find means |
|---|---|
| `docs/design.md` | this app has chosen. Name the direction it records in ONE sentence — that is the look Step 3's pages follow — and go to Step 1f |
| `docs/app.md` → *Decisions worth remembering* → **No custom identity** | the shipped look was chosen, deliberately and with a date. Say so in one sentence and go to Step 1f |

**Neither is re-opened here.** A recorded answer that gets asked again is an
answer the user stops trusting, and `design` Step 0 makes the same check for the
same reason. Whoever wants a change goes to `design`, which edits
`docs/design.md` first and applies it after.

**Everything below the two files above is the fall-through only** — nothing on
disk, which means the user came straight through the "Build my app" door and
skipped phase 1. Then the question is asked here, once, in the grammar of 1b–1d:
the material to look for first, the menu's one home in `design`, what a `0`
records, and why this menu alone carries no ✅ are in
[`menus-look.md`](menus-look.md). 🚨 **Read that file only in that case** — on
the normal path the two files above have already answered, and re-asking a
recorded answer is the one thing this step must not do.
