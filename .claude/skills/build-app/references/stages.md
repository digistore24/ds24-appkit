<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Stages — what happens after the yes, one line of the plan at a time

_Read from `build-app` → *After the yes* and from Step 4. The yes to the end
picture starts the FIRST stage, not the whole list; this file says what a stage
is, what it has to satisfy before it is handed back, the words to hand it back
with, and what to do when a session was cut in the middle of one._

## What a stage is

**One `- [ ]` line of `docs/plan.md`** — one thing the customer will be able to
DO, in the order the lines stand. Not a file, not a table, not a test run;
those are what a stage is made of. Roughly ten minutes of building each, and
"roughly" is a claim you check against the clock, not a promise you keep by
cutting corners: a line that turns out to be twenty minutes is two lines, and
you say so before you start it.

**The first stage carries the whole agreed data model.** Steps 1b–1d decided
the columns; a second migration for something the first could have carried is
the mistake the skill warns about twice. A later stage touches `db/schema.ts`
only where its line needs a column nobody could foresee.

## What a stage has to satisfy before it is handed back

Every item, every time — a stage that skips one is not done, it is abandoned:

1. The pages and logic of its line exist, gated through the entitlement API
   where the line depends on a purchase — and every table the line added that
   is keyed on the member has its row in `docs/data-protection.md` and its
   section in `lib/privacy/export.ts` (the customer's quotes are her data).
2. `npm run typecheck && npm run test` green — `node run.mjs test` does both.
3. `node run.mjs start && node run.mjs smoke && node run.mjs errors` clean,
   with the signed-in pass really run (Step 4's `NOT checked` line read).
4. **If you can open a real browser, look at it now** — `smoke` proves every page
   answers, not that it looks right. If you have none, `ux-gateway` explains how
   to offer the user the Playwright MCP server (a one-minute change to their own
   program, not to this app); seeing the pages once now is cheaper than meeting
   them broken in the `ux-gateway` pass later. **To fetch a page as the owner
   from a script of your own** — a PDF to save, a page to diff — use what
   `smoke` uses: `import { signInAsOwner } from "./scripts/dev/sign-in.mjs"`,
   `const r = await signInAsOwner("http://localhost:3000")`, then
   `fetch(url, { headers: { cookie: r.cookie } })`. It answers `{ cookie, as, role }`,
   or `{ skipped, reason }` when there is no owner yet (the reason names the
   `user-create` command — step 3b), or `{ refused }`; DEV only. Run once on
   2026-09-03: skipped before the owner existed, then `/dashboard` 200 with the
   cookie and 307 without. Sessions used to read the 200-line script 22 times
   to find this.
5. **Committed**, on green, with the migration in the commit. Not at the end of
   the build — at the end of THIS stage, because the commit is what makes the
   stage survive whatever ends the next turn.
6. Its entry in `docs/app.md` (Step 4b), and its line in `docs/plan.md` ticked
   with the date.

## The hand-back — and then the turn ENDS

Say it in plain words, and then stop. Not "next I will…" followed by doing it:
the customer decides whether the next stage starts, and the decision is only
real if the turn is over when they read this.

> "Stage 2 of 5 is done: **you can now buy the monthly plan and reach the
> members' area.** Open http://localhost:3000, sign in with any address, and
> you'll see the plans page and, after a test purchase, the area behind it.
>
> Next would be stage 3, *hand in a photo and get a written assessment back* —
> about ten minutes. Say **go**, tell me what to change first, or say **run
> through** and I'll build the remaining stages without stopping to ask."

Three answers, all valid, none negotiated:

| | |
|---|---|
| **go** (or the next stage's number) | start it — a new turn, the same checklist |
| **a correction** | fix it inside THIS stage first, hand back again, then ask again |
| **"run through" / "don't stop"** | write `- **Pace:** run through without stopping — asked for on <date>` into `docs/plan.md`, and from then on hand each stage back in one paragraph WITHOUT the question, in the same turn. Never ask again in this project: a session that reads the `Pace:` line has its answer |

**The address is not optional.** A hand-back that says "done" without saying
where to look leaves the customer with nothing to open — measured in a field
run whose closing line was *"fertig gebaut und läuft"* and named no page.

**The LAST hand-back names what is still a placeholder.** "Alles fertig" with
the home page still describing the template, the legal pages still saying
"not filled in" and no Digistore24 product behind the buy button is finished
code, not a finished product — so the closing paragraph says which of the
three the path still owes and which skill does it: `salespage` (2.4),
`compliance-check` (2.8), `setup-digistore` (2.2). Measured: a closing text
that named only the last of the three, over a home page that said "Dieses
Template ist für den Verkauf über Digistore24 vorbereitet".

## Why the turn ends here — say this once, in the announcement, not every time

The person at the keyboard may be on a plan whose usage window is five hours
and whose one long turn spends most of it; this template cannot see which plan
that is, so it works the same way for everybody. Three things follow, and they
are the reasons, in the customer's words if they ask:

- **A window can end in the middle of a turn.** A build that runs forty
  minutes in one turn and is cut at minute thirty leaves half an app that does
  not start — and no more turns until the window resets. A stage that ends
  with a running app loses at most the stage after it, never the app.
- **Ten minutes in, they see something.** From the other chair a forty-minute
  turn is indistinguishable from a program going in circles, however often it
  narrates; a page that opens is not.
- **Every stop is a rewind point.** Claude Code checkpoints on each of the
  customer's messages, so a stage boundary is a place they can go back to.
  One boundary per build is one place; one per stage is five.

And it costs the customer who does not need it exactly one sentence — "run
through" — which is why the default is the careful one.

## When a session was cut in the middle of a stage

A new session in this project reads two things before it does anything:
`docs/plan.md` and `git status`. **An unticked line together with uncommitted
files is an interrupted stage**, and it is finished FIRST — not started over,
not skipped, not left beside a new one. Say which line it is, look at what is
there, and carry that stage through the checklist above to its hand-back. Only
then the next line.

If the customer needs the app running NOW and the interrupted stage is far from
green, `git stash` parks the half-built stage and the last committed one
starts; the stash is then the interrupted stage, and it comes back before
anything new. What the customer sees when a window ends, and what to tell them,
is `docs/troubleshooting.md` → *The build stopped half-way — a usage limit,
not a bug*.

## Not for an experiment

Same boundary as everywhere in this skill: "Hello World" or a page to get a
feel for the template is one thing, built in one go, no plan, no stages, no
question afterwards.
