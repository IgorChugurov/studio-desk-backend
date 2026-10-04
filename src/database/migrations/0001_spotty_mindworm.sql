CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_administrator_id" uuid NOT NULL,
	"api" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"refresh_token_hash" text NOT NULL,
	"previous_refresh_token_hash" text,
	"rotated_at" timestamp with time zone,
	CONSTRAINT "session_refresh_token_hash_unique" UNIQUE("refresh_token_hash"),
	CONSTRAINT "session_previous_refresh_token_hash_unique" UNIQUE("previous_refresh_token_hash"),
	CONSTRAINT "session_api" CHECK ("session"."api" in ('platform', 'studio'))
);
--> statement-breakpoint
CREATE TABLE "platform_administrator" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_administrator_email_unique" UNIQUE("email"),
	CONSTRAINT "platform_administrator_email_lower" CHECK ("platform_administrator"."email" = lower("platform_administrator"."email"))
);
--> statement-breakpoint
CREATE TABLE "sign_in_code" (
	"email" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts_remaining" smallint NOT NULL,
	CONSTRAINT "sign_in_code_email_lower" CHECK ("sign_in_code"."email" = lower("sign_in_code"."email"))
);
--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_platform_administrator_id_platform_administrator_id_fk" FOREIGN KEY ("platform_administrator_id") REFERENCES "public"."platform_administrator"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_administrator_one_row" ON "platform_administrator" ((true));
--> statement-breakpoint
-- Rights per API user; keep in sync with src/database/expected-grants.ts
GRANT SELECT ON "platform_administrator" TO platform_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "sign_in_code" TO platform_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "session" TO platform_api;