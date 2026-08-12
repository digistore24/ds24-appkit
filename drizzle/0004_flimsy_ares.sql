CREATE TABLE "notification_sends" (
	"key" text PRIMARY KEY NOT NULL,
	"claimed_at" timestamp DEFAULT now() NOT NULL
);
