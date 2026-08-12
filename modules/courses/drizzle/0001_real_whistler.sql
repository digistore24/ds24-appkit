ALTER TABLE "courses_blocks" ADD COLUMN "origin" text DEFAULT 'content' NOT NULL;--> statement-breakpoint
ALTER TABLE "courses_units" ADD COLUMN "origin" text DEFAULT 'content' NOT NULL;