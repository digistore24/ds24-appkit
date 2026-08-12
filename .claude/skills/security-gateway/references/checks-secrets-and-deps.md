<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# `secrets` and `deps` — the check recipes

Part of the skill `security-gateway`, checks 4 (`secrets`) and 5 (`deps`).
SKILL.md holds the rule that keeps each check honest and the command it starts
from; this file holds how to run them. Severities and the format of a finding
are defined in SKILL.md.

## 4 · `secrets` — what must never be in git

### What the working-tree rung actually reads

It reads git's **index** (`git ls-files --cached`: tracked files plus anything
newly staged), scans what is on disk for those paths, and additionally reads the
**staged blob** of anything in `git diff --cached` — so a value that was staged
and then edited out of the working copy still comes back, marked `(staged)` in
its `Where:`.

🚨 **There is deliberately no entropy rule, and the refusal is measured.** The
obvious name-anchored rule (`*SECRET*`/`*TOKEN*`/`*PASSWORD*`/`*API_KEY*`
assigned twenty-odd characters) produced **eleven** hits on this template's own
tree and **zero** of them was a secret — four were test fixtures whose shape is
indistinguishable from a real value by construction. That refusal is what buys
the property worth having: the shipped template scans to zero findings, so a
customer's first run is a clean rung rather than five things they must learn to
ignore. A customer who needs another rule adds it to
`scripts/security/patterns.mjs` and re-derives the measurement while they are
there.

### The rest of the check, by hand

**Run the tools you have.** `gitleaks detect --source . --verbose` if it is on
the machine — the template ships a `.gitleaks.toml` for it. Otherwise work from
`git grep` and the checks below; the discipline does not depend on the tool.

**Skip these without further checking** — they are not secrets:

- Anything containing `_test_`, `_sandbox_`, `test-`, `sandbox-` — sandbox keys
  move no money.
- Publishable and public keys: `pk_live_*`, `pk_test_*`, `-----BEGIN PUBLIC KEY-----`,
  `ssh-rsa`/`ssh-ed25519`, any `*.pub`.
- **`DIGISTORE_DEVELOPER_KEY` in `lib/digistore/config.mjs`** (which
  `scripts/ds24/connect-api-key.mjs` imports — this file used to name the
  importer, and a path exemption pointed there would have excused nothing). A
  Digistore24 developer key carries no account permissions — it only identifies
  the application to `requestApiKey`, like an OAuth client ID. The key that
  carries permissions only comes into being when the merchant grants access. Do
  not remove it, do not obscure it; the scanner markers on that line are part of
  it. A scanner *will* raise this. It is not a finding.
- The placeholder values in `.env.example`.

**Do check** `sk_live_*`, `-----BEGIN … PRIVATE KEY-----`, and any secret sitting
in a `NEXT_PUBLIC_*` variable — that prefix ships the value to every browser, so
a real key there is **CRITICAL** whatever else is true.

**For everything left, verify the value:**

```bash
git grep '<distinctive tail of the value>'                    # in the tree now?
git log -p --all -S '<distinctive tail of the value>' -- <file>   # ever in history?
```

Search a distinctive tail, not the whole key. Then:

| In the tree now | In history | Rotated | Verdict |
|---|---|---|---|
| yes | — | — | 🚨 **CRITICAL** — it is in the repo right now |
| no | yes | no / unknown | ❌ **HIGH** — it was exposed and still works. Rotate it. |
| no | yes | yes | **no finding** — the old value is dead. Cleaning history is hygiene, offer it. |
| no | no | — | **no finding** — this is what correct looks like |

When rotation is unclear, **ask** — one sentence: "was this key rotated at the
provider after it was committed?" Do not guess CRITICAL.

Also check, regardless of tools:

- `.env` is in `.gitignore` and `git log --all -- .env` is empty.
- Every new variable is in `.env.example`, with a placeholder and never a value.
- The Digistore24 credentials live in the environment and are read through
  `lib/digistore/settings.ts` — not in the database, not in the code. There is
  deliberately **no UI for entering keys**, and adding one is a finding: it is
  attack surface for a problem that does not exist.
- Nothing secret in `messages/de.json` / `messages/en.json` — they are bundled.

**The fix, when it is real:** rotate at the provider first, then remove from the
code, then `.gitignore`, then clean the history (`git filter-repo`, BFG). In that
order. Cleaning history first leaves a live key out there.

## 5 · `deps` — the packages

### The two advisory databases

**npm is asked twice in one run, because they are two questions.** What SHIPS
(`--omit=dev --audit-level=high`, where **no allowance applies at all**) and the
whole tree, where an advisory somebody has already judged is reported as
**known, dev-only, accepted** by its GHSA id instead of being rediscovered as new
on every run. The accepted set is `scripts/security/accepted.mjs`, one written
reason per id.

**OSV.dev is the second one**, a rung of its own: it puts the names and versions
out of `package-lock.json` to a database that aggregates more sources than npm's
endpoint and regularly knows about something earlier. It reports only what npm
did **not** already report — matched on the advisory id or any of its aliases,
because npm keys on GHSA ids and OSV may answer with a CVE — so an advisory both
know appears once and the tally never double-counts.

Two rungs mean two answers, and that is the point: with no network you get **two**
`⏭ not asked` blocks with two different reasons, never one skip standing for
both. (An older copy of this app may have the npm rung only; that is a version,
not a fault.)

### The four rungs that no advisory database could answer

SKILL.md names them and gives the ratings; this is what each one actually
measures, and — more usefully — what it deliberately does not.

**`signatures`** runs `npm audit signatures`. A package whose registry signature
does not **verify** is ❌ HIGH: the bytes installed here are not the bytes the
registry signed. A signature that is **missing** where the registry publishes
signing keys is ⚠️ MEDIUM, and is stated as that fact rather than as tampering —
plenty of good releases predate signing. 🚨 It reports **no count of what
verified**, because npm's `--json` answer does not contain one; do not put a
number in your report that nobody measured.

🚨 **And it has a third state you are more likely to meet than either finding:
it could not ask.** Then it is a `⏭` block like any other, and its `Reason:` line
says which of three things happened and what clears it — never a finding, never a
pass, and never something to write up as "signatures: clean".

| the reason begins | whose problem | what clears it |
|---|---|---|
| `ECONNREFUSED` / `ENOTFOUND` / `ETIMEDOUT` … | the network between here and the registry | being back on it |
| `EEXPIREDSIGNATUREKEY` | **the npm on this machine** | `npm install -g npm@latest` — waiting never does |
| `found no dependencies to audit …` | nothing is installed here | `npm install` |

The middle one is the one to recognise, because npm's own message about it names
a package that has nothing wrong with it: npmjs.org retired a signing key and
published a new one, tarballs published before then still carry the retired key's
signature, and npm 9 rejects those where npm 10+ accepts a signature made while
its key was valid — measured, npm 9.9.4 refuses and npm 10.9.9 answers on the
same install. **Do not report it as a supply-chain finding and do not report it
as the registry being down.** It goes into `Checks:` as
`(signatures: skipped — npm too old for the registry's current keys)`, with the
one-line remedy, exactly as `history` does for a missing `gitleaks`.

**`registry`** asks the public registry and deps.dev about the app's **direct**
dependencies for three facts: the resolved version was published inside a
recency window (`--young-days <n>`, 7 by default), the publisher has marked it
**deprecated**, or the account that published it is **not among the package's
maintainers today**. `--supply-chain-all` widens it from the app's own
dependencies to every entry in the lockfile, and takes about half a minute in
silence. The rung's line names both numbers — asked and deliberately not asked —
and your report repeats that scope.

**`posture`** is the only rung that needs no network at all, which is why it is
the one that still answers on a machine with no connection: install scripts
switched off or not (`.npmrc` → `ignore-scripts`, ℹ️ LOW and never higher — a
fresh app ships no `.npmrc`, and a report opening red on a default nobody chose
is one nobody finishes), `package-lock.json` committed and not gitignored
(❌ HIGH — everything else answers about the versions this app RESOLVED, and with
no lockfile there are none), the lockfile still describing this `package.json`
(❌ HIGH), and a **written reason** for every `overrides` entry in
`scripts/deps.test.ts` (⚠️ MEDIUM).

It also runs `npm ci --dry-run`, and that one is **evidence, not a state**. Three
answers, three different sentences: npm agreed; npm **refused**, which is a
❌ HIGH finding carrying npm's own sentence; or npm **could not be asked** — no
npm on the PATH, no registry — which says so in the evidence line and changes
nothing about what the rung answered, because the question had already been
answered offline. 🚨 Do not write that third one up as a skipped rung: read the
evidence line and repeat what it says.

**`drift`** fetches the template's own `package.json` over the same public
address `.template-version` carries and names the **direct** dependencies this
app is behind on — the whole drift as ONE ℹ️ LOW finding carrying both versions,
never one finding per package. ⚠️ In the report, do not offer `node run.mjs
update` as the fix: that command carries guidance text and never code, so it
would bring the paragraph describing the problem forward and leave the
dependency exactly where it is. Raising a version is a decision somebody makes
and then tests. `TEMPLATE_UPDATE_CHECK=off` in the `.env` and a private source
repository (which answers 404) are both **skips with their reason**, never
findings — and a skip goes in the report's `Checks:` header line as skipped,
exactly as `host` does before the first deploy.

### Fixing the ones that do ship

For the ones that do ship:

- Fix by update. `npm audit fix` for the easy half; a pinned major for the rest.
- After any update: `node run.mjs test`. An update that breaks the build is not
  a fix.
- A transitive dependency with no fixed version goes in `overrides` in
  `package.json` — the template already uses that mechanism. **Two packages are
  excluded from it**, see below.
- Framework versions current and patched: Next.js and `next-auth` above all.
  A Next.js version behind a security release is **HIGH** on its own.

Severity comes from npm, but judge it against this app: a ReDoS in a package
that only ever parses your own config is not the same as one in the request
path. Say which it is.

**One set of findings is already judged, and it is not yours to fix.** When a
plain `npm audit` reports findings in the eslint chain that trace to
`brace-expansion` (GHSA-mh99-v99m-4gvg), report them as **known, dev-only,
accepted** — with `npm audit --omit=dev` clean as the evidence — and move on.
How many paths npm counts one advisory on is not a fact about this app; whether
it ships is. Do not spend the check re-deriving them, and above all do not fix
them:

- **`overrides: { "minimatch": "^10" }` makes the audit read clean and breaks the
  linter.** minimatch 10's CommonJS build is not callable, and three
  `eslint-config-next` plugins call it. This app's own `npm run lint` stays
  green, so the damage is invisible here and lands on whoever enables one of
  those rules later. `scripts/deps.test.ts` fails on it.
- **`eslint@10`** (what `npm audit fix --force` proposes) does not remove them:
  the findings arrive through eslint's **plugins**, not through eslint itself,
  so upgrading eslint leaves the plugins' own `minimatch@3` chain exactly where
  it was — and it adds three `ERESOLVE` conflicts on top.

And if `npm audit` reports nothing in that chain at all, that is a normal state
rather than a sign the check did not run. What is accepted here is a **set of
advisory ids**, and a set that matches nothing is good news; the thing that must
never pass unnoticed is an advisory nobody has judged. Say what you ran and what
it answered — never that you expected a particular number and got it.

The full reasoning, with the measurements, is in `scripts/deps.test.ts` and in
`docs/troubleshooting.md` → **What the first install prints — and which of it is
real**. A finding you decide to accept
goes in the report with that decision written next to it — an accepted finding
with no reason recorded is one the next run raises again.
