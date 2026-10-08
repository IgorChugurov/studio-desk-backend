CREATE TABLE "currency" (
	"code" text PRIMARY KEY NOT NULL,
	CONSTRAINT "currency_code" CHECK ("currency"."code" = upper("currency"."code") and char_length("currency"."code") = 3)
);
--> statement-breakpoint
INSERT INTO "currency" ("code") VALUES ('EUR'), ('UAH'), ('USD');
--> statement-breakpoint
ALTER TABLE "studio" ADD COLUMN "language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "studio" ADD COLUMN "country" text DEFAULT 'SK' NOT NULL;--> statement-breakpoint
ALTER TABLE "studio" ADD COLUMN "currency" text DEFAULT 'EUR' NOT NULL;--> statement-breakpoint
ALTER TABLE "studio" ADD COLUMN "time_zone" text DEFAULT 'Europe/Bratislava' NOT NULL;--> statement-breakpoint
ALTER TABLE "studio" ADD CONSTRAINT "studio_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio" ADD CONSTRAINT "studio_language" CHECK ("studio"."language" in ('en', 'sk', 'uk'));--> statement-breakpoint
ALTER TABLE "studio" ADD CONSTRAINT "studio_country" CHECK ("studio"."country" = upper("studio"."country") and char_length("studio"."country") = 2);--> statement-breakpoint
ALTER TABLE "studio" ADD CONSTRAINT "studio_time_zone" CHECK ("studio"."time_zone" = btrim("studio"."time_zone") and char_length("studio"."time_zone") > 0);
--> statement-breakpoint
-- The studio API may change only the settings. Keep in sync with expected-grants.ts
GRANT SELECT ON "currency" TO studio_api;
--> statement-breakpoint
GRANT UPDATE ("language", "country", "currency", "time_zone", "updated_at") ON "studio" TO studio_api;