CREATE TYPE "public"."setup_app_env" AS ENUM('development', 'staging', 'production');--> statement-breakpoint
CREATE TYPE "public"."setup_outcome" AS ENUM('planned', 'applied', 'refused');--> statement-breakpoint
CREATE TABLE "setup_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"key_id" text,
	"owner_id" text,
	"subject_member_id" text,
	"app_env" "setup_app_env" NOT NULL,
	"tool" text NOT NULL,
	"target" text,
	"role" text,
	"reason" text,
	"outcome" "setup_outcome" NOT NULL,
	"code" text,
	"rows" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setup_confirmations" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"key_id" text NOT NULL,
	"tool" text NOT NULL,
	"input_hash" text NOT NULL,
	"app_env" "setup_app_env" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"spent_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "setup_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	CONSTRAINT "setup_keys_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "setup_audit" ADD CONSTRAINT "setup_audit_key_id_setup_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."setup_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_audit" ADD CONSTRAINT "setup_audit_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_audit" ADD CONSTRAINT "setup_audit_subject_member_id_users_id_fk" FOREIGN KEY ("subject_member_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_confirmations" ADD CONSTRAINT "setup_confirmations_key_id_setup_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."setup_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_keys" ADD CONSTRAINT "setup_keys_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "setup_audit_created_idx" ON "setup_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "setup_audit_subject_idx" ON "setup_audit" USING btree ("subject_member_id");--> statement-breakpoint
CREATE INDEX "setup_confirmations_key_idx" ON "setup_confirmations" USING btree ("key_id");--> statement-breakpoint
CREATE INDEX "setup_keys_owner_idx" ON "setup_keys" USING btree ("owner_id");