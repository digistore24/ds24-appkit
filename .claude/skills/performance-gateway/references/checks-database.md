<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Database check — `db`

The detail recipe for check 3 of the performance gateway. The menu, the
severity ladder and the finding format are in `SKILL.md`; the severities named
below refer to that ladder.

### The connection pool

`db/index.ts` builds one pool per process, `DB_POOL_MAX`, default 10.

- **One permanently running server** (all four hosts in `docs/DEPLOY.md`):
  10–20 is right. **`DB_POOL_MAX=1` is a CRITICAL** — every request queues
  behind every other and the app is serialised.
- **Several instances or serverless:** connections multiply (instances × pool)
  and Postgres' `max_connections` is the wall. Keep the pool small and put a
  pooler in front (PgBouncer, Neon or Supabase pooling). A pool of 20 on 5
  instances against a 100-connection database is **HIGH**: it works until it
  suddenly does not.
- **One client per process.** A `postgres()` call inside a request handler or a
  module that gets re-imported per request is **CRITICAL** — connections are
  created and never returned.

Check what the database itself thinks:

```sql
SELECT count(*), state FROM pg_stat_activity GROUP BY state;
SHOW max_connections;
```

Run SQL by writing a throwaway script into `.dev/` (it is gitignored, and the
template already uses it for exactly this) and running it with `node` — that
works on all three operating systems, `psql` does not:

```js
// .dev/q.mjs
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
console.log(await sql`SELECT count(*), state FROM pg_stat_activity GROUP BY state`);
await sql.end();
```

### Indexes

Postgres does **not** index foreign keys automatically. The template's own
tables are indexed already — `orders_member`, `grants_member`,
`grants_member_product`, `subscriptions_member`, `chat_messages_member`,
`token_ledger_account_created`, `api_keys_member`, the `ai_usage_*` set. So the
gap is almost always in **the tables the user added themselves**.

For every table in `db/` that is not part of the template: every column used in
a `where` or an `order by` on a page the customer sees needs an index — the
`memberId` column above all. Missing index on an owner column is **HIGH**; it
looks fine at 100 rows and dies at 100,000.

Find it rather than guessing:

```sql
SELECT relname, seq_scan, idx_scan, n_live_tup
FROM pg_stat_user_tables
WHERE seq_scan > idx_scan AND n_live_tup > 500
ORDER BY seq_scan DESC;
```

Then confirm with the actual query:

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT ...;
```

A `Seq Scan` on a table with real rows, a `Rows Removed by Filter` in the
thousands, or a sort with no index behind it — each one is the finding, with the
plan as evidence.

After adding an index: `node run.mjs db-generate`, review the generated file in
`drizzle/`, then `node run.mjs db-migrate`. Never hand-edit a migration that has
run.

### N+1

The pattern that scales with the customer's success. Read every page and action
that renders a list and look for a query inside the loop — or, more honestly,
count the queries: set `DEBUG` logging on postgres.js, or log in the Drizzle
client, load the page once, and count.

Drizzle's answer is `with` (relations) or an explicit join. Missing it is
**MEDIUM** for a list that cannot grow and **HIGH** for one that grows per
customer — orders, invoices, ledger entries, chat messages.

| Queries for one page view | Verdict |
|---|---|
| ≤ 5 | fine |
| 6–20 | ⚠️ MEDIUM |
| 21–50 | ❌ HIGH |
| > 50 | 🚨 CRITICAL |

### The rest

- **Select what you show.** `select()` with no columns fetches every column,
  including ones no page renders. **LOW**, unless the table has a big text
  column in it — then MEDIUM.
- **Paginate lists that grow.** Orders, ledger entries, chat history, IPN
  events. A page that loads everything is **HIGH** the moment somebody uses the
  app a lot.
- **Do not regenerate what is cached.** Checkout URLs live in `buy_url_cache`
  (`lib/digistore/buyUrl.ts`) and cost an API round trip to Digistore24 when
  they miss. Building one per request is **HIGH** — it makes `/plans` as slow as
  a third party's API and as reliable.
- **Prune what only grows.** `ipn_events` and `ai_usage` are append-only.
  `node run.mjs db-prune-ipn` and `db-prune-ai` exist; on a live app they belong
  in the cron (`docs/cron.md`).
