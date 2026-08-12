CREATE TYPE "public"."community_deleted_by" AS ENUM('author', 'moderator', 'system');--> statement-breakpoint
CREATE TYPE "public"."community_group_access" AS ENUM('open', 'plan', 'moderators', 'operator');--> statement-breakpoint
CREATE TABLE "community_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"participant_a_id" text,
	"participant_b_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "community_conversations_canonical" CHECK ("community_conversations"."participant_a_id" < "community_conversations"."participant_b_id")
);
--> statement-breakpoint
CREATE TABLE "community_discussions" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text,
	"subject_key" text,
	"title" text,
	"created_by" text,
	"locked_at" timestamp,
	"last_activity_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "community_discussions_one_home" CHECK (("community_discussions"."group_id" is null) <> ("community_discussions"."subject_key" is null)),
	CONSTRAINT "community_discussions_title_shape" CHECK (("community_discussions"."title" is null) = ("community_discussions"."subject_key" is not null))
);
--> statement-breakpoint
CREATE TABLE "community_follows" (
	"id" text PRIMARY KEY NOT NULL,
	"follower_id" text NOT NULL,
	"followed_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "community_follows_not_self" CHECK ("community_follows"."follower_id" <> "community_follows"."followed_id")
);
--> statement-breakpoint
CREATE TABLE "community_group_moderators" (
	"group_id" text NOT NULL,
	"member_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "community_group_moderators_group_id_member_id_pk" PRIMARY KEY("group_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "community_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"access_level" "community_group_access" NOT NULL,
	"plan_keys" text[] DEFAULT '{}' NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_member_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"blocker_id" text NOT NULL,
	"blocked_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"author_id" text,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" "community_deleted_by",
	"removed_reason" text
);
--> statement-breakpoint
CREATE TABLE "community_moderation_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"act" text NOT NULL,
	"target_member_id" text,
	"post_id" text,
	"discussion_id" text,
	"reason" text,
	"exposed_message_ids" text[],
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"discussion_id" text NOT NULL,
	"author_id" text,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"edited_at" timestamp,
	"deleted_at" timestamp,
	"deleted_by" "community_deleted_by",
	"removed_reason" text
);
--> statement-breakpoint
CREATE TABLE "community_profiles" (
	"member_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"about" text,
	"avatar_media_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_read_markers" (
	"member_id" text NOT NULL,
	"discussion_id" text,
	"conversation_id" text,
	"last_read_created_at" timestamp NOT NULL,
	"last_read_id" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "community_read_markers_one_target" CHECK (("community_read_markers"."discussion_id" is null) <> ("community_read_markers"."conversation_id" is null))
);
--> statement-breakpoint
CREATE TABLE "community_spam_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"reporter_id" text,
	"reported_member_id" text,
	"post_id" text,
	"message_id" text,
	"reason" text,
	"attached_message_ids" text[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	"consumed_at" timestamp,
	CONSTRAINT "community_spam_reports_one_target" CHECK (("community_spam_reports"."post_id" is null) <> ("community_spam_reports"."message_id" is null))
);
--> statement-breakpoint
ALTER TABLE "community_conversations" ADD CONSTRAINT "community_conversations_participant_a_id_users_id_fk" FOREIGN KEY ("participant_a_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_conversations" ADD CONSTRAINT "community_conversations_participant_b_id_users_id_fk" FOREIGN KEY ("participant_b_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_discussions" ADD CONSTRAINT "community_discussions_group_id_community_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."community_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_discussions" ADD CONSTRAINT "community_discussions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_follows" ADD CONSTRAINT "community_follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_follows" ADD CONSTRAINT "community_follows_followed_id_users_id_fk" FOREIGN KEY ("followed_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_group_moderators" ADD CONSTRAINT "community_group_moderators_group_id_community_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."community_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_group_moderators" ADD CONSTRAINT "community_group_moderators_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_member_blocks" ADD CONSTRAINT "community_member_blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_member_blocks" ADD CONSTRAINT "community_member_blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_messages" ADD CONSTRAINT "community_messages_conversation_id_community_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."community_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_messages" ADD CONSTRAINT "community_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_moderation_audit" ADD CONSTRAINT "community_moderation_audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_moderation_audit" ADD CONSTRAINT "community_moderation_audit_target_member_id_users_id_fk" FOREIGN KEY ("target_member_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_moderation_audit" ADD CONSTRAINT "community_moderation_audit_post_id_community_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."community_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_moderation_audit" ADD CONSTRAINT "community_moderation_audit_discussion_id_community_discussions_id_fk" FOREIGN KEY ("discussion_id") REFERENCES "public"."community_discussions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_discussion_id_community_discussions_id_fk" FOREIGN KEY ("discussion_id") REFERENCES "public"."community_discussions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_profiles" ADD CONSTRAINT "community_profiles_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_profiles" ADD CONSTRAINT "community_profiles_avatar_media_id_media_id_fk" FOREIGN KEY ("avatar_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_read_markers" ADD CONSTRAINT "community_read_markers_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_read_markers" ADD CONSTRAINT "community_read_markers_discussion_id_community_discussions_id_fk" FOREIGN KEY ("discussion_id") REFERENCES "public"."community_discussions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_read_markers" ADD CONSTRAINT "community_read_markers_conversation_id_community_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."community_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_spam_reports" ADD CONSTRAINT "community_spam_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_spam_reports" ADD CONSTRAINT "community_spam_reports_reported_member_id_users_id_fk" FOREIGN KEY ("reported_member_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_spam_reports" ADD CONSTRAINT "community_spam_reports_post_id_community_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."community_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_spam_reports" ADD CONSTRAINT "community_spam_reports_message_id_community_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."community_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_conversations_pair" ON "community_conversations" USING btree ("participant_a_id","participant_b_id");--> statement-breakpoint
CREATE INDEX "community_conversations_a" ON "community_conversations" USING btree ("participant_a_id");--> statement-breakpoint
CREATE INDEX "community_conversations_b" ON "community_conversations" USING btree ("participant_b_id");--> statement-breakpoint
CREATE INDEX "community_discussions_group_activity" ON "community_discussions" USING btree ("group_id","last_activity_at");--> statement-breakpoint
CREATE UNIQUE INDEX "community_discussions_subject" ON "community_discussions" USING btree ("subject_key") WHERE "community_discussions"."subject_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "community_follows_pair" ON "community_follows" USING btree ("follower_id","followed_id");--> statement-breakpoint
CREATE INDEX "community_follows_followed" ON "community_follows" USING btree ("followed_id");--> statement-breakpoint
CREATE INDEX "community_group_moderators_member" ON "community_group_moderators" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_member_blocks_pair" ON "community_member_blocks" USING btree ("blocker_id","blocked_id");--> statement-breakpoint
CREATE INDEX "community_member_blocks_blocked" ON "community_member_blocks" USING btree ("blocked_id");--> statement-breakpoint
CREATE INDEX "community_messages_conversation" ON "community_messages" USING btree ("conversation_id","created_at","id");--> statement-breakpoint
CREATE INDEX "community_messages_author" ON "community_messages" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "community_moderation_audit_time" ON "community_moderation_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "community_moderation_audit_actor" ON "community_moderation_audit" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "community_moderation_audit_target" ON "community_moderation_audit" USING btree ("target_member_id");--> statement-breakpoint
CREATE INDEX "community_posts_discussion" ON "community_posts" USING btree ("discussion_id","created_at","id");--> statement-breakpoint
CREATE INDEX "community_posts_author" ON "community_posts" USING btree ("author_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_read_markers_discussion" ON "community_read_markers" USING btree ("member_id","discussion_id") WHERE "community_read_markers"."discussion_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "community_read_markers_conversation" ON "community_read_markers" USING btree ("member_id","conversation_id") WHERE "community_read_markers"."conversation_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "community_spam_reports_post" ON "community_spam_reports" USING btree ("reporter_id","post_id") WHERE "community_spam_reports"."post_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "community_spam_reports_message" ON "community_spam_reports" USING btree ("reporter_id","message_id") WHERE "community_spam_reports"."message_id" is not null;--> statement-breakpoint
CREATE INDEX "community_spam_reports_open" ON "community_spam_reports" USING btree ("reported_member_id","created_at") WHERE "community_spam_reports"."consumed_at" is null;