<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The one-off cases — flags and single scripts

Part of the skill `setup-digistore`, steps 1 and 6. **Nothing in here is part of
the normal path.** `node run.mjs ds24-connect` and `node run.mjs ds24-sync` do the
whole job; this file exists for the rare run that has to go around one of them.

The scripts live under `scripts/ds24/` (Node ESM, dry run by default, `--apply` to
execute) and have their own notes in `scripts/ds24/README.md`.

## Flags of `ds24-connect`

You yourself always take the automatic route — no flag at all.

| Flag | What it does |
|---|---|
| `--print` | shows the key and saves nothing |
| `--port <n>` | says which port the app runs on, for the rare case the script guesses wrong. It normally takes `APP_URL` from the `.env` |
| `--manual` | asks for a key the user created themselves (Digistore24 → Settings → API). It needs a keyboard, so it is the **emergency route** for a user running the command in their own terminal — see [`docs/machine.md`](../../../../docs/machine.md) for `--manual --key <the key>`, which is the form you can run for them |
| `--no-relay` | uses the `localhost` address directly instead of the public redirect page. **Test hosts only** — Digistore24 rejects a non-https `return_url`, so this fails anywhere real |

## A single product outside the registry

```bash
node scripts/ds24/create-product.mjs --saas "…" --plan "…" --apply
```

Only for a product you deliberately want beside the registry. It writes no id
back, so nothing in the app will ever find it — normally take
`node run.mjs ds24-sync`, which maintains the whole plan list for one environment
and registers that environment's IPN connection in the same run (whose first
pass refuses until the new products are confirmed with `--create-new` —
SKILL.md § 3).

## The IPN on its own, with a fixed URL

```bash
node run.mjs ds24-ipn --url https://YOUR-DOMAIN/api/ipn --domain 'YOUR-DOMAIN' --apply
```

Idempotent through the `domain_id`, and Digistore24 generates the SHA512
passphrase in the process — it is written into the `.env` as
`DIGISTORE_IPN_PASSPHRASE`, or pass an existing one with `--passphrase`. Needs
`DIGISTORE_API_KEY` in the environment.

Two things about that registration fail **silently** when they are wrong, and both
are argued in full under *Registering it: two parameters decide whether events
arrive* in
[`docs/digistore-integration.md`](../../../../docs/digistore-integration.md):

- **A `domain_id` you pass by hand has to be UNIQUE, not merely stable.** A
  generic value — `local-app`, `test-local-1` — collides with the user's own other
  project, and the second registration takes over the first one's connection: that
  project's purchases then arrive nowhere, with both runs reporting success. Ids
  the script derives carry a random tail (`local-my-app-diw2hvnz73`); **put random
  characters in one you choose yourself.**
- **`--products 111,222` scopes the connection**, and Digistore24's default is
  `all`. `ds24-sync` sends the ids of the environment it just synced, which is what
  keeps a dev purchase reporting to your machine and a live one to the live app in
  the same vendor account. Force either with
  `node run.mjs ds24-ipn --auto --products 111,222 --apply`.
