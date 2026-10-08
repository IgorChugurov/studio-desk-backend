CREATE TABLE "interface_language" (
	"email" text PRIMARY KEY NOT NULL,
	"language" text NOT NULL,
	CONSTRAINT "interface_language_email_lower" CHECK ("interface_language"."email" = lower("interface_language"."email") and position('@' in "interface_language"."email") > 1),
	CONSTRAINT "interface_language_language" CHECK ("interface_language"."language" in ('en', 'sk', 'uk'))
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "interface_language" TO studio_api;
