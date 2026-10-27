CREATE TABLE "resource" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"resource_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"address" text,
	"time_zone" text,
	"default_duration" integer,
	"description" text,
	"video_link" text,
	"instagram" text,
	"tiktok" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_name_not_blank" CHECK ("resource"."name" = btrim("resource"."name") and char_length("resource"."name") > 0),
	CONSTRAINT "resource_geography" CHECK ((
		"resource"."type" is null and "resource"."address" is null and "resource"."time_zone" is null
	) or (
		"resource"."type" = 'ordinary'
		and "resource"."address" = btrim("resource"."address")
		and char_length("resource"."address") > 0
		and "resource"."time_zone" = btrim("resource"."time_zone")
		and char_length("resource"."time_zone") > 0
	) or (
		"resource"."type" = 'virtual'
		and "resource"."address" = 'Virtual place'
		and "resource"."time_zone" = btrim("resource"."time_zone")
		and char_length("resource"."time_zone") > 0
	)),
	CONSTRAINT "resource_default_duration" CHECK ("resource"."default_duration" is null or ("resource"."default_duration" between 5 and 1440 and "resource"."default_duration" % 5 = 0)),
	CONSTRAINT "resource_description_not_blank" CHECK ("resource"."description" is null or ("resource"."description" = btrim("resource"."description") and char_length("resource"."description") > 0)),
	CONSTRAINT "resource_video_link_not_blank" CHECK ("resource"."video_link" is null or ("resource"."video_link" = btrim("resource"."video_link") and char_length("resource"."video_link") > 0)),
	CONSTRAINT "resource_instagram_not_blank" CHECK ("resource"."instagram" is null or ("resource"."instagram" = btrim("resource"."instagram") and char_length("resource"."instagram") > 0)),
	CONSTRAINT "resource_tiktok_not_blank" CHECK ("resource"."tiktok" is null or ("resource"."tiktok" = btrim("resource"."tiktok") and char_length("resource"."tiktok") > 0))
);
--> statement-breakpoint
CREATE TABLE "resource_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"content_type" text NOT NULL,
	"index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_file_index_non_negative" CHECK ("resource_file"."index" >= 0),
	CONSTRAINT "resource_file_content_type" CHECK ("resource_file"."content_type" in (
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'video/mp4', 'video/webm'
      )),
	CONSTRAINT "resource_file_storage_path_not_blank" CHECK ("resource_file"."storage_path" = btrim("resource_file"."storage_path") and char_length("resource_file"."storage_path") > 0)
);
--> statement-breakpoint
CREATE TABLE "resource_relation" (
	"organization_id" uuid NOT NULL,
	"resource_a_id" uuid NOT NULL,
	"resource_b_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_relation_resource_a_id_resource_b_id_pk" PRIMARY KEY("resource_a_id","resource_b_id"),
	CONSTRAINT "resource_relation_ordered" CHECK ("resource_relation"."resource_a_id" < "resource_relation"."resource_b_id")
);
--> statement-breakpoint
CREATE TABLE "currency" (
	"code" text PRIMARY KEY NOT NULL,
	CONSTRAINT "currency_code" CHECK ("currency"."code" = upper("currency"."code") and char_length("currency"."code") = 3)
);
--> statement-breakpoint
CREATE TABLE "foundation_check" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interface_language" (
	"email" text PRIMARY KEY NOT NULL,
	"language" text NOT NULL,
	CONSTRAINT "interface_language_email_lower" CHECK ("interface_language"."email" = lower("interface_language"."email") and position('@' in "interface_language"."email") > 1),
	CONSTRAINT "interface_language_language" CHECK ("interface_language"."language" in ('en', 'sk', 'uk'))
);
--> statement-breakpoint
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
	CONSTRAINT "session_api" CHECK ("session"."api" in ('platform', 'organization'))
);
--> statement-breakpoint
CREATE TABLE "handoff_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"platform_administrator_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "handoff_code_code_hash_unique" UNIQUE("code_hash")
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
CREATE TABLE "role_section" (
	"role" text NOT NULL,
	"section" text NOT NULL,
	CONSTRAINT "role_section_role_section_pk" PRIMARY KEY("role","section"),
	CONSTRAINT "role_section_role" CHECK ("role_section"."role" in ('owner', 'administrator', 'accountant', 'specialist')),
	CONSTRAINT "role_section_section" CHECK ("role_section"."section" in (
        'schedule', 'catalogs', 'clients', 'subscriptions',
        'accounting', 'organization-settings', 'staff'
      ))
);
--> statement-breakpoint
CREATE TABLE "schedule_slot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"place_resource_id" uuid NOT NULL,
	"date" date NOT NULL,
	"start_time" time NOT NULL,
	"duration_minutes" integer NOT NULL,
	"audience" text,
	"format" text,
	"places" integer,
	"note" text,
	"blocks_all" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"occupies_resources" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_slot_kind" CHECK ("schedule_slot"."kind" in ('service', 'block')),
	CONSTRAINT "schedule_slot_status" CHECK ("schedule_slot"."status" in ('planned', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')),
	CONSTRAINT "schedule_slot_audience" CHECK ("schedule_slot"."audience" is null or "schedule_slot"."audience" in ('group', 'one_person')),
	CONSTRAINT "schedule_slot_format" CHECK ("schedule_slot"."format" is null or "schedule_slot"."format" in ('offline', 'offline_and_online', 'online_only')),
	CONSTRAINT "schedule_slot_places" CHECK ("schedule_slot"."places" is null or "schedule_slot"."places" >= 1),
	CONSTRAINT "schedule_slot_note" CHECK ("schedule_slot"."note" is null or (
        "schedule_slot"."note" = btrim("schedule_slot"."note") and char_length("schedule_slot"."note") > 0
      )),
	CONSTRAINT "schedule_slot_ends_after_start" CHECK ("schedule_slot"."ends_at" > "schedule_slot"."starts_at"),
	CONSTRAINT "schedule_slot_duration" CHECK ("schedule_slot"."duration_minutes" between 5 and 1440 and "schedule_slot"."duration_minutes" % 5 = 0),
	CONSTRAINT "schedule_slot_clock" CHECK (extract(second from "schedule_slot"."start_time") = 0
        and extract(minute from "schedule_slot"."start_time")::int % 5 = 0
        and (extract(hour from "schedule_slot"."start_time") * 60 + extract(minute from "schedule_slot"."start_time") + "schedule_slot"."duration_minutes") <= 1440),
	CONSTRAINT "schedule_slot_shape" CHECK ((
        "schedule_slot"."kind" = 'service'
        and "schedule_slot"."audience" is not null
        and "schedule_slot"."format" is not null
        and "schedule_slot"."note" is null
        and "schedule_slot"."blocks_all" = false
      ) or (
        "schedule_slot"."kind" = 'block'
        and "schedule_slot"."audience" is null
        and "schedule_slot"."format" is null
        and "schedule_slot"."places" is null
      )),
	CONSTRAINT "schedule_slot_occupies" CHECK ((
        "schedule_slot"."status" in ('planned', 'confirmed', 'in_progress', 'completed')
        and "schedule_slot"."occupies_resources"
      ) or (
        "schedule_slot"."status" in ('cancelled', 'no_show')
        and not "schedule_slot"."occupies_resources"
      ))
);
--> statement-breakpoint
CREATE TABLE "schedule_slot_resource" (
	"organization_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"role" text NOT NULL,
	"enforce_no_overlap" boolean NOT NULL,
	"during" "tstzrange",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_slot_resource_slot_id_resource_id_pk" PRIMARY KEY("slot_id","resource_id"),
	CONSTRAINT "schedule_slot_resource_role" CHECK ("schedule_slot_resource"."role" in ('place', 'resource', 'offering'))
);
--> statement-breakpoint
CREATE TABLE "week_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "week_template_name_not_blank" CHECK ("week_template"."name" = btrim("week_template"."name") and char_length("week_template"."name") > 0)
);
--> statement-breakpoint
CREATE TABLE "week_template_row" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"weekday" text NOT NULL,
	"start_time" time NOT NULL,
	"duration_minutes" integer NOT NULL,
	"place_resource_id" uuid NOT NULL,
	"audience" text,
	"format" text,
	"places" integer,
	"note" text,
	"blocks_all" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "week_template_row_kind" CHECK ("week_template_row"."kind" in ('service', 'block')),
	CONSTRAINT "week_template_row_weekday" CHECK ("week_template_row"."weekday" in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
	CONSTRAINT "week_template_row_audience" CHECK ("week_template_row"."audience" is null or "week_template_row"."audience" in ('group', 'one_person')),
	CONSTRAINT "week_template_row_format" CHECK ("week_template_row"."format" is null or "week_template_row"."format" in ('offline', 'offline_and_online', 'online_only')),
	CONSTRAINT "week_template_row_places" CHECK ("week_template_row"."places" is null or "week_template_row"."places" >= 1),
	CONSTRAINT "week_template_row_note" CHECK ("week_template_row"."note" is null or (
        "week_template_row"."note" = btrim("week_template_row"."note") and char_length("week_template_row"."note") > 0
      )),
	CONSTRAINT "week_template_row_duration" CHECK ("week_template_row"."duration_minutes" between 5 and 1440 and "week_template_row"."duration_minutes" % 5 = 0),
	CONSTRAINT "week_template_row_clock" CHECK (extract(second from "week_template_row"."start_time") = 0
        and extract(minute from "week_template_row"."start_time")::int % 5 = 0
        and (extract(hour from "week_template_row"."start_time") * 60 + extract(minute from "week_template_row"."start_time") + "week_template_row"."duration_minutes") <= 1440),
	CONSTRAINT "week_template_row_shape" CHECK ((
        "week_template_row"."kind" = 'service'
        and "week_template_row"."audience" is not null
        and "week_template_row"."format" is not null
        and "week_template_row"."note" is null
        and "week_template_row"."blocks_all" = false
      ) or (
        "week_template_row"."kind" = 'block'
        and "week_template_row"."audience" is null
        and "week_template_row"."format" is null
        and "week_template_row"."places" is null
      ))
);
--> statement-breakpoint
CREATE TABLE "week_template_row_resource" (
	"organization_id" uuid NOT NULL,
	"row_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "week_template_row_resource_row_id_resource_id_pk" PRIMARY KEY("row_id","resource_id")
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"subdomain" text NOT NULL,
	"custom_domain" text,
	"owner_email" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"country" text DEFAULT 'SK' NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"time_zone" text DEFAULT 'Europe/Bratislava' NOT NULL,
	"preset_id" uuid,
	"preset_name" text NOT NULL,
	"schedule_config" jsonb NOT NULL,
	"billing_config" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_name_length" CHECK (char_length("organization"."name") between 2 and 100 and "organization"."name" = btrim("organization"."name")),
	CONSTRAINT "organization_subdomain_format" CHECK ("organization"."subdomain" = lower("organization"."subdomain") and "organization"."subdomain" ~ '^[a-z][a-z0-9-]{1,18}[a-z0-9]$'),
	CONSTRAINT "organization_custom_domain_format" CHECK ("organization"."custom_domain" is null or (
        "organization"."custom_domain" = lower("organization"."custom_domain")
        and char_length("organization"."custom_domain") between 1 and 253
        and "organization"."custom_domain" !~ '://'
        and "organization"."custom_domain" ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
        and "organization"."custom_domain" <> 'studio-desk.axondigital.xyz'
        and "organization"."custom_domain" !~ '\.studio-desk\.axondigital\.xyz$'
      )),
	CONSTRAINT "organization_owner_email_lower" CHECK ("organization"."owner_email" = lower("organization"."owner_email") and position('@' in "organization"."owner_email") > 1),
	CONSTRAINT "organization_status" CHECK ("organization"."status" in ('active', 'deactivated')),
	CONSTRAINT "organization_language" CHECK ("organization"."language" in ('en', 'sk', 'uk')),
	CONSTRAINT "organization_country" CHECK ("organization"."country" = upper("organization"."country") and char_length("organization"."country") = 2),
	CONSTRAINT "organization_time_zone" CHECK ("organization"."time_zone" = btrim("organization"."time_zone") and char_length("organization"."time_zone") > 0),
	CONSTRAINT "organization_preset_name_length" CHECK (char_length("organization"."preset_name") between 2 and 100 and "organization"."preset_name" = btrim("organization"."preset_name"))
);
--> statement-breakpoint
CREATE TABLE "organization_resource_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"role" text NOT NULL,
	"labels" jsonb NOT NULL,
	"geography" boolean NOT NULL,
	"duration" boolean NOT NULL,
	"showcase" boolean NOT NULL,
	"person" boolean NOT NULL,
	"skills" boolean NOT NULL,
	"required" boolean NOT NULL,
	"multiple" boolean NOT NULL,
	"conflict_mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_resource_type_role" CHECK ("organization_resource_type"."role" in ('place', 'resource', 'offering')),
	CONSTRAINT "organization_resource_type_conflict_mode" CHECK ("organization_resource_type"."conflict_mode" in ('strict', 'warning', 'none')),
	CONSTRAINT "organization_resource_type_sort_order" CHECK ("organization_resource_type"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "organization_section" (
	"organization_id" uuid NOT NULL,
	"section" text NOT NULL,
	CONSTRAINT "organization_section_organization_id_section_pk" PRIMARY KEY("organization_id","section"),
	CONSTRAINT "organization_section_section" CHECK ("organization_section"."section" in (
        'schedule', 'catalogs', 'clients', 'subscriptions',
        'accounting', 'organization-settings', 'staff'
      ))
);
--> statement-breakpoint
CREATE TABLE "organization_selection_ticket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "organization_selection_ticket_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "organization_selection_ticket_email_lower" CHECK ("organization_selection_ticket"."email" = lower("organization_selection_ticket"."email"))
);
--> statement-breakpoint
CREATE TABLE "organization_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"refresh_token_hash" text NOT NULL,
	"previous_refresh_token_hash" text,
	"rotated_at" timestamp with time zone,
	"impersonated_by" uuid,
	CONSTRAINT "organization_session_refresh_token_hash_unique" UNIQUE("refresh_token_hash"),
	CONSTRAINT "organization_session_previous_refresh_token_hash_unique" UNIQUE("previous_refresh_token_hash"),
	CONSTRAINT "organization_session_email_lower" CHECK ("organization_session"."email" = lower("organization_session"."email"))
);
--> statement-breakpoint
CREATE TABLE "organization_sign_in_code" (
	"email" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts_remaining" smallint NOT NULL,
	CONSTRAINT "organization_sign_in_code_email_lower" CHECK ("organization_sign_in_code"."email" = lower("organization_sign_in_code"."email"))
);
--> statement-breakpoint
CREATE TABLE "organization_staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_staff_email_lower" CHECK ("organization_staff"."email" = lower("organization_staff"."email")),
	CONSTRAINT "organization_staff_role" CHECK ("organization_staff"."role" in ('administrator', 'accountant', 'specialist'))
);
--> statement-breakpoint
CREATE TABLE "staff_resource" (
	"organization_id" uuid NOT NULL,
	"staff_id" uuid PRIMARY KEY NOT NULL,
	"resource_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sections" jsonb NOT NULL,
	"catalog_config" jsonb NOT NULL,
	"schedule_config" jsonb NOT NULL,
	"billing_config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preset_name_length" CHECK (char_length("preset"."name") between 2 and 100 and "preset"."name" = btrim("preset"."name")),
	CONSTRAINT "preset_description" CHECK ("preset"."description" is null or (
        "preset"."description" = btrim("preset"."description") and char_length("preset"."description") > 0
      )),
	CONSTRAINT "preset_sections_non_empty" CHECK (jsonb_typeof("preset"."sections") = 'array' and jsonb_array_length("preset"."sections") > 0)
);
--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_resource_type_id_organization_resource_type_id_fk" FOREIGN KEY ("resource_type_id") REFERENCES "public"."organization_resource_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_file" ADD CONSTRAINT "resource_file_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_relation" ADD CONSTRAINT "resource_relation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_relation" ADD CONSTRAINT "resource_relation_resource_a_id_resource_id_fk" FOREIGN KEY ("resource_a_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_relation" ADD CONSTRAINT "resource_relation_resource_b_id_resource_id_fk" FOREIGN KEY ("resource_b_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_platform_administrator_id_platform_administrator_id_fk" FOREIGN KEY ("platform_administrator_id") REFERENCES "public"."platform_administrator"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_code" ADD CONSTRAINT "handoff_code_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_code" ADD CONSTRAINT "handoff_code_platform_administrator_id_platform_administrator_id_fk" FOREIGN KEY ("platform_administrator_id") REFERENCES "public"."platform_administrator"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slot" ADD CONSTRAINT "schedule_slot_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slot" ADD CONSTRAINT "schedule_slot_place_resource_id_resource_id_fk" FOREIGN KEY ("place_resource_id") REFERENCES "public"."resource"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slot_resource" ADD CONSTRAINT "schedule_slot_resource_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slot_resource" ADD CONSTRAINT "schedule_slot_resource_slot_id_schedule_slot_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."schedule_slot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slot_resource" ADD CONSTRAINT "schedule_slot_resource_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_template" ADD CONSTRAINT "week_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_template_row" ADD CONSTRAINT "week_template_row_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_template_row" ADD CONSTRAINT "week_template_row_template_id_week_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."week_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_template_row" ADD CONSTRAINT "week_template_row_place_resource_id_resource_id_fk" FOREIGN KEY ("place_resource_id") REFERENCES "public"."resource"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_template_row_resource" ADD CONSTRAINT "week_template_row_resource_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_template_row_resource" ADD CONSTRAINT "week_template_row_resource_row_id_week_template_row_id_fk" FOREIGN KEY ("row_id") REFERENCES "public"."week_template_row"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_template_row_resource" ADD CONSTRAINT "week_template_row_resource_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_preset_id_preset_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."preset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_resource_type" ADD CONSTRAINT "organization_resource_type_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_section" ADD CONSTRAINT "organization_section_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_session" ADD CONSTRAINT "organization_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_session" ADD CONSTRAINT "organization_session_impersonated_by_platform_administrator_id_fk" FOREIGN KEY ("impersonated_by") REFERENCES "public"."platform_administrator"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_staff" ADD CONSTRAINT "organization_staff_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_resource" ADD CONSTRAINT "staff_resource_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_resource" ADD CONSTRAINT "staff_resource_staff_id_organization_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."organization_staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_resource" ADD CONSTRAINT "staff_resource_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resource_organization_id_idx" ON "resource" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "resource_resource_type_id_idx" ON "resource" USING btree ("resource_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_file_resource_id_index_unique" ON "resource_file" USING btree ("resource_id","index");--> statement-breakpoint
CREATE INDEX "resource_relation_organization_id_idx" ON "resource_relation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "resource_relation_resource_b_id_idx" ON "resource_relation" USING btree ("resource_b_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_administrator_one_row" ON "platform_administrator" ((true));--> statement-breakpoint
CREATE INDEX "schedule_slot_organization_id_idx" ON "schedule_slot" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "schedule_slot_place_date_idx" ON "schedule_slot" USING btree ("place_resource_id","date");--> statement-breakpoint
CREATE INDEX "schedule_slot_resource_organization_id_idx" ON "schedule_slot_resource" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "schedule_slot_resource_resource_id_idx" ON "schedule_slot_resource" USING btree ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "week_template_organization_name_unique" ON "week_template" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "week_template_organization_id_idx" ON "week_template" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "week_template_row_template_id_idx" ON "week_template_row" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "week_template_row_organization_id_idx" ON "week_template_row" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "week_template_row_resource_organization_id_idx" ON "week_template_row_resource" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_subdomain_unique" ON "organization" USING btree ("subdomain");--> statement-breakpoint
CREATE INDEX "organization_owner_email_idx" ON "organization" USING btree ("owner_email");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_custom_domain_unique" ON "organization" USING btree ("custom_domain") WHERE "organization"."custom_domain" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_resource_type_sort_unique" ON "organization_resource_type" USING btree ("organization_id","sort_order");--> statement-breakpoint
CREATE INDEX "organization_resource_type_organization_id_idx" ON "organization_resource_type" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_session_email_idx" ON "organization_session" USING btree ("organization_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_staff_email_unique" ON "organization_staff" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "organization_staff_email_idx" ON "organization_staff" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_resource_resource_id_unique" ON "staff_resource" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "staff_resource_organization_id_idx" ON "staff_resource" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "preset_name_unique" ON "preset" USING btree ("name");
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "schedule_slot_resource" ADD CONSTRAINT "schedule_slot_resource_no_overlap" EXCLUDE USING gist ("resource_id" WITH =, "during" WITH &&) WHERE ("during" IS NOT NULL AND "enforce_no_overlap" = true);
--> statement-breakpoint
GRANT SELECT ON "currency" TO studio_api;
--> statement-breakpoint
GRANT SELECT, INSERT ON "foundation_check" TO platform_api;
--> statement-breakpoint
GRANT SELECT ON "foundation_check" TO studio_api;
--> statement-breakpoint
GRANT SELECT, INSERT ON "handoff_code" TO platform_api;
--> statement-breakpoint
GRANT SELECT, UPDATE ON "handoff_code" TO studio_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "interface_language" TO studio_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "organization" TO platform_api;
--> statement-breakpoint
GRANT SELECT ON "organization" TO studio_api;
--> statement-breakpoint
GRANT SELECT, INSERT ON "organization_resource_type" TO platform_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "organization_resource_type" TO studio_api;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "organization_section" TO platform_api;
--> statement-breakpoint
GRANT SELECT ON "organization_section" TO studio_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "organization_selection_ticket" TO studio_api;
--> statement-breakpoint
GRANT SELECT, UPDATE ON "organization_session" TO platform_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "organization_session" TO studio_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "organization_sign_in_code" TO studio_api;
--> statement-breakpoint
GRANT SELECT ON "organization_staff" TO platform_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "organization_staff" TO studio_api;
--> statement-breakpoint
GRANT SELECT ON "platform_administrator" TO platform_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "preset" TO platform_api;
--> statement-breakpoint
GRANT SELECT ON "role_section" TO studio_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "schedule_slot" TO studio_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "schedule_slot_resource" TO studio_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "session" TO platform_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "sign_in_code" TO platform_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "resource" TO studio_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "resource_file" TO studio_api;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "resource_relation" TO studio_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "staff_resource" TO studio_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "week_template" TO studio_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "week_template_row" TO studio_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "week_template_row_resource" TO studio_api;
--> statement-breakpoint
GRANT UPDATE ("language", "country", "currency", "time_zone", "schedule_config", "billing_config", "updated_at") ON "organization" TO studio_api;
--> statement-breakpoint
INSERT INTO "currency" ("code") VALUES ('EUR'), ('UAH'), ('USD') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_section" ("role", "section") VALUES
  ('owner', 'schedule'),
  ('owner', 'catalogs'),
  ('owner', 'clients'),
  ('owner', 'subscriptions'),
  ('owner', 'accounting'),
  ('owner', 'organization-settings'),
  ('owner', 'staff'),
  ('administrator', 'schedule'),
  ('administrator', 'catalogs'),
  ('administrator', 'clients'),
  ('administrator', 'subscriptions'),
  ('accountant', 'accounting'),
  ('specialist', 'schedule'),
  ('specialist', 'clients'),
  ('specialist', 'accounting')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- seed-presets
INSERT INTO "preset" ("id", "name", "description", "sections", "catalog_config", "schedule_config", "billing_config")
VALUES
  ('00000000-0000-4000-8000-000000000001'::uuid, 'Fitness Studio', 'Group and personal classes in halls and online', '["schedule","catalogs","clients","subscriptions","accounting","organization-settings","staff"]'::jsonb, '{"resourceTypes":[{"key":"hall","role":"place","labels":{"en":{"singular":"Hall","plural":"Halls"},"sk":{"singular":"Sála","plural":"Sály"},"uk":{"singular":"Зал","plural":"Зали"}},"geography":true,"duration":false,"showcase":true,"person":false,"skills":false,"required":true,"multiple":false,"conflictMode":"strict"},{"key":"trainer","role":"resource","labels":{"en":{"singular":"Trainer","plural":"Trainers"},"sk":{"singular":"Tréner","plural":"Tréneri"},"uk":{"singular":"Тренер","plural":"Тренери"}},"geography":false,"duration":false,"showcase":true,"person":true,"skills":true,"required":true,"multiple":true,"conflictMode":"strict"},{"key":"class-type","role":"offering","labels":{"en":{"singular":"Class type","plural":"Class types"},"sk":{"singular":"Typ lekcie","plural":"Typy lekcií"},"uk":{"singular":"Вид заняття","plural":"Види занять"}},"geography":false,"duration":true,"showcase":true,"person":false,"skills":true,"required":true,"multiple":false,"conflictMode":"none"}]}'::jsonb, '{"audienceEnabled":true,"formatEnabled":true,"statuses":["planned","cancelled"]}'::jsonb, '{"settlementMode":"subscription"}'::jsonb),
  ('00000000-0000-4000-8000-000000000002'::uuid, 'Beauty Salon', 'Appointments at chairs', '["schedule","catalogs","clients","subscriptions","accounting","organization-settings","staff"]'::jsonb, '{"resourceTypes":[{"key":"chair","role":"place","labels":{"en":{"singular":"Chair","plural":"Chairs"},"sk":{"singular":"Kreslo","plural":"Kreslá"},"uk":{"singular":"Крісло","plural":"Крісла"}},"geography":true,"duration":false,"showcase":true,"person":false,"skills":false,"required":true,"multiple":false,"conflictMode":"strict"},{"key":"master","role":"resource","labels":{"en":{"singular":"Master","plural":"Masters"},"sk":{"singular":"Majster","plural":"Majstri"},"uk":{"singular":"Майстер","plural":"Майстри"}},"geography":false,"duration":false,"showcase":true,"person":true,"skills":true,"required":true,"multiple":true,"conflictMode":"strict"},{"key":"service","role":"offering","labels":{"en":{"singular":"Service","plural":"Services"},"sk":{"singular":"Služba","plural":"Služby"},"uk":{"singular":"Послуга","plural":"Послуги"}},"geography":false,"duration":true,"showcase":true,"person":false,"skills":true,"required":true,"multiple":false,"conflictMode":"none"}]}'::jsonb, '{"audienceEnabled":false,"formatEnabled":false,"statuses":["planned","confirmed","completed","cancelled"]}'::jsonb, '{"settlementMode":"direct_check"}'::jsonb),
  ('00000000-0000-4000-8000-000000000003'::uuid, 'Auto Service', 'Workshop jobs in bays', '["schedule","catalogs","clients","accounting","organization-settings","staff"]'::jsonb, '{"resourceTypes":[{"key":"bay","role":"place","labels":{"en":{"singular":"Bay","plural":"Bays"},"sk":{"singular":"Box","plural":"Boxy"},"uk":{"singular":"Бокс","plural":"Бокси"}},"geography":true,"duration":false,"showcase":true,"person":false,"skills":false,"required":true,"multiple":false,"conflictMode":"strict"},{"key":"mechanic","role":"resource","labels":{"en":{"singular":"Mechanic","plural":"Mechanics"},"sk":{"singular":"Mechanik","plural":"Mechanici"},"uk":{"singular":"Механік","plural":"Механіки"}},"geography":false,"duration":false,"showcase":true,"person":true,"skills":true,"required":true,"multiple":true,"conflictMode":"strict"},{"key":"work-type","role":"offering","labels":{"en":{"singular":"Work type","plural":"Work types"},"sk":{"singular":"Typ práce","plural":"Typy prác"},"uk":{"singular":"Вид роботи","plural":"Види робіт"}},"geography":false,"duration":true,"showcase":true,"person":false,"skills":true,"required":true,"multiple":false,"conflictMode":"none"}]}'::jsonb, '{"audienceEnabled":false,"formatEnabled":false,"statuses":["planned","confirmed","in_progress","completed","cancelled"]}'::jsonb, '{"settlementMode":"external_order"}'::jsonb),
  ('00000000-0000-4000-8000-000000000004'::uuid, 'Medical Clinic', 'Visits in rooms, including online', '["schedule","catalogs","clients","accounting","organization-settings","staff"]'::jsonb, '{"resourceTypes":[{"key":"room","role":"place","labels":{"en":{"singular":"Room","plural":"Rooms"},"sk":{"singular":"Miestnosť","plural":"Miestnosti"},"uk":{"singular":"Кабінет","plural":"Кабінети"}},"geography":true,"duration":false,"showcase":true,"person":false,"skills":false,"required":true,"multiple":false,"conflictMode":"strict"},{"key":"doctor","role":"resource","labels":{"en":{"singular":"Doctor","plural":"Doctors"},"sk":{"singular":"Lekár","plural":"Lekári"},"uk":{"singular":"Лікар","plural":"Лікарі"}},"geography":false,"duration":false,"showcase":true,"person":true,"skills":true,"required":true,"multiple":true,"conflictMode":"strict"},{"key":"service","role":"offering","labels":{"en":{"singular":"Service","plural":"Services"},"sk":{"singular":"Služba","plural":"Služby"},"uk":{"singular":"Послуга","plural":"Послуги"}},"geography":false,"duration":true,"showcase":true,"person":false,"skills":true,"required":true,"multiple":false,"conflictMode":"none"}]}'::jsonb, '{"audienceEnabled":false,"formatEnabled":true,"statuses":["planned","confirmed","completed","cancelled","no_show"]}'::jsonb, '{"settlementMode":"direct_check"}'::jsonb),
  ('00000000-0000-4000-8000-000000000005'::uuid, 'OblikFlow Accounting', 'Accounting without a schedule', '["catalogs","accounting","organization-settings","staff"]'::jsonb, '{"resourceTypes":[{"key":"office","role":"place","labels":{"en":{"singular":"Office","plural":"Offices"},"sk":{"singular":"Kancelária","plural":"Kancelárie"},"uk":{"singular":"Офіс","plural":"Офіси"}},"geography":true,"duration":false,"showcase":true,"person":false,"skills":false,"required":true,"multiple":false,"conflictMode":"strict"}]}'::jsonb, '{"audienceEnabled":false,"formatEnabled":false,"statuses":["planned","cancelled"]}'::jsonb, '{"settlementMode":"external_order"}'::jsonb)
ON CONFLICT ("id") DO NOTHING
-- end-seed-presets;
