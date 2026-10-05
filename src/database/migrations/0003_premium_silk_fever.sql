CREATE TABLE "handoff_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"studio_id" uuid NOT NULL,
	"platform_administrator_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "handoff_code_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "handoff_code" ADD CONSTRAINT "handoff_code_studio_id_studio_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_code" ADD CONSTRAINT "handoff_code_platform_administrator_id_platform_administrator_id_fk" FOREIGN KEY ("platform_administrator_id") REFERENCES "public"."platform_administrator"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Rights per API user; keep in sync with src/database/expected-grants.ts
GRANT SELECT, INSERT ON "handoff_code" TO platform_api;
