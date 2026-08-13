<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Conventions — the rules that are not refusals

`CLAUDE.md` → *Rules* carries the refusals: the lines where doing it the other
way is a defect with a customer on the other end. This file carries the rest —
the conventions somebody working here has to know once, whose reasoning is a
paragraph rather than a sentence. Each of them exists because it was got wrong,
measured, and then held by a test.

## A checker that reads source as TEXT goes through `blankComments()`

`scripts/lib/source-text.mjs` — never its own regex.

A dozen checks here work by walking the tree for a needle: a forbidden tool, a
`sql<Date>`, a hard-coded colour, a module name in a core file. Each has to blank
the comments first or it reports the file that DOCUMENTS the rule as breaking it.

🚨 There was one copy of that per checker — sixteen, in four behaviours — and
three of them let a `//` comment containing `/*` open a phantom block that
swallowed every line down to the next `*/`. Measured: a `sql<Date>` eighteen
lines into a file left `db/sql-cast.test.ts` **passing**.

The shared helper blanks line comments FIRST, and turns content into spaces
rather than removing it so reported line numbers stay right.
`scripts/lib/source-text.test.ts` refuses a seventeenth copy. A checker that
walks files which GENERATE source wants `blankEmittedCode()` instead.

## A checker that WALKS imports goes through `resolveImport()`

`scripts/lib/import-graph.mjs` — never its own `@/` branch.

Three tests here assert something about a file's transitive import graph, and
each had a copy of the rule: one resolved the alias, two skipped it with the
comment *"npm package or alias — not walked"*. So two guarantees that said
**transitively** covered relative paths only, and one of the two threw an
`ENOENT` on a specifier it could not find instead of reporting it.

The helper answers **three** states, not two — not ours, ours and found, ours and
missing — because "I could not look" and "there is nothing there" are the same
colour everywhere else in this app too. `scripts/lib/import-graph.test.ts`
refuses a fourth copy.

## A script that reads `--flag value` goes through `flagsFrom()`

`scripts/lib/args.mjs` — never its own `indexOf`.

**A flag that is present without a value is a REFUSAL, never a guess.** There
were **eight** copies of that six-line function under `scripts/` and
`modules/`, in three semantics, and the difference is not cosmetic — it decides
what `--email --apply` means.

`scripts/setup/mint-key.mjs` refused it, and wrote down why: with one owner in
the table the command would otherwise mint a key for them and report success,
for a person who never named anybody. Five others took the next token whatever
it was, and one wanted the full `--name` spelling, so a call written like every
other one in the tree silently found nothing.

🚨 **What that cost, measured.** `scripts/setup/bootstrap.mjs` — the script that
creates an environment's FIRST OWNER and its first setup key — was safe on
`--email --apply` only by luck, because an `@` check three lines further down
happens to refuse `"--apply"`. It was **not** safe on `--env --apply`: that fell
through to `SETUP_KEY`, so an operator who meant `--env prod` bootstrapped
DEVELOPMENT and was told it worked, while `--apply` stayed true because that one
is read with `includes()`.

The failure modes are not symmetric, which is why the strict reading won:
refusing costs a re-typed command, guessing writes a credential nobody asked
for. `scripts/lib/args.test.ts` refuses a ninth copy — with a needle probe, so a
regex that matched nothing cannot make it green. A script that needs a per-flag
example in its message imports `flagValue()` and keeps only the sentence
(`scripts/ai/check.mjs` is the one case).

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

## A `.mjs` beside a `.ts` — always import it by its extension

Some rules live in a `.mjs` rather than a `.ts` because a plain-Node script has to
run them. `node run.mjs legal-check` is given **no `needs`** on purpose: it has to
work in a half-set-up project with no bundler, no `node_modules` and no database,
so it cannot import TypeScript. `lib/ai/disclosure.mjs`, `lib/ai/task-rules.mjs`,
`lib/ai/pricing.mjs`, `lib/ai/knowledge-files.mjs` and `lib/media/sigv4.mjs` are
that arrangement.

**Every import of such a file names the `.mjs`** — Node's ESM resolver requires the
extension anyway, and writing it is what keeps the specifier pointing at one file.
A `.ts` of the same stem is allowed only where the two halves are held together on
purpose: as a typed DOOR onto the one implementation (`lib/credentials/hash.ts`
re-exports `./hash.mjs`, `lib/media/sigv4.ts` puts shapes on `./sigv4.mjs`), or as
two spellings of one query with a test comparing them
(`modules/*/privacy/sections.{ts,mjs}`, held by `scripts/modules/privacy.test.ts`).
What must never appear is a second copy nothing compares.

🚨 **What breaks otherwise, and it breaks silently.** `tsconfig.json` sets
`moduleResolution: "bundler"` with `allowJs`, so an extensionless
`@/lib/ai/disclosure` resolves to a `disclosure.ts` for `tsc` and for the bundler,
while the plain-Node scripts keep reading `disclosure.mjs`. The app and its own
checker then answer out of different files under one name, and `npm run typecheck`
is green for both — which is exactly the hand-kept mirror `lib/ai/disclosure.mjs`
was created to end.

## 🚨 Never write a bracketed arbitrary Tailwind class in prose

A comment is not a comment to Tailwind. It scans every file here as RAW TEXT —
`.tsx`, `.md`, `CLAUDE.md`, a test fixture — and emits a rule for anything that
looks like a utility, so a class written to EXPLAIN that it is wrong becomes a
real rule.

Two contents take the whole app to 500 while `npm run typecheck` is clean and
every test is green: a `var()` whose first argument is not a `--` name (the
stylesheet does not parse) and a `url()` with a relative specifier that is not a
file (it does not build). Measured, in Story 43.7 and again since: **eight pages
down**, and `rm -rf .next` needed because Turbopack keeps the broken rule across
a restart.

Say what the form is in words instead — `app/login/ui.tsx` is the shipped example
of doing that on purpose. The guard is `scripts/ux/tailwind-raw-text.mjs`, it is
the one checker here that deliberately does NOT blank comments (that is where the
needle is), and it has **no exemption marker**: there is no safe way to write
these, including to warn about them.

**Two callers, one implementation.** `scripts/tailwind-raw-text.test.ts` runs it
under `npm run test` and holds every measurement it was built from;
`node run.mjs ux-check` runs it as well, because the failure's only symptom is a
500 on every page and that is the command a person reaches for afterwards. Both
report *what was measured* — the two readers above — and never completeness: a
third reader has not been ruled out, and a check that claimed otherwise would be
the one lie this whole rule's history warns about.

## A type on a query is a claim, and raw SQL does not keep it

Drizzle converts a column. It never converts raw SQL — a ``sql`…` `` expression
has no mapper, so a timestamp arrives as the Postgres string and the page breaks
at a clean 200. ``sql<Date>`min(created_at)` `` is a string wearing a `Date`'s
clothes; `db/sql-cast.test.ts` fails on any Date-typed `sql<…>`, and
`sql-cast-ok` exempts a line that genuinely must say it.

**Never "fix" it with `new Date(value)`** — the string has no zone marker, so the
timestamp silently shifts by the host's offset. The three ways out, each one
line:

- ``sql`…`.mapWith(grants.createdAt)`` — borrow the column's mapper
- `sql<string>` + `to_char(…)` — make it honestly a string
- select the column and aggregate in JS

**What does the converting is drizzle's COLUMN mapper**, not a driver setting —
`db/index.ts` deliberately carries no `types:` option, because `drizzle(client)`
overwrites every date handler on the client it is given. `db/timestamp-utc.test.ts`
is the guard on that, and `applierSql` is that same mutated client: it hands out
strings for date columns and throws on a bound `Date`.

## A script's own client is not drizzle's

Everything under `scripts/` and `modules/*/` is bare Node with a bare postgres.js
client, and there postgres.js's defaults are wrong in both directions: it reads
a `timestamp` in the **process's** zone, and it types a bound `Date` as
`timestamptz`, which makes Postgres convert the **column** in the **database
session's** zone. The second one moved a retention boundary far enough to delete
rows that were still inside it (measured, `troubleshooting.md`).

- **Open every client with `connectUtc()`** (`scripts/lib/pg-utc.mjs`), never
  `postgres()` — `scripts/lib/pg-utc.test.ts` refuses a second way in. Reading is
  then right with nothing else to remember.
- **A date going INTO raw SQL is `sql.typed.utcTimestamp(value)`**, always. The
  bare `${date}` is refused at bind time with the fix in the message.

## Dates that stop being dates

- **A `Date` that crossed JSON is a string despite its type** — convert on
  arrival. `Response.json({ rows })` turns every `Date` into an ISO string while
  the TypeScript type still says `Date`.
- **Every nullable date MUST be guarded at the call site.**
  `format.dateTime(null)` renders *1 January 1970*, `undefined` renders *today*,
  and neither throws nor logs, so no log check can catch either.
- **`accessUntil` and every other end-of-day value is rendered with an explicit
  `timeZone: "UTC"`** — [`entitlements.md`](entitlements.md) → *`timeZone:
  "UTC"` is load-bearing* carries the reasoning and the case that makes it
  sharpest (31 December, where the unpinned reading is the following YEAR).

The full post-mortem, with the measured example and the shape of the guard, is
[`troubleshooting.md`](troubleshooting.md) → *Dates and raw SQL*. What Drizzle
does with a column, and where the migration path runs, is
[`database.md`](database.md).

## Text, dates and prices — the formatting side of i18n

`CLAUDE.md` → *Languages* carries the refusal (no visible text in the code, both
language files, always). These are the mechanics.

```tsx
// Server component (client components: useTranslations)
const t = await getTranslations("users");
<h1>{t("title")}</h1>

// Text with markup (e.g. <code>) — don't stitch it together:
t.rich("hint", { code: (chunks) => <code>{chunks}</code> })
```

- **Dates and prices are formatted, never spelled by hand.**
  `useFormatter().dateTime(…)` or `formatPrice(def, locale)`, never
  `toLocaleDateString("de-DE")`.
- **A price is only *written* differently, never converted.** What gets billed is
  what is on file at Digistore24, and a conversion in the app would put a number in
  front of the customer that the checkout then contradicts.
- **Error messages never come into being deep in the code.** Rule and database
  layers return *codes* (`lib/users/rules.ts` → `"selfDelete"`); only the Server
  Action translates them (`app/dashboard/admin/users/actions.ts`). A sentence born
  in `lib/` is always in exactly one language.
- **Only one file maintained is the failure this is guarded against.**
  `i18n/messages.test.ts` breaks the build when one language is missing a key, a
  placeholder or an error code. It is the reason the second language does not rot,
  and it is never switched off.

**Not translated, deliberately:** product names, plan features and descriptions from
`config/digistore-products.json` — that is your product copy, and at Digistore24 the
same text is on file. Likewise the app name (`lib/app.ts`) and the terminal output of
the scripts under `scripts/`.

**A third language** is a file in `messages/` plus its code registered in
`i18n/config.ts` (`LOCALES` + `LOCALE_LABELS`) — done.

## Where a decision gets written down

A feature's entry goes into `docs/app.md`, one per feature, written the moment the
feature works — the shape is
[`app-md-template.md`](../.claude/skills/build-app/references/app-md-template.md).
Two rules keep that file worth reading, and both are in `CLAUDE.md` → *Adding a
feature*: quote the access gate as code rather than describing it, and write down
what was decided *against*, because the rejected alternative cannot be read out
of the code and is what gets proposed again three sessions later.
