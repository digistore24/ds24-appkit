CREATE TYPE "public"."ipn_result" AS ENUM('accepted', 'invalid_signature', 'connection_test', 'not_configured', 'error');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('paid', 'refunded', 'chargeback', 'paused', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'paused', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."token_ledger_type" AS ENUM('topup', 'consume', 'refund', 'adjust');--> statement-breakpoint
CREATE TYPE "public"."grant_source" AS ENUM('purchase', 'manual');--> statement-breakpoint
CREATE TYPE "public"."chat_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('image', 'video', 'audio', 'file');--> statement-breakpoint
CREATE TYPE "public"."media_source" AS ENUM('upload', 'generated');--> statement-breakpoint
CREATE TYPE "public"."media_visibility" AS ENUM('public', 'owner', 'entitled', 'members');--> statement-breakpoint
CREATE TABLE "accounts" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"emailVerified" timestamp,
	"image" text,
	"role" text DEFAULT 'member' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"checkoutToken" text,
	"blockedAt" timestamp,
	"passwordHash" text,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_checkoutToken_unique" UNIQUE("checkoutToken")
);
--> statement-breakpoint
CREATE TABLE "verificationTokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verificationTokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "buy_url_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_key" text NOT NULL,
	"offer_hash" text NOT NULL,
	"url" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "buy_url_cache_offer" UNIQUE("offer_key")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"ds24_order_id" text NOT NULL,
	"ds24_transaction_id" text NOT NULL,
	"invoice_url" text NOT NULL,
	"amount" numeric(12, 2),
	"currency" text,
	"pay_sequence_no" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_ds24_transaction_id_unique" UNIQUE("ds24_transaction_id")
);
--> statement-breakpoint
CREATE TABLE "ipn_events" (
	"id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"event" text,
	"ds24_order_id" text,
	"ds24_purchase_id" text,
	"signature_valid" boolean NOT NULL,
	"result" "ipn_result" NOT NULL,
	"detail" text,
	"payload" text
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text,
	"ds24_order_id" text NOT NULL,
	"ds24_product_id" text,
	"ds24_purchase_id" text,
	"product_key" text,
	"credits" integer,
	"status" "order_status" NOT NULL,
	"buyer_email" text,
	"buyer_first_name" text,
	"buyer_last_name" text,
	"amount" numeric(12, 2),
	"currency" text,
	"is_gdpr_country" boolean,
	"rebilling_stop_url" text,
	"renew_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "orders_ds24_order_id_unique" UNIQUE("ds24_order_id")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"ds24_purchase_id" text NOT NULL,
	"ds24_order_id" text,
	"ds24_product_id" text,
	"member_id" text,
	"buyer_email" text,
	"status" "subscription_status" NOT NULL,
	"billing_interval" text,
	"amount" numeric(12, 2),
	"currency" text,
	"next_payment_at" date,
	"renew_url" text,
	"rebilling_stop_url" text,
	"invoice_url" text,
	"support_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_purchase" UNIQUE("ds24_purchase_id")
);
--> statement-breakpoint
CREATE TABLE "token_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text,
	"balance" integer DEFAULT 0 NOT NULL,
	"auto_reload_enabled" boolean DEFAULT false NOT NULL,
	"auto_reload_threshold" integer DEFAULT 0 NOT NULL,
	"auto_reload_package_key" text,
	"ds24_purchase_id" text,
	"reload_locked_at" timestamp,
	"last_reload_at" timestamp,
	"reload_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "token_accounts_member" UNIQUE("member_id")
);
--> statement-breakpoint
CREATE TABLE "token_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"type" "token_ledger_type" NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"ds24_order_id" text,
	"note" text,
	"issued_by" text,
	"origin" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "token_ledger_topup_order" UNIQUE("account_id","ds24_order_id")
);
--> statement-breakpoint
CREATE TABLE "grants" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"product_key" text NOT NULL,
	"source" "grant_source" NOT NULL,
	"ds24_purchase_id" text,
	"issued_by" text,
	"note" text,
	"access_until" timestamp,
	"suspended_at" timestamp,
	"ended_at" timestamp,
	"ended_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"memberId" text NOT NULL,
	"newEmail" text NOT NULL,
	"tokenHash" text NOT NULL,
	"requestedAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp NOT NULL,
	CONSTRAINT "email_changes_memberId_unique" UNIQUE("memberId"),
	CONSTRAINT "email_changes_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"conversation_id" text,
	"role" "chat_role" NOT NULL,
	"content" text NOT NULL,
	"links" text[],
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"task" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"member_id" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"thinking_tokens" integer DEFAULT 0 NOT NULL,
	"images" integer DEFAULT 0 NOT NULL,
	"unexplained_tokens" integer DEFAULT 0 NOT NULL,
	"usage_reported" boolean DEFAULT true NOT NULL,
	"cost_micros" bigint,
	"currency" text,
	"cost_source" text DEFAULT 'none' NOT NULL,
	"outcome" text NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cron_runs" (
	"job" text PRIMARY KEY NOT NULL,
	"locked_at" timestamp,
	"last_started_at" timestamp,
	"last_finished_at" timestamp,
	"last_outcome" text,
	"last_detail" text,
	"runs" integer DEFAULT 0 NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "impersonations" (
	"id" text PRIMARY KEY NOT NULL,
	"operator_id" text,
	"member_id" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"ended_by" text
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"purpose" text NOT NULL,
	"granted" boolean NOT NULL,
	"text_version" text NOT NULL,
	"locale" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text,
	"kind" "media_kind" NOT NULL,
	"visibility" "media_visibility" DEFAULT 'owner' NOT NULL,
	"requires_plan" text,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"filename" text,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"duration_seconds" integer,
	"sha256" text NOT NULL,
	"source" "media_source" DEFAULT 'upload' NOT NULL,
	"alt" text,
	"prompt" text,
	"provider" text,
	"model" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "media_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_accounts" ADD CONSTRAINT "token_accounts_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_ledger" ADD CONSTRAINT "token_ledger_account_id_token_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."token_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_ledger" ADD CONSTRAINT "token_ledger_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_changes" ADD CONSTRAINT "email_changes_memberId_users_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonations" ADD CONSTRAINT "impersonations_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonations" ADD CONSTRAINT "impersonations_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_order" ON "invoices" USING btree ("ds24_order_id");--> statement-breakpoint
CREATE INDEX "ipn_events_received" ON "ipn_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "orders_member" ON "orders" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "orders_purchase" ON "orders" USING btree ("ds24_purchase_id");--> statement-breakpoint
CREATE INDEX "orders_created" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "subscriptions_email" ON "subscriptions" USING btree ("buyer_email");--> statement-breakpoint
CREATE INDEX "subscriptions_member" ON "subscriptions" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "token_ledger_topup_order_global" ON "token_ledger" USING btree ("ds24_order_id") WHERE "token_ledger"."ds24_order_id" is not null and "token_ledger"."type" = 'topup';--> statement-breakpoint
CREATE INDEX "token_ledger_account_created" ON "token_ledger" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "grants_purchase_product" ON "grants" USING btree ("ds24_purchase_id","product_key") WHERE "grants"."ds24_purchase_id" is not null;--> statement-breakpoint
CREATE INDEX "grants_member" ON "grants" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "grants_member_product" ON "grants" USING btree ("member_id","product_key");--> statement-breakpoint
CREATE INDEX "chat_messages_member" ON "chat_messages" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_conversation" ON "chat_messages" USING btree ("member_id","conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_created" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_task_created" ON "ai_usage" USING btree ("task","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_provider_model_created" ON "ai_usage" USING btree ("provider","model","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_outcome_created" ON "ai_usage" USING btree ("outcome","created_at");--> statement-breakpoint
CREATE INDEX "impersonations_started_at_idx" ON "impersonations" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "impersonations_member_idx" ON "impersonations" USING btree ("member_id","started_at");--> statement-breakpoint
CREATE INDEX "impersonations_open_idx" ON "impersonations" USING btree ("ended_at","expires_at");--> statement-breakpoint
CREATE INDEX "consent_records_member" ON "consent_records" USING btree ("member_id","purpose","created_at");--> statement-breakpoint
CREATE INDEX "media_owner" ON "media" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "media_requires_plan" ON "media" USING btree ("requires_plan");