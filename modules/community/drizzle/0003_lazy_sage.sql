-- Post images (Story 26.2): which of a member's own pictures sit on which post.
--
-- Taken exactly as drizzle-kit generated it. Unlike 0002 next door there is no
-- locking caveat to record: this creates a NEW table and then indexes it, so the
-- ACCESS EXCLUSIVE lock the index build takes is on a relation nothing can be
-- reading yet.
--
-- The index on `media_id` is not decoration. `ON DELETE set null` makes every
-- `delete from media` look for referencing rows here, and account deletion
-- deletes a member's pictures one row at a time (`deleteOwnedMedia()`) — without
-- it that sweep is one sequential scan of every attachment in the app per
-- picture. The primary key leads with `post_id` and cannot serve it.
CREATE TABLE "community_post_media" (
	"post_id" text NOT NULL,
	"media_id" text,
	"position" integer NOT NULL,
	CONSTRAINT "community_post_media_post_id_position_pk" PRIMARY KEY("post_id","position")
);
--> statement-breakpoint
ALTER TABLE "community_post_media" ADD CONSTRAINT "community_post_media_post_id_community_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."community_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_post_media" ADD CONSTRAINT "community_post_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_post_media_media" ON "community_post_media" USING btree ("media_id");