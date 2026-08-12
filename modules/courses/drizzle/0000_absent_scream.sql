CREATE TABLE "courses_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"position" integer NOT NULL,
	"release_after_days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses_completions" (
	"member_id" text NOT NULL,
	"unit_slug" text NOT NULL,
	"completed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "courses_completions_member_id_unit_slug_pk" PRIMARY KEY("member_id","unit_slug")
);
--> statement-breakpoint
CREATE TABLE "courses_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"unit_slug" text NOT NULL,
	"body" text NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"reply" text,
	"replied_at" timestamp,
	"replied_by" text
);
--> statement-breakpoint
CREATE TABLE "courses_units" (
	"id" text PRIMARY KEY NOT NULL,
	"block_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"body" text,
	"cover_media_id" text,
	"video_media_id" text,
	"subtitle_media_id" text,
	"worksheet_media_id" text,
	"task_prompt" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "courses_completions" ADD CONSTRAINT "courses_completions_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses_submissions" ADD CONSTRAINT "courses_submissions_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses_submissions" ADD CONSTRAINT "courses_submissions_replied_by_users_id_fk" FOREIGN KEY ("replied_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses_units" ADD CONSTRAINT "courses_units_block_id_courses_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."courses_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses_units" ADD CONSTRAINT "courses_units_cover_media_id_media_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses_units" ADD CONSTRAINT "courses_units_video_media_id_media_id_fk" FOREIGN KEY ("video_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses_units" ADD CONSTRAINT "courses_units_subtitle_media_id_media_id_fk" FOREIGN KEY ("subtitle_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses_units" ADD CONSTRAINT "courses_units_worksheet_media_id_media_id_fk" FOREIGN KEY ("worksheet_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "courses_blocks_slug" ON "courses_blocks" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "courses_blocks_position" ON "courses_blocks" USING btree ("position");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_submissions_member_unit" ON "courses_submissions" USING btree ("member_id","unit_slug");--> statement-breakpoint
CREATE INDEX "courses_submissions_waiting" ON "courses_submissions" USING btree ("replied_at","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_units_slug" ON "courses_units" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "courses_units_block_position" ON "courses_units" USING btree ("block_id","position");