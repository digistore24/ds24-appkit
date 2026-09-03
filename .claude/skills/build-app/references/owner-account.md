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
  the user has signed in once, run the command above and say that you did.

Sign-in is by email magic link, and in DEV without mail delivery by the
development login (`lib/auth/dev-login.ts`) — nothing to configure either way.
On top of it every customer may set a password on themselves under
`/dashboard/account`; it is optional and never replaces the link. Protect
admin-only pages with `requireOwner()` (`lib/authz.ts`); model to follow:
`app/dashboard/admin/page.tsx`. Normal customers stay `member` (default).
Details: `scripts/users/README.md` and `docs/auth-setup.md`.
