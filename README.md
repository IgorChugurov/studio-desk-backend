# StudioDesk backend

Nest application with three APIs (`/api/platform`, `/api/studio`, `/api/public`) over one PostgreSQL database.

Architecture and rules live in `studio-desk-docs`:

- `03-architecture/backend-structure.md` — three APIs, database users and table rights, environment
- `03-architecture/api-conventions.md` — validation, error format, OpenAPI, `/api/health`
- `04-engineering-rules/backend.md` — stack, configuration, migrations, tests

## Requirements

- Node.js 24 (`nvm use` reads `.nvmrc`)
- pnpm (`corepack enable`)
- Docker Desktop

## First start

```bash
cp .env.example .env   # then replace every change-me value
pnpm install
pnpm db:up             # PostgreSQL in Docker; first start creates users and databases
pnpm db:migrate        # applies migrations as studio_desk_owner
pnpm start:dev
```

Check: `http://localhost:3000/api/health`.

OpenAPI (not in production): `http://localhost:3000/api/<platform|studio|public>/docs`, JSON at `.../docs/json`.

## Commands

| Command            | What it does                                                      |
| ------------------ | ----------------------------------------------------------------- |
| `pnpm db:up`       | Start PostgreSQL                                                  |
| `pnpm db:down`     | Stop PostgreSQL, keep data                                        |
| `pnpm db:reset`    | Delete all data and recreate users and databases from zero        |
| `pnpm db:generate` | Generate a migration from schema changes in `src/database/schema` |
| `pnpm db:migrate`  | Apply migrations to the database from `.env`                      |
| `pnpm start:dev`   | Run the application with reload on change                         |
| `pnpm test`        | Unit tests (`src/**/*.spec.ts`)                                   |
| `pnpm test:e2e`    | Integration tests on `studio_desk_test` (`test/`)                 |
| `pnpm typecheck`   | TypeScript check                                                  |
| `pnpm lint`        | oxlint                                                            |
| `pnpm format`      | Prettier                                                          |

## New table

1. Describe it in `src/database/schema/` and run `pnpm db:generate`.
2. In the generated migration, add `GRANT` statements for each API user that needs the table, and only the rights it needs.
3. Add the table to `src/database/expected-grants.ts`.
4. Run `pnpm db:migrate` and `pnpm test:e2e`.

## Server

The image is built from `Dockerfile`. Migrations run as a separate step before the application starts, under `studio_desk_owner`: `node dist/database/migrate.js`.
