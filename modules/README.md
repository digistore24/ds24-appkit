<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# `modules/` — the optional halves of this app

Empty in a fresh app, and that is the shipped state: a new project is the core
and nothing else.

A module is a whole feature — its pages, its tables, its texts, its guidance —
that an app either has or does not. It lives in one folder here, declares itself
in `module.json`, and joins the app by being declared rather than by somebody
remembering to add a line somewhere.

The reference is [`docs/modules.md`](../docs/modules.md); `node run.mjs module
list` says what this app is made of.

```
modules/community/
  module.json      the manifest — what this module is
  module.ts        the SERVER entry: schema, eraseFor(), shellState()
  nav.ts           CLIENT-SAFE: navigation entries, nothing else
  gate.ts          the off-state, read in front of every request
  schema.ts        its tables
  drizzle/         its own migration chain, its own journal table
  messages/        its own text namespaces
  privacy/         its two GDPR contributors (TypeScript and bare Node)
  guidance/        its CLAUDE.md fragment, docs and skill
```

**Three files, three worlds, and mixing them is the one mistake this layout
exists to prevent:**

| | Runs where | Must never reach |
|---|---|---|
| `nav.ts` | the browser | anything but static data and an icon |
| `gate.ts` | in front of every request | the database |
| `module.ts` | the server | the browser |

`modules/boundary.test.ts` holds all three, and holds the core to naming no
module outside the generated registries.
