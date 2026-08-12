CREATE TABLE "activity_results" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"activity_id" text NOT NULL,
	"subject" text NOT NULL,
	"state" jsonb,
	"score" integer,
	"max_score" integer,
	"passed" boolean,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "activity_results" ADD CONSTRAINT "activity_results_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_results_member_activity_subject" ON "activity_results" USING btree ("member_id","activity_id","subject");--> statement-breakpoint
CREATE INDEX "activity_results_member" ON "activity_results" USING btree ("member_id");