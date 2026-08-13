// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Postgres connection + Drizzle client. For server-side use.
//
// The client is created eagerly, but postgres.js only connects on the first
// query — which is why a fallback URL at build time is harmless and
// `next build` does not fail when DATABASE_URL is (still) missing.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://build:build@localhost:5432/build";

// Connection pool per process. Default 10 — carries many concurrent users on a
// single server (Railway/Render/Fly/DigitalOcean). Adjustable via DB_POOL_MAX. On
// serverless / with many instances keep it lower and put a connection pooler
// (PgBouncer / Neon or Supabase pooling) in front. See the performance-gateway
// skill.
const poolMax = Number(process.env.DB_POOL_MAX ?? 10);

// ── Why there is no `types:` mapper for OID 1114 here ─────────────────────
//
// `timestamp` columns (OID 1114) carry NO time zone, and this project stores
// UTC in them. Left to itself postgres.js hands the wire form
// "2026-07-22 12:00:00" to `new Date(...)`, which V8 reads in the PROCESS's
// zone — on a host at UTC+2 every timestamp would arrive two hours early. A
// `types: { 1114: … }` mapper used to stand here against exactly that, with a
// long comment explaining it.
//
// 🚨 **That mapper never ran, and neither will a new one.** `drizzle(client)`
// calls `construct()` (`drizzle-orm/postgres-js/driver.js`), and its first act
// is to overwrite the driver's parser AND serializer for 1184/1082/1083/1114/
// 1182/1185/1115/1231 with `(val) => val`, because drizzle converts at the
// COLUMN. Measured 2026-08-12 against Postgres 16 (Node 22.22.1, postgres
// 3.4.9, drizzle-orm 0.45.2): after this file loads, `client.options
// .parsers["1114"]` IS `(val) => val`, under every process zone.
//
// **What actually keeps the app right is drizzle's own column mapper**, in both
// directions (`drizzle-orm/pg-core/columns/timestamp.js`, class `PgTimestamp`):
//
//   write  `mapToDriverValue` = `value.toISOString()` — the parameter drizzle
//          hands the driver is the string "2026-07-22T12:00:00.000Z"
//   read   `mapFromDriverValue` = `new Date(value + "+0000")` — the zone marker
//          the wire form lacks, added before V8 ever sees it
//
// Round trip through `db` measured at TZ=Europe/Berlin, America/Denver,
// Pacific/Auckland and UTC: identical to the millisecond in all four.
// `db/timestamp-utc.test.ts` is the guard, and it is what goes red if either of
// those two lines ever stops doing this.
//
// ⚠️ **`construct()` MUTATES this client — it does not wrap it.** That is why
// `applierSql` below hands out raw strings for date columns and throws on a
// bound `Date`; see the note there. A bare client that drizzle never touched is
// a different matter and needs its mapping said out loud —
// `scripts/lib/pg-utc.mjs` is where every script's client gets it.
const client = postgres(connectionString, { max: poolMax });

export const db = drizzle(client, { schema });
export { schema };

/**
 * The raw postgres-js handle, for ONE caller.
 *
 * ⚠️ Not a general escape hatch, and not an invitation. Every query in this app
 * goes through `db` and its column mappers — a raw expression carries none, and
 * `db/sql-cast.test.ts` exists because a `sql<Date>` is a string wearing a
 * Date's clothes.
 *
 * The exception is the content appliers. They are written for bare Node against
 * `content-apply`, their contract is `apply(sql, helpers)` / `present(sql)` with
 * a tagged-template handle, and that contract predates this file needing to call
 * them. Duplicating every applier in a second dialect so the presence check
 * could use `db` would be two copies of what an app contains — the exact fault
 * `scripts/content/_appliers.mjs` was written to remove.
 *
 * 🚨 **This handle has NO date mapping, in either direction, and cannot be
 * given one.** It is the same object `drizzle()` was handed above, and
 * `construct()` mutates rather than wraps — so an applier reached through THIS
 * route sees, measured 2026-08-12 against Postgres 16:
 *
 *   read   `select received_at …` → the string `"2026-07-22 12:00:00"`, never a
 *          `Date`. `new Date(...)` on it shifts by the host's offset; add the
 *          `"Z"` (or `to_char(…)` in the query) instead.
 *   write  `${someDate}` → `TypeError: The "string" argument must be … Received
 *          an instance of Date`, because drizzle replaced the serializer too.
 *          That is A71's error, on the applier route.
 *
 * ⚠️ **The same applier gets DIFFERENT types over the other route.**
 * `node run.mjs content-apply` opens its own client (`connectUtc`,
 * `scripts/lib/pg-utc.mjs`), where a date column parses to a correct `Date` and
 * a bound `Date` is refused with a message naming the fix. Measured on the tree
 * of 2026-08-12: no applier and nothing in `lib/content/` reads a date back or
 * binds one, so nothing is broken today — but an applier that starts to must be
 * written for both, and the honest form is to keep dates out of the applier
 * contract and let `to_char(…)`/an explicit `::timestamp` say what is meant.
 */
export { client as applierSql };
