ALTER TYPE "public"."mcp_scope" ADD VALUE 'documents:read';--> statement-breakpoint
CREATE TABLE "user_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_code" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"granted_by_admin_id" uuid,
	"order_request_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD CONSTRAINT "user_entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD CONSTRAINT "user_entitlements_granted_by_admin_id_users_id_fk" FOREIGN KEY ("granted_by_admin_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD CONSTRAINT "user_entitlements_order_request_id_order_requests_id_fk" FOREIGN KEY ("order_request_id") REFERENCES "public"."order_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_entitlements_user_product_key" ON "user_entitlements" USING btree ("user_id","product_code");--> statement-breakpoint
CREATE INDEX "user_entitlements_expires_idx" ON "user_entitlements" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "user_entitlements_product_idx" ON "user_entitlements" USING btree ("product_code");