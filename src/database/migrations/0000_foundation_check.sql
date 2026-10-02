CREATE TABLE "foundation_check" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Rights per API user; keep in sync with src/database/expected-grants.ts
GRANT SELECT, INSERT ON "foundation_check" TO platform_api;
--> statement-breakpoint
GRANT SELECT ON "foundation_check" TO studio_api;
