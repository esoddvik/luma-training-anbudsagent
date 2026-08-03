CREATE TYPE "public"."alert_frequency" AS ENUM('immediate', 'daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."attribution_event_type" AS ENUM('tool_to_paafyll', 'tool_to_webinar', 'tool_to_course_seat', 'share_to_signup');--> statement-breakpoint
CREATE TYPE "public"."company_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."consent_source" AS ENUM('signup', 'account_settings', 'checkout', 'invoice_request', 'course_registration', 'newsletter_registration', 'admin_recorded', 'imported', 'api');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('granted', 'withdrawn', 'accepted', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."consent_type" AS ENUM('marketing_email', 'privacy_acknowledgement', 'terms_acceptance');--> statement-breakpoint
CREATE TYPE "public"."criterion_mode" AS ENUM('include', 'exclude');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'scheduled', 'sending', 'sent', 'failed', 'cancelled', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."email_event_type" AS ENUM('delivery', 'bounce', 'spam_complaint', 'subscription_change', 'open', 'click');--> statement-breakpoint
CREATE TYPE "public"."feedback_verdict" AS ENUM('relevant', 'not_relevant', 'already_known', 'wrong_geography', 'wrong_service', 'wrong_size', 'wrong_buyer', 'wrong_cpv', 'other');--> statement-breakpoint
CREATE TYPE "public"."geography_kind" AS ENUM('region', 'municipality');--> statement-breakpoint
CREATE TYPE "public"."ingestion_run_status" AS ENUM('running', 'succeeded', 'failed', 'partial');--> statement-breakpoint
CREATE TYPE "public"."ingestion_trigger" AS ENUM('schedule', 'manual', 'backfill');--> statement-breakpoint
CREATE TYPE "public"."legal_document_kind" AS ENUM('terms', 'privacy');--> statement-breakpoint
CREATE TYPE "public"."marketing_category" AS ENUM('free_guide', 'course', 'nho_course', 'paid_newsletter', 'webinar', 'article', 'tool');--> statement-breakpoint
CREATE TYPE "public"."match_confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."match_entry_type" AS ENUM('reason', 'exclusion');--> statement-breakpoint
CREATE TYPE "public"."match_reason_type" AS ENUM('cpv', 'keyword', 'geography', 'buyer', 'value', 'notice_type', 'procedure', 'deadline');--> statement-breakpoint
CREATE TYPE "public"."mcp_outcome" AS ENUM('ok', 'denied', 'error');--> statement-breakpoint
CREATE TYPE "public"."mcp_scope" AS ENUM('tenders:read', 'profiles:read', 'profiles:write', 'saved:read', 'saved:write', 'feedback:write');--> statement-breakpoint
CREATE TYPE "public"."message_stream" AS ENUM('transactional', 'tender_notifications', 'luma_marketing');--> statement-breakpoint
CREATE TYPE "public"."notice_category" AS ENUM('planned', 'competition', 'award', 'other');--> statement-breakpoint
CREATE TYPE "public"."notification_category" AS ENUM('tender_alerts', 'daily_digest', 'weekly_digest', 'immediate_alerts', 'tender_changes', 'marketing');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('immediate', 'daily_digest', 'weekly_digest', 'tender_change');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('received', 'in_progress', 'activated', 'declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."profile_suggestion_field" AS ENUM('cpvInclude', 'cpvExclude', 'keywordsInclude', 'keywordsExclude', 'buyerExclude', 'regionsInclude', 'estimatedValueMinNok', 'estimatedValueMaxNok');--> statement-breakpoint
CREATE TYPE "public"."profile_suggestion_operation" AS ENUM('add', 'remove', 'set');--> statement-breakpoint
CREATE TYPE "public"."profile_suggestion_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."promotion_placement" AS ENUM('digest_footer', 'tender_detail', 'empty_state', 'mcp_resource');--> statement-breakpoint
CREATE TYPE "public"."region_scope" AS ENUM('national', 'oslo_region');--> statement-breakpoint
CREATE TYPE "public"."suppression_reason" AS ENUM('hard_bounce', 'spam_complaint', 'manual', 'unsubscribe');--> statement-breakpoint
CREATE TYPE "public"."tender_change_kind" AS ENUM('deadline_changed', 'cancelled', 'title_changed', 'description_changed', 'cpv_changed', 'attachment_or_revision_changed', 'buyer_changed', 'value_changed', 'procedure_changed', 'status_changed', 'planned_became_competition');--> statement-breakpoint
CREATE TYPE "public"."tender_source" AS ENUM('doffin');--> statement-breakpoint
CREATE TYPE "public"."tender_status" AS ENUM('open', 'closed', 'cancelled', 'awarded', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_tender_state" AS ENUM('new', 'opened', 'saved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."utm_medium" AS ENUM('digest', 'immediate', 'tender_detail', 'empty_state', 'shared_view', 'mcp', 'landing');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"organization_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "company_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "company_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "magic_link_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"user_id" uuid,
	"token_hash" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"request_ip_hash" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"ip_address_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tender_change_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tender_id" uuid NOT NULL,
	"kind" "tender_change_kind" NOT NULL,
	"summary" text NOT NULL,
	"previous_value" text,
	"current_value" text,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_revision" text
);
--> statement-breakpoint
CREATE TABLE "tender_cpv_codes" (
	"tender_id" uuid NOT NULL,
	"cpv_code" varchar(8) NOT NULL,
	CONSTRAINT "tender_cpv_codes_tender_id_cpv_code_pk" PRIMARY KEY("tender_id","cpv_code")
);
--> statement-breakpoint
CREATE TABLE "tender_municipalities" (
	"tender_id" uuid NOT NULL,
	"municipality_code" text NOT NULL,
	CONSTRAINT "tender_municipalities_tender_id_municipality_code_pk" PRIMARY KEY("tender_id","municipality_code")
);
--> statement-breakpoint
CREATE TABLE "tender_regions" (
	"tender_id" uuid NOT NULL,
	"region_code" text NOT NULL,
	CONSTRAINT "tender_regions_tender_id_region_code_pk" PRIMARY KEY("tender_id","region_code")
);
--> statement-breakpoint
CREATE TABLE "tender_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tender_id" uuid NOT NULL,
	"source_revision" text,
	"source_payload_hash" text NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ingestion_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "tenders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "tender_source" NOT NULL,
	"source_id" text NOT NULL,
	"notice_id" text,
	"notice_uuid" text,
	"contract_folder_id" text,
	"source_url" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"buyer_name" text NOT NULL,
	"buyer_organization_number" text,
	"notice_type" text,
	"notice_category" "notice_category" NOT NULL,
	"procedure_type" text,
	"estimated_value_min_nok" numeric(18, 2),
	"estimated_value_max_nok" numeric(18, 2),
	"currency" varchar(3),
	"published_at" timestamp with time zone NOT NULL,
	"modified_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"status" "tender_status" DEFAULT 'unknown' NOT NULL,
	"source_revision" text,
	"source_payload_hash" text NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"suppressed_at" timestamp with time zone,
	"suppressed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_profile_buyers" (
	"alert_profile_id" uuid NOT NULL,
	"mode" "criterion_mode" NOT NULL,
	"buyer_name" text NOT NULL,
	"normalized_buyer_name" text NOT NULL,
	"organization_number" text,
	CONSTRAINT "alert_profile_buyers_alert_profile_id_mode_normalized_buyer_name_pk" PRIMARY KEY("alert_profile_id","mode","normalized_buyer_name")
);
--> statement-breakpoint
CREATE TABLE "alert_profile_cpv_codes" (
	"alert_profile_id" uuid NOT NULL,
	"mode" "criterion_mode" NOT NULL,
	"cpv_code" varchar(8) NOT NULL,
	CONSTRAINT "alert_profile_cpv_codes_alert_profile_id_mode_cpv_code_pk" PRIMARY KEY("alert_profile_id","mode","cpv_code")
);
--> statement-breakpoint
CREATE TABLE "alert_profile_geographies" (
	"alert_profile_id" uuid NOT NULL,
	"kind" "geography_kind" NOT NULL,
	"code" text NOT NULL,
	CONSTRAINT "alert_profile_geographies_alert_profile_id_kind_code_pk" PRIMARY KEY("alert_profile_id","kind","code")
);
--> statement-breakpoint
CREATE TABLE "alert_profile_keywords" (
	"alert_profile_id" uuid NOT NULL,
	"mode" "criterion_mode" NOT NULL,
	"keyword" text NOT NULL,
	"normalized_keyword" text NOT NULL,
	CONSTRAINT "alert_profile_keywords_alert_profile_id_mode_normalized_keyword_pk" PRIMARY KEY("alert_profile_id","mode","normalized_keyword")
);
--> statement-breakpoint
CREATE TABLE "alert_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"industry_template_id" uuid,
	"notice_types" text[] DEFAULT '{}' NOT NULL,
	"procedure_types" text[] DEFAULT '{}' NOT NULL,
	"include_planned_procurements" boolean DEFAULT true NOT NULL,
	"estimated_value_min_nok" numeric(18, 2),
	"estimated_value_max_nok" numeric(18, 2),
	"deadline_minimum_days" smallint,
	"frequency" "alert_frequency" DEFAULT 'daily' NOT NULL,
	"digest_hour_local" smallint DEFAULT 7 NOT NULL,
	"timezone" text DEFAULT 'Europe/Oslo' NOT NULL,
	"minimum_match_score" numeric(5, 2) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "alert_profiles_digest_hour_range" CHECK ("alert_profiles"."digest_hour_local" BETWEEN 0 AND 23),
	CONSTRAINT "alert_profiles_minimum_score_range" CHECK ("alert_profiles"."minimum_match_score" BETWEEN 0 AND 100),
	CONSTRAINT "alert_profiles_deadline_minimum_days_range" CHECK ("alert_profiles"."deadline_minimum_days" IS NULL OR "alert_profiles"."deadline_minimum_days" BETWEEN 0 AND 365),
	CONSTRAINT "alert_profiles_value_range_ordered" CHECK ("alert_profiles"."estimated_value_min_nok" IS NULL
          OR "alert_profiles"."estimated_value_max_nok" IS NULL
          OR "alert_profiles"."estimated_value_min_nok" <= "alert_profiles"."estimated_value_max_nok")
);
--> statement-breakpoint
CREATE TABLE "industry_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"cpv_include" varchar(8)[] DEFAULT '{}' NOT NULL,
	"cpv_exclude" varchar(8)[] DEFAULT '{}' NOT NULL,
	"keywords_include" text[] DEFAULT '{}' NOT NULL,
	"keywords_exclude" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "industry_templates_slug_format" CHECK ("industry_templates"."slug" ~ '^[a-z0-9-]+$')
);
--> statement-breakpoint
CREATE TABLE "profile_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_profile_id" uuid NOT NULL,
	"field" "profile_suggestion_field" NOT NULL,
	"operation" "profile_suggestion_operation" NOT NULL,
	"value" text NOT NULL,
	"rationale" text NOT NULL,
	"status" "profile_suggestion_status" DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relevance_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"alert_profile_id" uuid,
	"verdict" "feedback_verdict" NOT NULL,
	"comment" text,
	"matching_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relevance_feedback_user_tender_profile_version_key" UNIQUE NULLS NOT DISTINCT("user_id","tender_id","alert_profile_id","matching_version")
);
--> statement-breakpoint
CREATE TABLE "tender_match_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"entry_type" "match_entry_type" NOT NULL,
	"reason_type" "match_reason_type",
	"type_key" text NOT NULL,
	"label" text NOT NULL,
	"contribution" numeric(6, 2),
	"evidence" text[] DEFAULT '{}' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tender_match_reasons_shape" CHECK (("tender_match_reasons"."entry_type" = 'reason'
             AND "tender_match_reasons"."reason_type" IS NOT NULL
             AND "tender_match_reasons"."contribution" IS NOT NULL)
          OR ("tender_match_reasons"."entry_type" = 'exclusion' AND "tender_match_reasons"."reason_type" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "tender_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tender_id" uuid NOT NULL,
	"alert_profile_id" uuid NOT NULL,
	"score" numeric(5, 2) NOT NULL,
	"confidence" "match_confidence" NOT NULL,
	"included" boolean NOT NULL,
	"matching_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tender_matches_score_range" CHECK ("tender_matches"."score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "user_tender_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"state" "user_tender_state" DEFAULT 'new' NOT NULL,
	"opened_at" timestamp with time zone,
	"saved_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tender_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tender_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tender_shares_token_length" CHECK (length("tender_shares"."token") >= 32)
);
--> statement-breakpoint
CREATE TABLE "email_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"postmark_message_id" text NOT NULL,
	"event_type" "email_event_type" NOT NULL,
	"message_stream" "message_stream",
	"recipient_email" text NOT NULL,
	"user_id" uuid,
	"delivery_id" uuid,
	"payload" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"message_stream" "message_stream" NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"suppressed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reactivated_at" timestamp with time zone,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_category_unsubscribes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" "notification_category" NOT NULL,
	"unsubscribed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"alert_profile_id" uuid,
	"kind" "notification_kind" NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"message_stream" "message_stream" NOT NULL,
	"template_alias" text,
	"scheduled_for" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"item_count" integer DEFAULT 0 NOT NULL,
	"postmark_message_id" text,
	"failure_reason" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_delivery_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"tender_match_id" uuid,
	"tender_change_event_id" uuid,
	"section" "notification_kind" DEFAULT 'daily_digest' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tender_alerts_enabled" boolean DEFAULT true NOT NULL,
	"immediate_alerts_enabled" boolean DEFAULT false NOT NULL,
	"digest_enabled" boolean DEFAULT true NOT NULL,
	"include_luma_promotions_in_tender_emails" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"consent_type" "consent_type" NOT NULL,
	"status" "consent_status" NOT NULL,
	"source" "consent_source" NOT NULL,
	"source_detail" text,
	"policy_version" text,
	"terms_version" text,
	"consent_text_version" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"ip_address_hash" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_events_admin_source_detail_required" CHECK ("consent_events"."source" NOT IN ('admin_recorded', 'imported')
          OR ("consent_events"."source_detail" IS NOT NULL AND length(btrim("consent_events"."source_detail")) > 0))
);
--> statement-breakpoint
CREATE TABLE "consent_text_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consent_type" "consent_type" NOT NULL,
	"version" text NOT NULL,
	"body" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_text_versions_type_version_key" UNIQUE("consent_type","version")
);
--> statement-breakpoint
CREATE TABLE "legal_document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_document_id" uuid NOT NULL,
	"kind" "legal_document_kind" NOT NULL,
	"version" text NOT NULL,
	"body" text NOT NULL,
	"is_placeholder" boolean DEFAULT true NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_document_versions_kind_version_key" UNIQUE("kind","version")
);
--> statement-breakpoint
CREATE TABLE "legal_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "legal_document_kind" NOT NULL,
	"title" text NOT NULL,
	"current_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_legal_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"kind" "legal_document_kind" NOT NULL,
	"version" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"ip_address_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" uuid,
	"user_id" uuid,
	"tool" text,
	"resource" text,
	"scope_checked" text,
	"outcome" "mcp_outcome" NOT NULL,
	"error_code" text,
	"duration_ms" integer,
	"ip_address_hash" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" "mcp_scope"[] DEFAULT '{}' NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_tokens_scopes_not_empty" CHECK (cardinality("mcp_tokens"."scopes") >= 1)
);
--> statement-breakpoint
CREATE TABLE "order_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"product_code" text NOT NULL,
	"product_name" text NOT NULL,
	"billing_company_name" text NOT NULL,
	"organization_number" varchar(9),
	"billing_address" text NOT NULL,
	"billing_postal_code" text NOT NULL,
	"billing_city" text NOT NULL,
	"billing_country" text DEFAULT 'Norge' NOT NULL,
	"invoice_email" text NOT NULL,
	"contact_person" text NOT NULL,
	"customer_reference" text,
	"purchase_order_number" text,
	"status" "order_status" DEFAULT 'received' NOT NULL,
	"admin_note" text,
	"handled_by_admin_id" uuid,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_requests_organization_number_format" CHECK ("order_requests"."organization_number" IS NULL OR "order_requests"."organization_number" ~ '^[0-9]{9}$')
);
--> statement-breakpoint
CREATE TABLE "editorial_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"user_id" uuid,
	"placement" "promotion_placement" NOT NULL,
	"delivery_id" uuid,
	"tender_id" uuid,
	"utm_source" text,
	"utm_medium" "utm_medium",
	"utm_campaign" text,
	"utm_content" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editorial_impressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"user_id" uuid,
	"placement" "promotion_placement" NOT NULL,
	"delivery_id" uuid,
	"tender_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editorial_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"url" text NOT NULL,
	"placement" "promotion_placement" NOT NULL,
	"relevance_tags" text[] DEFAULT '{}' NOT NULL,
	"ladder_level" smallint NOT NULL,
	"region_scope" "region_scope" DEFAULT 'national' NOT NULL,
	"marketing_category" "marketing_category" NOT NULL,
	"is_paid" boolean DEFAULT false NOT NULL,
	"campaign" text,
	"active_from" timestamp with time zone,
	"active_until" timestamp with time zone,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "editorial_recommendations_ladder_range" CHECK ("editorial_recommendations"."ladder_level" BETWEEN 1 AND 4),
	CONSTRAINT "editorial_recommendations_window_ordered" CHECK ("editorial_recommendations"."active_from" IS NULL
          OR "editorial_recommendations"."active_until" IS NULL
          OR "editorial_recommendations"."active_from" < "editorial_recommendations"."active_until")
);
--> statement-breakpoint
CREATE TABLE "attribution_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "attribution_event_type" NOT NULL,
	"user_id" uuid,
	"tender_id" uuid,
	"editorial_recommendation_id" uuid,
	"share_id" uuid,
	"utm_source" text,
	"utm_medium" "utm_medium",
	"utm_campaign" text,
	"utm_content" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_checkpoints" (
	"source" "tender_source" PRIMARY KEY NOT NULL,
	"last_successful_run_id" uuid,
	"last_publication_date" date,
	"overlap_days" integer DEFAULT 10 NOT NULL,
	"cursor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"source_id" text,
	"stage" text NOT NULL,
	"message" text NOT NULL,
	"payload" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "tender_source" NOT NULL,
	"status" "ingestion_run_status" DEFAULT 'running' NOT NULL,
	"trigger" "ingestion_trigger" DEFAULT 'schedule' NOT NULL,
	"triggered_by_admin_id" uuid,
	"window_from" timestamp with time zone,
	"window_to" timestamp with time zone,
	"fetched_count" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"unchanged_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"match_jobs_enqueued" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "admin_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before_state" jsonb,
	"after_state" jsonb,
	"reason" text,
	"ip_address_hash" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magic_link_tokens" ADD CONSTRAINT "magic_link_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_change_events" ADD CONSTRAINT "tender_change_events_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_cpv_codes" ADD CONSTRAINT "tender_cpv_codes_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_municipalities" ADD CONSTRAINT "tender_municipalities_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_regions" ADD CONSTRAINT "tender_regions_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_revisions" ADD CONSTRAINT "tender_revisions_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_profile_buyers" ADD CONSTRAINT "alert_profile_buyers_alert_profile_id_alert_profiles_id_fk" FOREIGN KEY ("alert_profile_id") REFERENCES "public"."alert_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_profile_cpv_codes" ADD CONSTRAINT "alert_profile_cpv_codes_alert_profile_id_alert_profiles_id_fk" FOREIGN KEY ("alert_profile_id") REFERENCES "public"."alert_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_profile_geographies" ADD CONSTRAINT "alert_profile_geographies_alert_profile_id_alert_profiles_id_fk" FOREIGN KEY ("alert_profile_id") REFERENCES "public"."alert_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_profile_keywords" ADD CONSTRAINT "alert_profile_keywords_alert_profile_id_alert_profiles_id_fk" FOREIGN KEY ("alert_profile_id") REFERENCES "public"."alert_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_profiles" ADD CONSTRAINT "alert_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_profiles" ADD CONSTRAINT "alert_profiles_industry_template_id_industry_templates_id_fk" FOREIGN KEY ("industry_template_id") REFERENCES "public"."industry_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_suggestions" ADD CONSTRAINT "profile_suggestions_alert_profile_id_alert_profiles_id_fk" FOREIGN KEY ("alert_profile_id") REFERENCES "public"."alert_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relevance_feedback" ADD CONSTRAINT "relevance_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relevance_feedback" ADD CONSTRAINT "relevance_feedback_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relevance_feedback" ADD CONSTRAINT "relevance_feedback_alert_profile_id_alert_profiles_id_fk" FOREIGN KEY ("alert_profile_id") REFERENCES "public"."alert_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_match_reasons" ADD CONSTRAINT "tender_match_reasons_match_id_tender_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."tender_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_matches" ADD CONSTRAINT "tender_matches_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_matches" ADD CONSTRAINT "tender_matches_alert_profile_id_alert_profiles_id_fk" FOREIGN KEY ("alert_profile_id") REFERENCES "public"."alert_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tender_states" ADD CONSTRAINT "user_tender_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tender_states" ADD CONSTRAINT "user_tender_states_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_shares" ADD CONSTRAINT "tender_shares_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_shares" ADD CONSTRAINT "tender_shares_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_delivery_id_notification_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."notification_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_category_unsubscribes" ADD CONSTRAINT "notification_category_unsubscribes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_alert_profile_id_alert_profiles_id_fk" FOREIGN KEY ("alert_profile_id") REFERENCES "public"."alert_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery_items" ADD CONSTRAINT "notification_delivery_items_delivery_id_notification_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."notification_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery_items" ADD CONSTRAINT "notification_delivery_items_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery_items" ADD CONSTRAINT "notification_delivery_items_tender_match_id_tender_matches_id_fk" FOREIGN KEY ("tender_match_id") REFERENCES "public"."tender_matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery_items" ADD CONSTRAINT "notification_delivery_items_tender_change_event_id_tender_change_events_id_fk" FOREIGN KEY ("tender_change_event_id") REFERENCES "public"."tender_change_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_text_version_fk" FOREIGN KEY ("consent_type","consent_text_version") REFERENCES "public"."consent_text_versions"("consent_type","version") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "legal_document_versions" ADD CONSTRAINT "legal_document_versions_legal_document_id_legal_documents_id_fk" FOREIGN KEY ("legal_document_id") REFERENCES "public"."legal_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_legal_acceptances" ADD CONSTRAINT "user_legal_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_legal_acceptances" ADD CONSTRAINT "user_legal_acceptances_version_fk" FOREIGN KEY ("kind","version") REFERENCES "public"."legal_document_versions"("kind","version") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "mcp_audit_events" ADD CONSTRAINT "mcp_audit_events_token_id_mcp_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."mcp_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_audit_events" ADD CONSTRAINT "mcp_audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_handled_by_admin_id_users_id_fk" FOREIGN KEY ("handled_by_admin_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_clicks" ADD CONSTRAINT "editorial_clicks_recommendation_id_editorial_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."editorial_recommendations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_clicks" ADD CONSTRAINT "editorial_clicks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_clicks" ADD CONSTRAINT "editorial_clicks_delivery_id_notification_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."notification_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_clicks" ADD CONSTRAINT "editorial_clicks_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_impressions" ADD CONSTRAINT "editorial_impressions_recommendation_id_editorial_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."editorial_recommendations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_impressions" ADD CONSTRAINT "editorial_impressions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_impressions" ADD CONSTRAINT "editorial_impressions_delivery_id_notification_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."notification_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_impressions" ADD CONSTRAINT "editorial_impressions_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_editorial_recommendation_id_editorial_recommendations_id_fk" FOREIGN KEY ("editorial_recommendation_id") REFERENCES "public"."editorial_recommendations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_share_id_tender_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."tender_shares"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_checkpoints" ADD CONSTRAINT "ingestion_checkpoints_last_successful_run_id_ingestion_runs_id_fk" FOREIGN KEY ("last_successful_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_errors" ADD CONSTRAINT "ingestion_errors_run_id_ingestion_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_triggered_by_admin_id_users_id_fk" FOREIGN KEY ("triggered_by_admin_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_organization_number_key" ON "companies" USING btree ("organization_number");--> statement-breakpoint
CREATE UNIQUE INDEX "company_memberships_company_user_key" ON "company_memberships" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "company_memberships_user_id_idx" ON "company_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "magic_link_tokens_token_hash_key" ON "magic_link_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "magic_link_tokens_email_requested_at_idx" ON "magic_link_tokens" USING btree ("email","requested_at");--> statement-breakpoint
CREATE INDEX "magic_link_tokens_expires_at_idx" ON "magic_link_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "tender_change_events_tender_detected_at_idx" ON "tender_change_events" USING btree ("tender_id","detected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tender_change_events_detected_at_idx" ON "tender_change_events" USING btree ("detected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tender_cpv_codes_cpv_code_idx" ON "tender_cpv_codes" USING btree ("cpv_code");--> statement-breakpoint
CREATE INDEX "tender_municipalities_code_idx" ON "tender_municipalities" USING btree ("municipality_code");--> statement-breakpoint
CREATE INDEX "tender_regions_region_code_idx" ON "tender_regions" USING btree ("region_code");--> statement-breakpoint
CREATE UNIQUE INDEX "tender_revisions_tender_hash_key" ON "tender_revisions" USING btree ("tender_id","source_payload_hash");--> statement-breakpoint
CREATE INDEX "tender_revisions_tender_fetched_at_idx" ON "tender_revisions" USING btree ("tender_id","fetched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "tenders_source_source_id_key" ON "tenders" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "tenders_published_at_idx" ON "tenders" USING btree ("published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tenders_deadline_at_idx" ON "tenders" USING btree ("deadline_at");--> statement-breakpoint
CREATE INDEX "tenders_category_published_at_idx" ON "tenders" USING btree ("notice_category","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tenders_status_deadline_at_idx" ON "tenders" USING btree ("status","deadline_at");--> statement-breakpoint
CREATE INDEX "tenders_notice_id_idx" ON "tenders" USING btree ("notice_id");--> statement-breakpoint
CREATE INDEX "tenders_notice_uuid_idx" ON "tenders" USING btree ("notice_uuid");--> statement-breakpoint
CREATE INDEX "tenders_contract_folder_id_idx" ON "tenders" USING btree ("contract_folder_id");--> statement-breakpoint
CREATE INDEX "tenders_buyer_name_idx" ON "tenders" USING btree ("buyer_name");--> statement-breakpoint
CREATE INDEX "alert_profile_buyers_normalized_idx" ON "alert_profile_buyers" USING btree ("normalized_buyer_name");--> statement-breakpoint
CREATE INDEX "alert_profile_cpv_codes_code_idx" ON "alert_profile_cpv_codes" USING btree ("cpv_code");--> statement-breakpoint
CREATE INDEX "alert_profile_geographies_code_idx" ON "alert_profile_geographies" USING btree ("kind","code");--> statement-breakpoint
CREATE INDEX "alert_profile_keywords_normalized_idx" ON "alert_profile_keywords" USING btree ("normalized_keyword");--> statement-breakpoint
CREATE INDEX "alert_profiles_user_id_idx" ON "alert_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "alert_profiles_schedule_idx" ON "alert_profiles" USING btree ("active","frequency","digest_hour_local");--> statement-breakpoint
CREATE UNIQUE INDEX "industry_templates_slug_key" ON "industry_templates" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "industry_templates_active_sort_idx" ON "industry_templates" USING btree ("active","sort_order");--> statement-breakpoint
CREATE INDEX "profile_suggestions_profile_status_idx" ON "profile_suggestions" USING btree ("alert_profile_id","status");--> statement-breakpoint
CREATE INDEX "relevance_feedback_tender_id_idx" ON "relevance_feedback" USING btree ("tender_id");--> statement-breakpoint
CREATE INDEX "relevance_feedback_verdict_created_idx" ON "relevance_feedback" USING btree ("verdict","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tender_match_reasons_match_id_idx" ON "tender_match_reasons" USING btree ("match_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "tender_matches_tender_profile_version_key" ON "tender_matches" USING btree ("tender_id","alert_profile_id","matching_version");--> statement-breakpoint
CREATE INDEX "tender_matches_profile_score_idx" ON "tender_matches" USING btree ("alert_profile_id","score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tender_matches_profile_included_created_idx" ON "tender_matches" USING btree ("alert_profile_id","included","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tender_matches_tender_id_idx" ON "tender_matches" USING btree ("tender_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_tender_states_user_tender_key" ON "user_tender_states" USING btree ("user_id","tender_id");--> statement-breakpoint
CREATE INDEX "user_tender_states_user_state_idx" ON "user_tender_states" USING btree ("user_id","state","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "tender_shares_token_key" ON "tender_shares" USING btree ("token");--> statement-breakpoint
CREATE INDEX "tender_shares_created_by_idx" ON "tender_shares" USING btree ("created_by_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tender_shares_expires_at_idx" ON "tender_shares" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "tender_shares_tender_id_idx" ON "tender_shares" USING btree ("tender_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_events_message_type_occurred_key" ON "email_events" USING btree ("postmark_message_id","event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "email_events_message_id_idx" ON "email_events" USING btree ("postmark_message_id");--> statement-breakpoint
CREATE INDEX "email_events_user_occurred_idx" ON "email_events" USING btree ("user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "email_events_type_occurred_idx" ON "email_events" USING btree ("event_type","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppressions_email_stream_key" ON "email_suppressions" USING btree ("email","message_stream");--> statement-breakpoint
CREATE INDEX "email_suppressions_email_idx" ON "email_suppressions" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_category_unsubscribes_user_category_key" ON "notification_category_unsubscribes" USING btree ("user_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_idempotency_key" ON "notification_deliveries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_postmark_message_id_key" ON "notification_deliveries" USING btree ("postmark_message_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_user_scheduled_idx" ON "notification_deliveries" USING btree ("user_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "notification_deliveries_status_scheduled_idx" ON "notification_deliveries" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_delivery_items_delivery_tender_key" ON "notification_delivery_items" USING btree ("delivery_id","tender_id");--> statement-breakpoint
CREATE INDEX "notification_delivery_items_tender_id_idx" ON "notification_delivery_items" USING btree ("tender_id");--> statement-breakpoint
CREATE INDEX "consent_events_user_type_occurred_idx" ON "consent_events" USING btree ("user_id","consent_type","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "consent_events_type_status_occurred_idx" ON "consent_events" USING btree ("consent_type","status","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "legal_document_versions_effective_from_idx" ON "legal_document_versions" USING btree ("effective_from" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "legal_documents_kind_key" ON "legal_documents" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "user_legal_acceptances_user_kind_version_key" ON "user_legal_acceptances" USING btree ("user_id","kind","version");--> statement-breakpoint
CREATE INDEX "user_legal_acceptances_kind_version_idx" ON "user_legal_acceptances" USING btree ("kind","version");--> statement-breakpoint
CREATE INDEX "mcp_audit_events_user_occurred_idx" ON "mcp_audit_events" USING btree ("user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "mcp_audit_events_token_occurred_idx" ON "mcp_audit_events" USING btree ("token_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "mcp_audit_events_occurred_idx" ON "mcp_audit_events" USING btree ("occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_tokens_token_hash_key" ON "mcp_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "mcp_tokens_user_id_idx" ON "mcp_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mcp_tokens_prefix_idx" ON "mcp_tokens" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX "order_requests_status_created_idx" ON "order_requests" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "order_requests_user_id_idx" ON "order_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "order_requests_product_code_idx" ON "order_requests" USING btree ("product_code");--> statement-breakpoint
CREATE INDEX "editorial_clicks_recommendation_occurred_idx" ON "editorial_clicks" USING btree ("recommendation_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "editorial_clicks_user_id_idx" ON "editorial_clicks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "editorial_clicks_campaign_idx" ON "editorial_clicks" USING btree ("utm_campaign");--> statement-breakpoint
CREATE INDEX "editorial_impressions_recommendation_occurred_idx" ON "editorial_impressions" USING btree ("recommendation_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "editorial_impressions_user_id_idx" ON "editorial_impressions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "editorial_recommendations_selection_idx" ON "editorial_recommendations" USING btree ("active","placement","ladder_level");--> statement-breakpoint
CREATE INDEX "editorial_recommendations_window_idx" ON "editorial_recommendations" USING btree ("active_from","active_until");--> statement-breakpoint
CREATE INDEX "attribution_events_type_occurred_idx" ON "attribution_events" USING btree ("type","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "attribution_events_occurred_idx" ON "attribution_events" USING btree ("occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "attribution_events_share_id_idx" ON "attribution_events" USING btree ("share_id");--> statement-breakpoint
CREATE INDEX "attribution_events_recommendation_idx" ON "attribution_events" USING btree ("editorial_recommendation_id");--> statement-breakpoint
CREATE INDEX "ingestion_errors_run_occurred_idx" ON "ingestion_errors" USING btree ("run_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ingestion_errors_source_id_idx" ON "ingestion_errors" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "ingestion_runs_started_at_idx" ON "ingestion_runs" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ingestion_runs_source_status_started_idx" ON "ingestion_runs" USING btree ("source","status","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "admin_audit_events_occurred_idx" ON "admin_audit_events" USING btree ("occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "admin_audit_events_entity_idx" ON "admin_audit_events" USING btree ("entity_type","entity_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "admin_audit_events_admin_occurred_idx" ON "admin_audit_events" USING btree ("admin_user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "admin_audit_events_action_idx" ON "admin_audit_events" USING btree ("action");