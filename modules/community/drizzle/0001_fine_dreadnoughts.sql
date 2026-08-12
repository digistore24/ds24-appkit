-- Millisecond precision on every timestamp that is COMPARED against a value
-- which has been through a JS Date (a read marker, a live cursor token). The
-- reasoning is at community_messages.createdAt in modules/community/schema.ts.
--
-- ⚠️ On an existing community this ROUNDS the values it narrows (Postgres rounds
-- when reducing precision, it does not truncate), so a message stamped
-- .107735 becomes .108 while the read marker naming it still holds .107 — the
-- conversation stays unread until that member next opens it, and then heals:
-- acknowledgeRead() writes .108, the advance-only clause accepts it, and the
-- comparison becomes equality. No data is lost and nothing needs backfilling.
ALTER TABLE "community_discussions" ALTER COLUMN "last_activity_at" SET DATA TYPE timestamp (3);--> statement-breakpoint
ALTER TABLE "community_discussions" ALTER COLUMN "last_activity_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "community_messages" ALTER COLUMN "created_at" SET DATA TYPE timestamp (3);--> statement-breakpoint
ALTER TABLE "community_messages" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "community_messages" ALTER COLUMN "deleted_at" SET DATA TYPE timestamp (3);--> statement-breakpoint
ALTER TABLE "community_posts" ALTER COLUMN "created_at" SET DATA TYPE timestamp (3);--> statement-breakpoint
ALTER TABLE "community_posts" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "community_posts" ALTER COLUMN "edited_at" SET DATA TYPE timestamp (3);--> statement-breakpoint
ALTER TABLE "community_posts" ALTER COLUMN "deleted_at" SET DATA TYPE timestamp (3);--> statement-breakpoint
ALTER TABLE "community_read_markers" ALTER COLUMN "last_read_created_at" SET DATA TYPE timestamp (3);