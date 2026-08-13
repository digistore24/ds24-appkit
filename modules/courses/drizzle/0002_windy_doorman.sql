-- 🚨 NO DATA MIGRATION, and that is a decision rather than an omission.
--
-- `courses_blocks.course_id` arrives NOT NULL with no default and no backfill,
-- so this migration REFUSES on a database that already holds blocks. That is
-- the loud direction, and it is the one worth having: the alternative is
-- inventing a course row and assigning every existing block to it, which is a
-- guess about somebody's product wearing the clothes of a migration.
--
-- A fresh app has no such rows — the module ships off and empty, which is the
-- case this template ships and the case `deploy-test-modules` builds.
--
-- Whoever DOES hold blocks and wants them kept: insert one course row and point
-- them at it before running this, in that order —
--
--   insert into courses_courses (id, slug, title, shape, plan_keys)
--   values (gen_random_uuid()::text, 'main', '<your title>',
--           '<self-study|drip|workshop>', '{"<your product key>"}');
--   alter table courses_blocks add column course_id text;
--   update courses_blocks set course_id = (select id from courses_courses where slug = 'main');
--
-- …then this file's own ALTER finds nothing left to refuse. Locally, the
-- shorter answer is `node run.mjs db-reset`.
CREATE TABLE "courses_courses" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"origin" text DEFAULT 'content' NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"position" integer DEFAULT 0 NOT NULL,
	"shape" text NOT NULL,
	"plan_keys" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "courses_blocks_position";--> statement-breakpoint
ALTER TABLE "courses_blocks" ADD COLUMN "course_id" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "courses_courses_slug" ON "courses_courses" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "courses_courses_position" ON "courses_courses" USING btree ("position");--> statement-breakpoint
ALTER TABLE "courses_blocks" ADD CONSTRAINT "courses_blocks_course_id_courses_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "courses_blocks_course_position" ON "courses_blocks" USING btree ("course_id","position");