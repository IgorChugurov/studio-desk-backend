CREATE TABLE "trainer_class_type" (
	"studio_id" uuid NOT NULL,
	"trainer_id" uuid NOT NULL,
	"class_type_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trainer_class_type_trainer_id_class_type_id_pk" PRIMARY KEY("trainer_id","class_type_id")
);
--> statement-breakpoint
-- Class type default duration: existing rows become 60; new rows must set it.
ALTER TABLE "class_type" ADD COLUMN "default_duration" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "class_type" ALTER COLUMN "default_duration" DROP DEFAULT;--> statement-breakpoint
-- Hall type: existing rows become ordinary via the column default.
ALTER TABLE "hall" ADD COLUMN "type" text DEFAULT 'ordinary' NOT NULL;--> statement-breakpoint
-- Hall time zone: add nullable, backfill from the studio, then require it.
ALTER TABLE "hall" ADD COLUMN "time_zone" text;--> statement-breakpoint
UPDATE "hall" SET "time_zone" = "studio"."time_zone" FROM "studio" WHERE "hall"."studio_id" = "studio"."id";--> statement-breakpoint
ALTER TABLE "hall" ALTER COLUMN "time_zone" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "trainer_class_type" ADD CONSTRAINT "trainer_class_type_studio_id_studio_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_class_type" ADD CONSTRAINT "trainer_class_type_trainer_id_trainer_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."trainer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_class_type" ADD CONSTRAINT "trainer_class_type_class_type_id_class_type_id_fk" FOREIGN KEY ("class_type_id") REFERENCES "public"."class_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trainer_class_type_studio_id_idx" ON "trainer_class_type" USING btree ("studio_id");--> statement-breakpoint
CREATE INDEX "trainer_class_type_class_type_id_idx" ON "trainer_class_type" USING btree ("class_type_id");--> statement-breakpoint
ALTER TABLE "class_type" ADD CONSTRAINT "class_type_default_duration" CHECK ("class_type"."default_duration" between 5 and 240 and "class_type"."default_duration" % 5 = 0);--> statement-breakpoint
ALTER TABLE "hall" ADD CONSTRAINT "hall_type" CHECK ("hall"."type" in ('ordinary', 'virtual'));--> statement-breakpoint
ALTER TABLE "hall" ADD CONSTRAINT "hall_virtual_address" CHECK ("hall"."type" = 'ordinary' or "hall"."address" = 'Virtual hall');--> statement-breakpoint
ALTER TABLE "hall" ADD CONSTRAINT "hall_time_zone_not_blank" CHECK ("hall"."time_zone" = btrim("hall"."time_zone") and char_length("hall"."time_zone") > 0);--> statement-breakpoint
-- Rights per API user; keep in sync with src/database/expected-grants.ts
GRANT SELECT, INSERT, DELETE ON "trainer_class_type" TO studio_api;
