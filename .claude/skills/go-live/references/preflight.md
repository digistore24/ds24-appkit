<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Pre-flight — why each of the seven is there

Part of the skill `go-live`, step 1. SKILL.md holds the checks and the order; this
file holds what each one costs when it is skipped. Four of the seven the host
enforces at boot anyway (`lib/env-guard.ts`), which sounds like a reason not to
check them here and is the opposite: at boot the same fault arrives as *"the deploy
is broken"*, hours after the user was told the app was ready.

## 1 · Green locally

`node run.mjs test` and `node run.mjs build`. Neither proves the app runs — that is
what step 5 is for — but a red test or a failing build on a live domain is a fault
nobody needed to discover from a customer.

## 2 · Mail delivery

In DEV a developer signs in without it, because the development login exists there.
In STAGING and PROD it does not — it is an auth bypass — so an app deployed without
a mail transport **starts, checks, and stops** with `✗ Startup aborted`, and nobody
at all can sign in. `node run.mjs mail-setup` walks through it locally; the detail is
[`docs/auth-setup.md`](../../../../docs/auth-setup.md).

## 3 · The sender address, and the app's name

A sign-in mail whose links point at `your-domain.de` while its From is some other
domain **is the exact shape of a phishing mail**. Recipients report it, filters
agree, and enough reports put the domain on Google's Safe Browsing list — a red
"Dangerous site" page in front of every sign-in link. Recovery is slow and is
[`docs/troubleshooting.md`](../../../../docs/troubleshooting.md) → *Chrome calls the
sign-in link a "Dangerous site"*.

**The domain half is enforced**: STAGING/PROD refuse to start on a foreign or
missing From (deliberate exception `EMAIL_FROM_FOREIGN_DOMAIN`, see
[`docs/auth-setup.md`](../../../../docs/auth-setup.md)). Two halves stay human:

- the address is **verified at the provider** — a Postmark sender signature or the
  whole domain, DKIM and SPF. No code can see the DNS records a provider needs.
- `NEXT_PUBLIC_APP_NAME` is set **at the host**, and set *before the build*: a
  `NEXT_PUBLIC_…` value is baked in, not read at run time. The sign-in mails read it
  too, and without it they open with a generic "Sign in" instead of the product's
  name.

## 4 · Somewhere for files to live

On a host a local disk is not storage. The next deploy takes every uploaded file
with it, and with two instances a customer's picture is present about half the time
— a fault that only appears after the app is successful and cannot be reproduced on
one machine. So `MEDIA_DRIVER=local` outside DEV stops the app booting, the same way
missing mail does ([`docs/visuals.md`](../../../../docs/visuals.md)).

**There is one exemption, and it is why this is a pre-flight item rather than
something the boot guard settles.** An app whose `config/media.json` says
`"enabled": false` accepts no files, so requiring it to book storage before it could
deploy at all would be a bill for nothing. The consequence: **switching media ON
later without a bucket is a state nothing refuses at startup.** Hence both halves,
in order — does this app take files at all (`enabled`, and whether anything calls
`acceptUpload()` or `createMedia()`), and if yes, `node run.mjs media-check`, which
says where files go and proves it by writing, reading and deleting a throwaway
object.

## 5 · The home page

If `app/page.tsx` still carries the shipped placeholder — the three `home.features.*`
keys, with or without swapped texts — the first page every visitor to the live domain
reads is a README about the template. The skill that builds the real one is
**`salespage`** ([`docs/salespage.md`](../../../../docs/salespage.md)).

## 6 · The icons

Five files carry one picture
([`docs/design-system.md`](../../../../docs/design-system.md) § 4), and the three
under `public/icons/` are the ones nobody looks at before a launch — they are what
lands on a customer's home screen and stays there. Check them against `app/icon.png`;
still the shipped placeholder is a finding, and the skill that settles the whole look
is **`design`**. `node run.mjs smoke` proves the manifest and every icon in it really
answer on the deployed domain, which is the half that fails for packaging reasons
rather than for design ones.

## 7 · Migrations and the law

`drizzle/` up to date (`node run.mjs db-generate` after a schema change), and
`node run.mjs legal-check`. That one exits non-zero on the things that must not meet
a customer — an Impressum still carrying the shipped placeholder (§ 5 DDG), a privacy
policy that has not been written (Art. 13 GDPR), an assistant switched on without the
AI notice (Art. 50 EU AI Act). It also says whether the retention jobs have actually
run: *"last run: never"* means the retention period in the privacy policy is not
describing this app.
