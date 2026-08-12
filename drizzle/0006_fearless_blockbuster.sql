-- The slot an upload ticket's DELIVERY key will be built from
-- (`lib/media/rules.ts` → `MediaSlot`). Decided when the address is minted,
-- used up to an hour later by `confirmUpload()`, so it has to be recorded.
--
-- 🚨 **Hand-adjusted from what drizzle-kit generated, and the reason is the one
-- thing this file has to get right.** The generated form was a bare
-- `ADD COLUMN … text NOT NULL`, which Postgres refuses outright on a table that
-- holds any row — and `media_uploads` holds one per upload in flight. On a
-- deployed app that is `✗ Migration failed` in the release hook, at the one
-- moment nobody wants to be reading a stack trace. Three statements instead:
-- add it nullable, fill what is there, then make the promise. The end state is
-- byte-for-byte the one drizzle's snapshot records (NOT NULL, no default), so
-- the next `db-generate` sees nothing to do.
--
-- The backfill says `core`/`upload` for tickets that predate the column, and
-- that claim is not quite true for one of them: a `courses` video ticket minted
-- minutes before the deploy gets the generic door's slot. It produces no wrong
-- key — the courses confirm door names its own pair, the comparison in
-- `confirmUpload()` refuses the mismatch, and the member uploads again — and the
-- staging object is swept at the ticket's expiry like any other. A ticket is an
-- expectation with an hour to live, which is why this is a re-upload rather than
-- a data migration.
ALTER TABLE "media_uploads" ADD COLUMN "namespace" text;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD COLUMN "category" text;--> statement-breakpoint
UPDATE "media_uploads" SET "namespace" = 'core' WHERE "namespace" IS NULL;--> statement-breakpoint
UPDATE "media_uploads" SET "category" = 'upload' WHERE "category" IS NULL;--> statement-breakpoint
ALTER TABLE "media_uploads" ALTER COLUMN "namespace" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "media_uploads" ALTER COLUMN "category" SET NOT NULL;
