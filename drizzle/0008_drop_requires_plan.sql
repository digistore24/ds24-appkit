-- 🚨 NO DATA MIGRATION, and that is a decision rather than an omission.
--
-- `requires_plan` held ONE Product Key; `plan_keys` (0009) holds a list. The
-- values are not carried over: the column is dropped and the new one starts
-- empty on every existing row.
--
-- What that means for an app that already sells files: every `entitled` media
-- row reads `plan_keys = '{}'` after these two migrations, and `mayAccess()`
-- refuses an `entitled` row with no keys. So those files stop being delivered
-- until somebody lists their keys again — a REFUSAL, never a leak, which is
-- the direction every doubt on this path falls. `node run.mjs courses-check`
-- and the operator's media surface are where that shows.
--
-- A fresh app has no such rows, which is the case this template ships.
DROP INDEX "media_requires_plan";--> statement-breakpoint
ALTER TABLE "media" DROP COLUMN "requires_plan";--> statement-breakpoint
ALTER TABLE "media_uploads" DROP COLUMN "requires_plan";