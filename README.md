# StudioDesk backend

If this file disagrees with `studio-desk-docs`, the canon wins.

Nest application with three APIs over one PostgreSQL database. Paths: `studio-desk-docs/03-architecture/backend-structure.md` (`/api/platform`, `/api/organization`, `/api/public`).

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

OpenAPI (not in production): `http://localhost:3000/api/<platform|organization|public>/docs`, JSON at `.../docs/json`.

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

Follow the new-table checklist in `studio-desk-docs/03-architecture/backend-structure.md`. The expected-grants file is `src/database/expected-grants.ts`. The organization API login in that file is `studio_api`.

## Server

Push to `development` deploys to `https://api.studio-desk.axondigital.xyz` after green tests. Setup and operations: `deploy/README.md`; design: `studio-desk-docs/03-architecture/deployment.md`.
