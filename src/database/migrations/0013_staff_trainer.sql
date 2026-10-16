CREATE TABLE "staff_trainer" (
	"studio_id" uuid NOT NULL,
	"staff_id" uuid PRIMARY KEY NOT NULL,
	"trainer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "studio_staff" DROP CONSTRAINT "studio_staff_role";--> statement-breakpoint
ALTER TABLE "staff_trainer" ADD CONSTRAINT "staff_trainer_studio_id_studio_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_trainer" ADD CONSTRAINT "staff_trainer_staff_id_studio_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."studio_staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_trainer" ADD CONSTRAINT "staff_trainer_trainer_id_trainer_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."trainer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_trainer_trainer_id_unique" ON "staff_trainer" USING btree ("trainer_id");--> statement-breakpoint
CREATE INDEX "staff_trainer_studio_id_idx" ON "staff_trainer" USING btree ("studio_id");--> statement-breakpoint
ALTER TABLE "studio_staff" ADD CONSTRAINT "studio_staff_role" CHECK ("studio_staff"."role" in ('administrator', 'accountant', 'trainer'));--> statement-breakpoint
-- Rights per API user; keep in sync with src/database/expected-grants.ts
GRANT SELECT, INSERT, UPDATE, DELETE ON "staff_trainer" TO studio_api;