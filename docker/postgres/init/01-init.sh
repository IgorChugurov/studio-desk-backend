#!/usr/bin/env bash
# Creates the PostgreSQL users and the databases of StudioDesk.
# Runs once, as the PostgreSQL superuser, on an empty server.
# See studio-desk-docs/03-architecture/backend-structure.md.
set -euo pipefail

: "${DB_NAME:?}"
: "${DB_OWNER_PASSWORD:?}"
: "${DB_PLATFORM_API_PASSWORD:?}"
: "${DB_STUDIO_API_PASSWORD:?}"
: "${DB_PUBLIC_API_PASSWORD:?}"

DATABASES=("$DB_NAME")
# The server sets CREATE_TEST_DB=false: it has no test database.
if [ "${CREATE_TEST_DB:-true}" = "true" ]; then
  DATABASES+=("studio_desk_test")
fi

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname postgres \
  -v owner_pw="$DB_OWNER_PASSWORD" \
  -v platform_pw="$DB_PLATFORM_API_PASSWORD" \
  -v studio_pw="$DB_STUDIO_API_PASSWORD" \
  -v public_pw="$DB_PUBLIC_API_PASSWORD" <<'SQL'
CREATE ROLE studio_desk_owner LOGIN PASSWORD :'owner_pw';
CREATE ROLE platform_api LOGIN PASSWORD :'platform_pw';
CREATE ROLE studio_api LOGIN PASSWORD :'studio_pw';
CREATE ROLE public_api LOGIN PASSWORD :'public_pw';
SQL

for db in "${DATABASES[@]}"; do
  psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname postgres \
    -v db="$db" <<'SQL'
CREATE DATABASE :"db" OWNER studio_desk_owner;
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO platform_api, studio_api, public_api;
SQL

  # The public schema belongs to the database owner (studio_desk_owner).
  # API users may only look up objects in it; table rights come from migrations.
  psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname "$db" <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO platform_api, studio_api, public_api;
SQL
done
