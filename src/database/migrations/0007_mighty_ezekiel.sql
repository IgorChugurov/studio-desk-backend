CREATE TABLE "role_section" (
	"role" text NOT NULL,
	"section" text NOT NULL,
	CONSTRAINT "role_section_role_section_pk" PRIMARY KEY("role","section"),
	CONSTRAINT "role_section_role" CHECK ("role_section"."role" in ('owner', 'administrator', 'accountant', 'trainer')),
	CONSTRAINT "role_section_section" CHECK ("role_section"."section" in (
        'schedule', 'catalogs', 'clients', 'subscriptions',
        'accounting', 'studio-settings', 'staff'
      ))
);
--> statement-breakpoint
-- A row means the role may open the section. «Only my own» is decided later.
INSERT INTO "role_section" ("role", "section") VALUES
  ('owner', 'schedule'),
  ('owner', 'catalogs'),
  ('owner', 'clients'),
  ('owner', 'subscriptions'),
  ('owner', 'accounting'),
  ('owner', 'studio-settings'),
  ('owner', 'staff'),
  ('administrator', 'schedule'),
  ('administrator', 'catalogs'),
  ('administrator', 'clients'),
  ('administrator', 'subscriptions'),
  ('accountant', 'accounting'),
  ('trainer', 'schedule'),
  ('trainer', 'clients'),
  ('trainer', 'accounting');
--> statement-breakpoint
GRANT SELECT ON "role_section" TO studio_api;
--> statement-breakpoint
GRANT INSERT, UPDATE, DELETE ON "studio_staff" TO studio_api;
