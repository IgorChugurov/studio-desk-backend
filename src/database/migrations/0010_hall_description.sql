ALTER TABLE "hall" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "hall" ADD CONSTRAINT "hall_description_not_blank" CHECK ("hall"."description" is null or (
        "hall"."description" = btrim("hall"."description") and char_length("hall"."description") > 0
      ));