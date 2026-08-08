CREATE TABLE "pending_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"draft_profile" jsonb NOT NULL,
	"service_template_slug" text,
	"return_path" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"request_ip_hash" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pending_signups_token_hash_key" ON "pending_signups" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "pending_signups_email_requested_at_idx" ON "pending_signups" USING btree ("email","requested_at");--> statement-breakpoint
CREATE INDEX "pending_signups_expires_at_idx" ON "pending_signups" USING btree ("expires_at");