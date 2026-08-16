CREATE TABLE "metrics_daily" (
	"id" text PRIMARY KEY NOT NULL,
	"day" text NOT NULL,
	"event" text NOT NULL,
	"experiment" text DEFAULT '' NOT NULL,
	"variant" text DEFAULT '' NOT NULL,
	"members" integer DEFAULT 0 NOT NULL,
	"events" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metrics_events" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text,
	"event" text NOT NULL,
	"experiment" text DEFAULT '' NOT NULL,
	"variant" text DEFAULT '' NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "metrics_events" ADD CONSTRAINT "metrics_events_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "metrics_daily_day_event_variant" ON "metrics_daily" USING btree ("day","event","experiment","variant");--> statement-breakpoint
CREATE INDEX "metrics_daily_event_day" ON "metrics_daily" USING btree ("event","day");--> statement-breakpoint
CREATE INDEX "metrics_events_occurred" ON "metrics_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "metrics_events_event_occurred" ON "metrics_events" USING btree ("event","occurred_at");--> statement-breakpoint
CREATE INDEX "metrics_events_member" ON "metrics_events" USING btree ("member_id");