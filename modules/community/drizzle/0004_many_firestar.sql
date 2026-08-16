CREATE TABLE "community_member_standing" (
	"member_id" text PRIMARY KEY NOT NULL,
	"protected_at" timestamp (3),
	"write_blocked_at" timestamp (3),
	"reports_ignored_at" timestamp (3),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_posts" ADD COLUMN "hidden_at" timestamp (3);--> statement-breakpoint
ALTER TABLE "community_member_standing" ADD CONSTRAINT "community_member_standing_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_spam_reports_reporter" ON "community_spam_reports" USING btree ("reporter_id");