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

## Green is the commit condition — because nothing runs the tests after you

`.githooks/pre-commit` runs the suite and refuses on red. That hook is the only
thing that runs it: this template ships no CI, so **nothing runs the tests for
you after a push**, and a red test that gets committed stays red until somebody
looks at it by hand — days later, usually while chasing something else. That is
why `CLAUDE.md` makes green a *condition* of committing rather than a courtesy,
and why a shipped test that fails is a finding about your change and never an
obstacle to weaken or delete.

### And a SKIPPED test is not a passed one

`⏭ <file>: NOT CHECKED — <reason>` on stderr has exactly five legitimate
causes. Two are quickly said: `node run.mjs agent-setup --apply` trimmed a
config tree, or the registry no longer holds the SHAPE a test needs, because the
example products were deleted or parked with `"sell": false`.

The third one surprises people: **`scripts/foreign-config.test.ts` starts
foreign tools.** It asks `gitleaks`, ESLint, PostCSS and drizzle-kit whether they
actually ACCEPT the config files this repo writes for them — not whether those
files look plausible. A tool that is not installed on this machine cannot be
asked, so the test skips itself and says so. That is the one skip a green run on
a fresh machine produces regularly, and it disappears the moment the tool is
there.

The fourth and fifth are the app having outgrown a placeholder the template
ships. **A page this app has REPLACED**: `scripts/ux/rules.test.ts` proves the
shipped placeholder home is still recognised, and once the skill `salespage`
(2.4 of *The path*) has left no placeholder to recognise, the test says so and
skips. **A logo this app has SET**: `components/brand-mark.test.ts` proves the
template ships a letter tile, and `brand icons --apply` — the command the skill
`design` tells you to run — has filled `config/brand.json` in.

Anything else on that line is a question nobody answered.

## What checks a component — moved

Why a client component is checked against the running app rather than rendered
in a unit test, and the one case that gets a DOM:
[`smoke.md`](smoke.md) → *What checks a component*.

## 🚨 In a `"use server"` file, a type re-export needs its `from`

```ts
export type { ActionState };                          // ❌ every action 500s
export type { ActionState } from "@/lib/action-state"; // ✅
```

Turbopack's `"use server"` transform collects a module's exports into a runtime
list and registers each as a Server Action. A type-only re-export of a **local**
binding survives that collection as a bare identifier: the emitted chunk holds
`ensureServerEntryExports([i, j, ActionState])`, nothing in it defines
`ActionState`, and the first POST to **any** action in the file dies with
`ReferenceError: ActionState is not defined`.

Nothing else in this repo can see it. `npm run typecheck` is clean — the
TypeScript is correct. The suite is green — no test evaluates a built chunk.
`node run.mjs smoke` only makes GETs, and an action is a POST. It reaches a
customer as "every button is broken", and it did: measured in the template's own
production build, in six files, one of them `app/dashboard/chat/actions.ts` —
which hangs in the dashboard LAYOUT, so it took every action on every page under
it down with it.

Both other forms are erased correctly and stay allowed — `export type X = …` and
`export type { X } from "…"`. So the rule is narrow and the fix is one clause.
`scripts/server-actions.test.ts` refuses the form; `node run.mjs errors` is what
found it.

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

## Languages — moved

Which languages the app speaks, how a visitor's is chosen, how text, dates and
prices are written, and how a language is added or removed:
[`locales.md`](locales.md).

## Where a decision gets written down

A feature's entry goes into `docs/app.md`, one per feature, written the moment the
feature works — the shape is
[`app-md-template.md`](../.claude/skills/build-app/references/app-md-template.md).
Two rules keep that file worth reading, and both are in `CLAUDE.md` → *Adding a
feature*: quote the access gate as code rather than describing it, and write down
what was decided *against*, because the rejected alternative cannot be read out
of the code and is what gets proposed again three sessions later.

**What is not in that file gets built a second time — and the app says so.** The
session greeting names anything of your own that `docs/app.md` does not mention:
a page, a **table**, a scheduled **job**. It is the cheapest reminder there is,
and it is the reason the entry is written the moment the feature works rather
than at the end of the week.
