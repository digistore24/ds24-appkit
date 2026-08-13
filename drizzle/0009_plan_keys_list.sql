ALTER TABLE "media" ADD COLUMN "plan_keys" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD COLUMN "plan_keys" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX "media_plan_keys" ON "media" USING gin ("plan_keys");