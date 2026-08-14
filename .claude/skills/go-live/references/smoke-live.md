<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The live smoke test — the walk-through

Part of the skill `go-live`, step 5. SKILL.md holds the six things that have to be
true; this file is the order they are checked in and what the output means. The
reference underneath is
[`docs/DEPLOY.md`](../../../../docs/DEPLOY.md) → *Proving it works*.

## The two public probes

```
https://YOUR-DOMAIN/api/healthz      → {"status":"ok"}
https://YOUR-DOMAIN/api/readyz       → {"status":"ready"}   (503
                                       {"status":"not-ready"} when the database
                                       does not answer)
```

`readyz` talks to the database and answers **503** `{"status":"not-ready"}` when it
cannot. Both need no credential, which is what makes them the pair an external uptime
check watches — `setup-monitoring` step 4. 🚨 Whoever configures such a check binds it
to the **status code** and matches the body only as `"status":"ready"` **with the
quotes**: the bare word `ready` is a substring of `not-ready`, and a check written on
it stays green while the database is unreachable.

🚨 **Say which way round that keyword rule points, in the same breath.** The alarm
fires when `"status":"ready"` is **ABSENT**, never when it is present — and the
providers name that polarity opposite ways (UptimeRobot's `keyword_type` wants its
*not exists* value; Better Stack's plain `keyword` type is already the right one and
its `keyword_absence` type is the inverse). Read the field's own wording instead of
copying a value: the wrong way round is a check that is green exactly while the app
is down. Per provider: `setup-monitoring` → `references/providers.md`.

`node run.mjs health --url https://YOUR-DOMAIN` asks these two plus the database, the
jobs, the media store and the last payment notification, and gives one verdict.

## Give smoke a way in — once

The development login does not exist on the live app, so without an account smoke can
only watch the protected pages redirect. Provision the smoke member with the
production `DATABASE_URL` set exactly as for `user-create` in step 3:

```
DATABASE_URL="postgres://…" node run.mjs smoke-account --apply
```

It writes a random password into the local `.env`; a re-run rotates it.

## Call every page

```
node run.mjs smoke --url https://YOUR-DOMAIN
```

No 5xx, or the launch is not finished — production runs into errors that never showed
up locally (a missing env value, a migration that was never applied). And no line
saying a route *"redirects to `http://localhost:…`, which only this server can
reach"* — that check exists because the failure it names is a correct 307 to a
correct path on an origin no customer's browser can resolve, which this very script
used to print and tick ([`lib/auth/auth-url.mjs`](../../../../lib/auth/auth-url.mjs)
→ `strandedRedirect()`). Then **read the sign-in line of its output**: *"N protected page(s) NOT checked"* is not a pass, it
names what to fix. And a green remote run is the smaller half of smoke — owner-only
pages count as redirects there, and the server log is not read unless
`DIAGNOSTICS_SECRET` is set. Both are said in the output; keep running smoke locally
too.

## Test the sign-in, and look at the mail

Not only the page it lands on. Does the mail name the product, does the button work,
do the footer's legal links point at the live domain, and does the Impressum's text
stand below them **in the mail's footer**? (Mails only — on the app's own pages the
footer *link* to `/impressum` is the complete answer, and the Impressum's text is
never copied into a page footer;
[`docs/compliance.md`](../../../../docs/compliance.md) § 4.)

Three failures read straight off it: a generic "Sign in" means
`NEXT_PUBLIC_APP_NAME` is missing at the host; a **button pointing anywhere but the
live domain** — `localhost`, the host's internal name — means `APP_URL` at the host is
wrong, and not `AUTH_TRUST_HOST`, which decides nothing about what goes into a mail
(a *missing* `APP_URL` can no longer produce this: STAGING/PROD refuse to boot without
one); and a mail footer without the Impressum block means the Impressum still carries
the shipped placeholder — which `legal-check` in the pre-flight already refuses.

## Domain reputation

Verify the domain in **Google Search Console** now, then read the current verdict
once at `transparencyreport.google.com/safe-browsing/search?url=YOUR-DOMAIN`. If it
ever flags, the recovery path is
[`docs/troubleshooting.md`](../../../../docs/troubleshooting.md) → *Chrome calls the
sign-in link a "Dangerous site"*.

## Content parity — the app's own content, if it ships any

No `content/media-manifest.json` and no `.mjs` in `scripts/content/appliers/` (that
folder ships with the app and is empty) means nothing to do here — one sentence, walk
on. Otherwise everything the app SELLS — course rows, catalog entries, lesson videos,
worksheets — exists so far only in the database and store of the machine it was built
on, and a deploy moves none of it. Store the `MEDIA_S3_*_PROD` reference keys in the
`.env` (the same bucket values `setup-hosting` step 6b stored as secrets at the host),
then:

```
node run.mjs content-media-sync --env prod --apply
DATABASE_URL="postgres://…prod…" node run.mjs content-apply --env prod
node run.mjs content-check --env prod
```

(the `DATABASE_URL` procedure is step 3's, the `user-create` one; the setup-surface
route that needs no connection string at all is
[`docs/content.md`](../../../../docs/content.md)).
**`content-check --env prod` green is the exit condition** — an unreachable store or
database is a failure to fix, never a skip. 🚨 Read the whole answer, not the exit
code: product media is checked with a `head()` per declared file, and a store that
did not answer is printed as `⏭ … NOT checked` with exit 0. That is not a pass —
it is the go-live question going unanswered, and here it has to be answered.
Then open ONE real content page on the
live app with a real slug: `smoke` cannot tell a full course page from an empty one,
both are a 200, so this is the one look no command replaces.

## Knowledge media, if this app has any on the bucket leg

No `.data/knowledge-media/` folder and no `media:` entries in `content/knowledge/`
means nothing to do here. Otherwise the production store has to be filled, or every
media suggestion in the assistant's answers 404s on the live app while every local
gate stays green — same `MEDIA_S3_*_PROD` keys:

```
node run.mjs kb-media-sync --env prod --apply
node run.mjs kb-check
```

**`kb-check` green against the production store is the exit condition** — an
unreachable store is a failure to fix, never a skip. The reference is
[`docs/knowledge.md`](../../../../docs/knowledge.md).

## The purchase

Trigger "test connection" in Digistore24 (IPN `connection_test` → 200), then play a
real/test purchase through: the order shows up and the access is unlocked. Custom
domain and HTTPS active.
