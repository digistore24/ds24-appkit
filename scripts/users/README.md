<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Users & roles — CLI

Small, **idempotent** scripts for creating app users and assigning roles.
Plain Node ESM — no build needed. They can be run by hand or by Claude Code
(e.g. in the skill `build-app`, when the operator account is set up).

## Prerequisite (env)

```bash
export DATABASE_URL="postgresql://…"   # the same DB as the app (see .env)
# locally: `docker compose up -d` starts Postgres
```

## Roles

The `users` table has a `role` field (see `db/schema.ts`):

- **`owner`** — SAAS operator (admin). Access to admin areas (`requireOwner()`).
- **`moderator`** — trusted member who keeps community rooms clean. NOT an
  admin: no user management, no roles, no billing.
- **`member`** — regular customer (the default for self sign-in).

`--role` accepts the aliases `admin` (→ `owner`) and `user` (→ `member`);
`moderator` has no alias.

## Creating a user / setting a role (upsert by email)

```bash
# Dry run (only shows what would happen):
node scripts/users/create-user.mjs --email owner@example.com --role owner

# Execute (create OR change the role of an existing email):
node scripts/users/create-user.mjs --email owner@example.com --role owner --apply

# Optionally with a name; without --role, "member" is set:
node scripts/users/create-user.mjs --email customer@example.com --name "Max K." --apply
```

The operator then signs in at `/login` via an **email magic link** — the row
created up front is reused, so he is an `owner` right away.

## Listing users

```bash
node scripts/users/list-users.mjs            # all
node scripts/users/list-users.mjs --role owner
```

## The smoke account (deployed apps)

`smoke-account.mjs` provisions the member account `node run.mjs smoke --url …`
signs in as on a **deployed** app — the development login does not exist there,
so smoke uses the real password sign-in instead. Run it locally with the
deployed database, exactly like `create-user.mjs` at go-live:

```bash
DATABASE_URL="postgresql://…prod…" node run.mjs smoke-account            # dry run
DATABASE_URL="postgresql://…prod…" node run.mjs smoke-account --apply    # write
node run.mjs smoke-account --env staging --apply                         # staging set
```

It creates/updates `smoke@<host of APP_URL_PROD>` (role `member`, deliberately
never `owner` — the script header carries the reasoning), generates a random
password and writes `SMOKE_PROD_EMAIL` / `SMOKE_PROD_PASSWORD` into the local
`.env`. Re-running rotates the password. It refuses a localhost
`DATABASE_URL`, an owner row and a blocked row — those refusals are tested
(`smoke-account.test.ts`), do not soften them.

## Via the runner (from the repo root)

```bash
node run.mjs user-create --email owner@example.com --role owner --apply
node run.mjs user-list --role owner
node run.mjs smoke-account --apply
```

Dry run is the default; only `--apply` writes. `create-user.mjs` and
`smoke-account.mjs` are idempotent (upsert by email), `list-users.mjs` is
read-only.
