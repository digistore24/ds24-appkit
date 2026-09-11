<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Never ship a broken page — what proves a page works

Green tests and a successful build do not rule out an app that greets its user
with "Internal Server Error". `CLAUDE.md` → *Never ship a broken page* carries
the rule: before "done" is said, the page is called up. This page carries what
each of the three commands sees, what their verdicts mean, and why a component
is checked this way rather than in a unit test.

## The three commands, and what each one sees

```bash
node run.mjs start                # DB + migrations + app
node run.mjs smoke                # calls EVERY page and reports server errors
node run.mjs errors               # what the log picked up — including on a 200
```

All three see the SERVER; a page is seen in a browser. Without a browser tool,
ask, then `node run.mjs agent-browser --apply` gives you one for the next
session.

`smoke` finds the pages itself under `app/` and calls them in **two passes**:
first anonymously, then signed in, so the pages with the real queries get
rendered rather than counted as redirects. Locally the second pass runs as the
owner through the development sign-in; against a deployed app it runs as the
smoke member, provisioned once with `node run.mjs smoke-account`. **When the
second pass is unavailable it says so, in one line — read it**: *"9 protected
page(s) NOT checked"* is not a pass, and those nine are the ones carrying the
real queries.

## The verdicts

| `smoke` reports | Means |
|---|---|
| **5xx** | an error. Fix it, don't argue it away, don't pass it on as a "known issue" |
| **307 to `/login` without a session** | correct, and says nothing about the page — the second pass is what renders it |
| **307 to `/login` *with* a session** | an error: the session did not take |
| **307 anywhere else while signed in** | fine — a `hasPlan()` gate from the outside, sending a member without the plan to `/plans` |
| **a redirect to a `localhost` origin, on a DEPLOYED app** | an error, and the one with no second symptom: the origin sits one level down, in the `callbackUrl` query. It means `APP_URL` at the host, never `AUTH_TRUST_HOST` — [`troubleshooting.md`](troubleshooting.md) → *The sign-in link points at `localhost`* |
| **2xx** | the page loaded. Not that it is correct — see the next section |

Two things `smoke` cannot see, by construction: **dynamic pages** (`[id]`) —
it has no id to put there — and **any account but the one it is signed in as**.
Money, roles and customer data need your own eyes: open the page as the member
who bought, and as the one who did not.

## The errors a 200 hides

```bash
node run.mjs smoke  --url https://your-app.example    # every page, called once
node run.mjs errors --url https://your-app.example    # what its log picked up
```

A page that answers 200 and renders the wrong date, drops a translation or
mismatches its hydration is a broken page with a green status code, and nothing
about the status code will tell you. `errors --url` asks the deployed app for a
bounded, redacted window of its own stderr over `DIAGNOSTICS_SECRET`.

The routine, and how each answer is rated, is `CLAUDE.md` → *Never ship a broken
page*. Getting the app onto a host so that there is something to ask at all is
[`docs/DEPLOY.md`](DEPLOY.md).

**A page fetched as the owner, from a script.** Locally, `scripts/dev/sign-in.mjs`
exports `signInAsOwner(baseUrl)` — what `smoke`'s second pass uses. It answers
`{ cookie, as, role }` (send `cookie` as the `cookie` header), `{ skipped, reason }`
when no owner exists yet (the reason names the `user-create` command), or
`{ refused }`; DEV only, because it goes through the development login. That is
the whole API; the script does not need reading.

**How these are misread.** `smoke`'s line *"9 protected page(s) NOT checked"* is
**not** a pass — those are the pages carrying the real queries; provision the
sign-in once with `node run.mjs smoke-account --apply` and run it again.
The other line to read rather than skim is *"N of M dynamic API route(s)
exercised"*. Against a **deployed** app that number is **0**, and it is not a
defect: the pair behind it — `/api/media/[id]` asked as the item's owner and
then as nobody — needs one item planted through the upload door, and `smoke`
reads a deployed app without writing to it. (The one thing this template does
put into a deployed app, the smoke account, is its own `--apply` command for
exactly that reason.) Run `node run.mjs smoke` against a local app to exercise
it; every route in that list carries the reason it was not.

**What `smoke` does not reach at all.** It skips dynamic **pages** (`[id]`)
entirely — only dynamic API routes are exercised, and only against a local app —
and it is signed in as exactly ONE account. Money, roles and other people's data
are therefore outside what it can answer, whatever colour it prints: those need
your own eyes on the page, as the account that is supposed to see it and as one
that is not.
`errors --url` exits **1** for *found something* and **2** for *could not look*,
and the refusal never prints a `✓`. Its window lives in one instance's memory
and empties on every restart, which is why the success line always names the
window it read.


## What checks a component, and why it is not a unit test

`vitest.config.ts` runs with `environment: "node"` and no DOM. That is a
decision, not an omission, and it is worth knowing before you write your first
component test — because the thing it protects you from is the failure this
whole repo is organised against.

**What checks the pages is the running app.** `node run.mjs smoke` calls every
page twice — anonymously and signed in — and `node run.mjs errors` reads what
the log picked up, including on a clean 200 (CLAUDE.md → *Never ship a broken
page*). A rendered-in-isolation test would tell you a component returns markup;
those two tell you the page a customer opens actually works, with a real
database, real translations and the real layout around it. For an app whose
pages are mostly composition over a design system, the second question is the
one worth paying for.

**And a green BUILD rules out even less.** `npm run build` checks compilability
— with no database and no real `.env` — so a page that greets its first visitor
with *Internal Server Error* is perfectly compatible with a clean
`npm run typecheck`, a green suite and a successful build. The three of them
together answer *does it compile and is the logic right*; none of them answers
*does the page come up*.

⚠️ **A JSX test is COLLECTED, and it fails saying what is missing.** `include`
is `**/*.test.{ts,tsx}` on purpose: with `.ts` alone such a file is not
rejected, it is silently not collected — `vitest run` stays green and never
mentions it. Now it runs and fails with `document is not defined`, which names
the missing piece instead of hiding the test.

**Where the server-side gaps are, ask the report rather than guess.**
`npm run test:coverage` prints a summary and writes `coverage/`. It has no
threshold and is not in `npm run test` — a percentage would be the wrong
instrument here, because the files at 0 % include the `ui.tsx` this project
deliberately checks another way, and a gate that asks for the wrong thing is the
one somebody removes. What it is FOR is the list: server logic at or near zero.
Read on 2026-08-13, that list named `lib/impersonation/session.ts` (0 %, and its
one `operatorId !== caller` comparison is what the whole feature rests on),
`lib/credentials/manage.ts`, `lib/email-change/manage.ts` and
`lib/digistore/claim.ts`.

**If a unit test really is the right tool** — a hook with awkward arithmetic, a
component whose logic cannot be reached through a page — the usual answer is to
pull the logic out into a plain function and test that; every `rules.ts` in this
tree is that move. Where it genuinely is not, add a DOM environment yourself:

```bash
npm i -D jsdom @testing-library/react @testing-library/jest-dom
```

…and give the file its own environment rather than switching the whole suite
over — `// @vitest-environment jsdom` at the top of that test. A tree-wide
change would put a DOM under 349 files that neither need one nor are written
for one, and slow every run to buy it.
