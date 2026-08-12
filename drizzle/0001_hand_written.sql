-- HAND-WRITTEN, and it must survive every regeneration of this chain.
--
-- Everything else in `drizzle/` is generated from `db/schema-core.ts`. This file
-- is not: it holds the DDL Drizzle's DSL cannot express, and a regeneration
-- silently drops it — which is exactly what happened when the chain was squashed
-- to give the first module its own, and only a schema comparison against the
-- previous chain noticed.
--
-- ⚠️ Whoever regenerates this chain re-applies this file afterwards and then
-- compares the resulting schema against the old one. That comparison is the
-- only thing that notices: a missing index is not a build error, not a failing
-- test and not a wrong answer — it is a sequential scan nobody sees until the
-- orders table is large.
--
-- The claim's hot path. On every sign-in it runs
--   WHERE member_id IS NULL AND status = 'paid'
--     AND lower(btrim(buyer_email)) = $1
-- Without this index, a sign-in seq-scans every order ever placed.
CREATE INDEX IF NOT EXISTS "orders_unclaimed_buyer_email"
  ON "orders" (lower(btrim("buyer_email")))
  WHERE "member_id" IS NULL;
