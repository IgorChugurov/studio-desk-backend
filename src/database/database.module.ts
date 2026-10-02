import {
  type DynamicModule,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { loadEnv } from '../config/env.js';
import { type ApiDbRole, connectionConfig } from './db-roles.js';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export const PLATFORM_DB = Symbol('PLATFORM_DB');
export const STUDIO_DB = Symbol('STUDIO_DB');
export const PUBLIC_DB = Symbol('PUBLIC_DB');

const TOKENS: Record<ApiDbRole, symbol> = {
  platform_api: PLATFORM_DB,
  studio_api: STUDIO_DB,
  public_api: PUBLIC_DB,
};

class DatabaseConnection implements OnApplicationShutdown {
  readonly db: Database;

  constructor(private readonly pool: pg.Pool) {
    this.db = drizzle(pool, { schema });
  }

  async onApplicationShutdown() {
    await this.pool.end();
  }
}

/**
 * One connection per API, each under its own PostgreSQL user.
 * Each API module imports only `DatabaseModule.forApi(<its role>)`.
 */
@Module({})
export class DatabaseModule {
  private static readonly modules = new Map<ApiDbRole, DynamicModule>();

  static forApi(role: ApiDbRole): DynamicModule {
    let module = this.modules.get(role);
    if (!module) {
      module = this.create(role);
      this.modules.set(role, module);
    }
    return module;
  }

  private static create(role: ApiDbRole): DynamicModule {
    const connectionToken = Symbol(`${role}_connection`);
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: connectionToken,
          useFactory: () =>
            new DatabaseConnection(
              new pg.Pool({ ...connectionConfig(loadEnv(), role), max: 5 }),
            ),
        },
        {
          provide: TOKENS[role],
          useFactory: (connection: DatabaseConnection) => connection.db,
          inject: [connectionToken],
        },
      ],
      exports: [TOKENS[role]],
    };
  }
}
