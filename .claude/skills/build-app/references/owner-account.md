<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The operator account — the CLI cases and the sign-in details

_Read from `build-app`, step 3b. Locally the first account makes itself; this
file holds why that rule is as narrow as it is, the two cases that still need
the CLI, and how sign-in works._

**The rule is `lib/users/bootstrap.ts`, and it is narrow on purpose: the very
first account, in DEV only.** Anything after it is a `member`, and outside DEV
every account is, including the first — a freshly deployed instance has an
empty user table too, and the first person to sign in there may be a customer.
Handing them user management would be an account takeover.

**What the owner sees in DEV.** The same moment also hands that account a
manual grant for every product the registry has on sale, note `dev-preview` —
otherwise the operator is locked out of the app she just built: the chat, an
activity with `requiresPlan`, a gated room and a self-check in her own course
all check `hasPlan()`, and she has bought nothing. They are ordinary grants,
listed and revocable under **Users → that account**, and a revoked one is not
handed back; `node run.mjs ds24-sync` tops them up when a product is added. To
see the app WITHOUT a grant, use **Sign in as this user** on a test account.

**Two cases still need the CLI**, and neither is step 3b:

```bash
node run.mjs user-create --email <address> --role owner --apply
```

- **STAGING and PROD**, where the bootstrap deliberately does not fire. That
  belongs to `setup-hosting` / `go-live`, not here.
- **When YOU need a signed-in session and cannot open a browser.** The bootstrap
  fires on a real sign-in, and `node run.mjs smoke` never triggers it:
  `scripts/dev/sign-in.mjs` looks an existing owner up and skips with a named
  reason if there is none, rather than putting a row into somebody's database on
  a command they ran to look at pages. If you need `smoke`'s second pass before
  the user has signed in once, run the command above — with the customer's own
  address if the intake gave you one, else `owner@example.com` — and **the
  hand-back names that address**: "sign in with any address, that account is
  the admin" is true only while no owner exists. Measured 2026-09-15: the
  session had created `owner@example.com` for `smoke`, said "any address", and
  the customer signed in as a member with no admin area and a buy button on
  her own course.

Sign-in is by email magic link, and in DEV without mail delivery by the
development login (`lib/auth/dev-login.ts`) — nothing to configure either way.
On top of it every customer may set a password on themselves under
`/dashboard/account`; it is optional and never replaces the link. Protect
admin-only pages with `requireOwner()` (`lib/authz.ts`); model to follow:
`app/dashboard/admin/page.tsx`. Normal customers stay `member` (default).
Details: `scripts/users/README.md` and `docs/auth-setup.md`.
