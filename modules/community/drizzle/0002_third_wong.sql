-- The two indexes `community-prune` needs. Without them its batched sweep would
-- rescan the table once per batch — see lib/cron/prune.ts, point 3.
--
-- ⚠️ **Plain `CREATE INDEX`, and on a grown `community_messages` that holds an
-- ACCESS EXCLUSIVE lock for as long as the build takes — during the deploy,
-- because that is when `db-migrate` runs.** `CREATE INDEX CONCURRENTLY` is the
-- usual answer and is **not available here**: drizzle's migrator wraps the whole
-- run in one transaction (`pg-core/dialect` → `session.transaction`), and
-- Postgres refuses CONCURRENTLY inside a transaction block. No migration in this
-- repo uses it, and none can while migrations are applied this way.
--
-- So the open question is not "add the keyword" — it is whether this project
-- wants an out-of-band index path at all, which is a decision about how deploys
-- apply schema changes rather than about this file. Recorded in
-- `deferred-work.md` under the Epic 13 review, where it was first raised.
CREATE INDEX "community_messages_created" ON "community_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "community_spam_reports_handled" ON "community_spam_reports" USING btree ("created_at") WHERE "community_spam_reports"."consumed_at" is not null;