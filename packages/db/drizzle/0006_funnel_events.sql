CREATE TYPE "public"."funnel_event_type" AS ENUM('picker_viewed', 'trade_selected', 'region_selected', 'results_viewed', 'signup_started', 'signup_completed', 'profile_activated');--> statement-breakpoint
CREATE TABLE "funnel_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "funnel_event_type" NOT NULL,
	"service_template_slug" text,
	"landsdel_slug" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "funnel_events_type_occurred_idx" ON "funnel_events" USING btree ("type","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "funnel_events_template_type_idx" ON "funnel_events" USING btree ("service_template_slug","type");