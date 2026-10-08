CREATE TABLE "studio_selection_ticket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "studio_selection_ticket_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "studio_selection_ticket_email_lower" CHECK ("studio_selection_ticket"."email" = lower("studio_selection_ticket"."email"))
);
--> statement-breakpoint
CREATE TABLE "studio_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"refresh_token_hash" text NOT NULL,
	"previous_refresh_token_hash" text,
	"rotated_at" timestamp with time zone,
	"impersonated_by" uuid,
	CONSTRAINT "studio_session_refresh_token_hash_unique" UNIQUE("refresh_token_hash"),
	CONSTRAINT "studio_session_previous_refresh_token_hash_unique" UNIQUE("previous_refresh_token_hash"),
	CONSTRAINT "studio_session_email_lower" CHECK ("studio_session"."email" = lower("studio_session"."email"))
);
--> statement-breakpoint
CREATE TABLE "studio_sign_in_code" (
	"email" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts_remaining" smallint NOT NULL,
	CONSTRAINT "studio_sign_in_code_email_lower" CHECK ("studio_sign_in_code"."email" = lower("studio_sign_in_code"."email"))
);
--> statement-breakpoint
CREATE TABLE "studio_staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studio_staff_email_lower" CHECK ("studio_staff"."email" = lower("studio_staff"."email")),
	CONSTRAINT "studio_staff_role" CHECK ("studio_staff"."role" in ('administrator', 'accountant'))
);
--> statement-breakpoint
ALTER TABLE "studio_session" ADD CONSTRAINT "studio_session_studio_id_studio_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_session" ADD CONSTRAINT "studio_session_impersonated_by_platform_administrator_id_fk" FOREIGN KEY ("impersonated_by") REFERENCES "public"."platform_administrator"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_staff" ADD CONSTRAINT "studio_staff_studio_id_studio_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "studio_session_studio_email_idx" ON "studio_session" USING btree ("studio_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "studio_staff_studio_email_unique" ON "studio_staff" USING btree ("studio_id","email");--> statement-breakpoint
CREATE INDEX "studio_staff_email_idx" ON "studio_staff" USING btree ("email");--> statement-breakpoint
CREATE INDEX "studio_owner_email_idx" ON "studio" USING btree ("owner_email");--> statement-breakpoint
-- Rights per API user; keep in sync with src/database/expected-grants.ts
GRANT SELECT ON "studio" TO studio_api;--> statement-breakpoint
GRANT SELECT ON "studio_staff" TO studio_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "studio_session" TO studio_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "studio_sign_in_code" TO studio_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "studio_selection_ticket" TO studio_api;