<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Troubleshooting — errors that are not what they look like

Some errors in this project arrive with a stack trace that points squarely at
innocent code. Each section here is the post-mortem of one of them: the symptom
as it actually appears, why the trace points where it does, where the cause
really lives — and, where an obvious "fix" exists that makes things worse, why
that fix is refused. Read the matching section before changing a line the
trace names; every one of these has already cost somebody the time of chasing
the wrong file.

## A hydration mismatch is not always yours

One class of hydration error comes from **outside the app entirely**, and it is
worth recognising before you go looking for the bug: a browser extension that
rewrites the page before React hydrates. React itself says so at the bottom of
its message — *"It can also happen if the client has a browser extension
installed which messes with the HTML before React loaded"* — and that line is
easy to read past when the stack trace is pointing at one of your own
components.

**Read the diff, not the trace.** React prints the attributes that differ, and
they carry the culprit's name:

```
  <svg className="lucide lucide-languages" …>
-   data-darkreader-inline-stroke=""
-   style={{--darkreader-inline-stroke:"currentColor"}}
```

`data-darkreader-*` is Dark Reader, `data-gr-*` and `data-new-gr-c-s-*` are
Grammarly. An attribute nobody in this project wrote, on an element nobody in
this project styled, is an extension. The trace names `components/…tsx` because
that is where the element was rendered, not where the attribute came from — and
the fix is never there.

Three things follow, and the third is the one that costs time:

- **Dark Reader is already dealt with.** `app/layout.tsx` carries
  `other: { "darkreader-lock": "true" }` in its `metadata`, the tag Dark Reader
  documents for exactly this
  ([`CONTRIBUTING.md`](https://github.com/darkreader/darkreader/blob/main/CONTRIBUTING.md)).
  It is right for this app rather than a workaround: the app **has** a dark mode
  of its own, so an extension inverting it on top is both the fault and a worse
  result than the toggle in the header. A browser without the extension ignores
  an unknown meta name, so it costs nothing anywhere else.
  `app/darkreader-lock.test.ts` keeps the line from being tidied away as
  mysterious.
  **The `"true"` is load-bearing and has nothing to do with Dark Reader**, which
  reads the value never (`meta[name="darkreader-lock"] != null` is its whole
  check): **Next drops an `other` entry whose value is the empty string.** Write
  the `""` that the tag's own documentation suggests and it type-checks, the
  tests stay green, and no tag ever reaches the browser. That is the shape of
  bug this whole page is about — verify a metadata change by looking at the
  delivered HTML, not at the source.
- **It is not a Windows thing**, however it was reported. It follows the browser
  profile, so the same extension shows the same error on Linux and macOS, and a
  colleague without it never reproduces the bug you are chasing.
- **`suppressHydrationWarning` is not the answer, and reaching for it is the
  mistake.** It works **one level deep** — the one on `<html>` covers the theme
  class next-themes sets there and nothing else. Adding a second one further
  down does not stop an extension rewriting the DOM; it stops React telling you
  about it, which is worse than the warning. If some future extension needs
  handling, handle it at the element it touches or not at all.

## Several copies on one machine — the sign-in that breaks for no reason

The same shape of lesson as the hydration one above: an error whose stack trace
points squarely into your code while the cause is in the browser's cookie jar.

The symptom is a sign-in that answers

```
An unexpected response was received from the server.
app/login/page.tsx (121:9) @ LoginPage
```

and a dev log showing the `GET /login` and then **no POST at all**. Both halves
matter. **Nothing is wrong with that page**, and there is nothing to fix in it.

What happened is that the `Cookie` header for `localhost` outgrew Node's 16 KB
limit, so the HTTP parser answered `431 Request Header Fields Too Large` before
Next.js ever saw the request — which is why nothing was logged. React turns any
answer that is not a valid action response into that one sentence, and blames
the component holding the `useActionState`.

It builds up because **cookies know nothing about ports**. Every copy of this
template ever started on this machine leaves a session cookie on `localhost`, so
they all travel to all of them. `lib/auth/cookie-names.ts` gives each
installation its own names — without that, apps decrypt each other's sessions
and fail with `JWTSessionError` — and around twenty installations later the
names themselves are the problem. The app that breaks first is the newest one,
which is the one that looks broken.

Two things now keep it in check, and both live in that file: the DEV cookies
expire after a week, and above 6 KB of them `proxy.ts` deletes the ones
belonging to other installations. **The threshold is what lets two apps be
worked on side by side** — do not "simplify" it away, and do not solve a future
version of this by dropping the fingerprints.

There is a third one worth knowing about: `node run.mjs errors` recognises this
message and says all of the above in four lines. And one honest limit: past
~16 KB even the GET dies, so the app never runs and cannot rescue itself — a
state a jar can reach while this app was closed. From there, and as the
immediate remedy in every case, clear the cookies for `localhost` in the
browser (DevTools → Application → Cookies).

## The database that belonged to another app

The symptom is a brand new app that will not start, and the sentence it fails
with is one that cannot be true:

```
>> Migrating localhost/app
✗ Migration failed: type "ipn_result" already exists
  While running: CREATE TYPE "public"."ipn_result" AS ENUM('accepted', …);
```

That is the **first statement of the first migration**. On an empty database it
cannot fail. So the database is not empty — and since nothing was recorded as
applied, whatever is in there was put there by something that is not this app.
`node run.mjs db-migrate` says so itself now, with the table count, rather than
printing the statement and leaving you to guess.

There are exactly two ways in, and both are worth knowing because the first one
also reaches production:

**1. `DATABASE_URL` points at somebody else's database.** Check the line in
`.env`. Locally the usual cause is a port: every project from this template uses
the credentials `app/app/app`, so they fit each other perfectly — see
[`database.md`](database.md) → *Local Postgres*. `scripts/db/up.mjs` refuses to
start rather than let that happen, but it can only defend the port it is given.

**2. The local Docker volume came from an older project of the same name.**
This is the one that produced this section, measured on a real first start.
Docker Compose names its project — and therefore its container **and its data
volume** — after the FOLDER the compose file sits in. A folder called `test`,
`app`, `demo` or `saas` is a folder somebody has had before. The new app comes
up, Compose hands it `test_pgdata` from an app that has been deleted for months,
and it finds a schema it never wrote:

```
$ docker volume ls | grep pgdata
local     test_pgdata          ← the old app's data, adopted by the new one
```

The template now derives the project name from the folder's **path** instead and
records it in `.env` as `COMPOSE_PROJECT_NAME` (`scripts/db/compose.mjs`), so two
same-named folders are two databases. An app generated before that carries the
old behaviour — a released app's code is never changed behind its back, and
`node run.mjs update` brings this text forward, not the fix. Whether yours has
it is one look: is there a `COMPOSE_PROJECT_NAME` line in your `.env`?

For an app that has already adopted a stranger's volume the way out is one
command, **as long as the database holds nothing you want to keep**:

```bash
node run.mjs db-nuke && node run.mjs start
```

`db-nuke` deletes the volume this project is attached to and nothing else. Look
at `DATABASE_URL` first: on anything that is not `localhost` this is the wrong
command, and the migration error says so rather than offering it.

## Dates and raw SQL

The single sharpest trap in this project, because every part of it looks right.

**Drizzle converts a column. It does not convert raw SQL.** A column reference
runs through the column's own mapper; a ``sql`…` `` expression has no mapper at
all (`noopDecoder`), so the driver's value is passed straight through and the
type parameter is only a note to the compiler. Measured against this database:

```ts
db.select({
  raw: grants.createdAt,                       // → Date                    ✅
  agg: sql<Date>`min(${grants.createdAt})`,     // → "2026-07-25 11:29:17.5" ❌ a string
})
```

Then the string reaches a table cell, `Intl` throws `Invalid time value`,
next-intl catches it and renders the raw string — **200, no test red, page
broken**. `db/sql-cast.test.ts` fails on `sql<…Date…>` so it cannot be committed;
a line that genuinely has to say it is exempted with `sql-cast-ok`.

**Do not "fix" it with `new Date(value)`.** Postgres hands over
`2026-07-25 11:29:17.552095` with no zone marker, so V8 reads it in the *host's*
zone and the timestamp silently moves by the host's offset — the very thing
drizzle's `timestamp` column mapper prevents wherever there IS a column, and a
raw expression is precisely where there is not one. Instead, one of:

```ts
sql`min(${grants.createdAt})`.mapWith(grants.createdAt)   // borrow the column's mapper
sql<string>`to_char(min(${grants.createdAt}), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
// or: select the column and do the min() in JS
```

**Which mechanism does the UTC work — and it is not the one people expect.**
`db/index.ts` used to carry a `types: { 1114: … }` mapper for exactly this, with
a long comment. Measured 2026-08-12: it never ran. `drizzle(client)` calls
`construct()`, whose first act is to overwrite the driver's parser **and**
serializer for every date OID with `(val) => val` — drizzle converts at the
COLUMN instead (`mapToDriverValue` = `toISOString()`, `mapFromDriverValue` =
`new Date(value + "+0000")`). The behaviour was right the whole time and the
explanation was not; `db/timestamp-utc.test.ts` is now the guard that goes red
if either half stops. Two consequences worth knowing:

- **`construct()` MUTATES the client — it does not wrap it.** `applierSql` is
  that same object, so the raw applier handle hands out *strings* for date
  columns and **throws** on a bound `Date`.
- **A bare script's client is a different world.** Nothing has touched it, and
  postgres.js's own defaults are wrong here in both directions — see the section
  below.

## A retention boundary that travels as the wrong TYPE

Every script under `scripts/` and `modules/*/` opens its own postgres.js client,
where there is no column to convert at. Two defaults bite:

- **Reading**, the driver hands `"2026-08-11 09:13:47.14"` to `new Date(...)`,
  which V8 reads in the **process's** zone. Measured: the Art. 15 export
  (`node run.mjs data-export`) reported a consent stored at 12:00 UTC as
  `10:00Z` under `TZ=Europe/Berlin` and `00:00Z` under `TZ=Pacific/Auckland`.
- **Writing**, `inferType()` types a `Date` as OID **1184** (`timestamptz`),
  while every date column here is `timestamp`. Postgres resolves
  `timestamp < timestamptz` by casting the **column** into the **database
  session's** zone — so the boundary moves by the *server's* offset, and the
  process's `TZ` shows nothing at all. Measured on Postgres 16 with the database
  at `timezone='Europe/Berlin'`: `node run.mjs db-prune-ipn --days 1` deleted
  **4 of 4** seeded rows where 2 were outside the window; on a database west of
  UTC the same boundary spares rows that should have gone.

Both are answered in one place, `scripts/lib/pg-utc.mjs`, and every client in
the tree is opened through its `connectUtc()` (a test refuses a second way in).
Reading is then correct with no call site knowing. **Writing has to say it:**

```js
where received_at < ${sql.typed.utcTimestamp(cutoff)}   // ✅
where received_at < ${cutoff}                           // ✗ refused at bind time
```

The bare form throws with the fix in the message rather than deleting the wrong
rows — there is no `timestamptz` column anywhere in this tree, so a 1184
parameter is always a mistake, and refusing is the safe direction for a command
whose mistake cannot be undone.

Two more ways a `Date` stops being one, both of which keep their type:

- **Through JSON.** `Response.json({ rows })` turns every `Date` into an ISO
  string while the TypeScript type still says `Date`. Anything fetched from
  `app/api/…` needs converting back on arrival — calling `.toISOString()`
  yourself at the boundary is the honest version of the same thing.
- **A nullable column.** `format.dateTime(null)` and `format.dateTime(undefined)`
  do **not** throw and log **nothing**: they render *1 January 1970* and *today*
  respectively. No log check can catch those. Every nullable date needs its
  guard at the call site, the way the rest of the app does it:

  ```tsx
  {row.accessUntil
    ? format.dateTime(row.accessUntil, { dateStyle: "medium", timeZone: "UTC" })
    : tCommon("none")}
  ```

## What the first install prints — and which of it is real

`node run.mjs start` installs the dependencies on its first run, and npm talks
while it does. Somebody who has just deployed cannot tell an expected line from
a real one, and neither can you without this page. **Read it before you "fix"
anything npm complains about here** — one of the two obvious fixes ships a crash
to the customers of this app.

**This page does not tell you how much npm will print** — not how many lines,
not how many findings, not how many paths one of them is counted on. All three
move with every upstream release, so a number here would be a measurement with
yesterday's date on it, and prose carries no date. What does not move is the
KIND of line and what to do with it, and that is what follows.

| What npm prints | What it is, and what to do |
|---|---|
| `npm WARN deprecated @esbuild-kit/esm-loader` (and `core-utils`) | transitive dependencies of `drizzle-kit`, which is on its latest stable release. **Nothing to do.** Not ours, no newer stable to move to. The pair is named in `scripts/deps.test.ts`; a *third* deprecated package fails that test rather than quietly joining the wallpaper |
| a security advisory summary — `… vulnerabilities`, at any severity | **judge it against what ships.** `npm audit --omit=dev --audit-level=high` — what the skill `security-gateway` §5 runs — is the question that decides whether anything reaches a customer. A dev-only finding is real but does not ship. A finding you accept is accepted **by its GHSA id with a reason written next to it**, never as a number. See below |
| an `ERESOLVE` block | **a regression.** Report it, do not silence it. See below for what catches it and what does not |

**On `ERESOLVE`, precisely.** `scripts/deps.test.ts` fails when the *known
cause* comes back: the `esbuild` override written as a caret or a pin instead of
a floor (the test is called *"is a floor, not a pin — a caret range is what
printed ERESOLVE at every install"*). That test reads `package.json` and
`package-lock.json` as JSON and never installs anything, so it does not see a
single line of npm's output. An `ERESOLVE` that arrives by some other route is
therefore something a **person** has to notice — nothing in this app can raise
it for you. When one appears: report it rather than silencing it, and expect the
fix to live upstream of this app, in whichever package changed its peer range,
rather than in a new `overrides` entry here.

### The advisory that was reported nine times — a post-mortem

For a long stretch of this template's life a first install ended with
`9 high severity vulnerabilities`, and this page told the reader to report the
nine as known. That instruction was wrong twice over, and both mistakes are
worth keeping written down, because the shape of them outlives the episode.

- **There was one advisory, not nine problems.** `GHSA-mh99-v99m-4gvg` in
  `brace-expansion`: a brace bomb expands without bound and takes the process
  down with an out-of-memory crash. It was reachable on nine **paths** through
  `eslint-config-next`, and npm was counting paths. `9 high severity
  vulnerabilities` was that count. Anybody who read it as nine problems learned
  something that was never true.
- **It was dev-only throughout.** `npm audit --omit=dev` was clean the whole
  time the nine were being reported. Nothing in the bundle a customer loads was
  ever affected by it.
- **It persisted because of how the advisory range is written** — `<=5.0.7`
  across every major — so the 1.x backport that actually carries the fix sits
  *inside* the range and keeps matching. This project's lockfile has pinned a
  fixed version the whole time.
- **It is no longer reported on the tree this page ships from**, at any
  severity, with or without `--omit=dev`. **Why it stopped is not measured
  here.** A correction to the advisory's range upstream is the likely
  explanation, and *likely* is as far as this page goes — a measurement nobody
  took does not become a fact by being plausible.

And that last point is the reason for the rule at the top of this page: an
account of what npm prints is only ever true of the day it was taken. Judge what
**you** see. Do not carry a number forward from a document, this one included.

**Two fixes look obvious and are both refused**, with the measurements behind
the refusal in `scripts/deps.test.ts`:

- **`eslint@10`** — what `npm audit fix --force` proposes. It does not remove
  the findings, because they arrive through eslint's *plugins* rather than
  through eslint itself: upgrading eslint leaves the plugins' own `minimatch@3`
  chain exactly where it was. And it introduces three fresh `ERESOLVE`
  conflicts. Worse on both counts.
- **`"overrides": { "minimatch": "^10" }`** — this one does make `npm audit`
  read clean, which is why it is the dangerous one. minimatch 10's CommonJS
  build exports an object rather than a function, and three
  `eslint-config-next` plugins call it as one, so any lint rule that matches a
  pattern dies with `TypeError: minimatch is not a function`. **`npm run lint`
  in this project stays green** — none of those rules are switched on here — so
  it looks like a clean fix and lands as a landmine in the first app that
  enables one.

So: a clean audit summary is not worth a crash in somebody's app, and neither
override buys one honestly. If a finding in that chain is being reported to you,
report it as known and dev-only, say what `npm audit --omit=dev` answers, and
leave it. The way out is upstream — `eslint-config-next` moving its plugins off
`minimatch@3` — and `node run.mjs update` brings this page along when it does.

`package.json` is JSON and holds no comments, so the reasoning for every
`overrides` entry lives in **`scripts/deps.test.ts`** instead, the same way the
per-system install commands live in `scripts/dev/fixes.json`. That test also
pins the two things that must not drift back: the `esbuild` override is a
**floor** (`>=`), never a caret — written as a caret it excluded the versions
`vite` and `tsx` ask for and printed a wall of `ERESOLVE` at everybody who
deployed — and `brace-expansion` must resolve to a version that caps its
expansion.

## No greeting appeared — one script, three wirings and one guidance rule

The greeting is not decoration: it carries the `[Setup: …]` line the project's
rulebook builds its hard precondition on — whether this machine can run the app
at all. It is printed by `scripts/dev/session-start.mjs`, and because the
programs do not agree on how a command runs at session start, that same script
is invoked three different ways. It lives in `scripts/dev/` and not under any one
program's folder for exactly that reason — it is shared tooling, like everything
else in there:

| | |
|---|---|
| Claude Code | `.claude/settings.json` → `hooks.SessionStart` |
| Codex CLI | `.codex/config.toml` — `[[hooks.SessionStart]]` entries, enabled by `[features] codex_hooks = true` in the same file |
| OpenCode | `.opencode/plugins/session-start.js` — it has no declarative hooks, so this one is a module subscribing to `session.created` |
| **Antigravity CLI** | **nothing — and that is the finished answer, not a gap.** See below |

🚨 **The fourth program has no session-start event, so it gets no hook.**
Antigravity CLI fires exactly five (`PreToolUse`, `PostToolUse`,
`PreInvocation`, `PostInvocation`, `Stop`), and none of them is "a session
began". Hanging the greeting off `PreInvocation` was considered and rejected on
three counts, each fatal on its own:

- **It is too late.** That event fires before a MODEL invocation, so the
  earliest it can run is after the user has already typed something. The
  greeting exists to be read before the first file is touched.
- **It cannot reach the person.** Its only output is `injectSteps`, which puts
  text in front of the model. There is no field that displays anything to the
  human, and the CLI's own ephemeral messages are reported as invisible in the
  interface — they land in the transcript file and nowhere a person looks.
- **Getting it wrong is silent.** A `hooks.json` entry naming an event this
  program does not have is dropped without a word — no error, no warning, no
  line in the output. That is exactly how somebody ends up believing a greeting
  is wired when nothing runs, which is the failure this whole section exists to
  prevent.

So: no hook, rather than one that looks wired and does nothing. A greeting that
fails silently is worse than one that was never promised.

What replaces it is the rule in `CLAUDE.md` / `AGENTS.md`: *absence of a signal
is never a signal — if no greeting appeared, run `node run.mjs greet` before you
touch a file.* That sentence was written for a hook that failed to fire, and in
this program it is simply the normal path. It needs no wiring at all, because
Antigravity reads `AGENTS.md` by itself — there is no context-filename setting
to configure, and none is missing. Both halves are asserted by
`scripts/agent-setup.test.ts` — that this program ships no greeting hook, and
that the sentence standing in for one is still in both files — so the exemption
cannot quietly decay into an omission.

The project ships wired for all four, and `node run.mjs agent-setup` reduces it
to one. That order is deliberate: a fresh clone works in whichever program it is
opened in, before anybody has run anything — the command is the tidy-up
afterwards, never a precondition. It removes the wiring for the three programs
not in use, records what it removed in `.agent-profile.json` so `node run.mjs
update` does not put them back, and can restore any of it (`--agent <other>` or
`--undo`). It never touches `.claude/skills/`, the guidance or the greeting:
those are shared by all four. `setup-machine` runs it on the first session; the
person building never has to know it exists.

⚠️ **One of the four cannot be detected, and `agent-setup` says so rather than
guessing.** Antigravity passes session context to hooks as stdin JSON and sets
no environment variable of its own, so there is nothing to read. Run without
`--agent` inside it, the command refuses and lists the four names — which is the
correct outcome: a wrong guess removes the wiring somebody is using.

One case the script cannot cover is its own absence. It is a Node program, so a
machine without Node cannot report that it has no Node — and "the agent and git
installed, Node not yet" is the ordinary state of a fresh clone rather than an
exotic one: the agent does not need Node, git does not need Node, and the app
needs it for everything. So a second hook says it in shell instead — three words
asking whether `node` exists — which is why a machine without one greets with
`[Setup: blocked — node]` rather than with silence. That hook is the single
deliberate exception to the project's rule that tooling is written in Node, not
bash: it starts no process, finds no process, and is the one check that cannot
be written in the language it is checking for. The config files it lives in are
JSON and cannot hold a comment, which is why the reason is written down here.

**And why the precondition is hard rather than a courtesy.** A machine without
Node does not stop an app from coming into being — every file of it can be
written — and it gives way at the first command that runs any of it. The failure
arrives after the work, not before it, which is the whole reason `CLAUDE.md`
asks for one answered `node` command before the first file is written rather
than for a check somewhere later.

Three of the four hook mechanisms are young, and two of them have open bugs
where the hook silently stops firing. That is what `node run.mjs greet` is for:
it prints the same greeting on demand. If no greeting appeared, run it —
silence is never the same as "fine".

## Chrome calls the sign-in link a "Dangerous site"

The symptom: somebody clicks the link in the sign-in mail and Chrome answers
with a full-page red interstitial — *"Dangerous site — attackers on this site
may trick you…"* — before the app is ever reached. Firefox and Safari show
their own versions of the same page.

**This is not an error in the app, and nothing in the code triggered it.** The
domain is on Google's **Safe Browsing** blocklist, a reputation verdict about
the domain itself that every major browser consults. The app behind it can be
flawless; the interstitial comes up all the same, in front of every page and
every sign-in link, for every visitor.

Why a freshly launched SAAS app earns that verdict is worth spelling out,
because each ingredient looks harmless alone:

- **The domain is brand new.** No history is itself a risk signal — phishing
  domains are hours old, so young domains start with negative trust.
- **It serves a sign-in form and mails out token links.** That is exactly what
  a credential-phishing site does. The classifiers cannot read intent, only
  shape — and the shape matches until reputation says otherwise.
- **The sender domain does not match the link domain.** A mail from
  `demo@somewhere-else.com` whose button points at `your-domain.de` is the
  single strongest phishing heuristic there is. Recipients hit "report
  phishing", filters agree, and those reports feed the same lists Chrome
  reads. The sender rule in [`docs/auth-setup.md`](auth-setup.md) → *What the
  mails look like* exists to keep this ingredient out entirely — and it is
  **enforced**: STAGING/PROD refuse to start on a foreign or missing sender
  (`lib/env-guard.ts`), so meeting this ingredient today means somebody set
  `EMAIL_FROM_FOREIGN_DOMAIN` and accepted the risk, or the app predates the
  guard.

**Getting off the list** is a review request, and only the domain owner can
file it:

1. Verify the domain in **Google Search Console** (DNS record or file upload —
   the skill `go-live` walks through it).
2. *Security issues* names what Google believes it saw — usually "Deceptive
   pages" for this pattern. If the panel is empty, check the verdict at
   Google's Safe Browsing status page
   (`transparencyreport.google.com/safe-browsing/search?url=your-domain.de`).
3. **Request a review** from that panel, in one or two sentences: what the
   product is, that sign-in links are sent only to addresses that asked for
   them. Reviews of false positives typically clear in one to three days.

**Preventing it** is cheaper than clearing it, and it is three lines of
go-live discipline: the sender address lives on the app's own domain and is
DKIM/SPF-verified there (the domain half of this is enforced at boot — see
below); the Impressum and privacy policy are filled in before
the first stranger gets a mail (`node run.mjs legal-check` — a placeholder
Impressum on a live domain reads exactly like a throwaway phishing site); and
the domain is verified in Search Console **at** launch, not after the flag,
because Search Console is also where Google would tell you about the flag —
without it the first person to learn of the interstitial is a customer.

## Startup aborted: the sender address is not on the app's domain

The symptom: in STAGING or PROD the app refuses to start, and the message
names the sender address, the app's domain and this rule. That is the guard
for the section above doing its job (`lib/env-guard.ts`): the From of the
sign-in mails (`POSTMARK_SENDER` / `SMTP_FROM` / `EMAIL_FROM`) lives on a
different domain than `APP_URL`, or a mail transport is configured with no
sender at all — which would send as `login@localhost`.

The fix is the fix for the phishing shape, not for the message: use an
address on the app's own domain (`node run.mjs mail-setup`; subdomains in
either direction count as the same domain) and verify it at the provider.
If the foreign sender is a deliberate, informed decision, set
`EMAIL_FROM_FOREIGN_DOMAIN=<that domain>` — the value must name the domain,
`=1` is refused — and read what stays your risk in
[`docs/auth-setup.md`](auth-setup.md) → *the sender rule*.
`node run.mjs doctor --deploy` gives the same verdict on your own machine,
before a deploy ever runs into it.

## The sign-in link points at `localhost` — a deployed app nobody can enter

The symptom, and it is the worst-looking one in this file because nothing is
broken: the app is live, every page answers, the checkout goes through — and
the sign-in mail contains
`https://localhost:8080/api/auth/callback/email?…`. The buyer has paid and
cannot get into their account. A redirect shows the same thing without waiting
for a mail:

```
$ curl -s -i https://your-domain.de/dashboard
location: /login?callbackUrl=https%3A%2F%2Flocalhost%3A8080%2Fdashboard
```

The cause is one line of the hosting setup meeting one line of Auth.js.
`AUTH_TRUST_HOST=true` lets Auth.js work out its own address from the request
headers, which is right for accepting a dynamic Host and wrong for building a
link. Behind DigitalOcean App Platform's router the container sees itself as
`localhost:8080` and no `x-forwarded-host` with the public domain arrives — so
that is what went into the mail. Every gate stays green: it is a correct 307 to
a correct path on the wrong origin.

**On template 0.28.0 and newer this cannot happen**: `AUTH_URL` is derived from
`APP_URL` at startup (`lib/auth/auth-url.mjs`), so everything the app mails out
carries the address the app says it has, and STAGING/PROD refuse to start with
no `APP_URL` at all. On an older app, set `AUTH_URL` on the host to the same
value as `APP_URL` — origin only, no path, no trailing slash — or bring the code
forward. `AUTH_TRUST_HOST` stays as it is; it answers a different question.

**If you set `AUTH_URL` by hand, it must match `APP_URL`.** Two variables
naming the app's address and disagreeing is refused at startup rather than
picked between: one decides where sign-in links point, the other the mails'
legal links, the checkout return and the IPN target.

The same rule has one visible consequence locally, and it is the honest cost of
not having a DEV-only branch here: **open the app on the address `APP_URL`
names.** With `APP_URL=http://localhost:3000`, signing in on
`http://127.0.0.1:3000` sends you to `localhost:3000` mid-flow — a different
origin as far as cookies are concerned, so the session lands somewhere you are
not looking. `node run.mjs start` prints the address it means.

## The app went live empty — content that only ever existed on your machine

The symptom: locally the app is finished — the course renders, the videos
play, `smoke` and `errors` are green, the tests pass. Deployed, the same
pages are live and **empty**: no blocks, no units, media cards that 404. No
error anywhere, because nothing is failing — a course page over an empty
table is a clean 200, and `smoke` cannot tell it from a full one.

The cause is never the deploy. It is what the deploy carries: **the repo, and
nothing else.** Rows written into the local Postgres and files put into the
local media store are not code — `git push` does not move them, the migration
hook creates tables and fills none of them, and each environment has its own
database and its own bucket ([`environments.md`](environments.md) → *What
data lives where*). An app whose content was INSERTed locally has content on
exactly one machine: yours.

One variant of this deserves its own sentence, because it was seen in the
field: **an agent invents a local S3 — MinIO or similar — to develop
against.** This template has no MinIO and needs none; the local driver is
plain files under `.data/media/` (`MEDIA_DRIVER=local`), and `lib/env-guard.ts`
refuses to start a STAGING/PROD app on it. A local bucket does not change the
diagnosis, it just dresses it up: a store on your machine is a store the live
app cannot read, whatever protocol it speaks.

The fix is the content mechanism, never a workaround:

- Content the vendor authors is repo files from day one —
  [`content-authority.md`](content-authority.md) (constants in code) and
  [`content.md`](content.md) (the manifest, the two media legs, the
  appliers). What is in the repo travels with every deploy by itself.
- What cannot live in the repo moves by command:
  `node run.mjs content-apply --env prod` (rows + shipped media) and
  `node run.mjs content-media-sync --env prod --apply` (staged media).
- The proof is `node run.mjs content-check --env prod` — it asks every owner,
  and the core's half HEADs every
  declared file against the production store and counts every applier's rows
  in the production database. Green there, plus one real content page opened
  live, is what "the content is there" actually means. It is a named go-live
  step, not an optional extra.

## A scheduled job failed and nothing said so

The symptom: something that should happen nightly has stopped happening —
rows nobody pruned, a top-up nobody chased, a report that never went out.
Every page answers 200, `node run.mjs smoke` is green, and until recently
`node run.mjs errors` was green too.

**A job has no status code to hide behind.** That is what makes this class
different from a broken page: a page at least answers something a checker can
look at, and a job answers nobody. Its only signal is the line it writes:

```
[cron] prune-ipn-log FAILED after 12ms: Error: connect ECONNREFUSED 127.0.0.1:5432
    at Object.run (lib/cron/jobs.ts:140:13)
```

`node run.mjs errors` reads that line now, locally and with `--url` against a
deployed app — and so does every other line this app writes in the same shape,
`[media]`, `[ipn]`, `[chat]`, `[ops]` and the rest.

🚨 **It did not always.** The parser anchored on lines that BEGIN with an
error, and this one begins with `[cron]` — so an app cloned before this
paragraph existed answers `✓ No errors in the log` over a scheduler that has
been down for a week. Check your own copy before you trust a green answer:
`lib/diagnostics/parse.mjs` names `PREFIXED_ERROR` if it has the fix.
`node run.mjs update` cannot bring it — that command moves guidance, never
code — so it is a fresh clone or the four lines by hand.

**Two limits worth knowing before you read a green answer as health:**

- **The window is bounded and it empties on every restart.** `--url` reads a
  500-line in-memory ring, so a job that failed before the last redeploy is
  not in it, and behind a load balancer you are asking one instance. The
  answer always names the window it looked at; read that line rather than the
  tick.
- **A failure that never produced an error object is still invisible.** The
  parser needs the error shape — `[ops] media store misconfigured: 3
  problem(s)` is a `console.error` and reads as ordinary output. That is
  deliberate: `console.log` wears the same prefix as `console.error` once both
  are in one stream, so "it starts with a bracket" would flag the nine
  perfectly healthy `[cron] … ok in 2ms` lines every app writes every night.

**So the direct question about jobs is not `errors` — it is `cron`:**

```bash
node run.mjs cron --list                       # this machine
node run.mjs cron --list --url https://your-app  # the deployed app
```

That one reads `cron_runs` rather than a log: when each job last ran, what it
said, and how often it has failed. It is the answer that survives a restart,
and it is what `node run.mjs health --url …` asks on your behalf. Use `errors`
to find out **what** broke; use `cron --list` to find out **that** something
did.

## The build stopped half-way — a usage limit, not a bug

The symptom: the agent had been building for a long stretch — tool calls
scrolling past, files appearing — and then the program stopped with a line
like *"You've hit your limit · resets at …"*. `node run.mjs start` fails, or a
page answers 500, and there are no more turns until the window resets. It
looks like the template broke. It did not: **the account's usage window ended
in the middle of one turn**, and everything that turn had not finished is
exactly as far along as it got.

**What state the project is in.** The build runs in stages — one line of
`docs/plan.md` per turn, each handed back committed and running (`build-app` →
*After the yes*). So:

- every line ticked in `docs/plan.md` is a stage that was committed on green
  and started once; `git log` shows one commit per stage;
- the first unticked line is the stage that was cut, and `git status` shows
  what it left behind — uncommitted files, possibly a migration that ran
  locally and is not in a commit;
- nothing before it is lost, and nothing after it was started.

**What to do when the window is back.** Say *"continue"*. The agent reads
`docs/plan.md` and `git status`, names the interrupted stage, and finishes that
one first — never starts over, never skips it (`build-app` →
`references/stages.md`, *When a session was cut*). If you need the app running
before then, the last committed stage does run: `git stash` parks the
half-built one and `node run.mjs start` brings up what was there. The stash is
the interrupted stage; the agent brings it back before anything new.

**Two things about the program, not the app.** Recent versions of Claude Code
offer to wait and continue by themselves when a limit is hit (`/rate-limit-options`);
if yours does, the interrupted stage is simply finished when the window resets.
And a stage boundary is a checkpoint: `/rewind` can take the project back to
any hand-back, which is one more reason the build stops there.

**Why the build is staged at all.** The template cannot see which plan the
person at the keyboard is on — that information reaches the status line and
nothing else — so it works the same way for everybody: a stage is sized to fit
comfortably inside a window, it ends with something to open, and the one
sentence it costs somebody on a large plan is *"run through"*, recorded once as
the `Pace:` line of `docs/plan.md`. A build that ran forty minutes in one turn
was the shape that produced this section, reported by a customer whose own
plan had room for it and who asked what happens to the ones whose does not.

## The read guard said no — read a range

The symptom: a `Read`, or a `cat` in a command, comes back refused with a
sentence like *"`app/dashboard/account/page.tsx` has 409 lines. Whole-file
reads stay in your context for every request after, so read a RANGE …"*. That
is `scripts/dev/hooks/read-guard.mjs`, a Claude Code `PreToolUse` hook shipped
in `.claude/settings.json`, and it is doing what it is for.

**What to do:** read the part you need — `Read` with `offset` and `limit`, or
`sed -n '120,180p'`, or `grep -n` for the name you are after. A doc over the
threshold has a *Contents* block or sections; `docs/api-map.md` has one section
per file. A `cat … | head -60` passes, because it is a range.

**Why it exists.** Measured over two archived build sessions: thirteen whole
reads of files over 200 lines put 51,000 tokens into a context that every one
of the next 150 requests then re-read — about a fifth of what the build cost.
The sentence in `CLAUDE.md` → *Reading the tree* had said "in a RANGE rather
than whole" the whole time; a refusal is what a sentence becomes when it is
measured being ignored.

**What not to do:** remove the hook, or read the file in two halves to get
around it. The threshold is 200 lines and it is stated in the script with the
numbers it was chosen from. Codex, OpenCode and Antigravity run no hooks, so
there the sentence is the only guard — read the same way.

