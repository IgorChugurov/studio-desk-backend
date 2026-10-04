CREATE TABLE "studio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"subdomain" text NOT NULL,
	"custom_domain" text,
	"owner_email" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studio_name_length" CHECK (char_length("studio"."name") between 2 and 100 and "studio"."name" = btrim("studio"."name")),
	CONSTRAINT "studio_subdomain_format" CHECK ("studio"."subdomain" = lower("studio"."subdomain") and "studio"."subdomain" ~ '^[a-z][a-z0-9-]{1,18}[a-z0-9]$'),
	CONSTRAINT "studio_custom_domain_format" CHECK ("studio"."custom_domain" is null or (
        "studio"."custom_domain" = lower("studio"."custom_domain")
        and char_length("studio"."custom_domain") between 1 and 253
        and "studio"."custom_domain" !~ '://'
        and "studio"."custom_domain" ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
        and "studio"."custom_domain" <> 'studio-desk.axondigital.xyz'
        and "studio"."custom_domain" !~ '\.studio-desk\.axondigital\.xyz$'
      )),
	CONSTRAINT "studio_owner_email_lower" CHECK ("studio"."owner_email" = lower("studio"."owner_email") and position('@' in "studio"."owner_email") > 1),
	CONSTRAINT "studio_status" CHECK ("studio"."status" in ('active', 'deactivated'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "studio_subdomain_unique" ON "studio" USING btree ("subdomain");--> statement-breakpoint
CREATE UNIQUE INDEX "studio_custom_domain_unique" ON "studio" USING btree ("custom_domain") WHERE "studio"."custom_domain" is not null;
--> statement-breakpoint
-- Rights per API user; keep in sync with src/database/expected-grants.ts
GRANT SELECT, INSERT, UPDATE ON "studio" TO platform_api;