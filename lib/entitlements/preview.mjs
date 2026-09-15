// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// DEV preview grants — why the operator can open the things she sells.
//
// ── The defect this exists for (measured 2026-09-15) ───────────────────────
// A customer built her app, signed in as the owner, and could not use it. The
// chat on `/dashboard/chat` answered "Kein Zugang"; a self-check inside HER OWN
// course answered "Dieses Element gehört zu einem Produkt, das du noch nicht
// hast". Everything she had just built was gated on a plan she had never
// bought, because nobody sells themselves their own product.
//
// ── Why the fix is a GRANT and not a role check ────────────────────────────
// 🚨 Entitlements are ROLE-BLIND and stay that way. `hasPlan()` in
// `lib/entitlements/manage.ts` reads the `grants` table and nothing else — it
// never looks at `users.role`. That is the decision, not an oversight:
//
//   - An `if (role === "owner") return true` inside `hasPlan()` would make
//     every gate in the app invisible to the ONE person who could notice it is
//     wrong. A broken gate would then only ever be found by a paying customer.
//   - The chat's content source deliberately keeps `role` null, so only a REAL
//     grant lets the owner's assistant answer out of her own course. An owner
//     bypass would answer from content the grant never opened, and the operator
//     would be testing a retrieval path her buyers never walk.
//
// So the owner gets what a buyer gets: a row in `grants`. Issued by hand, in
// DEV only, carrying the note `dev-preview` — which makes it visible on her own
// member page in the admin area and revocable there like any other manual
// grant. Nothing about STAGING or PROD changes; there the operator buys a test
// purchase or signs in as a customer.
//
// ── Two entry points, one decision ─────────────────────────────────────────
// The app reaches this through drizzle (`db` from `@/db`), the setup scripts
// through a bare postgres.js handle (`connect()` in `scripts/users/_db.mjs`).
// Both are tagged templates, so the QUERIES below are written once as
// `(tag) => tag`…`` and each adapter only decides who runs them. The rule that
// says whether a product needs a grant lives in exactly one place, and it is
// this file.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The `note` every grant this module writes carries.
 *
 * It is the marker AND the memory: a row with this note that has been ended is
 * how the operator says "no, I do not want this one" — see `ensureOperatorPreviewGrants`.
 * It is deliberately a note and not a new `grants.source`: `source` is
 * provenance (`purchase` or `manual`, the two values `grant-rules.ts` reasons
 * about), and this IS a manual grant — the operator's own installation issued
 * it to the operator.
 */
export const DEV_PREVIEW_NOTE = "dev-preview";

// ── Who decides "is this DEV?" — the CALLER, with the reader it already has ──
// This module does not classify APP_ENV. There are two readers of that value
// in the tree (`appEnv()` in `lib/env-guard.ts` for the app, `syncEnvFromAppEnv()`
// in `scripts/ds24/_env.mjs` for the scripts) and a third copy here would be
// the one the next alias forgets. And APP_ENV alone is not the question for a
// script: `docs/DEPLOY.md` creates the first PROD owner with a production
// DATABASE_URL in the shell of a laptop whose APP_ENV is unset — so a script
// passes `dev` only when ITS environment is dev AND the database it holds is
// local (`isLocalDatabaseUrl()` in `scripts/lib/media-env.mjs`). Reviewed
// 2026-09-15: the first cut read `process.env.APP_ENV` here and would have
// written preview comps into a live database from that documented command.

/**
 * The Product Keys on sale, out of a parsed `config/digistore-products.json`.
 *
 * `sell !== false` and not a truthiness test — the same reading `isSold()` has
 * in `lib/digistore/products.ts` and in `scripts/ds24/_products.mjs`: a
 * registry written before the field existed has no `sell` at all and is fully
 * on sale. A parked offering gets no preview grant, because the operator is not
 * selling it and has nothing to preview.
 */
export function sellableKeysFrom(registry) {
  return Object.entries(registry?.products ?? {})
    .filter(([, def]) => def?.sell !== false)
    .map(([key]) => key);
}

/**
 * Reads the product registry off disk.
 *
 * ⚠️ Only the SCRIPTS reach this. Inside the app the registry arrives as a
 * normal JSON import (`sellableProducts()` in `lib/digistore/products.ts`,
 * handed in as `productKeys` by `lib/entitlements/dev-preview.ts`) — a bundled
 * module cannot resolve a path relative to its own source file, so a file read
 * here would be right in this tree and wrong in `.next/`.
 */
export function readRegistry() {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = join(here, "..", "..", "config", "digistore-products.json");
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * What the app already knows about one member and one Product Key, as two
 * booleans — computed in SQL so no date crosses the driver boundary at all.
 *
 * `active` is `activeFor()` from `lib/entitlements/manage.ts`, verbatim: not
 * ended, not suspended, and either no term or a term that has not run out —
 * judged against `now() at time zone 'utc'`, the same server-side instant
 * `withinTerm()` there uses, so this predicate and that one cannot disagree
 * by clock source (a `timestamp` column compared to a zone-free `now()`, as
 * that function's comment explains; `docs/conventions.md` → *Dates*).
 * `any` is "a grant row for this key exists in whatever state".
 */
function stateQuery(tag, memberId, productKey) {
  return tag`
    select
      coalesce(bool_or(
        ended_at is null
        and suspended_at is null
        and (access_until is null or access_until > (now() at time zone 'utc'))
      ), false) as active,
      count(*) > 0 as any
    from grants
    where member_id = ${memberId} and product_key = ${productKey}
  `;
}

/**
 * The insert, shaped exactly like `grantByHand()` in
 * `lib/entitlements/manage.ts` writes one — and deliberately NOT a call to it:
 * that function takes an `Actor` from a live session and validates `reason` as
 * operator form input, neither of which exists on a sign-in or in a script.
 *
 * `id` is supplied because it is a DRIZZLE default (`$defaultFn`), not a column
 * default — raw SQL would otherwise hit a NOT NULL primary key.
 * `ds24_purchase_id` and `access_until` are written as literal `null` rather
 * than left out, for the reason `grantByHand` gives: provenance is the one
 * thing separating a comp from a payment, and it should be readable at the call
 * site. `issued_by` is the owner herself — this is her own installation handing
 * it to her, and the admin page shows it that way.
 */
function insertQuery(tag, { id, memberId, productKey }) {
  return tag`
    insert into grants
      (id, member_id, product_key, source, ds24_purchase_id, issued_by, note, access_until)
    values
      (${id}, ${memberId}, ${productKey}, 'manual', null, ${memberId}, ${DEV_PREVIEW_NOTE}, null)
  `;
}

/** The scripts' door: a bare postgres.js tagged template. */
function postgresStore(sql) {
  return {
    async state(memberId, productKey) {
      const rows = await stateQuery(sql, memberId, productKey);
      return rows?.[0] ?? {};
    },
    async insert(row) {
      await insertQuery(sql, row);
    },
  };
}

/**
 * The app's door: drizzle's own `sql` tag, run through `db.execute`.
 *
 * `drizzle-orm` is imported lazily so a plain-Node script that only ever passes
 * `sql` never loads it.
 */
async function drizzleStore(db) {
  const { sql: raw } = await import("drizzle-orm");
  const rowsOf = (result) =>
    Array.isArray(result) ? result : (result?.rows ?? []);
  return {
    async state(memberId, productKey) {
      const result = await db.execute(stateQuery(raw, memberId, productKey));
      return rowsOf(result)[0] ?? {};
    },
    async insert(row) {
      await db.execute(insertQuery(raw, row));
    },
  };
}

/**
 * Give one member — the app OWNER — a manual grant for every product this app
 * sells, so that she can use what she sells. DEV only — and the caller says so.
 *
 * @param {object} args
 * @param {string} args.memberId          the owner's `users.id`
 * @param {boolean} args.dev              true only in DEV against a LOCAL database
 *                                        (see the note above `DEV_PREVIEW_NOTE`)
 * @param {any}   [args.sql]              postgres.js handle (scripts)
 * @param {any}   [args.db]               drizzle client (the app)
 * @param {string[]} [args.productKeys]   the keys to cover; default: the registry
 * @param {object} [args.registry]        a parsed registry, instead of reading one
 * @returns {Promise<{skipped: "not-dev"} | {granted: string[], kept: string[]}>}
 *
 * Per Product Key, exactly three outcomes:
 *
 *   an ACTIVE grant of any source          → kept. A purchase, a comp, or the
 *                                            preview grant from the last run.
 *   any grant row in another state         → kept. A `dev-preview` the operator
 *                                            revoked, a test purchase she
 *                                            refunded or paused to SEE the
 *                                            closed and paused pages — a comp
 *                                            beside it would reopen exactly the
 *                                            state she is looking at (reviewed
 *                                            2026-09-15; the first cut only
 *                                            remembered its own rows).
 *   no row at all                          → granted.
 *
 * Idempotent by the first two rules, which is what makes it safe on EVERY
 * owner sign-in rather than only on the first. One round trip per product; a
 * registry has a handful of entries and this runs on a developer's laptop.
 *
 * 🚨 There is no unique index behind it — `grants_purchase_product` is PARTIAL
 * and covers purchase rows only (`db/schema-entitlements.ts`). Two sign-ins in
 * the same millisecond could therefore write two preview rows. That is the same
 * trade `roleForNewUser()` makes one layer up, for the same reason: a write
 * lock in front of every sign-in is a high price, and two identical comps on a
 * local machine are not a problem.
 */
export async function ensureOperatorPreviewGrants({
  memberId,
  dev = false,
  sql,
  db,
  productKeys,
  registry,
} = {}) {
  if (dev !== true) return { skipped: "not-dev" };
  if (!memberId) {
    throw new Error("ensureOperatorPreviewGrants: memberId is required");
  }
  if (!sql && !db) {
    throw new Error(
      "ensureOperatorPreviewGrants: pass either `sql` (postgres.js) or `db` (drizzle)",
    );
  }

  const keys = productKeys ?? sellableKeysFrom(registry ?? readRegistry());
  const store = sql ? postgresStore(sql) : await drizzleStore(db);

  const granted = [];
  const kept = [];
  for (const productKey of keys) {
    const state = await store.state(memberId, productKey);
    if (state.active || state.any) {
      kept.push(productKey);
      continue;
    }
    await store.insert({ id: randomUUID(), memberId, productKey });
    granted.push(productKey);
  }
  return { granted, kept };
}
