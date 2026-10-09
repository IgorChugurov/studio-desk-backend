CREATE TABLE "class_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_type_name_not_blank" CHECK ("class_type"."name" = btrim("class_type"."name") and char_length("class_type"."name") > 0),
	CONSTRAINT "class_type_description_not_blank" CHECK ("class_type"."description" is null or ("class_type"."description" = btrim("class_type"."description") and char_length("class_type"."description") > 0))
);
--> statement-breakpoint
CREATE TABLE "class_type_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_type_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"content_type" text NOT NULL,
	"index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_type_file_index_non_negative" CHECK ("class_type_file"."index" >= 0),
	CONSTRAINT "class_type_file_content_type" CHECK ("class_type_file"."content_type" in (
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'video/mp4', 'video/webm'
      )),
	CONSTRAINT "class_type_file_storage_path_not_blank" CHECK ("class_type_file"."storage_path" = btrim("class_type_file"."storage_path") and char_length("class_type_file"."storage_path") > 0)
);
--> statement-breakpoint
CREATE TABLE "trainer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"instagram" text,
	"tiktok" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trainer_name_not_blank" CHECK ("trainer"."name" = btrim("trainer"."name") and char_length("trainer"."name") > 0),
	CONSTRAINT "trainer_description_not_blank" CHECK ("trainer"."description" is null or ("trainer"."description" = btrim("trainer"."description") and char_length("trainer"."description") > 0)),
	CONSTRAINT "trainer_instagram_not_blank" CHECK ("trainer"."instagram" is null or ("trainer"."instagram" = btrim("trainer"."instagram") and char_length("trainer"."instagram") > 0)),
	CONSTRAINT "trainer_tiktok_not_blank" CHECK ("trainer"."tiktok" is null or ("trainer"."tiktok" = btrim("trainer"."tiktok") and char_length("trainer"."tiktok") > 0))
);
--> statement-breakpoint
CREATE TABLE "trainer_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trainer_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"content_type" text NOT NULL,
	"index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trainer_file_index_non_negative" CHECK ("trainer_file"."index" >= 0),
	CONSTRAINT "trainer_file_content_type" CHECK ("trainer_file"."content_type" in (
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'video/mp4', 'video/webm'
      )),
	CONSTRAINT "trainer_file_storage_path_not_blank" CHECK ("trainer_file"."storage_path" = btrim("trainer_file"."storage_path") and char_length("trainer_file"."storage_path") > 0)
);
--> statement-breakpoint
ALTER TABLE "class_type" ADD CONSTRAINT "class_type_studio_id_studio_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_type_file" ADD CONSTRAINT "class_type_file_class_type_id_class_type_id_fk" FOREIGN KEY ("class_type_id") REFERENCES "public"."class_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer" ADD CONSTRAINT "trainer_studio_id_studio_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_file" ADD CONSTRAINT "trainer_file_trainer_id_trainer_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."trainer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_type_studio_id_idx" ON "class_type" USING btree ("studio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "class_type_file_class_type_id_index_unique" ON "class_type_file" USING btree ("class_type_id","index");--> statement-breakpoint
CREATE INDEX "trainer_studio_id_idx" ON "trainer" USING btree ("studio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trainer_file_trainer_id_index_unique" ON "trainer_file" USING btree ("trainer_id","index");--> statement-breakpoint
-- Rights per API user; keep in sync with src/database/expected-grants.ts
GRANT SELECT, INSERT, UPDATE ON "trainer" TO studio_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "trainer_file" TO studio_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "class_type" TO studio_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "class_type_file" TO studio_api;