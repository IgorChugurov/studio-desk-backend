-- Phase 3: the studio API spends a handoff code; the platform API
-- revokes studio sessions and reads staff to reject OWNER_IS_STAFF.
-- Keep in sync with src/database/expected-grants.ts
GRANT SELECT, UPDATE ON "handoff_code" TO studio_api;
--> statement-breakpoint
GRANT SELECT, UPDATE ON "studio_session" TO platform_api;
--> statement-breakpoint
GRANT SELECT ON "studio_staff" TO platform_api;
