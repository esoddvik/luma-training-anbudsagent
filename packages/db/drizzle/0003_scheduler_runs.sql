CREATE TABLE "scheduler_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"window_from" timestamp with time zone,
	"window_to" timestamp with time zone NOT NULL,
	"candidates_considered" integer DEFAULT 0 NOT NULL,
	"due_count" integer DEFAULT 0 NOT NULL,
	"claimed_count" integer DEFAULT 0 NOT NULL,
	"skipped_already_sent" integer DEFAULT 0 NOT NULL,
	"skipped_empty" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "scheduler_runs_job_window_idx" ON "scheduler_runs" USING btree ("job_name","window_to");