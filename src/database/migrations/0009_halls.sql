CREATE TABLE "hall" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"video_link" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hall_name_not_blank" CHECK ("hall"."name" = btrim("hall"."name") and char_length("hall"."name") > 0),
	CONSTRAINT "hall_address_not_blank" CHECK ("hall"."address" = btrim("hall"."address") and char_length("hall"."address") > 0),
	CONSTRAINT "hall_video_link_not_blank" CHECK ("hall"."video_link" is null or (
        "hall"."video_link" = btrim("hall"."video_link") and char_length("hall"."video_link") > 0
      ))
);
--> statement-breakpoint
CREATE TABLE "hall_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hall_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"content_type" text NOT NULL,
	"index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hall_file_index_non_negative" CHECK ("hall_file"."index" >= 0),
	CONSTRAINT "hall_file_content_type" CHECK ("hall_file"."content_type" in (
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'video/mp4', 'video/webm'
      )),
	CONSTRAINT "hall_file_storage_path_not_blank" CHECK ("hall_file"."storage_path" = btrim("hall_file"."storage_path") and char_length("hall_file"."storage_path") > 0)
);
--> statement-breakpoint
ALTER TABLE "hall" ADD CONSTRAINT "hall_studio_id_studio_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_file" ADD CONSTRAINT "hall_file_hall_id_hall_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."hall"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hall_studio_id_idx" ON "hall" USING btree ("studio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hall_file_hall_id_index_unique" ON "hall_file" USING btree ("hall_id","index");--> statement-breakpoint
-- Rights per API user; keep in sync with src/database/expected-grants.ts
GRANT SELECT, INSERT, UPDATE ON "hall" TO studio_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "hall_file" TO studio_api;